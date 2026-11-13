"use strict";
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Foreman}=require('../src/foreman');
const fixture=()=>fs.mkdtempSync(path.join(os.tmpdir(),'junction-foreman-'));
const input={name:'Demo',repoPath:'demo',objective:'Improve the approved demo',tasks:[{title:'Verify baseline',kind:'verify',acceptance:'Existing checks pass'}]};
const executor={inspect:async()=>({baseSha:'abc',baseBranch:'main'}),run:async()=>({headSha:'def',tests:[{exitCode:0}],summary:'Verified'})};

test('shared checkout approval survives persistence and verified work is never promoted',async t=>{
 const dir=fixture();let promoted=false;
 const f=new Foreman(dir,{executor:{...executor,promoteVerified:async()=>{promoted=true;},run:async()=>({headSha:'def',sharedSourceHash:'verified-source',tests:[{exitCode:0}],summary:'Verified'})}});
 t.after(()=>{f.close();fs.rmSync(dir,{recursive:true,force:true});});
 let p=await f.create({...input,sharedCheckout:true});assert.equal(p.sharedCheckout,true);
 await f.control(p.id,'start',p.revision,'start');await f.idle();p=f.get(p.id);
 assert.equal(promoted,false);assert.equal(p.sharedSourceHash,'verified-source');
 assert.match(p.nextAction,/canonical/i);
});

test('owner can recheck capacity after a usage reset without overriding Pause',async t=>{
 const dir=fixture();let available=false,calls=0;
 const f=new Foreman(dir,{executor:{...executor,run:async()=>{calls++;if(!available)throw Object.assign(new Error('capacity'),{retryAt:Date.now()+3600000});return executor.run();}}});
 t.after(()=>{f.close();fs.rmSync(dir,{recursive:true,force:true});});
 let p=await f.create(input);await f.control(p.id,'start',p.revision,'start',{autoHandoff:true});await f.idle();
 p=f.get(p.id);assert.equal(p.status,'WAITING_CAPACITY');available=true;
 await f.control(p.id,'retry',p.revision,'recheck');await f.idle();
 assert.equal(calls,2);assert.equal(f.get(p.id).status,'COMPLETED');
 p=f.get(p.id);await f.control(p.id,'pause',p.revision,'pause');p=f.get(p.id);
 await assert.rejects(f.control(p.id,'retry',p.revision,'retry-paused'),/capacity wait/);
 assert.equal(calls,2);
});
test('abrupt process death leaves interrupted work paused on recovery',()=>{
 const {spawnSync}=require('node:child_process');const dir=fixture();
 const program=`const {Foreman}=require(${JSON.stringify(require.resolve('../src/foreman'))});(async()=>{const f=new Foreman(${JSON.stringify(dir)},{executor:{inspect:async()=>({}),run:()=>new Promise(()=>{})}});const p=await f.create(${JSON.stringify(input)});await f.control(p.id,'start',p.revision,'start');process.exit(0)})()`;
 assert.equal(spawnSync(process.execPath,['-e',program],{encoding:'utf8'}).status,0);
 const f=new Foreman(dir,{executor});assert.equal(f.list()[0].status,'PAUSED');assert.equal(f.enabled.size,0);assert.ok(f.list()[0].tasks[0].attempts.length);f.close();
});
test('creation and reopen never dispatch; completed work and logs persist',async()=>{
 const dir=fixture();let calls=0;const e={...executor,run:async()=>{calls++;return executor.run()}};
 let f=new Foreman(dir,{executor:e});const p=await f.create(input);assert.equal(p.status,'DRAFT');assert.equal(calls,0);
 await f.control(p.id,'start',p.revision,'first');await f.idle();assert.equal(f.get(p.id).status,'COMPLETED');assert.equal(calls,1);f.close();
 f=new Foreman(dir,{executor:e});assert.equal(f.get(p.id).status,'COMPLETED');assert.equal(calls,1);assert.ok(f.events(p.id).length>=3);f.close();
});

