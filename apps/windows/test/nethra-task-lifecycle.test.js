'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {NethraStore}=require('../src/nethra-store');
const {NethraScheduler,CONTINUOUS_GAP_MS}=require('../src/nethra-scheduler');
const {NethraApi}=require('../src/nethra-api');
const {postProgress}=require('../src/nethra-conversation-report');
const {LocalDataStore}=require('../src/local-data');

function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-lifecycle-'));let time=1_800_000_000_000;
  const store=new NethraStore(dir,{now:()=>time});const localData=new LocalDataStore(path.join(dir,'local'));
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  return {dir,store,localData,now:()=>time,set:value=>time=value,advance:ms=>time+=ms,api:new NethraApi({store,localData,runtime:{modelCapabilities:async()=>({})}})};
}

test('a continuous task keeps working step after step while it makes progress',async t=>{
  const f=fixture(t);const {task}=await f.api.dispatch('nethra.create',{goal:'Compare three e-bike models',continuous:true},'c1','desktop');
  let step=0;
  const scheduler=new NethraScheduler({store:f.store,now:f.now,execute:async(_task,{checkpoint})=>{step++;checkpoint({evidence:[...f.store.get(task.id).evidence,`fact ${step}`],plan:['a','b','c'],pendingSteps:['b','c']});return {status:'SLEEPING'};}});
  await scheduler.tick();
  let saved=f.store.get(task.id);
  assert.equal(saved.nextWakeAt,f.now()+CONTINUOUS_GAP_MS,'next step in seconds, not the five-minute minimum');
  assert.equal(saved.wakeReason.kind,'CONTINUE');assert.match(saved.wakeReason.detail,/Continuous work/);
  f.set(saved.nextWakeAt);await scheduler.tick();assert.equal(step,2);
  // Without progress it falls back to the normal minimum wake and backoff.
  const idle=new NethraScheduler({store:f.store,now:f.now,execute:async()=>({status:'SLEEPING'})});
  f.set(f.store.get(task.id).nextWakeAt);await idle.tick();
  saved=f.store.get(task.id);assert.equal(saved.nextWakeAt,f.now()+300_000);
});

test('a productive continuous pass keeps the next step near even when the model schedules later',async t=>{
  const f=fixture(t),task=f.store.create({goal:'Research and compare options',continuous:true});
  const scheduler=new NethraScheduler({store:f.store,now:f.now,execute:async(_task,{checkpoint,token})=>{
    checkpoint({plan:['Research','Compare'],completedSteps:['Research'],pendingSteps:['Compare'],evidence:[{tool:'web_search',result:{title:'Verified source'}}]});
    return {status:'SLEEPING',nextWakeAt:f.now()+86_400_000,wakeReason:{kind:'SCHEDULED',detail:'Check tomorrow',at:f.now()+86_400_000}};
  }});
  await scheduler.tick();
  const saved=f.store.get(task.id);
  assert.equal(saved.nextWakeAt,f.now()+CONTINUOUS_GAP_MS);
  assert.equal(saved.wakeReason.kind,'CONTINUE');
});

test('switching continuous work on wakes a sleeping task; off keeps normal pacing',t=>{
  const f=fixture(t),task=f.store.create({goal:'Draft a packing list'});
  f.store.update(task.id,{status:'SLEEPING',nextWakeAt:f.now()+86_400_000},'SETUP');
  const on=f.store.configure(task.id,{continuous:true},f.store.get(task.id).revision,'cont-on');
  assert.equal(on.continuous,true);assert.equal(on.nextWakeAt,f.now());
  assert.throws(()=>f.store.configure(task.id,{continuous:'yes'},on.revision,'cont-bad'),/continuous/);
});

