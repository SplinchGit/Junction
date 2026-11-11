'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto');
const {NethraStore}=require('../src/nethra-store');
const {DeviceCommandStore}=require('../src/device-commands');
const {NethraApi}=require('../src/nethra-api');
const {LocalDataStore}=require('../src/local-data');
const {ownerQuestion}=require('../src/nethra-task-contract');
const {handleOwnerWorkInstruction}=require('../src/owner-work-instruction');
const {queueOutcomeNotification,notificationDeliveryPolicy}=require('../src/nethra-conversation-report');

function fixture(t,{reason='OWNER_PREFERENCE',blocking=true,enabled=true}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-voice-invite-'));
  let now=1800000000000;
  const store=new NethraStore(dir,{now:()=>now});
  const options={now:()=>now,signer:{instanceId:'host',spki:'test',sign:()=> 'test'}};
  let queue=new DeviceCommandStore(dir,options);
  t.after(()=>{queue.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});
  assert.equal(store.settings().voiceInvitations,false);
  store.setSettings({voiceInvitations:enabled,notificationDeviceId:'phone',quietHours:{enabled:false,start:'22:00',end:'07:00'}});
  let task=store.create({goal:'Draft funding plan'});
  const {question,questions}=ownerQuestion(task,task,{question:'Which country should this plan cover?',reason,blocking},now);
  task=store.save({...task,questions,status:'WAITING_FOR_USER'},'ASKED_OWNER');
  const policy=command=>notificationDeliveryPolicy(command,store);
  return {dir,store,task,question,policy,get queue(){return queue;},
    enqueue:()=>queueOutcomeNotification(store.get(task.id),store,queue),
    pull:(device='phone')=>queue.pull(device,{notificationPolicy:policy}),
    action:(id,notificationAction)=>queue.result('phone',{id,state:'SUCCEEDED',result:{notificationAction}},{notificationPolicy:policy}),
    optIn:value=>store.setSettings({voiceInvitations:value}),advance:ms=>now+=ms,
    reopen(){queue.close();queue=new DeviceCommandStore(dir,options);}};
}

test('a blocking owner decision invites only the preferred phone once across status transitions and restart',t=>{
  const f=fixture(t);
  const command=f.enqueue();
  assert.equal(command.args.voiceInvite,true);
  assert.equal(command.args.questionId,f.question.id);
  assert.equal(command.args.reply,undefined);
  assert.doesNotMatch(command.args.body,/Which country/);
  assert.deepEqual(f.pull('another-phone'),[]);
  assert.equal(JSON.parse(f.pull()[0].body).args.voiceInvite,true);
  f.store.save({...f.store.get(f.task.id),status:'PAUSED'},'PAUSED');
  f.store.save({...f.store.get(f.task.id),status:'WAITING_FOR_USER'},'RESUMED');
  f.reopen();
  assert.equal(f.enqueue().id,command.id);
  assert.equal(f.queue.list().length,1);
});

test('opt-out and non-discussion questions keep ordinary reply notifications',t=>{
  const optedOut=fixture(t,{enabled:false}),access=fixture(t,{reason:'ACCESS'}),checkIn=fixture(t,{reason:'PROGRESS',blocking:false});
  for(const f of [optedOut,access,checkIn]){
    const command=f.enqueue();
    assert.equal(command.args.voiceInvite,undefined);
    assert.equal(command.args.reply,true);
    f.pull();
    assert.throws(()=>f.action(command.id,'ANSWER'),/notification action/);
  }
});

test('quiet hours, changed decision and opt-out are checked on delivery and reminder',t=>{
  const f=fixture(t);
  const invite=f.enqueue();
  f.pull();
  const result=f.action(invite.id,'SNOOZE');
  assert.ok(result.ownerAction.reminderId);
  assert.deepEqual(f.pull(),[]);
  f.advance(3600000);
  const reminder=f.queue.get(result.ownerAction.reminderId);
  assert.equal(reminder.args.questionId,f.question.id);
  f.store.setSettings({quietHours:{enabled:true,start:'22:00',end:'07:00'}});
  assert.equal(notificationDeliveryPolicy(reminder,f.store,{date:new Date(2026,10,10,23)}),'hold');
  f.optIn(false);
  assert.equal(f.policy(reminder),'cancel');
  f.optIn(true);
  f.store.save({...f.store.get(f.task.id),questions:[{...f.question,status:'ANSWERED'}]},'OWNER_INPUT');
  assert.equal(f.policy(reminder),'cancel');
});

test('accepting an invitation over the paired API records acknowledgement without answering or waking work',async t=>{
  const f=fixture(t),command=f.enqueue();
  f.pull();
  const api=new NethraApi({store:f.store,deviceCommands:f.queue});
  const accepted=await api.dispatch('nethra.device.result',{deviceId:'phone',id:command.id,state:'SUCCEEDED',result:{notificationAction:'ANSWER'}},'accept-voice-invite','android');
  assert.equal(accepted.ownerAction.disposition,'ACKNOWLEDGED');
  f.reopen();
  assert.equal(f.action(command.id,'SNOOZE').ownerAction.action,'ANSWER');
  assert.equal(f.queue.list().length,1);
  assert.equal(f.store.get(f.task.id).questions[0].status,'OPEN');
  assert.equal(f.store.get(f.task.id).status,'WAITING_FOR_USER');
  assert.deepEqual(f.store.attention(f.task.id),[]);
});

