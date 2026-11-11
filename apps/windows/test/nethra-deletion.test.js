'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {NethraStore}=require('../src/nethra-store');
const {NethraScheduler}=require('../src/nethra-scheduler');
const {NethraApi}=require('../src/nethra-api');
const {LocalDataStore}=require('../src/local-data');
const {DeviceCommandStore}=require('../src/device-commands');

function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-delete-'));
  const f={dir,store:new NethraStore(dir),localData:new LocalDataStore(path.join(dir,'local'))};
  t.after(()=>{f.commands?.close();f.store.close();fs.rmSync(dir,{recursive:true,force:true});});
  f.api=new NethraApi({store:f.store,localData:f.localData,runtime:{}});
  return f;
}

test('deleting during inference settles cleanly and cannot publish or recreate the task',async t=>{
  const f=fixture(t),task=f.store.create({goal:'Research',requestId:'create'});
  let enter,finish;const entered=new Promise(r=>enter=r),pending=new Promise(r=>finish=r);
  let reports=0;
  const scheduler=new NethraScheduler({store:f.store,onSettled:()=>reports++,execute:async(_,{checkpoint})=>{enter();await pending;checkpoint({summary:'late'});return {status:'SLEEPING'};}});
  const running=scheduler.tick();await entered;
  f.store.remove(task.id,'delete');finish();await running;
  assert.equal(scheduler.lastError,undefined);assert.equal(reports,0);
  assert.equal(f.store.list().length,0);assert.equal(f.store.liveTaskId(),null);
  await scheduler.tick();assert.equal(f.store.list().length,0);
});

test('old mutation receipts and stale saves cannot restore a deleted task across restart',t=>{
  const f=fixture(t),input={goal:'Original request',conversationId:'kept_chat',requestId:'create'};
  const task=f.store.create(input);
  const paused=f.store.control(task.id,'pause',task.revision,'pause');
  f.store.remove(task.id,'delete');
  f.store.close();f.store=new NethraStore(f.dir);
  assert.throws(()=>f.store.create(input),/deleted/i);
  assert.throws(()=>f.store.control(task.id,'pause',task.revision,'pause'),/deleted/i);
  assert.throws(()=>f.store.save(paused,'LATE'),/deleted/i);
  assert.equal(f.store.list().length,0);
  assert.equal(f.store.remove(task.id,'new-delete').deleted,true);
  assert.throws(()=>f.store.remove('different','new-delete'),/mismatch/i);
});

test('deletion works in every state and keeps the ordinary conversation',async t=>{
  const f=fixture(t);
  for(const status of ['CREATED','PLANNING','ACTIVE','SLEEPING','PAUSED','WAITING_FOR_USER','BLOCKED','COMPLETED','FAILED','CANCELLED']){
    const {task}=await f.api.dispatch('nethra.create',{goal:`Fixture ${status}`},`create-${status}`,'desktop');
    f.store.save({...task,status,nextWakeAt:Date.now()+1000},'FIXTURE');
    fs.writeFileSync(path.join(task.workspace,'draft.txt'),'saved draft');
    const result=await f.api.dispatch('nethra.delete',{id:task.id,confirm:true},`delete-${status}`,'android');
    assert.equal(result.deleted,true);assert.equal(fs.existsSync(task.workspace),false);
    assert.ok(f.localData.conversation(task.conversationId));
    assert.equal(f.store.events(task.id).length,0);
    assert.equal(f.store.remove(task.id,`retry-${status}`).deleted,true);
  }
  assert.equal(f.store.list().length,0);
});

test('workspace cleanup failure is durable, inspectable and retried after restart',t=>{
  const f=fixture(t),task=f.store.create({goal:'Cleanup fixture'}),original=fs.rmSync;
  fs.rmSync=(target,options)=>{if(target===task.workspace)throw Object.assign(new Error('file busy'),{code:'EBUSY'});return original(target,options);};
  let result;try{result=f.store.remove(task.id,'delete');}finally{fs.rmSync=original;}
  assert.equal(result.deleted,true);assert.equal(result.cleanup.workspace,'PENDING');
  assert.match(f.store.deletion(task.id).cleanup.error,/EBUSY|file busy/);
  f.store.close();f.store=new NethraStore(f.dir);f.store.retryDeletionCleanup();
  assert.equal(fs.existsSync(task.workspace),false);
  assert.equal(f.store.deletion(task.id).cleanup.workspace,'DONE');
});

test('API deletion aborts only the matching execution and retries related cleanup',async t=>{
  const f=fixture(t),task=f.store.create({goal:'Abort fixture'});
  let enter;const entered=new Promise(r=>enter=r);let signal;
  const scheduler=new NethraScheduler({store:f.store,execute:async(_,options)=>{signal=options.signal;enter();await new Promise(()=>{});}});
  f.api.scheduler=scheduler;
  const running=scheduler.tick();await entered;
  assert.equal(scheduler.abortTask('another-id'),false);assert.equal(signal.aborted,false);
  await f.api.dispatch('nethra.delete',{id:task.id,confirm:true},'delete','desktop');
  await running;assert.equal(signal.aborted,true);assert.equal(f.store.list().length,0);
});

