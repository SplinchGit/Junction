'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {NethraStore}=require('../src/nethra-store');
const {NethraApi}=require('../src/nethra-api');
const {createObjectiveAccess}=require('../src/nethra-objectives');
const {LocalAgentToolRegistry}=require('../src/local-agent-tools');

function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-objective-access-')),store=new NethraStore(directory);
  t.after(()=>{store.close();fs.rmSync(directory,{recursive:true,force:true});});
  const api=new NethraApi({store,runtime:{}}),objectives=createObjectiveAccess({api,store});
  return {store,objectives,registry:new LocalAgentToolRegistry({objectives})};
}

test('shared voice/chat lookup retains the conversation task after completion',async t=>{
  const {store,registry}=fixture(t);
  let linked=store.create({goal:'Business plan funding',conversationId:'business-conversation'});
  linked=store.save({...linked,status:'COMPLETED'},'COMPLETED');
  const unrelated=store.create({goal:'Unrelated house research',conversationId:'house-conversation'});
  const run={goal:'What happened with the current task?',surface:'android-lan',conversationId:'business-conversation',runId:'spoken-turn',audit:{}};
  const response=JSON.parse((await registry.execute('get_objective',{reference:'current'},run)).content);
  assert.equal(response.objective.id,linked.id);assert.equal(response.objective.status,'COMPLETED');
  await assert.rejects(registry.execute('send_objective_message',{reference:'current',message:'Use these new numbers'},run),/finished/);
  assert.equal(store.get(unrelated.id).ownerInputs.length,0);
});

test('ambiguous completed conversation tasks require clarification instead of choosing unrelated work',async t=>{
  const {store,objectives}=fixture(t);
  for(const goal of ['Funding sources','Operating costs']){
    const task=store.create({goal,conversationId:'business-conversation'});
    store.save({...task,status:'COMPLETED'},'COMPLETED');
  }
  store.create({goal:'Unrelated active task'});
  await assert.rejects(objectives.get('current','business-conversation'),/Several tasks match/);
  assert.equal((await objectives.get('Funding sources','business-conversation')).goal,'Funding sources');
});

test('ordinary model chat sends real durable task messages once through the common API',async t=>{
  const {store,registry}=fixture(t),task=store.create({goal:'Workshop notes',conversationId:'task-chat'});
  const args={reference:'Workshop notes',message:'Use the title Aurora and keep working.'},run={goal:'Tell the workshop task to use Aurora',conversationId:'ordinary-chat',runId:'owner-message-1',audit:{}};
  const first=JSON.parse((await registry.execute('send_objective_message',args,run)).content);
  await registry.execute('send_objective_message',args,run);
  const saved=store.get(task.id);
  assert.equal(first.objectiveId,task.id);assert.equal(store.list().length,1);assert.equal(saved.ownerInputs.length,1);
  assert.equal(saved.ownerInputs[0].text,args.message);assert.equal(saved.ownerInputs[0].conversationId,'ordinary-chat');
  assert.ok(saved.ownerInputs[0].requestId.length<=160);
});

test('an explicit chat model selection updates a reused task while retaining its saved work',async t=>{
  const {store,objectives}=fixture(t),goal='Prepare the workshop notes';
  const first=await objectives.create({goal,conversationId:'chat',requestId:'create-default'});
  assert.equal(first.model,'qwen3:30b');assert.equal(first.continuous,true);
  store.update(first.id,{plan:['Read the source','Revise the notes'],completedSteps:['Read the source'],pendingSteps:['Revise the notes'],contextCheckpoint:{activeHypothesis:'Keep the source facts'}});
  await objectives.create({goal,conversationId:'chat',model:'junction-qwen3-next:80b-q3km',continuous:true,requestId:'select-80b'});
  await assert.doesNotReject(objectives.create({goal,conversationId:'chat',model:'junction-qwen3-next:80b-q3km',continuous:true,requestId:'select-80b'}));
  const saved=store.get(first.id);
  assert.equal(store.list().length,1);assert.equal(saved.model,'junction-qwen3-next:80b-q3km');
  assert.deepEqual(saved.completedSteps,['Read the source']);assert.equal(saved.contextCheckpoint.activeHypothesis,'Keep the source facts');
});

test('an ambiguous current task reference never sends a message to an arbitrary objective',async t=>{
  const {store,objectives}=fixture(t);
  store.create({goal:'Workshop notes',conversationId:'shared-chat'});store.create({goal:'Travel notes',conversationId:'shared-chat'});
  await assert.rejects(objectives.message({reference:'current',message:'Use Aurora',conversationId:'shared-chat',requestId:'ambiguous'}),/Several tasks/i);
  assert.ok(store.list().every(task=>task.ownerInputs.length===0));
});

test('invalid model or continuous arguments cannot create a task',async t=>{
  const {store,registry}=fixture(t);
  for(const extra of [{model:'invented:999b'},{continuous:'true'}])await assert.rejects(registry.execute('start_objective',{goal:'Prepare workshop notes',...extra},{goal:'Prepare workshop notes',runId:'invalid',audit:{}}),/Invalid tool argument/);
  assert.equal(store.list().length,0);
});

