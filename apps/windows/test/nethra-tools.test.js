'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {NethraTools}=require('../src/nethra-tools');
test('watched Google evidence must be fresh and authorized before it can prove progress',async()=>{
  let reads=0;const state={status:'STALE',lastSyncAt:100};
  const calendar={status:()=>state,event:()=>{reads++;return {summary:'University coursework deadline'};}};
  const gmail={status:()=>state,message:()=>{reads++;return {subject:'University coursework reminder'};}};
  const tools=new NethraTools({store:{get:()=>({status:'ACTIVE'})},calendar,gmail});
  const task={id:'coursework',sources:['calendar','gmail']};
  await assert.rejects(tools.execute('calendar_event',{id:'event-1'},task),/fresh|connected/i);
  await assert.rejects(tools.execute('gmail_message',{id:'mail-1'},task),/fresh|connected/i);
  assert.equal(reads,0);
  state.status='CONNECTED';state.lastSyncAt=Date.now();
  assert.equal((await tools.execute('calendar_event',{id:'event-1'},task)).untrustedEvent.summary,'University coursework deadline');
  assert.equal((await tools.execute('gmail_message',{id:'mail-1'},task)).untrustedHeaders.subject,'University coursework reminder');
  await assert.rejects(tools.execute('calendar_event',{id:'event-1'},{id:'other',sources:[]}),/does not watch/);
});

function researchTools() {
  const queries=[];
  const tools=new NethraTools({store:{get:()=>({status:'ACTIVE'})},researchCoordinator:{run:async query=>{queries.push(query);return {sources:[{url:'https://example.com/source',title:'Public source',snippet:'Public evidence'}]};}}});
  return {tools,queries};
}
test('private file values cannot escape through short, numeric, or Unicode search tokens',async()=>{
  const {tools,queries}=researchTools();
  const task={id:'private',goal:'Summarize my local note',evidence:[{tool:'read_file',result:{content:'PIN 1234 code x7 漏密'}}]};
  for(const query of ['PIN 1234','code x7','漏密','2026'])await assert.rejects(tools.execute('web_search',{query},task),/not grounded/);
  assert.deepEqual(queries,[]);
});
test('search accepts owner terms, useful query vocabulary, and prior public evidence',async()=>{
  const {tools,queries}=researchTools();
  const task={id:'public',goal:'Research UK weather',evidence:[{tool:'web_search',result:{evidence:{sources:[{title:'Leeds forecast 2026'}]}}}]};
  await tools.execute('web_search',{query:'latest UK weather forecast'},task);
  await tools.execute('web_search',{query:'Leeds forecast 2026'},task);
  assert.deepEqual(queries,['latest UK weather forecast','Leeds forecast 2026']);
});

test('completed draft receipts cannot report success after replacement or deletion',async t=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const {NethraStore}=require('../src/nethra-store');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-receipt-test-'));
  const store=new NethraStore(directory);
  t.after(()=>{store.close();fs.rmSync(directory,{recursive:true,force:true});});
  const task=store.create({goal:'Write a report'}),tools=new NethraTools({store});
  const original={path:'report.txt',content:'A'};
  const first=await tools.execute('write_draft',original,task);
  assert.deepEqual(await tools.execute('write_draft',original,task),first);
  let approval;
  try{await tools.execute('write_draft',{path:'report.txt',content:'B'},task);}
  catch(error){approval=error.approval;}
  assert.ok(approval);
  store.decideApproval(approval.id,true,'approve-replacement');
  const replacement=await tools.execute('write_draft',approval.args,task,{approvalId:approval.id});
  assert.deepEqual(await tools.execute('request_approval',{tool:'write_draft',args:approval.args},task),replacement);
  await assert.rejects(tools.execute('write_draft',original,task),/completed draft.*(?:changed|missing)/i);
  assert.equal(fs.readFileSync(first.path,'utf8'),'B');
  fs.unlinkSync(first.path);
  await assert.rejects(tools.execute('request_approval',{tool:'write_draft',args:approval.args},task),/(?:completed draft.*(?:changed|missing)|path does not exist)/i);
  await assert.rejects(tools.execute('write_draft',original,task),/completed draft.*(?:changed|missing)/i);
  assert.equal(fs.existsSync(first.path),false);
});
