'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {NethraStore}=require('../src/nethra-store');
const {NethraApi}=require('../src/nethra-api');
const {NethraScheduler}=require('../src/nethra-scheduler');
const {NethraTools}=require('../src/nethra-tools');
const {handleOwnerWorkInstruction}=require('../src/owner-work-instruction');

function fixture(t,{approval=true}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-conversation-'));
  const store=new NethraStore(dir);
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const task=store.create({goal:'Self Improvement',successCriteria:'Continuously measure Nethra response speed and improve performance with verified changes.',mode:'ONGOING',continuous:true,model:'qwen3:30b',conversationId:'task-chat'});
  store.update(task.id,{plan:['Measure response time','Review improvements']},'PLAN');
  if(approval)store.requestApproval(task.id,{tool:'write_draft',args:{path:'draft.md',content:'replacement'},category:'LOCAL_WRITE',key:'approval-key'});
  const api=new NethraApi({store,runtime:{}});
  const history=[{role:'user',content:'What about Self Improvement?'},{role:'assistant',content:'Self Improvement is waiting for an approval.'}];
  const ownerWork=async()=>{throw Error('Task follow-up escaped into the coding router');};
  const turn=(content,requestId)=>handleOwnerWorkInstruction({content,conversationId:'ordinary-chat',requestId,history,source:'android',api,store,ownerWork});
  return {store,task,history,turn};
}

test('asking Codex to work on code reaches the task instead of becoming a continue/status command',async t=>{
  const {store,task}=fixture(t,{approval:false}),api=new NethraApi({store,runtime:{}});
  const content='Ok so can you ask codex and work on code that would allow this for you?';
  const reply=await handleOwnerWorkInstruction({content,conversationId:'task-chat',requestId:'ask-codex-for-interface',source:'android',api,store,ownerWork:async()=>null});
  assert.equal(store.get(task.id).ownerInputs.at(-1)?.text,content);
  assert.match(reply,/saved/i);assert.equal(store.get(task.id).allowCodeWork,false,'A direction cannot silently enable code execution');
});

test('ordinary chat reads the existing objective and its exact gate instead of inventing a new goal',async t=>{
  const {store,task,turn}=fixture(t);
  for(const [index,content] of ['How about now','There should already be one you can see','Yes that one. Work on that one'].entries()){
    const reply=await turn(content,`turn-${index}`);
    assert.match(reply,/Self Improvement/);
    assert.match(reply,/response speed/i);
    assert.match(reply,/write_draft|draft/i);
    assert.match(reply,/approval/i);
  }
  assert.equal(store.list().length,1);
  assert.equal(store.get(task.id).status,'WAITING_FOR_USER');
  assert.equal(store.approvals(task.id)[0].status,'PENDING');
});

test('a direction in ordinary chat reaches the existing task once and preserves its approval gate',async t=>{
  const {store,task,turn}=fixture(t);
  const content="Basically it's to improve your performance and response times";
  const first=await turn(content,'direction-1');
  const second=await turn(content,'direction-1');
  assert.match(first,/saved/i);
  assert.equal(second,first);
  assert.equal(store.get(task.id).ownerInputs.filter(item=>item.text===content).length,1);
  assert.equal(store.get(task.id).status,'WAITING_FOR_USER');
});

test('unrelated chat does not alter the task',async t=>{
  const {store,task,history}=fixture(t);
  let ordinary=0;
  const reply=await handleOwnerWorkInstruction({content:'What time is it?',conversationId:'ordinary-chat',requestId:'time-1',history,api:new NethraApi({store,runtime:{}}),store,ownerWork:async()=>{ordinary++;return {response:'ordinary route'};}});
  assert.equal(reply,'ordinary route');
  assert.equal(ordinary,1);
  assert.equal(store.get(task.id).ownerInputs.length,0);
});

test('an explicit active task reference works in a fresh ordinary chat',async t=>{
  const {store,task}=fixture(t);
  const reply=await handleOwnerWorkInstruction({content:'Work on the active task',conversationId:'new-chat',requestId:'active-1',history:[],api:new NethraApi({store,runtime:{}}),store,ownerWork:async()=>{throw Error('Escaped task router');}});
  assert.match(reply,/Self Improvement/);
  assert.match(reply,/Pending approval/);
  assert.equal(store.get(task.id).status,'WAITING_FOR_USER');
});

