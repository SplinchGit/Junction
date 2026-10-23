'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {NethraStore}=require('../src/nethra-store');
const {NethraAttention}=require('../src/nethra-attention');
const {NethraScheduler}=require('../src/nethra-scheduler');

function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-attention-'));
  let now=1_800_000_000_000;
  const stores=[];
  const open=()=>{const store=new NethraStore(directory,{now:()=>now});stores.push(store);return store;};
  t.after(()=>{for(const store of stores)try{store.close();}catch{}fs.rmSync(directory,{recursive:true,force:true});});
  return {open,advance:ms=>now+=ms,now:()=>now};
}

test('objective profile and check-in policy persist and update with revision checks',t=>{
  const f=fixture(t),store=f.open();
  const created=store.create({goal:'Track coursework',autonomy:'QUIET',priority:4,checkIn:'WEEKLY'});
  assert.equal(created.autonomy,'QUIET');assert.equal(created.priority,4);assert.equal(created.checkIn,'WEEKLY');
  const updated=store.configure(created.id,{autonomy:'ACTIVE',priority:2,checkIn:'MILESTONES'},created.revision,'configure-1');
  assert.equal(updated.autonomy,'ACTIVE');assert.equal(updated.priority,2);
  assert.equal(f.open().get(created.id).checkIn,'MILESTONES');
  assert.deepEqual(store.configure(created.id,{autonomy:'ACTIVE',priority:2,checkIn:'MILESTONES'},created.revision,'configure-1'),updated);
  assert.throws(()=>store.configure(created.id,{priority:3},created.revision,'configure-2'),/revision/i);
  assert.throws(()=>store.create({goal:'Bad',autonomy:'UNBOUNDED'}),/autonomy/i);
});

test('source event deduplicates unchanged evidence and wakes once on a new revision',t=>{
  const f=fixture(t),store=f.open(),task=store.create({goal:'Watch coursework',autonomy:'QUIET'});
  const attention=new NethraAttention(store,{now:f.now});
  const first=attention.observe({taskId:task.id,source:'calendar',sourceId:'deadline-1',revision:'v1',kind:'SOURCE_CHANGED',evidenceRef:'calendar:event-1'});
  assert.equal(first.created,true);
  assert.equal(attention.observe({taskId:task.id,source:'calendar',sourceId:'deadline-1',revision:'v1',kind:'SOURCE_CHANGED',evidenceRef:'calendar:event-1'}).created,false);
  assert.equal(store.attention(task.id).length,1);
  const lease=store.claim('worker',10_000);assert.equal(lease.task.id,task.id);
  assert.equal(store.attention(task.id)[0].state,'CLAIMED');
  store.release(task.id,lease.token);
  const second=attention.observe({taskId:task.id,source:'calendar',sourceId:'deadline-1',revision:'v2',kind:'SOURCE_CHANGED',evidenceRef:'calendar:event-1'});
  assert.equal(second.created,true);assert.equal(store.attention(task.id).length,2);
});
test('interrupted work requeues its claimed attention instead of losing the trigger',t=>{
  const f=fixture(t),store=f.open(),task=store.create({goal:'Investigate update'});
  new NethraAttention(store,{now:f.now}).observe({taskId:task.id,source:'inbox',sourceId:'message-1',revision:'v1'});
  const claim=store.claim('worker',10_000);assert.equal(store.attention(task.id)[0].state,'CLAIMED');
  store.release(task.id,claim.token,false);
  assert.equal(f.open().attention(task.id)[0].state,'PENDING');
});

test('metadata-only observation journals evidence without waking the model',t=>{
  const f=fixture(t),store=f.open(),task=store.create({goal:'Monitor changes'});
  const sleeping=store.update(task.id,{status:'SLEEPING',nextWakeAt:f.now()+86_400_000});
  new NethraAttention(store,{now:f.now}).observe({taskId:task.id,source:'calendar',sourceId:'sync',revision:'v1',reasoningRequired:false});
  assert.equal(store.get(task.id).nextWakeAt,sleeping.nextWakeAt);
  assert.equal(store.claim('early'),null);
});

