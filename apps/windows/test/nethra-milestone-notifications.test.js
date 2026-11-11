'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {NethraStore}=require('../src/nethra-store');
const {DeviceCommandStore}=require('../src/device-commands');
const {queueMilestoneNotification,notificationDeliveryPolicy}=require('../src/nethra-conversation-report');
const WINDOW=15*60_000;
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-milestone-notify-'));
 let now=Math.floor(1800000000000/WINDOW)*WINDOW+1000;
 const store=new NethraStore(dir,{now:()=>now});let queue=new DeviceCommandStore(dir,{now:()=>now});
 t.after(()=>{store.close();queue.close();fs.rmSync(dir,{recursive:true,force:true});});
 store.setSettings({notificationDeviceId:'phone',quietHours:{enabled:false,start:'22:00',end:'07:00'}});
 const task=store.create({goal:'Monitor funding',mode:'ONGOING'});
 return {store,task,get queue(){return queue;},advance:ms=>now+=ms,
  reopen(){queue.close();queue=new DeviceCommandStore(dir,{now:()=>now});},
  milestone(){return store.save({...store.get(task.id),status:'SLEEPING'},'MILESTONE_VERIFIED',{summary:'Untrusted freeform summary'});},
  enqueue(){return queueMilestoneNotification(store.get(task.id),store,queue);},
  policy:c=>notificationDeliveryPolicy(c,store)};
}
test('only verified journal milestones notify; a closed window coalesces and retries once',t=>{
 const f=fixture(t);
 f.store.save({...f.task,status:'SLEEPING',summary:'I completed everything'},'MODEL_STEP');
 assert.equal(f.enqueue(),null);
 f.milestone();f.advance(1000);f.milestone();assert.equal(f.enqueue(),null);
 f.advance(WINDOW);const command=f.enqueue();assert.ok(command);
 assert.match(command.args.body,/2 verified milestones/);assert.doesNotMatch(command.args.body,/Untrusted/);
 assert.equal(f.policy(command),'deliver');f.reopen();assert.equal(f.enqueue().id,command.id);
 assert.equal(f.queue.list().length,1);
});
test('important-only, quiet hours, new opt-in, and stopped tasks suppress progress',t=>{
 const f=fixture(t);f.milestone();f.advance(WINDOW);
 f.store.setSettings({proactiveUpdates:'IMPORTANT'});assert.equal(f.enqueue(),null);
 f.store.setSettings({proactiveUpdates:'ALL'});const command=f.enqueue();
 f.store.setSettings({quietHours:{enabled:true,start:'00:00',end:'23:59'}});
 assert.equal(notificationDeliveryPolicy(command,f.store,{date:new Date(2026,10,10,12)}),'hold');
 f.store.setSettings({proactiveUpdates:'IMPORTANT'});assert.equal(f.policy(command),'cancel');
 f.store.setSettings({proactiveUpdates:'ALL',quietHours:{enabled:false,start:'22:00',end:'07:00'}});
 f.store.save({...f.store.get(f.task.id),status:'BLOCKED'},'BLOCKED');
 assert.equal(f.enqueue(),null);assert.equal(f.policy(command),'cancel');
});
test('newer milestones replace an undelivered batch; owner redirection invalidates old progress',t=>{
 const f=fixture(t);f.milestone();f.advance(WINDOW);const old=f.enqueue();
 f.milestone();assert.equal(f.policy(old),'cancel');assert.equal(f.enqueue(),null);
 f.advance(WINDOW);const next=f.enqueue();assert.notEqual(next.id,old.id);
 assert.match(next.args.body,/1 verified milestone/);
 const task=f.store.get(f.task.id);
 f.store.edit(task.id,{},task.revision,'new-direction',{execution:'replan',instruction:'Monitor a different funding source'});
 assert.equal(f.policy(next),'cancel');assert.equal(f.enqueue(),null);
});
test('the existing runner evidence check feeds notifications without treating unchanged monitoring as progress',async t=>{
 const {NethraRunner}=require('../src/nethra-runner');
 const f=fixture(t);
 fs.writeFileSync(path.join(f.task.workspace,'facts.txt'),'Monitor funding eligibility using this saved source.');
 const runtime={withInference:fn=>fn(),chat:async()=>({message:{role:'assistant',content:'',tool_calls:[
  {function:{name:'read_file',arguments:{path:'facts.txt'}}},
  {function:{name:'update_plan',arguments:{steps:['Read funding source'],completedSteps:['Read funding source']}}},
  {function:{name:'finish_objective',arguments:{summary:'Checked the saved funding source.'}}}
 ]}})};
 const runner=new NethraRunner({store:f.store,runtime,now:f.store.now});
 await runner.execute(f.task);assert.equal(f.store.milestoneEvents(f.task.id).length,1,JSON.stringify(f.store.get(f.task.id).evidence));
 f.advance(WINDOW);const first=f.enqueue();assert.ok(first);
 await runner.execute(f.store.get(f.task.id));
 assert.equal(f.store.milestoneEvents(f.task.id).length,1);
 assert.equal(f.enqueue().id,first.id);
});
test('a clock rollback cannot hide a newer post-redirect journal milestone',t=>{
 const f=fixture(t);f.advance(1000);f.milestone();f.advance(-500);
 const task=f.store.get(f.task.id);
 f.store.edit(task.id,{},task.revision,'redirect',{execution:'replan',instruction:'Monitor the revised source'});
 const latest=f.milestone();f.advance(WINDOW);
 const command=f.enqueue();assert.ok(command);
 assert.match(command.args.body,/1 verified milestone/);
 assert.equal(f.policy(command),'deliver');
 assert.equal(f.store.get(latest.id).status,'SLEEPING');
});
test('fresh device opt-in and deletion cannot replay a queued milestone',t=>{
 const f=fixture(t);f.milestone();f.advance(WINDOW);const command=f.enqueue();
 f.advance(1000);f.store.setSettings({notificationDeviceId:null});f.store.setSettings({notificationDeviceId:'phone'});
 assert.equal(f.enqueue(),null);assert.equal(f.policy(command),'cancel');
 f.milestone();f.advance(WINDOW);const next=f.enqueue();assert.ok(next);
 f.store.remove(f.task.id,'delete');
 assert.equal(f.policy(next),'cancel');
 assert.equal(queueMilestoneNotification(f.task,f.store,f.queue),null);
});

