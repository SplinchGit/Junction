'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {LocalAgentRuntime}=require('../src/local-agent-runtime');
const {LocalAgentToolRegistry}=require('../src/local-agent-tools');
const {buildWorldInferencePayload}=require('../src/world-bridge');

function runtime(resident){
  const requests=[];
  const fetchImpl=async(url,options={})=>{
    requests.push({url:String(url),body:options.body?JSON.parse(options.body):null});
    if(String(url).endsWith('/api/ps'))return {ok:true,json:async()=>({models:resident?[{name:'qwen3:30b'}]:[]})};
    if(String(url).endsWith('/api/generate'))return {ok:true,json:async()=>({done:true})};
    if(String(url).endsWith('/api/chat'))return {ok:true,json:async()=>({message:{role:'assistant',content:'Hello.'},eval_count:3,eval_duration:1e8,prompt_eval_count:10})};
    throw new Error(`unexpected ${url}`);
  };
  return {requests,agent:new LocalAgentRuntime({toolRegistry:new LocalAgentToolRegistry({researchCoordinator:{run:async()=>({sources:[]})}}),fetchImpl})};
}

test('prewarm loads a cold model once with long residency and is throttled',async()=>{
  const {agent,requests}=runtime(false);
  assert.equal(await agent.prewarm(),true);
  const load=requests.find(r=>r.url.endsWith('/api/generate'));
  assert.deepEqual(load.body,{model:'qwen3:30b',keep_alive:'2h',options:{num_ctx:4096}});
  assert.equal(await agent.prewarm(),false);
  assert.equal(requests.filter(r=>r.url.endsWith('/api/generate')).length,1);
});

test('prewarm is a no-op when the model is already resident',async()=>{
  const {agent,requests}=runtime(true);
  assert.equal(await agent.prewarm(),false);
  assert.equal(requests.some(r=>r.url.endsWith('/api/generate')),false);
});

test('chat and World calls keep the same long residency so neither evicts the other early',async()=>{
  const {agent,requests}=runtime(true);
  await agent.run({goal:'Nethraaaaa',model:'qwen3:30b',history:[],surface:'android-relay'});
  const chat=requests.find(r=>r.url.endsWith('/api/chat'));
  assert.equal(chat.body.keep_alive,'2h');
  assert.match(chat.body.messages[0].content,/reasoning proportionate/);
  assert.doesNotMatch(chat.body.messages[0].content,/\n\n\n\n/);
  assert.equal(buildWorldInferencePayload([{role:'user',content:'x'}],100).keep_alive,'2h');
});

test('a copy resident at a different context size is reloaded at the chat context',async()=>{
  const requests=[];
  const fetchImpl=async(url,options={})=>{requests.push(String(url));
    if(String(url).endsWith('/api/ps'))return {ok:true,json:async()=>({models:[{name:'qwen3:30b',context_length:2048}]})};
    return {ok:true,json:async()=>({done:true})};};
  const agent=new LocalAgentRuntime({toolRegistry:new LocalAgentToolRegistry({researchCoordinator:{}}),fetchImpl});
  assert.equal(await agent.prewarm(),true);
  assert.equal(requests.filter(url=>url.endsWith('/api/generate')).length,1);
});