test('time checkpoint leaves a quiet objective asleep until due and wake survives reopen',t=>{
  const f=fixture(t),store=f.open(),task=store.create({goal:'Monitor replies',autonomy:'QUIET'});
  store.update(task.id,{status:'SLEEPING',nextWakeAt:f.now()+60_000},'TEST_SLEEP');
  assert.equal(store.claim('early'),null);
  f.advance(60_000);assert.equal(f.open().claim('due').task.id,task.id);
});

test('higher priority due objectives claim first without duplicating leases',t=>{
  const f=fixture(t),store=f.open();
  const low=store.create({goal:'Low priority',priority:4});
  const high=store.create({goal:'High priority',priority:1});
  const first=store.claim('one',10_000);assert.equal(first.task.id,high.id);
  assert.equal(store.claim('two',10_000),null);
  store.update(high.id,{status:'SLEEPING',nextWakeAt:f.now()+60_000},'DONE_CYCLE',first.token);store.release(high.id,first.token);
  assert.equal(store.claim('three',10_000).task.id,low.id);
});
test('ageing eventually serves a lower priority objective despite busy high priority work',t=>{
  const f=fixture(t),store=f.open();
  const low=store.create({goal:'Quiet maintenance',priority:5});
  const high=store.create({goal:'Urgent repeated work',priority:1});
  const first=store.claim('first',10_000);assert.equal(first.task.id,high.id);
  store.update(high.id,{status:'SLEEPING',nextWakeAt:f.now()+1},'CHECKPOINT',first.token);store.release(high.id,first.token);
  f.advance(4*3_600_000+1000);
  assert.equal(store.claim('fair',10_000).task.id,low.id);
});
test('daily check-in is due only after meaningful progress and repeats no sooner than its interval',t=>{
  const f=fixture(t),store=f.open(),task=store.create({goal:'Finish coursework',checkIn:'DAILY'});
  store.update(task.id,{status:'SLEEPING',nextWakeAt:f.now()+7*86_400_000});
  const attention=new NethraAttention(store,{now:f.now});
  f.advance(86_400_000);
  assert.equal(attention.reconcileCheckIns(),0);
  assert.equal(store.claim('no-reason'),null);
  store.update(task.id,{evidence:[{tool:'read_file',result:{path:'course.txt'}}]},'CHECKPOINT');
  f.advance(86_400_000);
  assert.equal(attention.reconcileCheckIns(),1);
  assert.equal(store.attention(task.id).filter(item=>item.kind==='DIRECTION_REVIEW').length,1);
  assert.equal(attention.reconcileCheckIns(),0);
  assert.equal(store.claim('check-in').task.id,task.id);
});

test('milestone check-in fires once after a completed step',t=>{
  const f=fixture(t),store=f.open(),task=store.create({goal:'Build a project',checkIn:'MILESTONES'});
  store.update(task.id,{status:'SLEEPING',nextWakeAt:f.now()+7*86_400_000,plan:['Stage one'],completedSteps:['Stage one']});
  const attention=new NethraAttention(store,{now:f.now});
  assert.equal(attention.reconcileCheckIns(),1);
  assert.equal(attention.reconcileCheckIns(),0);
  assert.equal(store.attention(task.id).filter(item=>item.kind==='DIRECTION_REVIEW').length,1);
});
test('scheduler claims a due direction review with a single inference and leaves quiet work asleep',async t=>{
  const f=fixture(t),store=f.open(),task=store.create({goal:'Review progress',checkIn:'DAILY'});
  store.update(task.id,{status:'SLEEPING',nextWakeAt:f.now()+7*86_400_000,evidence:[{tool:'read_file'}]});
  f.advance(86_400_000);
  let runs=0;
  const scheduler=new NethraScheduler({store,now:f.now,execute:async current=>{runs++;assert.equal(current.id,task.id);assert.equal(store.attention(task.id)[0].state,'CLAIMED');return {status:'WAITING_FOR_USER',summary:'Direction requested'};}});
  await scheduler.tick();assert.equal(runs,1);assert.equal(store.get(task.id).status,'WAITING_FOR_USER');
  await scheduler.tick();assert.equal(runs,1);
});

