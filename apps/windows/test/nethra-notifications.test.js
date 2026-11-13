'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {NethraStore}=require('../src/nethra-store');
const {DeviceCommandStore}=require('../src/device-commands');
const {queueOutcomeNotification,notificationDeliveryPolicy}=require('../src/nethra-conversation-report');
test('outcomes use one durable device command, respect policy, and survive reopen',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-notify-'));let store=new NethraStore(dir),queue=new DeviceCommandStore(dir);
 t.after(()=>{store.close();queue.close();fs.rmSync(dir,{recursive:true,force:true});});
 store.setSettings({notificationDeviceId:'phone',quietHours:{enabled:false,start:'22:00',end:'07:00'}});
 let task=store.create({goal:'Funding',conversationId:'chat'});
 assert.equal(queueOutcomeNotification(task,store,queue),null);
 task=store.save({...task,status:'COMPLETED',summary:'Untrusted prose is not notification evidence'},'EXECUTED',{status:'COMPLETED'});
 const first=queueOutcomeNotification(task,store,queue);assert.equal(first.deviceId,'phone');assert.equal(first.args.taskId,task.id);
 assert.doesNotMatch(first.args.body,/Untrusted/);
 queue.close();queue=new DeviceCommandStore(dir);
 assert.equal(queueOutcomeNotification(task,store,queue).id,first.id);assert.equal(queue.list().length,1);
 store.setSettings({proactiveUpdates:'OFF'});assert.equal(queueOutcomeNotification(task,store,queue),null);
 store.remove(task.id,'delete');assert.equal(queueOutcomeNotification(task,store,queue),null);
});
test('notifications require explicit device selection and cannot be model-issued',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-notify-')),store=new NethraStore(dir),queue=new DeviceCommandStore(dir);
 t.after(()=>{store.close();queue.close();fs.rmSync(dir,{recursive:true,force:true});});
 const task=store.create({goal:'Funding'});assert.equal(queueOutcomeNotification(task,store,queue),null);
 assert.throws(()=>queue.enqueue({kind:'NETHRA_NOTIFICATION',requestedBy:'nethra',requestId:'forged',args:{}}),/host|Unsupported/);
 assert.throws(()=>store.setSettings({notificationDeviceId:'*'}),/notification device/);
});

test('delivery rechecks quiet hours, selected device and the authoritative task episode',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-policy-'));let now=1800000000000;
 const store=new NethraStore(dir,{now:()=>now}),queue=new DeviceCommandStore(dir,{now:()=>now,signer:{instanceId:'pc',spki:'test',sign:()=> 'test'}});
 t.after(()=>{store.close();queue.close();fs.rmSync(dir,{recursive:true,force:true});});
 store.setSettings({notificationDeviceId:'phone',quietHours:{enabled:false,start:'22:00',end:'07:00'}});
 let task=store.create({goal:'Research funding'});
 task=store.save({...task,status:'BLOCKED'},'EXECUTED',{status:'BLOCKED'});
 const command=queueOutcomeNotification(task,store,queue);
 const policy=c=>notificationDeliveryPolicy(c,store,{date:new Date(2026,10,10,12)});
 assert.equal(policy(command),'deliver');
 assert.deepEqual(queue.pull('other',{notificationPolicy:policy}),[]);
 store.setSettings({quietHours:{enabled:true,start:'00:00',end:'23:59'}});
 assert.equal(policy(command),'hold');assert.deepEqual(queue.pull('phone',{notificationPolicy:policy}),[]);
 store.setSettings({quietHours:{enabled:false,start:'00:00',end:'23:59'}});
 assert.equal(queue.pull('phone',{notificationPolicy:policy}).length,1);
 now+=121000;assert.equal(queue.pull('phone',{notificationPolicy:policy}).length,1);
 queue.result('phone',{id:command.id,state:'SUCCEEDED',result:{historySaved:true}});
 assert.deepEqual(queue.pull('phone',{notificationPolicy:policy}),[]);
 store.edit(task.id,{},task.revision,'continue',{execution:'continue',instruction:'Continue researching'});
 assert.equal(policy(command),'cancel');
 store.setSettings({notificationDeviceId:'other'});assert.equal(policy(command),'cancel');
 store.save({...store.get(task.id),status:'BLOCKED'},'BLOCKED_AGAIN');
 const next=queueOutcomeNotification(store.get(task.id),store,queue);
 now+=1000;store.setSettings({notificationDeviceId:null});store.setSettings({notificationDeviceId:'other'});
 assert.equal(policy(next),'cancel');
});