test('continuous ongoing work takes another pass while plan steps remain, but monitoring waits',async t=>{
  const f=fixture(t),task=f.store.create({goal:'Self Improvement',mode:'ONGOING',continuous:true});
  const scheduler=new NethraScheduler({store:f.store,now:f.now,execute:async(_task,{checkpoint})=>{
    checkpoint({plan:['Measure','Compare'],pendingSteps:['Compare'],evidence:[{tool:'performance_report',result:{sampleCount:3}}]});
    return {status:'SLEEPING'};
  }});
  await scheduler.tick();
  const next=f.store.get(task.id);
  assert.equal(next.nextWakeAt,f.now()+CONTINUOUS_GAP_MS);
  assert.equal(next.wakeReason.kind,'CONTINUE');
  f.store.update(task.id,{pendingSteps:[],lastMilestoneAt:f.now(),nextWakeAt:f.now()+86_400_000,wakeReason:{kind:'MONITOR',detail:'Routine check',at:f.now()+86_400_000}},'MILESTONE_VERIFIED');
  const monitoring=f.store.configure(task.id,{continuous:true},f.store.get(task.id).revision,'monitor-on');
  assert.equal(monitoring.nextWakeAt,f.now()+86_400_000,'finished ongoing work keeps its monitor schedule');
});

test('continuous toggle saves during an active pass and changes sleeping ongoing pacing',t=>{
  const f=fixture(t),task=f.store.create({goal:'Self Improvement',mode:'ONGOING',continuous:false});
  const claim=f.store.claim('owner');
  assert.equal(claim.task.id,task.id);
  f.store.update(task.id,{pendingSteps:['Compare results']},'nethra_plan_updated',claim.token);
  const active=f.store.configure(task.id,{continuous:true},task.revision,'active-on');
  assert.equal(active.continuous,true);
  f.store.release(task.id,claim.token);
  f.store.update(task.id,{status:'SLEEPING',pendingSteps:['Compare results'],nextWakeAt:f.now()+86_400_000,wakeReason:{kind:'CONTINUE',detail:'Continue the plan',at:f.now()+86_400_000}},'SETUP');
  const on=f.store.configure(task.id,{continuous:true},f.store.get(task.id).revision,'sleep-on');
  assert.equal(on.nextWakeAt,f.now());
  const off=f.store.configure(task.id,{continuous:false},on.revision,'sleep-off');
  assert.equal(off.nextWakeAt,f.now()+f.store.settings().minWakeMs);
});

test('Codex development drafts require a Windows opt-in on the objective',async t=>{
  const f=fixture(t);
  await assert.rejects(f.api.dispatch('nethra.create',{goal:'Improve Junction',allowCodeWork:true},'code-phone','android'),/Windows/);
  const {task}=await f.api.dispatch('nethra.create',{goal:'Improve Junction'},'code-create','desktop');
  assert.equal(task.allowCodeWork,false);
  await assert.rejects(f.api.dispatch('nethra.configure',{id:task.id,revision:task.revision,allowCodeWork:true},'code-phone-config','android'),/Windows/);
  const enabled=await f.api.dispatch('nethra.configure',{id:task.id,revision:task.revision,allowCodeWork:true},'code-enable','desktop');
  assert.equal(enabled.task.allowCodeWork,true);
});

test('editing a task changes its goal, keeps evidence, supersedes approvals and replans',t=>{
  const f=fixture(t),task=f.store.create({goal:'Plan a Lisbon trip'});
  const claim=f.store.claim('a');
  f.store.update(task.id,{plan:['Find flights','Book hotel'],completedSteps:['Find flights'],pendingSteps:['Book hotel'],evidence:['flight prices']},'SEED',claim.token);
  const approval=f.store.requestApproval(task.id,{tool:'write_draft',args:{path:'p.md',content:'x'},category:'LOCAL_WRITE',key:'k'},claim.token);
  const edited=f.store.edit(task.id,{goal:'Plan a Porto trip',successCriteria:'Two-night itinerary under £400'},f.store.get(task.id).revision,'edit-1');
  assert.equal(edited.goal,'Plan a Porto trip');assert.equal(edited.successCriteria,'Two-night itinerary under £400');
  assert.deepEqual(edited.evidence,['flight prices']);assert.deepEqual(edited.pendingSteps,[]);assert.equal(edited.status,'ACTIVE');
  assert.equal(f.store.approval(approval.id).status,'SUPERSEDED');
  assert.throws(()=>f.store.update(task.id,{summary:'stale'},'X',claim.token),/lease/i,'the running step is fenced');
  assert.ok(f.store.events(task.id).some(event=>event.kind==='EDITED'&&event.detail.before.goal==='Plan a Lisbon trip'));
  assert.throws(()=>f.store.edit(task.id,{goal:'   '},edited.revision,'edit-2'),/goal/);
  assert.throws(()=>f.store.edit(task.id,{status:'COMPLETED'},edited.revision,'edit-3'),/Edit the goal/);
});

