'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {objectiveBrief,repositoryGuide}=require('../src/nethra-brief');
const {NethraRunner}=require('../src/nethra-runner');

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
