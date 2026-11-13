'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const {DEFAULT_MODEL,profileFor}=require('./nethra-models');
const {monitorWakeAt,dailyLimits,MAX_RUNTIME}=require('./nethra-scheduler');
const {questionForAnswer}=require('./nethra-task-contract');

const STATES = new Set(['CREATED','PLANNING','ACTIVE','SLEEPING','WAITING_FOR_USER','BLOCKED','PAUSED','FAILED','CANCELLED','COMPLETED']);
const TERMINAL = new Set(['COMPLETED','CANCELLED','FAILED']);
const AUTONOMY = new Set(['QUIET','BALANCED','ACTIVE']);
const CHECK_INS = new Set(['DAILY','WEEKLY','MILESTONES','MANUAL']);
const SOURCES = new Set(['calendar','gmail']);
const MODES = new Set(['FINITE','ONGOING']);
// Model warming and proactive-update preferences live beside the other host settings.
const WARM_STARTUP=new Set(['desktop','always','never']);
const RETENTION=new Set(['15m','30m','1h','2h','4h','8h']);
const PROACTIVE=new Set(['ALL','IMPORTANT','OFF']);
const CLOCK=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
const SETTING_DEFAULTS=Object.freeze({notificationDeviceId:null,notificationDeviceSince:0,voiceInvitations:false,childDelegation:false,taskAgentsEnabled:true,projectNotifications:Object.freeze({}),advisorReservePercent:10,warmOnStartup:'desktop',idleRetention:'2h',proactiveUpdates:'ALL',quietHours:Object.freeze({enabled:true,start:'22:00',end:'07:00'})});
const validSources=value=>Array.isArray(value)&&value.length<=SOURCES.size&&value.every(item=>SOURCES.has(item))&&new Set(value).size===value.length;
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k,v[k]])) : v);
const DAY = 86400000;
const checkInDelay=policy=>policy==='DAILY'?DAY:policy==='WEEKLY'?7*DAY:null;
const TRANSITIONS = {
  CREATED: new Set(['CREATED','PLANNING','ACTIVE','SLEEPING','WAITING_FOR_USER','BLOCKED','PAUSED','FAILED','CANCELLED']),
  PLANNING: new Set(['PLANNING','ACTIVE','SLEEPING','WAITING_FOR_USER','BLOCKED','PAUSED','FAILED','CANCELLED','COMPLETED']),
  ACTIVE: new Set(['ACTIVE','SLEEPING','WAITING_FOR_USER','BLOCKED','PAUSED','FAILED','CANCELLED','COMPLETED']),
  SLEEPING: new Set(['SLEEPING','ACTIVE','PLANNING','WAITING_FOR_USER','BLOCKED','PAUSED','FAILED','CANCELLED']),
  WAITING_FOR_USER: new Set(['WAITING_FOR_USER','BLOCKED','PAUSED','FAILED','CANCELLED']),
  BLOCKED: new Set(['BLOCKED','PAUSED','FAILED','CANCELLED']),
  PAUSED: new Set(['PAUSED','CANCELLED'])
};

