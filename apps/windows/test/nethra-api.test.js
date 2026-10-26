'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {NethraStore}=require('../src/nethra-store');
const {NethraApi}=require('../src/nethra-api');
const {LocalDataStore}=require('../src/local-data');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-api-'));const store=new NethraStore(dir);t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});return {store,api:new NethraApi({store,runtime:{modelCapabilities:async()=>({known:true,thinking:true})}})};}

test('desktop status starts model prewarming without waiting for loading',async t=>{
  const {api}=fixture(t);let warmed=0;
  api.runtime.prewarm=()=>{warmed++;return new Promise(()=>{});};
  const result=await api.dispatch('nethra.status',{},'warm-desktop','desktop');
  assert.equal(result.model,'qwen3:30b');assert.equal(warmed,1);
});
test('opening an objective chat creates one durable association and retries reuse it',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-chat-link-'));
  const store=new NethraStore(dir),localData=new LocalDataStore(path.join(dir,'local'));
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const api=new NethraApi({store,localData,runtime:{}});
  const task=store.create({goal:'Track coursework'});
  const first=await api.dispatch('nethra.openChat',{id:task.id},'first','android');
  const second=await api.dispatch('nethra.openChat',{id:task.id},'second','desktop');
  assert.equal(first.conversationId,second.conversationId);
  assert.equal(localData.conversations().length,1);
  assert.equal((await api.dispatch('nethra.list')).objectives[0].conversationId,first.conversationId);
  assert.equal((await api.dispatch('nethra.get',{id:task.id},'detail','android')).task.conversationId,first.conversationId);
  const reopened=new NethraApi({store,localData:new LocalDataStore(path.join(dir,'local')),runtime:{}});
  assert.equal((await reopened.dispatch('nethra.openChat',{id:task.id})).conversationId,first.conversationId);
});
test('a deleted objective chat is not resurrected',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-chat-deleted-'));
  const store=new NethraStore(dir),localData=new LocalDataStore(path.join(dir,'local'));
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const api=new NethraApi({store,localData,runtime:{}}),task=store.create({goal:'Track deadlines'});
  const first=await api.dispatch('nethra.openChat',{id:task.id});
  localData.deleteConversation(first.conversationId);
  await assert.rejects(api.dispatch('nethra.openChat',{id:task.id}),/deleted/i);
  assert.equal(localData.conversation(first.conversationId),null);
});
test('opening after an interrupted JSON-first link reuses the orphan chat',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-chat-recover-'));
  const store=new NethraStore(dir),localData=new LocalDataStore(path.join(dir,'local'));
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const task=store.create({goal:'Stay on top of coursework'});
  const id=`nethra_task_${task.id.replaceAll('-','_')}`;
  localData.createConversation(id);
  const api=new NethraApi({store,localData,runtime:{}});
  assert.equal((await api.dispatch('nethra.openChat',{id:task.id})).conversationId,id);
  assert.equal(localData.conversations().length,1);
});
test('paired phone creates durable objectives but cannot grant itself PC read roots',async t=>{const {api,store}=fixture(t);await assert.rejects(api.dispatch('nethra.create',{goal:'Research housing',readRoots:['C:/Users']},'bad','android'),/Windows/);const {task}=await api.dispatch('nethra.create',{goal:'Research housing'},'create','android');assert.equal(store.get(task.id).goal,'Research housing');assert.deepEqual(store.get(task.id).readRoots,[]);});
test('replayed creates preserve a single objective and reject changed goals',async t=>{const {api,store}=fixture(t);const a=await api.dispatch('nethra.create',{goal:'Research housing'},'create');const b=await api.dispatch('nethra.create',{goal:'Research housing'},'create');assert.equal(a.task.id,b.task.id);assert.equal(store.list().length,1);await assert.rejects(api.dispatch('nethra.create',{goal:'Different goal'},'create'));});
test('thinking preference is persisted and startup remains a Windows setting',async t=>{const {api,store}=fixture(t);await api.dispatch('nethra.settings',{thinking:true},'think','android');assert.equal(store.settings().thinking,true);await assert.rejects(api.dispatch('nethra.settings',{persistentStartup:true},'start','android'),/Windows/);await assert.rejects(api.dispatch('nethra.settings',{thinking:'yes'}),/thinking/);});
test('30B thinking-only mode is reported honestly and cannot be disabled',async t=>{
  const {api,store}=fixture(t);
  assert.equal((await api.dispatch('nethra.status')).thinkingRequired,true);
  assert.equal((await api.dispatch('nethra.list')).settings.thinking,true);
  await assert.rejects(api.dispatch('nethra.settings',{thinking:false}),/always uses thinking/);
  const {task}=await api.dispatch('nethra.create',{goal:'Review evidence'});
  assert.equal(store.get(task.id).thinking,true);
});
test('Windows and Android share durable autonomy, priority, check-in and attention journal',async t=>{
  const {api}=fixture(t);
  const {task}=await api.dispatch('nethra.create',{goal:'Monitor university deadlines',autonomy:'QUIET',priority:2,checkIn:'DAILY'},'create-policy','android');
  assert.equal(task.autonomy,'QUIET');
  const changed=await api.dispatch('nethra.configure',{id:task.id,revision:task.revision,autonomy:'ACTIVE',checkIn:'MILESTONES'},'policy','android');
  assert.equal(changed.task.autonomy,'ACTIVE');
  assert.equal((await api.dispatch('nethra.list')).objectives[0].checkIn,'MILESTONES');
  const detail=await api.dispatch('nethra.get',{id:task.id},'get','android');
  assert.equal(detail.task.priority,2);
  assert.equal(detail.task.continuous,false);
  await api.dispatch('nethra.configure',{id:task.id,revision:changed.task.revision,continuous:true},'continuous','android');
  assert.equal((await api.dispatch('nethra.get',{id:task.id},'continuous-detail','android')).task.continuous,true);
  assert.ok(Array.isArray(detail.attention));
  await assert.rejects(api.dispatch('nethra.configure',{id:task.id,revision:task.revision,autonomy:'UNBOUNDED'},'bad','android'),/autonomy/i);
});
test('reunion audit is grounded in durable events and never invokes the model',async t=>{
  const {api,store}=fixture(t);
  const task=store.create({goal:'Track deadlines'});
  store.update(task.id,{plan:['Check deadlines'],summary:'Plan saved'},'CHECKPOINT');
  const result=await api.dispatch('nethra.reunion',{since:0},'reunion','android');
  assert.equal(result.modelInvoked,false);
  assert.equal(result.objectives.length,1);
  assert.ok(result.events.some(event=>event.kind==='CHECKPOINT'&&event.taskId===task.id));
  assert.equal(result.pendingApprovals,0);
});

