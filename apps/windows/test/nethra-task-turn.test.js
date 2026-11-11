'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {NethraStore}=require('../src/nethra-store');
const {NethraRunner}=require('../src/nethra-runner');
const {isRoutineMonitor}=require('../src/nethra-scheduler');
const {LocalDataStore}=require('../src/local-data');

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-task-turn-'));
  let clock=Date.UTC(2026,9,27,12,0,0);
  const store=new NethraStore(root,{now:()=>clock});
  t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
  return {store,now:()=>clock};
}

test('a retried owner chat turn is recorded once and wakes an ongoing sleeping task',t=>{
  const {store,now}=fixture(t);
  const created=store.create({goal:'Track changes',mode:'ONGOING',conversationId:'chat-1'});
  store.update(created.id,{status:'SLEEPING',nextWakeAt:now()+86_400_000},'TEST_SLEEP');
  const first=store.chatTurn(created.id,'Check the newest evidence','chat-message-1');
  const second=store.chatTurn(created.id,'Check the newest evidence','chat-message-1');
  const saved=store.get(created.id);
  assert.equal(first.task.revision,second.task.revision);
  assert.equal(saved.ownerInputs.length,1);
  assert.equal(saved.ownerInputs[0].requestId,'chat-message-1');
  assert.ok(saved.nextWakeAt<=now()+15_000);
  assert.throws(()=>store.chatTurn(created.id,'Different message','chat-message-1'),/mismatch/i);
});

test('an owner wake on an ongoing monitor reaches inference instead of idle bookkeeping',t=>{
  const {store,now}=fixture(t);
  const task=store.create({goal:'Watch calendar changes',mode:'ONGOING',sources:['calendar'],conversationId:'chat-1'});
  store.update(task.id,{status:'SLEEPING',lastMilestoneAt:now()-60_000,nextWakeAt:now()+86_400_000},'TEST_SLEEP');
  store.chatTurn(task.id,'Please check my new question','owner-monitor-question');
  assert.equal(isRoutineMonitor(store.get(task.id),now(),()=>({status:'CONNECTED'}),false),false);
});

test('linked task chat returns one state-grounded reply and never enters a second chat agent',t=>{
  const {store}=fixture(t);
  const task=store.create({goal:'Prepare a report',conversationId:'chat-1'});
  const {handleTaskTurn}=require('../src/nethra-task-turn');
  const reply=handleTaskTurn({store,conversationId:'chat-1',content:'Please use the latest figures',requestId:'msg-1'});
  assert.match(reply,/Prepare a report/);
  assert.match(reply,/saved/i);
  assert.equal(store.get(task.id).ownerInputs.length,1);
  assert.equal(handleTaskTurn({store,conversationId:'chat-1',content:'Please use the latest figures',requestId:'msg-1'}),reply);
  assert.equal(store.get(task.id).ownerInputs.length,1);
  assert.equal(handleTaskTurn({store,conversationId:'other',content:'Hello',requestId:'msg-2'}),null);
});

test('a 10,000-character task chat message is saved whole and reaches the model unshortened',async t=>{
  const {store}=fixture(t);
  const {handleTaskTurn}=require('../src/nethra-task-turn');
  const task=store.create({goal:'Prepare a report',conversationId:'chat-1'});
  const long='Use these figures. '+'x'.repeat(9980)+'!';
  assert.equal(long.length,10000);
  assert.match(handleTaskTurn({store,conversationId:'chat-1',content:long,requestId:'long-1'}),/saved/i);
  assert.equal(store.get(task.id).ownerInputs[0].text,long);
  assert.throws(()=>store.chatTurn(task.id,long+'x','long-2'),/Invalid task chat message/);
  let seed='';
  const runtime={withInference:fn=>fn(),chat:async(_model,messages)=>{seed=messages[1].content;return {message:{role:'assistant',content:'',tool_calls:[{function:{name:'request_input',arguments:{reason:'OWNER_PREFERENCE',blocking:true,question:'Which section first?'}}}]}};}};
  await new NethraRunner({store,runtime}).execute(store.get(task.id));
  assert.equal(JSON.parse(seed).latestOwnerInput.text,long);
});

test('a task-chat answer resumes a question but an approval remains gated',t=>{
  const {store}=fixture(t);
  const {handleTaskTurn}=require('../src/nethra-task-turn');
  const question=store.create({goal:'Research a topic',conversationId:'question-chat'});
  store.update(question.id,{status:'WAITING_FOR_USER',summary:'Which source?'},'TEST_QUESTION');
  const answer=handleTaskTurn({store,conversationId:'question-chat',content:'Use the official guide',requestId:'answer-1'});
  assert.match(answer,/continu/i);
  assert.equal(store.get(question.id).status,'ACTIVE');
  assert.equal(store.get(question.id).ownerInputs.length,1);

  const gated=store.create({goal:'Replace a draft',conversationId:'approval-chat'});
  store.requestApproval(gated.id,{tool:'write_draft',args:{path:'draft.md',content:'replacement'},category:'LOCAL_WRITE',key:'approval-key'});
  const reply=handleTaskTurn({store,conversationId:'approval-chat',content:'I like it',requestId:'note-approval'});
  assert.match(reply,/approval/i);
  assert.equal(store.get(gated.id).status,'WAITING_FOR_USER');
  assert.equal(store.approvals(gated.id)[0].status,'PENDING');
});

