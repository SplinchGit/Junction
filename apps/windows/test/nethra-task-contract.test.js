'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {NethraStore}=require('../src/nethra-store');
const {NethraRunner}=require('../src/nethra-runner');
const {NethraTools}=require('../src/nethra-tools');

function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-contract-'));
  const store=new NethraStore(directory);
  t.after(()=>{store.close();fs.rmSync(directory,{recursive:true,force:true});});
  return {store,create:input=>store.create({goal:'Prepare workshop notes',model:'junction-qwen3-next:80b-q3km',continuous:true,conversationId:'owner-chat',...input})};
}
function runtimeFor(actions,observe=()=>{}){
  let index=0;
  return {withInference:fn=>fn(),chat:async(model,messages)=>{
    observe(index,model,messages);
    assert.ok(index<actions.length,'The runner requested an unexpected extra model turn');
    return {message:{role:'assistant',content:'',tool_calls:[{function:actions[index++]}]}};
  }};
}

test('a routine owner question is saved while the same 80B pass writes a real result',async t=>{
  const {store,create}=fixture(t),task=create({});
  let nextContract;
  const runtime=runtimeFor([
    {name:'request_input',arguments:{question:'Would you like another progress update?',reason:'PROGRESS',blocking:false}},
    {name:'write_draft',arguments:{path:'notes.md',content:'Workshop result: the saved marker is amber-47.'}},
    {name:'schedule_wake',arguments:{at:Date.now()+60_000,reason:'Continue the workshop notes on the next pass'}}
  ],(index,model,messages)=>{assert.equal(model,task.model);if(index===1)nextContract=JSON.parse(messages[1].content).taskContract;});
  const result=await new NethraRunner({store,runtime}).execute(task);
  assert.equal(result.status,'SLEEPING');
  assert.equal(fs.readFileSync(path.join(task.workspace,'notes.md'),'utf8'),'Workshop result: the saved marker is amber-47.');
  assert.equal(store.get(task.id).questions?.length,1);
  assert.equal(store.get(task.id).questions[0].blocking,false);
  assert.equal(nextContract.questions[0].reason,'PROGRESS');
  assert.equal(nextContract.model.id,task.model);
  const {progressView}=require('../src/nethra-progress');
  assert.equal(progressView(store.get(task.id),store).lastAccomplished.model,task.model);
});

test('an essential question blocks only its step while independent work is saved',async t=>{
  const {store,create}=fixture(t),task=create({});
  store.update(task.id,{plan:['Choose the audience','Save source facts'],pendingSteps:['Choose the audience','Save source facts']});
  let contract;
  const runtime=runtimeFor([
    {name:'request_input',arguments:{question:'Which audience should the workshop use?',reason:'OWNER_PREFERENCE',blocking:true,step:'Choose the audience'}},
    {name:'write_draft',arguments:{path:'facts.md',content:'Source facts are saved independently of the audience.'}},
    {name:'update_plan',arguments:{steps:['Choose the audience','Save source facts'],completedSteps:['Save source facts']}},
    {name:'schedule_wake',arguments:{at:Date.now()+60_000,reason:'Continue the remaining steps'}}
  ],(index,_model,messages)=>{if(index===1)contract=JSON.parse(messages[1].content).taskContract;});
  const result=await new NethraRunner({store,runtime}).execute(store.get(task.id));
  assert.equal(result.status,'WAITING_FOR_USER');
  assert.equal(fs.readFileSync(path.join(task.workspace,'facts.md'),'utf8'),'Source facts are saved independently of the audience.');
  assert.deepEqual(contract.work.executableSteps,['Save source facts']);
  assert.equal(contract.work.blockedSteps[0].step,'Choose the audience');
  assert.deepEqual(result.pendingSteps,['Choose the audience']);
});

test('a task-wide missing authorization waits without executing the next action',async t=>{
  const {store,create}=fixture(t),task=create({});
  const runtime=runtimeFor([{name:'request_input',arguments:{question:'May I access the owner-selected private source?',reason:'AUTHORIZATION',blocking:true}}]);
  const result=await new NethraRunner({store,runtime}).execute(task);
  assert.equal(result.status,'WAITING_FOR_USER');
  assert.equal(store.get(task.id).questions?.[0].reason,'AUTHORIZATION');
  assert.equal(store.actions(task.id).length,0);
});

