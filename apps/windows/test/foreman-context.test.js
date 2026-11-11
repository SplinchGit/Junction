'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Foreman}=require('../src/foreman');
const {ForemanApi}=require('../src/foreman-api');
const {workSnapshot,environmentContext}=require('../src/assistant-environment');

async function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'foreman-context-'));
  const executor={inspect:async()=>({})};
  let store=new Foreman(dir,{executor});
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const project=await store.create({name:'Funding project',objective:'Confirm the funding scope',repoPath:'demo',conversationId:'original',tasks:[{title:'Research options',acceptance:'Record the sources'}]});
  const conversationExists=id=>id==='new-chat';
  return {project,get store(){return store;},api:()=>new ForemanApi(store,{conversationExists}),reopen(){store.close();store=new Foreman(dir,{executor});}};
}

test('project context survives restart without relying on a task or the original conversation',async t=>{
  const f=await fixture(t),api=f.api();
  const change=(project,entry,requestId)=>api.dispatch('project.context',{id:project.id,revision:project.revision,...entry},requestId);
  const linked=(await change(f.project,{kind:'conversation',action:'link',key:'new-chat'},'link')).project;
  const decided=(await change(linked,{kind:'decision',action:'save',text:'Focus the research on Scottish grants.'},'decision')).project;
  const saved=(await change(decided,{kind:'question',action:'save',text:'What is the deadline?'},'question')).project;
  assert.equal(saved.status,'DRAFT');
  assert.deepEqual(saved.context.conversationIds,['new-chat']);
  assert.equal(saved.context.decisions[0].source,'owner');
  assert.equal(saved.context.questions[0].status,'OPEN');
  f.reopen();
  const repeated=await f.api().dispatch('project.context',{id:saved.id,revision:decided.revision,kind:'question',action:'save',text:'What is the deadline?'},'question');
  assert.equal(repeated.project.context.questions.length,1);
  const snapshot=workSnapshot(f.store.list(),'new-chat');
  assert.equal(snapshot[0].id,saved.id);
  assert.match(environmentContext({work:snapshot,situation:true}),/Scottish grants/);
  assert.match(environmentContext({work:snapshot,situation:true}),/What is the deadline/);
  assert.deepEqual(workSnapshot(f.store.list(),'original')[0].id,saved.id);
  assert.equal(workSnapshot(f.store.list(),'unrelated').length,0);
});

test('project context edits are desktop-only and stale revisions cannot overwrite decisions',async t=>{
  const f=await fixture(t),api=f.api(),id=f.project.id,revision=f.project.revision;
  const base={id,revision,kind:'decision',action:'save',text:'Use the official figures.'};
  await assert.rejects(api.dispatch('project.context',base,'remote','android'),/Windows/);
  await assert.rejects(api.dispatch('project.context',{id,revision,kind:'conversation',action:'link',key:'missing'},'missing'),/Conversation not found/);
  const saved=(await api.dispatch('project.context',base,'first')).project;
  await assert.rejects(api.dispatch('project.context',{...base,text:'Replace with old estimates'},'stale'),/Stale/);
  await assert.rejects(api.dispatch('project.context',{...base,text:'Different'},'first'),/Request ID reused/);
  const key=saved.context.decisions[0].id;
  const edited=(await api.dispatch('project.context',{...base,revision:saved.revision,key,text:'Use the corrected figures.'},'edit')).project;
  assert.equal(edited.context.decisions[0].id,key);
  assert.equal(edited.context.decisions[0].text,'Use the corrected figures.');
  const deleted=(await api.dispatch('project.context',{id,revision:edited.revision,key,kind:'decision',action:'remove'},'remove')).project;
  assert.deepEqual(deleted.context.decisions,[]);
  assert.equal(deleted.status,'DRAFT');
});

