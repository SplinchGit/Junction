'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {NethraStore}=require('../src/nethra-store');
const {NethraTools}=require('../src/nethra-tools');
const {runModelJob}=require('../src/nethra-model-inference');
const model='junction-qwen3-next:80b-q3km';
function fixture(t,{goal='Measure five identical local prompts'}={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-model-job-'));
  let store=new NethraStore(directory);
  t.after(()=>{store.close();fs.rmSync(directory,{recursive:true,force:true});});
  const created=store.create({goal,model,continuous:true});
  let claim=store.claim('model-job-test');
  return {get store(){return store;},get task(){return store.get(created.id);},get token(){return claim.token;},
    restart(){store.release(created.id,claim.token);store.close();store=new NethraStore(directory);claim=store.claim('restarted-worker');},
    options(runtime,clock){return {store,runtime,task:store.get(created.id),token:claim.token,now:()=>clock.value,inference:async callback=>{clock.accounted++;return callback();},writeDraft:args=>new NethraTools({store}).execute('write_draft',args,store.get(created.id),{token:claim.token})};}
  };
}
for(const target of [model,'qwen3:30b','junction-qwen3-next-thinking:80b-q3km'])test(`measured inference sends the recorded settings and raw token metrics for ${target}`,async t=>{
  const {LocalAgentRuntime}=require('../src/local-agent-runtime');
  const f=fixture(t),clock={value:Date.now(),accounted:0};let payload;
  const runtime=new LocalAgentRuntime({warmer:{model:target,keepAlive:()=> '15m',inferenceStarted(){},inferenceFinished(){}},fetchImpl:async(_url,options)=>{payload=JSON.parse(options.body);return {ok:true,json:async()=>({model:target,eval_count:7,eval_duration:700000000,prompt_eval_count:11,message:{role:'assistant',content:'amber'}})};}});
  const result=await runModelJob({...f.options(runtime,clock),args:{model:target,prompt:'Say amber',maxTokens:16}});
  assert.deepEqual({temperature:payload.options.temperature,maxTokens:payload.options.num_predict,stream:payload.stream},{temperature:0,maxTokens:16,stream:false});
  assert.equal(payload.think,target!=='junction-qwen3-next:80b-q3km');
  assert.equal(result.statistics.outputTokens,7);assert.equal(result.statistics.tokensPerSecond,10);
  const report=JSON.parse(fs.readFileSync(result.path,'utf8'));assert.equal(report.temperature,payload.options.temperature);assert.equal(report.request.maxTokens,payload.options.num_predict);
});
test('stateless model jobs queue fixed prompts, measure real output and resume after restart',async t=>{
  const f=fixture(t),clock={value:Date.now(),accounted:0},seen=[];let calls=0,locked=false;
  const runtime={withInference:async(fn,_signal,options)=>{assert.equal(locked,false);assert.equal(options.preemptible,true);locked=true;clock.value+=7;try{return await fn();}finally{locked=false;}},chat:async(selected,messages,tools,_signal,_text,_format,options)=>{
    assert.equal(locked,true);assert.equal(selected,model);assert.deepEqual(tools,[]);assert.equal(options.thinking,false);assert.equal(options.num_predict,128);
    seen.push(messages);clock.value+=100;calls++;return {model,eval_count:10,eval_duration:1e9,prompt_eval_count:12,prompt_eval_duration:2e7,message:{role:'assistant',content:`measured response ${calls}`}};
  }};
  const first=await runModelJob({...f.options(runtime,clock),args:{prompt:'Say amber.',system:'Use this fixed context.',samples:5,maxTokens:128}});
  assert.equal(first.status,'PARTIAL');assert.equal(first.completed,3);assert.equal(clock.accounted,3);assert.equal(first.statistics.tokensPerSecond,10);assert.equal(first.statistics.meanWallMs,100);assert.equal(first.statistics.meanQueueMs,7);
  assert.equal(f.store.modelJobs(f.task.id)[0].samples.length,3);assert.ok(fs.existsSync(first.path));
  f.restart();
  const final=await runModelJob({...f.options(runtime,clock),args:{jobId:first.jobId}});
  assert.equal(final.status,'COMPLETED');assert.equal(final.completed,5);assert.equal(calls,5);assert.equal(clock.accounted,5);
  assert.ok(seen.every(messages=>JSON.stringify(messages)===JSON.stringify(seen[0])));
  assert.deepEqual(seen[0],[{role:'system',content:'Use this fixed context.'},{role:'user',content:'Say amber.'}]);
  const report=JSON.parse(fs.readFileSync(final.path,'utf8'));assert.equal(report.measurements.length,5);assert.equal(report.statistics.outputTokens,50);
  const replay=await runModelJob({...f.options(runtime,clock),args:{jobId:first.jobId}});assert.equal(calls,5);assert.equal(replay.path,final.path);
});
test('a preempted sample keeps completed measurements and resumes only missing work',async t=>{
  const f=fixture(t),clock={value:Date.now(),accounted:0};let calls=0,preempt=true;
  const runtime={withInference:fn=>fn(),chat:async()=>{calls++;if(calls===2&&preempt)throw Object.assign(Error('Owner chat preempted inference'),{name:'PreemptedError'});clock.value+=20;return {eval_count:2,eval_duration:2e8,message:{role:'assistant',content:'amber'}};}};
  await assert.rejects(runModelJob({...f.options(runtime,clock),args:{prompt:'Say amber',samples:4}}),/preempted/);
  const job=f.store.modelJobs(f.task.id)[0];assert.equal(job.samples.length,1);
  preempt=false;const result=await runModelJob({...f.options(runtime,clock),args:{jobId:job.id}});
  assert.equal(result.completed,4);assert.equal(calls,5);assert.equal(result.statistics.outputTokens,8);
});
test('a resume request may repeat unchanged context and the remaining count without changing the saved job',async t=>{
  const f=fixture(t),clock={value:Date.now(),accounted:0};let calls=0;
  const runtime={withInference:fn=>fn(),chat:async()=>{calls++;return {model,eval_count:2,eval_duration:2e8,message:{role:'assistant',content:'Paris'}};}};
  const started=await runModelJob({...f.options(runtime,clock),args:{prompt:'What is the capital of France?',system:'Answer concisely.',samples:5,maxTokens:128}});
  const resumed=await runModelJob({...f.options(runtime,clock),args:{jobId:started.jobId,prompt:'What is the capital of France?',system:'Answer concisely.',model,samples:2,maxTokens:128}});
  assert.equal(resumed.completed,5);assert.equal(calls,5);assert.equal(f.store.modelJob(f.task.id,started.jobId).request.samples,5);
  await assert.rejects(runModelJob({...f.options(runtime,clock),args:{jobId:started.jobId,prompt:'A different prompt'}}),/fixed|unchanged|different/);
  await assert.rejects(runModelJob({...f.options(runtime,clock),args:{jobId:started.jobId,maxTokens:256}}),/fixed|unchanged|different/);
  assert.equal(calls,5);
});
test('owner pause prevents an in-flight model sample from being committed',async t=>{
  const f=fixture(t),clock={value:Date.now(),accounted:0};
  const runtime={withInference:fn=>fn(),chat:async()=>{f.store.control(f.task.id,'pause',f.task.revision,'owner-pause-model-job');return {eval_count:2,eval_duration:2e8,message:{role:'assistant',content:'late'}};}};
  await assert.rejects(runModelJob({...f.options(runtime,clock),args:{prompt:'Say amber',samples:3}}),/paused|lease/i);
  assert.equal(f.task.status,'PAUSED');assert.equal(f.store.modelJobs(f.task.id)[0].samples.length,0);
});
test('model inference rejects unbounded requests, unsupported targets and foreign jobs',async t=>{
  const f=fixture(t),clock={value:Date.now(),accounted:0};let calls=0;
  const runtime={withInference:fn=>fn(),chat:async()=>{calls++;throw Error('must not run');}};
  for(const args of [{prompt:'x',samples:51},{prompt:'x',samples:1.5},{prompt:'x',maxTokens:4097},{prompt:'x',model:'remote:other'},{prompt:'x'.repeat(4001)},{jobId:'missing'},{jobId:'missing',prompt:'x'}])await assert.rejects(runModelJob({...f.options(runtime,clock),args}));
  assert.equal(calls,0);
});
test('a model reply without measured token metrics cannot become a successful benchmark sample',async t=>{
  const f=fixture(t),clock={value:Date.now(),accounted:0};
  const runtime={withInference:fn=>fn(),chat:async()=>({message:{role:'assistant',content:'claimed speed is 50 tokens/sec'}})};
  await assert.rejects(runModelJob({...f.options(runtime,clock),args:{prompt:'Say amber'}}),/metrics|measurement/i);
  assert.equal(f.store.modelJobs(f.task.id)[0].samples.length,0);
});
test('the task model directs and resumes a measured job through its real tool loop',async t=>{
  const {NethraRunner}=require('../src/nethra-runner');
  const f=fixture(t);let parents=0,samples=0;
  f.store.update(f.task.id,{questions:[{id:'old-model-access',question:`How do I access the ${model} model inference interface?`,reason:'ACCESS',blocking:true,status:'OPEN'}]},'OLD_ACCESS_GATE',f.token);
  const runtime={withInference:fn=>fn(),chat:async(_model,messages,tools)=>{
    if(!tools.length){samples++;return {model,eval_count:4,eval_duration:4e8,message:{role:'assistant',content:'amber'}};}
    assert.ok(tools.some(tool=>tool.function.name==='run_model'));
    const seed=JSON.parse(messages[1].content);assert.equal(seed.taskContract.modelInference.available,true);
    if(parents++===0)return {message:{role:'assistant',tool_calls:[{function:{name:'run_model',arguments:{prompt:'Say amber.',samples:5}}}]}};
    const result=JSON.parse(messages.at(-1).content);
    return {message:{role:'assistant',tool_calls:[{function:result.status==='PARTIAL'?{name:'run_model',arguments:{jobId:result.jobId}}:{name:'schedule_wake',arguments:{at:Date.now()+60_000,reason:'Measured all five real samples; prepare the saved report'}}}]}};
  }};
  const result=await new NethraRunner({store:f.store,runtime}).execute(f.task,{token:f.token});
  assert.equal(samples,5);assert.equal(result.contextCheckpoint.modelJobs[0].status,'COMPLETED');
  assert.equal(f.task.questions[0].status,'ANSWERED');assert.equal(f.task.questions[0].answeredBy,'HOST_CAPABILITY');
  assert.equal(f.task.ownerInputs.length,0);assert.equal(f.store.modelJobs(f.task.id)[0].samples.length,5);
});
test('three completed samples cannot finish a task requiring fifty identical prompts',async t=>{
  const {NethraRunner}=require('../src/nethra-runner');
  const f=fixture(t,{goal:`Benchmark the ${model} model on 50 identical prompts and record average tokens/sec and wall-clock time.`}),clock={value:Date.now(),accounted:0};
  const measured={withInference:fn=>fn(),chat:async()=>({model,eval_count:2,eval_duration:2e8,message:{role:'assistant',content:'Paris'}})};
  await assert.rejects(runModelJob({...f.options(measured,clock),args:{prompt:'What is the capital of France?',samples:3}}),/samples:50/);
  // Preserve an earlier-version three-sample job to reproduce the live migration.
  const result=await runModelJob({...f.options(measured,clock),task:{...f.task,goal:'Smoke test the local model',successCriteria:'Smoke test the local model'},args:{prompt:'What is the capital of France?',samples:3}});
  const report=await new NethraTools({store:f.store}).execute('write_draft',{path:'benchmark.md',content:'Model benchmark: three samples measured 10 tokens/sec. The requested fifty samples have not been run.'},f.task,{token:f.token});
  const step='Execute 50 prompts against the model and record response latency';
  f.store.update(f.task.id,{plan:[step,'Save benchmark report'],completedSteps:[step],pendingSteps:['Save benchmark report'],evidence:[{tool:'run_model',result},{tool:'write_draft',result:report}]},'PREVIOUS_INCORRECT_BOOKKEEPING',f.token);
  let turns=0,failure;
  const runtime={withInference:fn=>fn(),chat:async(_model,messages)=>{
    if(turns++)failure=JSON.parse(messages.at(-1).content);
    return {message:{role:'assistant',tool_calls:[{function:turns===1?{name:'finish_objective',arguments:{summary:'The model benchmark is complete and all fifty prompts ran.'}}:{name:'schedule_wake',arguments:{at:Date.now()+60_000,reason:'Continue until all fifty real samples are saved'}}}]}};
  }};
  const final=await new NethraRunner({store:f.store,runtime}).execute(f.task,{token:f.token});
  assert.equal(final.status,'SLEEPING');assert.match(failure.error,/50.*3|3.*50/);
  assert.ok(final.pendingSteps.includes(step));assert.ok(!final.completedSteps.includes(step));
  assert.ok(!f.store.events(f.task.id).some(event=>event.kind==='nethra_completed'));
});
test('a fresh inference-only task can finish from its measured result and real draft receipt',async t=>{
  const {NethraRunner}=require('../src/nethra-runner');
  const f=fixture(t,{goal:`Benchmark the ${model} model on 1 identical prompt and save its measured benchmark report.`});let turns=0;
  const runtime={withInference:fn=>fn(),chat:async(_model,_messages,tools)=>{
    if(!tools.length)return {model,eval_count:2,eval_duration:2e8,message:{role:'assistant',content:'Paris'}};
    if(turns++===0)return {message:{role:'assistant',tool_calls:[{function:{name:'update_plan',arguments:{steps:['Measure one model prompt and save the results']}}},{function:{name:'run_model',arguments:{prompt:'What is the capital of France?',samples:1}}}]}};
    return {message:{role:'assistant',tool_calls:[{function:turns===2?{name:'finish_objective',arguments:{summary:`The ${model} benchmark completed one measured sample and saved its benchmark report.`}}:{name:'schedule_wake',arguments:{at:Date.now()+60_000,reason:'Retry the measured result completion check'}}}]}};
  }};
  const result=await new NethraRunner({store:f.store,runtime}).execute(f.task,{token:f.token});
  assert.equal(result.status,'COMPLETED');assert.equal(result.evidence[0].tool,'run_model');
  assert.ok(f.store.actions(f.task.id).some(action=>action.status==='COMPLETED'&&action.result?.path.endsWith('results-001.json')));
});
