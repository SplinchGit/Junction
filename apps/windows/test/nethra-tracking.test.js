'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {NethraStore}=require('../src/nethra-store');
const {NethraScheduler,PREWARM_LEAD_MS}=require('../src/nethra-scheduler');
const {NethraRunner}=require('../src/nethra-runner');
const {NethraApi}=require('../src/nethra-api');
const {progressView,inQuietHours}=require('../src/nethra-progress');
const {postOutcome,postMilestones}=require('../src/nethra-conversation-report');
const {LocalDataStore}=require('../src/local-data');

function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-tracking-'));let time=1_800_000_000_000;
  const store=new NethraStore(dir,{now:()=>time});
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  return {dir,store,now:()=>time,advance:ms=>time+=ms,set:value=>time=value};
}
const toolCalls=(...calls)=>({message:{role:'assistant',content:'',tool_calls:calls.map(([name,args])=>({function:{name,arguments:args}}))}});

test('wake reasons are host facts recorded where the next wake is chosen',async t=>{
  const f=fixture(t),task=f.store.create({goal:'Check the council planning portal later'});
  const runtime={withInference:fn=>fn(),chat:async()=>toolCalls(['schedule_wake',{at:f.now()+3_600_000,reason:'The portal updates hourly'}])};
  await new NethraScheduler({store:f.store,now:f.now,execute:(item,options)=>new NethraRunner({store:f.store,runtime,now:f.now}).execute(item,options)}).tick();
  const saved=f.store.get(task.id);
  assert.equal(saved.status,'SLEEPING');assert.equal(saved.wakeReason.kind,'SCHEDULED');assert.match(saved.wakeReason.detail,/portal updates hourly/);
  assert.equal(saved.wakeReason.at,saved.nextWakeAt);
  const view=progressView(saved,f.store,{now:f.now()});
  assert.equal(view.wake.kind,'SCHEDULED');assert.equal(view.waitingFor.kind,'time');
});

test('a failure schedules a retry with its reason and backoff, not a silent stall',async t=>{
  const f=fixture(t),task=f.store.create({goal:'One'});
  await new NethraScheduler({store:f.store,now:f.now,execute:async()=>{throw new Error('Ollama is not reachable');}}).tick();
  const saved=f.store.get(task.id);
  assert.equal(saved.wakeReason.kind,'RETRY');assert.match(saved.wakeReason.detail,/Retry 1 of 4/);assert.equal(saved.nextWakeAt,f.now()+300_000);
});

test('identical inputs after an unproductive cycle skip inference and back off, then ask the owner',async t=>{
  const f=fixture(t),task=f.store.create({goal:'Summarise open questions'});let calls=0;
  const scheduler=new NethraScheduler({store:f.store,now:f.now,execute:async()=>{calls++;return {status:'SLEEPING'};}});
  await scheduler.tick();assert.equal(calls,1);assert.equal(f.store.get(task.id).wakeReason.kind,'CONTINUE');
  f.set(f.store.get(task.id).nextWakeAt);await scheduler.tick();
  assert.equal(calls,1,'same plan, evidence, inputs and attention: no second inference');
  let saved=f.store.get(task.id);assert.equal(saved.wakeReason.kind,'BACKOFF');assert.equal(saved.unchangedWakes,1);
  assert.equal(saved.nextWakeAt,f.now()+600_000,'exponential backoff');
  f.set(saved.nextWakeAt);await scheduler.tick();f.set(f.store.get(task.id).nextWakeAt);await scheduler.tick();
  saved=f.store.get(task.id);assert.equal(calls,1);assert.equal(saved.status,'WAITING_FOR_USER');assert.match(saved.summary,/Nothing has changed/);
  assert.ok(f.store.events(task.id).some(event=>event.kind==='NO_NEW_EVIDENCE_STOPPED'));
});

test('new owner input changes the inputs, so the next wake does run inference',async t=>{
  const f=fixture(t),task=f.store.create({goal:'Summarise open questions'});let calls=0;
  const scheduler=new NethraScheduler({store:f.store,now:f.now,execute:async()=>{calls++;return calls===1?{status:'SLEEPING'}:{status:'SLEEPING',evidence:['new']};}});
  await scheduler.tick();
  // A redirect adds owner input and replans; the fingerprint differs.
  f.store.redirect(task.id,'Focus on the transport questions only',f.store.get(task.id).revision,'redirect-1');
  await scheduler.tick();assert.equal(calls,2);
});

test('running out of wake time is a checkpointed yield, not a retry failure',async t=>{
  const f=fixture(t),task=f.store.create({goal:'Long research'});
  const scheduler=new NethraScheduler({store:f.store,now:f.now,pollMs:10,maxRuntimeMs:30,execute:async(_task,{signal})=>{
    await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
  }});
  await scheduler.tick();
  const saved=f.store.get(task.id);
  assert.equal(saved.status,'SLEEPING');assert.equal(saved.retryCount,0);assert.equal(saved.errors.length,0);
  assert.equal(saved.wakeReason.kind,'CONTINUE');assert.equal(saved.noProgressCycles,1);
  assert.ok(f.store.events(task.id).some(event=>event.kind==='YIELDED'));
});

