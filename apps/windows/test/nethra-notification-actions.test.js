'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {NethraStore}=require('../src/nethra-store');
const {DeviceCommandStore}=require('../src/device-commands');
const {NethraApi}=require('../src/nethra-api');
const {queueOutcomeNotification,notificationDeliveryPolicy}=require('../src/nethra-conversation-report');
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-notification-actions-'));let now=1800000000000;
 const store=new NethraStore(dir,{now:()=>now});
 const options={now:()=>now,signer:{instanceId:'host',spki:'test',sign:()=> 'test'}};
 let queue=new DeviceCommandStore(dir,options);
 const api=new NethraApi({store,deviceCommands:queue});
 t.after(()=>{queue.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});
 await api.dispatch('nethra.settings',{notificationDeviceId:'phone',quietHours:{enabled:false,start:'22:00',end:'07:00'}},'select-phone','android');
 let task=store.create({goal:'Research funding'});task=store.save({...task,status:'COMPLETED'},'COMPLETED');
 const command=queueOutcomeNotification(task,store,queue);
 const pull=()=>api.dispatch('nethra.device.pull',{deviceId:'phone'});
 await pull();
 const act=(action,id=command.id,deviceId='phone')=>api.dispatch('nethra.device.result',{deviceId,id,state:'SUCCEEDED',result:{notificationAction:action}});
 return {api,store,task,command,pull,act,get queue(){return queue;},advance:ms=>now+=ms,reopen(){queue.close();queue=new DeviceCommandStore(dir,options);api.deviceCommands=queue;}};
}
test('snooze is durable and idempotent, delivers once when due, and never wakes task work',async t=>{
 const f=await fixture(t);const reply=await f.act('SNOOZE');
 assert.equal(reply.ownerAction.action,'SNOOZE');
 const reminder=f.queue.list().find(c=>c.id!==f.command.id);assert.ok(reminder);
 assert.equal(reminder.notificationSourceEventId,f.command.args.eventId);
 assert.equal(reminder.notBefore,f.command.createdAt+3600000);
 assert.notEqual(reminder.args.eventId,f.command.args.eventId);
 assert.deepEqual((await f.pull()).commands,[]);
 f.reopen();await f.act('SNOOZE');assert.equal(f.queue.list().length,2);
 f.advance(3600000);const delivered=(await f.pull()).commands;
 assert.equal(delivered.length,1);const body=JSON.parse(delivered[0].body);
 assert.equal(body.notificationActions,1);assert.equal(body.id,reminder.id);
 await f.api.dispatch('nethra.device.result',{deviceId:'phone',id:reminder.id,state:'SUCCEEDED',result:{historySaved:true}});
 assert.deepEqual((await f.pull()).commands,[]);
 assert.equal(f.store.get(f.task.id).status,'COMPLETED');
 assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM attention').get().n,0);
});
test('dismiss and duplicate actions are final for that notification delivery',async t=>{
 const f=await fixture(t);await f.act('DISMISS');f.reopen();
 assert.equal((await f.act('DISMISS')).ownerAction.action,'DISMISS');
 assert.equal((await f.act('SNOOZE')).ownerAction.action,'DISMISS');
 assert.equal(f.queue.list().length,1);assert.deepEqual((await f.pull()).commands,[]);
});
test('actions are bound to a delivered notification and cannot target diagnostics or another phone',async t=>{
 const f=await fixture(t);
 await assert.rejects(f.act('SNOOZE',f.command.id,'other-phone'),/not delivered/);
 await assert.rejects(f.act('APPROVE'),/notification action/);
 const diagnostic=f.queue.enqueue({kind:'STATUS',deviceId:'phone',requestedBy:'owner',requestId:'diagnostic'});
 await f.pull();await assert.rejects(f.act('SNOOZE',diagnostic.id),/notification/);
 assert.equal(f.queue.list().length,2);
});
test('reminders recheck quiet policy and current task state, including deletion',async t=>{
 const f=await fixture(t);await f.act('SNOOZE');f.advance(3600000);
 f.store.setSettings({proactiveUpdates:'OFF'});
 assert.deepEqual((await f.pull()).commands,[]);
 assert.equal(f.queue.list().find(c=>c.id!==f.command.id).state,'CANCELLED');
 f.store.remove(f.task.id,'delete');
 assert.equal((await f.act('SNOOZE')).ownerAction.action,'SNOOZE');
 assert.equal(f.queue.list().length,2);
});
test('a stale owner action is acknowledged without scheduling a reminder for deleted work',async t=>{
 const f=await fixture(t);f.store.remove(f.task.id,'delete');
 const response=await f.act('SNOOZE');
 assert.equal(response.ownerAction.disposition,'SUPPRESSED');assert.equal(f.queue.list().length,1);
});
test('quiet-held notifications do not starve diagnostic device commands',async t=>{
 const f=await fixture(t);
 for(let i=0;i<50;i++)f.queue.enqueueNotification({requestId:`held-${i}`,taskId:f.task.id,deviceId:'phone',args:{eventId:`held-${i}`,taskId:f.task.id,title:'Nethra',body:'Verified update'}});
 f.queue.enqueue({kind:'STATUS',deviceId:'phone',requestedBy:'owner',requestId:'diagnostic-after-notifications'});
 const pulled=f.queue.pull('phone',{notificationPolicy:()=> 'hold'});
 assert.equal(pulled.length,1);assert.equal(JSON.parse(pulled[0].body).kind,'STATUS');
});
test('a reminder requested after delivery acknowledgement defers during quiet hours',async t=>{
 const f=await fixture(t);
 await f.api.dispatch('nethra.device.result',{deviceId:'phone',id:f.command.id,state:'SUCCEEDED',result:{historySaved:true}});
 await f.act('SNOOZE');f.advance(3600000);
 f.store.setSettings({quietHours:{enabled:true,start:'22:00',end:'07:00'}});
 const policy=date=>command=>notificationDeliveryPolicy(command,f.store,{date});
 assert.deepEqual(f.queue.pull('phone',{notificationPolicy:policy(new Date(2026,10,10,23))}),[]);
 assert.equal(f.queue.pull('phone',{notificationPolicy:policy(new Date(2026,10,11,8))}).length,1);
 assert.equal(f.queue.get(f.command.id).result.historySaved,true);
});