test('notification acknowledgement does not create task attention or wake completed work',async t=>{
 const {NethraApi}=require('../src/nethra-api');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-notify-api-'));
 const store=new NethraStore(dir),queue=new DeviceCommandStore(dir,{signer:{instanceId:'pc',spki:'test',sign:()=> 'test'}});
 t.after(()=>{store.close();queue.close();fs.rmSync(dir,{recursive:true,force:true});});
 store.setSettings({notificationDeviceId:'phone',quietHours:{enabled:false,start:'22:00',end:'07:00'}});
 let task=store.create({goal:'Funding'});task=store.save({...task,status:'COMPLETED'},'EXECUTED',{status:'COMPLETED'});
 const command=queueOutcomeNotification(task,store,queue),api=new NethraApi({store,deviceCommands:queue});
 const pulled=await api.dispatch('nethra.device.pull',{deviceId:'phone'});
 assert.equal(pulled.commands.length,1);
 await api.dispatch('nethra.device.result',{deviceId:'phone',id:command.id,state:'SUCCEEDED',result:{historySaved:true}});
 assert.equal(store.get(task.id).status,'COMPLETED');
 assert.equal(store.db.prepare('SELECT count(*) AS n FROM attention WHERE taskId=?').get(task.id).n,0);
});

test('real approval notifications target the exact pending request and never substitute another',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-approval-notify-')),store=new NethraStore(dir),queue=new DeviceCommandStore(dir);
 t.after(()=>{store.close();queue.close();fs.rmSync(dir,{recursive:true,force:true});});
 store.setSettings({notificationDeviceId:'phone',quietHours:{enabled:false,start:'22:00',end:'07:00'}});
 const task=store.create({goal:'Draft funding plan'}),claim=store.claim('test');
 store.requestApproval(task.id,{tool:'write_file',args:{path:'plan.txt'},category:'LOCAL_WRITE',key:'write-plan'},claim.token);
 const first=queueOutcomeNotification(store.get(task.id),store,queue);
 assert.ok(first);assert.match(first.args.body,/approval/);
 const approval=store.approvals(task.id).find(item=>item.status==='PENDING');
 assert.equal(first.args.approvalId,approval.id);
 const {NethraApi}=require('../src/nethra-api');
 const api=new NethraApi({store});
 const review=await api.dispatch('nethra.get',{id:task.id,approvalId:approval.id},'review','android');
 assert.equal(review.approvals[0].id,approval.id);
 const missing=await api.dispatch('nethra.get',{id:task.id,approvalId:'already-resolved'},'stale-review','android');
 assert.equal(missing.approvalUnavailable,true);assert.deepEqual(missing.approvals,[]);
 store.save(store.get(task.id),'REPORT_DELIVERED');
 assert.equal(queueOutcomeNotification(store.get(task.id),store,queue).id,first.id);
 store.decideApproval(approval.id,true,'decision-before-delivery');
 assert.equal(notificationDeliveryPolicy(first,store),'cancel');
});

test('maximum lifetime envelope uses one timestamp even when the clock ticks during enqueue',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-clock-'));let now=1800000000000;
 const queue=new DeviceCommandStore(dir,{now:()=>now++});
 t.after(()=>{queue.close();fs.rmSync(dir,{recursive:true,force:true});});
 const command=queue.enqueueNotification({requestId:'event',deviceId:'phone',taskId:'task',args:{eventId:'event',taskId:'task',title:'Nethra',body:'Needs input'}});
 assert.equal(command.expiresAt-command.createdAt,24*3600000);
});

