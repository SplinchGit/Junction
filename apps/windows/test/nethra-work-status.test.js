'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {NethraStore}=require('../src/nethra-store');
const {NethraScheduler}=require('../src/nethra-scheduler');

function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-work-events-'));
  let now=1_800_000_000_000;
  const store=new NethraStore(directory,{now:()=>now});
  t.after(()=>{store.close();fs.rmSync(directory,{recursive:true,force:true});});
  return {store,now:()=>now,advance:ms=>now+=ms};
}

test('a code-work completion and later Apply wake their sleeping objective once per durable change',async t=>{
  const {reconcileCodeWork}=require('../src/nethra-work-status');
  const f=fixture(t),task=f.store.create({goal:'Measure the reviewed change',allowCodeWork:true,model:'junction-qwen3-next:80b-q3km',continuous:true});
  f.store.update(task.id,{status:'SLEEPING',nextWakeAt:f.now()+86_400_000});
  const project={id:'work-1',sourceObjectiveId:task.id,status:'COMPLETED',verifiedSha:'candidate-1',tasks:[],appliedAt:null};
  let executions=0;
  const scheduler=new NethraScheduler({store:f.store,now:f.now,reconcileWork:()=>reconcileCodeWork({store:f.store,projects:[project],now:f.now()}),execute:async claimed=>{assert.equal(claimed.id,task.id);executions++;return {status:'SLEEPING',nextWakeAt:f.now()+3_600_000};}});
  await scheduler.tick();assert.equal(executions,1);
  assert.equal(f.store.attention(task.id).filter(item=>item.kind==='CODE_WORK_CHANGED').length,1);
  f.advance(20_000);await scheduler.tick();assert.equal(executions,1);
  project.appliedAt=f.now();f.advance(20_000);await scheduler.tick();assert.equal(executions,2);
  assert.equal(f.store.attention(task.id).filter(item=>item.kind==='CODE_WORK_CHANGED').length,2);
});

test('work changes preserve owner pauses and pending exact approvals',()=>{
  const {reconcileCodeWork}=require('../src/nethra-work-status');
  const f=fixture({after:()=>{}});
  try{
    const paused=f.store.create({goal:'Paused work',allowCodeWork:true});
    f.store.control(paused.id,'pause',paused.revision,'owner-pause');
    const gated=f.store.create({goal:'Approval work',allowCodeWork:true});
    f.store.requestApproval(gated.id,{tool:'write_draft',args:{path:'existing.md',content:'proposed'},category:'LOCAL_WRITE',key:'exact-write'});
    const projects=[paused,gated].map(task=>({id:`work-${task.id}`,sourceObjectiveId:task.id,status:'COMPLETED',verifiedSha:'candidate',appliedAt:f.now(),tasks:[]}));
    reconcileCodeWork({store:f.store,projects,now:f.now()});
    assert.equal(f.store.get(paused.id).status,'PAUSED');assert.equal(f.store.get(gated.id).status,'WAITING_FOR_USER');
    assert.equal(f.store.approvals(gated.id)[0].status,'PENDING');
  }finally{const directory=f.store.directory;f.store.close();fs.rmSync(directory,{recursive:true,force:true});}
});