test('a paused task records direction without resuming',t=>{
  const {store}=fixture(t);
  const {handleTaskTurn}=require('../src/nethra-task-turn');
  const task=store.create({goal:'Prepare a report',conversationId:'chat-1'});
  store.control(task.id,'pause',task.revision,'pause-1');
  const reply=handleTaskTurn({store,conversationId:'chat-1',content:'Focus on costs later',requestId:'note-paused'});
  assert.match(reply,/paused/i);
  assert.equal(store.get(task.id).status,'PAUSED');
  assert.equal(store.get(task.id).ownerInputs.length,1);
});

test('the shared owner-work entry routes linked chat to its task before generic chat work',async t=>{
  const {store}=fixture(t);
  const task=store.create({goal:'Prepare a report',conversationId:'phone-and-desktop-chat'});
  const {handleOwnerWorkInstruction}=require('../src/owner-work-instruction');
  const reply=await handleOwnerWorkInstruction({
    content:'Use the latest figures',conversationId:'phone-and-desktop-chat',requestId:'message-1',
    store,api:{dispatch:async()=>{throw Error('No explicit Nethra command expected');}},
    ownerWork:async()=>{throw Error('A linked task must not start separate work');}
  });
  assert.match(reply,/saved your message/i);
  assert.equal(store.get(task.id).ownerInputs.length,1);
});

test('an owner turn arriving during inference cancels stale tool calls and reaches the next model step',async t=>{
  const {store}=fixture(t);
  const task=store.create({goal:'Write a report',conversationId:'task-chat'});
  const staleDraft=path.join(task.workspace,'stale.md');
  let calls=0,secondSeed='';
  const runtime={withInference:fn=>fn(),chat:async(_model,messages)=>{
    calls++;
    if(calls===1){
      store.chatTurn(task.id,'Do not write the report; inspect the source first','redirect-during-inference');
      return {message:{role:'assistant',content:'',tool_calls:[{function:{name:'write_draft',arguments:{path:'stale.md',content:'Old plan'}}}]}};
    }
    secondSeed=messages[1].content;
    assert.ok(messages.filter(message=>message.role==='assistant').every(message=>!Object.hasOwn(message,'ownerInputKey')));
    return {message:{role:'assistant',content:'',tool_calls:[{function:{name:'request_input',arguments:{reason:'OWNER_PREFERENCE',blocking:true,question:'Which source should I inspect?'}}}]}};
  }};
  const result=await new NethraRunner({store,runtime}).execute(task);
  assert.equal(result.status,'WAITING_FOR_USER');
  assert.equal(calls,2);
  assert.equal(fs.existsSync(staleDraft),false);
  assert.match(secondSeed,/Do not write the report; inspect the source first/);
});

test('the task runner can answer its latest chat turn once through the shared conversation',async t=>{
  const {store,now}=fixture(t);
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-task-reply-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const localData=new LocalDataStore(directory);
  localData.ensureConversation('task-chat');
  const task=store.create({goal:'Inspect the source',conversationId:'task-chat'});
  store.chatTurn(task.id,'What have you found so far?','owner-question-1');
  let calls=0;
  const runtime={withInference:fn=>fn(),chat:async()=>({message:{role:'assistant',content:'',tool_calls:calls++===0
    ?[{function:{name:'reply_to_owner',arguments:{message:'I have not inspected the source yet. I will do that next.'}}}]
    :[{function:{name:'schedule_wake',arguments:{at:now()+60_000,reason:'Inspect the approved source next.'}}}]}})};
  const runner=new NethraRunner({store,runtime,localData});
  const result=await runner.execute(store.get(task.id));
  assert.equal(result.status,'SLEEPING');
  const replies=localData.conversation('task-chat').messages.filter(message=>message.role==='assistant');
  assert.equal(replies.length,1);
  assert.match(replies[0].content,/have not inspected the source yet/i);
  assert.equal(store.get(task.id).evidence.some(item=>item.tool==='reply_to_owner'&&item.result.posted===true),true);
});

test('a task reply returns to the owner conversation that supplied its latest message',async t=>{
  const {store,now}=fixture(t),directory=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-cross-chat-reply-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const localData=new LocalDataStore(directory);
  localData.ensureConversation('task-chat');localData.ensureConversation('ordinary-chat');
  const task=store.create({goal:'Prepare workshop notes',conversationId:'task-chat'});
  store.chatTurn(task.id,'Which result is saved?','cross-chat-question',{conversationId:'ordinary-chat'});
  let calls=0;
  const runtime={withInference:fn=>fn(),chat:async()=>({message:{role:'assistant',tool_calls:[{function:calls++===0?
    {name:'reply_to_owner',arguments:{message:'The workshop notes are still being prepared.'}}:
    {name:'schedule_wake',arguments:{at:now()+60_000,reason:'Continue preparing the notes'}}}]}})};
  await new NethraRunner({store,runtime,localData}).execute(store.get(task.id));
  assert.equal(localData.conversation('ordinary-chat').messages.filter(item=>item.role==='assistant').length,1);
  assert.equal(localData.conversation('task-chat').messages.filter(item=>item.role==='assistant').length,0);
});