test('only a current owner-input outcome offers a conversation reply',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-reply-notify-')),store=new NethraStore(dir),queue=new DeviceCommandStore(dir);
 t.after(()=>{store.close();queue.close();fs.rmSync(dir,{recursive:true,force:true});});
 store.setSettings({notificationDeviceId:'phone',quietHours:{enabled:false,start:'22:00',end:'07:00'}});
 let task=store.create({goal:'Funding research'});
 task=store.save({...task,status:'WAITING_FOR_USER'},'ASKED_OWNER');
 const command=queueOutcomeNotification(task,store,queue);
 assert.equal(command.args.reply,true);
 assert.equal(command.args.approvalId,undefined);
 assert.equal(notificationDeliveryPolicy(command,store),'deliver');
 task=store.save({...task,status:'COMPLETED'},'DONE');
 assert.equal(notificationDeliveryPolicy(command,store),'cancel');
 assert.equal(queueOutcomeNotification(task,store,queue).args.reply,undefined);
});

test('project notification rules are shared by enqueue and delivery and preserve global quiet mode',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-project-notify-')),store=new NethraStore(dir),queue=new DeviceCommandStore(dir);
 t.after(()=>{store.close();queue.close();fs.rmSync(dir,{recursive:true,force:true});});
 const {NethraApi}=require('../src/nethra-api');
 const api=new NethraApi({store,listProjects:()=>[{id:'funding',name:'Funding'},{id:'workshop',name:'Workshop'}]});
 store.setSettings({notificationDeviceId:'phone',quietHours:{enabled:false,start:'22:00',end:'07:00'}});
 const finish=(goal,projectId)=>store.save({...store.create({goal,projectId}),status:'COMPLETED'},'DONE');
 const funding=finish('Funding','funding'),workshop=finish('Workshop','workshop');
 const queued=queueOutcomeNotification(funding,store,queue);
 await assert.rejects(api.dispatch('nethra.settings',{projectNotification:{id:'funding',mode:'OFF'}},'remote','android'),/Windows/);
 await api.dispatch('nethra.settings',{projectNotification:{id:'funding',mode:'OFF'}});
 assert.equal(notificationDeliveryPolicy(queued,store),'cancel');
 assert.equal(queueOutcomeNotification(funding,store,queue),null);
 assert.ok(queueOutcomeNotification(workshop,store,queue));
 await api.dispatch('nethra.settings',{projectNotification:{id:'funding',mode:'INHERIT'}});
 assert.equal(notificationDeliveryPolicy(queued,store),'deliver');
 store.setSettings({proactiveUpdates:'OFF'});
 assert.equal(notificationDeliveryPolicy(queued,store),'cancel');
});

test('a verified code candidate notifies once and is withdrawn after apply',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-code-notify-'));
 const store=new NethraStore(dir),queue=new DeviceCommandStore(dir);
 t.after(()=>{store.close();queue.close();fs.rmSync(dir,{recursive:true,force:true});});
 const {queueCodeWorkNotification}=require('../src/nethra-conversation-report');
 store.setSettings({notificationDeviceId:'phone',quietHours:{enabled:false,start:'22:00',end:'07:00'}});
 const task=store.create({goal:'Measure context fitting'});
 const project={id:'work',autoHandoff:true,sourceObjectiveId:task.id,status:'COMPLETED',verifiedSha:'abc',updatedAt:store.now()};
 const first=queueCodeWorkNotification(task,project,store,queue);
 assert.equal(queueCodeWorkNotification(task,project,store,queue).id,first.id);
 const policy={projects:()=>[project]};
 assert.equal(notificationDeliveryPolicy(first,store,policy),'deliver');
 project.appliedAt=store.now();
 assert.equal(notificationDeliveryPolicy(first,store,policy),'cancel');
});

