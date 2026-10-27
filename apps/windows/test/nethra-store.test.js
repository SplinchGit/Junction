'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {NethraStore}=require('../src/nethra-store');
function fixture(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-'));let time=1000000;const stores=[];const open=()=>{const s=new NethraStore(directory,{now:()=>time});stores.push(s);return s;};t.after(()=>{for(const s of stores)try{s.close();}catch{}fs.rmSync(directory,{recursive:true,force:true});});return {open,advance:n=>time+=n,directory};}

test('durable children are bounded, sequential, fenced and never schedulable',t=>{
  const f=fixture(t),s=f.open(),parent=s.create({goal:'Research facts'}),lease=s.claim('worker',100);
  const child=s.startChild(parent.id,'Read the report','run-one',lease.token);
  assert.equal(child.parentId,parent.id);assert.equal(child.model,'qwen3:30b');assert.equal(s.list().length,1);
  assert.throws(()=>s.startChild(parent.id,'Other scope','run-one',lease.token),/sequential/i);
  assert.throws(()=>s.finishChild(child.id,{report:'x',evidence:[],requiresParentReview:true,extra:true},lease.token),/schema/i);
  s.finishChild(child.id,{report:'Found facts',evidence:[],requiresParentReview:true},lease.token);
  assert.equal(f.open().children(parent.id)[0].result.report,'Found facts');
  const second=s.startChild(parent.id,'Read appendix','run-one',lease.token);
  s.finishChild(second.id,{report:'Appendix',evidence:[],requiresParentReview:true},lease.token);
  assert.throws(()=>s.startChild(parent.id,'Third','run-one',lease.token),/budget/i);
  const pending=s.startChild(parent.id,'New run','run-two',lease.token);f.advance(101);s.recoverExpired();
  assert.equal(s.children(parent.id).find(c=>c.id===pending.id).status,'INTERRUPTED');
  assert.throws(()=>s.finishChild(pending.id,{report:'late',evidence:[],requiresParentReview:true},lease.token),/lease|fenced/i);
});
test('a slow 30B wake accounts more than six minutes of actual inference',t=>{
  const f=fixture(t),s=f.open(),task=s.create({goal:'Review a long file'}),claim=s.claim('worker',660000);
  s.beginInference(task.id,claim.token);f.advance(420000);s.endInference(task.id,claim.token);
  assert.equal(s.usage(task.id).taskMs,420000);
  s.release(task.id,claim.token);
});
test('stored thinking preference migrates to the 30B always-on contract',t=>{
  const f=fixture(t),s=f.open();
  assert.equal(s.settings().thinking,true);
  assert.throws(()=>s.setSettings({thinking:false}),/always uses thinking/);
  const task=s.create({goal:'Review evidence'});
  assert.equal(task.thinking,true);
});
test('objective quotas bound storage and active scheduler work while preserving retries',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-quota-'));const store=new NethraStore(dir,{maxObjectives:2,maxRunnableObjectives:1});t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const first=store.create({goal:'First',requestId:'first'});
  assert.equal(store.create({goal:'First',requestId:'first'}).id,first.id);
  assert.throws(()=>store.create({goal:'Second'}),/active objective limit/i);
  store.control(first.id,'pause',first.revision,'pause-first');
  store.create({goal:'Second'});
  assert.throws(()=>store.create({goal:'Third'}),/storage limit/i);
});
test('reopening preserves checkpoints and event order',t=>{const f=fixture(t),s=f.open(),a=s.create({goal:'Inspect sources'});s.update(a.id,{plan:['inspect'],evidence:['found source']});s.close();const r=f.open();assert.deepEqual(r.get(a.id).evidence,['found source']);assert.deepEqual(r.events(a.id).map(e=>e.kind),['CREATED','UPDATED']);});
test('reopening preserves the exact pending review as task working context',t=>{
  const f=fixture(t),s=f.open(),task=s.create({goal:'Improve prompt context'});
  const checkpoint={activeHypothesis:'Trim prompt assembly',lastReview:{verdict:'REVISE',feedback:'Measure serialization separately; keep prompt bytes identical.',proposal:'Trim prompt assembly',acceptance:'Pass the prompt parity tests',reviewedBy:'Codex'}};
  s.update(task.id,{contextCheckpoint:checkpoint});s.close();
  assert.deepEqual(f.open().get(task.id).contextCheckpoint,checkpoint);
});
test('an owner redirect clears a review tied to the superseded proposal',t=>{
  const f=fixture(t),s=f.open(),task=s.create({goal:'Improve prompt context'});
  const reviewed=s.update(task.id,{contextCheckpoint:{lastReview:{verdict:'REVISE',proposal:'Old optimisation',feedback:'Needs a baseline'}}});
  const redirected=s.redirect(task.id,'Focus on task reliability instead',reviewed.revision,'redirect-context');
  assert.deepEqual(redirected.contextCheckpoint,{});
});
test('editing objective success criteria clears an obsolete working review',t=>{
  const f=fixture(t),s=f.open(),task=s.create({goal:'Improve prompt context'});
  const reviewed=s.update(task.id,{contextCheckpoint:{lastReview:{verdict:'REVISE',proposal:'Old optimisation',feedback:'Needs a baseline'}}});
  const edited=s.edit(task.id,{successCriteria:'Improve task reliability'},reviewed.revision,'edit-context');
  assert.deepEqual(edited.contextCheckpoint,{});
});
test('measured prompt size is journaled without prompt text',t=>{
  const f=fixture(t),s=f.open(),task=s.create({goal:'Inspect context'});
  s.recordContextMeasurement(task.id,{estimatedTokens:900,actualTokens:812,budget:6400});
  const event=f.open().events(task.id).at(-1);
  assert.equal(event.kind,'CONTEXT_MEASURED');
  assert.deepEqual(event.detail,{estimatedTokens:900,actualTokens:812,budget:6400});
});
test('database lease excludes another process and fences expired workers',t=>{const f=fixture(t),s=f.open(),r=f.open(),a=s.create({goal:'One'});s.create({goal:'Two'});const c=s.claim('a',100);assert.equal(r.claim('b',100),null);f.advance(101);assert.equal(r.recoverExpired(),1);const next=r.claim('b',100);assert.ok(next);assert.throws(()=>s.update(c.task.id,{summary:'stale'},'UPDATED',c.token),/lease/i);assert.equal(s.renew(a.id,c.token,100),false);});
test('control requests are idempotent and revisions reject stale clients',t=>{const f=fixture(t),s=f.open(),a=s.create({goal:'One'});const p=s.control(a.id,'pause',a.revision,'request-1');assert.equal(p.status,'PAUSED');assert.deepEqual(s.control(a.id,'pause',a.revision,'request-1'),p);assert.throws(()=>s.control(a.id,'resume',a.revision,'request-2'),/revision/i);assert.throws(()=>s.control(a.id,'cancel',p.revision,'request-1'),/request/i);});
test('resume cannot bypass a rejected approval or an unanswered owner question',t=>{
  const f=fixture(t),s=f.open(),a=s.create({goal:'Protected work'});
  const approval=s.requestApproval(a.id,{tool:'write_draft',args:{path:'draft.txt',content:'new'},category:'LOCAL_WRITE',key:'protected-write'});
  s.decideApproval(approval.id,false,'reject-write');
  const blocked=s.get(a.id);assert.equal(blocked.status,'BLOCKED');
  assert.throws(()=>s.control(a.id,'resume',blocked.revision,'resume-blocked'),/blocked|cannot resume/i);
  const paused=s.control(a.id,'pause',blocked.revision,'pause-blocked');
  const restored=s.control(a.id,'resume',paused.revision,'resume-paused-blocked');
  assert.equal(restored.status,'BLOCKED');assert.equal(s.claim('worker'),null);
  const question=s.create({goal:'Ask owner'});const waiting=s.update(question.id,{status:'WAITING_FOR_USER'});
  assert.throws(()=>s.control(question.id,'resume',waiting.revision,'resume-waiting'),/waiting|cannot resume/i);
  const held=s.control(question.id,'pause',waiting.revision,'pause-waiting');
  assert.equal(s.control(question.id,'resume',held.revision,'restore-waiting').status,'WAITING_FOR_USER');
  const approvalQuestion=s.create({goal:'Approval while paused'});
  const pending=s.requestApproval(approvalQuestion.id,{tool:'write_draft',args:{path:'draft.txt',content:'new'},category:'LOCAL_WRITE',key:'paused-write'});
  const pausedPending=s.control(approvalQuestion.id,'pause',s.get(approvalQuestion.id).revision,'pause-pending');
  s.decideApproval(pending.id,true,'approve-paused');
  assert.equal(s.control(approvalQuestion.id,'resume',s.get(approvalQuestion.id).revision,'resume-approved').status,'ACTIVE');
});
test('approval binds immutable payload and can be consumed only once across reopen',t=>{const f=fixture(t),s=f.open(),a=s.create({goal:'One'});const approval=s.requestApproval(a.id,{tool:'send',args:{to:'alice'},category:'external',key:'send-one'});assert.equal(s.get(a.id).status,'WAITING_FOR_USER');assert.throws(()=>s.requestApproval(a.id,{tool:'send',args:{to:'bob'},category:'external',key:'send-one'}),/payload/i);s.decideApproval(approval.id,true,'approve-one');assert.equal(s.get(a.id).status,'ACTIVE');s.close();const r=f.open();assert.equal(r.consumeApproval(approval.id).status,'CONSUMED');assert.equal(r.consumeApproval(approval.id),null);assert.throws(()=>r.decideApproval(approval.id,false,'other'),/decided/i);});
test('action reservation prevents replay and rejects payload substitution',t=>{const f=fixture(t),s=f.open(),a=s.create({goal:'One'});const r=s.reserveAction(a.id,'action-1','write',{path:'a'});assert.equal(r.status,'RESERVED');assert.deepEqual(s.reserveAction(a.id,'action-1','write',{path:'a'}),r);assert.throws(()=>s.reserveAction(a.id,'action-1','write',{path:'b'}),/payload/i);s.finishAction('action-1',{ok:true});assert.equal(f.open().getAction('action-1').status,'COMPLETED');});
test('mobile create retries cannot duplicate an objective or substitute its goal',t=>{const f=fixture(t),s=f.open();s.setSettings({thinking:true});const a=s.create({goal:'One',requestId:'mobile-one'});assert.equal(a.thinking,true);assert.equal(s.create({goal:'One',requestId:'mobile-one'}).id,a.id);assert.equal(s.list().length,1);assert.throws(()=>s.create({goal:'Two',requestId:'mobile-one'}),/payload/i);});
test('crashed execution and pause are charged once against durable daily budgets',t=>{const f=fixture(t),s=f.open(),a=s.create({goal:'One'}),c=s.claim('a',100);s.beginInference(a.id,c.token);f.advance(101);s.close();const r=f.open();r.recoverExpired();assert.equal(r.get(a.id).budget.totalMs,101);r.recordUsage(a.id,101,c.token);assert.equal(r.get(a.id).budget.totalMs,101);const next=r.claim('b',100);r.beginInference(a.id,next.token);f.advance(30);const live=r.get(next.task.id);r.control(live.id,'pause',live.revision,'pause-budget');assert.equal(r.get(a.id).budget.totalMs,131);});
test('inference heartbeat accounts time without flooding events or invalidating owner revision',t=>{
  const f=fixture(t),s=f.open(),task=s.create({goal:'Long running objective'}),claim=s.claim('worker',10_000);
  s.beginInference(task.id,claim.token);
  const revision=claim.task.revision,eventCount=s.events(task.id).length;
  for(let i=0;i<8;i++){f.advance(1000);assert.equal(s.renew(task.id,claim.token,10_000),true);}
  assert.equal(s.get(task.id).budget.totalMs,8000);
  assert.equal(s.get(task.id).revision,revision);
  assert.equal(s.events(task.id).length,eventCount);
  const reopened=f.open();assert.equal(reopened.get(task.id).budget.totalMs,8000);
  reopened.control(task.id,'pause',revision,'pause-after-heartbeats');
  assert.equal(reopened.get(task.id).status,'PAUSED');
});
test('owner answers preserve progress and are deduplicated',t=>{const f=fixture(t),s=f.open(),a=s.create({goal:'One'});s.update(a.id,{status:'WAITING_FOR_USER',completedSteps:['first']});const live=s.get(a.id);const answered=s.answer(a.id,'Use source A',live.revision,'answer-one');assert.deepEqual(answered.completedSteps,['first']);assert.equal(answered.ownerInputs[0].text,'Use source A');assert.equal(answered.status,'ACTIVE');assert.deepEqual(s.answer(a.id,'Use source A',live.revision,'answer-one'),answered);});
test('a process exiting without cleanup leaves a durable lease and checkpoint',t=>{const f=fixture(t),modulePath=require.resolve('../src/nethra-store');const child=spawnSync(process.execPath,['-e',`const {NethraStore}=require(${JSON.stringify(modulePath)});const s=new NethraStore(process.argv[1],{now:()=>1000000});const t=s.create({goal:'Crash recovery'});const c=s.claim('crashing-child',100);s.update(t.id,{evidence:['durable evidence']},'CHECKPOINT',c.token);process.stdout.write(t.id);process.exit(0);`,f.directory],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);const s=f.open(),id=child.stdout;assert.equal(s.claim('parent'),null);assert.deepEqual(s.get(id).evidence,['durable evidence']);f.advance(101);assert.equal(s.claim('parent').task.id,id);});
test('expired approvals never authorize an action',t=>{const f=fixture(t),s=f.open(),a=s.create({goal:'One'});const p=s.requestApproval(a.id,{tool:'send',args:{text:'hello'},category:'external',key:'expiry'});s.decideApproval(p.id,true,'approve-expiry');f.advance(86400001);assert.equal(s.consumeApproval(p.id),null);assert.equal(s.approvals(a.id)[0].status,'EXPIRED');});
test('approval of one action cannot wake a task with another outstanding approval',t=>{const f=fixture(t),s=f.open(),a=s.create({goal:'One'});const one=s.requestApproval(a.id,{tool:'send',args:{n:1},category:'external',key:'one'}),two=s.requestApproval(a.id,{tool:'send',args:{n:2},category:'external',key:'two'});s.decideApproval(one.id,true,'approve-first');assert.equal(s.get(a.id).status,'WAITING_FOR_USER');s.decideApproval(two.id,true,'approve-second');assert.equal(s.get(a.id).status,'ACTIVE');});
test('terminal objectives cannot be resurrected by stale checkpoints',t=>{const f=fixture(t),s=f.open(),a=s.create({goal:'One'});s.control(a.id,'cancel',a.revision,'cancel');assert.throws(()=>s.update(a.id,{status:'ACTIVE'}),/terminal|transition/i);assert.throws(()=>s.update(a.id,{summary:'late completion'}),/terminal|transition/i);});
test('paused objectives cannot consume approvals or reserve actions',t=>{const f=fixture(t),s=f.open(),a=s.create({goal:'One'});const p=s.requestApproval(a.id,{tool:'send',args:{text:'hi'},category:'external',key:'pause'});s.decideApproval(p.id,true,'approve-pause');const live=s.get(a.id);s.control(a.id,'pause',live.revision,'pause');assert.throws(()=>s.consumeApproval(p.id),/paused|inactive/i);assert.throws(()=>s.reserveAction(a.id,'paused-send','send',{}),/paused|inactive/i);});
test('actions fence stale workers after a lease takeover',t=>{const f=fixture(t),s=f.open(),a=s.create({goal:'One'}),c=s.claim('worker',100);f.advance(101);s.recoverExpired();s.claim('replacement');assert.throws(()=>s.reserveAction(a.id,'stale','write',{},c.token),/lease/i);});

