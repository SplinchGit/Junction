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
  assert.deepEqual(load.body,{model:'qwen3:30b',keep_alive:'2h',options:{num_ctx:8192}});
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

function streamingRuntime(firstEvents){
  const bodies=[];
  const ndjson=events=>({ok:true,status:200,body:(async function*(){for(const event of events)yield Buffer.from(JSON.stringify(event)+'\n');})()});
  const fetchImpl=async(url,options={})=>{
    if(String(url).endsWith('/api/ps'))return {ok:true,json:async()=>({models:[{name:'qwen3:30b',context_length:8192}]})};
    const body=JSON.parse(options.body);bodies.push(body);
    if(bodies.length===1)return ndjson(firstEvents);
    return ndjson([{message:{content:'Hello there.'}},{done:true,eval_count:4,prompt_eval_count:20,eval_duration:2e8,message:{}}]);
  };
  return {bodies,agent:new LocalAgentRuntime({toolRegistry:new LocalAgentToolRegistry({researchCoordinator:{run:async()=>({sources:[]})}}),fetchImpl})};
}
const thinkingEvents=count=>Array.from({length:count},(_,i)=>({message:{thinking:`t${i} `}}));

test('runaway thinking is stopped at the budget and the model answers from its reasoning so far',async()=>{
  const {agent,bodies}=streamingRuntime([...thinkingEvents(2000),{done:true,eval_count:2000,message:{}}]);
  const result=await agent.chatOnce('qwen3:30b',[{role:'user',content:'Nethraaaaa'}],[],null,()=>{},null,{thinking:true,onThinking:()=>{},thinkingBudget:256});
  assert.equal(bodies.length,2);
  const continuation=bodies[1].messages.at(-1);
  assert.equal(continuation.role,'assistant');assert.equal(continuation.content,'');
  assert.match(continuation.thinking,/^t0 .*t255/s);assert.doesNotMatch(continuation.thinking,/t256 /);
  assert.equal(result.message.content,'Hello there.');assert.equal(result.thinkingBudgetReached,true);
  assert.equal(result.eval_count,4+256);
});

test('a reply that starts answering within budget is never cut',async()=>{
  const {agent,bodies}=streamingRuntime([...thinkingEvents(100),{message:{content:'Fine.'}},{done:true,eval_count:101,message:{}}]);
  const result=await agent.chatOnce('qwen3:30b',[{role:'user',content:'hi'}],[],null,()=>{},null,{thinking:true,onThinking:()=>{},thinkingBudget:256});
  assert.equal(bodies.length,1);assert.equal(result.message.content,'Fine.');assert.equal(result.thinkingBudgetReached,undefined);
});

test('finite reasoning budgets stream and stop even without progress subscribers',async()=>{
  const {agent,bodies}=streamingRuntime([...thinkingEvents(2000),{done:true,message:{}}]);
  const result=await agent.chatOnce('qwen3:30b',[{role:'user',content:'Hello'}],[],null,null,null,{thinkingBudget:96});
  assert.equal(bodies[0].stream,true);
  assert.equal(bodies.length,2);
  assert.equal(result.message.content,'Hello there.');
});

test('thinking notifications are coalesced but deliver the final character count',async()=>{
  const {agent}=streamingRuntime([...thinkingEvents(100),{message:{content:'Fine.'}},{done:true,message:{}}]);
  const updates=[];
  await agent.chatOnce('qwen3:30b',[],[],null,null,null,{onThinking:value=>updates.push(value),thinkingBudget:256});
  assert.ok(updates.length<=3,`received ${updates.length} notifications`);
  assert.equal(updates.at(-1).characters,thinkingEvents(100).map(e=>e.message.thinking).join('').length);
});

test('simple turns get the small budget and research-shaped turns keep the safety cap',async()=>{
  for(const [goal,expected] of [['Hello',96],['Nethraaaaa',256],['Are you 14b or 30?',256],['Compare the UK and Scottish housing strategies',1100]]){
    const {agent,bodies}=streamingRuntime([{message:{content:'ok'}},{done:true,eval_count:1,message:{}}]);
    agent.chatOnce=(original=>async function(...args){bodies.push({budget:args[6]?.thinkingBudget});return original.apply(this,args);})(agent.chatOnce);
    await agent.run({goal,model:'qwen3:30b',history:[],surface:'android-relay',onProgress:async()=>{}}).catch(()=>{});
    assert.equal(bodies.find(item=>'budget' in item)?.budget,expected,goal);
  }
});
