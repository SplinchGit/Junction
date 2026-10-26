'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const {monitorWakeAt,dailyLimits}=require('./nethra-scheduler');

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
const SETTING_DEFAULTS=Object.freeze({advisorReservePercent:10,warmOnStartup:'desktop',idleRetention:'2h',proactiveUpdates:'ALL',quietHours:Object.freeze({enabled:true,start:'22:00',end:'07:00'})});
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
    this.directory = path.resolve(directory); this.now = now;this.maxObjectives=maxObjectives;this.maxRunnableObjectives=maxRunnableObjectives;
    fs.mkdirSync(this.directory, {recursive:true});
    this.db = new DatabaseSync(path.join(this.directory,'nethra.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 5) { this.db.close(); throw new Error('Nethra database requires a newer Junction'); }
    this.transaction(() => this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, taskId TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS lease(singleton INTEGER PRIMARY KEY CHECK(singleton=1), taskId TEXT NOT NULL, token TEXT NOT NULL, owner TEXT NOT NULL, expiresAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, binding TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY, taskId TEXT NOT NULL, actionKey TEXT NOT NULL, binding TEXT NOT NULL, body TEXT NOT NULL, UNIQUE(taskId,actionKey));
      CREATE TABLE IF NOT EXISTS actions(actionKey TEXT PRIMARY KEY, binding TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(singleton INTEGER PRIMARY KEY CHECK(singleton=1), body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS usage(day INTEGER NOT NULL, taskId TEXT NOT NULL, ms INTEGER NOT NULL, PRIMARY KEY(day,taskId));
      CREATE TABLE IF NOT EXISTS executions(token TEXT PRIMARY KEY, taskId TEXT NOT NULL, startedAt INTEGER NOT NULL, accountedMs INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS inference_intervals(id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL, startedAt INTEGER NOT NULL, endedAt INTEGER, accountedMs INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS children(id TEXT PRIMARY KEY, parentId TEXT NOT NULL, body TEXT NOT NULL);`));
    this.transaction(()=>{
      if(!this.db.prepare('PRAGMA table_info(executions)').all().some(c=>c.name==='inferenceOnly'))this.db.exec('ALTER TABLE executions ADD COLUMN inferenceOnly INTEGER NOT NULL DEFAULT 0');
      this.db.exec('PRAGMA user_version=3');
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
      this.db.exec('PRAGMA user_version=4');
    });
    this.transaction(()=>{
      // Schema 5: measured before/after experiments, Junction start times, and the last live advisor usage reading.
      this.db.exec('CREATE TABLE IF NOT EXISTS experiments(id TEXT PRIMARY KEY, taskId TEXT NOT NULL, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS host_starts(at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS advisor_limits(provider TEXT PRIMARY KEY, body TEXT NOT NULL); PRAGMA user_version=5;');
    });
  }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try {const result=fn();this.db.exec('COMMIT');return result;} catch(error){this.db.exec('ROLLBACK');throw error;} }
  list() {return this.db.prepare('SELECT body FROM tasks ORDER BY rowid DESC').all().map(r=>JSON.parse(r.body));}
  /** The objective currently holding the inference lease, if any (at most one runs at a time). */
  liveTaskId() {const lease=this.db.prepare('SELECT taskId,expiresAt FROM lease WHERE singleton=1').get();return lease&&lease.expiresAt>this.now()?lease.taskId:null;}
  get(id) {const row=this.db.prepare('SELECT body FROM tasks WHERE id=?').get(id);if(!row)throw new Error('Unknown Nethra task');return JSON.parse(row.body);}
  linkConversation(id,conversationId) {return this.transaction(()=>{const task=this.get(id);if(task.conversationId)return structuredClone(task);if(typeof conversationId!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(conversationId))throw new Error('Invalid conversation ID');task.conversationId=conversationId;return this.save(task,'CHAT_LINKED',{conversationId});});}
  save(task,kind,detail={}) {task.revision++;task.updatedAt=this.now();this.db.prepare('INSERT INTO tasks VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(task.id,JSON.stringify(task));this.db.prepare('INSERT INTO events(taskId,at,kind,detail) VALUES(?,?,?,?)').run(task.id,this.now(),kind,JSON.stringify(detail));return structuredClone(task);}
  /** Delivery bookkeeping only: no revision bump or journal event, like budget accounting. */
  markReportPending(id) {return this.transaction(()=>{const task=this.get(id);task.reportPending={status:task.status,at:this.now()};return this.saveBudget(task);});}
  clearReportPending(id) {return this.transaction(()=>{const task=this.get(id);if(!task.reportPending)return task;delete task.reportPending;return this.saveBudget(task);});}
  saveBudget(task) {this.db.prepare('UPDATE tasks SET body=? WHERE id=?').run(JSON.stringify(task),task.id);return structuredClone(task);}
  create(input) {
    const {goal,successCriteria='',persistent=true,conversationId=null,readRoots=[],thinking=this.settings().thinking,requestId,autonomy='BALANCED',priority=3,checkIn='WEEKLY',sources=[],mode='FINITE',continuous=false,allowCodeWork=false}=input;
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
      if(old){if(old.binding!==binding)throw new Error('Request payload mismatch');return JSON.parse(old.body);}
      const existing=this.list();
      // The same request re-sent in the same conversation (a retry, or a resend while a reply is slow)
      // continues the active objective instead of starting a duplicate that doubles the inference queue.
      if(conversationId){const same=existing.find(task=>task.conversationId===conversationId&&!TERMINAL.has(task.status)&&task.goal===goal.trim());if(same){if(requestId)this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestId,binding,JSON.stringify(same));return structuredClone(same);}}
      if(existing.length>=this.maxObjectives)throw new Error('Nethra objective storage limit reached; archive or remove completed objectives before creating more.');
      const runnable=existing.filter(task=>!['COMPLETED','CANCELLED','FAILED','PAUSED'].includes(task.status)).length;
      if(runnable>=this.maxRunnableObjectives)throw new Error('Nethra active objective limit reached; pause or finish existing work before creating more.');
      const id=randomUUID(),workspace=path.join(this.directory,'workspaces',id);
      fs.mkdirSync(workspace,{recursive:true});
      const result=this.save({id,goal:goal.trim(),successCriteria,plan:[],completedSteps:[],pendingSteps:[],evidence:[],ownerInputs:[],status:'CREATED',summary:'',nextWakeAt:null,lastExecutionAt:null,dependencies:[],requiredApprovals:[],errors:[],retryCount:0,budget:{dailyMs:0,totalMs:0},parentId:null,conversationId,readRoots:[...readRoots],workspace,persistent:!!persistent,thinking,autonomy,priority,checkIn,sources:[...sources],mode,lastMeaningfulProgressAt:null,lastDirectionAt:this.now(),nextDirectionCheckAt:checkInDelay(checkIn)?this.now()+checkInDelay(checkIn):null,lastMilestoneCount:0,continuous,allowCodeWork,revision:0,createdAt:this.now()},'CREATED');
      if(requestId)this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestId,binding,JSON.stringify(result));return result;
    });
  }
  events(id,after=0) {return this.db.prepare('SELECT * FROM events WHERE taskId=? AND seq>? ORDER BY seq LIMIT 500').all(id,after).map(r=>({...r,detail:JSON.parse(r.detail)}));}
  recentTaskEvents(id,limit=30) {this.get(id);if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('Invalid task event limit');return this.db.prepare('SELECT * FROM events WHERE taskId=? ORDER BY seq DESC LIMIT ?').all(id,limit).map(r=>({...r,detail:JSON.parse(r.detail)}));}
  /** Small public work-log entries; the lease fences stale runners without changing task revision. */
  recordActivity(id,kind,detail,leaseToken) {return this.transaction(()=>{this.assertLease(id,leaseToken);if(!['MODEL_STEP','NETHRA_UPDATE','TOOL_STARTED','TOOL_FAILED'].includes(kind))throw new Error('Invalid task activity');const body=JSON.stringify(detail||{});if(Buffer.byteLength(body)>1000)throw new Error('Task activity is too large');this.db.prepare('INSERT INTO events(taskId,at,kind,detail) VALUES(?,?,?,?)').run(id,this.now(),kind,body);});}
  milestoneEvents(id,after=0) {return this.db.prepare('SELECT seq,taskId,at,kind,detail FROM events WHERE taskId=? AND kind=? AND seq>? ORDER BY seq').all(id,'MILESTONE_VERIFIED',after).map(r=>({...r,detail:JSON.parse(r.detail)}));}
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
    if(old){if(old.binding!==binding)throw new Error('Request payload mismatch');return JSON.parse(old.body);}
    if(Object.keys(patch).some(key=>!['autonomy','priority','checkIn','sources','mode','continuous','allowCodeWork'].includes(key))||!Object.keys(patch).length)throw new Error('Invalid objective configuration');
    if(patch.continuous!==undefined&&typeof patch.continuous!=='boolean')throw new Error('Invalid continuous preference');
    if(patch.allowCodeWork!==undefined&&typeof patch.allowCodeWork!=='boolean')throw new Error('Invalid Codex work preference');
    if(patch.mode!==undefined&&!MODES.has(patch.mode))throw new Error('Invalid objective mode');
    if(patch.autonomy!==undefined&&!AUTONOMY.has(patch.autonomy))throw new Error('Invalid autonomy profile');
    if(patch.priority!==undefined&&(!Number.isSafeInteger(patch.priority)||patch.priority<1||patch.priority>5))throw new Error('Invalid objective priority');
    if(patch.checkIn!==undefined&&!CHECK_INS.has(patch.checkIn))throw new Error('Invalid check-in policy');
    if(patch.sources!==undefined&&!validSources(patch.sources))throw new Error('Invalid watched sources');
    const pacingOnly=Object.keys(patch).length===1&&Object.hasOwn(patch,'continuous');
    const task=this.get(id);if(task.revision!==revision&&!pacingOnly)throw new Error('Nethra revision conflict');if(TERMINAL.has(task.status))throw new Error('Terminal Nethra task is immutable');
    // The owner can change pacing while a model pass is active. The runner reads the
    // saved preference at the end of the pass; other edits still require no lease.
    if(!pacingOnly)this.assertLease(id);Object.assign(task,patch);
    // Switching continuous work on brings a sleeping objective back now.
    if(patch.continuous===true&&task.status==='SLEEPING'&&(task.mode!=='ONGOING'||(task.pendingSteps||[]).length)){task.nextWakeAt=this.now();task.wakeReason={kind:'OWNER',detail:'Continuous work switched on',at:this.now()};}
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
  setSettings(patch) {return this.transaction(()=>{const allowed=['enabled','thinking','verbose','persistentStartup','minWakeMs','maxWakeMs','globalDailyBudgetMs','objectiveDailyBudgetMs','globalDailyMs','objectiveDailyMs','warmOnStartup','idleRetention','quietHours','proactiveUpdates','advisorReservePercent'];if(Object.keys(patch).some(k=>!allowed.includes(k)))throw new Error('Unknown Nethra setting');if(patch.thinking===false)throw new Error('Qwen3 30B always uses thinking');const value={...this.settings(),...patch};if(Object.hasOwn(patch,'globalDailyMs'))value.globalDailyBudgetMs=patch.globalDailyMs;if(Object.hasOwn(patch,'objectiveDailyMs'))value.objectiveDailyBudgetMs=patch.objectiveDailyMs;for(const key of ['globalDailyBudgetMs','objectiveDailyBudgetMs'])if(value[key]!==null&&(!Number.isFinite(value[key])||value[key]<0))throw new Error('Invalid budget');if(!Number.isFinite(value.minWakeMs)||value.minWakeMs<300000||!Number.isFinite(value.maxWakeMs)||value.maxWakeMs>604800000||value.maxWakeMs<value.minWakeMs)throw new Error('Invalid wake bounds');for(const key of ['enabled','thinking','verbose','persistentStartup'])if(typeof value[key]!=='boolean')throw new Error('Invalid boolean setting');
    if(!WARM_STARTUP.has(value.warmOnStartup))throw new Error('Invalid startup warming preference');if(!RETENTION.has(value.idleRetention))throw new Error('Invalid idle retention');if(!PROACTIVE.has(value.proactiveUpdates))throw new Error('Invalid update preference');if(!Number.isInteger(value.advisorReservePercent)||value.advisorReservePercent<0||value.advisorReservePercent>50)throw new Error('Advisor reserve must be a whole percentage from 0 to 50');
    const quiet=value.quietHours;if(!quiet||typeof quiet!=='object'||Array.isArray(quiet)||Object.keys(quiet).some(k=>!['enabled','start','end'].includes(k))||typeof quiet.enabled!=='boolean'||!CLOCK.test(quiet.start)||!CLOCK.test(quiet.end))throw new Error('Invalid quiet hours');
    value.quietHours={enabled:quiet.enabled,start:quiet.start,end:quiet.end};
    value.globalDailyMs=value.globalDailyBudgetMs;value.objectiveDailyMs=value.objectiveDailyBudgetMs;this.db.prepare('INSERT INTO settings VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET body=excluded.body').run(JSON.stringify(value));return value;});}
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
  recordContextCompaction(id,{compacted,estimatedTokens,budget}) {this.db.prepare('INSERT INTO events(taskId,at,kind,detail) VALUES(?,?,?,?)').run(id,this.now(),'CONTEXT_COMPACTED',JSON.stringify({compacted,estimatedTokens,budget}));}
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
  markExperimentChange(taskId,id,{note,actor},token) {return this.transaction(()=>{
    this.assertRunnable(taskId,token);
    const experiment=this.experiment(taskId,id);
    if(experiment.status!=='BASELINE')throw new Error('The change for this experiment is already recorded');
    Object.assign(experiment,{status:'CHANGED',changeAt:this.now(),changeNote:String(note||'').slice(0,500),changeActor:String(actor||'Nethra').slice(0,60)});
    this.db.prepare('UPDATE experiments SET body=? WHERE id=?').run(JSON.stringify(experiment),id);
    this.db.prepare('INSERT INTO events(taskId,at,kind,detail) VALUES(?,?,?,?)').run(taskId,this.now(),'EXPERIMENT_CHANGED',JSON.stringify({id,actor:experiment.changeActor}));
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
  update(id,patch,event='UPDATED',leaseToken) {return this.transaction(()=>{this.assertLease(id,leaseToken);const task=this.get(id);if(TERMINAL.has(task.status))throw new Error('Terminal Nethra task is immutable');if(patch.status&&!TRANSITIONS[task.status]?.has(patch.status))throw new Error('Illegal Nethra state transition');if(patch.revision!==undefined&&patch.revision!==task.revision)throw new Error('Nethra revision conflict');if(patch.status&&!STATES.has(patch.status))throw new Error('Invalid Nethra status');const progressed=(Array.isArray(patch.evidence)&&patch.evidence.length>(task.evidence||[]).length)||(Array.isArray(patch.completedSteps)&&patch.completedSteps.length>(task.completedSteps||[]).length);const allowed=['goal','successCriteria','plan','completedSteps','pendingSteps','evidence','status','summary','nextWakeAt','lastExecutionAt','dependencies','requiredApprovals','errors','retryCount','budget','parentId','thinking','nextDirectionCheckAt','lastDirectionAt','lastMilestoneCount','lastMilestoneAt','lastMilestoneEvidenceFingerprint','lastInitiativeProgressAt','lastInitiativeAt','noProgressCycles','wakeReason','lastInferenceFingerprint','lastCycleProgressed','unchangedWakes','codexConsultDay','codexConsultCount'];for(const key of allowed)if(Object.hasOwn(patch,key))task[key]=patch[key];if(progressed)task.lastMeaningfulProgressAt=Math.max(this.now(),(task.lastDirectionAt||0)+1,(task.lastMeaningfulProgressAt||0)+1);return this.save(task,event,patch);});}
  control(id,action,revision,requestId) {return this.transaction(()=>{
    if(!['pause','resume','cancel','wake'].includes(action))throw new Error('Invalid Nethra action');
    if(!requestId)throw new Error('A request ID is required');
    const binding=canonical({id,action,revision}),old=this.db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);
    if(old){const previous=JSON.parse(old.binding);if(previous.id!==id||previous.action!==action)throw new Error('Request payload mismatch');return JSON.parse(old.body);}
    const task=this.get(id);
    if(task.revision!==revision)throw new Error('Nethra revision conflict');
    if(TERMINAL.has(task.status))throw new Error('Task is already finished');
    if(action==='resume'&&['WAITING_FOR_USER','BLOCKED'].includes(task.status))throw new Error(`Cannot resume a ${task.status} objective without resolving its gate`);
    if(action==='wake'){
      // "Check it now": bring a sleeping objective's next wake forward. Gates still apply.
      if(task.status!=='SLEEPING')throw new Error(task.status==='PAUSED'?'Resume this objective first':`A ${task.status} objective cannot be woken early`);
      task.nextWakeAt=this.now();task.wakeReason={kind:'OWNER',detail:'The owner asked Nethra to check now',at:this.now()};task.unchangedWakes=0;task.lastCycleProgressed=null;
      const result=this.save(task,'WAKE_REQUESTED');this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestId,binding,JSON.stringify(result));return result;
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
    if(lease){this.closeInferenceIntervals(lease.token);this.accountUsage(id,this.now()-this.execution(lease.token).startedAt,lease.token);task.budget=this.get(id).budget;this.db.prepare('UPDATE attention SET state=?,leaseToken=NULL WHERE leaseToken=?').run(action==='cancel'?'DONE':'PENDING',lease.token);this.db.prepare('DELETE FROM lease WHERE taskId=?').run(id);}
    const result=this.save(task,action.toUpperCase());this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestId,binding,JSON.stringify(result));return result;
  });}
  recoverInside() {const lease=this.db.prepare('SELECT * FROM lease WHERE singleton=1').get();if(!lease||lease.expiresAt>this.now())return 0;this.closeInferenceIntervals(lease.token);this.accountUsage(lease.taskId,this.now()-this.execution(lease.token).startedAt,lease.token);for(const child of this.children(lease.taskId).filter(c=>c.status==='ACTIVE'&&c.leaseToken===lease.token)){child.status='INTERRUPTED';child.finishedAt=this.now();delete child.leaseToken;this.db.prepare('UPDATE children SET body=? WHERE id=?').run(JSON.stringify(child),child.id);}this.db.prepare('UPDATE attention SET state=\'PENDING\',leaseToken=NULL WHERE leaseToken=?').run(lease.token);this.db.prepare('DELETE FROM lease WHERE singleton=1').run();const task=this.get(lease.taskId);if(['ACTIVE','PLANNING'].includes(task.status)){task.status=task.persistent?'ACTIVE':'PAUSED';task.summary='Interrupted execution recovered from durable checkpoint';this.save(task,'RECOVERED');}return 1;}
  recoverExpired() {return this.transaction(()=>this.recoverInside());}
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
    const total=Math.min(600000,Math.max(0,Math.round(elapsed))),delta=Math.max(0,total-execution.accountedMs);
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
      const total=Math.max(0,Math.min(600000,Math.round((interval.endedAt??this.now())-interval.startedAt))),added=Math.max(0,Math.min(total-interval.accountedMs,600000-execution.accountedMs-delta));
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
    this.closeInferenceIntervals(token);return this.accountUsage(id,0,token);
  });}
  recordUsage(id,elapsed,token) {return this.transaction(()=>this.accountUsage(id,elapsed,token));}
  claim(owner,leaseMs=420000) {return this.transaction(()=>{this.recoverInside();if(this.db.prepare('SELECT 1 FROM lease').get())return null;const settings=this.settings();if(!settings.enabled)return null;const effective=task=>Math.max(1,(task.priority??3)-Math.floor(Math.max(0,this.now()-(task.lastExecutionAt??task.createdAt??this.now()))/3600000));const tasks=this.list().filter(task=>['CREATED','ACTIVE','PLANNING','SLEEPING'].includes(task.status)&&!(task.nextWakeAt>this.now())).sort((a,b)=>effective(a)-effective(b)||(a.lastExecutionAt??0)-(b.lastExecutionAt??0)||(a.createdAt??0)-(b.createdAt??0));for(const task of tasks){if(task.dependencies.some(id=>{try{return this.get(id).status!=='COMPLETED';}catch{return true;}}))continue;const u=this.usage(task.id),limits=dailyLimits(settings);if(u.globalMs>=limits.globalMs||u.taskMs>=limits.taskMs){task.status='SLEEPING';task.nextWakeAt=(u.day+1)*DAY;this.save(task,'BUDGET_WAIT');continue;}const token=randomUUID();this.db.prepare('INSERT INTO lease VALUES(1,?,?,?,?)').run(task.id,token,String(owner),this.now()+leaseMs);this.db.prepare('INSERT INTO executions(token,taskId,startedAt,inferenceOnly) VALUES(?,?,?,1)').run(token,task.id,this.now());this.db.prepare('UPDATE attention SET state=\'CLAIMED\',leaseToken=? WHERE taskId=? AND state=\'PENDING\' AND dueAt<=?').run(token,task.id,this.now());task.status=task.status==='CREATED'?'PLANNING':'ACTIVE';task.lastExecutionAt=this.now();task.nextWakeAt=null;return {task:this.save(task,'CLAIMED',{owner}),token};}return null;});}
  renew(id,token,leaseMs=420000) {return this.transaction(()=>{const changed=this.db.prepare('UPDATE lease SET expiresAt=? WHERE singleton=1 AND taskId=? AND token=? AND expiresAt>?').run(this.now()+leaseMs,id,token,this.now()).changes===1;if(changed)this.accountUsage(id,this.now()-this.execution(token).startedAt,token);return changed;});}
  release(id,token,consumed=true) {return this.transaction(()=>{const lease=this.db.prepare('SELECT * FROM lease WHERE singleton=1 AND taskId=? AND token=?').get(id,token);if(!lease)return false;this.closeInferenceIntervals(token);this.accountUsage(id,this.now()-this.execution(token).startedAt,token);this.db.prepare('UPDATE attention SET state=?,leaseToken=NULL WHERE leaseToken=?').run(consumed?'DONE':'PENDING',token);this.db.prepare('DELETE FROM lease WHERE singleton=1').run();return true;});}
  answer(id,text,revision,requestId) {return this.transaction(()=>{
    if(typeof text!=='string'||!text.trim()||text.length>24000)throw new Error('Invalid owner answer');if(!requestId)throw new Error('A request ID is required');
    const binding=canonical({kind:'answer',id,text,revision}),old=this.db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);if(old){if(old.binding!==binding)throw new Error('Request payload mismatch');return JSON.parse(old.body);}
    const task=this.get(id);if(task.status!=='WAITING_FOR_USER')throw new Error('This objective is not waiting for input');if(task.revision!==revision)throw new Error('Nethra revision conflict');
    const lease=this.db.prepare('SELECT * FROM lease WHERE taskId=?').get(id);if(lease)throw new Error('Task is executing; wait for its checkpoint');
    task.ownerInputs=[...(task.ownerInputs||[]),{text:text.trim(),at:this.now(),requestId}].slice(-100);task.summary=text.trim();task.status='ACTIVE';task.nextWakeAt=null;
    const result=this.save(task,'OWNER_INPUT',{text:text.trim()});this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestId,binding,JSON.stringify(result));return result;
  });}
  /**
   * Owner edits the objective's wording. Like a redirect, verified evidence and completed
   * steps stay, the remaining plan is dropped, and pending approvals are superseded.
   */
  edit(id,changes,revision,requestId) {
    if(!changes||typeof changes!=='object'||Array.isArray(changes)||Object.keys(changes).some(key=>!['goal','successCriteria'].includes(key))||!Object.keys(changes).length)throw new Error('Edit the goal or success criteria');
    for(const [key,value] of Object.entries(changes))if(typeof value!=='string'||(key==='goal'&&!value.trim())||value.length>24000)throw new Error(`Invalid ${key}`);
    return this.transaction(()=>{
      if(!requestId)throw new Error('A request ID is required');
      const binding=canonical({kind:'edit',id,changes,revision}),old=this.db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);if(old){if(old.binding!==binding)throw new Error('Request payload mismatch');return JSON.parse(old.body);}
      let task=this.get(id);if(TERMINAL.has(task.status))throw new Error('Task is already finished');if(task.revision!==revision)throw new Error('Nethra revision conflict');
      this.fenceInside(id);task=this.get(id);
      const superseded=this.supersedeApprovalsInside(id);
      const before={goal:task.goal,successCriteria:task.successCriteria};
      if(changes.goal!==undefined)task.goal=changes.goal.trim();
      if(changes.successCriteria!==undefined)task.successCriteria=changes.successCriteria.trim()||task.goal;
      task.ownerInputs=[...(task.ownerInputs||[]),{text:`Objective edited. Now: ${task.goal}${task.successCriteria&&task.successCriteria!==task.goal?` (success: ${task.successCriteria})`:''}`,at:this.now(),requestId,kind:'redirect'}].slice(-100);
      task.plan=[...(task.completedSteps||[])];task.pendingSteps=[];task.redirectedAt=this.now();task.noProgressCycles=0;task.unchangedWakes=0;task.lastCycleProgressed=null;task.wakeReason=null;
      if(task.status!=='PAUSED'){task.status='ACTIVE';task.nextWakeAt=null;}
      const result=this.save(task,'EDITED',{before,after:{goal:task.goal,successCriteria:task.successCriteria},supersededApprovals:superseded});this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestId,binding,JSON.stringify(result));return result;
    });
  }
  /**
   * An owner message in the objective's chat. It joins the objective's inputs (so the next
   * wake sees it and an identical-input skip cannot ignore it) and wakes a sleeping objective.
   */
  note(id,text) {return this.transaction(()=>{
    if(typeof text!=='string'||!text.trim()||text.length>4000)throw new Error('Invalid note');
    const task=this.get(id);if(TERMINAL.has(task.status))return task;
    task.ownerInputs=[...(task.ownerInputs||[]),{text:text.trim(),at:this.now(),kind:'note'}].slice(-100);
    if(task.status==='SLEEPING'&&task.mode!=='ONGOING'||task.status==='SLEEPING'&&task.continuous){task.nextWakeAt=Math.min(task.nextWakeAt??Infinity,this.now()+15_000);task.wakeReason={kind:'OWNER',detail:'You added a note in the task chat',at:task.nextWakeAt};}
    task.unchangedWakes=0;
    return this.save(task,'OWNER_NOTE',{text:text.trim().slice(0,500)});
  });}
  /**
   * Deletes an objective and its journal, approvals, attention, receipts and workspace drafts.
   * A running step is fenced first. The linked chat is kept as an ordinary conversation.
   */
  remove(id,requestId) {
    if(!requestId)throw new Error('A request ID is required');
    let workspace=null;
    const result=this.transaction(()=>{
      const old=this.db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);
      if(old){if(old.binding!==canonical({kind:'remove',id}))throw new Error('Request payload mismatch');return JSON.parse(old.body);}
      const task=this.get(id);workspace=task.workspace;
      this.fenceInside(id);
      this.db.prepare('DELETE FROM attention WHERE taskId=?').run(id);
      this.db.prepare('DELETE FROM approvals WHERE taskId=?').run(id);
      for(const row of this.db.prepare('SELECT actionKey,body FROM actions').all())if(JSON.parse(row.body).taskId===id)this.db.prepare('DELETE FROM actions WHERE actionKey=?').run(row.actionKey);
      this.db.prepare('DELETE FROM children WHERE parentId=?').run(id);
      this.db.prepare('DELETE FROM experiments WHERE taskId=?').run(id);
      this.db.prepare('DELETE FROM events WHERE taskId=?').run(id);
      this.db.prepare('DELETE FROM tasks WHERE id=?').run(id);
      for(const other of this.list())if((other.dependencies||[]).includes(id)){other.dependencies=other.dependencies.filter(dep=>dep!==id);this.save(other,'DEPENDENCY_REMOVED',{id});}
      const body={deleted:true,id,goal:task.goal,conversationId:task.conversationId||null};
      this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestId,canonical({kind:'remove',id}),JSON.stringify(body));return body;
    });
    // Only a workspace inside this store's own directory is ever removed.
    const root=path.join(this.directory,'workspaces');
    if(workspace&&path.resolve(workspace).startsWith(root+path.sep))try{fs.rmSync(workspace,{recursive:true,force:true});}catch{}
    return result;
  }
  fenceInside(id) {
    const lease=this.db.prepare('SELECT * FROM lease WHERE taskId=?').get(id);if(!lease)return false;
    this.closeInferenceIntervals(lease.token);this.accountUsage(id,this.now()-this.execution(lease.token).startedAt,lease.token);
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
  redirect(id,instruction,revision,requestId) {return this.transaction(()=>{
    if(typeof instruction!=='string'||!instruction.trim()||instruction.length>4000)throw new Error('Provide a bounded new direction');if(!requestId)throw new Error('A request ID is required');
    const binding=canonical({kind:'redirect',id,instruction,revision}),old=this.db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);if(old){if(old.binding!==binding)throw new Error('Request payload mismatch');return JSON.parse(old.body);}
    let task=this.get(id);if(TERMINAL.has(task.status))throw new Error('Task is already finished');if(task.revision!==revision)throw new Error('Nethra revision conflict');
    const lease=this.db.prepare('SELECT * FROM lease WHERE taskId=?').get(id);
    if(lease){this.closeInferenceIntervals(lease.token);this.accountUsage(id,this.now()-this.execution(lease.token).startedAt,lease.token);this.db.prepare("UPDATE attention SET state='PENDING',leaseToken=NULL WHERE leaseToken=?").run(lease.token);this.db.prepare('DELETE FROM lease WHERE taskId=?').run(id);task=this.get(id);}
    const superseded=[];
    for(const approval of this.approvals(id).filter(item=>item.status==='PENDING')){approval.status='SUPERSEDED';approval.decidedAt=this.now();this.saveApproval(approval);superseded.push(approval.id);}
    task.ownerInputs=[...(task.ownerInputs||[]),{text:instruction.trim(),at:this.now(),requestId,kind:'redirect'}].slice(-100);
    task.plan=[...(task.completedSteps||[])];task.pendingSteps=[];task.status='ACTIVE';task.nextWakeAt=null;task.wakeReason=null;task.noProgressCycles=0;task.unchangedWakes=0;task.lastCycleProgressed=null;task.redirectedAt=this.now();
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
    if(old){if(old.binding!==binding)throw new Error('Request payload mismatch');return JSON.parse(old.body);}
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
    if(old){if(old.binding!==binding)throw new Error('Action payload mismatch');return JSON.parse(old.body);}
    const receipt={key,taskId,tool,args,status:'RESERVED',result:null,createdAt:this.now()};this.db.prepare('INSERT INTO actions VALUES(?,?,?)').run(key,binding,JSON.stringify(receipt));return receipt;
  }
  reserveAction(taskId,key,tool,args,token) {return this.transaction(()=>this.reserveActionInside(taskId,key,tool,args,token));}
  getAction(key) {const row=this.db.prepare('SELECT body FROM actions WHERE actionKey=?').get(key);return row?JSON.parse(row.body):null;}
  actions(taskId) {return this.db.prepare('SELECT body FROM actions').all().map(row=>JSON.parse(row.body)).filter(action=>action.taskId===taskId);}
  finishAction(key,result,token) {return this.transaction(()=>{const receipt=this.getAction(key);if(!receipt)throw new Error('Unknown action');this.assertRunnable(receipt.taskId,token);if(receipt.status==='COMPLETED')return receipt;receipt.status='COMPLETED';receipt.result=result;receipt.finishedAt=this.now();this.db.prepare('UPDATE actions SET body=? WHERE actionKey=?').run(JSON.stringify(receipt),key);return receipt;});}
  children(parentId) {return this.db.prepare('SELECT body FROM children WHERE parentId=? ORDER BY rowid').all(parentId).map(row=>JSON.parse(row.body));}
  startChild(parentId,scope,runId,token) {return this.transaction(()=>{
    this.assertRunnable(parentId,token);
    if(typeof scope!=='string'||!scope.trim()||scope.length>1500||typeof runId!=='string'||!runId)throw Error('Invalid child scope');
    const prior=this.children(parentId);
    if(prior.some(child=>child.status==='ACTIVE'))throw Error('Child work must be sequential');
    if(prior.filter(child=>child.runId===runId).length>=2)throw Error('Child delegation budget exhausted');
    const child={id:randomUUID(),parentId,runId,scope,model:'qwen3:30b',status:'ACTIVE',allowedTools:['web_search','read_file','list_directory'],maxIterations:4,maxToolCalls:2,depth:1,startedAt:this.now(),result:null,leaseToken:token};
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