test('deleting a task removes its record, journal, approvals and drafts but keeps its chat',async t=>{
  const f=fixture(t);const {task}=await f.api.dispatch('nethra.create',{goal:'Write a short bio'},'d1','desktop');
  fs.writeFileSync(path.join(task.workspace,'bio.md'),'draft');
  const claim=f.store.claim('a');f.store.requestApproval(task.id,{tool:'write_draft',args:{path:'bio.md',content:'y'},category:'LOCAL_WRITE',key:'k2'},claim.token);
  await assert.rejects(f.api.dispatch('nethra.delete',{id:task.id},'d2','desktop'),/Confirm deletion/);
  const removed=await f.api.dispatch('nethra.delete',{id:task.id,confirm:true},'d3','desktop');
  assert.equal(removed.deleted,true);
  assert.throws(()=>f.store.get(task.id),/Unknown Nethra task/);
  assert.equal(f.store.events(task.id).length,0);assert.equal(f.store.approvals(task.id).length,0);
  assert.equal(fs.existsSync(task.workspace),false);
  assert.ok(f.localData.conversation(task.conversationId),'the chat stays as an ordinary conversation');
  assert.equal(f.store.liveTaskId(),null,'its lease is released');
  assert.deepEqual(await f.api.dispatch('nethra.delete',{id:task.id,confirm:true},'d3','desktop'),removed,'retry is idempotent');
});

test('every new task gets its own linked chat, named after the goal',async t=>{
  const f=fixture(t);
  const {task}=await f.api.dispatch('nethra.create',{goal:'Find a quiet co-working space near Leith'},'n1','desktop');
  assert.match(task.conversationId,/^nethra_task_/);
  assert.match(f.localData.conversation(task.conversationId).title,/^Task: Find a quiet co-working space/);
  const fromChat=await f.api.dispatch('nethra.create',{goal:'Track council tax changes',conversationId:'chat_existing'},'n2','android');
  assert.equal(fromChat.task.conversationId,'chat_existing','a task started from a chat stays in that chat');
});

test('an owner note in the task chat joins its inputs and wakes it soon',t=>{
  const f=fixture(t),task=f.store.create({goal:'Plan meals for the week'});
  f.store.update(task.id,{status:'SLEEPING',nextWakeAt:f.now()+3_600_000,unchangedWakes:2},'SETUP');
  const noted=f.store.note(task.id,'No mushrooms please');
  assert.equal(noted.ownerInputs.at(-1).kind,'note');assert.equal(noted.nextWakeAt,f.now()+15_000);assert.equal(noted.unchangedWakes,0);
  assert.equal(noted.wakeReason.kind,'OWNER');
});