test('brief task follow-ups read the current task instead of searching the web',async t=>{
  const {store,task,history}=fixture(t);
  for(const [index,content] of ['Now?','How is it doing?','Any progress?'].entries()){
    const reply=await handleOwnerWorkInstruction({content,conversationId:'ordinary-chat',requestId:`brief-${index}`,history,api:new NethraApi({store,runtime:{}}),store,ownerWork:async()=>{throw Error('Brief task follow-up escaped to model');}});
    assert.match(reply,/Self Improvement/);
    assert.match(reply,/Pending approval/);
  }
  assert.equal(store.get(task.id).status,'WAITING_FOR_USER');
});

test('continue at a pending overwrite offers an exact next step without pretending work resumed',async t=>{
  const {store,task,turn}=fixture(t);
  for(const [index,content] of ['So can we continue with that pls','continue that task'].entries()){
    const reply=await turn(content,`continue-pending-${index}`);
    assert.match(reply,/draft\.md/);
    assert.match(reply,/approve or reject/i);
    assert.match(reply,/skip that draft and continue/i);
  }
  assert.equal(store.get(task.id).status,'WAITING_FOR_USER');
  assert.equal(store.approvals(task.id)[0].status,'PENDING');
});

test('an explicit request to skip a pending overwrite replans without granting the write',async t=>{
  const {store,task,turn}=fixture(t);
  const first=await turn('Skip that draft and continue','skip-draft');
  const second=await turn('Skip that draft and continue','skip-draft');
  assert.equal(first,second);
  assert.match(first,/set aside/i);
  assert.equal(store.get(task.id).status,'ACTIVE');
  assert.equal(store.approvals(task.id)[0].status,'SUPERSEDED');
  assert.equal(store.get(task.id).plan.length,0);
  assert.deepEqual(store.get(task.id).skippedDraftPaths,['draft.md']);
});

test('a skipped draft path cannot request the same overwrite again',async t=>{
  const {store,task,turn}=fixture(t);
  const draft=path.join(task.workspace,'draft.md');fs.writeFileSync(draft,'original');
  await turn('Skip that draft and continue','skip-repeat');
  const {token}=store.claim('skip-repeat-test',60_000),tools=new NethraTools({store});
  for(const [name,args] of [['write_draft',{path:'draft.md',content:'replacement'}],['request_approval',{tool:'write_draft',args:{path:'draft.md',content:'replacement'}}]]){
    await assert.rejects(tools.execute(name,args,store.get(task.id),{token}),/set this draft overwrite aside/i);
  }
  assert.equal(fs.readFileSync(draft,'utf8'),'original');
  assert.equal(store.approvals(task.id).filter(item=>item.status==='PENDING').length,0);
});

test('after the pending overwrite is set aside the scheduler actually claims the task',async t=>{
  const {store,task,turn}=fixture(t);
  await turn('Skip that draft and continue','skip-and-run');
  let executed=0;
  await new NethraScheduler({store,execute:async(claimed,{checkpoint})=>{
    assert.equal(claimed.id,task.id);executed++;
    await checkpoint({plan:['Measure the current response time'],pendingSteps:['Measure the current response time']},'TEST_PLAN');
    return {status:'SLEEPING',nextWakeAt:Date.now()+60_000,summary:'Measurement planned for the next pass'};
  }}).tick();
  assert.equal(executed,1);
  assert.ok(store.get(task.id).lastExecutionAt);
  assert.ok(store.events(task.id).some(item=>item.kind==='CLAIMED'));
  assert.equal(store.approvals(task.id)[0].status,'SUPERSEDED');
});

test('continue resumes a technical review gate with the saved feedback in either chat route',async t=>{
  for(const [index,content] of ['So can we continue with that pls','continue that task'].entries()){
    const {store,task,turn}=fixture(t,{approval:false});
    const checkpoint={lastReview:{verdict:'REVISE',feedback:'Define the benchmark fixture before another proposal.'}};
    store.update(task.id,{status:'WAITING_FOR_USER',summary:'Two code proposals were rejected in this work pass. Latest review: define the fixture.',contextCheckpoint:checkpoint});
    const reply=await turn(content,`continue-review-${index}`);
    assert.match(reply,/queued|continuing/i);
    assert.equal(store.get(task.id).status,'ACTIVE');
    assert.deepEqual(store.get(task.id).contextCheckpoint,checkpoint);
    assert.match(store.get(task.id).ownerInputs.at(-1).text,/saved.*review|technical.*feedback/i);
  }
});

test('continue does not invent an answer to a missing owner decision',async t=>{
  const {store,task,turn}=fixture(t,{approval:false});
  store.update(task.id,{status:'WAITING_FOR_USER',summary:'Which college course should this essay cover?'});
  const reply=await turn('So can we continue with that pls','continue-question');
  assert.match(reply,/Which college course/);
  assert.equal(store.get(task.id).status,'WAITING_FOR_USER');
  assert.equal(store.get(task.id).ownerInputs.length,0);
});