/** One SQLite transaction protects each state transition and its audit event. */
class NethraStore {
  constructor(directory, {now = Date.now,maxObjectives=500,maxRunnableObjectives=100} = {}) {
    if(!Number.isSafeInteger(maxObjectives)||maxObjectives<1||!Number.isSafeInteger(maxRunnableObjectives)||maxRunnableObjectives<1)throw new Error('Nethra objective limits must be positive integers');
    this.directory = path.resolve(directory); this.now = now;this.childControllers=new Map();this.maxObjectives=maxObjectives;this.maxRunnableObjectives=maxRunnableObjectives;
    fs.mkdirSync(this.directory, {recursive:true});
    this.db = new DatabaseSync(path.join(this.directory,'nethra.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 6) { this.db.close(); throw new Error('Nethra database requires a newer Junction'); }
    this.transaction(() => this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, taskId TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_milestone_seq ON events(taskId,seq) WHERE kind='MILESTONE_VERIFIED';
      CREATE INDEX IF NOT EXISTS events_milestone_time ON events(taskId,at,seq) WHERE kind='MILESTONE_VERIFIED';
      CREATE INDEX IF NOT EXISTS events_owner_direction ON events(taskId,seq) WHERE kind IN ('REDIRECTED','EDITED');
      CREATE INDEX IF NOT EXISTS events_dependency_completion ON events(taskId,seq) WHERE json_extract(detail,'$.status')='COMPLETED';
      CREATE INDEX IF NOT EXISTS events_claimed_seq ON events(taskId,seq) WHERE kind='CLAIMED';
      CREATE TABLE IF NOT EXISTS lease(singleton INTEGER PRIMARY KEY CHECK(singleton=1), taskId TEXT NOT NULL, token TEXT NOT NULL, owner TEXT NOT NULL, expiresAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, binding TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY, taskId TEXT NOT NULL, actionKey TEXT NOT NULL, binding TEXT NOT NULL, body TEXT NOT NULL, UNIQUE(taskId,actionKey));
      CREATE TABLE IF NOT EXISTS actions(actionKey TEXT PRIMARY KEY, binding TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS model_jobs(id TEXT PRIMARY KEY, taskId TEXT NOT NULL, binding TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(singleton INTEGER PRIMARY KEY CHECK(singleton=1), body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS usage(day INTEGER NOT NULL, taskId TEXT NOT NULL, ms INTEGER NOT NULL, PRIMARY KEY(day,taskId));
      CREATE TABLE IF NOT EXISTS executions(token TEXT PRIMARY KEY, taskId TEXT NOT NULL, startedAt INTEGER NOT NULL, accountedMs INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS inference_intervals(id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL, startedAt INTEGER NOT NULL, endedAt INTEGER, accountedMs INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS children(id TEXT PRIMARY KEY, parentId TEXT NOT NULL, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS children_parent ON children(parentId);`));
    this.transaction(()=>{
      if(!this.db.prepare('PRAGMA table_info(executions)').all().some(c=>c.name==='inferenceOnly'))this.db.exec('ALTER TABLE executions ADD COLUMN inferenceOnly INTEGER NOT NULL DEFAULT 0');
      if(version<3)this.db.exec('PRAGMA user_version=3');
    });
    this.transaction(()=>{
      this.db.exec('CREATE TABLE IF NOT EXISTS attention(id TEXT PRIMARY KEY, taskId TEXT NOT NULL, source TEXT NOT NULL, sourceId TEXT NOT NULL, revision TEXT NOT NULL, dueAt INTEGER NOT NULL, state TEXT NOT NULL, leaseToken TEXT, body TEXT NOT NULL); CREATE INDEX IF NOT EXISTS attention_due ON attention(state,dueAt);');
      // Objectives created before schema 4 get the same profile defaults the clients display.
      for(const row of this.db.prepare('SELECT body FROM tasks').all()){
        const task=JSON.parse(row.body);if(CHECK_INS.has(task.checkIn)||TERMINAL.has(task.status))continue;
        Object.assign(task,{autonomy:AUTONOMY.has(task.autonomy)?task.autonomy:'BALANCED',priority:Number.isSafeInteger(task.priority)&&task.priority>=1&&task.priority<=5?task.priority:3,checkIn:'WEEKLY',lastMeaningfulProgressAt:task.lastMeaningfulProgressAt??null,lastDirectionAt:this.now(),nextDirectionCheckAt:this.now()+7*DAY,lastMilestoneCount:(task.completedSteps||[]).length});
        this.db.prepare('UPDATE tasks SET body=? WHERE id=?').run(JSON.stringify(task),task.id);
        this.db.prepare('INSERT INTO events(taskId,at,kind,detail) VALUES(?,?,?,?)').run(task.id,this.now(),'PROFILE_DEFAULTED',JSON.stringify({autonomy:task.autonomy,priority:task.priority,checkIn:'WEEKLY'}));
      }
      if(version<4)this.db.exec('PRAGMA user_version=4');
    });
    this.transaction(()=>{
      // Schema 5: measured before/after experiments, Junction start times, and the last live advisor usage reading.
      this.db.exec('CREATE TABLE IF NOT EXISTS experiments(id TEXT PRIMARY KEY, taskId TEXT NOT NULL, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS host_starts(at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS advisor_limits(provider TEXT PRIMARY KEY, body TEXT NOT NULL);');
      if(version<5)this.db.exec('PRAGMA user_version=5');
    });
    this.transaction(()=>{
      this.db.exec('CREATE TABLE IF NOT EXISTS task_deletions(id TEXT PRIMARY KEY, body TEXT NOT NULL);');
      if(version<6)for(const row of this.db.prepare('SELECT binding,body FROM requests').all()){
        const binding=JSON.parse(row.binding),result=JSON.parse(row.body);
        if(binding.kind==='remove'&&result.deleted===true&&!this.db.prepare('SELECT 1 FROM tasks WHERE id=?').get(binding.id)){
          this.db.prepare('INSERT OR IGNORE INTO task_deletions VALUES(?,?)').run(binding.id,JSON.stringify({...result,deletedAt:this.now(),workspace:path.join(this.directory,'workspaces',binding.id),cleanup:{workspace:'PENDING',related:'PENDING',error:null}}));
        }
      }
      this.db.exec('PRAGMA user_version=6');
    });
  }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try {const result=fn();this.db.exec('COMMIT');return result;} catch(error){this.db.exec('ROLLBACK');throw error;} }
  list() {return this.db.prepare('SELECT body FROM tasks ORDER BY rowid DESC').all().map(r=>({model:DEFAULT_MODEL,...JSON.parse(r.body)}));}
  /** The objective currently holding the inference lease, if any (at most one runs at a time). */
  liveTaskId() {const lease=this.db.prepare('SELECT taskId,expiresAt FROM lease WHERE singleton=1').get();return lease&&lease.expiresAt>this.now()?lease.taskId:null;}
  get(id) {const row=this.db.prepare('SELECT body FROM tasks WHERE id=?').get(id);if(!row){this.assertNotDeleted(id);throw new Error('Unknown Nethra task');}return {model:DEFAULT_MODEL,...JSON.parse(row.body)};}
  linkConversation(id,conversationId) {return this.transaction(()=>{const task=this.get(id);if(task.conversationId)return structuredClone(task);if(typeof conversationId!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(conversationId))throw new Error('Invalid conversation ID');task.conversationId=conversationId;return this.save(task,'CHAT_LINKED',{conversationId});});}
  save(task,kind,detail={}) {this.assertNotDeleted(task.id);const previous=this.db.prepare('SELECT body FROM tasks WHERE id=?').get(task.id);if(!previous||JSON.parse(previous.body).status!==task.status)detail={...detail,status:task.status};task.revision++;task.updatedAt=this.now();this.db.prepare('INSERT INTO tasks VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(task.id,JSON.stringify(task));this.db.prepare('INSERT INTO events(taskId,at,kind,detail) VALUES(?,?,?,?)').run(task.id,this.now(),kind,JSON.stringify(detail));return structuredClone(task);}
  modelJobs(taskId){return this.db.prepare('SELECT body FROM model_jobs WHERE taskId=? ORDER BY rowid').all(taskId).map(row=>JSON.parse(row.body));}
  modelJob(taskId,id){const row=this.db.prepare('SELECT body FROM model_jobs WHERE taskId=? AND id=?').get(taskId,id);if(!row)throw Error('Unknown model job for this task');return JSON.parse(row.body);}
  createModelJob(taskId,id,input,token){return this.transaction(()=>{
    this.assertRunnable(taskId,token);const binding=canonical(input),old=this.db.prepare('SELECT * FROM model_jobs WHERE id=?').get(id);
    if(old){if(old.taskId!==taskId||old.binding!==binding)throw Error('Model job payload mismatch');return this.replay(old);}
    if(this.modelJobs(taskId).length>=10)throw Error('Ten model jobs are already saved for this task');
    const job={id,taskId,...input,createdAt:this.now(),samples:[],status:'PARTIAL'};
    this.db.prepare('INSERT INTO model_jobs VALUES(?,?,?,?)').run(id,taskId,binding,JSON.stringify(job));return job;
  });}
  saveModelSample(taskId,id,sample,token){return this.transaction(()=>{
    const task=this.assertRunnable(taskId,token),job=this.modelJob(taskId,id);
    if(sample.index!==job.samples.length+1||job.samples.length>=job.request.samples)throw Error('Model sample sequence mismatch');
    job.samples.push(sample);job.status=job.samples.length===job.request.samples?'COMPLETED':'PARTIAL';
    this.db.prepare('UPDATE model_jobs SET body=? WHERE id=?').run(JSON.stringify(job),id);
    this.save(task,'MODEL_SAMPLE_SAVED',{jobId:id,index:sample.index,total:job.request.samples,model:job.model,outputTokens:sample.outputTokens,wallMs:sample.wallMs});return job;
  });}
  /** Delivery bookkeeping only: no revision bump or journal event, like budget accounting. */
  markReportPending(id) {return this.transaction(()=>{const task=this.get(id);task.reportPending={status:task.status,at:this.now()};return this.saveBudget(task);});}
  clearReportPending(id) {return this.transaction(()=>{const task=this.get(id);if(!task.reportPending)return task;delete task.reportPending;return this.saveBudget(task);});}
  saveBudget(task) {this.db.prepare('UPDATE tasks SET body=? WHERE id=?').run(JSON.stringify(task),task.id);return structuredClone(task);}
  create(input) {
    const {goal,successCriteria='',persistent=true,conversationId=null,projectId,parentTaskId,readRoots=[],thinking=this.settings().thinking,requestId,autonomy='BALANCED',priority=3,checkIn='WEEKLY',sources=[],mode='FINITE',continuous=false,allowCodeWork=false,model=DEFAULT_MODEL}=input;
    profileFor(model);
    if(projectId!==undefined&&(typeof projectId!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(projectId)))throw new Error('Invalid project ID');
    if(typeof continuous!=='boolean')throw new Error('Invalid continuous preference');
    if(typeof allowCodeWork!=='boolean')throw new Error('Invalid Codex work preference');
    if(typeof goal!=='string'||!goal.trim()||goal.length>24000)throw new Error('Invalid goal');
    if(!AUTONOMY.has(autonomy))throw new Error('Invalid autonomy profile');
    if(!Number.isSafeInteger(priority)||priority<1||priority>5)throw new Error('Invalid objective priority');
    if(!CHECK_INS.has(checkIn))throw new Error('Invalid check-in policy');
    if(!validSources(sources))throw new Error('Invalid watched sources');
    if(!MODES.has(mode))throw new Error('Invalid objective mode');
    if(!Array.isArray(readRoots)||readRoots.some(r=>typeof r!=='string'||!path.isAbsolute(r)))throw new Error('Read roots must be absolute paths');
    return this.transaction(()=>{
      const binding=canonical({kind:'create',input}),old=requestId&&this.db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);
      if(old){if(old.binding!==binding)throw new Error('Request payload mismatch');return this.replay(old);}
      const parent=parentTaskId===undefined?null:this.get(parentTaskId);
      if(parent&&!this.settings().taskAgentsEnabled)throw new Error('Full task agents are disabled');
      if(parent?.parentId)throw new Error('Launch agents from a top-level task');
      const existing=this.list();
      // The same request re-sent in the same conversation (a retry, or a resend while a reply is slow)
      // continues the active objective instead of starting a duplicate that doubles the inference queue.
      if(conversationId){const same=existing.find(task=>task.conversationId===conversationId&&task.projectId===projectId&&!TERMINAL.has(task.status)&&task.goal===goal.trim());if(same){if(requestId)this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestId,binding,JSON.stringify(same));return structuredClone(same);}}
      if(existing.length>=this.maxObjectives)throw new Error('Nethra objective storage limit reached; archive or remove completed objectives before creating more.');
      const runnable=existing.filter(task=>!['COMPLETED','CANCELLED','FAILED','PAUSED'].includes(task.status)).length;
      if(runnable>=this.maxRunnableObjectives)throw new Error('Nethra active objective limit reached; pause or finish existing work before creating more.');
      const id=randomUUID(),workspace=path.join(this.directory,'workspaces',id);
      fs.mkdirSync(workspace,{recursive:true});
      const result=this.save({id,goal:goal.trim(),successCriteria,plan:[],completedSteps:[],pendingSteps:[],evidence:[],contextCheckpoint:{},questions:[],ownerInputs:[],status:'CREATED',summary:'',nextWakeAt:null,lastExecutionAt:null,dependencies:[],requiredApprovals:[],errors:[],retryCount:0,budget:{dailyMs:0,totalMs:0},parentId:parent?.id||null,conversationId,...((parent?parent.projectId:projectId)?{projectId:parent?parent.projectId:projectId}:{}),...(parent?.privateProjectWork?{privateProjectWork:true}:{}),readRoots:[...readRoots],workspace,persistent:!!persistent,thinking,autonomy,priority,checkIn,sources:[...sources],mode,model:parent?.model||model,lastMeaningfulProgressAt:null,lastDirectionAt:this.now(),nextDirectionCheckAt:checkInDelay(checkIn)?this.now()+checkInDelay(checkIn):null,lastMilestoneCount:0,continuous,allowCodeWork,revision:0,createdAt:this.now()},'CREATED');
      if(requestId)this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestId,binding,JSON.stringify(result));return result;
    });
  }
  events(id,after=0) {return this.db.prepare('SELECT * FROM events WHERE taskId=? AND seq>? ORDER BY seq LIMIT 500').all(id,after).map(r=>({...r,detail:JSON.parse(r.detail)}));}
  recentTaskEvents(id,limit=30) {this.get(id);if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('Invalid task event limit');return this.db.prepare('SELECT * FROM events WHERE taskId=? ORDER BY seq DESC LIMIT ?').all(id,limit).map(r=>({...r,detail:JSON.parse(r.detail)}));}
  latestDependencyCompletion(id) {
    return this.db.prepare("SELECT taskId,seq,at FROM events WHERE taskId=? AND json_extract(detail,'$.status')='COMPLETED' ORDER BY seq DESC LIMIT 1").get(id)||null;
  }
  latestTaskClaim(id) {
    return this.db.prepare("SELECT seq FROM events WHERE taskId=? AND kind='CLAIMED' ORDER BY seq DESC LIMIT 1").get(id)||null;
  }
  /** Small public work-log entries; the lease fences stale runners without changing task revision. */
  recordActivity(id,kind,detail,leaseToken) {return this.transaction(()=>{this.assertLease(id,leaseToken);if(!['MODEL_STEP','NETHRA_UPDATE','TOOL_STARTED','TOOL_FAILED'].includes(kind))throw new Error('Invalid task activity');const body=JSON.stringify(detail||{});if(Buffer.byteLength(body)>1000)throw new Error('Task activity is too large');this.db.prepare('INSERT INTO events(taskId,at,kind,detail) VALUES(?,?,?,?)').run(id,this.now(),kind,body);});}
  milestoneEvents(id,after=0) {return this.db.prepare('SELECT seq,taskId,at,kind,detail FROM events WHERE taskId=? AND kind=? AND seq>? ORDER BY seq').all(id,'MILESTONE_VERIFIED',after).map(r=>({...r,detail:JSON.parse(r.detail)}));}
  /** Aggregate only the latest verified milestone window; never load its tool history. */
  latestMilestoneBatch(id,since=0,windowMs=900000) {
    if(!Number.isSafeInteger(since)||since<0||!Number.isSafeInteger(windowMs)||windowMs<60000)throw new Error('Invalid milestone window');
    const last=this.db.prepare("SELECT seq,at FROM events WHERE taskId=? AND kind='MILESTONE_VERIFIED' AND at>=? ORDER BY seq DESC LIMIT 1").get(id,since);
    if(!last)return null;
    // Owner direction, including a same-millisecond edit, supersedes older progress.
    const direction=this.db.prepare("SELECT seq FROM events WHERE taskId=? AND kind IN ('REDIRECTED','EDITED') ORDER BY seq DESC LIMIT 1").get(id);
    if(direction&&direction.seq>last.seq)return null;
    const start=Math.floor(last.at/windowMs)*windowMs,readyAt=start+windowMs;
    const {count}=this.db.prepare("SELECT COUNT(*) AS count FROM events WHERE taskId=? AND kind='MILESTONE_VERIFIED' AND at>=? AND at<? AND seq>?").get(id,Math.max(start,since),readyAt,direction?.seq||0);
    return {seq:last.seq,at:last.at,start,readyAt,count};
  }
  recentEvents(since=0,limit=40) {return this.db.prepare('SELECT seq,taskId,at,kind,detail FROM events WHERE at>=? ORDER BY seq DESC LIMIT ?').all(since,limit).map(row=>({seq:row.seq,taskId:row.taskId,at:row.at,kind:row.kind,detail:JSON.parse(row.detail)}));}
  attention(id) {return this.db.prepare('SELECT body,state FROM attention WHERE taskId=? ORDER BY dueAt DESC,id DESC LIMIT 500').all(id).reverse().map(row=>({...JSON.parse(row.body),state:row.state}));}
  pendingAttentionDue(id) {return this.db.prepare('SELECT body FROM attention WHERE taskId=? AND state=\'PENDING\' ORDER BY dueAt LIMIT 100').all(id).map(row=>JSON.parse(row.body)).find(item=>item.reasoningRequired)?.dueAt??null;}
  hasClaimedReasoningAttention(id,token) {return this.db.prepare('SELECT body FROM attention WHERE taskId=? AND state=\'CLAIMED\' AND leaseToken=?').all(id,token).some(row=>JSON.parse(row.body).reasoningRequired);}
  observeAttention(event) {return this.transaction(()=>{
    const task=this.get(event.taskId);if(TERMINAL.has(task.status))return {created:false,reason:'terminal'};
    const id=require('node:crypto').createHash('sha256').update(canonical([event.taskId,event.source,event.sourceId,event.revision,event.kind])).digest('hex');
    const old=this.db.prepare('SELECT body FROM attention WHERE id=?').get(id);if(old)return {created:false,event:JSON.parse(old.body)};
    const body={id,taskId:task.id,source:event.source,sourceId:event.sourceId,revision:event.revision,kind:event.kind,evidenceRef:event.evidenceRef||null,priority:event.priority||task.priority||3,reasoningRequired:event.reasoningRequired!==false,createdAt:this.now(),dueAt:event.dueAt??this.now()};
    this.db.prepare('INSERT INTO attention(id,taskId,source,sourceId,revision,dueAt,state,body) VALUES(?,?,?,?,?,?,?,?)').run(id,task.id,event.source,event.sourceId,event.revision,body.dueAt,'PENDING',JSON.stringify(body));
    if(body.reasoningRequired&&task.status==='SLEEPING'&&task.nextWakeAt!=null&&body.dueAt<task.nextWakeAt){task.nextWakeAt=body.dueAt;this.save(task,'ATTENTION_QUEUED',{id,kind:event.kind,evidenceRef:body.evidenceRef});}
    return {created:true,event:body};
  });}
  configure(id,patch,revision,requestId) {return this.transaction(()=>{
    if(!requestId)throw new Error('A request ID is required');
    const binding=canonical({kind:'configure',id,patch,revision}),old=this.db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);
    if(old){if(old.binding!==binding)throw new Error('Request payload mismatch');return this.replay(old);}
    if(Object.keys(patch).some(key=>!['autonomy','priority','checkIn','sources','mode','continuous','allowCodeWork','model','coordinateSelfImprovement'].includes(key))||!Object.keys(patch).length)throw new Error('Invalid objective configuration');
    if(patch.model!==undefined)profileFor(patch.model);
    if(patch.continuous!==undefined&&typeof patch.continuous!=='boolean')throw new Error('Invalid continuous preference');
    if(patch.allowCodeWork!==undefined&&typeof patch.allowCodeWork!=='boolean')throw new Error('Invalid Codex work preference');
    if(patch.mode!==undefined&&!MODES.has(patch.mode))throw new Error('Invalid objective mode');
    if(patch.autonomy!==undefined&&!AUTONOMY.has(patch.autonomy))throw new Error('Invalid autonomy profile');
    if(patch.priority!==undefined&&(!Number.isSafeInteger(patch.priority)||patch.priority<1||patch.priority>5))throw new Error('Invalid objective priority');
    if(patch.checkIn!==undefined&&!CHECK_INS.has(patch.checkIn))throw new Error('Invalid check-in policy');
    if(patch.sources!==undefined&&!validSources(patch.sources))throw new Error('Invalid watched sources');
    const pacingOnly=Object.keys(patch).length===1&&Object.hasOwn(patch,'continuous');
    let task=this.get(id);if(task.revision!==revision&&!pacingOnly)throw new Error('Nethra revision conflict');if(TERMINAL.has(task.status))throw new Error('Terminal Nethra task is immutable');
    if(Object.hasOwn(patch,'coordinateSelfImprovement')){
      const {selfImprovementTask}=require('./nethra-coordination');
      if(typeof patch.coordinateSelfImprovement!=='boolean'||Object.keys(patch).length!==1||(!selfImprovementTask(task)&&!task.coordination))throw new Error('Coordination applies to the Self Improvement task');
      if(patch.coordinateSelfImprovement&&(!task.persistent||!task.allowCodeWork||task.privateProjectWork||!task.conversationId))throw new Error('Coordination requires a persistent task with a linked conversation and approved development work');
      this.fenceInside(id);task=this.get(id);
      if(patch.coordinateSelfImprovement&&!task.coordination){
        task.coordination={stage:'consulting',advisors:{}};
        if(task.status==='SLEEPING')task.nextWakeAt=this.now();
      }else if(!patch.coordinateSelfImprovement&&task.coordination?.questionId){
        task.questions=task.questions.map(q=>q.id===task.coordination.questionId&&q.status==='OPEN'?{...q,status:'SUPERSEDED'}:q);
        if(task.status==='WAITING_FOR_USER'&&!task.questions.some(q=>q.status==='OPEN')&&!this.approvals(id).some(a=>a.status==='PENDING'))task.status='ACTIVE';
      }
    }
    // The owner can change pacing while a model pass is active. The runner reads the
    // saved preference at the end of the pass; other edits still require no lease.
    if(!pacingOnly){if(patch.model!==undefined&&patch.model!==task.model){this.fenceInside(id);task=this.get(id);}else this.assertLease(id);}Object.assign(task,patch);
    // Switching continuous work on brings a sleeping objective back now.
    if(patch.continuous===true&&task.status==='SLEEPING'&&(task.mode!=='ONGOING'||(task.pendingSteps||[]).length)){task.nextWakeAt=this.now();task.wakeReason={kind:'OWNER',detail:'Continuous work switched on',at:this.now()};}
    if(patch.model!==undefined&&patch.model!==this.get(id).model&&task.status==='SLEEPING'&&task.continuous&&(task.pendingSteps||[]).length){task.nextWakeAt=this.now();task.wakeReason={kind:'OWNER',detail:'Continue pending work with selected model',at:this.now()};}
    if(patch.continuous===false&&task.status==='SLEEPING'&&(task.wakeReason?.kind==='CONTINUE'||task.wakeReason?.detail==='Continuous work switched on')&&task.nextWakeAt<this.now()+this.settings().minWakeMs){task.nextWakeAt=this.now()+this.settings().minWakeMs;task.wakeReason={kind:'CONTINUE',detail:'Continue at normal task pace',at:task.nextWakeAt};}
    if(patch.checkIn!==undefined){task.nextDirectionCheckAt=checkInDelay(task.checkIn)?this.now()+checkInDelay(task.checkIn):null;task.lastDirectionAt=this.now();task.lastMilestoneCount=(task.completedSteps||[]).length;}
    if(task.status==='SLEEPING'&&task.mode==='ONGOING'&&task.lastMilestoneAt!=null&&(patch.autonomy!==undefined||patch.mode!==undefined)){
      task.nextWakeAt=monitorWakeAt(task,this.now());
      const attentionDue=this.pendingAttentionDue(id);if(Number.isSafeInteger(attentionDue))task.nextWakeAt=Math.min(task.nextWakeAt,attentionDue);
    }
    const result=this.save(task,'CONFIGURED',patch);
    this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestId,binding,JSON.stringify(result));return result;
  });}
  settings() {const r=this.db.prepare('SELECT body FROM settings WHERE singleton=1').get();const value={enabled:true,thinking:true,verbose:false,persistentStartup:true,minWakeMs:300000,maxWakeMs:604800000,globalDailyBudgetMs:3600000,objectiveDailyBudgetMs:1200000,...SETTING_DEFAULTS,...(r?JSON.parse(r.body):{}),thinking:true};return {...value,quietHours:{...SETTING_DEFAULTS.quietHours,...(value.quietHours||{})},globalDailyMs:value.globalDailyBudgetMs,objectiveDailyMs:value.objectiveDailyBudgetMs};}
  setSettings(patch,{restore=false}={}) {
    const stopped=[];
    const settings=this.transaction(()=>{const allowed=['enabled','thinking','verbose','persistentStartup','minWakeMs','maxWakeMs','globalDailyBudgetMs','objectiveDailyBudgetMs','globalDailyMs','objectiveDailyMs','warmOnStartup','idleRetention','quietHours','proactiveUpdates','advisorReservePercent','notificationDeviceId','voiceInvitations','childDelegation','taskAgentsEnabled','projectNotifications',...(restore?['notificationDeviceSince']:[])];if(Object.keys(patch).some(k=>!allowed.includes(k)))throw new Error('Unknown Nethra setting');if(patch.thinking===false)throw new Error('Qwen3 30B always uses thinking');const value={...this.settings(),...patch};if(Object.hasOwn(patch,'globalDailyMs'))value.globalDailyBudgetMs=patch.globalDailyMs;if(Object.hasOwn(patch,'objectiveDailyMs'))value.objectiveDailyBudgetMs=patch.objectiveDailyMs;for(const key of ['globalDailyBudgetMs','objectiveDailyBudgetMs'])if(value[key]!==null&&(!Number.isFinite(value[key])||value[key]<0))throw new Error('Invalid budget');if(!Number.isFinite(value.minWakeMs)||value.minWakeMs<300000||!Number.isFinite(value.maxWakeMs)||value.maxWakeMs>604800000||value.maxWakeMs<value.minWakeMs)throw new Error('Invalid wake bounds');for(const key of ['enabled','thinking','verbose','persistentStartup','voiceInvitations','childDelegation','taskAgentsEnabled'])if(typeof value[key]!=='boolean')throw new Error('Invalid boolean setting');
    if(!WARM_STARTUP.has(value.warmOnStartup))throw new Error('Invalid startup warming preference');if(!RETENTION.has(value.idleRetention))throw new Error('Invalid idle retention');if(!PROACTIVE.has(value.proactiveUpdates))throw new Error('Invalid update preference');if(!Number.isInteger(value.advisorReservePercent)||value.advisorReservePercent<0||value.advisorReservePercent>50)throw new Error('Advisor reserve must be a whole percentage from 0 to 50');
    if(value.notificationDeviceId!==null&&(typeof value.notificationDeviceId!=='string'||!value.notificationDeviceId.trim()||value.notificationDeviceId==='*'||value.notificationDeviceId.length>160))throw new Error('Invalid notification device');
    if(!restore&&Object.hasOwn(patch,'notificationDeviceId')&&patch.notificationDeviceId!==this.settings().notificationDeviceId)value.notificationDeviceSince=this.now();
    if(!Number.isSafeInteger(value.notificationDeviceSince)||value.notificationDeviceSince<0)throw new Error('Invalid notification device cutoff');
    const rules=value.projectNotifications;
    if(!rules||typeof rules!=='object'||Array.isArray(rules)||Object.keys(rules).length>256||Object.entries(rules).some(([id,mode])=>!/^[A-Za-z0-9_-]{1,160}$/.test(id)||!['IMPORTANT','OFF'].includes(mode)))throw new Error('Invalid project notification rules');
    const quiet=value.quietHours;if(!quiet||typeof quiet!=='object'||Array.isArray(quiet)||Object.keys(quiet).some(k=>!['enabled','start','end'].includes(k))||typeof quiet.enabled!=='boolean'||!CLOCK.test(quiet.start)||!CLOCK.test(quiet.end))throw new Error('Invalid quiet hours');
    value.quietHours={enabled:quiet.enabled,start:quiet.start,end:quiet.end};
    if(patch.taskAgentsEnabled===false){
      for(const task of this.list()){
        if(task.parentId&&task.status!=='PAUSED'&&!TERMINAL.has(task.status))this.controlInside(task,'pause');
      }
    }
    if(patch.childDelegation===false){
      const rows=this.db.prepare("SELECT body FROM children WHERE json_extract(body,'$.status')='ACTIVE'").all();
      for(const row of rows){
        const child=JSON.parse(row.body);
        this.terminateChildInside(child,'STOPPED','Stopped by the owner: child delegation disabled');
        stopped.push(child.id);
      }
    }
    value.globalDailyMs=value.globalDailyBudgetMs;value.objectiveDailyMs=value.objectiveDailyBudgetMs;this.db.prepare('INSERT INTO settings VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET body=excluded.body').run(JSON.stringify(value));return value;});
    for(const id of stopped)this.childControllers.get(id)?.abort(new Error('Stopped by the owner: child delegation disabled'));
    return settings;
  }
  assertLease(id,token) {const lease=this.db.prepare('SELECT * FROM lease WHERE singleton=1').get();if(token){if(!lease||lease.taskId!==id||lease.token!==token||lease.expiresAt<=this.now())throw new Error('Nethra lease expired or fenced');}else if(lease?.taskId===id&&lease.expiresAt>this.now())throw new Error('Nethra task requires its lease token');}
  /** Journals one advisor consultation. Live usage windows, not a count, decide whether it may run. */
  recordConsult(id,provider,token) {return this.transaction(()=>{
    this.assertRunnable(id,token);
    if(!['codex','claude'].includes(provider))throw new Error('Unknown advisor');
    const now=this.now(),day=new Date(now).toISOString().slice(0,10),start=Date.parse(`${day}T00:00:00.000Z`);
    const kind=`${provider.toUpperCase()}_CONSULT_RESERVED`,today=this.db.prepare('SELECT COUNT(*) AS count FROM events WHERE kind=? AND at>=?').get(kind,start).count;
    this.db.prepare('INSERT INTO events(taskId,at,kind,detail) VALUES(?,?,?,?)').run(id,now,kind,JSON.stringify({todayAcrossObjectives:today+1}));
    return {todayAcrossObjectives:today+1};
  });}
  /** Journals that older tool results were dropped to fit the window, so it is visible, not silent. */
  recordContextCompaction(id,{compacted,removedExchanges=0,estimatedTokens,budget}) {this.db.prepare('INSERT INTO events(taskId,at,kind,detail) VALUES(?,?,?,?)').run(id,this.now(),'CONTEXT_COMPACTED',JSON.stringify({compacted,removedExchanges,estimatedTokens,budget}));}
  recordContextMeasurement(id,{estimatedTokens,actualTokens,budget}) {this.get(id);if(![estimatedTokens,actualTokens,budget].every(value=>Number.isSafeInteger(value)&&value>=0))throw new Error('Invalid context measurement');this.db.prepare('INSERT INTO events(taskId,at,kind,detail) VALUES(?,?,?,?)').run(id,this.now(),'CONTEXT_MEASURED',JSON.stringify({estimatedTokens,actualTokens,budget}));}
  advisorSnapshot(provider) {const row=this.db.prepare('SELECT body FROM advisor_limits WHERE provider=?').get(provider);return row?JSON.parse(row.body):null;}
  recordAdvisorSnapshot(provider,body) {this.db.prepare('INSERT INTO advisor_limits VALUES(?,?) ON CONFLICT(provider) DO UPDATE SET body=excluded.body').run(provider,JSON.stringify(body));}
  recordHostStart() {this.db.prepare('INSERT INTO host_starts VALUES(?)').run(this.now());this.db.prepare('DELETE FROM host_starts WHERE at<?').run(this.now()-90*DAY);}
  hostStartsAfter(at) {return this.db.prepare('SELECT at FROM host_starts WHERE at>? ORDER BY at LIMIT 10').all(at).map(row=>row.at);}
  experiments(taskId) {return this.db.prepare('SELECT body FROM experiments WHERE taskId=? ORDER BY rowid DESC').all(taskId).map(row=>JSON.parse(row.body));}
  experiment(taskId,id) {const row=this.db.prepare('SELECT body FROM experiments WHERE id=? AND taskId=?').get(id,taskId);if(!row)throw new Error('Unknown experiment for this objective');return JSON.parse(row.body);}
  createExperiment(taskId,input,token) {return this.transaction(()=>{
    this.assertRunnable(taskId,token);
    const all=this.experiments(taskId);
    if(all.filter(item=>item.status!=='CONCLUDED').length>=3)throw new Error('This objective already has three open experiments; evaluate one first');
    if(all.length>=30)this.db.prepare('DELETE FROM experiments WHERE id=?').run(all.at(-1).id);
    const experiment={id:randomUUID(),taskId,...input,status:'BASELINE',changeAt:null,changeNote:null,changeActor:null,result:null};
    this.db.prepare('INSERT INTO experiments VALUES(?,?,?)').run(experiment.id,taskId,JSON.stringify(experiment));
    this.db.prepare('INSERT INTO events(taskId,at,kind,detail) VALUES(?,?,?,?)').run(taskId,this.now(),'EXPERIMENT_STARTED',JSON.stringify({id:experiment.id,metric:experiment.metric,baseline:{count:experiment.baseline.count,median:experiment.baseline.median}}));
    return experiment;
  });}
  /** at is set only for host-verified changes (a commit's time); workId links a Work Activity draft whose promotion is the change. */
  markExperimentChange(taskId,id,{note,actor,at=null,workId=null},token) {return this.transaction(()=>{
    this.assertRunnable(taskId,token);
    const experiment=this.experiment(taskId,id);
    if(experiment.status!=='BASELINE')throw new Error('The change for this experiment is already recorded');
    if(workId)Object.assign(experiment,{workId:String(workId).slice(0,64),changeNote:String(note||'').slice(0,500)});
    else Object.assign(experiment,{status:'CHANGED',changeAt:Number.isSafeInteger(at)?at:this.now(),changeNote:String(note||'').slice(0,500),changeActor:String(actor||'Nethra').slice(0,160)});
    this.db.prepare('UPDATE experiments SET body=? WHERE id=?').run(JSON.stringify(experiment),id);
    this.db.prepare('INSERT INTO events(taskId,at,kind,detail) VALUES(?,?,?,?)').run(taskId,this.now(),workId?'EXPERIMENT_LINKED':'EXPERIMENT_CHANGED',JSON.stringify({id,actor:experiment.changeActor||null,workId:experiment.workId||null}));
    return experiment;
  });}
  saveExperimentResult(taskId,id,result,conclude) {return this.transaction(()=>{
    const experiment=this.experiment(taskId,id);if(experiment.status==='CONCLUDED')return experiment;
    experiment.result=result;if(conclude)experiment.status='CONCLUDED';
    this.db.prepare('UPDATE experiments SET body=? WHERE id=?').run(JSON.stringify(experiment),id);
    if(conclude)this.db.prepare('INSERT INTO events(taskId,at,kind,detail) VALUES(?,?,?,?)').run(taskId,this.now(),'EXPERIMENT_CONCLUDED',JSON.stringify({id,result}));
    return experiment;
  });}
  abandonExperiment(taskId,id,note,token) {return this.transaction(()=>{
    this.assertRunnable(taskId,token);
    if(typeof note!=='string'||!note.trim()||note.length>500)throw new Error('A reason is required to abandon an experiment');
    const experiment=this.experiment(taskId,id);
    if(experiment.status!=='BASELINE')throw new Error('Only an unused baseline can be abandoned');
    experiment.status='CONCLUDED';experiment.result={verdict:'ABANDONED',detail:note.trim(),evaluatedAt:this.now()};
    this.db.prepare('UPDATE experiments SET body=? WHERE id=?').run(JSON.stringify(experiment),id);
    this.db.prepare('INSERT INTO events(taskId,at,kind,detail) VALUES(?,?,?,?)').run(taskId,this.now(),'EXPERIMENT_ABANDONED',JSON.stringify({id,reason:note.trim()}));
    return experiment;
  });}
  /** Host maintenance: withdraws an experiment whose change point was never real. Journaled, never silent. */
  invalidateExperiment(taskId,id,reason) {return this.transaction(()=>{
    if(typeof reason!=='string'||!reason.trim())throw new Error('A reason is required to invalidate an experiment');
    const experiment=this.experiment(taskId,id);
    experiment.status='CONCLUDED';experiment.result={verdict:'INVALID',detail:reason.trim().slice(0,500),previous:experiment.result||null,evaluatedAt:this.now()};
    this.db.prepare('UPDATE experiments SET body=? WHERE id=?').run(JSON.stringify(experiment),id);
    this.db.prepare('INSERT INTO events(taskId,at,kind,detail) VALUES(?,?,?,?)').run(taskId,this.now(),'EXPERIMENT_INVALIDATED',JSON.stringify({id,reason:experiment.result.detail}));
    return experiment;
  });}
  update(id,patch,event='UPDATED',leaseToken) {return this.transaction(()=>{this.assertLease(id,leaseToken);const task=this.get(id);if(TERMINAL.has(task.status))throw new Error('Terminal Nethra task is immutable');if(patch.status&&!TRANSITIONS[task.status]?.has(patch.status))throw new Error('Illegal Nethra state transition');if(patch.revision!==undefined&&patch.revision!==task.revision)throw new Error('Nethra revision conflict');if(patch.status&&!STATES.has(patch.status))throw new Error('Invalid Nethra status');const priorEvidence=task.evidence||[],nextEvidence=patch.evidence;const latest=Array.isArray(nextEvidence)?nextEvidence.at(-1):null;const freshEvidence=latest&&!latest.result?.error&&!(latest.tool==='propose_code_work'&&latest.result?.status==='REVISE')&&(nextEvidence.length>priorEvidence.length||JSON.stringify(latest)!==JSON.stringify(priorEvidence.at(-1)));const progressed=freshEvidence||(Array.isArray(patch.completedSteps)&&patch.completedSteps.length>(task.completedSteps||[]).length);const allowed=['goal','successCriteria','plan','completedSteps','pendingSteps','questions','evidence','contextCheckpoint','coordination','status','summary','nextWakeAt','lastExecutionAt','dependencies','requiredApprovals','errors','retryCount','budget','parentId','thinking','nextDirectionCheckAt','lastDirectionAt','lastMilestoneCount','lastMilestoneAt','lastMilestoneEvidenceFingerprint','lastInitiativeProgressAt','lastInitiativeAt','noProgressCycles','wakeReason','lastInferenceFingerprint','lastCycleProgressed','unchangedWakes','codexConsultDay','codexConsultCount'];for(const key of allowed)if(Object.hasOwn(patch,key))task[key]=patch[key];if(progressed)task.lastMeaningfulProgressAt=Math.max(this.now(),(task.lastDirectionAt||0)+1,(task.lastMeaningfulProgressAt||0)+1);return this.save(task,event,patch);});}
  /** Host repair after raising the shared context window. Preserve the objective checkpoint. */
  retryContextBlocked(id) {return this.transaction(()=>{
    const task=this.get(id);
    if(task.status!=='BLOCKED'||!/^Nethra's protected prompt needs about \d+ tokens, above its \d+-token input budget\./.test(task.summary||''))throw new Error('Objective is not at a context block');
    if(this.db.prepare('SELECT 1 FROM lease WHERE taskId=?').get(id)||this.approvals(id).some(item=>['PENDING','REJECTED'].includes(item.status)))throw new Error('Objective still has an execution or approval gate');
    task.status='ACTIVE';task.summary='';task.nextWakeAt=null;task.wakeReason=null;
    return this.save(task,'CONTEXT_RETRIED',{contextTokens:require('./model-context').CONTEXT_TOKENS});
  });}
  control(id,action,revision,requestId) {return this.transaction(()=>{
    if(!['pause','resume','cancel','wake'].includes(action))throw new Error('Invalid Nethra action');
    if(!requestId)throw new Error('A request ID is required');
    const binding=canonical({id,action,revision}),old=this.db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);
    if(old){const previous=JSON.parse(old.binding);if(previous.id!==id||previous.action!==action)throw new Error('Request payload mismatch');return this.replay(old);}
    const task=this.get(id);
    if(task.revision!==revision)throw new Error('Nethra revision conflict');
    if(TERMINAL.has(task.status))throw new Error('Task is already finished');
    if(task.parentId&&!this.settings().taskAgentsEnabled&&['resume','wake'].includes(action))throw new Error('Full task agents are disabled');
    const result=this.controlInside(task,action);
    this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestId,binding,JSON.stringify(result));
    return result;
  });}
  controlInside(task,action) {
    const {id}=task;
    if(action==='resume'&&['WAITING_FOR_USER','BLOCKED'].includes(task.status))throw new Error(`Cannot resume a ${task.status} objective without resolving its gate`);
    if(action==='wake'){
      // "Check it now": bring a sleeping objective's next wake forward. Gates still apply.
      if(task.status!=='SLEEPING')throw new Error(task.status==='PAUSED'?'Resume this objective first':`A ${task.status} objective cannot be woken early`);
      task.nextWakeAt=this.now();task.wakeReason={kind:'OWNER',detail:'The owner asked Nethra to check now',at:this.now()};task.unchangedWakes=0;task.lastCycleProgressed=null;
      return this.save(task,'WAKE_REQUESTED');
    }
    if(action==='pause'&&task.status!=='PAUSED'){
      task.pausedFromStatus=task.status;task.pausedWakeAt=task.nextWakeAt;
      task.pausedForApproval=task.status==='WAITING_FOR_USER'&&this.approvals(id).some(item=>item.status==='PENDING');
      task.status='PAUSED';task.nextWakeAt=null;
    } else if(action==='resume'){
      const approvals=this.approvals(id);
      const prior=task.status==='PAUSED'?(task.pausedFromStatus||'ACTIVE'):'ACTIVE';
      task.status=approvals.some(item=>item.status==='REJECTED')?'BLOCKED':approvals.some(item=>item.status==='PENDING')?'WAITING_FOR_USER':prior==='WAITING_FOR_USER'&&!task.pausedForApproval?'WAITING_FOR_USER':prior==='BLOCKED'?'BLOCKED':prior==='SLEEPING'&&task.pausedWakeAt!=null?'SLEEPING':'ACTIVE';
      task.nextWakeAt=task.status==='SLEEPING'?task.pausedWakeAt:null;
      delete task.pausedFromStatus;delete task.pausedWakeAt;delete task.pausedForApproval;
    } else if(action==='cancel'){
      task.status='CANCELLED';task.nextWakeAt=null;delete task.pausedFromStatus;delete task.pausedWakeAt;delete task.pausedForApproval;
    }
    const lease=this.db.prepare('SELECT * FROM lease WHERE taskId=?').get(id);
    if(lease){this.closeInferenceIntervals(lease.token);this.accountUsage(id,this.now()-this.execution(lease.token).startedAt,lease.token);task.budget=this.get(id).budget;this.interruptChildrenInside(id,lease.token);this.db.prepare('UPDATE attention SET state=?,leaseToken=NULL WHERE leaseToken=?').run(action==='cancel'?'DONE':'PENDING',lease.token);this.db.prepare('DELETE FROM lease WHERE taskId=?').run(id);}
    return this.save(task,action.toUpperCase());
  }
  recoverInside({force=false}={}) {
    const lease=this.db.prepare('SELECT * FROM lease WHERE singleton=1').get();
    if(!lease||(!force&&lease.expiresAt>this.now()))return 0;
    this.closeInferenceIntervals(lease.token);
    this.accountUsage(lease.taskId,this.now()-this.execution(lease.token).startedAt,lease.token);
    this.interruptChildrenInside(lease.taskId,lease.token);
    this.db.prepare("UPDATE attention SET state='PENDING',leaseToken=NULL WHERE leaseToken=?").run(lease.token);
    this.db.prepare('DELETE FROM lease WHERE singleton=1').run();
    const task=this.get(lease.taskId);
    if(['ACTIVE','PLANNING'].includes(task.status)){
      task.status=task.persistent?'ACTIVE':'PAUSED';
      task.summary='Interrupted execution recovered from durable checkpoint';
      this.save(task,'RECOVERED');
    }
    return 1;
  }
  recoverExpired() {return this.transaction(()=>this.recoverInside());}
  // The host may force recovery only after it acquires the Electron single-instance lock.
  recoverAbandoned() {return this.transaction(()=>this.recoverInside({force:true}));}
  usage(taskId,at=this.now()) {const day=Math.floor(at/DAY),rows=this.db.prepare('SELECT taskId,ms FROM usage WHERE day=?').all(day);return {day,globalMs:rows.reduce((s,r)=>s+r.ms,0),taskMs:rows.find(r=>r.taskId===taskId)?.ms||0};}
  inferenceSamples(taskId,since=0,limit=100) {
    this.get(taskId);
    if(!Number.isSafeInteger(since)||since<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('Invalid inference sample window');
    return this.db.prepare('SELECT i.endedAt AS at, i.endedAt-i.startedAt AS durationMs FROM inference_intervals i JOIN executions e ON e.token=i.token WHERE e.taskId=? AND i.endedAt IS NOT NULL AND i.endedAt>=? AND i.endedAt>i.startedAt ORDER BY i.endedAt DESC LIMIT ?').all(taskId,since,limit);
  }
  execution(token) {const row=this.db.prepare('SELECT * FROM executions WHERE token=?').get(token);if(!row)throw new Error('Unknown execution lease');return row;}
  accountUsage(id,elapsed,token) {
    const execution=this.execution(token);if(execution.taskId!==id)throw new Error('Execution lease mismatch');
    if(execution.inferenceOnly)return this.accountInferenceUsage(id,token);
    const total=Math.min(MAX_RUNTIME,Math.max(0,Math.round(elapsed))),delta=Math.max(0,total-execution.accountedMs);
    if(!delta)return this.get(id);
    // Allocate across UTC days, so a run across midnight cannot evade a cap.
    let cursor=execution.startedAt+execution.accountedMs,remaining=delta;
    while(remaining>0){const day=Math.floor(cursor/DAY),ms=Math.min(remaining,(day+1)*DAY-cursor);this.db.prepare('INSERT INTO usage VALUES(?,?,?) ON CONFLICT(day,taskId) DO UPDATE SET ms=ms+excluded.ms').run(day,id,ms);cursor+=ms;remaining-=ms;}
    this.db.prepare('UPDATE executions SET accountedMs=? WHERE token=?').run(total,token);
    const task=this.get(id),u=this.usage(id);task.budget={...task.budget,dailyMs:u.taskMs,totalMs:(task.budget.totalMs||0)+delta,day:u.day};
    return this.saveBudget(task);
  }
  accountInferenceUsage(id,token) {
    const execution=this.execution(token);let delta=0;
    for(const interval of this.db.prepare('SELECT * FROM inference_intervals WHERE token=? ORDER BY id').all(token)){
      const total=Math.max(0,Math.min(MAX_RUNTIME,Math.round((interval.endedAt??this.now())-interval.startedAt))),added=Math.max(0,Math.min(total-interval.accountedMs,MAX_RUNTIME-execution.accountedMs-delta));
      let cursor=interval.startedAt+interval.accountedMs,remaining=added;
      while(remaining>0){const day=Math.floor(cursor/DAY),ms=Math.min(remaining,(day+1)*DAY-cursor);this.db.prepare('INSERT INTO usage VALUES(?,?,?) ON CONFLICT(day,taskId) DO UPDATE SET ms=ms+excluded.ms').run(day,id,ms);cursor+=ms;remaining-=ms;}
      if(added)this.db.prepare('UPDATE inference_intervals SET accountedMs=? WHERE id=?').run(interval.accountedMs+added,interval.id);
      delta+=added;
    }
    if(!delta)return this.get(id);
    this.db.prepare('UPDATE executions SET accountedMs=accountedMs+? WHERE token=?').run(delta,token);
    const task=this.get(id),u=this.usage(id);task.budget={...task.budget,dailyMs:u.taskMs,totalMs:(task.budget.totalMs||0)+delta,day:u.day};return this.saveBudget(task);
  }
  closeInferenceIntervals(token) {this.db.prepare('UPDATE inference_intervals SET endedAt=? WHERE token=? AND endedAt IS NULL').run(this.now(),token);}
  beginInference(id,token) {return this.transaction(()=>{
    this.assertRunnable(id,token);const execution=this.execution(token);if(execution.taskId!==id)throw new Error('Execution lease mismatch');
    if(this.db.prepare('SELECT 1 FROM inference_intervals WHERE token=? AND endedAt IS NULL').get(token))return;
    this.db.prepare('INSERT INTO inference_intervals(token,startedAt) VALUES(?,?)').run(token,this.now());
  });}
  endInference(id,token) {return this.transaction(()=>{
    const execution=this.execution(token);if(execution.taskId!==id)throw new Error('Execution lease mismatch');
    if(this.deletion(id))return null;
    this.closeInferenceIntervals(token);return this.accountUsage(id,0,token);
  });}
  recordUsage(id,elapsed,token) {return this.transaction(()=>this.accountUsage(id,elapsed,token));}
  claim(owner,leaseMs=420000) {return this.transaction(()=>{this.recoverInside();if(this.db.prepare('SELECT 1 FROM lease').get())return null;const settings=this.settings();if(!settings.enabled)return null;const effective=task=>Math.max(1,(task.priority??3)-Math.floor(Math.max(0,this.now()-(task.lastExecutionAt??task.createdAt??this.now()))/3600000));const tasks=this.list().filter(task=>(!task.parentId||settings.taskAgentsEnabled)&&['CREATED','ACTIVE','PLANNING','SLEEPING'].includes(task.status)&&!(task.nextWakeAt>this.now())).sort((a,b)=>effective(a)-effective(b)||(a.lastExecutionAt??0)-(b.lastExecutionAt??0)||(a.createdAt??0)-(b.createdAt??0));for(const task of tasks){if(task.dependencies.some(id=>{try{return this.get(id).status!=='COMPLETED';}catch{return true;}}))continue;const u=this.usage(task.id),limits=dailyLimits(settings);if(u.globalMs>=limits.globalMs||u.taskMs>=limits.taskMs){task.status='SLEEPING';task.nextWakeAt=(u.day+1)*DAY;this.save(task,'BUDGET_WAIT');continue;}const token=randomUUID();this.db.prepare('INSERT INTO lease VALUES(1,?,?,?,?)').run(task.id,token,String(owner),this.now()+leaseMs);this.db.prepare('INSERT INTO executions(token,taskId,startedAt,inferenceOnly) VALUES(?,?,?,1)').run(token,task.id,this.now());this.db.prepare('UPDATE attention SET state=\'CLAIMED\',leaseToken=? WHERE taskId=? AND state=\'PENDING\' AND dueAt<=?').run(token,task.id,this.now());task.status=task.status==='CREATED'?'PLANNING':'ACTIVE';task.lastExecutionAt=this.now();task.nextWakeAt=null;return {task:this.save(task,'CLAIMED',{owner}),token};}return null;});}
  renew(id,token,leaseMs=420000) {return this.transaction(()=>{const changed=this.db.prepare('UPDATE lease SET expiresAt=? WHERE singleton=1 AND taskId=? AND token=? AND expiresAt>?').run(this.now()+leaseMs,id,token,this.now()).changes===1;if(changed)this.accountUsage(id,this.now()-this.execution(token).startedAt,token);return changed;});}
  release(id,token,consumed=true) {return this.transaction(()=>{const lease=this.db.prepare('SELECT * FROM lease WHERE singleton=1 AND taskId=? AND token=?').get(id,token);if(!lease)return false;this.closeInferenceIntervals(token);this.accountUsage(id,this.now()-this.execution(token).startedAt,token);this.interruptChildrenInside(id,token);this.db.prepare('UPDATE attention SET state=?,leaseToken=NULL WHERE leaseToken=?').run(consumed?'DONE':'PENDING',token);this.db.prepare('DELETE FROM lease WHERE singleton=1').run();return true;});}
  answer(id,text,revision,requestId,questionId=null) {return this.transaction(()=>{
    if(typeof text!=='string'||!text.trim()||text.length>24000)throw new Error('Invalid owner answer');if(!requestId)throw new Error('A request ID is required');
    const binding=canonical({kind:'answer',id,text,revision,...(questionId!==null?{questionId}:{})}),old=this.db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);if(old){if(old.binding!==binding)throw new Error('Request payload mismatch');return this.replay(old);}
    const task=this.get(id),question=questionForAnswer(task,{questionId,conversationId:task.conversationId});
    if(task.status!=='WAITING_FOR_USER'&&!question)throw new Error('This objective is not waiting for input');if(task.revision!==revision)throw new Error('Nethra revision conflict');
    if(TERMINAL.has(task.status))throw new Error('Task is already finished');
    if(this.approvals(id).some(item=>item.status==='PENDING'))throw new Error('An answer does not grant the pending exact action approval');
    const lease=this.db.prepare('SELECT * FROM lease WHERE taskId=?').get(id);if(lease&&task.status==='WAITING_FOR_USER')throw new Error('Task is executing; wait for its checkpoint');
    if(question)task.questions=task.questions.map(item=>item.id===question.id?{...item,status:'ANSWERED',answer:text.trim(),answeredAt:this.now(),answerRequestId:requestId}:item);
    task.ownerInputs=[...(task.ownerInputs||[]),{text:text.trim(),at:this.now(),requestId,conversationId:task.conversationId||null}].slice(-100);
    if(!['PAUSED','BLOCKED'].includes(task.status)){task.summary='';task.status='ACTIVE';task.nextWakeAt=null;}task.noProgressCycles=0;task.unchangedWakes=0;task.lastCycleProgressed=null;
    const result=this.save(task,'OWNER_INPUT',{text:text.trim()});this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestId,binding,JSON.stringify(result));return result;
  });}
  /**
   * Owner edits the objective's wording. Like a redirect, verified evidence and completed
   * steps stay, the remaining plan is dropped, and pending approvals are superseded.
   */
  waiveDeletedDependencies(task) {
    const waived=(task.dependencies||[]).filter(id=>this.deletion(id));
    if(!waived.length)return;
    task.dependencies=task.dependencies.filter(id=>!waived.includes(id));
    this.db.prepare('INSERT INTO events(taskId,at,kind,detail) VALUES(?,?,?,?)').run(task.id,this.now(),'DELETED_DEPENDENCY_WAIVED',JSON.stringify({ids:waived,reason:'Owner explicitly redirected or continued the task'}));
  }
  assignProject(id,projectId,revision,requestId,projectExists) {
    if(projectId!==null&&(typeof projectId!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(projectId)))throw new Error('Invalid project ID');
    return this.transaction(()=>{
      const binding=canonical({kind:'assignProject',id,projectId,revision});
      const previous=this.db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);
      if(previous){
        if(previous.binding!==binding)throw new Error('Request payload mismatch');
        return this.replay(previous);
      }
      const task=this.get(id);
      if(task.revision!==revision)throw new Error('Nethra revision conflict');
      if(projectId!==null&&!projectExists(projectId))throw new Error('Unknown project');
      if(task.projectId!==projectId)delete task.projectDocuments;
      if(projectId===null)delete task.projectId;
      else task.projectId=projectId;
      const result=this.save(task,'PROJECT_ASSIGNED',{projectId});
      this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestId,binding,JSON.stringify(result));
      return result;
    });
  }
  setProjectDocument(id,documentId,documentRevision,revision,requestId,readDocument) {
    if(typeof documentId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(documentId)||
      (documentRevision!==null&&(!Number.isSafeInteger(documentRevision)||documentRevision<1)))throw new Error('Invalid project document reference');
    return this.transaction(()=>{
      const binding=canonical({kind:'projectDocument',id,documentId,documentRevision,revision});
      const previous=this.db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);
      if(previous){if(previous.binding!==binding)throw new Error('Request payload mismatch');return this.replay(previous);}
      const task=this.get(id);
      if(task.revision!==revision)throw new Error('Nethra revision conflict');
      if(!task.projectId)throw new Error('Link this task to a saved project first');
      const grants=(task.projectDocuments||[]).filter(item=>item.id!==documentId);
      if(documentRevision!==null){
        if(grants.length>=8)throw new Error('This task already has eight approved documents');
        const document=readDocument(task.projectId,documentId,documentRevision);
        grants.push({id:document.id,revision:document.revision,name:document.name,sha256:document.sha256});
        task.privateProjectWork=true;
      }
      task.projectDocuments=grants;
      const result=this.save(task,'PROJECT_DOCUMENT_ACCESS',{documentId,documentRevision});
      this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestId,binding,JSON.stringify(result));
      return result;
    });
  }
  edit(id,changes,revision,requestId,{execution='replan',instruction=''}={}) {
    if(!['preserve','replan','continue'].includes(execution))throw new Error('Invalid edit execution intent');
    if(typeof instruction!=='string'||instruction.length>10000)throw new Error('Invalid edit instruction');
    if(!changes||typeof changes!=='object'||Array.isArray(changes)||Object.keys(changes).some(key=>!['goal','successCriteria'].includes(key))||(!Object.keys(changes).length&&!instruction.trim()&&execution!=='continue'))throw new Error('Edit the goal or success criteria');
    for(const [key,value] of Object.entries(changes))if(typeof value!=='string'||(key==='goal'&&!value.trim())||value.length>24000)throw new Error(`Invalid ${key}`);
    return this.transaction(()=>{
      if(!requestId)throw new Error('A request ID is required');
      const binding=canonical({kind:'edit',id,changes,revision,...(execution!=='replan'||instruction?{execution,instruction}:{})}),old=this.db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);if(old){if(old.binding!==binding)throw new Error('Request payload mismatch');return this.replay(old);}
      let task=this.get(id);if(task.revision!==revision)throw new Error('Nethra revision conflict');
      if(execution==='continue'&&task.parentId&&!this.settings().taskAgentsEnabled)throw new Error('Full task agents are disabled');
      if(TERMINAL.has(task.status)&&execution==='replan')throw new Error('Clarify whether to continue this finished task');
      this.fenceInside(id);task=this.get(id);
      const superseded=execution==='preserve'?[]:this.supersedeApprovalsInside(id);
      const before={goal:task.goal,successCriteria:task.successCriteria};
      if(changes.goal!==undefined)task.goal=changes.goal.trim();
      if(changes.successCriteria!==undefined)task.successCriteria=changes.successCriteria.trim()||task.goal;
      if(execution==='preserve'){
        const result=this.save(task,'EDITED',{before,after:{goal:task.goal,successCriteria:task.successCriteria},execution});
        this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestId,binding,JSON.stringify(result));return result;
      }
      this.waiveDeletedDependencies(task);
      task.questions=(task.questions||[]).map(item=>item.status==='OPEN'?{...item,status:'SUPERSEDED',supersededAt:this.now()}:item);
      task.ownerInputs=[...(task.ownerInputs||[]),{text:`${instruction?instruction+'\n':''}Objective edited. Now: ${task.goal}${task.successCriteria&&task.successCriteria!==task.goal?` (success: ${task.successCriteria})`:''}`,at:this.now(),requestId,kind:'redirect'}].slice(-100);
      task.plan=[...(task.completedSteps||[])];task.pendingSteps=[];task.contextCheckpoint={};task.skippedDraftPaths=[];task.redirectedAt=this.now();task.noProgressCycles=0;task.unchangedWakes=0;task.lastCycleProgressed=null;task.wakeReason=null;
      if(task.status!=='PAUSED'||execution==='continue'){task.status='ACTIVE';task.nextWakeAt=null;}
      task.summary='';
      const result=this.save(task,'EDITED',{before,after:{goal:task.goal,successCriteria:task.successCriteria},supersededApprovals:superseded});this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestId,binding,JSON.stringify(result));return result;
    });
  }
  /**
   * An owner message in the objective's chat. It joins the objective's inputs (so the next
   * wake sees it and an identical-input skip cannot ignore it) and wakes a sleeping objective.
   */
  note(id,text) {return this.transaction(()=>{
    if(typeof text!=='string'||!text.trim()||text.length>10000)throw new Error('Invalid note');
    const task=this.get(id);if(TERMINAL.has(task.status))return task;
    task.ownerInputs=[...(task.ownerInputs||[]),{text:text.trim(),at:this.now(),kind:'note'}].slice(-100);
    if(task.status==='SLEEPING'&&task.mode!=='ONGOING'||task.status==='SLEEPING'&&task.continuous){task.nextWakeAt=Math.min(task.nextWakeAt??Infinity,this.now()+15_000);task.wakeReason={kind:'OWNER',detail:'You added a note in the task chat',at:task.nextWakeAt};}
    task.noProgressCycles=0;task.unchangedWakes=0;task.lastCycleProgressed=null;
    return this.save(task,'OWNER_NOTE',{text:text.trim().slice(0,500)});
  });}
  /** One idempotent owner turn in a task's linked chat, regardless of entry transport. */
  chatTurn(id,text,requestId,{conversationId=null,questionId=null,noteOnly=false,revision=null}={}) {return this.transaction(()=>{
    if(typeof noteOnly!=='boolean')throw new Error('Invalid note-only flag');
    if(revision!==null&&(!Number.isSafeInteger(revision)||revision<0))throw new Error('Invalid task revision');
    if(typeof text!=='string'||!text.trim()||text.length>10000)throw new Error('Invalid task chat message');
    if(typeof requestId!=='string'||!requestId||requestId.length>160)throw new Error('A bounded request ID is required');
    if(conversationId!==null&&(typeof conversationId!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(conversationId)))throw new Error('Invalid owner conversation');
    const clean=text.trim(),binding=canonical({kind:'chatTurn',id,text:clean,...(conversationId?{conversationId}:{}),...(questionId!==null?{questionId}:{}),...(noteOnly?{noteOnly:true}:{}),...(revision!==null?{revision}:{})});
    const old=this.db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);
    if(old){if(old.binding!==binding)throw new Error('Request payload mismatch');return this.replay(old);}
    const task=this.get(id);
    if(revision!==null&&task.revision!==revision)throw new Error('Nethra revision conflict');
    if(TERMINAL.has(task.status))throw new Error('Task is already finished');
    const pendingApproval=task.status==='WAITING_FOR_USER'&&this.approvals(id).some(item=>item.status==='PENDING');
    const question=questionForAnswer(task,{questionId,conversationId:conversationId||task.conversationId});
    const answered=!noteOnly&&!pendingApproval&&(task.status==='WAITING_FOR_USER'||Boolean(question));
    if(answered){
      if(task.status==='WAITING_FOR_USER'&&this.db.prepare('SELECT 1 FROM lease WHERE taskId=?').get(id))throw new Error('Task is executing; wait for its checkpoint');
      if(question)task.questions=task.questions.map(item=>item.id===question.id?{...item,status:'ANSWERED',answer:clean,answeredAt:this.now(),answerRequestId:requestId}:item);
      task.ownerInputs=[...(task.ownerInputs||[]),{text:clean,at:this.now(),requestId,kind:'answer',conversationId:conversationId||task.conversationId||null}].slice(-100);
      if(!['PAUSED','BLOCKED'].includes(task.status)){task.summary='';task.status='ACTIVE';task.nextWakeAt=null;}
    }else{
      task.ownerInputs=[...(task.ownerInputs||[]),{text:clean,at:this.now(),requestId,kind:'note',conversationId:conversationId||task.conversationId||null}].slice(-100);
      if(task.status==='SLEEPING'){
        task.nextWakeAt=Math.min(task.nextWakeAt??Infinity,this.now()+15_000);
        task.wakeReason={kind:'OWNER',detail:'You added a note in the task chat',at:task.nextWakeAt};
      }
    }
    task.noProgressCycles=0;task.unchangedWakes=0;task.lastCycleProgressed=null;
    const result={task:this.save(task,answered?'OWNER_INPUT':'OWNER_NOTE',{text:clean.slice(0,500)}),kind:answered?'answer':'note',pendingApproval};
    this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestId,binding,JSON.stringify(result));
    return result;
  });}
  /** Freeze a chat reference before its first delivery, including across retries/restarts. */
  bindTaskReference(requestId,reference,conversationId,resolve) {return this.transaction(()=>{
    if(typeof requestId!=='string'||!requestId||requestId.length>160)throw new Error('A bounded request ID is required');
    if(typeof reference!=='string'||!reference||reference.length>200)throw new Error('Invalid task reference');
    if(conversationId!==null&&(typeof conversationId!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(conversationId)))throw new Error('Invalid owner conversation');
    const binding=canonical({kind:'taskReference',reference,conversationId}),old=this.db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);
    if(old){if(old.binding!==binding)throw new Error('Request payload mismatch');return this.replay(old).taskId;}
    const taskId=resolve();this.get(taskId);
    this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestId,binding,JSON.stringify({taskId}));
    return taskId;
  });}
  /**
   * Deletes an objective and its journal, approvals, attention, receipts and workspace drafts.
   * A running step is fenced first. The linked chat is kept as an ordinary conversation.
   */
  deletion(id) {const row=this.db.prepare('SELECT body FROM task_deletions WHERE id=?').get(id);return row?JSON.parse(row.body):null;}
  assertNotDeleted(id) {if(id&&this.deletion(id)){const error=new Error('Unknown Nethra task: deleted');error.code='NETHRA_TASK_DELETED';throw error;}}
  editReceipt(requestId,id,changes,revision,instruction,execution) {
    const row=this.db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);if(!row)return null;
    const old=JSON.parse(row.binding);
    if(old.kind!=='edit'||old.id!==id||old.revision!==revision||canonical(old.changes)!==canonical(changes)||(old.instruction||'')!==instruction||(execution!==undefined&&(old.execution||'replan')!==execution))throw new Error('Request payload mismatch');
    return this.replay(row);
  }
  /** Bind a conversational continuation before mutation, using the existing request authority. */
  bindContinuation(requestId,instruction,conversationId,task) {return this.transaction(()=>{
    const binding=canonical({kind:'continuation',instruction,conversationId}),old=this.db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);
    if(old){if(old.binding!==binding)throw new Error('Request payload mismatch');return this.replay(old);}
    this.get(task.id);
    const result={taskId:task.id,status:task.status,revision:task.revision};
    this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestId,binding,JSON.stringify(result));
    return result;
  });}
  replay(row) {
    const body=JSON.parse(row.body),binding=row.binding?JSON.parse(row.binding):{};
    if(binding.kind!=='remove')this.assertNotDeleted(body.task?.id||body.taskId||body.id||binding.id);
    return body;
  }
  pendingDeletions() {return this.db.prepare('SELECT body FROM task_deletions').all().map(row=>JSON.parse(row.body)).filter(item=>item.cleanup.workspace!=='DONE'||item.cleanup.related!=='DONE');}
  saveDeletion(record) {this.db.prepare('UPDATE task_deletions SET body=? WHERE id=?').run(JSON.stringify(record),record.id);return record;}
  deletionResult(id) {const {workspace,deletedAt,...result}=this.deletion(id);return result;}
  finishDeletionEffects(id,error=null) {
    const record=this.deletion(id);if(!record)return;
    record.cleanup.related=error?'PENDING':'DONE';record.cleanup.relatedError=error?String(error.message||error).slice(0,400):null;
    this.saveDeletion(record);
  }
  retryDeletionCleanup(id=null) {
    const records=id?[this.deletion(id)].filter(Boolean):this.pendingDeletions();
    for(const record of records){
      if(record.cleanup.workspace==='DONE')continue;
      try{
        const root=path.resolve(this.directory,'workspaces'),target=path.resolve(record.workspace);
        if(!target.startsWith(root+path.sep)||target===root)throw new Error('Refusing cleanup outside task workspaces');
        // Never traverse a task workspace junction/symlink to another directory.
        if(fs.existsSync(target)&&fs.lstatSync(target).isSymbolicLink())throw new Error('Refusing linked workspace cleanup');
        fs.rmSync(target,{recursive:true,force:true});record.cleanup.workspace='DONE';record.cleanup.error=null;
      }catch(error){record.cleanup.error=`${error.code||'CLEANUP_FAILED'}: ${String(error.message).slice(0,300)}`;}
      this.saveDeletion(record);
    }
  }
  remove(id,requestId) {
    if(!requestId)throw new Error('A request ID is required');
    this.transaction(()=>{
      const binding=canonical({kind:'remove',id}),old=this.db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);
      if(old&&old.binding!==binding)throw new Error('Request payload mismatch');
      if(this.deletion(id)){
        if(!old)this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestId,binding,JSON.stringify(this.deletionResult(id)));
        return;
      }
      const task=this.get(id);
      this.fenceInside(id);
      const body={deleted:true,id,goal:task.goal,conversationId:task.conversationId||null};
      this.db.prepare('INSERT INTO task_deletions VALUES(?,?)').run(id,JSON.stringify({...body,deletedAt:this.now(),workspace:task.workspace,cleanup:{workspace:'PENDING',related:'PENDING',error:null}}));
      this.db.prepare('DELETE FROM attention WHERE taskId=?').run(id);
      this.db.prepare('DELETE FROM approvals WHERE taskId=?').run(id);
      for(const row of this.db.prepare('SELECT actionKey,body FROM actions').all())if(JSON.parse(row.body).taskId===id)this.db.prepare('DELETE FROM actions WHERE actionKey=?').run(row.actionKey);
      this.db.prepare('DELETE FROM children WHERE parentId=?').run(id);
      this.db.prepare('DELETE FROM experiments WHERE taskId=?').run(id);
      this.db.prepare('DELETE FROM model_jobs WHERE taskId=?').run(id);
      this.db.prepare('DELETE FROM events WHERE taskId=?').run(id);
      this.db.prepare('DELETE FROM tasks WHERE id=?').run(id);
      // A removed dependency is unresolved, not silently satisfied.
      for(const dependent of this.list())if((dependent.dependencies||[]).includes(id)&&!TERMINAL.has(dependent.status)){
        this.fenceInside(dependent.id);const other=this.get(dependent.id);other.status='BLOCKED';other.nextWakeAt=null;other.wakeReason=null;
        other.summary='A required task was deleted. Tell Nethra how to proceed.';this.save(other,'DEPENDENCY_DELETED',{id});
      }
      this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestId,binding,JSON.stringify(body));
    });
    this.retryDeletionCleanup(id);
    return this.deletionResult(id);
  }
  fenceInside(id) {
    const lease=this.db.prepare('SELECT * FROM lease WHERE taskId=?').get(id);if(!lease)return false;
    this.closeInferenceIntervals(lease.token);this.accountUsage(id,this.now()-this.execution(lease.token).startedAt,lease.token);
    this.interruptChildrenInside(id,lease.token);
    this.db.prepare("UPDATE attention SET state='PENDING',leaseToken=NULL WHERE leaseToken=?").run(lease.token);this.db.prepare('DELETE FROM lease WHERE taskId=?').run(id);return true;
  }
  supersedeApprovalsInside(id) {
    const superseded=[];
    for(const approval of this.approvals(id).filter(item=>item.status==='PENDING')){approval.status='SUPERSEDED';approval.decidedAt=this.now();this.saveApproval(approval);superseded.push(approval.id);}
    return superseded;
  }
  /**
   * Owner changes direction. Completed steps and evidence stay; the remaining plan is
   * dropped so the next wake re-plans from the new instruction. Pending approvals for the
   * old plan are superseded and can no longer be approved. A running step is fenced.
   */
  redirect(id,instruction,revision,requestId,skipPendingDrafts=false) {return this.transaction(()=>{
    if(typeof instruction!=='string'||!instruction.trim()||instruction.length>10000)throw new Error('Provide a bounded new direction');if(!requestId)throw new Error('A request ID is required');
    if(typeof skipPendingDrafts!=='boolean')throw new Error('Invalid draft skip preference');
    const binding=canonical({kind:'redirect',id,instruction,revision,skipPendingDrafts}),old=this.db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);if(old){if(old.binding!==binding)throw new Error('Request payload mismatch');return this.replay(old);}
    let task=this.get(id);if(TERMINAL.has(task.status))throw new Error('Task is already finished');if(task.revision!==revision)throw new Error('Nethra revision conflict');
    const lease=this.db.prepare('SELECT * FROM lease WHERE taskId=?').get(id);
    if(lease){this.closeInferenceIntervals(lease.token);this.accountUsage(id,this.now()-this.execution(lease.token).startedAt,lease.token);this.db.prepare("UPDATE attention SET state='PENDING',leaseToken=NULL WHERE leaseToken=?").run(lease.token);this.db.prepare('DELETE FROM lease WHERE taskId=?').run(id);task=this.get(id);}
    const superseded=[],skippedDraftPaths=[];
    for(const approval of this.approvals(id).filter(item=>item.status==='PENDING')){approval.status='SUPERSEDED';approval.decidedAt=this.now();this.saveApproval(approval);superseded.push(approval.id);if(skipPendingDrafts&&approval.tool==='write_draft'&&typeof approval.args?.path==='string')skippedDraftPaths.push(approval.args.path);}
    this.waiveDeletedDependencies(task);
    task.questions=(task.questions||[]).map(item=>item.status==='OPEN'?{...item,status:'SUPERSEDED',supersededAt:this.now()}:item);
    task.ownerInputs=[...(task.ownerInputs||[]),{text:instruction.trim(),at:this.now(),requestId,kind:'redirect'}].slice(-100);
    task.plan=[...(task.completedSteps||[])];task.pendingSteps=[];task.contextCheckpoint={};task.skippedDraftPaths=skippedDraftPaths;task.status='ACTIVE';task.summary='';task.nextWakeAt=null;task.wakeReason=null;task.noProgressCycles=0;task.unchangedWakes=0;task.lastCycleProgressed=null;task.redirectedAt=this.now();
    delete task.pausedFromStatus;delete task.pausedWakeAt;delete task.pausedForApproval;
    const result=this.save(task,'REDIRECTED',{text:instruction.trim(),supersededApprovals:superseded});this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestId,binding,JSON.stringify(result));return result;
  });}
  assertRunnable(id,token) {const task=this.get(id);if(TERMINAL.has(task.status)||task.status==='PAUSED')throw new Error('Nethra task is inactive or paused');this.assertLease(id,token);return task;}
  requestApproval(taskId,action,token) {return this.transaction(()=>this.requestApprovalInside(taskId,action,token));}
  requestApprovalInside(taskId,{tool,args,category,key},token) {
    this.assertRunnable(taskId,token);if(!key||!tool)throw new Error('Approval requires a key and tool');
    const binding=canonical({tool,args,category}),old=this.db.prepare('SELECT * FROM approvals WHERE taskId=? AND actionKey=?').get(taskId,key);
    if(old){
      if(old.binding!==binding)throw new Error('Approval payload mismatch');const approval=JSON.parse(old.body);
      if(approval.status!=='EXPIRED')return approval;
      approval.status='PENDING';approval.expiresAt=this.now()+DAY;approval.decidedAt=null;this.saveApproval(approval);
      const task=this.get(taskId);task.status='WAITING_FOR_USER';task.nextWakeAt=null;this.save(task,'APPROVAL_RENEWED',{approvalId:approval.id});return approval;
    }
    const task=this.get(taskId),approval={id:randomUUID(),taskId,tool,args,category,key,status:'PENDING',createdAt:this.now(),expiresAt:this.now()+DAY,decidedAt:null,consumedAt:null};
    this.db.prepare('INSERT INTO approvals VALUES(?,?,?,?,?)').run(approval.id,taskId,key,binding,JSON.stringify(approval));task.requiredApprovals.push(approval.id);task.status='WAITING_FOR_USER';task.nextWakeAt=null;this.save(task,'APPROVAL_REQUESTED',{approvalId:approval.id});return approval;
  }

  approvals(taskId) {return this.db.prepare('SELECT body FROM approvals WHERE taskId=? ORDER BY rowid').all(taskId).map(r=>JSON.parse(r.body));}
  approval(id) {const row=this.db.prepare('SELECT body FROM approvals WHERE id=?').get(id);if(!row)throw new Error('Unknown approval');return JSON.parse(row.body);}
  saveApproval(a) {this.db.prepare('UPDATE approvals SET body=? WHERE id=?').run(JSON.stringify(a),a.id);return a;}
  decideApproval(id,approved,requestId) {return this.transaction(()=>{
    if(!requestId)throw new Error('A request ID is required');const binding=canonical({id,approved}),old=this.db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);
    if(old){if(old.binding!==binding)throw new Error('Request payload mismatch');return this.replay(old);}
    const a=this.approval(id);if(a.status!=='PENDING')throw new Error('Approval already decided');
    a.status=a.expiresAt<=this.now()?'EXPIRED':approved?'APPROVED':'REJECTED';a.decidedAt=this.now();
    if(a.reviewRequired&&a.status==='APPROVED'){
      const receipt=this.getAction(a.key);if(receipt&&receipt.status!=='COMPLETED'){receipt.status='RETRY_APPROVED';this.db.prepare('UPDATE actions SET body=? WHERE actionKey=?').run(JSON.stringify(receipt),a.key);}
      a.reviewRequired=false;
    }
    this.saveApproval(a);const task=this.get(a.taskId);
    if(!TERMINAL.has(task.status)&&task.status!=='PAUSED'){const approvals=this.approvals(a.taskId);if(approvals.some(item=>['REJECTED','EXPIRED'].includes(item.status)))task.status='BLOCKED';else task.status=approvals.some(item=>item.status==='PENDING')?'WAITING_FOR_USER':'ACTIVE';task.nextWakeAt=null;}
    this.save(task,'APPROVAL_DECIDED',{approvalId:id,status:a.status});this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestId,binding,JSON.stringify(a));return a;
  });}
  consumeApproval(id,token) {return this.transaction(()=>{
    const a=this.approval(id);this.assertRunnable(a.taskId,token);if(a.status!=='APPROVED')return null;
    if(a.expiresAt<=this.now()){a.status='EXPIRED';this.saveApproval(a);return null;}
    // The approval can never be durably consumed without its exact reservation.
    const receipt=this.reserveActionInside(a.taskId,a.key,a.tool,a.args,token);
    if(receipt.status==='RETRY_APPROVED'){receipt.status='RESERVED';receipt.retriedAt=this.now();this.db.prepare('UPDATE actions SET body=? WHERE actionKey=?').run(JSON.stringify(receipt),a.key);}
    a.status='CONSUMED';a.consumedAt=this.now();return this.saveApproval(a);
  });}
  reviewInterruptedApproval(id,token) {const approval=this.approval(id);return this.reviewInterruptedAction(approval.taskId,approval.key,token,approval);}
  reviewInterruptedAction(taskId,key,token,previous) {return this.transaction(()=>{
    this.assertRunnable(taskId,token);const receipt=this.getAction(key);
    if(receipt?.status==='COMPLETED')return previous;
    const a=previous||this.requestApprovalInside(taskId,{tool:receipt.tool,args:receipt.args,category:'LOCAL_WRITE',key},token);
    a.status='PENDING';a.reviewRequired=true;a.decidedAt=null;a.expiresAt=this.now()+DAY;
    a.reviewReason='Interrupted write has an uncertain result. Approve to retry the exact replacement, or reject to keep it blocked.';
    this.saveApproval(a);const task=this.get(taskId);task.status='WAITING_FOR_USER';task.summary=a.reviewReason;task.nextWakeAt=null;this.save(task,'ACTION_REVIEW_REQUIRED',{approvalId:a.id,key});return a;
  });}

  reserveActionInside(taskId,key,tool,args,token) {
    this.assertRunnable(taskId,token);const binding=canonical({taskId,tool,args}),old=this.db.prepare('SELECT * FROM actions WHERE actionKey=?').get(key);
    if(old){if(old.binding!==binding)throw new Error('Action payload mismatch');return this.replay(old);}
    const receipt={key,taskId,tool,args,status:'RESERVED',result:null,createdAt:this.now()};this.db.prepare('INSERT INTO actions VALUES(?,?,?)').run(key,binding,JSON.stringify(receipt));return receipt;
  }
  reserveAction(taskId,key,tool,args,token) {return this.transaction(()=>this.reserveActionInside(taskId,key,tool,args,token));}
  getAction(key) {const row=this.db.prepare('SELECT body FROM actions WHERE actionKey=?').get(key);return row?JSON.parse(row.body):null;}
  actions(taskId) {return this.db.prepare('SELECT body FROM actions').all().map(row=>JSON.parse(row.body)).filter(action=>action.taskId===taskId);}
  finishAction(key,result,token) {return this.transaction(()=>{const receipt=this.getAction(key);if(!receipt)throw new Error('Unknown action');this.assertRunnable(receipt.taskId,token);if(receipt.status==='COMPLETED')return receipt;receipt.status='COMPLETED';receipt.result=result;receipt.finishedAt=this.now();this.db.prepare('UPDATE actions SET body=? WHERE actionKey=?').run(JSON.stringify(receipt),key);return receipt;});}
  children(parentId) {return this.db.prepare('SELECT body FROM children WHERE parentId=? ORDER BY rowid').all(parentId).map(row=>JSON.parse(row.body));}
  recentAgents(parentId) {
    return this.db.prepare(`SELECT body FROM tasks WHERE json_extract(body,'$.parentId')=?
      ORDER BY json_extract(body,'$.status') IN ('COMPLETED','CANCELLED','FAILED'), rowid DESC LIMIT 8`).all(parentId).map(row=>JSON.parse(row.body));
  }
  recentChildren(parentId,limit=8) {
    return this.db.prepare('SELECT body FROM children WHERE parentId=? ORDER BY rowid DESC LIMIT ?').all(parentId,limit).map(row=>JSON.parse(row.body));
  }
  child(id) {
    const row=this.db.prepare('SELECT body FROM children WHERE id=?').get(id);
    if(!row)throw new Error('Unknown child');
    return JSON.parse(row.body);
  }
  assertChildActive(id,token) {
    const child=this.child(id);
    this.assertRunnable(child.parentId,token);
    if(child.leaseToken!==token||child.status!=='ACTIVE')throw new Error('Child execution is fenced');
    return child;
  }
  childCancellation(id,token) {
    this.assertChildActive(id,token);
    const controller=new AbortController();
    this.childControllers.set(id,controller);
    return {signal:controller.signal,dispose:()=>this.childControllers.delete(id)};
  }
  terminateChildInside(child,status,reason) {
    child.status=status;
    child.finishedAt=this.now();
    child.error=reason;
    delete child.leaseToken;
    this.db.prepare('UPDATE children SET body=? WHERE id=?').run(JSON.stringify(child),child.id);
    this.db.prepare('INSERT INTO events(taskId,at,kind,detail) VALUES(?,?,?,?)').run(child.parentId,this.now(),`CHILD_${status}`,JSON.stringify({childId:child.id,reason}));
    return child;
  }
  interruptChildrenInside(parentId,token) {
    const active=this.db.prepare("SELECT body FROM children WHERE parentId=? AND json_extract(body,'$.status')='ACTIVE' AND json_extract(body,'$.leaseToken')=?").all(parentId,token);
    for(const row of active){
      this.terminateChildInside(JSON.parse(row.body),'INTERRUPTED','Parent work pass ended');
    }
  }
  stopChild(parentId,id,requestId) {
    if(typeof requestId!=='string'||!requestId||requestId.length>160)throw new Error('A bounded request ID is required');
    const result=this.transaction(()=>{
      this.get(parentId);
      const binding=canonical({kind:'stopChild',taskId:parentId,childId:id});
      const previous=this.db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);
      if(previous){
        if(previous.binding!==binding)throw new Error('Request payload mismatch');
        return this.replay(previous);
      }
      const child=this.child(id);
      if(child.parentId!==parentId)throw new Error('Unknown child of this parent task');
      if(child.status==='ACTIVE')this.terminateChildInside(child,'STOPPED','Stopped by the owner');
      const saved={taskId:parentId,child};
      this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestId,binding,JSON.stringify(saved));
      return saved;
    });
    if(result.child.status==='STOPPED')this.childControllers.get(id)?.abort(new Error(result.child.error));
    return result.child;
  }
  startChild(parentId,scope,runId,token) {return this.transaction(()=>{
    if(typeof token!=='string'||!token)throw Error('Child delegation requires a parent execution lease');
    this.assertRunnable(parentId,token);
    if(!this.settings().childDelegation)throw Error('Child delegation is disabled');
    if(typeof scope!=='string'||!scope.trim()||scope.length>1500||typeof runId!=='string'||!runId)throw Error('Invalid child scope');
    const active=this.db.prepare("SELECT body FROM children WHERE parentId=? AND json_extract(body,'$.status')='ACTIVE'").all(parentId);
    for(const row of active){
      const previous=JSON.parse(row.body);
      if(previous.leaseToken===token)throw Error('Child work must be sequential');
      this.terminateChildInside(previous,'INTERRUPTED','Parent work pass ended');
    }
    const prior=this.db.prepare("SELECT body FROM children WHERE parentId=? AND json_extract(body,'$.runId')=? LIMIT 2").all(parentId,runId).map(row=>JSON.parse(row.body));
    if(prior.some(child=>child.status==='STOPPED'&&child.scope.trim()===scope.trim()))throw Error('The owner stopped this child scope in this work pass');
    if(prior.length>=2)throw Error('Child delegation budget exhausted');
    const child={id:randomUUID(),parentId,runId,scope,model:this.get(parentId).model,status:'ACTIVE',allowedTools:['web_search','read_file','list_directory'],maxIterations:4,maxToolCalls:2,depth:1,startedAt:this.now(),result:null,leaseToken:token};
    this.db.prepare('INSERT INTO children VALUES(?,?,?)').run(child.id,parentId,JSON.stringify(child));
    this.db.prepare('INSERT INTO events(taskId,at,kind,detail) VALUES(?,?,?,?)').run(parentId,this.now(),'CHILD_STARTED',JSON.stringify({childId:child.id,scope}));
    return structuredClone(child);
  });}
  finishChild(id,result,token) {return this.transaction(()=>{
    const row=this.db.prepare('SELECT body FROM children WHERE id=?').get(id);if(!row)throw Error('Unknown child');
    const child=JSON.parse(row.body);this.assertRunnable(child.parentId,token);
    if(child.leaseToken!==token||child.status!=='ACTIVE')throw Error('Child execution is fenced');
    if(!result||typeof result!=='object'||Array.isArray(result)||Object.keys(result).sort().join(',')!=='evidence,report,requiresParentReview'||typeof result.report!=='string'||result.report.length>4000||!Array.isArray(result.evidence)||result.evidence.length>2||result.requiresParentReview!==true)throw Error('Invalid child result schema');
    child.status='COMPLETED';child.result=structuredClone(result);child.finishedAt=this.now();delete child.leaseToken;
    this.db.prepare('UPDATE children SET body=? WHERE id=?').run(JSON.stringify(child),id);
    this.db.prepare('INSERT INTO events(taskId,at,kind,detail) VALUES(?,?,?,?)').run(child.parentId,this.now(),'CHILD_COMPLETED',JSON.stringify({childId:id}));
    return structuredClone(child);
  });}
  failChild(id,error,token) {return this.transaction(()=>{
    const row=this.db.prepare('SELECT body FROM children WHERE id=?').get(id);if(!row)throw Error('Unknown child');
    const child=JSON.parse(row.body);this.assertLease(child.parentId,token);
    if(child.leaseToken!==token||child.status!=='ACTIVE')throw Error('Child execution is fenced');
    child.status='FAILED';child.error=String(error?.message||error).slice(0,400);child.finishedAt=this.now();delete child.leaseToken;
    this.db.prepare('UPDATE children SET body=? WHERE id=?').run(JSON.stringify(child),id);
    this.db.prepare('INSERT INTO events(taskId,at,kind,detail) VALUES(?,?,?,?)').run(child.parentId,this.now(),'CHILD_FAILED',JSON.stringify({childId:id}));
    return structuredClone(child);
  });}
  close() {if(!this.closed){this.db.close();this.closed=true;}}
}
module.exports={NethraStore,STATES,SETTING_DEFAULTS,dailyLimits};