test('an owner chat answer resolves the latest step question once and preserves its source conversation',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-question-answer-')),store=new NethraStore(directory);
  try{
    const task=store.create({goal:'Prepare workshop notes',conversationId:'task-chat'});
    store.update(task.id,{plan:['Choose the audience','Save facts'],pendingSteps:['Choose the audience','Save facts'],questions:[{id:'question-1',question:'Which audience?',reason:'OWNER_PREFERENCE',blocking:true,step:'Choose the audience',status:'OPEN'}]});
    const first=store.chatTurn(task.id,'Use first-year students','answer-once',{conversationId:'ordinary-chat'});
    const retry=store.chatTurn(task.id,'Use first-year students','answer-once',{conversationId:'ordinary-chat'});
    assert.deepEqual(first,retry);
    const saved=store.get(task.id);
    assert.equal(saved.questions?.[0].status,'ANSWERED');
    assert.equal(saved.questions[0].answer,'Use first-year students');
    assert.equal(saved.ownerInputs.length,1);
    assert.equal(saved.ownerInputs[0].conversationId,'ordinary-chat');
    assert.equal(saved.status,'ACTIVE');
  }finally{store.close();fs.rmSync(directory,{recursive:true,force:true});}
});

test('host diagnostics describe the task model rather than a fixed 30B identity',async t=>{
  const {store,create}=fixture(t),task=create({});
  const tools=new NethraTools({store,codexStatus:async()=>({ready:false}),claudeStatus:async()=>({ready:false})});
  const result=await tools.execute('host_diagnostics',{},task);
  assert.equal(result.model.model,'junction-qwen3-next:80b-q3km');
  assert.equal(result.model.thinking,false);
  assert.equal(result.model.objectiveThinkingBudgetTokens,0);
});

test('advisor context uses the same task model facts as the worker',async t=>{
  const {store,create}=fixture(t),task=create({allowCodeWork:true});let prompt;
  const tools=new NethraTools({store,codexStatus:async()=>({ready:true}),advisorLimits:{check:async()=>({available:true}),invalidate:()=>{}},codexConsult:async request=>{prompt=request.messages[0].content;return {content:'Read-only advice'};}});
  await tools.execute('consult_codex',{question:'Review the current task context.'},task);
  assert.match(prompt,/junction-qwen3-next:80b-q3km/);
  assert.ok(!prompt.includes('runs qwen3:30b'));
});

test('task detail and its answer endpoint expose and resolve a step question without stopping other work',async t=>{
  const {NethraApi}=require('../src/nethra-api');
  const {store,create}=fixture(t),task=create({});
  store.update(task.id,{status:'ACTIVE',questions:[{id:'open-1',status:'OPEN',question:'Which audience?',reason:'OWNER_PREFERENCE',blocking:true,step:'Choose audience'}],plan:['Choose audience','Save facts'],pendingSteps:['Choose audience','Save facts']});
  const runner=new NethraRunner({store,runtime:{withInference:fn=>fn()}});
  const api=new NethraApi({store,runtime:{},describeTask:value=>runner.contract(value)});
  const detail=await api.dispatch('nethra.get',{id:task.id},'detail','android');
  assert.ok(detail.contract,'Task detail must expose the worker contract');
  assert.equal(detail.contract.model.id,task.model);
  assert.deepEqual(detail.contract.work.executableSteps,['Save facts']);
  assert.equal(detail.progress.questions[0].id,'open-1');
  await api.dispatch('nethra.answer',{id:task.id,revision:store.get(task.id).revision,answer:'First-year students'},'api-answer','android');
  assert.equal(store.get(task.id).status,'ACTIVE');
  assert.equal(store.get(task.id).questions[0].status,'ANSWERED');
});