test('negated continuation leaves the technical review gate and saved inputs untouched',async t=>{
  const {store,task,turn}=fixture(t,{approval:false});
  store.update(task.id,{status:'WAITING_FOR_USER',summary:'Two code proposals were rejected in this work pass. Latest review: define the fixture.'});
  for(const [index,content] of ['Do not continue that task',"Don't resume Self Improvement",'Never pick up that task'].entries()){
    await turn(content,`negated-review-${index}`);
    assert.equal(store.get(task.id).status,'WAITING_FOR_USER');
    assert.equal(store.get(task.id).ownerInputs.length,0);
  }
});

test('ordinary directions and substantive questions in task chat reach the running task',async t=>{
  const {store,task}=fixture(t,{approval:false});
  const api=new NethraApi({store,runtime:{}});
  for(const [index,content] of ['For this task, keep the draft short and use British English.','Why does this task need that source?'].entries()){
    await handleOwnerWorkInstruction({content,conversationId:'task-chat',requestId:`task-steering-${index}`,api,store,ownerWork:async()=>{throw Error('Task chat escaped to ordinary work');}});
    assert.equal(store.get(task.id).ownerInputs.at(-1)?.text,content);
  }
  assert.equal(store.get(task.id).ownerInputs.length,2);
});

test('a cross-chat direction is saved once with its reply destination while status stays read-only',async t=>{
  const {store,task,history}=fixture(t,{approval:false});
  const api=new NethraApi({store,runtime:{}}),content='For Self Improvement, use short evidence notes from now on.';
  const turn=(text,id)=>handleOwnerWorkInstruction({content:text,conversationId:'ordinary-chat',requestId:id,history,source:'android',api,store,ownerWork:async()=>{throw Error('Lost the task reference');}});
  await turn(content,'cross-chat-steering');await turn(content,'cross-chat-steering');
  assert.equal(store.get(task.id).ownerInputs.length,1);
  assert.equal(store.get(task.id).ownerInputs[0].text,content);
  assert.equal(store.get(task.id).ownerInputs[0].conversationId,'ordinary-chat');
  await turn('How is that task doing?','read-only-status');
  assert.equal(store.get(task.id).ownerInputs.length,1);
});

test('a resume request with extra direction applies both parts instead of dropping the instruction',async t=>{
  const {store,task}=fixture(t,{approval:false});
  store.control(task.id,'pause',store.get(task.id).revision,'pause-composite');
  const content='Resume and use short notes for the task.';
  await handleOwnerWorkInstruction({content,conversationId:'task-chat',requestId:'resume-and-steer',api:new NethraApi({store,runtime:{}}),store,ownerWork:async()=>{throw Error('A task instruction escaped');}});
  assert.equal(store.get(task.id).status,'ACTIVE');
  assert.equal(store.get(task.id).ownerInputs.at(-1)?.text,content);
});

test('an explicit chat request can start a continuous 80B task',async t=>{
  const {store}=fixture(t,{approval:false});
  await handleOwnerWorkInstruction({content:'Start a Nethra task: use 80B to prepare workshop notes',conversationId:'new-chat',requestId:'explicit-80b-task',api:new NethraApi({store,runtime:{}}),store,ownerWork:async()=>{throw Error('Explicit task creation escaped');}});
  const created=store.list().find(task=>task.conversationId==='new-chat');
  assert.equal(created.model,'junction-qwen3-next:80b-q3km');
  assert.equal(created.continuous,true);
});

test('a shared chat never guesses which of two tasks an unnamed direction belongs to',async t=>{
  const {store,task}=fixture(t,{approval:false});
  const second=store.create({goal:'Workshop notes',conversationId:'task-chat'});
  const reply=await handleOwnerWorkInstruction({content:'Use British English for the next draft.',conversationId:'task-chat',requestId:'ambiguous-direction',api:new NethraApi({store,runtime:{}}),store,ownerWork:async()=>{throw Error('Ambiguous task direction escaped');}});
  assert.match(reply,/which|several|more than one/i);
  assert.equal(store.get(task.id).ownerInputs.length,0);assert.equal(store.get(second.id).ownerInputs.length,0);
});

test('a named direction in a shared chat reaches exactly that task',async t=>{
  const {store,task}=fixture(t,{approval:false});
  const second=store.create({goal:'Workshop notes',conversationId:'task-chat'});
  const content='For Workshop notes, use British English for the next draft.';
  await handleOwnerWorkInstruction({content,conversationId:'task-chat',requestId:'named-direction',api:new NethraApi({store,runtime:{}}),store,ownerWork:async()=>{throw Error('Named task direction escaped');}});
  assert.equal(store.get(second.id).ownerInputs.at(-1)?.text,content);
  assert.equal(store.get(task.id).ownerInputs.length,0);
});