test('approval consumption atomically reserves its exact action across restart',t=>{
  const f=fixture(t),s=f.open(),task=s.create({goal:'Save draft'});
  const approval=s.requestApproval(task.id,{tool:'write_draft',args:{path:'draft.md',content:'new'},category:'LOCAL_WRITE',key:'atomic'});
  s.decideApproval(approval.id,true,'approve-atomic');s.consumeApproval(approval.id);s.close();
  const reopened=f.open();assert.equal(reopened.approval(approval.id).status,'CONSUMED');
  assert.equal(reopened.getAction('atomic')?.status,'RESERVED');
  assert.deepEqual(reopened.getAction('atomic').args,{path:'draft.md',content:'new'});
});

test('a reservation conflict rolls back approval consumption',t=>{
  const f=fixture(t),s=f.open(),task=s.create({goal:'Save draft'});
  const approval=s.requestApproval(task.id,{tool:'write_draft',args:{path:'draft.md',content:'new'},category:'LOCAL_WRITE',key:'collision'});
  s.decideApproval(approval.id,true,'approve-collision');s.reserveAction(task.id,'collision','write_draft',{path:'other.md',content:'different'});
  assert.throws(()=>s.consumeApproval(approval.id),/payload mismatch/);
  assert.equal(s.approval(approval.id).status,'APPROVED');
});

