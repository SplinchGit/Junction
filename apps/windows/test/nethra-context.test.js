'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {CONTEXT_TOKENS,fitContext,COMPACTED}=require('../src/model-context');
const {buildWorldInferencePayload}=require('../src/world-bridge');
const {NethraRunner}=require('../src/nethra-runner');

test('every 30B caller asks for the same context, so the resident model is never reloaded',()=>{
  assert.equal(CONTEXT_TOKENS,8192);
  assert.equal(buildWorldInferencePayload([],100).options.num_ctx,CONTEXT_TOKENS);
  assert.equal(new (require('../src/model-warmer').ModelWarmer)().contextTokens,CONTEXT_TOKENS);
});

test('a long wake drops its oldest tool results instead of letting Ollama truncate silently',()=>{
  const big='x'.repeat(4000);
  const messages=[{role:'system',content:'system'},{role:'user',content:'seed'}];
  for(let i=0;i<8;i++)messages.push({role:'assistant',content:'',tool_calls:[{function:{name:'read_file',arguments:{path:`f${i}`}}}]},{role:'tool',tool_name:'read_file',content:big+i});
  const fit=fitContext(messages,[],{contextTokens:8192});
  assert.ok(fit.compacted>0);assert.equal(fit.fits,true);
  assert.equal(messages[0].content,'system');assert.equal(messages[1].content,'seed');
  assert.equal(messages.at(-1).content,big+7,'the newest result is kept');
  assert.equal(messages[3].content,COMPACTED,'the oldest result goes first');
  const small=[{role:'system',content:'s'},{role:'user',content:'u'},{role:'tool',content:'r'},{role:'assistant',content:'a'}];
  assert.equal(fitContext(small,[]).compacted,0);
});

test('old complete tool exchanges are removed when compacted results are still too large',()=>{
  const messages=[{role:'system',content:'system'},{role:'user',content:'seed'}];
  for(let i=0;i<18;i++)messages.push(
    {role:'assistant',content:`reason ${i} `+'a'.repeat(1100),tool_calls:[{function:{name:'read_file',arguments:{path:`file-${i}`}}}]},
    {role:'tool',tool_name:'read_file',content:`result ${i} `+'b'.repeat(350)}
  );
  const fit=fitContext(messages,[],{contextTokens:8192});
  assert.equal(fit.fits,true);
  assert.ok(fit.removedExchanges>0);
  assert.equal(messages[0].content,'system');
  assert.equal(messages[1].content,'seed');
  assert.match(messages.at(-2).content,/reason 17/);
  assert.match(messages.at(-1).content,/result 17/);
  assert.ok(fit.estimatedTokens<=fit.budget);
});

test('an oversized protected prompt blocks the wake before any model request',async()=>{
  const task={id:'context-overflow',goal:'Read one file',plan:[],evidence:[],ownerInputs:[],readRoots:[],workspace:'C:\\work'};
  let modelCalls=0;
  const store={get:()=>task,update:(_id,patch)=>Object.assign(task,patch),approvals:()=>[],actions:()=>[]};
  const runtime={withInference:fn=>fn(),chat:async()=>{modelCalls++;return {message:{role:'assistant',content:'unreachable'}};}};
  const runner=new NethraRunner({store,runtime});
  runner.tools.definitions=()=>[{type:'function',function:{name:'huge',description:'x'.repeat(30000),parameters:{type:'object',properties:{}}}}];
  const outcome=await runner.execute(task);
  assert.equal(modelCalls,0);
  assert.equal(outcome.status,'BLOCKED');
  assert.match(outcome.summary,/context|prompt/i);
});