test('a productive cycle posts what was actually done to the task chat, once',async t=>{
  const f=fixture(t);const {task}=await f.api.dispatch('nethra.create',{goal:'Research standing desks',continuous:true},'p1','desktop');
  const claim=f.store.claim('a');
  f.store.update(task.id,{plan:['Search reviews','Compare prices'],completedSteps:['Search reviews'],pendingSteps:['Compare prices'],evidence:[{tool:'web_search',result:{evidence:{query:'standing desk reviews',sources:[{title:'Wirecutter'}]}}}]},'nethra_tool_result',claim.token);
  f.store.release(task.id,claim.token);
  f.store.update(task.id,{status:'SLEEPING',lastCycleProgressed:true,nextWakeAt:f.now()+20_000,wakeReason:{kind:'CONTINUE',detail:'Continuous work',at:f.now()+20_000},summary:'Two strong options so far.'},'EXECUTED');
  const settings={proactiveUpdates:'ALL',quietHours:{enabled:false,start:'22:00',end:'07:00'}};
  assert.equal(postProgress(f.store.get(task.id),f.store,f.localData,{settings}),true);
  assert.equal(postProgress(f.store.get(task.id),f.store,f.localData,{settings}),false,'idempotent');
  const message=f.localData.conversation(task.conversationId).messages.at(-1).content;
  assert.match(message,/Searched the web for “standing desk reviews”/);assert.match(message,/1 of 2 steps done/);assert.match(message,/Next: Compare prices/);assert.match(message,/Continuing now/);assert.match(message,/My note: Two strong options/);
  assert.match(message,/Recorded actions:/);assert.match(message,/• Searched the web for “standing desk reviews”/);
  f.store.update(task.id,{lastCycleProgressed:false},'EXECUTED');
  assert.equal(postProgress(f.store.get(task.id),f.store,f.localData,{settings}),false,'no progress, no post');
});

test('an ongoing task that works continuously posts its steps; a plain ongoing monitor does not',async t=>{
  const f=fixture(t),settings={proactiveUpdates:'ALL',quietHours:{enabled:false,start:'22:00',end:'07:00'}};
  for(const [continuous,expected] of [[true,true],[false,false]]){
    const {task}=await f.api.dispatch('nethra.create',{goal:`Self Improvement ${continuous}`,mode:'ONGOING',continuous},`ongoing-${continuous}`,'desktop');
    const claim=f.store.claim('a');
    f.store.update(task.id,{evidence:[{tool:'performance_report',result:{objective:{sampleCount:35}}}]},'nethra_tool_result',claim.token);
    f.store.release(task.id,claim.token);
    f.store.update(task.id,{status:'SLEEPING',lastCycleProgressed:true,nextWakeAt:f.now()+60_000,wakeReason:{kind:'SCHEDULED',detail:'Wait for Codex availability',at:f.now()+60_000}},'EXECUTED');
    assert.equal(postProgress(f.store.get(task.id),f.store,f.localData,{settings}),expected,`continuous=${continuous}`);
  }
});

test('the same question asked again later is posted again; a retry of one question is not',async t=>{
  const {postOutcome}=require('../src/nethra-conversation-report');
  const f=fixture(t),settings={proactiveUpdates:'ALL',quietHours:{enabled:false,start:'22:00',end:'07:00'}};
  const {task}=await f.api.dispatch('nethra.create',{goal:'Self Improvement',continuous:true},'q1','desktop');
  const ask=()=>{const claim=f.store.claim('a');f.store.update(task.id,{status:'WAITING_FOR_USER',summary:'I could not choose a permitted next action.'},'nethra_direction_required',claim.token);f.store.release(task.id,claim.token);};
  ask();
  assert.equal(postOutcome(f.store.get(task.id),f.store,f.localData,{settings}),true);
  assert.equal(postOutcome(f.store.get(task.id),f.store,f.localData,{settings}),false,'sweep retry stays single');
  f.store.answer(task.id,'Read src/nethra-runner.js first',f.store.get(task.id).revision,'answer-1');
  ask();
  assert.equal(postOutcome(f.store.get(task.id),f.store,f.localData,{settings}),true,'a later identical question is a new message');
  const posts=f.localData.conversation(f.store.get(task.id).conversationId).messages.filter(m=>/could not choose/.test(m.content));
  assert.equal(posts.length,2);
});
