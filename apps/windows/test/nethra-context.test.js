'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {CONTEXT_TOKENS,fitContext,COMPACTED}=require('../src/model-context');
const {buildWorldInferencePayload}=require('../src/world-bridge');
const {NethraRunner}=require('../src/nethra-runner');
const {progressView}=require('../src/nethra-progress');
const {NethraStore}=require('../src/nethra-store');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

test('every 30B caller asks for the same context, so the resident model is never reloaded',()=>{
  assert.equal(CONTEXT_TOKENS,16384);
  assert.equal(buildWorldInferencePayload([],100).options.num_ctx,CONTEXT_TOKENS);
  assert.equal(new (require('../src/model-warmer').ModelWarmer)().contextTokens,CONTEXT_TOKENS);
});

test('a protected prompt of the size that blocked the live objective fits with output reserved',()=>{
  const messages=[{role:'system',content:'x'.repeat(13000)},{role:'user',content:'x'.repeat(7000)}];
  const tools=[{type:'function',function:{name:'work',description:'x'.repeat(4213)}}];
  const fit=fitContext(messages,tools);
  assert.ok(fit.estimatedTokens>=6900&&fit.estimatedTokens<=7100);
  assert.equal(fit.fits,true);
  assert.ok(fit.budget-fit.estimatedTokens>=3000);
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
  runner.tools.definitions=()=>[{type:'function',function:{name:'huge',description:'x'.repeat(50000),parameters:{type:'object',properties:{}}}}];
  const outcome=await runner.execute(task);
  assert.equal(modelCalls,0);
  assert.equal(outcome.status,'BLOCKED');
  assert.match(outcome.summary,/context|prompt/i);
});
test('task activity describes removed exchanges rather than reporting zero compaction',()=>{
  const task={id:'visible-compaction',status:'SLEEPING',plan:[],completedSteps:[],pendingSteps:[],evidence:[]};
  const store={recentTaskEvents:()=>[{at:100,kind:'CONTEXT_COMPACTED',detail:{compacted:0,removedExchanges:2,estimatedTokens:5800,budget:6400}}]};
  assert.match(progressView(task,store).activity[0].line,/2 older exchanges/);
});
test('a host context repair retries only the matching blocked objective and retains its work',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-context-retry-'));
  const store=new NethraStore(dir);
  try{
    const task=store.create({goal:'Improve performance',successCriteria:'Measured improvement'});
    const plan=['Measure baseline','Compare results'];
    store.update(task.id,{status:'BLOCKED',summary:"Nethra's protected prompt needs about 6918 tokens, above its 6400-token input budget. The host must reduce this task's context before it can continue.",plan,pendingSteps:plan,contextCheckpoint:{metric:'latency'}},'nethra_context_blocked');
    const repaired=store.retryContextBlocked(task.id);
    assert.equal(repaired.status,'ACTIVE');
    assert.equal(repaired.summary,'');
    assert.deepEqual(repaired.plan,plan);
    assert.deepEqual(repaired.contextCheckpoint,{metric:'latency'});
    assert.equal(store.recentTaskEvents(task.id,1)[0].kind,'CONTEXT_RETRIED');
    assert.throws(()=>store.retryContextBlocked(task.id),/context block/);
  }finally{store.db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