test('a Nethra-originated verified candidate stays isolated until owner review and apply',async t=>{
 const dir=fixture();
 const promotions=[];
 const e={...executor,promoteVerified:async project=>{promotions.push(project.id);return {backup:'unexpected-original-checkout-write'};}};
 const f=new Foreman(dir,{executor:e});t.after(()=>{f.close();fs.rmSync(dir,{recursive:true,force:true});});
 const draft=await f.create({...input,sourceObjectiveId:'nethra-task-1',codeReviewVerdict:'READY',tasks:[{...input.tasks[0],acceptance:'Existing checks pass and changes remain isolated until owner review'}]});
 assert.equal(draft.status,'DRAFT');
 await f.control(draft.id,'start',draft.revision,'start-reviewed-proposal');await f.idle();
 const finished=f.get(draft.id);
 assert.equal(finished.status,'COMPLETED');
 assert.equal(finished.verifiedSha,'def');
 assert.equal(finished.lastBackup??null,null);
 assert.match(finished.nextAction,/review.*apply/i);
 assert.deepEqual(promotions,[]);
 const ordinary=await f.create(input);
 await f.control(ordinary.id,'start',ordinary.revision,'ordinary-start');await f.idle();
 assert.deepEqual(promotions,[ordinary.id]);
});
test('a Nethra draft with a vague acceptance cannot be started',async t=>{
 const dir=fixture(),f=new Foreman(dir,{executor});t.after(()=>{f.close();fs.rmSync(dir,{recursive:true,force:true});});
 const draft=await f.create({...input,sourceObjectiveId:'nethra-task-1',codeReviewVerdict:'READY',tasks:[{title:'Refactor context',kind:'codex',acceptance:'Yes'}]});
 await assert.rejects(f.control(draft.id,'start',draft.revision,'start-vague'),/measurable acceptance/i);
 assert.equal(f.get(draft.id).status,'DRAFT');
});
test('a Nethra draft without a ready Codex verdict cannot be started',async t=>{
 const dir=fixture(),f=new Foreman(dir,{executor});t.after(()=>{f.close();fs.rmSync(dir,{recursive:true,force:true});});
 const draft=await f.create({...input,sourceObjectiveId:'nethra-task-1',tasks:[{...input.tasks[0],acceptance:'Existing checks pass and changes remain isolated until owner review'}]});
 await assert.rejects(f.control(draft.id,'start',draft.revision,'start-unreviewed'),/Codex.*READY/i);
 assert.equal(f.get(draft.id).status,'DRAFT');
});
test('adding work cannot replace a reviewed Nethra proposal',async t=>{
 const dir=fixture(),f=new Foreman(dir,{executor});t.after(()=>{f.close();fs.rmSync(dir,{recursive:true,force:true});});
 const draft=await f.create({...input,sourceObjectiveId:'nethra-task-1',codeReviewVerdict:'READY',tasks:[{...input.tasks[0],acceptance:'Existing checks pass and changes remain isolated until owner review'}]});
 await assert.rejects(f.submit({projectId:draft.id,task:'Different work',acceptance:'Different tests pass with evidence'}),/new Codex reviewed draft/i);
 assert.equal(f.get(draft.id).tasks.length,1);
});
test('pause during work fences late success; explicit resume required after reopen',async()=>{
 const dir=fixture();let finish;const f=new Foreman(dir,{executor:{...executor,run:()=>new Promise(r=>finish=r)}});const p=await f.create(input);
 await f.control(p.id,'start',p.revision,'s');await new Promise(r=>setImmediate(r));
 await f.control(p.id,'pause',f.get(p.id).revision,'p');finish(await executor.run());await f.idle();assert.equal(f.get(p.id).status,'PAUSED');assert.notEqual(f.get(p.id).tasks[0].status,'COMPLETED');f.close();
 const next=new Foreman(dir,{executor});assert.equal(next.get(p.id).status,'PAUSED');next.close();
});
test('controls are idempotent, stale revisions rejected and stop preserves context',async()=>{
 const f=new Foreman(fixture(),{executor});const p=await f.create(input);
 await f.control(p.id,'stop',p.revision,'x');await f.control(p.id,'stop',p.revision,'x');
 await assert.rejects(f.control(p.id,'resume',p.revision,'y'),/stale/i);assert.equal(f.get(p.id).status,'STOPPED');assert.equal(f.get(p.id).objective,input.objective);f.close();
});
test('capacity wait is durable but reboot does not schedule it',async()=>{
 const dir=fixture();const e={...executor,run:async()=>{throw Object.assign(new Error('rate limit'),{retryAt:Date.now()+600000})}};
 const f=new Foreman(dir,{executor:e});const p=await f.create(input);await f.control(p.id,'start',p.revision,'s');await f.idle();assert.equal(f.get(p.id).status,'WAITING_CODEX');f.close();
 const next=new Foreman(dir,{executor:e});assert.equal(next.get(p.id).status,'PAUSED');assert.ok(next.get(p.id).retryAt>Date.now());next.close();
});
test('failed verification cannot complete; corruption never resets state',async()=>{
 const dir=fixture();const f=new Foreman(dir,{executor:{...executor,run:async()=>({tests:[{exitCode:1}],summary:'failed'})}});const p=await f.create(input);await f.control(p.id,'start',p.revision,'s');await f.idle();assert.equal(f.get(p.id).status,'BLOCKED');f.close();
 fs.writeFileSync(path.join(dir,'foreman.sqlite'),'corrupt');assert.throws(()=>new Foreman(dir,{executor}));
});
test('backup failure cannot prevent Pause from aborting active work',async()=>{
 const dir=fixture();let now=100000,aborted=false;
 const e={...executor,run:(_p,_t,{signal})=>new Promise(resolve=>signal.addEventListener('abort',()=>{aborted=true;resolve({headSha:'late',tests:[{exitCode:0}],summary:'late'});},{once:true}))};
 const f=new Foreman(dir,{executor:e,now:()=>now});const p=await f.create(input);await f.control(p.id,'start',p.revision,'start');await new Promise(resolve=>setImmediate(resolve));
 now+=61000;fs.mkdirSync(path.join(dir,'foreman.backup.tmp'));await f.control(p.id,'pause',f.get(p.id).revision,'pause');await f.idle();
 assert.equal(aborted,true);assert.equal(f.get(p.id).status,'PAUSED');f.close();
});
test('an owner chat instruction starts new work immediately and later instructions queue in context',async()=>{
 const dir=fixture();let finish;const e={...executor,run:()=>new Promise(resolve=>finish=resolve)};const f=new Foreman(dir,{executor:e});
 const p=await f.submit({name:'Civlets',repoPath:'demo',objective:'Fix Civlets',conversationId:'chat',task:'Fix the build',acceptance:'The requested change is verified'});
 assert.equal(f.get(p.id).status,'RUNNING');assert.ok(f.enabled.has(p.id));
 await f.submit({projectId:p.id,task:'Then improve the scene',acceptance:'The follow-up is verified'});
 assert.equal(f.get(p.id).tasks.length,2);
 await f.control(p.id,'stop',f.get(p.id).revision,'stop-chat');finish({headSha:'late',tests:[{exitCode:0}],summary:'late'});await f.idle();
 assert.equal(f.get(p.id).status,'STOPPED');f.close();
});