test('a blocked step cannot be marked completed while its essential question is unanswered',async t=>{
  const {store,create}=fixture(t),task=create({});
  store.update(task.id,{plan:['Choose audience','Save facts'],pendingSteps:['Choose audience','Save facts'],questions:[{id:'open-1',status:'OPEN',question:'Which audience?',reason:'OWNER_PREFERENCE',blocking:true,step:'Choose audience'}]});
  let failure;
  const runtime=runtimeFor([
    {name:'update_plan',arguments:{steps:['Choose audience','Save facts'],completedSteps:['Choose audience']}},
    {name:'schedule_wake',arguments:{at:Date.now()+60_000,reason:'Continue saving facts while the audience is undecided'}}
  ],(index,_model,messages)=>{if(index===1)failure=JSON.parse(messages.at(-1).content);});
  await new NethraRunner({store,runtime}).execute(store.get(task.id));
  assert.match(failure.error,/unanswered.*question/i);
  assert.ok(!store.get(task.id).completedSteps.includes('Choose audience'));
});

test('three responses without an executable tool yield a retry instead of inventing an owner decision',async t=>{
  const {store,create}=fixture(t),task=create({});let calls=0;
  const runtime={withInference:fn=>fn(),chat:async()=>{calls++;return {message:{role:'assistant',content:'I will keep working on the notes.'}};}};
  const result=await new NethraRunner({store,runtime}).execute(task);
  assert.equal(calls,3);assert.equal(result.status,'SLEEPING');
  assert.equal((store.get(task.id).questions||[]).length,0);
  assert.ok(result.nextWakeAt>Date.now());
});

test('a REVISE verdict cannot be turned into an approved-and-complete milestone',async t=>{
  const {store,create}=fixture(t),task=create({goal:'Improve context serialization',mode:'ONGOING',allowCodeWork:true});
  const report=await new NethraTools({store}).execute('write_draft',{path:'proposal.md',content:'Context serialization proposal remains under technical review.'},task);
  store.update(task.id,{plan:['Revise the proposal','Submit for review'],pendingSteps:['Revise the proposal','Submit for review'],evidence:[{tool:'write_draft',result:report}],contextCheckpoint:{lastReview:{verdict:'REVISE',feedback:'Define the cache mutation boundary.',at:1}}});
  let failure;
  const runtime=runtimeFor([
    {name:'finish_objective',arguments:{summary:'Codex confirmed that the context serialization proposal is approved and complete.'}},
    {name:'schedule_wake',arguments:{at:Date.now()+60_000,reason:'Continue revising the code proposal from its saved feedback'}}
  ],(index,_model,messages)=>{if(index===1)failure=JSON.parse(messages.at(-1).content);});
  const result=await new NethraRunner({store,runtime}).execute(store.get(task.id));
  assert.deepEqual(result.completedSteps,[]);assert.ok(failure);assert.match(failure.error,/REVISE/);
  assert.ok(!store.events(task.id).some(item=>item.kind==='MILESTONE_VERIFIED'));
});

test('redirecting a task supersedes old questions while preserving its results',t=>{
  const {store,create}=fixture(t),task=create({});
  store.update(task.id,{questions:[{id:'old-question',status:'OPEN',question:'Which old audience?',blocking:true,reason:'OWNER_PREFERENCE'}],evidence:[{tool:'read_file',result:{content:'Original source fact'}}]});
  const current=store.get(task.id);
  const updated=store.redirect(task.id,'Use a different workshop source and plan.',current.revision,'new-owner-direction');
  assert.equal(updated.questions[0].status,'SUPERSEDED');
  assert.equal(updated.evidence[0].result.content,'Original source fact');
});

