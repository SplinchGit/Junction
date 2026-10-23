'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {LocalAgentToolRegistry}=require('../src/local-agent-tools');
const {LocalAgentRuntime}=require('../src/local-agent-runtime');
const {NethraStore}=require('../src/nethra-store');
const {NethraScheduler}=require('../src/nethra-scheduler');
const {BASELINE}=require('../src/assistant-context');

function objectivesFake(){
  const created=[];
  return {created,adapter:{create:async input=>{const existing=created.find(item=>item.requestId===input.requestId);if(existing)return existing.task;const task={id:`obj-${created.length+1}-xxxxxxxx`,status:'CREATED',goal:input.goal};created.push({...input,task});return task;},list:async()=>created.map(item=>({...item.task,summary:'Planning'}))}};
}

test('chat identity is Nethra, not a separate Junction assistant',()=>{
  assert.match(BASELINE,/^You are Nethra/);
  assert.doesNotMatch(BASELINE,/You are Junction/);
});

test('chat can start durable work once per owner message and read objective status',async()=>{
  const {created,adapter}=objectivesFake();
  const registry=new LocalAgentToolRegistry({researchCoordinator:{},objectives:adapter});
  assert.ok(registry.definitions().some(tool=>tool.function.name==='start_objective'));
  const run={goal:'Keep tracking Falkirk housing first',conversationId:'conv-1',runId:'run-7',surface:'android-relay',ledgers:[],audit:{}};
  const first=JSON.parse((await registry.execute('start_objective',{goal:'Track Falkirk Housing First news and summarise weekly'},run)).content);
  const retry=JSON.parse((await registry.execute('start_objective',{goal:'Track Falkirk Housing First news and summarise weekly'},run)).content);
  assert.equal(first.objectiveId,retry.objectiveId);assert.equal(created.length,1);
  assert.equal(created[0].conversationId,'conv-1');assert.equal(created[0].surface,'android-relay');
  assert.equal(created[0].mode,'ONGOING');
  const listed=JSON.parse((await registry.execute('list_objectives',{},run)).content);
  assert.equal(listed.objectives[0].status,'CREATED');
  await assert.rejects(registry.execute('start_objective',{goal:'short'},run),/Invalid tool argument/);
  await assert.rejects(registry.execute('start_objective',{goal:'A valid long goal here',extra:'x'},run),/Invalid tool argument fields/);
});

test('without an objective store the tools are not offered',()=>{
  const registry=new LocalAgentToolRegistry({researchCoordinator:{}});
  assert.equal(registry.definitions().some(tool=>tool.function.name==='start_objective'),false);
});

test('a chat turn where the model starts an objective executes the tool and answers',async()=>{
  const {created,adapter}=objectivesFake();let calls=0;
  const fetchImpl=async(url,options={})=>{
    if(String(url).endsWith('/api/ps'))return {ok:true,json:async()=>({models:[{name:'qwen3:30b',context_length:4096}]})};
    calls++;const body=JSON.parse(options.body);
    const message=calls===1?{role:'assistant',content:'',tool_calls:[{function:{name:'start_objective',arguments:{goal:'Research Scotland Housing First for Falkirk and keep me updated'}}}]}
      :{role:'assistant',content:'I have started that and will report back here.'};
    if(calls===2)assert.ok(body.messages.some(m=>m.role==='tool'&&m.tool_name==='start_objective'&&/objectiveId/.test(m.content)));
    return {ok:true,json:async()=>({message,eval_count:5,eval_duration:1e8,prompt_eval_count:10})};
  };
  const runtime=new LocalAgentRuntime({toolRegistry:new LocalAgentToolRegistry({researchCoordinator:{run:async()=>({sources:[]})},objectives:adapter}),fetchImpl});
  const result=await runtime.run({goal:'Please keep researching Scotland Housing First for Falkirk and update me',model:'qwen3:30b',history:[],surface:'android-relay',conversationId:'conv-9',runId:'run-9'});
  assert.equal(created.length,1);assert.equal(created[0].conversationId,'conv-9');
  assert.equal(created[0].mode,'ONGOING');
  assert.match(result.content,/report back/);
});

