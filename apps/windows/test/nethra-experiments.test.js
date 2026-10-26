'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {NethraStore}=require('../src/nethra-store');
const {NethraTools}=require('../src/nethra-tools');
const {progressView}=require('../src/nethra-progress');
const {mannWhitneyP}=require('../src/nethra-experiments');

const START=Date.parse('2026-10-20T12:00:00Z'),MIN=60_000;
function harness(t){
  let now=START;
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-experiments-'));
  const store=new NethraStore(directory,{now:()=>now});
  t.after(()=>{store.close();fs.rmSync(directory,{recursive:true,force:true});});
  const usage=[];
  const localData={usage:()=>[...usage].sort((a,b)=>b.createdAt-a.createdAt)};
  const chat=(durationMs,model='qwen3:30b')=>{usage.push({providerId:'local',model,createdAt:now,durationMs,tokensPerSecond:17});now+=MIN;};
  const task=store.create({goal:'Self Improvement',allowCodeWork:true});
  const tools=new NethraTools({store,localData});
  const run=args=>tools.execute('experiment',args,store.get(task.id));
  return {store,task,tools,run,chat,advance:ms=>{now+=ms;},now:()=>now};
}

test('the rank test separates clearly different timings and not identical ones',()=>{
  assert.ok(mannWhitneyP([9000,9100,9300,8800,9500,9050],[6100,6000,6400,5900,6200,6300])<0.01);
  assert.ok(mannWhitneyP([7000,7100,6900,7050,6950],[7020,6980,7080,6920,7010])>0.3);
});

test('abandoning an unused baseline appears in task progress',async t=>{
  const h=harness(t);
  for(const ms of [7000,7100,7200,7300,7400])h.chat(ms);
  const started=await h.run({action:'start',metric:'chat_response_ms',hypothesis:'Unused baseline'});
  await h.run({action:'abandon',id:started.id,note:'No implementation is approved'});
  assert.match(progressView(h.store.get(h.task.id),h.store).activity.map(item=>item.line).join(' '),/Abandoned.*baseline/i);
});

test('a speedup is only reported after a frozen baseline, a recorded change and enough new samples',async t=>{
  const h=harness(t);
  for(const ms of [7100,7400]) h.chat(ms);
  await assert.rejects(h.run({action:'start',metric:'chat_response_ms',hypothesis:'Warm-up helps'}),/Only 2 baseline samples/);
  for(const ms of [6900,7600,7300,7200]) h.chat(ms);
  const started=await h.run({action:'start',metric:'chat_response_ms',hypothesis:'Earlier warm-up shortens replies',changeKind:'setting'});
  assert.equal(started.status,'BASELINE');assert.equal(started.baseline.count,6);assert.equal(started.baseline.values,undefined);
  assert.equal((await h.run({action:'evaluate',id:started.id})).result.verdict,'WAITING_FOR_CHANGE');
  // Samples recorded before the change never count as "after", even once it is marked.
  await h.run({action:'mark_change',id:started.id,note:'Changed retention to 4h'});
  await assert.rejects(h.run({action:'mark_change',id:started.id}),/already recorded/);
  for(const ms of [5100,5300]) h.chat(ms);
  const early=await h.run({action:'evaluate',id:started.id});
  assert.equal(early.result.verdict,'INSUFFICIENT_DATA');assert.equal(early.status,'CHANGED');
  for(const ms of [5000,5400,5200,5250]) h.chat(ms);
  const done=await h.run({action:'evaluate',id:started.id});
  assert.equal(done.status,'CONCLUDED');assert.equal(done.result.verdict,'IMPROVED');
  assert.ok(done.result.relativeChange<-0.2);assert.ok(done.result.pValue<0.05);
  // Later samples cannot rewrite a concluded verdict.
  for(const ms of [9000,9100,9200,9300,9400]) h.chat(ms);
  assert.equal((await h.run({action:'evaluate',id:started.id})).result.verdict,'IMPROVED');
  const activity=progressView(h.store.get(h.task.id),h.store).activity;
  assert.ok(activity.some(item=>item.actor==='Junction'&&/improved \d+%/.test(item.line)));
});

test('a slower result is reported as a regression, and noise as no clear change',async t=>{
  const h=harness(t);
  for(const ms of [6000,6100,5900,6050,5950]) h.chat(ms);
  const worse=await h.run({action:'start',metric:'chat_response_ms',hypothesis:'Longer prompt',changeKind:'other'});
  const same=await h.run({action:'start',metric:'chat_response_ms',hypothesis:'Cosmetic change',changeKind:'other'});
  await h.run({action:'mark_change',id:worse.id});await h.run({action:'mark_change',id:same.id});
  for(const ms of [6020,5980,6010,6030,5970]) h.chat(ms);
  assert.equal((await h.run({action:'evaluate',id:same.id})).result.verdict,'NO_CLEAR_CHANGE');
  for(const ms of [8000,8200,8100,8300,7900,8050,8150,7950,8250,8120]) h.chat(ms);
  assert.equal((await h.run({action:'evaluate',id:worse.id})).result.verdict,'REGRESSED');
});

