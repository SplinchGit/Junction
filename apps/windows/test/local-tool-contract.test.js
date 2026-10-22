"use strict";
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {LocalAgentToolRegistry}=require('../src/local-agent-tools');
test('delegation reports real persistent work state and passes original owner scope',async()=>{
  let request;
  const tools=new LocalAgentToolRegistry({createCodeDelegation:async(task,owner)=>{request=owner;return {id:'work-1',status:'running',response:'Working on App.'};}});
  const result=JSON.parse((await tools.execute('delegate_to_codex',{task:'Change an invented folder'}, {goal:'Fix App',conversationId:'chat',allowCodeDelegation:true,audit:{}})).content);
  assert.deepEqual(request,{goal:'Fix App',conversationId:'chat'});
  assert.equal(result.status,'running');
  assert.equal(result.message,'Working on App.');
  assert.equal(result.approvalRequired,false);
  assert.equal(result.applyApprovalRequired,true);
});
test('tool schema rejects unknown fields and non-string queries before execution',async()=>{
  let requests=0;
  const tools=new LocalAgentToolRegistry({researchCoordinator:{run:async()=>{requests++;return {sources:[]};}}});
  for(const args of [{query:42},{query:'hello',exfiltrate:'private'},{query:'x'}])await assert.rejects(tools.execute('web_search',args,{validateSearch:()=> 'hello',audit:{},ledgers:[],goal:'hello'}));
  assert.equal(requests,0);
});
