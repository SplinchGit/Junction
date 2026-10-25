'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {NethraStore}=require('../src/nethra-store');
const {performanceReport}=require('../src/nethra-performance');
const {NethraTools}=require('../src/nethra-tools');
const {NethraApi}=require('../src/nethra-api');

test('performance report uses completed objective inference intervals and recent local chat samples',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-performance-'));
  let now=1_800_000_000_000;
  const store=new NethraStore(root,{now:()=>now});
  t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
  const task=store.create({goal:'Improve response speed'});
  const lease=store.claim('test');
  store.beginInference(task.id,lease.token);now+=1000;store.endInference(task.id,lease.token);
  store.beginInference(task.id,lease.token);now+=3000;store.endInference(task.id,lease.token);
  store.release(task.id,lease.token);
  const localData={usage:()=>[
    {providerId:'local',createdAt:now-1000,durationMs:2000,tokensPerSecond:20},
    {providerId:'local',createdAt:now-2000,durationMs:4000,tokensPerSecond:30},
    {providerId:'local',createdAt:now-8*86400000,durationMs:20},
    {providerId:'codex',createdAt:now,durationMs:100}
  ]};
  const result=performanceReport({store,localData,taskId:task.id,now});
  assert.equal(result.objective.sampleCount,2);
  assert.equal(result.objective.medianInferenceMs,2000);
  assert.equal(result.objective.totalInferenceMs,4000);
  assert.equal(result.chat.sampleCount,2);
  assert.equal(result.chat.medianResponseMs,3000);
  assert.equal(result.chat.medianTokensPerSecond,25);
  assert.equal(result.windowDays,7);
  assert.ok(result.objective.lastSampleAt<=now);
  assert.match(result.note,/different workloads/);
});

test('performance report treats missing and malformed samples as unavailable, not zero',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-performance-empty-'));
  const now=1_800_000_000_000;
  const store=new NethraStore(root,{now:()=>now});
  t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
  const task=store.create({goal:'Investigate latency'});
  const result=performanceReport({store,localData:{usage:()=>[
    {providerId:'local',createdAt:now,durationMs:-2,tokensPerSecond:Infinity},
    {providerId:'local',createdAt:now+1000,durationMs:100}
  ]},taskId:task.id,now});
  assert.equal(result.objective.sampleCount,0);
  assert.equal(result.objective.medianInferenceMs,null);
  assert.equal(result.chat.sampleCount,0);
  assert.equal(result.chat.medianResponseMs,null);
  assert.equal(result.chat.medianTokensPerSecond,null);
});

test('Nethra and paired task detail read the same bounded host performance report',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-performance-api-'));
  const store=new NethraStore(root);
  t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
  const task=store.create({goal:'Self Improvement'});
  const localData={usage:()=>[{providerId:'local',createdAt:Date.now()-1000,durationMs:3600,tokensPerSecond:18}]};
  const report=()=>performanceReport({store,localData,taskId:task.id});
  const tools=new NethraTools({store,performanceReport:report});
  assert.ok(tools.definitions({task}).some(item=>item.function.name==='performance_report'));
  const advice=await tools.execute('performance_report',{},task);
  const api=new NethraApi({store,runtime:{},localData});
  const detail=await api.dispatch('nethra.get',{id:task.id},'performance-detail','android');
  assert.equal(advice.chat.sampleCount,1);
  assert.equal(detail.performance.chat.medianResponseMs,3600);
  assert.equal(detail.performance.objective.sampleCount,0);
  assert.ok(Buffer.byteLength(JSON.stringify(detail))<50_000);
});