test('inference intervals exclude gaps and close on pause before stale worker cleanup',t=>{
  const f=fixture(t),s=f.open(),task=s.create({goal:'Research'}),claim=s.claim('worker',10000);
  f.advance(1000);s.beginInference(task.id,claim.token);s.beginInference(task.id,claim.token);f.advance(30);s.endInference(task.id,claim.token);s.endInference(task.id,claim.token);
  f.advance(2000);s.beginInference(task.id,claim.token);f.advance(20);s.control(task.id,'pause',s.get(task.id).revision,'pause-interval');
  assert.equal(s.usage(task.id).taskMs,50);f.advance(5000);s.endInference(task.id,claim.token);assert.equal(s.usage(task.id).taskMs,50);
});

test('recovery charges only a persisted active inference interval once',t=>{
  const f=fixture(t),s=f.open(),task=s.create({goal:'Research'}),claim=s.claim('crashed',1000);
  f.advance(800);s.beginInference(task.id,claim.token);f.advance(201);s.close();const reopened=f.open();reopened.recoverExpired();
  assert.equal(reopened.usage(task.id).taskMs,201);f.advance(1000);reopened.endInference(task.id,claim.token);assert.equal(reopened.usage(task.id).taskMs,201);
});

test('requesting an expired exact approval renews an actionable owner decision',t=>{
  const f=fixture(t),s=f.open(),task=s.create({goal:'Replace draft'}),action={tool:'write_draft',args:{path:'draft.md',content:'new'},category:'LOCAL_WRITE',key:'expired-retry'};
  const approval=s.requestApproval(task.id,action);s.decideApproval(approval.id,true,'expired-first');f.advance(86400001);assert.equal(s.consumeApproval(approval.id),null);
  const renewed=s.requestApproval(task.id,action);assert.equal(renewed.status,'PENDING');assert.equal(s.get(task.id).status,'WAITING_FOR_USER');assert.equal(s.decideApproval(renewed.id,true,'expired-renewed').status,'APPROVED');
});
