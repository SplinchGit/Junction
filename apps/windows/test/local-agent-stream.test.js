"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const {LocalAgentRuntime}=require("../src/local-agent-runtime");
test("streamed native calls merge by index and thinking emits metadata",async()=>{
 const requests=[],thinking=[];
 const runtime=new LocalAgentRuntime({fetchImpl:async(url,options)=>{
  if(url.endsWith('/api/show'))return {ok:true,json:async()=>({capabilities:['completion','thinking']})};
  requests.push(JSON.parse(options.body));
  const chunks=[{message:{thinking:'private thought',tool_calls:[{index:0,function:{name:'web_search',arguments:'{"que'}}]}},{message:{tool_calls:[{index:0,function:{arguments:'ry":"London"}'}}]}},{message:{content:'Ready'},done:true}];
  return {ok:true,body:(async function*(){for(const chunk of chunks)yield new TextEncoder().encode(JSON.stringify(chunk)+'\n');})()};
 }});
 const result=await runtime.chat('model',[],[],null,()=>{},null,{thinking:true,onThinking:value=>thinking.push(value)});
 assert.equal(requests[0].think,true);
 assert.equal(result.message.tool_calls.length,1);
 assert.equal(result.message.tool_calls[0].function.arguments,'{"query":"London"}');
 assert.equal(thinking.at(-1).characters,15);
 assert.doesNotMatch(JSON.stringify(thinking),/private thought/);
});
test("inference serializes across runtime instances and skips cancelled waiters",async()=>{
 const first=new LocalAgentRuntime(),second=new LocalAgentRuntime();let release;
 const order=[];
 const running=first.withInference(async()=>{order.push('first');await new Promise(resolve=>{release=resolve;});});
 await new Promise(resolve=>setImmediate(resolve));
 const controller=new AbortController();
 const cancelled=second.withInference(()=>order.push('cancelled'),controller.signal);
 const last=second.withInference(()=>order.push('last'));
 controller.abort();await assert.rejects(cancelled,error=>error.name==='AbortError');
 assert.deepEqual(order,['first']);release();await running;await last;assert.deepEqual(order,['first','last']);
});
test("thinking preference reaches routing and answer calls; unsupported models use false",async()=>{
 const requests=[];
 const runtime=new LocalAgentRuntime({fetchImpl:async(url,options)=>{
  if(url.endsWith('/api/ps'))return {ok:true,json:async()=>({models:[]})};
  if(url.endsWith('/api/show'))return {ok:true,json:async()=>({capabilities:['completion']})};
  const body=JSON.parse(options.body);requests.push(body);
  return {ok:true,json:async()=>({message:{content:body.format?JSON.stringify({intent:'code_discussion',action:'answer',authorization:'none',query:''}):'Answer'}})};
 }});
 await runtime.run({goal:'Explain this code',model:'model',thinking:true});
 assert.equal(requests.length,2);assert.ok(requests.every(request=>request.think===false));
 assert.equal((await runtime.modelCapabilities('model')).thinking,false);
});
test("30B thinking-only model always separates reasoning and has enough output budget",async()=>{
 const requests=[];
 const runtime=new LocalAgentRuntime({fetchImpl:async(url,options)=>{
  if(url.endsWith('/api/show'))return {ok:true,json:async()=>({capabilities:['completion','tools','thinking']})};
  requests.push(JSON.parse(options.body));
  return {ok:true,json:async()=>({message:{content:'Ready',thinking:'private reasoning'}})};
 }});
 const result=await runtime.chat('qwen3:30b',[{role:'user',content:'Hello'}],[],null,null,null,{thinking:false});
 assert.equal(requests[0].think,true);
 assert.ok(requests[0].options.num_predict>=1024);
 assert.equal(result.message.content,'Ready');
});
test("malformed native tool calls cannot exceed the per-turn call budget",async()=>{
 let requests=0;
 const runtime=new LocalAgentRuntime({limits:{toolCalls:2,iterations:2},fetchImpl:async(url)=>{
  if(url.endsWith('/api/ps'))return {ok:true,json:async()=>({models:[]})};
  return {ok:true,json:async()=>({message:requests++?{content:'Invalid requests were rejected.'}:{tool_calls:Array.from({length:20},()=>({function:{name:'web_search',arguments:'{bad'}}))}})};
 }});
 const result=await runtime.run({goal:'Explain invalid requests',model:'model'});
 assert.equal(result.toolCalls,2);assert.equal(result.toolsExecuted,0);
});