test('objectives from before schema 4 receive the weekly check-in the clients display',t=>{
  const f=fixture(t),store=f.open(),task=store.create({goal:'Legacy objective'});
  const legacy=store.get(task.id);for(const key of ['autonomy','priority','checkIn','lastDirectionAt','nextDirectionCheckAt','lastMilestoneCount','lastMeaningfulProgressAt'])delete legacy[key];
  store.db.prepare('UPDATE tasks SET body=? WHERE id=?').run(JSON.stringify(legacy),task.id);store.close();
  const migrated=f.open().get(task.id);
  assert.equal(migrated.checkIn,'WEEKLY');assert.equal(migrated.priority,3);assert.equal(migrated.autonomy,'BALANCED');
  assert.equal(migrated.nextDirectionCheckAt,f.now()+7*86_400_000);assert.equal(migrated.revision,legacy.revision);
  assert.equal(f.open().get(task.id).nextDirectionCheckAt,migrated.nextDirectionCheckAt);
});

test('future attention does not postpone an objective that is already due',t=>{
  const f=fixture(t),store=f.open(),task=store.create({goal:'Due now'});
  store.update(task.id,{status:'ACTIVE'});
  new NethraAttention(store,{now:f.now}).observe({taskId:task.id,source:'calendar',sourceId:'later',revision:'v1',dueAt:f.now()+3_600_000});
  assert.equal(store.get(task.id).nextWakeAt,null);
  assert.equal(store.claim('due').task.id,task.id);
});

test('attention observed during a cycle pulls the next wake forward',async t=>{
  const f=fixture(t),store=f.open(),task=store.create({goal:'Watch inbox'});
  const attention=new NethraAttention(store,{now:f.now});
  const scheduler=new NethraScheduler({store,now:f.now,execute:async()=>{attention.observe({taskId:task.id,source:'inbox',sourceId:'message-2',revision:'v1'});return {status:'SLEEPING',nextWakeAt:f.now()+7*86_400_000};}});
  await scheduler.tick();
  const live=store.get(task.id);
  assert.equal(live.nextWakeAt,f.now()+300_000);
  assert.equal(store.attention(task.id)[0].state,'PENDING');
});

test('a failing objective does not block check-ins or claims for others',async t=>{
  const f=fixture(t),store=f.open();
  const broken=store.create({goal:'Broken',checkIn:'MILESTONES'}),healthy=store.create({goal:'Healthy',checkIn:'MILESTONES'});
  for(const task of [broken,healthy])store.update(task.id,{status:'SLEEPING',nextWakeAt:f.now()+86_400_000,completedSteps:['Step']});
  const original=store.observeAttention.bind(store);
  store.observeAttention=event=>{if(event.taskId===broken.id)throw new Error('disk fault');return original(event);};
  let ran=null;
  const scheduler=new NethraScheduler({store,now:f.now,execute:async task=>{ran=task.id;return {status:'SLEEPING'};}});
  await scheduler.tick();
  assert.equal(ran,healthy.id);
  assert.match(scheduler.lastError.message,/disk fault/);
});

test('a milestone count reached again after replanning gets a new review',t=>{
  const f=fixture(t),store=f.open(),task=store.create({goal:'Replan',checkIn:'MILESTONES'});
  const attention=new NethraAttention(store,{now:f.now});
  store.update(task.id,{status:'SLEEPING',nextWakeAt:f.now()+86_400_000,completedSteps:['A']});
  assert.equal(attention.reconcileCheckIns(),1);
  f.advance(1000);store.update(task.id,{completedSteps:[]});
  f.advance(1000);const current=store.get(task.id);store.configure(task.id,{checkIn:'MILESTONES'},current.revision,'reconfigure');
  f.advance(1000);store.update(task.id,{completedSteps:['B']});
  assert.equal(attention.reconcileCheckIns(),1);
});

test('newest claimed attention remains visible after many journaled events',t=>{
  const f=fixture(t),store=f.open(),task=store.create({goal:'Busy source'});
  const attention=new NethraAttention(store,{now:f.now});
  for(let i=0;i<505;i++)attention.observe({taskId:task.id,source:'inbox',sourceId:`m-${i}`,revision:'v1',reasoningRequired:false});
  f.advance(1000);
  attention.observe({taskId:task.id,source:'inbox',sourceId:'newest',revision:'v1'});
  const rows=store.attention(task.id);
  assert.equal(rows.length,500);assert.equal(rows.at(-1).sourceId,'newest');
});

