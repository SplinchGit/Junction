'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {NethraStore,dailyLimits}=require('../src/nethra-store');
const {progressView}=require('../src/nethra-progress');

function storeWithUsage(t,settings){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-budget-'));
  const store=new NethraStore(directory);t.after(()=>{store.close();fs.rmSync(directory,{recursive:true,force:true});});
  store.setSettings(settings);
  const task=store.create({goal:'Self Improvement',persistent:true});
  const day=Math.floor(Date.now()/86_400_000);
  store.db.prepare('INSERT INTO usage VALUES(?,?,?)').run(day,task.id,5*3_600_000);
  return {store,task};
}

test('no daily limit lets a task that has already run for hours be claimed again',t=>{
  const {store,task}=storeWithUsage(t,{objectiveDailyMs:null,globalDailyMs:null});
  assert.deepEqual(dailyLimits(store.settings()),{taskMs:Infinity,globalMs:Infinity});
  const claim=store.claim('test-owner');
  assert.equal(claim?.task?.id??claim?.id,task.id);
  assert.notEqual(progressView(store.get(task.id),store).waitingFor.kind,'budget');
});

test('a finite limit still stops the task at the limit',t=>{
  const {store,task}=storeWithUsage(t,{objectiveDailyMs:3_600_000,globalDailyMs:7_200_000});
  assert.equal(store.claim('test-owner'),null);
  assert.equal(store.get(task.id).status,'SLEEPING');
  assert.throws(()=>store.setSettings({objectiveDailyMs:-1}),/Invalid budget/);
});