test('large unicode objective lists fit the encrypted transport without losing task IDs',async()=>{
  const tasks=Array.from({length:100},(_,i)=>({id:`task-${i}`,goal:'界'.repeat(500),summary:'界'.repeat(500),status:'ACTIVE',revision:1,persistent:true}));
  const api=new NethraApi({store:{list:()=>tasks,settings:()=>({thinking:true})}});
  const result=await api.dispatch('nethra.list',{},'list','android');
  assert.ok(Buffer.byteLength(JSON.stringify(result))<50000);
  assert.deepEqual(result.objectives.map(t=>t.id),tasks.map(t=>t.id));
});

test('paired answer retries return the durable response before live state checks',async t=>{
  const {api,store}=fixture(t);const task=store.create({goal:'Research sources'});
  const waiting=store.update(task.id,{status:'WAITING_FOR_USER'});
  const payload={id:task.id,answer:'Use source A',revision:waiting.revision};
  const first=await api.dispatch('nethra.answer',payload,'answer-retry','android');
  const retry=await api.dispatch('nethra.answer',payload,'answer-retry','android');
  assert.deepEqual(retry,first);assert.equal(store.get(task.id).ownerInputs.length,1);
  await assert.rejects(api.dispatch('nethra.answer',{...payload,answer:'Use B'},'answer-retry','android'),/payload mismatch/);
  await assert.rejects(api.dispatch('nethra.answer',{...payload,revision:first.task.revision},'new-answer','android'),/not waiting/);
});

test('large pending approvals stay individually actionable within the Android frame',async t=>{
  const {api,store}=fixture(t),task=store.create({goal:'Review two exact draft replacements'});
  const first=store.requestApproval(task.id,{tool:'write_draft',args:{path:'one.txt',content:'a'.repeat(24000)},category:'LOCAL_WRITE',key:'one'});
  const second=store.requestApproval(task.id,{tool:'write_draft',args:{path:'two.txt',content:'b'.repeat(24000)},category:'LOCAL_WRITE',key:'two'});
  const detail=await api.dispatch('nethra.get',{id:task.id},'detail','android');
  assert.ok(Buffer.byteLength(JSON.stringify(detail))<50000);
  assert.equal(detail.approvals.length,1);
  assert.equal(detail.approvals[0].id,first.id);
  assert.equal(detail.approvals[0].args.content.length,24000);
  assert.equal(detail.moreApprovals,1);
  store.decideApproval(first.id,false,'reject-one');
  const next=await api.dispatch('nethra.get',{id:task.id},'next','android');
  assert.equal(next.approvals[0].id,second.id);
});

test('oversize Unicode approval requires complete review on Windows',async t=>{
  const {api,store}=fixture(t),task=store.create({goal:'Review Unicode draft'});
  store.requestApproval(task.id,{tool:'write_draft',args:{path:'unicode.txt',content:'界'.repeat(24000)},category:'LOCAL_WRITE',key:'unicode'});
  const detail=await api.dispatch('nethra.get',{id:task.id},'detail','android');
  assert.ok(Buffer.byteLength(JSON.stringify(detail))<50000);
  assert.equal(detail.approvals[0].reviewOnWindows,true);
  assert.equal(detail.approvals[0].args.content.length,1000);
  assert.match(detail.approvals[0].contentSha256,/^[0-9a-f]{64}$/);
});
