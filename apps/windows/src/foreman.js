"use strict";
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const ACTIVE = new Set(['RUNNING', 'WAITING_CODEX', 'VERIFYING']);
const text = (value, max, label) => { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${label}`); return value.trim(); };

/** Durable work is not permission to execute: activation lives only in this process. */
class Foreman {
  constructor(directory, { executor, now = Date.now, audit = () => {} } = {}) {
    this.directory = directory; this.executor = executor; this.now = now; this.audit = audit;
    this.enabled = new Set(); this.jobs = new Map(); this.timers = new Map(); this.closed = false;
    this.operations = new Map();
    fs.mkdirSync(directory, {recursive:true});
    this.lastBackup=0;
    this.db = new DatabaseSync(path.join(directory,'foreman.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    if (this.db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Foreman database is damaged; restore a backup.');
    const version=this.db.prepare('PRAGMA user_version').get().user_version;
    if(version>1) throw new Error('Foreman database requires a newer Junction.');
    this.db.exec('CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, project TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL); CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY, binding TEXT NOT NULL); PRAGMA user_version=1;');
    for (const p of this.list()) if (ACTIVE.has(p.status)) { p.status='PAUSED'; p.nextAction='Resume explicitly to reconcile interrupted work'; this.save(p,'RECOVERED','Application reopened; execution remains paused'); }
  }
  list() { return this.db.prepare('SELECT body FROM projects ORDER BY rowid DESC').all().map(r=>JSON.parse(r.body)); }
  get(id) { const r=this.db.prepare('SELECT body FROM projects WHERE id=?').get(id); if(!r)throw new Error('Unknown project');return JSON.parse(r.body); }
  save(p,kind,detail,receipt=null) {
    p.revision++; p.updatedAt=this.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO projects VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(p.id,JSON.stringify(p));
      this.db.prepare('INSERT INTO events(project,at,kind,detail) VALUES(?,?,?,?)').run(p.id,p.updatedAt,kind,String(detail).slice(0,4000));
      if(receipt)this.db.prepare('INSERT INTO receipts VALUES(?,?)').run(receipt.id,receipt.binding);
      this.db.exec('COMMIT');
    } catch(e){this.db.exec('ROLLBACK');this.enabled.delete(p.id);this.jobs.get(p.id)?.controller.abort();throw e;}
    try{this.audit({event:'foreman',projectId:p.id,kind,detail:String(detail).slice(0,500)});}catch{}
    try{if(this.now()-this.lastBackup>60000){this.db.exec('PRAGMA wal_checkpoint(FULL)');const temp=path.join(this.directory,'foreman.backup.tmp');fs.copyFileSync(path.join(this.directory,'foreman.sqlite'),temp);const fd=fs.openSync(temp,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,path.join(this.directory,'foreman.backup.sqlite'));this.lastBackup=this.now();}}catch(error){try{this.audit({event:'foreman_backup_failed',detail:error.message});}catch{}}
    return structuredClone(p);
  }
  events(id,after=0) { return this.db.prepare('SELECT * FROM events WHERE project=? AND seq>? ORDER BY seq LIMIT 50').all(id,after); }
  async create(input) {
    if(this.closed)throw new Error('Junction is quitting');
    if(this.list().length>=50)throw new Error('Project limit reached');
    const name=text(input.name,80,'project name'),objective=text(input.objective,12000,'objective');
    if(!Array.isArray(input.tasks)||!input.tasks.length||input.tasks.length>50)throw new Error('Provide 1–50 concrete tasks');
    const tasks=input.tasks.map(t=>({id:crypto.randomUUID(),title:text(t.title,240,'task'),kind:t.kind==='verify'?'verify':'codex',acceptance:text(t.acceptance,4000,'acceptance criteria'),status:'QUEUED',attempts:[],files:Array.isArray(t.files)?t.files.slice(0,30):[]}));
    const inspected=await this.executor.inspect(input);
    if(inspected.scopeFile)for(const task of tasks)if(!task.files.length)task.files=[inspected.scopeFile];
    if(this.closed)throw new Error('Junction is quitting');
    const p={id:crypto.randomUUID(),name,objective,repoPath:input.repoPath,conversationId:input.conversationId||null,verification:inspected.verification||input.verification||[],...inspected,revision:0,status:'DRAFT',tasks,activeTask:null,roadmap:tasks.map(t=>t.title),decisions:[],questions:[],handoff:'No work started',nextAction:'Waiting for an owner instruction',retryAt:null,createdAt:this.now()};
    return this.save(p,'CREATED','Owner objective registered; waiting for Start');
  }
  async submit(input) {
    if(this.closed)throw new Error('Junction is quitting');
    if(input.projectId){
      const p=this.get(input.projectId);const title=text(input.task,240,'task'),acceptance=text(input.acceptance||'Complete the owner request and pass the detected project checks',4000,'acceptance criteria');
      if(p.tasks.length>=50)throw new Error('Work queue limit reached');
      const queued={id:crypto.randomUUID(),title,kind:'codex',acceptance,status:'QUEUED',attempts:[],files:[]};
      if(p.status==='DRAFT'&&p.tasks.every(task=>!task.attempts.length)){p.tasks=[queued];p.roadmap=[title];p.objective=input.objective||title;p.conversationId=input.conversationId||p.conversationId;}else{p.tasks.push(queued);p.roadmap.push(title);}p.nextAction='Execute the next owner-requested task';
      if(!this.enabled.has(p.id)&&!this.jobs.has(p.id)){p.status='RUNNING';this.enabled.add(p.id);}
      this.save(p,'OWNER_INSTRUCTION',title);this.kick(p.id);return this.get(p.id);
    }
    const created=await this.create({...input,objective:input.objective||input.task,tasks:[{title:input.task,kind:'codex',acceptance:input.acceptance||'Complete the owner request and pass the detected project checks'}]});
    return this.control(created.id,'start',created.revision,`owner-${crypto.randomUUID()}`);
  }
  async control(id,action,revision,requestId) {
    if(this.operations.has(id))throw new Error('Project review/apply is finishing; retry after it completes');
    text(requestId,160,'request ID');
    const binding=JSON.stringify([id,action,revision]);
    const previous=this.db.prepare('SELECT binding FROM receipts WHERE id=?').get(requestId);
    if(previous){if(previous.binding!==binding)throw new Error('Request ID reused');return this.get(id);}
    const p=this.get(id);
    if(!Number.isSafeInteger(revision)||p.revision!==revision)throw new Error('Stale task revision; refresh first');
    if(!['start','resume','pause','stop'].includes(action))throw new Error('Invalid task control');
    if(action==='start'||action==='resume') {
      if(this.closed)throw new Error('Junction is quitting');
      if(ACTIVE.has(p.status)||p.status==='COMPLETED'||this.jobs.has(id))throw new Error('Task is already active or finishing');
      if(action==='start'&&p.status!=='DRAFT')throw new Error('Use Resume for existing work');
      if(this.enabled.size)throw new Error('Pause the active project before starting another');
      p.status='RUNNING';p.nextAction='Reconcile and execute next approved task';
      this.save(p,'RESUMED',`Owner selected ${action}`,{id:requestId,binding});this.enabled.add(id);this.kick(id);
    }else{
      this.enabled.delete(id);clearTimeout(this.timers.get(id));this.timers.delete(id);
      const interrupted=p.tasks.find(t=>t.status==='RUNNING');if(interrupted){interrupted.status='QUEUED';if(interrupted.attempts.length)interrupted.attempts.at(-1).status='INTERRUPTED';}
      p.status=action==='stop'?'STOPPED':'PAUSED';p.nextAction='Resume explicitly';
      try{this.save(p,action.toUpperCase(),'Preserving progress and interrupting current work',{id:requestId,binding});}finally{this.jobs.get(id)?.controller.abort();}
    }
    return this.get(id);
  }
  kick(id) {
    if(!this.enabled.has(id)||this.jobs.has(id)||this.closed)return;
    const controller=new AbortController();const job={controller,promise:null};this.jobs.set(id,job);
    job.promise=this.step(id,controller.signal).catch(e=>{this.enabled.delete(id);try{const p=this.get(id);p.status='BLOCKED';p.nextAction='Resolve storage/runtime error';this.save(p,'ERROR',e.message);}catch{}}).finally(()=>{this.jobs.delete(id);if(this.enabled.has(id)&&!this.timers.has(id))this.kick(id);});
  }
  async step(id,signal) {
    let p=this.get(id);
    if(p.retryAt>this.now()){this.schedule(id,p.retryAt);return;}
    const task=p.tasks.find(t=>t.status!=='COMPLETED');
    if(!task){p.status='COMPLETED';p.activeTask=null;p.nextAction='Review verified changes';this.enabled.delete(id);this.save(p,'COMPLETED','All approved tasks verified');return;}
    p.activeTask=task.id;p.status='RUNNING';p.retryAt=null;task.status='RUNNING';
    const attempt={id:crypto.randomUUID(),startedAt:this.now(),status:'RUNNING'};task.attempts.push(attempt);
    this.save(p,'ATTEMPT',`${task.kind}: ${task.title}`);
    const checkpoint=fields=>{if(signal.aborted||!this.enabled.has(id))return;const current=this.get(id),t=current.tasks.find(t=>t.id===task.id);Object.assign(t.attempts.at(-1),fields);if(fields.worktree)current.worktree=fields.worktree;if(fields.branch)current.branch=fields.branch;this.save(current,'CHECKPOINT',fields.summary||'Execution checkpoint saved');};
    try {
      const result=await this.executor.run(p,task,{signal,checkpoint});
      if(signal.aborted||!this.enabled.has(id))return;
      p=this.get(id);const t=p.tasks.find(t=>t.id===task.id);
      if(!Array.isArray(result.tests)||!result.tests.length||result.tests.some(t=>t.exitCode!==0))throw new Error('Verification failed; candidate retained for inspection');
      const promoted=await this.executor.promoteVerified?.(p,result);
      t.status='COMPLETED';Object.assign(t.attempts.at(-1),result,{status:'COMPLETED',finishedAt:this.now(),promoted});
      p.verifiedSha=result.headSha;if(promoted?.sourceHash)p.sourceHash=promoted.sourceHash;p.lastBackup=promoted?.backup||p.lastBackup;p.handoff=result.summary||task.title;p.nextAction='Next owner instruction';this.save(p,'VERIFIED',p.handoff);
    }catch(error){
      if(signal.aborted||!this.enabled.has(id))return;
      p=this.get(id);const t=p.tasks.find(t=>t.id===task.id);t.status='QUEUED';Object.assign(t.attempts.at(-1),{status:'FAILED',error:String(error.message).slice(0,4000),finishedAt:this.now()});
      const retry=Number.isFinite(error.retryAt)?error.retryAt:null;
      if(retry){p.status='WAITING_CODEX';p.retryAt=Math.max(this.now()+1000,retry);p.nextAction='Wait for legitimate Codex availability';this.save(p,'WAITING',error.message);this.schedule(id,p.retryAt);}
      else{p.status='BLOCKED';p.nextAction='Review failure and Resume when resolved';p.handoff=`${task.title}: ${error.message}`;this.enabled.delete(id);this.save(p,'BLOCKED',p.handoff);}
    }
  }
  schedule(id,at){clearTimeout(this.timers.get(id));const timer=setTimeout(()=>{this.timers.delete(id);this.kick(id);},Math.min(2147483647,Math.max(1,at-this.now())));timer.unref?.();this.timers.set(id,timer);}
  async idle(){await Promise.all([...this.jobs.values()].map(j=>j.promise));if(this.jobs.size)return this.idle();}
  async shutdown(){this.closed=true;for(const id of [...this.enabled]){const p=this.get(id);await this.control(id,'pause',p.revision,crypto.randomUUID());}await this.executor.stop?.();await this.idle();await Promise.allSettled([...this.operations.values()]);}
  close(){this.closed=true;for(const t of this.timers.values())clearTimeout(t);this.timers.clear();this.enabled.clear();for(const j of this.jobs.values())j.controller.abort();this.db.close();}
}
module.exports={Foreman};