test('a code change only counts samples from a Junction process started after it',async t=>{
  const h=harness(t);
  for(const ms of [7000,7100,7200,7300,7400]) h.chat(ms);
  const started=await h.run({action:'start',metric:'chat_response_ms',hypothesis:'Faster prompt assembly'});
  assert.equal(started.changeKind,'code');
  await h.run({action:'mark_change',id:started.id});
  for(const ms of [4000,4100,4200,4300,4400]) h.chat(ms);
  assert.equal((await h.run({action:'evaluate',id:started.id})).result.verdict,'WAITING_FOR_RESTART');
  h.advance(MIN);h.store.recordHostStart();h.advance(MIN);
  for(const ms of [5000,5100,5200,5300,5400]) h.chat(ms);
  const done=await h.run({action:'evaluate',id:started.id});
  assert.equal(done.result.verdict,'IMPROVED');assert.equal(done.result.after.median,5200);
});

test('a linked development draft sets the change point when Work Activity promotes it',async t=>{
  const h=harness(t);let promotedAt=null;
  const tools=new NethraTools({store:h.store,localData:h.tools.localData,workStatus:id=>id==='work-1'?{status:'COMPLETED',promotedAt}:null});
  for(const ms of [7000,7100,7200,7300,7400]) h.chat(ms);
  const run=args=>tools.execute('experiment',args,h.store.get(h.task.id));
  const started=await run({action:'start',metric:'chat_response_ms',hypothesis:'Draft speeds things up',workId:'work-1',changeKind:'setting'});
  assert.equal((await run({action:'evaluate',id:started.id})).result.verdict,'WAITING_FOR_CHANGE');
  h.advance(MIN);promotedAt=h.now();
  for(const ms of [5000,5100,5200,5300,5400]) h.chat(ms);
  assert.equal((await run({action:'evaluate',id:started.id})).result.verdict,'IMPROVED');
});

test('chat experiments compare the same model, experiments need self-improvement, and deletion removes them',async t=>{
  const h=harness(t);
  for(const ms of [7000,7100,7200,7300,7400]) h.chat(ms);
  const started=await h.run({action:'start',metric:'chat_response_ms',hypothesis:'Model-specific'});
  assert.equal(h.store.experiment(h.task.id,started.id).model,'qwen3:30b');
  await h.run({action:'mark_change',id:started.id});
  h.advance(MIN);h.store.recordHostStart();
  for(const ms of [1000,1100,1200,1300,1400]) h.chat(ms,'qwen3:8b');
  assert.equal((await h.run({action:'evaluate',id:started.id})).result.verdict,'INSUFFICIENT_DATA');
  const other=h.store.create({goal:'Plain task'});
  await assert.rejects(h.tools.execute('experiment',{action:'start',metric:'chat_response_ms',hypothesis:'x'},h.store.get(other.id)),/not enabled/);
  await assert.rejects(h.run({action:'evaluate'}),/Open experiments: .*chat_response_ms/);
  h.store.control(h.task.id,'cancel',h.store.get(h.task.id).revision,'cancel-1');
  h.store.remove(h.task.id,'remove-1');
  assert.deepEqual(h.store.experiments(h.task.id),[]);
});

test('Nethra can inspect and abandon its own unused baselines without claiming a result',async t=>{
  const h=harness(t);
  for(const ms of [7000,7100,7200,7300,7400])h.chat(ms);
  const ids=[];
  for(let i=0;i<3;i++)ids.push((await h.run({action:'start',metric:'chat_response_ms',hypothesis:`Candidate ${i}`})).id);
  const listed=await h.run({action:'list'});
  assert.deepEqual(listed.filter(item=>item.status==='BASELINE').map(item=>item.id),ids.slice().reverse());
  await assert.rejects(h.run({action:'start',metric:'chat_response_ms',hypothesis:'Fourth candidate'}),/three open experiments/);
  const abandoned=await h.run({action:'abandon',id:ids[0],note:'Owner deferred this change'});
  assert.equal(abandoned.status,'CONCLUDED');
  assert.equal(abandoned.result.verdict,'ABANDONED');
  assert.equal(h.store.events(h.task.id).at(-1).kind,'EXPERIMENT_ABANDONED');
  assert.equal((await h.run({action:'start',metric:'chat_response_ms',hypothesis:'Fourth candidate'})).status,'BASELINE');
  await assert.rejects(h.run({action:'abandon',id:ids[1],note:''}),/note/);
});