test('profile initiative needs actionable progress and respects its cooldown',t=>{
  const f=fixture(t),store=f.open(),attention=new NethraAttention(store,{now:f.now});
  const quiet=store.create({goal:'Quiet',autonomy:'QUIET'});
  const balanced=store.create({goal:'Balanced',autonomy:'BALANCED'});
  const active=store.create({goal:'Active',autonomy:'ACTIVE'});
  const idle=store.create({goal:'Idle',autonomy:'ACTIVE'});
  for(const task of [quiet,balanced,active])store.update(task.id,{status:'SLEEPING',nextWakeAt:f.now()+86_400_000,pendingSteps:['Inspect the new finding'],evidence:[{source:'verified'}]});
  store.update(idle.id,{status:'SLEEPING',nextWakeAt:f.now()+86_400_000,pendingSteps:['No evidence yet']});
  f.advance(15*60_000+1);
  assert.equal(attention.reconcileInitiative(),1);
  assert.equal(store.attention(active.id).filter(item=>item.kind==='INITIATIVE_REVIEW').length,1);
  assert.equal(store.attention(quiet.id).length,0);
  assert.equal(store.attention(balanced.id).length,0);
  assert.equal(store.attention(idle.id).length,0);
  assert.equal(attention.reconcileInitiative(),0);
  f.advance(45*60_000);
  assert.equal(attention.reconcileInitiative(),1);
  assert.equal(store.attention(balanced.id).filter(item=>item.kind==='INITIATIVE_REVIEW').length,1);
  assert.equal(attention.reconcileInitiative(),0);
});

test('changing autonomy applies the new initiative interval without losing progress',t=>{
  const f=fixture(t),store=f.open(),attention=new NethraAttention(store,{now:f.now});
  const task=store.create({goal:'Research',autonomy:'QUIET'});
  store.update(task.id,{status:'SLEEPING',nextWakeAt:f.now()+86_400_000,pendingSteps:['Review evidence'],evidence:[{source:'verified'}]});
  f.advance(15*60_000+1);assert.equal(attention.reconcileInitiative(),0);
  const live=store.get(task.id);store.configure(task.id,{autonomy:'ACTIVE'},live.revision,'active-now');
  assert.equal(attention.reconcileInitiative(),1);
  assert.deepEqual(store.get(task.id).evidence,[{source:'verified'}]);
});

test('initiative observation survives restart and does not re-run without new evidence',async t=>{
  const f=fixture(t),store=f.open(),task=store.create({goal:'Review research',autonomy:'ACTIVE'});
  store.update(task.id,{status:'SLEEPING',nextWakeAt:f.now()+86_400_000,pendingSteps:['Compare sources'],evidence:[{source:'verified'}]});
  f.advance(15*60_000+1);
  let calls=0;
  const scheduler=new NethraScheduler({store,now:f.now,execute:async()=>{calls++;return {status:'SLEEPING',nextWakeAt:f.now()+86_400_000};}});
  await scheduler.tick();assert.equal(calls,1);
  assert.equal(f.open().get(task.id).lastInitiativeProgressAt,store.get(task.id).lastMeaningfulProgressAt);
  f.advance(15*60_000+1);
  await scheduler.tick();assert.equal(calls,1);
  assert.equal(f.open().attention(task.id).filter(item=>item.kind==='INITIATIVE_REVIEW').length,1);
});

test('a due source event coalesces an initiative review into the same reasoning wake',async t=>{
  const f=fixture(t),store=f.open(),task=store.create({goal:'Follow source',autonomy:'ACTIVE'});
  store.update(task.id,{status:'SLEEPING',nextWakeAt:f.now()+86_400_000,pendingSteps:['Analyze change'],evidence:[{source:'verified'}]});
  f.advance(15*60_000+1);
  new NethraAttention(store,{now:f.now}).observe({taskId:task.id,source:'calendar',sourceId:'new-date',revision:'v2'});
  let runs=0;const scheduler=new NethraScheduler({store,now:f.now,execute:async()=>{runs++;return {status:'SLEEPING',nextWakeAt:f.now()+86_400_000};}});
  await scheduler.tick();assert.equal(runs,1);
  assert.equal(store.attention(task.id).filter(item=>item.kind==='INITIATIVE_REVIEW').length,0);
  f.advance(15*60_000+1);await scheduler.tick();assert.equal(runs,1);
});
