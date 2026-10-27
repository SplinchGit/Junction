'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {objectiveBrief,repositoryGuide}=require('../src/nethra-brief');
const {NethraRunner}=require('../src/nethra-runner');
const {checkpointAfterTool,seedForWake}=require('../src/nethra-checkpoint');

function repo(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-brief-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'.git'));fs.mkdirSync(path.join(root,'docs'));
  fs.writeFileSync(path.join(root,'docs','CODEBASE_MAP.md'),'# Map\r\n\r\n## Android\r\nKotlin things\r\n\r\n## Windows host and Nethra\r\nRunner: src/nethra-runner.js\r\n\r\n## Repository Layout\r\nlayout');
  return root;
}
const fakeTools={performanceReport:()=>({objective:{sampleCount:66,medianInferenceMs:43126},chat:{sampleCount:22,medianResponseMs:9100}}),hostDiagnostics:()=>({contextTokens:8192,host:{freeMemoryBytes:9*2**30}}),advisorLimits:{check:async provider=>provider==='codex'?{available:false,nextAvailableAt:Date.parse('2026-10-25T23:52:37Z')}:{available:true}}};
const fakeGit=async(_cmd,args)=>{assert.deepEqual(args.slice(0,3).map(String).slice(0,2),['-C',args[1]]);return {stdout:'433c9cf 2026-10-25T21:38:00+00:00 Give the 30B model an 8,192-token window\nabbc1df 2026-10-25T22:04:00+00:00 Stop Nethra forgetting its own steps\n'};};

test('the guide comes from the repository map section, not the whole file',t=>{
  assert.equal(repositoryGuide(repo(t)),'Runner: src/nethra-runner.js');
  assert.equal(repositoryGuide(path.join(os.tmpdir(),'no-such-repo')),null);
});

test('a self-improvement wake starts with host facts, recent commits and the guide',async t=>{
  const root=repo(t);
  const brief=await objectiveBrief({task:{id:'s',allowCodeWork:true,readRoots:[root]},tools:fakeTools,run:fakeGit});
  assert.deepEqual(brief.hostFacts.taskModelCalls,{samples:66,medianMs:43126});
  assert.equal(brief.hostFacts.advisors.claude,'available');assert.match(brief.hostFacts.advisors.codex,/resting until 2026-10-25T23:52:37/);
  assert.equal(brief.hostFacts.freeMemoryGiB,9);
  assert.match(brief.recentCommits[0],/8,192-token window/);
  assert.match(brief.repositoryGuide,/nethra-runner/);
  const plain=await objectiveBrief({task:{id:'p',allowCodeWork:false,readRoots:[]},tools:fakeTools,run:fakeGit});
  assert.deepEqual(plain,{},'ordinary tasks get no host facts and have no repository');
});

test('the seed carries the brief and bounds owner notes, keeping the newest',async t=>{
  const root=repo(t);const seen=[];
  const task={id:'s',goal:'Self Improvement',allowCodeWork:true,readRoots:[root],workspace:root,plan:[],evidence:[],ownerInputs:Array.from({length:9},(_,i)=>({kind:'note',text:`note ${i} `+'x'.repeat(900)}))};
  const store={get:()=>task,update:(_id,patch)=>Object.assign(task,patch),approvals:()=>[],actions:()=>[]};
  const runtime={withInference:fn=>fn(),chat:async(_m,messages)=>{seen.push(messages);return {message:{role:'assistant',content:'',tool_calls:[{function:{name:'schedule_wake',arguments:{at:Date.now()+3_600_000,reason:'later'}}}]}};}};
  const runner=new NethraRunner({store,runtime});Object.assign(runner.tools,fakeTools);
  await runner.execute(task);
  const seed=JSON.parse(seen[0][1].content);
  assert.equal(seed.hostFacts.taskModelCalls.samples,66);
  assert.ok(seed.repositoryGuide);
  assert.equal(seed.ownerInputs.length,6);assert.match(seed.ownerInputs.at(-1).text,/^note 8/);assert.ok(seed.ownerInputs[0].text.length<=500);
  const keys=Object.keys(seed);assert.ok(keys.indexOf('ownerInputs')<keys.indexOf('repositoryGuide'),'notes come before orientation');assert.equal(keys.at(-1),'evidence');
});