test('dual-provider approval is desktop-only, durable, and retains owner apply',async t=>{
 const dir=fixture();
 let promoted=false;
 const f=new Foreman(dir,{executor:{...executor,promoteVerified:async()=>{promoted=true;}}});
 t.after(()=>{f.close();fs.rmSync(dir,{recursive:true,force:true});});
 const api=new (require('../src/foreman-api').ForemanApi)(f);
 const draft=await f.create(input);
 const approval={id:draft.id,revision:draft.revision,action:'start',autoHandoff:true};
 await assert.rejects(api.dispatch('task.control',approval,'mobile-start','android'),/on Windows/);
 assert.equal(f.get(draft.id).status,'DRAFT');
 await api.dispatch('task.control',approval,'owner-start','desktop');
 await f.idle();
 await api.dispatch('task.control',approval,'owner-start','desktop');
 const result=f.get(draft.id);
 assert.equal(result.autoHandoff,true);
 assert.equal(result.status,'COMPLETED');
 assert.equal(result.tasks[0].attempts.length,1);
 assert.equal(promoted,false);
 assert.match(result.nextAction,/review.*apply/i);
});

test('a reviewed shared Nethra draft stays queued for an engineering session',async t=>{
 const dir=fixture();
 const f=new Foreman(dir,{executor});
 t.after(()=>{f.close();fs.rmSync(dir,{recursive:true,force:true});});
 const api=new (require('../src/foreman-api').ForemanApi)(f);
 const draft=await f.create({...input,sharedCheckout:true,sourceObjectiveId:'self-improvement',codeReviewVerdict:'READY',tasks:[{...input.tasks[0],acceptance:'Run the existing checks and verify all exit codes are zero.'}]});
 const payload={id:draft.id,revision:draft.revision,action:'start',autoHandoff:true};
 await assert.rejects(api.dispatch('task.control',{...payload,action:'resume'},'mobile-resume','android'),/on Windows/);
 await assert.rejects(api.dispatch('task.control',payload,'paired-start','android'),/engineering session/);
 assert.equal(f.get(draft.id).status,'DRAFT');
 assert.equal(f.get(draft.id).tasks[0].attempts.length,0);
});