test('existing reply, pending approval and muted project do not get an invitation',t=>{
  const ordinary=fixture(t,{enabled:false});
  const original=ordinary.enqueue();
  ordinary.optIn(true);
  assert.equal(ordinary.enqueue().id,original.id);
  assert.equal(ordinary.queue.list().length,1);

  const f=fixture(t),task=f.store.get(f.task.id);
  f.store.save({...task,status:'ACTIVE'},'ACTIVE');
  const lease=f.store.claim('test');
  f.store.requestApproval(task.id,{tool:'write_file',args:{path:'plan.txt'},category:'LOCAL_WRITE',key:'write-plan'},lease.token);
  const approval=f.enqueue();
  assert.ok(approval.args.approvalId);
  assert.equal(approval.args.voiceInvite,undefined);

  const muted=fixture(t);
  muted.store.save({...muted.store.get(muted.task.id),projectId:'funding'},'PROJECT_ASSIGNED');
  muted.store.setSettings({projectNotifications:{funding:'OFF'}});
  assert.equal(muted.enqueue(),null);
});

test('an expired invitation cannot be accepted even if its question is still open',t=>{
  const f=fixture(t),invite=f.enqueue();
  f.pull();
  f.advance(24*3600000);
  assert.equal(f.action(invite.id,'ANSWER').ownerAction.disposition,'SUPPRESSED');
  assert.equal(f.store.get(f.task.id).questions[0].status,'OPEN');
});

test('a signed invitation opens the exact task chat and its recognized owner answer resumes that task once',async t=>{
  const f=fixture(t);
  const localData=new LocalDataStore(path.join(f.dir,'local-data'));
  const api=new NethraApi({store:f.store,localData,deviceCommands:f.queue});
  const {privateKey,publicKey}=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const spki=publicKey.export({type:'spki',format:'der'}).toString('base64');
  f.queue.signer={instanceId:'host',spki,sign:body=>crypto.sign('sha256',body,privateKey).toString('base64')};
  f.enqueue();
  const {commands:[envelope]}=await api.dispatch('nethra.device.pull',{deviceId:'phone'},'pull-voice-invitation','android');
  assert.equal(envelope.spki,spki);
  assert.equal(crypto.verify('sha256',Buffer.from(envelope.body),publicKey,Buffer.from(envelope.signature,'base64')),true);
  const {args:invitation,id:invitationCommandId}=JSON.parse(envelope.body);
  const unrelated=f.store.create({goal:'Unrelated task',conversationId:'unrelated-chat'});
  localData.ensureConversation(unrelated.conversationId);
  const open=(id,questionId=invitation.questionId,deviceId='phone')=>api.dispatch('nethra.openChat',{id,invitationQuestionId:questionId,invitationCommandId,deviceId},'open-invitation','android');

  await assert.rejects(open(unrelated.id),/no longer pending/);
  await assert.rejects(open(invitation.taskId,'unrelated-question'),/no longer pending/);
  await assert.rejects(open(invitation.taskId,invitation.questionId,'different-phone'),/no longer pending/);
  assert.equal(f.store.get(invitation.taskId).conversationId,null);
  const opened=await open(invitation.taskId);
  assert.equal(opened.created,true);
  assert.equal(opened.conversationId,f.store.get(invitation.taskId).conversationId);
  assert.notEqual(opened.conversationId,unrelated.conversationId);
  assert.ok(localData.conversation(opened.conversationId));
  assert.deepEqual(await open(invitation.taskId),{conversationId:opened.conversationId,created:false,invitationEventId:invitation.eventId});
  assert.equal(f.queue.get(invitationCommandId).ownerAction.action,'ANSWER');

  f.optIn(false);
  await assert.rejects(open(invitation.taskId),/no longer pending/);
  f.optIn(true);
  // This is recognized speech entering the normal host path, without a microphone or Android session.
  const ownerTurn={content:'Use the United Kingdom.',conversationId:opened.conversationId,requestId:'invited-owner-answer',source:'android',api,store:f.store,
    ownerWork:async()=>{throw Error('Voice direction escaped the existing task path');}};
  assert.match(await handleOwnerWorkInstruction(ownerTurn),/saved your answer/i);
  await handleOwnerWorkInstruction(ownerTurn);
  const task=f.store.get(invitation.taskId);
  assert.equal(task.status,'ACTIVE');
  assert.equal(task.questions.find(question=>question.id===invitation.questionId).answer,ownerTurn.content);
  assert.equal(task.questions.find(question=>question.id===invitation.questionId).status,'ANSWERED');
  assert.equal(task.ownerInputs.filter(input=>input.requestId===ownerTurn.requestId).length,1);
  assert.equal(f.store.get(unrelated.id).ownerInputs.length,0);
  await assert.rejects(open(invitation.taskId),/no longer pending/);
  assert.deepEqual(await api.dispatch('nethra.openChat',{id:task.id},'open-task-chat','android'),{conversationId:opened.conversationId,created:false});
});

test('openChat rejects expired or declined signed invitations while the task remains available',async t=>{
  for(const state of ['expired','declined']){
    const f=fixture(t),api=new NethraApi({store:f.store,localData:new LocalDataStore(path.join(f.dir,'local')),deviceCommands:f.queue});
    const invite=f.enqueue();f.pull();
    if(state==='expired')f.advance(24*3600000);
    else f.action(invite.id,'DISMISS');
    await assert.rejects(api.dispatch('nethra.openChat',{id:f.task.id,invitationQuestionId:f.question.id,invitationCommandId:invite.id,deviceId:'phone'},`open-${state}`,'android'),/no longer pending/);
    assert.equal(f.store.get(f.task.id).conversationId,null);
    assert.equal(f.store.get(f.task.id).questions[0].status,'OPEN');
  }
});