test('one owner chat turn can send instructions to two explicitly named tasks',async t=>{
  const {store,registry}=fixture(t);
  const first=store.create({goal:'Workshop notes'}),second=store.create({goal:'Travel notes'});
  const run={goal:'Use Aurora for workshop notes and Willow for travel notes',conversationId:'owner-chat',runId:'two-task-directions',audit:{}};
  await registry.execute('send_objective_message',{reference:'Workshop notes',message:'Use Aurora'},run);
  await assert.doesNotReject(registry.execute('send_objective_message',{reference:'Travel notes',message:'Use Willow'},run));
  assert.equal(store.get(first.id).ownerInputs[0].text,'Use Aurora');assert.equal(store.get(second.id).ownerInputs[0].text,'Use Willow');
});

test('an explicit model handoff fences the old execution while preserving task work',t=>{
  const {store}=fixture(t),task=store.create({goal:'Prepare workshop notes',continuous:true});
  store.update(task.id,{plan:['Read source','Save notes'],completedSteps:['Read source'],pendingSteps:['Save notes'],contextCheckpoint:{activeHypothesis:'Use verified facts'}});
  let clock=Date.now();store.now=()=>clock;
  const claim=store.claim('old-worker');assert.ok(claim);
  store.beginInference(task.id,claim.token);clock+=500;
  let selected;
  assert.doesNotThrow(()=>{selected=store.configure(task.id,{model:'junction-qwen3-next:80b-q3km'},store.get(task.id).revision,'switch-active-model');});
  assert.equal(selected.model,'junction-qwen3-next:80b-q3km');assert.deepEqual(selected.completedSteps,['Read source']);
  assert.equal(selected.budget.totalMs,500);
  assert.throws(()=>store.assertLease(task.id,claim.token),/lease/i);
  const next=store.claim('new-worker');assert.equal(next.task.id,task.id);assert.equal(next.task.model,selected.model);
});

test('long owner turn IDs stay bounded and distinct when scoped to task messages',async t=>{
  const {store,registry}=fixture(t),task=store.create({goal:'Workshop notes'});
  for(const tail of ['a','b'])await assert.doesNotReject(registry.execute('send_objective_message',{reference:'Workshop notes',message:`Use draft ${tail}`},{goal:'Update the workshop notes',conversationId:'owner-chat',runId:'r'.repeat(159)+tail,audit:{}}));
  assert.equal(store.get(task.id).ownerInputs.length,2);
  assert.ok(store.get(task.id).ownerInputs.every(item=>item.requestId.length<=160));
});

test('a retried current reference stays bound to its first task after that task finishes',async t=>{
  const {store,objectives}=fixture(t),first=store.create({goal:'First workshop notes'});
  store.update(first.id,{status:'ACTIVE'});
  const request={reference:'current',message:'Use short notes',conversationId:'ordinary-chat',requestId:'stable-relative-message'};
  await objectives.message(request);
  store.update(first.id,{status:'COMPLETED'});
  const second=store.create({goal:'Second workshop notes'});
  const replay=await objectives.message(request);
  assert.equal(replay.task.id,first.id);assert.equal(store.get(second.id).ownerInputs.length,0);
  await objectives.message({...request,requestId:'new-relative-message',message:'Use detailed notes'});
  assert.equal(store.get(second.id).ownerInputs[0].text,'Use detailed notes');
});

test('native task creation persists the host-selected project without accepting a payload override',async t=>{
  const {store,registry}=fixture(t);
  const projectId='5bb481ce-af8b-435f-b0c9-05adbbbc3e23';
  const run={goal:'Keep researching funding for the business plan',surface:'android-lan',conversationId:'funding-chat',runId:'project-voice',projectId,audit:{}};
  await registry.execute('start_objective',{goal:'Research business plan funding'},run);
  await registry.execute('start_objective',{goal:'Research business plan funding'},run);
  assert.equal(store.list().length,1);
  assert.equal(store.list()[0].projectId,projectId);
  const id=store.list()[0].id;
  const reopened=new NethraStore(store.directory);
  try { assert.equal(reopened.get(id).projectId,projectId); }
  finally { reopened.close(); }
  const api=new NethraApi({store,runtime:{}});
  const {task}=await api.dispatch('nethra.create',{goal:'Unlinked test objective',projectId},'external-create','android');
  assert.equal(task.projectId,undefined);
});

test('desktop project assignment preserves paused work and rejects stale or unknown links',async t=>{
  const {store}=fixture(t);
  const api=new NethraApi({store,runtime:{},listProjects:()=>[{id:'project-a',name:'Funding'}]});
  let task=store.create({goal:'Existing funding work'});
  task=store.control(task.id,'pause',task.revision,'pause-before-link');
  const payload={id:task.id,revision:task.revision,projectId:'project-a'};
  await assert.rejects(api.dispatch('nethra.project',payload,'remote-link','android'),/Windows/);
  await assert.rejects(api.dispatch('nethra.project',{...payload,projectId:'missing'},'unknown-project'),/Unknown project/);
  const linked=(await api.dispatch('nethra.project',payload,'link')).task;
  assert.equal(linked.projectId,'project-a');assert.equal(linked.status,'PAUSED');
  assert.equal((await api.dispatch('nethra.project',payload,'link')).task.revision,linked.revision);
  await assert.rejects(api.dispatch('nethra.project',{...payload,projectId:null},'stale-unlink'),/revision conflict/);
  const unlinked=(await api.dispatch('nethra.project',{...payload,revision:linked.revision,projectId:null},'unlink')).task;
  assert.equal(unlinked.projectId,undefined);assert.equal(unlinked.status,'PAUSED');
});