test('redirect keeps verified evidence, supersedes old approvals, fences the running step and replans',async t=>{
  const f=fixture(t),task=f.store.create({goal:'Write a housing summary'});
  const claim=f.store.claim('owner-a');
  f.store.update(task.id,{plan:['Find sources','Write draft'],completedSteps:['Find sources'],pendingSteps:['Write draft'],evidence:[{tool:'web_search',result:{evidence:{query:'housing'}}}]},'SEEDED',claim.token);
  const approval=f.store.requestApproval(task.id,{tool:'write_draft',args:{path:'a.md',content:'x'},category:'LOCAL_WRITE',key:'k1'},claim.token);
  const before=f.store.get(task.id).revision;
  const redirected=f.store.redirect(task.id,'Cover Scotland only',before,'redirect-a');
  assert.equal(redirected.status,'ACTIVE');assert.deepEqual(redirected.plan,['Find sources']);assert.deepEqual(redirected.pendingSteps,[]);
  assert.equal(redirected.evidence.length,1);assert.equal(redirected.ownerInputs.at(-1).kind,'redirect');
  assert.equal(f.store.approval(approval.id).status,'SUPERSEDED');
  assert.throws(()=>f.store.decideApproval(approval.id,true,'late-approve'),/already decided/);
  assert.throws(()=>f.store.update(task.id,{summary:'stale writer'},'X',claim.token),/lease/i);
  // Idempotent retry of the same request returns the same result.
  assert.equal(f.store.redirect(task.id,'Cover Scotland only',before,'redirect-a').revision,redirected.revision);
});

test('check now brings a sleeping objective forward and records why',t=>{
  const f=fixture(t),task=f.store.create({goal:'Track ferry timetable changes',mode:'ONGOING'});
  f.store.update(task.id,{status:'SLEEPING',nextWakeAt:f.now()+86_400_000},'SETUP');
  const woken=f.store.control(task.id,'wake',f.store.get(task.id).revision,'wake-1');
  assert.equal(woken.nextWakeAt,f.now());assert.equal(woken.wakeReason.kind,'OWNER');
  const paused=f.store.control(task.id,'pause',woken.revision,'pause-1');
  assert.throws(()=>f.store.control(task.id,'wake',paused.revision,'wake-2'),/Resume this objective first/);
});

test('an overdue wake after restart runs once, even with two schedulers racing',async t=>{
  const f=fixture(t),task=f.store.create({goal:'Overdue work'});
  f.store.update(task.id,{status:'SLEEPING',nextWakeAt:f.now()-3_600_000},'SETUP');
  let runs=0,release;const gate=new Promise(resolve=>release=resolve);
  const execute=async()=>{runs++;await gate;return {status:'COMPLETED'};};
  const a=new NethraScheduler({store:f.store,now:f.now,execute}),b=new NethraScheduler({store:f.store,now:f.now,execute});
  const first=a.tick();await new Promise(resolve=>setImmediate(resolve));await b.tick();
  release();await first;assert.equal(runs,1);
});

test('the model is warmed shortly before a wake that needs inference, once, and not for bookkeeping wakes',async t=>{
  const f=fixture(t);const warmed=[];
  const due=f.store.create({goal:'Research step due soon'});f.store.update(due.id,{status:'SLEEPING',nextWakeAt:f.now()+PREWARM_LEAD_MS-1000},'SETUP');
  const monitor=f.store.create({goal:'Watch calendar',mode:'ONGOING',sources:['calendar']});f.store.update(monitor.id,{status:'SLEEPING',lastMilestoneAt:f.now(),nextWakeAt:f.now()+30_000},'SETUP');
  const scheduler=new NethraScheduler({store:f.store,now:f.now,sourceStatus:()=>({status:'CONNECTED'}),execute:async()=>({status:'SLEEPING'}),warmBefore:task=>warmed.push(task.id)});
  scheduler.prepareUpcoming();scheduler.prepareUpcoming();
  assert.deepEqual(warmed,[due.id]);
});

test('progress view separates host facts from narration and lists real outputs and needs',async t=>{
  const f=fixture(t),task=f.store.create({goal:'Write a draft report about trams'});
  const runtime={withInference:fn=>fn(),chat:async(_m,messages)=>messages.length<3?toolCalls(['write_draft',{path:'report.md',content:'Tram report'}]):toolCalls(['request_input',{question:'Should I include costs?'}])};
  await new NethraScheduler({store:f.store,now:f.now,execute:(item,options)=>new NethraRunner({store:f.store,runtime,now:f.now}).execute(item,options)}).tick();
  const view=progressView(f.store.get(task.id),f.store,{now:f.now()});
  assert.equal(view.outputs.length,1);assert.equal(view.outputs[0].current,true);assert.match(view.outputs[0].path,/report\.md$/);
  assert.equal(view.waitingFor.kind,'input');assert.match(view.waitingFor.detail,/include costs/);
  assert.match(view.lastAccomplished.line,/Saved draft/);
  assert.equal(view.narration,'Should I include costs?');
  const api=new NethraApi({store:f.store,runtime:{modelCapabilities:async()=>({})}});
  const mobile=await api.dispatch('nethra.get',{id:task.id},'get-1','android');
  assert.equal(mobile.progress.waitingFor.kind,'input');
  const listed=await api.dispatch('nethra.list',{},'list-1','android');
  assert.equal(listed.objectives[0].tracking.waitingFor.kind,'input');
});