const settle=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('Pause and Stop cancel a pending capacity retry and Resume continues the same approved work',async t=>{
 for(const action of ['pause','stop']){
  const dir=fixture();let calls=0,available=false;
  const f=new Foreman(dir,{executor:{...executor,run:async()=>{calls++;if(!available)throw Object.assign(new Error('capacity'),{retryAt:Date.now()+40});return executor.run();}}});
  t.after(()=>{f.close();fs.rmSync(dir,{recursive:true,force:true});});
  let p=await f.create(input);await f.control(p.id,'start',p.revision,'start',{autoHandoff:true});await f.idle();
  p=f.get(p.id);assert.equal(p.status,'WAITING_CAPACITY');assert.equal(calls,1);
  await f.control(p.id,action,p.revision,action);
  available=true;await settle(1100);await f.idle();
  assert.equal(calls,1,`${action} must cancel the scheduled retry`);
  p=f.get(p.id);assert.equal(p.status,action==='stop'?'STOPPED':'PAUSED');assert.equal(f.timers.size,0);
  const task=p.tasks[0].id;
  await f.control(p.id,'resume',p.revision,'resume');await f.idle();p=f.get(p.id);
  assert.equal(p.status,'COMPLETED');assert.equal(p.tasks.length,1);assert.equal(p.tasks[0].id,task);
  assert.equal(p.tasks[0].attempts.length,2);assert.equal(p.autoHandoff,true);
 }
});

test('Stop racing a capacity recheck wins and fences the late provider result',async t=>{
 const dir=fixture();let calls=0,finish;
 const f=new Foreman(dir,{executor:{...executor,run:()=>{calls++;if(calls===1)return Promise.reject(Object.assign(new Error('capacity'),{retryAt:Date.now()+3600000}));return new Promise(resolve=>finish=resolve);}}});
 t.after(()=>{f.close();fs.rmSync(dir,{recursive:true,force:true});});
 let p=await f.create(input);await f.control(p.id,'start',p.revision,'start',{autoHandoff:true});await f.idle();p=f.get(p.id);
 await f.control(p.id,'retry',p.revision,'recheck');
 assert.equal(calls,2);p=f.get(p.id);
 await f.control(p.id,'stop',p.revision,'stop');
 finish(await executor.run());await f.idle();p=f.get(p.id);
 assert.equal(p.status,'STOPPED');assert.notEqual(p.tasks[0].status,'COMPLETED');assert.equal(p.verifiedSha,undefined);
 assert.equal(p.tasks[0].attempts.at(-1).status,'INTERRUPTED');
 assert.equal(f.enabled.size,0);assert.equal(f.timers.size,0);
});

test('a provider hold is shown to the owner once however many rechecks it takes',async t=>{
 const dir=fixture();let waits=0;
 const wait=()=>Object.assign(new Error('capacity'),{retryAt:Date.now()+3600000,capacityDetail:'Waiting for confirmed provider capacity'});
 const f=new Foreman(dir,{executor:{...executor,run:async()=>{throw wait();},runCapacityWait:async(p,task,{claimDispatch})=>{if(++waits<3)throw wait();claimDispatch('claude');return executor.run();}}});
 t.after(()=>{f.close();fs.rmSync(dir,{recursive:true,force:true});});
 let p=await f.create({...input,tasks:[{title:'Change it',kind:'codex',acceptance:'Checks pass'}]});
 await f.control(p.id,'start',p.revision,'start',{autoHandoff:true});await f.idle();p=f.get(p.id);
 assert.equal(p.status,'WAITING_CAPACITY');const hold=p.capacityHoldAt;assert.ok(hold);
 for(const key of ['recheck-1','recheck-2']){await f.control(p.id,'retry',p.revision,key);await f.idle();p=f.get(p.id);assert.equal(p.status,'WAITING_CAPACITY');assert.equal(p.capacityHoldAt,hold);}
 assert.equal(waits,2);
 assert.equal(f.pendingActivity(p.id).filter(event=>event.kind==='WAITING').length,1);
 assert.equal(f.events(p.id).filter(event=>event.kind==='WAITING_RECHECK').length,2);
 await f.control(p.id,'retry',p.revision,'recheck-3');await f.idle();p=f.get(p.id);
 assert.equal(p.status,'COMPLETED');assert.equal(p.capacityHoldAt,undefined);
});

