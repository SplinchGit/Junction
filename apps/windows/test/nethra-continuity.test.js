'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {NethraStore}=require('../src/nethra-store');
const {NethraRunner}=require('../src/nethra-runner');
const {NethraScheduler}=require('../src/nethra-scheduler');
const {NethraAttention}=require('../src/nethra-attention');

test('one ongoing objective persists a milestone, sleeps through unchanged evidence, and resumes after restart on new evidence',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-continuity-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  let now=1_800_000_000_000,store=new NethraStore(root,{now:()=>now});
  const task=store.create({goal:'Track university coursework deadlines',mode:'ONGOING',sources:['calendar']});
  let stage=0,turn=0,calls=0;
  const calendar={status:()=>({status:'CONNECTED',lastSyncAt:now}),event:id=>({id,summary:`University coursework deadline ${stage+1}`,start:'2027-02-01'})};
  const runtime={withInference:fn=>{turn=0;return fn();},chat:async()=>{
    calls++;
    const tool=turn++===0?{name:'calendar_event',arguments:{id:`deadline-${stage+1}`}}:
      stage===0&&turn===2?{name:'update_plan',arguments:{steps:['Check coursework deadlines'],completedSteps:['Check coursework deadlines']}}:
      {name:'finish_objective',arguments:{summary:`University coursework deadline ${stage+1} verified`}};
    return {message:{role:'assistant',content:'',tool_calls:[{function:tool}]}};
  }};
  const run=async()=>new NethraScheduler({store,now:()=>now,sourceStatus:calendar.status,execute:(item,options)=>new NethraRunner({store,runtime,calendar,now:()=>now}).execute(item,options)}).tick();
  await run();
  assert.equal(store.get(task.id).status,'SLEEPING');assert.equal(store.milestoneEvents(task.id).length,1);
  const before=calls;store.close();store=new NethraStore(root,{now:()=>now});
  now=store.get(task.id).nextWakeAt;await run();
  assert.equal(calls,before,'unchanged source health is bookkeeping, not inference');
  assert.equal(store.milestoneEvents(task.id).length,1);
  stage=1;new NethraAttention(store,{now:()=>now}).observe({taskId:task.id,source:'calendar',sourceId:'deadline-2',revision:'etag-2'});
  now+=300_001;await run();
  assert.ok(calls>before);assert.equal(store.get(task.id).status,'SLEEPING');assert.equal(store.milestoneEvents(task.id).length,2);
  store.close();
});
