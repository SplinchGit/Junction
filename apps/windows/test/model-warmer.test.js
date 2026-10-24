'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ModelWarmer}=require('../src/model-warmer');
const {LocalAgentRuntime,InferenceCoordinator}=require('../src/local-agent-runtime');
const {LocalAgentToolRegistry}=require('../src/local-agent-tools');

const GiB=1024**3;
function ollama({resident=false,loadFails=false,loadGate=null,size=19*GiB}={}){
  const calls=[];let loaded=resident;
  const fetchImpl=async(url,options={})=>{
    const path=new URL(String(url)).pathname,body=options.body?JSON.parse(options.body):null;calls.push({path,body});
    if(path==='/api/ps')return {ok:true,json:async()=>({models:loaded?[{name:'qwen3:30b',model:'qwen3:30b',context_length:4096,size,size_vram:10*GiB}]:[]})};
    if(path==='/api/tags')return {ok:true,json:async()=>({models:[{name:'qwen3:30b',size}]})};
    if(path==='/api/generate'){if(loadGate)await loadGate;if(loadFails)return {ok:false,status:500,json:async()=>({error:'cudaMalloc failed: out of memory'})};loaded=true;return {ok:true,json:async()=>({done:true,load_duration:48e9})};}
    if(path==='/api/chat')return {ok:true,json:async()=>({message:{role:'assistant',content:'Hi.'},eval_count:2,eval_duration:1e8})};
    throw new Error(`unexpected ${path}`);
  };
  return {calls,fetchImpl,generate:()=>calls.filter(call=>call.path==='/api/generate')};
}

test('simultaneous warm requests from many clients share one load',async()=>{
  const o=ollama();const warmer=new ModelWarmer({fetchImpl:o.fetchImpl,freeMemory:()=>32*GiB});
  const results=await Promise.all([1,2,3,4,5].map(n=>warmer.warm({reason:`client${n}`})));
  assert.equal(o.generate().length,1);
  assert.ok(results.every(result=>result.outcome==='loaded'));
  assert.equal(warmer.state().state,'ready');
});

test('a load request generates nothing: no prompt, messages, tools or format',async()=>{
  const o=ollama();const warmer=new ModelWarmer({fetchImpl:o.fetchImpl,freeMemory:()=>32*GiB,retention:()=>'30m'});
  await warmer.warm({reason:'startup'});
  const [load]=o.generate();
  assert.deepEqual(Object.keys(load.body).sort(),['keep_alive','model','options']);
  assert.equal(load.body.keep_alive,'30m');assert.equal(load.body.options.num_ctx,4096);
});

test('an already resident model is never reloaded',async()=>{
  const o=ollama({resident:true});const warmer=new ModelWarmer({fetchImpl:o.fetchImpl});
  const result=await warmer.warm({reason:'chat_open',priority:'interactive'});
  assert.equal(result.outcome,'already_resident');assert.equal(o.generate().length,0);
});

test('memory pressure defers automatic warming but an explicit load proceeds',async()=>{
  const o=ollama();const warmer=new ModelWarmer({fetchImpl:o.fetchImpl,freeMemory:()=>2*GiB});
  const deferred=await warmer.warm({reason:'startup'});
  assert.equal(deferred.outcome,'memory_pressure');assert.equal(deferred.state,'deferred');assert.equal(o.generate().length,0);
  const forced=await warmer.warm({reason:'manual',priority:'interactive',force:true});
  assert.equal(forced.outcome,'loaded');assert.equal(o.generate().length,1);
});

test('a failed warm-up cools down without blocking ordinary chat, then retries',async()=>{
  let now=1_000_000;const o=ollama({loadFails:true});
  const warmer=new ModelWarmer({fetchImpl:o.fetchImpl,freeMemory:()=>32*GiB,now:()=>now});
  assert.equal((await warmer.warm({reason:'startup'})).outcome,'failed');
  assert.equal(warmer.state().state,'failed');
  now+=1000;assert.equal((await warmer.warm({reason:'status'})).outcome,'cooldown');
  assert.equal(o.generate().length,1,'cooldown prevents a reload storm');
  // Ordinary chat does not consult the warmer's cooldown at all.
  const agent=new LocalAgentRuntime({toolRegistry:new LocalAgentToolRegistry({researchCoordinator:{}}),fetchImpl:o.fetchImpl,warmer,coordinator:new InferenceCoordinator()});
  const reply=await agent.chatOnce('qwen3:30b',[{role:'user',content:'Hi'}],[],null);
  assert.equal(reply.message.content,'Hi.');
  now+=20_000;assert.equal((await warmer.warm({reason:'chat_open',priority:'interactive'})).outcome,'failed','interactive retry after its shorter cooldown');
  assert.equal(o.generate().length,2);
});

test('warming never holds the inference slot: chat proceeds while a load is pending',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve);const o=ollama({loadGate:gate});
  const coordinator=new InferenceCoordinator();
  const agent=new LocalAgentRuntime({toolRegistry:new LocalAgentToolRegistry({researchCoordinator:{}}),fetchImpl:o.fetchImpl,freeMemory:()=>32*GiB,coordinator});
  const warming=agent.warmer.warm({reason:'startup'});
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(agent.warmer.state().state,'loading');
  let ran=false;await agent.withInference(async()=>{ran=true;},null,{priority:'interactive'});
  assert.equal(ran,true,'the slot was free during the load');
  release();await warming;assert.equal(agent.warmer.state().state,'ready');
});

test('chat keep_alive follows the idle-retention setting',async()=>{
  const o=ollama({resident:true});let retention='4h';
  const agent=new LocalAgentRuntime({toolRegistry:new LocalAgentToolRegistry({researchCoordinator:{}}),fetchImpl:o.fetchImpl,retention:()=>retention,coordinator:new InferenceCoordinator()});
  await agent.chatOnce('qwen3:30b',[{role:'user',content:'Hi'}],[],null);
  retention='15m';await agent.chatOnce('qwen3:30b',[{role:'user',content:'Hi'}],[],null);
  assert.deepEqual(o.calls.filter(call=>call.path==='/api/chat').map(call=>call.body.keep_alive),['4h','15m']);
});

test('an unreachable Ollama reports unavailable rather than loading',async()=>{
  const warmer=new ModelWarmer({fetchImpl:async()=>{throw new Error('ECONNREFUSED');}});
  const result=await warmer.warm({reason:'startup'});
  assert.equal(result.outcome,'unavailable');assert.equal(warmer.state().state,'unavailable');
});

test('interactive runs report a cold start phase before reading the prompt',async()=>{
  const o=ollama();const phases=[];
  const agent=new LocalAgentRuntime({toolRegistry:new LocalAgentToolRegistry({researchCoordinator:{}}),fetchImpl:o.fetchImpl,coordinator:new InferenceCoordinator()});
  await agent.run({goal:'Hello',model:'qwen3:30b',history:[],surface:'desktop',onProgress:async progress=>{if(progress.phase)phases.push(progress.phase);}}).catch(()=>{});
  assert.equal(phases[0],'queued');assert.equal(phases[1],'loading_model');
});