test('a reference-based resume preserves the extra instruction in task state',async t=>{
  const {store,task}=fixture(t,{approval:false});
  store.control(task.id,'pause',store.get(task.id).revision,'pause-reference');
  const content='Resume that task and use short notes.';
  await handleOwnerWorkInstruction({content,conversationId:'task-chat',requestId:'resume-reference-direction',api:new NethraApi({store,runtime:{}}),store,ownerWork:async()=>{throw Error('Task control escaped');}});
  assert.equal(store.get(task.id).status,'ACTIVE');
  assert.equal(store.get(task.id).ownerInputs.at(-1)?.text,content);
});

test('a substantive can-you-see question reaches the task rather than becoming a generic status query',async t=>{
  const {store,task}=fixture(t,{approval:false});
  const content='Can you see why this task needs access?';
  await handleOwnerWorkInstruction({content,conversationId:'task-chat',requestId:'source-access-question',api:new NethraApi({store,runtime:{}}),store,ownerWork:async()=>{throw Error('Task question escaped');}});
  assert.equal(store.get(task.id).ownerInputs.at(-1)?.text,content);
});

test('brief spoken follow-ups keep the completed task in this conversation',async t=>{
  const {store,task}=fixture(t,{approval:false});
  store.save({...store.get(task.id),status:'COMPLETED'},'COMPLETED');
  store.create({goal:'Unrelated active objective',conversationId:'other-chat'});
  const reply=await handleOwnerWorkInstruction({content:'Any progress?',conversationId:'task-chat',requestId:'spoken-status',source:'android',api:new NethraApi({store,runtime:{}}),store,ownerWork:async()=>{throw Error('Lost conversation focus');}});
  assert.match(reply,/Self Improvement/);assert.match(reply,/completed/);assert.doesNotMatch(reply,/Unrelated/);
});

test('spoken continuation reopens the existing objective once and survives repeated delivery after completion',async t=>{
  const {store,task}=fixture(t,{approval:false});
  store.save({...store.get(task.id),status:'COMPLETED',completedSteps:['Measure response time'],evidence:[{tool:'read_file',result:{content:'Recorded timing data'}}]},'COMPLETED');
  const api=new NethraApi({store,runtime:{}}),content='Continue researching that';
  const request={content,conversationId:'task-chat',requestId:'spoken-continue',source:'android',api,store,ownerWork:async()=>{throw Error('Created a parallel voice task');}};
  await handleOwnerWorkInstruction(request);
  assert.equal(store.get(task.id).status,'ACTIVE');assert.equal(store.list().length,1);
  assert.deepEqual(store.get(task.id).completedSteps,['Measure response time']);assert.equal(store.get(task.id).evidence.length,1);
  await handleOwnerWorkInstruction(request);assert.equal(store.get(task.id).ownerInputs.length,1);
  store.save({...store.get(task.id),status:'COMPLETED'},'COMPLETED_AGAIN');
  await handleOwnerWorkInstruction(request);
  assert.equal(store.get(task.id).status,'COMPLETED');assert.equal(store.get(task.id).ownerInputs.length,1);
});

test('voice/text references find an older linked task beyond the first transport page',async t=>{
  const {store,task}=fixture(t,{approval:false});
  store.save({...store.get(task.id),status:'COMPLETED'},'COMPLETED');
  for(let i=0;i<105;i++){const other=store.create({goal:`Unrelated task ${i}`});store.save({...other,status:'COMPLETED'},'COMPLETED');}
  const api=new NethraApi({store,runtime:{}});
  await handleOwnerWorkInstruction({content:'Continue researching that',conversationId:'task-chat',requestId:'old-spoken-task',source:'android',api,store,ownerWork:async()=>{throw Error('Lost paginated task');}});
  assert.equal(store.get(task.id).status,'ACTIVE');assert.equal(store.list().length,106);
});

test('an explicitly named continuation takes precedence over the task linked to the call conversation',async t=>{
  const {store,task}=fixture(t,{approval:false});
  store.control(task.id,'pause',store.get(task.id).revision,'pause-linked');
  let named=store.create({goal:'Workshop notes',conversationId:'different-chat'});
  named=store.save({...named,status:'COMPLETED'},'COMPLETED');
  await handleOwnerWorkInstruction({content:'Continue Workshop notes',conversationId:'task-chat',requestId:'named-spoken-continue',source:'android',api:new NethraApi({store,runtime:{}}),store,ownerWork:async()=>{throw Error('Lost explicitly named task');}});
  assert.equal(store.get(named.id).status,'ACTIVE');assert.equal(store.get(task.id).status,'PAUSED');
});