test('resolved questions remain available in project history and leave the open work snapshot',async t=>{
  const f=await fixture(t),api=f.api(),id=f.project.id;
  const created=(await api.dispatch('project.context',{id,revision:f.project.revision,kind:'question',action:'save',text:'Confirm deadline'},'save')).project;
  const key=created.context.questions[0].id;
  const resolved=(await api.dispatch('project.context',{id,revision:created.revision,kind:'question',action:'save',key,text:'Confirm deadline',status:'RESOLVED'},'resolve')).project;
  assert.equal(resolved.context.questions[0].status,'RESOLVED');
  assert.deepEqual(workSnapshot(f.store.list(),'original')[0].questions,[]);
  const remote=(await api.dispatch('project.get',{id},'get-remote','android')).project;
  assert.equal(remote.context,undefined);
});

test('owner-picked documents retain private source, searchable text and earlier revisions',async t=>{
  const f=await fixture(t),id=f.project.id;
  const file=path.join(f.store.directory,'funding.md');
  fs.writeFileSync(file,'The original deadline is June.');
  let picked=0;
  const makeApi=()=>new ForemanApi(f.store,{pickProjectDocument:async()=>{picked++;return file;}});
  let api=makeApi();
  await assert.rejects(api.dispatch('project.document.import',{id,path:file},'caller-path'),/fields/);
  await assert.rejects(api.dispatch('project.document.import',{id},'mobile','android'),/Windows/);
  assert.equal(picked,0);
  const first=(await api.dispatch('project.document.import',{id},'first-file')).document;
  assert.equal(first.revision,1);
  assert.equal(first.name,'funding.md');
  assert.match(first.sha256,/^[a-f0-9]{64}$/);
  fs.writeFileSync(file,'The corrected deadline is July.');
  const second=(await api.dispatch('project.document.import',{id},'corrected-file')).document;
  assert.equal(second.id,first.id);assert.equal(second.revision,2);assert.notEqual(second.sha256,first.sha256);
  assert.equal((await api.dispatch('project.documents',{id,query:'july'})).documents.length,1);
  assert.equal((await api.dispatch('project.documents',{id,query:'June'})).documents.length,0);
  f.reopen();api=makeApi();
  const replay=(await api.dispatch('project.document.import',{id},'first-file')).document;
  assert.deepEqual(replay,first);assert.equal(picked,2);
  const {document}=await api.dispatch('project.document.get',{id,documentId:first.id,revision:1});
  assert.equal(document.content,'The original deadline is June.');
  assert.equal(document.source,file);
  assert.doesNotMatch(JSON.stringify(workSnapshot(f.store.list(),'original')),/deadline|funding\.md/);
  assert.equal(f.store.get(id).status,'DRAFT');
  await assert.rejects(api.dispatch('project.document.remove',{id,documentId:first.id,revision:1,confirm:true},'stale-removal'),/Stale/);
  const removal={id,documentId:first.id,revision:2,confirm:true};
  assert.deepEqual(await api.dispatch('project.document.remove',removal,'remove-document'),{removed:true});
  assert.deepEqual(await api.dispatch('project.document.remove',removal,'remove-document'),{removed:true});
  assert.deepEqual(await api.dispatch('project.documents',{id}),{documents:[]});
  await assert.rejects(api.dispatch('project.document.get',{id,documentId:first.id,revision:1}),/not found/);
});

test('a cancelled or unsupported pick never creates a project document',async t=>{
  const f=await fixture(t),id=f.project.id;
  const file=path.join(f.store.directory,'binary.exe');
  fs.writeFileSync(file,Buffer.from([0,1,2]));
  const picks=[null,file];
  const api=new ForemanApi(f.store,{pickProjectDocument:async()=>picks.shift()});
  assert.deepEqual(await api.dispatch('project.document.import',{id},'cancelled'),{cancelled:true});
  await assert.rejects(api.dispatch('project.document.import',{id},'binary'),/Unsupported document/);
  assert.deepEqual(await api.dispatch('project.documents',{id}),{documents:[]});
});