test('legacy deletion receipts become tombstones without touching conversations or settings',t=>{
  const f=fixture(t),task=f.store.create({goal:'Legacy deletion',requestId:'legacy-create'});
  f.store.remove(task.id,'legacy-delete');
  f.store.db.exec('DROP TABLE task_deletions; PRAGMA user_version=5;');
  f.store.close();f.store=new NethraStore(f.dir);
  assert.equal(f.store.deletion(task.id).deleted,true);
  assert.throws(()=>f.store.create({goal:'Legacy deletion',requestId:'legacy-create'}),/deleted/i);
  assert.equal(f.store.remove(task.id,'retry').deleted,true);
});

test('related cleanup retries without delivering deleted task commands or losing its receipt',async t=>{
  const f=fixture(t),task=f.store.create({goal:'Related work'});
  const commands=new DeviceCommandStore(f.dir);f.commands=commands;
  const pending=commands.enqueue({kind:'STATUS',requestedBy:'nethra',taskId:task.id,requestId:'phone'});
  const unrelated=commands.enqueue({kind:'STATUS',requestedBy:'owner',requestId:'unrelated'});
  let unavailable=true,stopped=0;
  f.api.deviceCommands=commands;
  f.api.onDeleteTask=async id=>{assert.equal(id,task.id);if(unavailable)throw new Error('Work Activity finishing a review');stopped++;};
  const result=await f.api.dispatch('nethra.delete',{id:task.id,confirm:true},'delete');
  assert.equal(result.deleted,true);assert.equal(result.cleanup.related,'PENDING');
  assert.equal(commands.get(pending.id).state,'CANCELLED');
  assert.equal(commands.get(unrelated.id).state,'QUEUED');
  unavailable=false;await f.api.reconcileDeletions();
  assert.equal(stopped,1);assert.equal(f.store.deletion(task.id).cleanup.related,'DONE');
  await f.api.reconcileDeletions();assert.equal(stopped,1);
});

test('deleting a dependency blocks dependent work instead of making it eligible',t=>{
  const f=fixture(t),parent=f.store.create({goal:'Required research'}),child=f.store.create({goal:'Use research'});
  f.store.update(child.id,{dependencies:[parent.id],status:'SLEEPING',nextWakeAt:Date.now()+1000});
  f.store.remove(parent.id,'delete');
  assert.equal(f.store.get(child.id).status,'BLOCKED');
  assert.equal(f.store.claim('worker'),null);
  const blocked=f.store.get(child.id);
  const redirected=f.store.redirect(child.id,'Continue using other verified sources',blocked.revision,'owner-redirect');
  assert.deepEqual(redirected.dependencies,[]);
  assert.equal(f.store.claim('worker').task.id,child.id);
  assert.ok(f.store.events(child.id).some(event=>event.kind==='DELETED_DEPENDENCY_WAIVED'));
});

test('diagnostic pages preserve large unicode event detail within the paired transport limit',async t=>{
  const f=fixture(t),task=f.store.create({goal:'Diagnostic pages'});
  const detail={receipt:'漢字🙂'.repeat(18000)};
  f.store.save(task,'LARGE_RECEIPT',detail);
  let cursor={seq:0,offset:0},text='',seen=0;
  while(cursor){
    const result=await f.api.dispatch('nethra.get',{id:task.id,diagnosticsCursor:cursor},`page-${seen++}`,'android');
    assert.ok(Buffer.byteLength(JSON.stringify(result))<50000);
    for(const event of result.events)if(event.kind==='LARGE_RECEIPT')text+=event.detail;
    cursor=result.nextCursor;
    assert.ok(seen<30);
  }
  assert.deepEqual(JSON.parse(text),detail);
});
test('older tasks remain reachable beyond the first paired list page',async t=>{
  const f=fixture(t),ids=[];
  for(let i=0;i<105;i++){
    const task=f.store.create({goal:`Older task ${i}`});
    f.store.control(task.id,'pause',task.revision,`pause-${i}`);ids.push(task.id);
  }
  const first=await f.api.dispatch('nethra.list',{},'page-1','android');
  assert.ok(first.objectives.length>0&&first.objectives.length<=100);assert.ok(first.nextOffset>0);
  const found=[...first.objectives];let offset=first.nextOffset;
  while(offset!==null){const page=await f.api.dispatch('nethra.list',{offset},`page-${offset}`,'android');assert.ok(Buffer.byteLength(JSON.stringify(page))<=50000);found.push(...page.objectives);offset=page.nextOffset;}
  assert.equal(new Set(found.map(task=>task.id)).size,105);
  assert.ok(found.every(task=>task.goal.length>0));
  const removed=await f.api.dispatch('nethra.delete',{id:ids[0],confirm:true},'delete-oldest','android');
  assert.equal(removed.deleted,true);
});