test('important-only project preference suppresses an already queued milestone',t=>{
 const f=fixture(t);
 f.store.save({...f.task,projectId:'funding'},'PROJECT_ASSIGNED');
 f.milestone();f.advance(WINDOW);
 const queued=f.enqueue();assert.ok(queued);
 f.store.setSettings({projectNotifications:{funding:'IMPORTANT'}});
 assert.equal(f.policy(queued),'cancel');assert.equal(f.enqueue(),null);
 const task=f.store.save({...f.store.get(f.task.id),status:'COMPLETED'},'DONE');
 const {queueOutcomeNotification}=require('../src/nethra-conversation-report');
 assert.ok(queueOutcomeNotification(task,f.store,f.queue));
});

test('related tasks share one durable project milestone alert and stale members cancel it',t=>{
 const f=fixture(t);
 const {queueProjectMilestoneNotifications}=require('../src/nethra-conversation-report');
 const first=f.store.save({...f.task,projectId:'funding',status:'SLEEPING'},'MILESTONE_VERIFIED');
 const second=f.store.save({...f.store.create({goal:'Track grant deadlines',projectId:'funding'}),status:'SLEEPING'},'MILESTONE_VERIFIED');
 assert.deepEqual(queueProjectMilestoneNotifications(f.store,f.queue),[]);
 f.advance(WINDOW);
 const [group]=queueProjectMilestoneNotifications(f.store,f.queue);
 assert.match(group.args.body,/2 verified milestones across 2 tasks/);
 assert.equal(group.args.taskId,second.id);
 assert.equal(f.policy(group),'deliver');
 f.reopen();queueProjectMilestoneNotifications(f.store,f.queue);
 assert.equal(f.queue.list().length,1);
 const reassigned=f.store.save({...f.store.get(first.id),projectId:'other-project'},'PROJECT_ASSIGNED');
 assert.equal(f.policy(group),'cancel');
 assert.deepEqual(queueProjectMilestoneNotifications(f.store,f.queue),[]);
 f.store.save({...reassigned,projectId:'funding'},'PROJECT_ASSIGNED');
 f.store.remove(first.id,'delete-project-member');
 assert.equal(f.policy(group),'cancel');
 assert.equal(f.queue.cancelForTask(first.id),1);
});
