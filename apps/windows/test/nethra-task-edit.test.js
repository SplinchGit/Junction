'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {NethraStore}=require('../src/nethra-store');
const {NethraApi}=require('../src/nethra-api');
const {handleNethraChat}=require('../src/nethra-chat');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-edit-')),store=new NethraStore(dir);t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});return {store,api:new NethraApi({store,runtime:{}})};}
test('metadata corrections preserve ended state and evidence; explicit continuation reopens the same task',async t=>{
 const {store,api}=fixture(t);const original=store.create({goal:'Funding plan'});
 const ended=store.save({...original,status:'COMPLETED',completedSteps:['Research'],evidence:[{tool:'web_search',result:{title:'Source'}}]},'FIXTURE');
 const saved=(await api.dispatch('nethra.edit',{id:ended.id,revision:ended.revision,goal:'Funding strategy',execution:'preserve'},'edit')).task;
 assert.equal(saved.status,'COMPLETED');assert.deepEqual(saved.evidence,ended.evidence);assert.deepEqual(saved.completedSteps,['Research']);
 const continued=(await api.dispatch('nethra.edit',{id:saved.id,revision:saved.revision,instruction:'Continue researching regional grants',execution:'continue'},'continue')).task;
 assert.equal(continued.status,'ACTIVE');assert.equal(continued.id,ended.id);assert.equal(continued.allowCodeWork,false);assert.deepEqual(continued.readRoots,[]);
 assert.match(continued.ownerInputs.at(-1).text,/regional grants/);
 assert.equal((await api.dispatch('nethra.edit',{id:saved.id,revision:saved.revision,instruction:'Continue researching regional grants',execution:'continue'},'continue')).task.id,ended.id);
});
test('edit instruction resolves clear restart intent but asks before ambiguous ended-task work',async t=>{
 const {store,api}=fixture(t);const task=store.create({goal:'Research'}),ended=store.save({...task,status:'FAILED'},'FIXTURE');
 const ambiguous=await api.dispatch('nethra.edit',{id:task.id,revision:ended.revision,instruction:'Change the approach to funding'},'ambiguous');
 assert.ok(ambiguous.clarification);assert.equal(store.get(task.id).status,'FAILED');
 const negative=await api.dispatch('nethra.edit',{id:task.id,revision:ended.revision,goal:'Research grants',instruction:'Do not restart; just correct the title'},'negative');
 assert.equal(negative.task.status,'FAILED');
 const live=negative.task;
 const resumed=await api.dispatch('nethra.edit',{id:task.id,revision:live.revision,instruction:'Redo the research with official sources'},'redo');
 assert.equal(resumed.task.status,'ACTIVE');
});
test('stale edits cannot supersede newer directions or exact-action approvals',async t=>{
 const {store,api}=fixture(t),task=store.create({goal:'Draft'});
 const first=(await api.dispatch('nethra.edit',{id:task.id,revision:task.revision,goal:'New wording',execution:'preserve'},'first')).task;
 await assert.rejects(api.dispatch('nethra.edit',{id:task.id,revision:task.revision,goal:'Old wording',execution:'continue'},'stale'),/revision/i);
 assert.equal(store.get(task.id).goal,first.goal);
 await assert.rejects(api.dispatch('nethra.edit',{id:task.id,revision:first.revision,execution:'unrestricted'},'invalid'),/execution/i);
});
test('continuing a finished task from its own conversation never redirects an unrelated open task',async t=>{
 const {store,api}=fixture(t),task=store.create({goal:'Funding research',conversationId:'funding'});
 store.save({...task,status:'COMPLETED'},'FIXTURE');
 const unrelated=store.create({goal:'Garden research',conversationId:'garden'});
 const reply=await handleNethraChat({api,content:'continue that task',conversationId:'funding',requestId:'resume-funding'});
 assert.match(reply,/Resumed/);assert.equal(store.get(task.id).status,'ACTIVE');
 assert.equal(store.get(unrelated.id).revision,unrelated.revision);
});
test('a retried edit retains its original execution intent after the task completes',async t=>{
 const {store,api}=fixture(t),task=store.create({goal:'Research'});
 const payload={id:task.id,revision:task.revision,goal:'Revised research'};
 const first=await api.dispatch('nethra.edit',payload,'edit-retry');
 store.save({...first.task,status:'COMPLETED'},'FIXTURE');
 assert.deepEqual(await api.dispatch('nethra.edit',payload,'edit-retry'),first);
 await assert.rejects(api.dispatch('nethra.edit',{...payload,goal:'Changed payload'},'edit-retry'),/mismatch/);
});
test('an explicit redo is not lost when it also mentions spelling',async t=>{
 const {store,api}=fixture(t),task=store.create({goal:'Funding report'});
 const ended=store.save({...task,status:'COMPLETED'},'FIXTURE');
 const result=await api.dispatch('nethra.edit',{id:task.id,revision:ended.revision,instruction:'Redo the report and fix the spelling'},'redo-spelling');
 assert.equal(result.task.status,'ACTIVE');assert.match(result.task.ownerInputs.at(-1).text,/fix the spelling/);
});