test('duplicate start, recheck and wake requests dispatch the provider once',async t=>{
 const dir=fixture();let calls=0,release;
 const f=new Foreman(dir,{executor:{...executor,run:async()=>{calls++;if(calls===1)throw Object.assign(new Error('capacity'),{retryAt:Date.now()+3600000});await new Promise(resolve=>release=resolve);return executor.run();}}});
 t.after(()=>{f.close();fs.rmSync(dir,{recursive:true,force:true});});
 let p=await f.create(input);
 await f.control(p.id,'start',p.revision,'start',{autoHandoff:true});
 // A replayed request (lost acknowledgement) and a second Start while active change nothing.
 await f.control(p.id,'start',p.revision,'start',{autoHandoff:true});
 await assert.rejects(f.control(p.id,'start',f.get(p.id).revision,'start-again',{autoHandoff:true}),/already active/);
 await f.idle();assert.equal(calls,1);p=f.get(p.id);assert.equal(p.status,'WAITING_CAPACITY');
 await f.control(p.id,'retry',p.revision,'recheck');await f.control(p.id,'retry',p.revision,'recheck');
 f.kick(p.id);f.kick(p.id);
 await assert.rejects(f.control(p.id,'retry',f.get(p.id).revision,'recheck-running'),/capacity wait/);
 assert.equal(calls,2);release();await f.idle();
 assert.equal(calls,2);p=f.get(p.id);assert.equal(p.status,'COMPLETED');assert.equal(p.tasks[0].attempts.length,2);
});

test('restart keeps provider, checkpoint, tests and next action; Resume continues that work after a reset',async t=>{
 const dir=fixture();const reset=Date.now()+7200000;let calls=0;
 const run=async(p,task,{checkpoint})=>{
  calls++;
  if(calls===1){
   checkpoint({provider:'codex',threadId:'thread-1',summary:'Codex implementing the approved task'});
   checkpoint({tests:[{command:['npm','test'],exitCode:1,output:'1 failing'}],summary:'Verification 1/1: exit 1'});
   checkpoint({engineeringHandoff:{base:'abc',head:'abc',sourceHash:'hash-1',changed:['src/a.js'],untracked:[],summary:'Next: fix the failing assertion in src/a.js',verification:'Pending on the candidate',codexRetryAt:reset},summary:'Codex handoff saved'});
   throw Object.assign(new Error('Waiting for confirmed provider capacity'),{retryAt:reset,capacityDetail:'Waiting for confirmed provider capacity'});
  }
  assert.equal(task.attempts.at(-2).engineeringHandoff.sourceHash,'hash-1');
  return executor.run();
 };
 let f=new Foreman(dir,{executor:{...executor,run}});
 t.after(()=>{f.close();fs.rmSync(dir,{recursive:true,force:true});});
 let p=await f.create(input);await f.control(p.id,'start',p.revision,'start',{autoHandoff:true});await f.idle();
 assert.equal(f.get(p.id).retryAt,reset);f.close();
 f=new Foreman(dir,{executor:{...executor,run}});p=f.get(p.id);
 // Launch never dispatches; the saved handoff is intact for whoever resumes.
 assert.equal(p.status,'PAUSED');assert.equal(f.enabled.size,0);assert.equal(f.timers.size,0);assert.equal(p.retryAt,reset);assert.equal(p.autoHandoff,true);
 const saved=p.tasks[0].attempts[0];
 assert.equal(saved.provider,'codex');assert.equal(saved.threadId,'thread-1');assert.equal(saved.tests[0].exitCode,1);
 assert.match(saved.engineeringHandoff.summary,/fix the failing assertion/);assert.deepEqual(saved.engineeringHandoff.changed,['src/a.js']);
 assert.match(p.nextAction,/reconcile interrupted work/i);
 // Resuming before the confirmed reset waits for it instead of assuming capacity.
 await f.control(p.id,'resume',p.revision,'resume');await f.idle();
 assert.equal(calls,1);assert.equal(f.timers.size,1);
 p=f.get(p.id);p.retryAt=Date.now()-1;f.save(p,'TEST','reset passed');f.kick(p.id);
 clearTimeout(f.timers.get(p.id));f.timers.delete(p.id);f.kick(p.id);await f.idle();
 p=f.get(p.id);assert.equal(calls,2);assert.equal(p.status,'COMPLETED');assert.equal(p.tasks[0].attempts.length,2);
});

