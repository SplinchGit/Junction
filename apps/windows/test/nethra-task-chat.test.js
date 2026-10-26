'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseTaskChatControl,correctTaskClaims,handleNethraChat}=require('../src/nethra-chat');
const {LocalAgentRuntime}=require('../src/local-agent-runtime');

test('short owner commands in a task chat are recognised; questions and negations are not',()=>{
  for(const text of ["We're gunna pass for now?",'Ok cool so I think gpt updated you with that. We\'re gunna pass for now?','pause','Hold off on it','Leave it there for today','Can you pause it?'])assert.equal(parseTaskChatControl(text)?.command,'pause',text);
  for(const text of ['carry on','Resume please','keep going'])assert.equal(parseTaskChatControl(text)?.command,'continue',text);
  for(const text of ["Don't pause it",'Oki so... Thoughts on this task so far?','How long does a pause take?','Should we pause it?','You know you can work with codex to implement new code right? Or at least keep going with a task instead of stopping... I wonder why'])assert.equal(parseTaskChatControl(text),null,text);
});

function fakeApi(objectives){
  const calls=[];
  return {calls,dispatch:async(type,payload)=>{calls.push([type,payload]);
    if(type==='nethra.list')return {objectives};
    if(type==='nethra.get'){const task=objectives.find(item=>item.id===payload.id);return {task:{...task,revision:3},progress:{}};}
    if(type==='nethra.control')return {task:{...objectives.find(item=>item.id===payload.id),status:payload.action==='pause'?'PAUSED':'ACTIVE'}};
    throw new Error(type);}};
}

test('"pass for now" in a task chat really pauses that task',async()=>{
  const api=fakeApi([{id:'t1',goal:'Self Improvement',status:'SLEEPING',conversationId:'chat-1'},{id:'t2',goal:'Track emails',status:'SLEEPING',conversationId:'chat-2'}]);
  const reply=await handleNethraChat({api,content:"We're gunna pass for now?",conversationId:'chat-1'});
  assert.match(reply,/^Paused “Self Improvement”/);
  assert.deepEqual(api.calls.find(([type])=>type==='nethra.control')[1],{id:'t1',action:'pause',revision:3});
});

test('the same words in a chat without its own task stay ordinary conversation',async()=>{
  const api=fakeApi([{id:'t1',goal:'Self Improvement',status:'SLEEPING',conversationId:'chat-1'}]);
  assert.equal(await handleNethraChat({api,content:'pause',conversationId:'other-chat'}),null);
  assert.ok(!api.calls.some(([type])=>type==='nethra.control'));
});

test('a reply claiming a pause that did not happen is corrected against the real status',()=>{
  const running={goal:'Self Improvement',status:'SLEEPING'},paused={goal:'Self Improvement',status:'PAUSED'};
  assert.match(correctTaskClaims("Understood. I'll pause the objective for now.",running),/Correction from Junction: “Self Improvement” is not paused; it is sleeping/);
  assert.equal(correctTaskClaims('The objective is paused per your request.',paused),'The objective is paused per your request.');
  assert.match(correctTaskClaims("I'll resume work on it now.",paused),/is still paused/);
  assert.equal(correctTaskClaims("I'll pause.",null),"I'll pause.");
});

test('every chat reply passes through the host review hook',async()=>{
  const runtime=new LocalAgentRuntime({reviewReply:(content,request)=>`${content} [reviewed ${request.conversationId}]`});
  runtime.runUnreviewed=async()=>({content:'Hello'});
  assert.equal((await runtime.run({conversationId:'c1'})).content,'Hello [reviewed c1]');
});