test('generic spoken continuation does not answer a pending owner decision',async t=>{
  const {store,task}=fixture(t,{approval:false});
  store.update(task.id,{status:'WAITING_FOR_USER',summary:'Which country should the research cover?'});
  const reply=await handleOwnerWorkInstruction({content:'Continue researching that',conversationId:'task-chat',requestId:'continue-needs-answer',source:'android',api:new NethraApi({store,runtime:{}}),store,ownerWork:async()=>{throw Error('Lost input gate');}});
  assert.match(reply,/Which country/);assert.equal(store.get(task.id).status,'WAITING_FOR_USER');assert.equal(store.get(task.id).ownerInputs.length,0);
});

test('a continuation first received while active cannot reopen work when retried after completion',async t=>{
  const {store,task}=fixture(t,{approval:false});
  store.update(task.id,{status:'ACTIVE'});
  const request={content:'Continue researching that',conversationId:'task-chat',requestId:'active-spoken-retry',source:'android',api:new NethraApi({store,runtime:{}}),store,ownerWork:async()=>{throw Error('Lost active continuation');}};
  await handleOwnerWorkInstruction(request);
  store.save({...store.get(task.id),status:'COMPLETED'},'COMPLETED');
  const count=store.get(task.id).ownerInputs.length;
  await handleOwnerWorkInstruction(request);
  assert.equal(store.get(task.id).status,'COMPLETED');assert.equal(store.get(task.id).ownerInputs.length,count);
});

test('a decision arriving during continuation routing cannot be answered by the control message',async t=>{
  const {store,task}=fixture(t,{approval:false});
  store.update(task.id,{status:'ACTIVE'});
  const api=new NethraApi({store,runtime:{}}),dispatch=api.dispatch.bind(api);
  api.dispatch=async(type,...args)=>{
    if(type==='nethra.message')store.update(task.id,{status:'WAITING_FOR_USER',summary:'Which country should the research cover?'});
    return dispatch(type,...args);
  };
  await assert.rejects(handleOwnerWorkInstruction({content:'Continue researching that',conversationId:'task-chat',requestId:'continue-decision-race',source:'android',api,store,ownerWork:async()=>{throw Error('Lost input gate');}}),/revision conflict/);
  assert.equal(store.get(task.id).ownerInputs.length,0);
  await dispatch('nethra.message',{id:task.id,text:'Resume and use short notes.',conversationId:'task-chat',noteOnly:true},'control-note','android');
  assert.equal(store.get(task.id).status,'WAITING_FOR_USER');
  assert.equal(store.get(task.id).ownerInputs.at(-1)?.kind,'note');
});

test('retrying an active continuation preserves a later owner pause',async t=>{
  const {store,task}=fixture(t,{approval:false});
  store.update(task.id,{status:'ACTIVE'});
  const request={content:'Continue researching that',conversationId:'task-chat',requestId:'continue-before-pause',source:'android',api:new NethraApi({store,runtime:{}}),store,ownerWork:async()=>{throw Error('Lost task route');}};
  await handleOwnerWorkInstruction(request);
  store.control(task.id,'pause',store.get(task.id).revision,'later-owner-pause');
  await handleOwnerWorkInstruction(request);
  assert.equal(store.get(task.id).status,'PAUSED');
});

test('an interrupted continuation cannot replace its revision fence with a newer direction receipt',async t=>{
  const {store,task}=fixture(t,{approval:false});
  store.control(task.id,'pause',store.get(task.id).revision,'initial-pause');
  const api=new NethraApi({store,runtime:{}}),dispatch=api.dispatch.bind(api);
  let interrupt=true;
  api.dispatch=async(type,...args)=>{if(type==='nethra.message'&&interrupt){interrupt=false;throw Error('Interrupted before direction');}return dispatch(type,...args);};
  const request={content:'Continue researching that',conversationId:'task-chat',requestId:'interrupted-continuation',source:'android',api,store,ownerWork:async()=>{throw Error('Lost task route');}};
  await assert.rejects(handleOwnerWorkInstruction(request),/Interrupted/);
  store.control(task.id,'resume',store.get(task.id).revision,'later-resume');
  store.control(task.id,'pause',store.get(task.id).revision,'later-pause');
  await assert.rejects(handleOwnerWorkInstruction(request),/revision conflict/);
  assert.equal(store.get(task.id).status,'PAUSED');assert.equal(store.get(task.id).ownerInputs.length,0);
});
