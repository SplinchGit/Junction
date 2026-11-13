"use strict";
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {measurableAcceptance}=require('./nethra-code-work');
const {readApprovedDocument}=require('./foreman-documents');
const { DatabaseSync } = require('node:sqlite');
const ACTIVE = new Set(['RUNNING', 'WAITING_CODEX', 'WAITING_CAPACITY', 'VERIFYING']);
const text = (value, max, label) => { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${label}`); return value.trim(); };
const CONTEXT_ID = /^[A-Za-z0-9_-]{1,160}$/;
const CONTEXT_LIMIT = 16;

function projectContext(project) {
  return {
    conversationIds: project.conversationIds || [],
    decisions: project.decisions || [],
    questions: project.questions || []
  };
}

function documentMetadata({id,revision,name,sha256,importedAt}) { return {id,revision,name,sha256,importedAt}; }

function authorizedCapacityWait(project) {
  return project.status==='WAITING_CAPACITY'&&project.autoHandoff===true&&
    project.tasks.find(task=>task.status!=='COMPLETED')?.kind==='codex';
}

function waitingProvider(project) {
  return project.tasks.find(task=>task.id===project.activeTask)?.attempts.at(-1)?.provider||'Codex or Claude';
}

/** Only authorized capacity waits carry activation across restart. */
class Foreman {
  constructor(directory, { executor, now = Date.now, audit = () => {}, mayDispatch = () => true } = {}) {
    this.directory = directory; this.executor = executor; this.now = now; this.audit = audit; this.mayDispatch=mayDispatch;
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
    this.db.exec(`CREATE TABLE IF NOT EXISTS project_documents(
      project TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,source TEXT NOT NULL,sourceKey TEXT NOT NULL,
      name TEXT NOT NULL,sha256 TEXT NOT NULL,content TEXT NOT NULL,importedAt INTEGER NOT NULL,
      PRIMARY KEY(project,id,revision)
    )`);
    for (const p of this.list()) {
      if(!ACTIVE.has(p.status))continue;
      const status=p.status;
      const unchanged=current=>current.revision===p.revision&&current.status===status;
      if(authorizedCapacityWait(p)&&!this.enabled.size){
        p.nextAction='Recheck provider capacity on the saved schedule';
        const restored=current=>unchanged(current)&&authorizedCapacityWait(current);
        if(this.save(p,'RECOVERED',`${waitingProvider(p)}: capacity wait restored. ${p.nextAction}.`,null,null,restored)){
          this.enabled.add(p.id);
          this.schedule(p.id,p.retryAt||this.now());
        }
      }else{
        p.status='PAUSED';p.nextAction='Resume explicitly to reconcile interrupted work';
        const detail=status==='WAITING_CAPACITY'&&p.autoHandoff!==true
          ?`${waitingProvider(p)}: saved provider authorization is missing. ${p.nextAction}.`
          :'Application reopened; execution remains paused';
        this.save(p,'RECOVERED',detail,null,null,unchanged);
      }
    }
  }
  list() { return this.db.prepare('SELECT body FROM projects ORDER BY rowid DESC').all().map(r=>JSON.parse(r.body)); }
  find(id) { const r=this.db.prepare('SELECT body FROM projects WHERE id=?').get(id); return r?JSON.parse(r.body):null; }
  get(id) { const project=this.find(id);if(!project)throw new Error('Unknown project');return project; }
  save(p,kind,detail,receipt=null,writeExtra=null,guard=null) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if(guard&&!guard(this.get(p.id))){this.db.exec('ROLLBACK');return null;}
      p.revision++; p.updatedAt=this.now();
      this.db.prepare('INSERT INTO projects VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(p.id,JSON.stringify(p));
      this.db.prepare('INSERT INTO events(project,at,kind,detail) VALUES(?,?,?,?)').run(p.id,p.updatedAt,kind,String(detail).slice(0,4000));
      writeExtra?.();
      if(receipt)this.db.prepare('INSERT INTO receipts VALUES(?,?)').run(receipt.id,receipt.binding);
      this.db.exec('COMMIT');
    } catch(e){this.db.exec('ROLLBACK');this.enabled.delete(p.id);this.jobs.get(p.id)?.controller.abort();throw e;}
    try{this.audit({event:'foreman',projectId:p.id,kind,detail:String(detail).slice(0,500)});}catch{}
    try{if(this.now()-this.lastBackup>60000){this.db.exec('PRAGMA wal_checkpoint(FULL)');const temp=path.join(this.directory,'foreman.backup.tmp');fs.copyFileSync(path.join(this.directory,'foreman.sqlite'),temp);const fd=fs.openSync(temp,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,path.join(this.directory,'foreman.backup.sqlite'));this.lastBackup=this.now();}}catch(error){try{this.audit({event:'foreman_backup_failed',detail:error.message});}catch{}}
    return structuredClone(p);
  }
  events(id,after=0) { return this.db.prepare('SELECT * FROM events WHERE project=? AND seq>? ORDER BY seq LIMIT 50').all(id,after); }
  listDocuments(id, query='') {
    this.get(id);
    if(typeof query!=='string'||query.length>120)throw new Error('Invalid document search');
    const term=query.trim();
    return this.db.prepare(`SELECT id,revision,name,sha256,importedAt FROM project_documents AS doc
      WHERE project=? AND revision=(SELECT MAX(revision) FROM project_documents WHERE project=doc.project AND id=doc.id)
      ${term?'AND (instr(lower(content),lower(?))>0 OR instr(lower(name),lower(?))>0)':''}
      ORDER BY importedAt DESC, rowid DESC`).all(id,...(term?[term,term]:[])).map(documentMetadata);
  }
  getDocument(id, documentId, revision) {
    this.get(id);
    if(typeof documentId!=='string'||!CONTEXT_ID.test(documentId))throw new Error('Invalid document ID');
    if(revision!==undefined&&(!Number.isSafeInteger(revision)||revision<1))throw new Error('Invalid document revision');
    const row=this.db.prepare(`SELECT id,revision,name,sha256,importedAt,source,content FROM project_documents
      WHERE project=? AND id=? AND (? IS NULL OR revision=?) ORDER BY revision DESC LIMIT 1`).get(id,documentId,revision??null,revision??null);
    if(!row)throw new Error('Project document not found');
    return {...documentMetadata(row),source:row.source,content:row.content};
  }
  documentImportReceipt(id, requestId) {
    text(requestId,160,'request ID');
    const previous=this.db.prepare('SELECT binding FROM receipts WHERE id=?').get(requestId);
    if(!previous)return null;
    const [type,project,documentId,revision]=JSON.parse(previous.binding);
    if(type!=='project.document.import'||project!==id)throw new Error('Request ID reused');
    return documentMetadata(this.getDocument(id,documentId,revision));
  }
  async importDocument(id, requestId, selectedPath) {
    if(this.closed)throw new Error('Junction is quitting');
    const replay=this.documentImportReceipt(id,requestId);
    if(replay)return replay;
    this.get(id);
    if(this.jobs.has(id)||this.operations.has(id))throw new Error('Wait for current project work or review to finish before importing');
    const document=await readApprovedDocument(selectedPath);
    if(this.closed)throw new Error('Junction is quitting');
    const project=this.get(id);
    if(this.jobs.has(id)||this.operations.has(id))throw new Error('Wait for current project work or review to finish before importing');
    const previous=this.db.prepare('SELECT * FROM project_documents WHERE project=? AND sourceKey=? ORDER BY revision DESC LIMIT 1').get(id,document.sourceKey);
    const sameContent=previous?.sha256===document.sha256;
    if(!sameContent&&this.db.prepare('SELECT COUNT(*) AS total FROM project_documents WHERE project=?').get(id).total>=64)throw new Error('Project document revision limit reached');
    const row=sameContent?previous:{...document,id:previous?.id||crypto.randomUUID(),revision:(previous?.revision||0)+1,importedAt:this.now()};
    const receipt={id:requestId,binding:JSON.stringify(['project.document.import',id,row.id,row.revision])};
    if(sameContent)this.db.prepare('INSERT INTO receipts VALUES(?,?)').run(receipt.id,receipt.binding);
    else this.save(project,'DOCUMENT_IMPORTED',`Saved document revision ${row.revision}`,receipt,()=>{
      this.db.prepare('INSERT INTO project_documents VALUES(?,?,?,?,?,?,?,?,?)').run(id,row.id,row.revision,row.source,row.sourceKey,row.name,row.sha256,row.content,row.importedAt);
    });
    return documentMetadata(row);
  }
  removeDocument(id, documentId, revision, requestId) {
    text(requestId,160,'request ID');
    if(!Number.isSafeInteger(revision)||revision<1)throw new Error('Invalid document revision');
    const binding=JSON.stringify(['project.document.remove',id,documentId,revision]);
    const previous=this.db.prepare('SELECT binding FROM receipts WHERE id=?').get(requestId);
    if(previous){if(previous.binding!==binding)throw new Error('Request ID reused');return;}
    const project=this.get(id);
    if(this.jobs.has(id)||this.operations.has(id))throw new Error('Wait for current project work or review to finish before removing documents');
    if(this.getDocument(id,documentId).revision!==revision)throw new Error('Stale document revision; refresh first');
    this.save(project,'DOCUMENT_REMOVED','Owner removed the document and all saved revisions',{id:requestId,binding},()=>{
      this.db.prepare('DELETE FROM project_documents WHERE project=? AND id=?').run(id,documentId);
    });
  }
  updateContext(change, requestId, conversationExists) {
    if(this.closed)throw new Error('Junction is quitting');
    text(requestId,160,'request ID');
    if(!change||typeof change!=='object'||Array.isArray(change))throw new Error('Invalid project context change');
    const {id,revision,kind,action,key}=change;
    if(typeof id!=='string'||!CONTEXT_ID.test(id))throw new Error('Invalid project ID');
    if(!['conversation','decision','question'].includes(kind))throw new Error('Invalid project context kind');
    const actions=kind==='conversation'?['link','remove']:['save','remove'];
    if(!actions.includes(action))throw new Error('Invalid project context action');
    const fields=['id','revision','kind','action','key'];
    if(action==='save')fields.push('text');
    if(kind==='question'&&action==='save')fields.push('status');
    if(Object.keys(change).some(field=>!fields.includes(field)))throw new Error('Invalid project context fields');
    if((key!==undefined||action!=='save')&&(typeof key!=='string'||!CONTEXT_ID.test(key)))throw new Error('Invalid project context ID');
    const entryText=action==='save'?text(change.text,400,'project context text'):null;
    const status=kind==='question'&&action==='save'?(change.status??'OPEN'):null;
    if(status!==null&&!['OPEN','RESOLVED'].includes(status))throw new Error('Invalid question status');
    const binding=JSON.stringify(['project.context',id,revision,kind,action,key??null,entryText,status]);
    const previous=this.db.prepare('SELECT binding FROM receipts WHERE id=?').get(requestId);
    if(previous){if(previous.binding!==binding)throw new Error('Request ID reused');return this.get(id);}

    const project=this.get(id);
    if(project.revision!==revision)throw new Error('Stale project revision; refresh first');
    if(this.jobs.has(id)||this.operations.has(id))throw new Error('Wait for current project work or review to finish before editing context');
    const context=projectContext(project);
    if(kind==='conversation'){
      if(action==='link'){
        if(!conversationExists(key))throw new Error('Conversation not found');
        if(project.conversationId!==key&&!context.conversationIds.includes(key)){
          if(context.conversationIds.length>=CONTEXT_LIMIT)throw new Error('Project conversation link limit reached');
          context.conversationIds.push(key);
        }
      }else{
        if(!context.conversationIds.includes(key))throw new Error('Unknown project conversation link');
        context.conversationIds=context.conversationIds.filter(id=>id!==key);
      }
    }else{
      const entries=kind==='decision'?context.decisions:context.questions;
      const index=key===undefined?-1:entries.findIndex(entry=>entry.id===key);
      if(key!==undefined&&index<0)throw new Error('Unknown project context entry');
      if(action==='remove')entries.splice(index,1);
      else {
        const now=this.now();
        if(index<0&&entries.length>=CONTEXT_LIMIT)throw new Error('Project context entry limit reached');
        const current=entries[index];
        const entry={id:current?.id||crypto.randomUUID(),text:entryText,source:'owner',createdAt:current?.createdAt??now,updatedAt:now};
        if(status!==null)entry.status=status;
        if(index<0)entries.push(entry);
        else entries[index]=entry;
      }
    }
    Object.assign(project,context);
    return this.save(project,'CONTEXT_UPDATED',`${kind} ${action}`,{id:requestId,binding});
  }
  async create(input) {
    if(this.closed)throw new Error('Junction is quitting');
    if(this.list().length>=50)throw new Error('Project limit reached');
    const name=text(input.name,80,'project name'),objective=text(input.objective,12000,'objective');
    if(!Array.isArray(input.tasks)||!input.tasks.length||input.tasks.length>50)throw new Error('Provide 1–50 concrete tasks');
    const tasks=input.tasks.map(t=>({id:crypto.randomUUID(),title:text(t.title,240,'task'),kind:t.kind==='verify'?'verify':'codex',acceptance:text(t.acceptance,4000,'acceptance criteria'),status:'QUEUED',attempts:[],files:Array.isArray(t.files)?t.files.slice(0,30):[]}));
    if(input.sharedCheckout!==undefined&&typeof input.sharedCheckout!=='boolean')throw new Error('Invalid shared checkout preference');
    const inspected=await this.executor.inspect(input);
    if(inspected.scopeFile)for(const task of tasks)if(!task.files.length)task.files=[inspected.scopeFile];
    if(this.closed)throw new Error('Junction is quitting');
    const p={id:crypto.randomUUID(),name,objective,sharedCheckout:input.sharedCheckout===true,...(typeof input.coordinationBrief==='string'?{coordinationBrief:input.coordinationBrief.slice(0,700)}:{}),repoPath:input.repoPath,conversationId:input.conversationId||null,sourceObjectiveId:input.sourceObjectiveId||null,codeReviewVerdict:input.sourceObjectiveId&&input.codeReviewVerdict==='READY'?'READY':null,verification:inspected.verification||input.verification||[],...inspected,revision:0,status:'DRAFT',tasks,activeTask:null,roadmap:tasks.map(t=>t.title),decisions:[],questions:[],handoff:'No work started',nextAction:'Waiting for an owner instruction',retryAt:null,createdAt:this.now()};
    return this.save(p,'CREATED','Owner objective registered; waiting for Start');
  }
  async submit(input) {
    if(this.closed)throw new Error('Junction is quitting');
    if(input.projectId){
      const p=this.get(input.projectId);const title=text(input.task,240,'task'),acceptance=text(input.acceptance||'Complete the owner request and pass the detected project checks',4000,'acceptance criteria');
      if(p.sourceObjectiveId)throw new Error('Nethra code work needs a new Codex reviewed draft for a different task');
      if(p.autoHandoff)throw new Error('Create a separate approved draft for a new coding scope');
      if(p.tasks.length>=50)throw new Error('Work queue limit reached');
      const queued={id:crypto.randomUUID(),title,kind:'codex',acceptance,status:'QUEUED',attempts:[],files:[]};
      if(p.status==='DRAFT'&&p.tasks.every(task=>!task.attempts.length)){p.tasks=[queued];p.roadmap=[title];p.objective=input.objective||title;p.conversationId=input.conversationId||p.conversationId;}else{p.tasks.push(queued);p.roadmap.push(title);}p.nextAction='Execute the next owner-requested task';
      if(!this.enabled.has(p.id)&&!this.jobs.has(p.id)){p.status='RUNNING';this.enabled.add(p.id);}
      this.save(p,'OWNER_INSTRUCTION',title);this.kick(p.id);return this.get(p.id);
    }
    const created=await this.create({...input,objective:input.objective||input.task,tasks:[{title:input.task,kind:'codex',acceptance:input.acceptance||'Complete the owner request and pass the detected project checks'}]});
    return this.control(created.id,'start',created.revision,`owner-${crypto.randomUUID()}`);
  }
  async control(id,action,revision,requestId,{autoHandoff,sourceObjectiveId}={}) {
    if(this.operations.has(id))throw new Error('Project review/apply is finishing; retry after it completes');
    text(requestId,160,'request ID');
    const binding=JSON.stringify([id,action,revision,...(autoHandoff===undefined?[]:[autoHandoff])]);
    const previous=this.db.prepare('SELECT binding FROM receipts WHERE id=?').get(requestId);
    if(previous){if(previous.binding!==binding)throw new Error('Request ID reused');return this.get(id);}
    const p=this.get(id);
    if(sourceObjectiveId!==undefined&&sourceObjectiveId!==p.sourceObjectiveId)throw new Error('Invalid linked objective control');
    if(!Number.isSafeInteger(revision)||p.revision!==revision)throw new Error('Stale task revision; refresh first');
    if(!['start','resume','pause','stop','retry'].includes(action))throw new Error('Invalid task control');
    if(action==='retry'){
      if(this.closed||!['WAITING_CAPACITY','WAITING_CODEX'].includes(p.status)||!this.enabled.has(id))throw new Error('Only an active capacity wait can be rechecked; Resume paused work explicitly');
      if(!this.mayDispatch(p))throw new Error('Resume the linked Nethra task first');
      p.retryAt=null;p.nextAction='Checking confirmed provider availability';
      clearTimeout(this.timers.get(id));this.timers.delete(id);
      this.save(p,'CAPACITY_RECHECK','Owner requested a fresh availability check',{id:requestId,binding});this.kick(id);return this.get(id);
    }
    if(action==='start'||action==='resume') {
      if(autoHandoff!==undefined&&typeof autoHandoff!=='boolean')throw new Error('Invalid provider handoff approval');
      if(this.closed)throw new Error('Junction is quitting');
      if(!this.mayDispatch(p))throw new Error('Resume the linked Nethra task first');
        if(p.sourceObjectiveId&&p.codeReviewVerdict!=='READY')throw new Error('A Codex READY verdict for this exact Nethra proposal is required before implementation');
        if(p.sourceObjectiveId&&p.tasks.some(task=>!measurableAcceptance(task.acceptance)))throw new Error('Provide measurable acceptance criteria before starting Nethra code work');
      if(ACTIVE.has(p.status)||p.status==='COMPLETED'||this.jobs.has(id))throw new Error('Task is already active or finishing');
      if(action==='start'&&p.status!=='DRAFT')throw new Error('Use Resume for existing work');
      if(this.enabled.size)throw new Error('Pause the active project before starting another');
      if(autoHandoff===false&&p.autoHandoff)throw new Error('Create a new draft to change an approved provider handoff scope');
      if(autoHandoff===true)p.autoHandoff=true;
      p.status='RUNNING';p.pausedByObjective=null;p.nextAction='Reconcile and execute next approved task';
      this.save(p,'RESUMED',`Owner selected ${action}`,{id:requestId,binding});this.enabled.add(id);this.kick(id);
    }else{
      this.enabled.delete(id);clearTimeout(this.timers.get(id));this.timers.delete(id);
      const interrupted=p.tasks.find(t=>t.status==='RUNNING');if(interrupted){interrupted.status='QUEUED';if(interrupted.attempts.length)Object.assign(interrupted.attempts.at(-1),{status:'INTERRUPTED',finishedAt:this.now()});}
      p.status=action==='stop'?'STOPPED':'PAUSED';p.pausedByObjective=action==='pause'?sourceObjectiveId||null:null;p.nextAction='Resume explicitly';
      try{this.save(p,action.toUpperCase(),'Preserving progress and interrupting current work',{id:requestId,binding});}finally{this.jobs.get(id)?.controller.abort();}
    }
    return this.get(id);
  }
  kick(id) {
    if(!this.enabled.has(id)||this.jobs.has(id)||this.closed)return;
    clearTimeout(this.timers.get(id));this.timers.delete(id);
    const controller=new AbortController();const job={controller,promise:null};this.jobs.set(id,job);
    job.promise=this.step(id,controller.signal).catch(e=>{this.enabled.delete(id);if(controller.signal.aborted)return;try{const p=this.get(id);p.status='BLOCKED';p.nextAction='Resolve storage/runtime error';this.save(p,'ERROR',e.message);}catch{}}).finally(()=>{this.jobs.delete(id);if(this.enabled.has(id)&&!this.timers.has(id))this.kick(id);});
  }
  async step(id,signal) {
    let p=this.get(id);
    if(!ACTIVE.has(p.status)){this.enabled.delete(id);return;}
    const awaitingCapacity=p.status==='WAITING_CAPACITY'&&p.tasks.find(t=>t.status!=='COMPLETED')?.kind==='codex';
    if(awaitingCapacity&&!authorizedCapacityWait(p)){
      this.enabled.delete(id);p.status='PAUSED';p.nextAction='Resume explicitly with provider authorization';
      this.save(p,'PAUSED','Saved provider authorization is missing');return;
    }
    if(!this.mayDispatch(p)){
      this.enabled.delete(id);p.status='PAUSED';p.nextAction='Resume the linked Nethra task first';this.save(p,'PAUSED','Linked Nethra task is paused or stopped');return;
    }
    if(p.retryAt>this.now()){this.schedule(id,p.retryAt);return;}
    const task=p.tasks.find(t=>t.status!=='COMPLETED');
    if(!task){p.status='COMPLETED';p.activeTask=null;p.nextAction=p.sharedCheckout?'Review verified changes in the canonical main checkout; engineering owns the commit':p.sourceObjectiveId||p.autoHandoff?'Review the exact patch in Work Activity, then Apply if approved':'Review verified changes';this.enabled.delete(id);this.save(p,'COMPLETED','All approved tasks verified');return;}
    const revision=p.revision;
    const waitIsCurrent=current=>!this.closed&&!signal.aborted&&this.enabled.has(id)&&
      current.revision===revision&&authorizedCapacityWait(current)&&this.mayDispatch(current);
    const attempt={id:crypto.randomUUID(),startedAt:this.now(),status:'RUNNING'};task.attempts.push(attempt);
    let claimed=false;
    const claimDispatch=provider=>{
      if(claimed||signal.aborted||this.closed)return false;
      p.activeTask=task.id;p.status='RUNNING';p.retryAt=null;task.status='RUNNING';
      if(awaitingCapacity){
        attempt.provider=provider;attempt.activeAt=this.now();
        p.nextAction='Execute and verify the approved task';
      }
      const detail=awaitingCapacity?`${provider}: dispatch claimed. ${p.nextAction}.`:`${task.kind}: ${task.title}`;
      claimed=Boolean(this.save(p,'ATTEMPT',detail,null,null,awaitingCapacity?waitIsCurrent:null));
      return claimed&&!signal.aborted;
    };
    const checkpoint=fields=>{
      if(signal.aborted||!this.enabled.has(id))return;
      const current=claimed?this.get(id):p;
      const a=claimed?current.tasks.find(t=>t.id===task.id).attempts.at(-1):attempt;
      if((fields.provider||fields.phase==='verifying')&&!a.activeAt)a.activeAt=this.now();
      if(fields.tests?.length||fields.engineeringHandoff?.sourceHash)a.lastEvidenceAt=this.now();
      Object.assign(a,fields);
      if(fields.worktree)current.worktree=fields.worktree;
      if(Object.hasOwn(fields,'branch'))current.branch=fields.branch;
      if(claimed)this.save(current,'CHECKPOINT',fields.summary||'Execution checkpoint saved');
    };
    try {
      const result=awaitingCapacity&&this.executor.runCapacityWait
        ?await this.executor.runCapacityWait(p,task,{signal,checkpoint,claimDispatch})
        :claimDispatch(waitingProvider(p))?await this.executor.run(p,task,{signal,checkpoint}):null;
      if(!claimed){
        if(!signal.aborted&&this.get(id).status!=='WAITING_CAPACITY')this.enabled.delete(id);
        return;
      }
      if(signal.aborted||!this.enabled.has(id))return;
      p=this.get(id);const t=p.tasks.find(t=>t.id===task.id);
      if(!Array.isArray(result.tests)||!result.tests.length||result.tests.some(t=>t.exitCode!==0))throw new Error('Verification failed; candidate retained for inspection');
      // Nethra-originated and dual-provider work have a second owner gate: a verified candidate stays
      // in the isolated checkout until the owner reviews and applies that exact patch.
      const promoted=p.sharedCheckout||p.sourceObjectiveId||p.autoHandoff?null:await this.executor.promoteVerified?.(p,result);
      t.status='COMPLETED';Object.assign(t.attempts.at(-1),result,{status:'COMPLETED',finishedAt:this.now(),promoted});
      p.verifiedSha=result.headSha;if(result.sharedSourceHash)p.sharedSourceHash=result.sharedSourceHash;if(promoted?.sourceHash)p.sourceHash=promoted.sourceHash;p.lastBackup=promoted?.backup||p.lastBackup;p.handoff=result.summary||task.title;p.nextAction=p.sharedCheckout?'Review verified changes in the canonical main checkout; engineering owns the commit':p.sourceObjectiveId||p.autoHandoff?'Review the exact patch in Work Activity, then Apply if approved':'Next owner instruction';this.save(p,'VERIFIED',p.handoff);
    }catch(error){
      if(signal.aborted||!this.enabled.has(id))return;
      p=this.get(id);const t=p.tasks.find(t=>t.id===task.id);
      if(claimed){t.status='QUEUED';Object.assign(t.attempts.at(-1),{status:'FAILED',error:String(error.message).slice(0,4000),finishedAt:this.now()});}
      const retry=Number.isFinite(error.retryAt)?error.retryAt:null;
      if(!claimed){
        if(p.status!=='WAITING_CAPACITY'){this.enabled.delete(id);return;}
        if(retry){
          p.retryAt=Math.max(this.now()+1000,retry);
          p.nextAction=error.capacityDetail||'Recheck provider capacity on the saved schedule';
          if(this.save(p,'WAITING',`${waitingProvider(p)}: capacity wait pending. ${p.nextAction}.`,null,null,waitIsCurrent))this.schedule(id,p.retryAt);
        }else{
          const blocked={...p,status:'BLOCKED',nextAction:'Review failure and Resume when resolved',handoff:`${task.title}: ${error.message}`};
          if(this.save(blocked,'BLOCKED',blocked.handoff,null,null,waitIsCurrent))this.enabled.delete(id);
        }
        return;
      }
      if(retry){p.status=p.autoHandoff?'WAITING_CAPACITY':'WAITING_CODEX';p.retryAt=Math.max(this.now()+1000,retry);p.nextAction=error.capacityDetail||'Wait for legitimate Codex availability';this.save(p,'WAITING',error.message);this.schedule(id,p.retryAt);}
      else{p.status='BLOCKED';p.nextAction='Review failure and Resume when resolved';p.handoff=`${task.title}: ${error.message}`;this.enabled.delete(id);this.save(p,'BLOCKED',p.handoff);}
    }
  }
  schedule(id,at){clearTimeout(this.timers.get(id));const timer=setTimeout(()=>{this.timers.delete(id);this.kick(id);},Math.min(2147483647,Math.max(1,at-this.now())));timer.unref?.();this.timers.set(id,timer);}
  async idle(){await Promise.all([...this.jobs.values()].map(j=>j.promise));if(this.jobs.size)return this.idle();}
  async shutdown(){
    this.closed=true;
    for(const id of [...this.enabled]){
      const p=this.get(id);
      if(authorizedCapacityWait(p)){
        this.enabled.delete(id);clearTimeout(this.timers.get(id));this.timers.delete(id);this.jobs.get(id)?.controller.abort();
      }else await this.control(id,'pause',p.revision,crypto.randomUUID());
    }
    await this.executor.stop?.();await this.idle();await Promise.allSettled([...this.operations.values()]);
  }
  close(){this.closed=true;for(const t of this.timers.values())clearTimeout(t);this.timers.clear();this.enabled.clear();for(const j of this.jobs.values())j.controller.abort();this.db.close();}
}
module.exports={Foreman,projectContext};