test('a capacity wait that ends after the linked task was paused or redirected does not dispatch',async t=>{
 const dir=fixture();let calls=0,allowed=true;
 const f=new Foreman(dir,{mayDispatch:()=>allowed,executor:{...executor,run:async()=>{calls++;throw Object.assign(new Error('capacity'),{retryAt:Date.now()+30});}}});
 t.after(()=>{f.close();fs.rmSync(dir,{recursive:true,force:true});});
 let p=await f.create(input);await f.control(p.id,'start',p.revision,'start',{autoHandoff:true});await f.idle();
 allowed=false;await settle(1100);await f.idle();p=f.get(p.id);
 assert.equal(calls,1);assert.equal(p.status,'PAUSED');assert.match(p.nextAction,/linked Nethra task/);assert.equal(f.enabled.size,0);
 await assert.rejects(f.control(p.id,'resume',p.revision,'resume'),/linked Nethra task/);
 await assert.rejects(f.control(p.id,'retry',p.revision,'retry'),/capacity wait/);
 assert.equal(calls,1);
});

test('Tasks status reports provider, last verified work, blocker and next check from the saved record',async t=>{
 const {codeWorkSummary}=require('../src/nethra-work-status');
 const dir=fixture();let mode='verify';
 const f=new Foreman(dir,{executor:{...executor,run:async(p,task,{checkpoint})=>{
  checkpoint({provider:'claude',summary:'Claude continuing the scoped candidate'});
  if(mode==='wait')throw Object.assign(new Error('capacity'),{retryAt:Date.now()+3600000,capacityDetail:'Waiting for confirmed provider capacity'});
  if(mode==='fail')throw new Error('Verification failed: npm test');
  return {headSha:'def',tests:[{exitCode:0}],summary:'Show next wake: 1 verification commands passed. Checkpoint def.'};
 }}});
 t.after(()=>{f.close();fs.rmSync(dir,{recursive:true,force:true});});
 let p=await f.create({...input,tasks:[{title:'Show next wake',kind:'codex',acceptance:'The next wake is visible in task detail'},{title:'Show blocker',kind:'codex',acceptance:'The blocker is visible in task detail'}]});
 assert.deepEqual(codeWorkSummary(p),{id:p.id,status:'DRAFT',nextAction:'Waiting for an owner instruction',provider:null,phase:null,retryAt:null,lastVerified:null,blocker:null});
 await f.control(p.id,'start',p.revision,'start',{autoHandoff:true});
 mode='wait';await settle(20);
 while(f.get(p.id).status!=='WAITING_CAPACITY')await settle(10);
 let view=codeWorkSummary(f.get(p.id));
 assert.equal(view.provider,'claude');assert.match(view.lastVerified.summary,/Show next wake: 1 verification/);assert.ok(view.lastVerified.at>0);
 assert.equal(view.retryAt,f.get(p.id).retryAt);assert.equal(view.nextAction,'Waiting for confirmed provider capacity');assert.equal(view.blocker,null);
 mode='fail';p=f.get(p.id);await f.control(p.id,'retry',p.revision,'recheck');await f.idle();
 view=codeWorkSummary(f.get(p.id));
 assert.equal(view.status,'BLOCKED');assert.match(view.blocker,/Show blocker: Verification failed/);assert.equal(view.retryAt,null);
 assert.match(view.lastVerified.summary,/Show next wake/);
 // A paused record keeps its saved reset but does not present it as a scheduled check.
 assert.equal(codeWorkSummary({...f.get(p.id),status:'PAUSED',retryAt:Date.now()+1000}).retryAt,null);
});
