'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {progressView}=require('../src/nethra-progress');
const model='junction-qwen3-next:80b-q3km';
const task={id:'measured-task',goal:`Benchmark ${model} on 50 identical prompts using fixed context`,status:'ACTIVE',model,plan:['Continue running 47 more samples','Report the result'],completedSteps:[],pendingSteps:['Continue running 47 more samples','Report the result'],evidence:[]};
const store={modelJobs:()=>[{id:'job',model,status:'COMPLETED',request:{samples:50},samples:Array.from({length:50},(_,i)=>({index:i+1}))}],recentTaskEvents:()=>[],actions:()=>[],approvals:()=>[]};
test('live benchmark progress shows verified samples instead of a stale remaining-samples plan',()=>{
  const view=progressView(task,store,{liveTaskId:task.id});
  assert.match(view.doing,/50\/50.*samples/i);assert.doesNotMatch(view.next,/47 more/);assert.match(view.next,/report/i);
  assert.equal(view.modelSamples.completed,50);assert.equal(view.modelSamples.total,50);
  assert.equal(task.pendingSteps[0],'Continue running 47 more samples','Projection must not invent model plan changes');
});
test('verified sample counts do not claim a paused benchmark is running',()=>{
  const view=progressView({...task,status:'PAUSED'},store);
  assert.match(view.doing,/^Paused/);assert.match(view.doing,/50\/50/);assert.doesNotMatch(view.next,/47 more/);
});
test('ordinary task plans are unaffected by unrelated saved inference jobs',()=>{
  const view=progressView({...task,goal:'Prepare the workshop brief'},store,{liveTaskId:task.id});
  assert.equal(view.modelSamples,null);assert.equal(view.next,task.pendingSteps[0]);
});
