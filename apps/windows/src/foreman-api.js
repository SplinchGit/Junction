"use strict";
const crypto=require('node:crypto');
function summary(p){return {id:p.id,name:p.name,objective:p.objective.slice(0,1200),status:p.status,revision:p.revision,retryAt:p.retryAt,nextAction:p.nextAction,activeTask:p.activeTask,handoff:p.handoff.slice(-2000),verifiedSha:p.verifiedSha||null,worktree:p.worktree||null,tasks:p.tasks.map(t=>({id:t.id,title:t.title,kind:t.kind,status:t.status,acceptance:t.acceptance.slice(0,600),lastAttempt:t.attempts.length?{...t.attempts.at(-1),tests:t.attempts.at(-1).tests?.map(x=>({exitCode:x.exitCode,command:x.command,output:x.output?.slice(-1500)})),error:t.attempts.at(-1).error?.slice(-2000)}:null}))};}
class ForemanApi{
 constructor(foreman){this.foreman=foreman;}
 async dispatch(type,payload={},requestId=crypto.randomUUID(),source='desktop'){
  const f=this.foreman;if(!f)throw new Error('Project runtime is unavailable');
  if(type==='project.list')return {projects:f.list().map(p=>({id:p.id,name:p.name,status:p.status,revision:p.revision,objective:p.objective.slice(0,500),nextAction:p.nextAction}))};
  if(type==='project.get'){
   const p=summary(f.get(payload.id));const events=f.events(p.id,Number.isSafeInteger(payload.after)?payload.after:0).map(e=>({...e,detail:e.detail.slice(0,500)}));
   // LAN frames stay bounded; detailed execution evidence remains in durable storage.
   p.tasks=p.tasks.slice(-20);for(const t of p.tasks)if(t.lastAttempt)t.lastAttempt.tests=t.lastAttempt.tests?.slice(-3);
   for(const t of p.tasks)if(t.lastAttempt){t.lastAttempt.error=t.lastAttempt.error?.slice(-500);t.lastAttempt.summary=t.lastAttempt.summary?.slice(-500);for(const test of t.lastAttempt.tests||[])test.output=test.output?.slice(-500);}
   const result={project:p,events};while(Buffer.byteLength(JSON.stringify(result))>55000&&events.length)events.pop();
   if(Buffer.byteLength(JSON.stringify(result))>55000)throw new Error('Project detail exceeds transport limit; inspect on Windows');
   return result;
  }
  if(type==='project.register') {if(source!=='desktop')throw new Error('Register project paths on Windows');return {project:summary(await f.create(payload))};}
  if(type==='task.control'){
   if(Object.keys(payload).some(k=>!['id','action','revision'].includes(k)))throw new Error('Invalid control fields');
   const p=await f.control(payload.id,payload.action,payload.revision,requestId);return {id:p.id,status:p.status,revision:p.revision};
  }
  if(type==='task.enqueue'){
   const p=f.get(payload.id);if(p.revision!==payload.revision)throw new Error('Stale task revision');if(f.enabled.has(p.id)||f.jobs.has(p.id))throw new Error('Pause before changing the queue');
   if(p.tasks.length>=50||typeof payload.title!=='string'||!payload.title.trim()||payload.title.length>240||typeof payload.acceptance!=='string'||!payload.acceptance.trim()||payload.acceptance.length>4000)throw new Error('Invalid task');
   p.tasks.push({id:crypto.randomUUID(),title:payload.title.trim(),acceptance:payload.acceptance.trim(),kind:payload.kind==='verify'?'verify':'codex',files:[],status:'QUEUED',attempts:[]});p.roadmap.push(payload.title);p.status='PAUSED';p.nextAction='Resume explicitly';return {project:summary(f.save(p,'TASK_ADDED',payload.title))};
  }
  if(type==='task.review'||type==='task.apply'){
   if(source!=='desktop')throw new Error('Review and apply original-checkout changes on Windows');
   const p=f.get(payload.id);if(f.enabled.has(p.id)||f.jobs.has(p.id))throw new Error('Pause before reviewing changes');
   if(p.revision!==payload.revision)throw new Error('Stale task revision');
   if(type==='task.review'){const r=await f.executor.review(p);p.reviewed={headSha:r.headSha,diffHash:r.diffHash,sourceHash:r.sourceHash};f.save(p,'REVIEWED',r.summary);return {...p.reviewed,summary:r.summary,patch:r.patch.slice(0,200000)};}
   const r=await f.executor.applyReviewed(p);f.save(p,'APPLIED',r.summary);return r;
  }
  throw new Error('Unsupported project operation');
 }
}
module.exports={ForemanApi,summary};
