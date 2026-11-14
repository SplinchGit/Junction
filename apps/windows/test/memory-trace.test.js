"use strict";
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {LocalDataStore}=require('../src/local-data');
const {memoryContext}=require('../src/assistant-context');
const {traceCandidates,traceMemory,runMemoryTraces,parseVerdicts}=require('../src/memory-trace');
const {memoryContract}=require('../src/shared-state');

function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'memory-trace-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const store=new LocalDataStore(directory);let clock=Date.UTC(2026,10,6,9);
  const add=(content,category,days=0)=>{clock+=days*86400000+1000;const item=store.addMemory(content,category);item.createdAt=item.validFrom=clock;store.save();return item;};
  return {store,add};
}
const verdicts=(...values)=>JSON.stringify({verdicts:values.map((verdict,index)=>({n:index+1,verdict,reason:'test'}))});

test('the local model retires a replaced fact, keeps its record, and the owner can restore it',async t=>{
  const {store,add}=fixture(t);
  const old=add('My bank is Northway Bank.','money'),gym=add('My gym membership costs 32 pounds a month.','money');
  const next=add('My bank is Calder Union.','money',6);
  const prompts=[];
  const applied=await runMemoryTraces({store,local:async({prompt})=>{prompts.push(prompt);const count=(prompt.match(/^\d+\. /gm)||[]).length;
    return verdicts(...Array.from({length:count},(_,index)=>prompt.includes('Calder')&&prompt.split('\n')[index+2].includes('Northway')?'REPLACES':'KEEPS'));},frontier:async()=>{throw new Error('not needed');}});
  assert.equal(applied.length,3);assert.equal(store.pendingMemoryTraces().length,0);
  const retired=store.memories().find(item=>item.id===old.id);
  assert.equal(retired.invalidatedAt,next.validFrom);assert.equal(retired.supersededBy,next.id);assert.equal(retired.supersession.by,'local-80b');
  assert.equal(store.memories().find(item=>item.id===gym.id).invalidatedAt,undefined);
  assert.equal(retired.content,'My bank is Northway Bank.');
  // The shared contract is unchanged, so the phone and Firestore never see the new fields.
  assert.deepEqual(Object.keys(memoryContract(retired,'pc')).sort(),['category','content','createdAt','deviceId','id','provenance','schemaVersion','sourceRef']);
  store.restoreMemory(old.id);assert.equal(store.memories().find(item=>item.id===old.id).invalidatedAt,undefined);
  // Owner deletion still removes the record and leaves a tombstone.
  store.deleteMemory(old.id);assert.equal(store.memories().some(item=>item.id===old.id),false);assert.ok(store.state.memoryTombstones.some(item=>item.id===old.id));
});

test('an unsure local verdict goes to the frontier model, and only that entry',async t=>{
  const {store,add}=fixture(t);
  const desk=add('My desk is on the third floor.','work'),boss=add('My project supervisor is Dr Hale.','work');
  const next=add('My desk is on the first floor.','work',3);
  let asked=null;
  const result=await traceMemory({fact:next,memories:store.memories(),
    local:async({prompt})=>verdicts(...prompt.split('\n').slice(2).map(line=>line.includes('third floor')?'UNSURE':'KEEPS')),
    frontier:async({prompt})=>{asked=prompt;return verdicts('REPLACES');}});
  assert.match(asked,/third floor/);assert.doesNotMatch(asked,/Hale/);
  assert.deepEqual(result.supersede.map(entry=>[entry.id,entry.by]),[[desk.id,'frontier']]);assert.deepEqual(result.unresolved,[]);
  // A frontier model that is also unsure changes nothing and the entry is reported.
  const unsettled=await traceMemory({fact:next,memories:store.memories(),local:async()=>'not json',frontier:async({prompt})=>verdicts(...prompt.split('\n').slice(2).map(()=>'UNSURE'))});
  assert.deepEqual(unsettled.supersede,[]);assert.deepEqual(unsettled.unresolved.sort(),[desk.id,boss.id].sort());
});

test('with neither model reachable the fact stays untraced and nothing is retired',async t=>{
  const {store,add}=fixture(t);
  add('My car is a blue Skoda Fabia.','car');add('My car is a grey Toyota Yaris.','car',2);
  const down=async()=>{throw new Error('offline');};
  await runMemoryTraces({store,local:down,frontier:down});
  assert.equal(store.pendingMemoryTraces().length,1);assert.equal(store.memories().some(item=>item.invalidatedAt),false);
});

test('a model cannot retire a later fact, an unrelated fact, or invent an entry',t=>{
  const {store,add}=fixture(t);
  const first=add('I go climbing on Tuesdays.','routine'),other=add('My dentist is Dr Okafor.','health'),later=add('I moved my climbing session to Thursdays.','routine',4);
  assert.deepEqual(traceCandidates(later,store.memories()).map(item=>item.id),[first.id]);
  assert.deepEqual(traceCandidates(first,store.memories()),[]);
  assert.throws(()=>store.supersedeMemory(later.id,first.id),/later fact/);
  assert.equal(parseVerdicts(JSON.stringify({verdicts:[{n:7,verdict:'REPLACES',reason:''},{n:1,verdict:'DELETE',reason:''}]}),1).size,0);
  assert.equal(store.memories().find(item=>item.id===other.id).invalidatedAt,undefined);
});

test('chat memory shows dates, hides replaced facts unless the question is about the past, and says when nothing matches',t=>{
  const {store,add}=fixture(t);
  const old=add('The Larkfield report deadline is 4 December.','work'),next=add('The Larkfield report deadline moved to 11 December.','work',5);
  store.supersedeMemory(old.id,next.id,{by:'local-80b'});
  const current=memoryContext(store.memories(),'When is the Larkfield report deadline?');
  assert.match(current,/\(stated 2026-11-11\) The Larkfield report deadline moved to 11 December/);assert.doesNotMatch(current,/4 December/);
  const past=memoryContext(store.memories(),'What was the Larkfield deadline before it moved?');
  assert.match(past,/\(stated 2026-11-06; replaced 2026-11-11, no longer current\) The Larkfield report deadline is 4 December/);
  assert.match(memoryContext(store.memories(),'What is my blood type?'),/no saved fact matches.*not been told/);
  assert.equal(memoryContext([],'What is my blood type?'),'');
  // A fact synced before dates existed still shows its creation date.
  assert.match(memoryContext([{id:'a',category:'x',content:'Phone fact about deadline',createdAt:Date.UTC(2026,9,1)}],'deadline'),/stated 2026-10-01/);
});