test('optional owner questions reach their source chat once and respect quiet update settings',t=>{
  const {store,create}=fixture(t),task=create({});
  const {LocalDataStore}=require('../src/local-data');
  const {postQuestions}=require('../src/nethra-conversation-report');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-question-outbox-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const localData=new LocalDataStore(directory);localData.ensureConversation('owner-chat');localData.ensureConversation('ordinary-chat');
  store.update(task.id,{status:'ACTIVE',questions:[{id:'owner-question-1',question:'Would you like a shorter update?',reason:'OWNER_PREFERENCE',blocking:false,status:'OPEN',conversationId:'ordinary-chat'}]});
  const current=store.get(task.id);
  assert.equal(postQuestions(current,store,localData,{settings:{proactiveUpdates:'OFF'}}),0);
  assert.equal(postQuestions(current,store,localData,{settings:{proactiveUpdates:'ALL'}}),1);
  assert.equal(postQuestions(current,store,localData,{settings:{proactiveUpdates:'ALL'}}),0);
  assert.equal(localData.conversation('ordinary-chat').messages.length,1);
  assert.equal(localData.conversation('owner-chat').messages.length,0);
});

test('an owner answer on the last model turn survives runner settling and scheduler persistence',async t=>{
  const {NethraScheduler}=require('../src/nethra-scheduler');
  const {store,create}=fixture(t),task=create({});
  store.update(task.id,{questions:[{id:'latest-question',question:'Should the notes be short?',reason:'OWNER_PREFERENCE',blocking:false,status:'OPEN',conversationId:'owner-chat'}]});
  let turns=0,returnedQuestions;
  const runtime={withInference:fn=>fn(),chat:async()=>{
    turns++;
    if(turns===24)store.chatTurn(task.id,'Use short notes','answer-on-last-turn',{conversationId:'owner-chat'});
    return {message:{role:'assistant',content:'Continuing the notes.',...((turns-1)%3===0?{tool_calls:[{function:{name:'update_plan',arguments:{steps:['Prepare the workshop notes']}}}]}:{})}};
  }};
  const runner=new NethraRunner({store,runtime});
  await new NethraScheduler({store,execute:async(claimed,options)=>{const result=await runner.execute(claimed,options);returnedQuestions=result.questions;return result;}}).tick();
  assert.equal(turns,24);
  assert.equal(store.get(task.id).questions[0].status,'ANSWERED');
  assert.equal(store.get(task.id).questions[0].answer,'Use short notes');
  assert.equal(returnedQuestions[0].status,'ANSWERED');
  assert.equal(store.get(task.id).ownerInputs.length,1);
});

test('chat and task-page replies answer the latest prompt without unblocking an older question',t=>{
  const {store,create}=fixture(t);
  for(const method of ['chat','answer']){
    const task=create({goal:`Workshop notes ${method}`});
    store.update(task.id,{status:'ACTIVE',questions:[
      {id:'access',question:'Which source may I access?',reason:'ACCESS',blocking:true,step:'Read source',status:'OPEN',conversationId:'owner-chat'},
      {id:'style',question:'Do you prefer short notes?',reason:'OWNER_PREFERENCE',blocking:false,status:'OPEN',conversationId:'owner-chat'}
    ]});
    if(method==='chat')store.chatTurn(task.id,'Yes, short notes please','reply-to-style-chat',{conversationId:'owner-chat'});
    else store.answer(task.id,'Yes, short notes please',store.get(task.id).revision,'reply-to-style-page');
    assert.equal(store.get(task.id).questions[0].status,'OPEN');
    assert.equal(store.get(task.id).questions[1].status,'ANSWERED');
  }
});

test('a task-page answer can target an earlier question explicitly',t=>{
  const {NethraApi}=require('../src/nethra-api');
  const {store,create}=fixture(t),task=create({});
  store.update(task.id,{status:'ACTIVE',questions:[{id:'audience',question:'Which audience?',reason:'OWNER_PREFERENCE',blocking:false,status:'OPEN'},{id:'style',question:'Short notes?',reason:'OWNER_PREFERENCE',blocking:true,status:'OPEN'}]});
  return new NethraApi({store,runtime:{}}).dispatch('nethra.answer',{id:task.id,revision:store.get(task.id).revision,questionId:'audience',answer:'First-year students'},'explicit-question-answer').then(()=>{
    assert.equal(store.get(task.id).questions[0].answer,'First-year students');
    assert.equal(store.get(task.id).questions[1].status,'OPEN');
  });
});