test('the scheduler reports settled outcomes so Nethra can answer in the original chat',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent-mode-'));const store=new NethraStore(dir);
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const task=store.create({goal:'Finish a small task',conversationId:'conv-3'});const settled=[];
  const scheduler=new NethraScheduler({store,execute:async()=>({status:'COMPLETED',summary:'All done with evidence.'}),onSettled:async item=>settled.push(item)});
  await scheduler.tick();
  assert.equal(settled.length,1);assert.equal(settled[0].id,task.id);assert.equal(settled[0].status,'COMPLETED');assert.equal(settled[0].conversationId,'conv-3');
});

function scriptedRuntime(adapter,answers){
  let calls=0;
  const fetchImpl=async(url)=>{
    if(String(url).endsWith('/api/ps'))return {ok:true,json:async()=>({models:[{name:'qwen3:30b',context_length:4096}]})};
    const content=answers[Math.min(calls++,answers.length-1)];
    return {ok:true,json:async()=>({message:{role:'assistant',content},eval_count:5,eval_duration:1e8,prompt_eval_count:10})};
  };
  return new LocalAgentRuntime({toolRegistry:new LocalAgentToolRegistry({researchCoordinator:{run:async()=>({sources:[]})},objectives:adapter}),fetchImpl});
}

test('"keep me updated" starts a real objective even when the model never calls the tool',async()=>{
  const {created,adapter}=objectivesFake();
  const runtime=scriptedRuntime(adapter,['Here is what I know so far, and I will keep working on it.']);
  const result=await runtime.run({goal:'Please look into Falkirk council housing plans and keep me updated',model:'qwen3:30b',history:[],surface:'android-relay',conversationId:'conv-k',runId:'run-k'});
  assert.equal(created.length,1);assert.equal(created[0].conversationId,'conv-k');
  assert.equal(created[0].mode,'ONGOING');
  assert.doesNotMatch(result.content,/Correction/);
});

test('a promise to monitor with no objective behind it is corrected',async()=>{
  const {created,adapter}=objectivesFake();
  const runtime=scriptedRuntime(adapter,['Falkirk has a 2023-2028 strategy. I will monitor this for updates.']);
  const result=await runtime.run({goal:'What is Falkirk doing about housing?',model:'qwen3:30b',history:[],surface:'android-relay',conversationId:'conv-m',runId:'run-m'});
  assert.equal(created.length,0);
  assert.match(result.content,/Correction: I have not set up ongoing tracking/);
});

test('re-sending the same request in a conversation continues the active objective',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent-dedupe-'));const store=new NethraStore(dir);
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const goal='Please research Housing First in Falkirk and keep me updated';
  const first=store.create({goal,conversationId:'conv-d',requestId:'chat-objective-run-1'});
  const resend=store.create({goal,conversationId:'conv-d',requestId:'chat-objective-run-2'});
  assert.equal(resend.id,first.id);assert.equal(store.list().length,1);
  assert.notEqual(store.create({goal,conversationId:'conv-other',requestId:'r3'}).id,first.id);
  store.control(first.id,'cancel',store.get(first.id).revision,'cancel-1');
  assert.notEqual(store.create({goal,conversationId:'conv-d',requestId:'r4'}).id,first.id,'a finished objective does not absorb a new request');
});

test('the task list says which objective is running now, its step and progress',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent-list-'));const store=new NethraStore(dir);
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const {NethraApi}=require('../src/nethra-api');const api=new NethraApi({store,runtime:{}});
  const running=store.create({goal:'Research Falkirk housing first'}),queued=store.create({goal:'Second task waiting'});
  const claim=store.claim('worker',60_000);
  store.update(claim.task.id,{plan:['Search','Summarise','Report'],completedSteps:['Search'],pendingSteps:['Summarise','Report']},'CHECKPOINT',claim.token);
  const {objectives}=await api.dispatch('nethra.list',{},'list','android');
  const live=objectives.find(o=>o.id===claim.task.id),other=objectives.find(o=>o.id!==claim.task.id);
  assert.equal(live.live,true);assert.equal(live.step,'Summarise');assert.deepEqual(live.progress,{done:1,total:3});
  assert.equal(other.live,false);assert.equal(other.step,null);
  store.release(claim.task.id,claim.token);
  assert.equal((await api.dispatch('nethra.list',{},'list2','android')).objectives.some(o=>o.live),false);
});