test('DOCX import reads only bounded Word XML as plain text and rejects unsafe archives',async t=>{
  const f=await fixture(t),id=f.project.id,file=path.join(f.store.directory,'funding.docx');
  // Minimal ZIP archives with one word/document.xml member, generated using Python zipfile.
  const word=Buffer.from('UEsDBBQAAAAIALtma12O/zDzuwAAABUBAAARAAAAd29yZC9kb2N1bWVudC54bWxtj8FuwzAIQH/F8qG3xWkPU5Um6a0/0O0DXJslSDZY2F3Wv589qdphuzyEgAeM568Y1CdIRqZJ77teKyDHHmmZ9Pvb5eWoz/O4DZ7dPQIVVfspD9uk11LSYEx2K0SbO05AtfbBEm2pqSxmY/FJ2EHOVReDOfT9q4kWSTfljf2jxdQgDWW+Oi4F86oWsXUZBFzwhgHLQ+1sTCflwfqABLkbTRtolB+mPy5wTF4lK7ba0vrfhHmeYX5fnL8BUEsBAhQAFAAAAAgAu2ZrXY7/MPO7AAAAFQEAABEAAAAAAAAAAAAAAIABAAAAAHdvcmQvZG9jdW1lbnQueG1sUEsFBgAAAAABAAEAPwAAAOoAAAAAAA==','base64');
  const withDoctype=Buffer.from('UEsDBBQAAAAIALtma12HWUKtyQAAACgBAAARAAAAd29yZC9kb2N1bWVudC54bWxtjz9PxDAMxb9KyMBGUxgQKm1v4M8KEsfAmEtMaymxIydQ7tuTIJ0YYHm2Zb3fs8fdVwzqEyQj06Qvu14rIMceaZn06/7x4kbv5vHs/ulu//b8oDy7jwhU5nEbTr2qCMrDNum1lDQYk90K0eaOE1DdvbNEW+ooi9lYfBJ2kHNNiMFc9f21iRZJN+SB/bHV1ESalPnFcSmYV7WIrWEQcMEDBixHdW5julUerA9IkLvRNENT+dH0hwWOyatkxVZaWv9zmNMZ5vfF+RtQSwECFAAUAAAACAC7Zmtdh1lCrckAAAAoAQAAEQAAAAAAAAAAAAAAgAEAAAAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAEAAQA/AAAA+AAAAAAA','base64');
  const api=new ForemanApi(f.store,{pickProjectDocument:async()=>file});
  fs.writeFileSync(file,word);
  const imported=(await api.dispatch('project.document.import',{id},'word')).document;
  const {document}=await api.dispatch('project.document.get',{id,documentId:imported.id});
  assert.equal(document.content,'Scottish grant eligibility & deadlines.\nSecond paragraph.');
  fs.writeFileSync(file,withDoctype);
  await assert.rejects(api.dispatch('project.document.import',{id},'unsafe-xml'),/document types/i);
  const oversized=Buffer.from(word),central=oversized.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
  oversized.writeUInt32LE(2*1024*1024,central+24);
  fs.writeFileSync(file,oversized);
  await assert.rejects(api.dispatch('project.document.import',{id},'oversized'),/XML exceeds/);
  assert.deepEqual((await api.dispatch('project.documents',{id})).documents,[imported]);
});

const {textPdf}=require('./pdf-fixture.cjs');

test('PDF import extracts local text, tracks revisions, and leaves malformed files out of the project',async t=>{
  const f=await fixture(t),id=f.project.id,file=path.join(f.store.directory,'funding.pdf');
  const api=new ForemanApi(f.store,{pickProjectDocument:async()=>file});
  fs.writeFileSync(file,textPdf('Original funding criteria'));
  const {document:first}=await api.dispatch('project.document.import',{id},'pdf-first');
  assert.equal(f.store.getDocument(id,first.id,1).content,'Original funding criteria');
  fs.writeFileSync(file,textPdf('Updated funding criteria'));
  const {document:second}=await api.dispatch('project.document.import',{id},'pdf-second');
  assert.equal(second.id,first.id);assert.equal(second.revision,2);
  fs.writeFileSync(file,'%PDF-1.4 invalid');
  await assert.rejects(api.dispatch('project.document.import',{id},'pdf-broken'),/PDF/);
  assert.equal(f.store.listDocuments(id)[0].revision,2);
});
