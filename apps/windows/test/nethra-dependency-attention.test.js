'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {NethraStore}=require('../src/nethra-store');
const {NethraAttention}=require('../src/nethra-attention');
const {NethraScheduler}=require('../src/nethra-scheduler');

function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-dependency-attention-'));
  let time=1_800_000_000_000;
  const now=()=>time;
  const stores=[];
  const open=()=>{const store=new NethraStore(dir,{now});stores.push(store);return store;};
  t.after(()=>{for(const store of stores)store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const store=open();
  return {store,open,now,advance:ms=>time+=ms,
    finish:task=>store.save({...store.get(task.id),status:'COMPLETED'},'TEST_COMPLETED'),
    sleep:(task,dependencies)=>store.update(task.id,{status:'SLEEPING',dependencies,nextWakeAt:now()+86_400_000})};
}

test('only the last completed prerequisite wakes an existing dependent task, once across restart',async t=>{
  const f=fixture(t),first=f.store.create({goal:'Verify grant dates'}),second=f.store.create({goal:'Verify funding criteria'});
  const dependent=f.sleep(f.store.create({goal:'Draft funding section'}),[first.id,second.id]);
  const attention=new NethraAttention(f.store,{now:f.now});
  f.finish(first);
  assert.equal(attention.reconcileDependencies(),0);
  assert.equal(f.store.get(dependent.id).nextWakeAt,dependent.nextWakeAt);
  f.finish(second);
  assert.equal(attention.reconcileDependencies(),1);
  assert.equal(f.store.get(dependent.id).nextWakeAt,f.now());
  const reopened=f.open();
  assert.equal(new NethraAttention(reopened,{now:f.now}).reconcileDependencies(),0);
  let runs=0;
  const scheduler=new NethraScheduler({store:reopened,now:f.now,execute:async task=>{
    runs++;
    assert.equal(task.id,dependent.id);
    const [event]=reopened.attention(task.id);
    assert.equal(event.kind,'DEPENDENCIES_READY');
    assert.equal(event.state,'CLAIMED');
    assert.match(event.evidenceRef,new RegExp(second.id));
    return {status:'SLEEPING',nextWakeAt:f.now()+86_400_000};
  }});
  await scheduler.tick();
  f.advance(15_000);
  await scheduler.tick();
  assert.equal(runs,1);
  assert.equal(reopened.attention(dependent.id).length,1);
  assert.equal(reopened.list().length,3);
});

test('a completed prerequisite cannot override a pause or an approval gate',t=>{
  const f=fixture(t),prerequisite=f.store.create({goal:'Collect sources'});
  const paused=f.sleep(f.store.create({goal:'Draft a report'}),[prerequisite.id]);
  f.store.control(paused.id,'pause',paused.revision,'pause');
  const waiting=f.store.create({goal:'Review a protected write'});
  f.store.save({...waiting,status:'WAITING_FOR_USER',dependencies:[prerequisite.id]},'TEST_WAITING');
  f.finish(prerequisite);
  assert.equal(new NethraAttention(f.store,{now:f.now}).reconcileDependencies(),0);
  assert.equal(f.store.get(paused.id).status,'PAUSED');
  assert.equal(f.store.get(waiting.id).status,'WAITING_FOR_USER');
  assert.deepEqual(f.store.attention(paused.id),[]);
  assert.deepEqual(f.store.attention(waiting.id),[]);
});

test('a stale completed prerequisite does not accelerate an established schedule',t=>{
  const f=fixture(t),prerequisite=f.finish(f.store.create({goal:'Collect sources'}));
  const task=f.sleep(f.store.create({goal:'Draft a report'}),[prerequisite.id]);
  f.store.save({...task,lastExecutionAt:f.now()},'CLAIMED');
  assert.equal(new NethraAttention(f.store,{now:f.now}).reconcileDependencies(),0);
  assert.equal(f.store.get(task.id).nextWakeAt,task.nextWakeAt);
});

test('task progress identifies a stopped prerequisite without starting either objective',t=>{
  const f=fixture(t),prerequisite=f.store.create({goal:'Verify grant deadline'});
  const dependent=f.sleep(f.store.create({goal:'Draft funding section'}),[prerequisite.id]);
  f.store.save({...prerequisite,status:'FAILED'},'TEST_FAILED');
  const {waitingFor}=require('../src/nethra-progress');
  const waiting=waitingFor(f.store.get(dependent.id),f.store,f.now());
  assert.equal(waiting.kind,'dependency');
  assert.match(waiting.detail,/Verify grant deadline.*failed/);
  assert.match(waiting.detail,/review/i);
  assert.equal(new NethraAttention(f.store,{now:f.now}).reconcileDependencies(),0);
  assert.equal(f.store.claim('worker'),null);
});

test('dependency completion still obeys the scheduler inference budget',async t=>{
  const f=fixture(t),prerequisite=f.store.create({goal:'Collect documents'});
  const dependent=f.sleep(f.store.create({goal:'Draft funding section'}),[prerequisite.id]);
  f.store.setSettings({globalDailyMs:0});
  f.finish(prerequisite);
  const scheduler=new NethraScheduler({store:f.store,now:f.now,execute:async()=>assert.fail('budget must prevent execution')});
  await scheduler.tick();
  assert.equal(f.store.get(dependent.id).status,'SLEEPING');
  assert.ok(f.store.get(dependent.id).nextWakeAt>f.now());
  assert.equal(f.store.attention(dependent.id)[0].state,'PENDING');
});

test('re-completion is new evidence, while editing a completed task is not',async t=>{
  const f=fixture(t),prerequisite=f.store.create({goal:'Collect documents'});
  const dependent=f.sleep(f.store.create({goal:'Draft funding section'}),[prerequisite.id]);
  const completed=f.finish(prerequisite);
  let runs=0;
  const scheduler=new NethraScheduler({store:f.store,now:f.now,execute:async()=>{
    runs++;
    return {status:'SLEEPING',nextWakeAt:f.now()+86_400_000};
  }});
  await scheduler.tick();
  f.store.edit(prerequisite.id,{goal:'Collect the approved documents'},completed.revision,'fix-wording',{execution:'preserve'});
  f.advance(15_000);
  await scheduler.tick();
  assert.equal(runs,1);
  const updated=f.store.get(prerequisite.id);
  f.store.edit(prerequisite.id,{},updated.revision,'continue-prerequisite',{execution:'continue',instruction:'Collect the new revision'});
  f.finish(prerequisite);
  f.advance(15_000);
  await scheduler.tick();
  assert.equal(runs,2);
  assert.equal(f.store.attention(dependent.id).length,2);
});

test('completion lookup survives a long prerequisite activity journal',t=>{
  const f=fixture(t),prerequisite=f.finish(f.store.create({goal:'Collect documents'}));
  const dependent=f.sleep(f.store.create({goal:'Draft funding section'}),[prerequisite.id]);
  for(let i=0;i<101;i++)f.store.save(prerequisite,'TEST_METADATA');
  assert.equal(new NethraAttention(f.store,{now:f.now}).reconcileDependencies(),1);
  assert.equal(f.store.get(dependent.id).nextWakeAt,f.now());
});