test('ongoing intent is stored explicitly and can be changed without losing progress',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent-mode-'));const store=new NethraStore(dir);
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const {NethraApi}=require('../src/nethra-api');const api=new NethraApi({store,runtime:{}});
  const ongoing=(await api.dispatch('nethra.create',{goal:'Track housing updates',mode:'ONGOING'},'create-mode','android')).task;
  assert.equal(ongoing.mode,'ONGOING');
  const changed=(await api.dispatch('nethra.configure',{id:ongoing.id,revision:ongoing.revision,mode:'FINITE'},'change-mode','android')).task;
  assert.equal(changed.mode,'FINITE');assert.equal(changed.goal,ongoing.goal);
  const legacy=(await api.dispatch('nethra.create',{goal:'Write one summary'},'create-finite','android')).task;
  assert.equal(legacy.mode,'FINITE');
  await assert.rejects(api.dispatch('nethra.create',{goal:'Bad mode',mode:'UNKNOWN'},'invalid-mode','android'),/mode/i);
});
test('a direct Nethra track command starts an ongoing objective',async t=>{
  const {handleNethraChat}=require('../src/nethra-chat');
  const {created,adapter}=objectivesFake();
  const api={dispatch:async(type,payload)=>({task:await adapter.create(payload)})};
  await handleNethraChat({api,content:'Nethra, track housing policy updates',conversationId:'conv-track',requestId:'track-1'});
  assert.equal(created[0].mode,'ONGOING');
});
test('negated monitoring language never starts an automatic background objective',()=>{
  const {isOngoingRequest}=require('../src/local-agent-tools');
  assert.equal(isOngoingRequest("Do not monitor this; just explain today's policy"),false);
  assert.equal(isOngoingRequest("Don't keep me updated; answer once"),false);
});
test('a verified monitoring milestone reaches chat once, even after restarting delivery',async t=>{
  const {LocalDataStore}=require('../src/local-data');
  const {postMilestones}=require('../src/nethra-conversation-report');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent-report-'));
  const local=new LocalDataStore(path.join(dir,'local'));
  const conversation=local.createConversation('monitor-chat');
  const store=new NethraStore(path.join(dir,'store'));
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const task=store.create({goal:'Track housing updates',mode:'ONGOING',conversationId:conversation.id});
  store.update(task.id,{status:'SLEEPING',summary:'Verified new housing report',nextWakeAt:Date.now()+86_400_000},'MILESTONE_VERIFIED');
  assert.equal(postMilestones(store.get(task.id),store,local),1);
  const reloaded=new LocalDataStore(path.join(dir,'local'));
  assert.equal(reloaded.milestoneCursor(task.id),store.milestoneEvents(task.id)[0].seq);
  assert.equal(postMilestones(store.get(task.id),store,reloaded),0);
  assert.equal(store.milestoneEvents(task.id,reloaded.milestoneCursor(task.id)).length,0);
  assert.equal(reloaded.conversation(conversation.id).messages.length,1);
  assert.match(reloaded.conversation(conversation.id).messages[0].content,/Verified new housing report/);
});
test('scheduler invokes the outcome hook for an ongoing objective that goes to sleep',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent-hook-'));const store=new NethraStore(dir);
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const task=store.create({goal:'Monitor local housing changes',mode:'ONGOING'}),settled=[];
  const scheduler=new NethraScheduler({store,execute:async()=>({status:'SLEEPING',nextWakeAt:Date.now()+86_400_000}),onSettled:item=>settled.push(item)});
  await scheduler.tick();
  assert.equal(settled.length,1);assert.equal(settled[0].id,task.id);
});
test('milestone delivery still finds new events after a long objective history',t=>{
  const {LocalDataStore}=require('../src/local-data');const {postMilestones}=require('../src/nethra-conversation-report');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent-long-history-'));
  const local=new LocalDataStore(path.join(dir,'local'));local.createConversation('long-chat');
  const store=new NethraStore(path.join(dir,'store'));
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const task=store.create({goal:'Monitor source changes',mode:'ONGOING',conversationId:'long-chat'});
  for(let i=0;i<510;i++)store.update(task.id,{summary:`Routine checkpoint ${i}`},'CHECKPOINT');
  store.update(task.id,{summary:'Verified a new source revision'},'MILESTONE_VERIFIED');
  assert.equal(postMilestones(store.get(task.id),store,local),1);
});