test('a provider hold notifies once per hold and is withdrawn when work resumes',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-code-hold-'));
 const store=new NethraStore(dir),queue=new DeviceCommandStore(dir);
 t.after(()=>{store.close();queue.close();fs.rmSync(dir,{recursive:true,force:true});});
 const {queueCodeWorkNotification}=require('../src/nethra-conversation-report');
 store.setSettings({notificationDeviceId:'phone',quietHours:{enabled:false,start:'22:00',end:'07:00'}});
 const task=store.create({goal:'Ship the change'});
 const project={id:'work',autoHandoff:true,sourceObjectiveId:task.id,status:'WAITING_CAPACITY',capacityHoldAt:1000,retryAt:5000,updatedAt:store.now()};
 const first=queueCodeWorkNotification(task,project,store,queue);
 assert.match(first.args.body,/waiting for subscription capacity/);
 // A recheck moves the retry time and the saved record, not the hold.
 project.retryAt=9000;project.updatedAt=store.now();
 assert.equal(queueCodeWorkNotification(task,project,store,queue).id,first.id);
 assert.equal(queueCodeWorkNotification({...task,status:'PAUSED'},{...project,capacityHoldAt:2000},store,queue),null);
 const policy={projects:()=>[project]};
 assert.equal(notificationDeliveryPolicy(first,store,policy),'deliver');
 project.status='RUNNING';delete project.capacityHoldAt;
 assert.equal(notificationDeliveryPolicy(first,store,policy),'cancel');
 project.status='WAITING_CAPACITY';project.capacityHoldAt=3000;
 assert.notEqual(queueCodeWorkNotification(task,project,store,queue).id,first.id);
});

test('75 minutes of active development sends one check-in only with saved evidence; waits and pauses do not count',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-code-checkin-'));
 const minute=60_000,start=Date.UTC(2026,10,12,12,0,0);let now=start;
 const store=new NethraStore(dir,{now:()=>now}),queue=new DeviceCommandStore(dir);
 t.after(()=>{store.close();queue.close();fs.rmSync(dir,{recursive:true,force:true});});
 const {queueCodeWorkNotification}=require('../src/nethra-conversation-report');
 store.setSettings({notificationDeviceId:'phone',quietHours:{enabled:true,start:'22:00',end:'07:00'}});
 let task=store.create({goal:'Self Improvement',allowCodeWork:true,conversationId:'self-improvement'});
 task=store.configure(task.id,{coordinateSelfImprovement:true},task.revision,'enable');
 const attempt={status:'RUNNING',activeAt:start,provider:'codex'};
 const project={id:'work',autoHandoff:true,sourceObjectiveId:task.id,status:'RUNNING',tasks:[{attempts:[attempt]}],updatedAt:start};
 const send=()=>queueCodeWorkNotification(task,project,store,queue,{date:new Date(now)});
 now=start+74*minute;attempt.lastEvidenceAt=start+70*minute;
 assert.equal(send(),null,'below 75 active minutes');
 now=start+80*minute;delete attempt.lastEvidenceAt;
 assert.equal(send(),null,'no saved checkpoint or verification result');
 attempt.lastEvidenceAt=start+70*minute;
 const first=send();
 assert.match(first.args.eventId,/progress-1$/);assert.match(first.args.body,/checkpoint or verification/);
 now=start+100*minute;assert.equal(send().id,first.id,'one update per interval');
 // A capacity wait of three hours adds no active time, so no second update is due.
 Object.assign(attempt,{status:'FAILED',finishedAt:start+100*minute});project.status='WAITING_CAPACITY';now=start+280*minute;
 assert.equal(send().id,first.id);
 // The second interval needs new evidence inside it, and a paused task sends nothing.
 const next={status:'RUNNING',activeAt:now,provider:'claude'};project.tasks[0].attempts.push(next);project.status='RUNNING';
 now+=60*minute;assert.equal(send(),null,'a second update needs new evidence inside its interval');
 next.lastEvidenceAt=now-5*minute;
 const paused={...task,status:'PAUSED'};
 assert.equal(queueCodeWorkNotification(paused,project,store,queue,{date:new Date(now)}),null);
 const second=send();assert.match(second.args.eventId,/progress-2$/);assert.notEqual(second.id,first.id);
 // Delivery honours quiet hours and withdraws the update once the owner limits proactive updates.
 const policy={projects:()=>[project]};
 assert.equal(notificationDeliveryPolicy(second,store,{...policy,date:new Date(2026,10,12,13,0,0)}),'deliver');
 assert.equal(notificationDeliveryPolicy(second,store,{...policy,date:new Date(2026,10,12,23,30,0)}),'hold');
 store.setSettings({proactiveUpdates:'IMPORTANT'});
 assert.equal(notificationDeliveryPolicy(second,store,{...policy,date:new Date(2026,10,12,13,0,0)}),'cancel');
});