test('a rejected proposal remains in the working checkpoint on the next wake',async()=>{
  const task={id:'review-replay',goal:'Improve prompt context',allowCodeWork:true,readRoots:[],workspace:'C:\\work',plan:['Review one change'],completedSteps:[],pendingSteps:['Review one change'],evidence:[],ownerInputs:[]};
  const store={get:()=>task,update:(_id,patch)=>Object.assign(task,patch),approvals:()=>[],actions:()=>[]};
  const review='VERDICT: REVISE\nMeasure serialization separately. Preserve exact prompt bytes and tool order.';
  let calls=0;
  const runtime={withInference:fn=>fn(),chat:async()=>({message:{role:'assistant',content:'',tool_calls:[{function:calls++===0?{name:'propose_code_work',arguments:{task:'Trim prompt assembly',acceptance:'Measure serialization separately and preserve prompt bytes'}}:{name:'schedule_wake',arguments:{at:Date.now()+3_600_000,reason:'Gather timing data'}}}]}})};
  const runner=new NethraRunner({store,runtime});
  runner.tools.execute=async()=>({status:'REVISE',draftCreated:false,reviewedBy:'Codex',review});
  await runner.execute(task);
  assert.equal(task.contextCheckpoint.lastReview.verdict,'REVISE');
  assert.equal(task.contextCheckpoint.lastReview.feedback,review);
  let nextSeed;
  const nextRuntime={withInference:fn=>fn(),chat:async(_model,messages)=>{nextSeed=JSON.parse(messages[1].content);return {message:{role:'assistant',content:'',tool_calls:[{function:{name:'schedule_wake',arguments:{at:Date.now()+3_600_000,reason:'Continue later'}}}]}};}};
  await new NethraRunner({store,runtime:nextRuntime}).execute(task);
  assert.equal(nextSeed.workingCheckpoint.lastReview.feedback,review);
  assert.equal(nextSeed.workingCheckpoint.lastReview.proposal,'Trim prompt assembly');
});

test('a task records Ollama prompt tokens beside its preflight estimate',async()=>{
  const task={id:'measured-context',goal:'Inspect context',plan:[],evidence:[],ownerInputs:[],readRoots:[],workspace:'C:\\work'};
  const measured=[];
  const store={get:()=>task,update:(_id,patch)=>Object.assign(task,patch),approvals:()=>[],actions:()=>[],recordContextMeasurement:(_id,entry)=>measured.push(entry)};
  const runtime={withInference:fn=>fn(),chat:async()=>({prompt_eval_count:812,message:{role:'assistant',content:'',tool_calls:[{function:{name:'schedule_wake',arguments:{at:Date.now()+3_600_000,reason:'later'}}}]}})};
  await new NethraRunner({store,runtime}).execute(task);
  assert.equal(measured.length,1);
  assert.equal(measured[0].actualTokens,812);
  assert.ok(measured[0].estimatedTokens<=measured[0].budget);
});

test('seed shedding keeps JSON structure, latest owner direction and reviewer objections',()=>{
  const seed={objective:'Self Improvement',workingCheckpoint:{lastReview:{verdict:'REVISE',feedback:'Need a controlled baseline.'}},ownerInputs:Array.from({length:12},(_,i)=>({kind:'note',text:`direction ${i}: `+'x'.repeat(450)})),recentCommits:Array.from({length:12},(_,i)=>`commit ${i} `+'c'.repeat(130)),repositoryGuide:'g'.repeat(2200),actionsSoFar:Array.from({length:12},()=> 'action '+'a'.repeat(140)),evidence:[{tool:'read_file',result:{content:'e'.repeat(900)}}]};
  const result=JSON.parse(seedForWake(seed,2500));
  assert.equal(result.objective,'Self Improvement');
  assert.equal(result.workingCheckpoint.lastReview.feedback,'Need a controlled baseline.');
  assert.match(result.ownerInputs.at(-1).text,/direction 11/);
  assert.ok(JSON.stringify(result).length<=2500);
  assert.deepEqual(JSON.parse(seedForWake({objective:'Ordinary work',workingCheckpoint:{}},2500)),{objective:'Ordinary work',workingCheckpoint:{}});
});
test('a saved code draft is recorded as awaiting owner action, never as applied code',()=>{
  const next=checkpointAfterTool({}, {name:'propose_code_work',args:{task:'Fix context',acceptance:'All context tests pass'},result:{status:'DRAFT',workId:'draft-1',reviewedBy:'Codex'},at:100});
  assert.deepEqual(next.codeWorkDraft,{workId:'draft-1',status:'DRAFT',at:100,codeChanged:false});
  assert.equal(next.lastReview,undefined);
});