test('quiet hours cross midnight and defer outcome posts until they end, without duplicates',t=>{
  const settings={proactiveUpdates:'ALL',quietHours:{enabled:true,start:'22:00',end:'07:00'}};
  const at=(h,m=0)=>{const date=new Date(2026,9,24,h,m);return date;};
  assert.equal(inQuietHours(settings,at(23)),true);assert.equal(inQuietHours(settings,at(3)),true);assert.equal(inQuietHours(settings,at(7)),false);assert.equal(inQuietHours(settings,at(12)),false);
  assert.equal(inQuietHours({quietHours:{enabled:false,start:'22:00',end:'07:00'}},at(23)),false);
  const f=fixture(t),local=new LocalDataStore(path.join(f.dir,'local'));const conversation=local.createConversation();
  const task=f.store.create({goal:'Plan the trip',conversationId:conversation.id});
  f.store.update(task.id,{status:'WAITING_FOR_USER',summary:'Which dates work?'},'SETUP');
  const live=f.store.get(task.id);
  assert.equal(postOutcome(live,f.store,local,{settings,date:at(23)}),false,'held during quiet hours');
  assert.equal(local.conversation(conversation.id).messages.length,0);
  assert.equal(postOutcome(live,f.store,local,{settings,date:at(8)}),true);
  assert.equal(postOutcome(live,f.store,local,{settings,date:at(9)}),false,'stable message ID prevents a duplicate');
  assert.match(local.conversation(conversation.id).messages[0].content,/Which dates work/);
  assert.equal(postOutcome(live,f.store,local,{settings:{...settings,proactiveUpdates:'OFF'},date:at(12)}),false);
});

test('milestone updates respect the IMPORTANT setting but advance their cursor',t=>{
  const f=fixture(t),local=new LocalDataStore(path.join(f.dir,'local'));const conversation=local.createConversation();
  const task=f.store.create({goal:'Track bus fares',mode:'ONGOING',conversationId:conversation.id});
  f.store.update(task.id,{status:'SLEEPING',summary:'Fares rose 5%'},'MILESTONE_VERIFIED');
  const settings={proactiveUpdates:'IMPORTANT',quietHours:{enabled:false,start:'22:00',end:'07:00'}};
  assert.equal(postMilestones(f.store.get(task.id),f.store,local,{settings}),0);
  assert.equal(postMilestones(f.store.get(task.id),f.store,local,{settings:{...settings,proactiveUpdates:'ALL'}}),0,'already marked delivered');
});

test('host settings validate warm-up, retention, quiet hours and update preferences',t=>{
  const f=fixture(t);
  const defaults=f.store.settings();
  assert.equal(defaults.warmOnStartup,'desktop');assert.equal(defaults.idleRetention,'2h');assert.deepEqual(defaults.quietHours,{enabled:true,start:'22:00',end:'07:00'});
  const saved=f.store.setSettings({idleRetention:'30m',quietHours:{enabled:false,start:'23:30',end:'06:00'},proactiveUpdates:'IMPORTANT'});
  assert.equal(saved.idleRetention,'30m');assert.equal(f.store.settings().quietHours.start,'23:30');
  assert.throws(()=>f.store.setSettings({idleRetention:'forever'}),/idle retention/);
  assert.throws(()=>f.store.setSettings({quietHours:{enabled:true,start:'25:00',end:'06:00'}}),/quiet hours/);
  assert.throws(()=>f.store.setSettings({warmOnStartup:'sometimes'}),/warming/);
});

test('the phone can warm the model but cannot change Windows startup warming',async t=>{
  const f=fixture(t);let warms=[];
  const runtime={modelCapabilities:async()=>({}),modelState:()=>({state:'loading',model:'qwen3:30b'}),warmer:{warm:async options=>{warms.push(options);return {};}}};
  const api=new NethraApi({store:f.store,runtime});
  const result=await api.dispatch('nethra.warm',{reason:'voice'},'warm-1','android');
  assert.equal(result.model.state,'loading');assert.deepEqual(warms[0],{reason:'android:voice',priority:'interactive',force:false});
  await assert.rejects(api.dispatch('nethra.settings',{warmOnStartup:'always'},'s-1','android'),/Windows startup/);
  await api.dispatch('nethra.status',{warm:false},'status-1','android');
  assert.equal(warms.length,1,'a diagnostic status check does not warm');
});
