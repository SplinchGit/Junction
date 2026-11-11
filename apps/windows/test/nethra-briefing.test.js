'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {situationContext,sanitizeSession,conversationFocus,workSnapshot}=require('../src/assistant-environment');

test('a uniquely named saved project is available from another conversation',()=>{
  const funding={name:'Business Plan',conversationId:'old-chat',objective:'Confirm funding eligibility'};
  const unrelated={name:'Workshop',conversationId:'current-chat',objective:'Prepare slides'};
  assert.deepEqual(workSnapshot([funding,unrelated],'current-chat','I want to work on my business plan.').map(project=>project.name),['Business Plan']);
  assert.deepEqual(workSnapshot([funding,unrelated],'current-chat','I want to work on my business planning.').map(project=>project.name),['Workshop']);
  assert.deepEqual(workSnapshot([funding,{...funding,conversationId:'other-chat'}],'new-chat','Work on my business plan'),[{ambiguous:true,names:['Business Plan','Business Plan']}]);
});

test('busy voice briefing retains owner decisions and scheduler facts within its budget',()=>{
  const now=Date.UTC(2026,10,11,12);
  const text=situationContext({now,timeZone:'Europe/London',surface:'android-relay',
    session:sanitizeSession({mode:'voice',voiceActive:true,spokenOutput:true,input:'spoken',sessionId:'a'.repeat(64),elapsedMs:123456,callState:'reconnecting'}),
    linked:{goal:'Funding strategy',status:'WAITING_FOR_USER',model:'junction-qwen3-next:80b-q3km',allowCodeWork:true,lastAccomplished:{at:now-60000,line:'Read verified sources'},next:'Confirm eligible country',waitingFor:{kind:'question',detail:'Which country should the plan cover?'}},
    objectives:[{goal:'Funding strategy',status:'WAITING_FOR_USER'}],pendingApprovals:2,schedulerRunning:false,
    presence:{phone:{state:'stale',ageMs:3600000,via:'relay'}},sources:{calendar:{status:'CONNECTED',lastSyncAt:now-1000},gmail:{status:'STALE',lastSyncAt:now-1000}},
    capabilities:['web_search','start_objective','list_objectives','get_objective','delegate_to_codex']});
  assert.ok(text.length<=2400);assert.match(text,/Which country/);assert.match(text,/2 pending approvals/);
  assert.match(text,/background scheduler is not running/);assert.match(text,/will be spoken aloud/);
  assert.match(text,/Honesty:/);assert.ok(text.endsWith('.'),'never cut a fact midway');
  assert.match(text,/junction-qwen3-next:80b-q3km/);
  assert.match(text,/voice does not grant approval/);
});

test('briefing never silently chooses between multiple linked objectives',()=>{
  const tasks=[{id:'a',goal:'Funding',status:'ACTIVE',conversationId:'chat'},
    {id:'b',goal:'Competitors',status:'PAUSED',conversationId:'chat'},
    {id:'other',goal:'Private unrelated task',status:'ACTIVE',conversationId:'elsewhere'}];
  const focus=conversationFocus(tasks,'chat');
  assert.equal(focus.task,null);assert.deepEqual(focus.candidates.map(task=>task.id),['a','b']);
  const text=situationContext({candidates:focus.candidates});
  assert.match(text,/ask which objective/i);assert.match(text,/Funding/);assert.match(text,/Competitors/);
  assert.doesNotMatch(text,/Private unrelated|conversation's objective:/);
});

test('briefing preserves a completed linked objective and does not invent a link',()=>{
  const completed={id:'old',goal:'Funding',status:'COMPLETED',conversationId:'chat'};
  const tasks=[completed,{id:'other',status:'ACTIVE',conversationId:'elsewhere'}];
  assert.equal(conversationFocus(tasks,'chat').task,completed);
  assert.equal(conversationFocus(tasks,null).task,null);
  assert.equal(conversationFocus(tasks,'new-chat').task,null);
});

test('local voice facts reach the existing model pipeline for both supported models',async()=>{
  const {LocalAgentRuntime}=require('../src/local-agent-runtime');
  for(const model of ['qwen3:30b','junction-qwen3-next:80b-q3km']){
    const requests=[];
    const runtime=new LocalAgentRuntime({fetchImpl:async(url,options={})=>{
      if(url.endsWith('/api/ps'))return {ok:true,json:async()=>({models:[{name:model,context_length:8192}]})};
      if(url.endsWith('/api/show'))return {ok:true,json:async()=>({capabilities:['completion','tools','thinking']})};
      requests.push(JSON.parse(options.body));
      return {ok:true,json:async()=>({message:{role:'assistant',content:'Hello.'}})};
    }});
    const situation=situationContext({surface:'android-lan',session:sanitizeSession({mode:'voice',voiceActive:true,input:'spoken',spokenOutput:true}),
      linked:{goal:'Funding strategy',model,status:'WAITING_FOR_USER',waitingFor:{kind:'approval',detail:'Review the saved proposal'}},pendingApprovals:1});
    await runtime.run({goal:'Hello',model,conversationId:'funding-chat',surface:'android-lan',situation});
    const prompt=requests.find(request=>request.messages?.[0]?.content.startsWith('You are Nethra'))?.messages[0].content;
    assert.ok(prompt);assert.match(prompt,/Funding strategy/);assert.match(prompt,/Review the saved proposal/);
    assert.match(prompt,/will be spoken aloud/);assert.match(prompt,/voice does not grant approval/);
  }
});

test('an explicit confirmation can carry forward the immediately preceding owner project',()=>{
  const projects=[{name:'Business Plan',conversationId:'old-chat'}];
  const history=[{role:'user',content:'Let us work on the Business Plan'},{role:'assistant',content:'Shall we draft the funding section?'}];
  assert.equal(workSnapshot(projects,'new-chat','Yes, draft the funding section',history)[0]?.name,'Business Plan');
  assert.deepEqual(workSnapshot(projects,'new-chat','Tell me a joke',history),[]);
  assert.deepEqual(workSnapshot(projects,'new-chat','Yes',history.slice(1)),[]);
  assert.deepEqual(workSnapshot(projects,'new-chat','Yes',[...history,{role:'user',content:'What about something else?'},{role:'assistant',content:'Shall we switch topics?'}]),[]);
});

test('project context follows durable task links when a conversation is reopened',()=>{
  const projects=[{id:'funding',name:'Business Plan',conversationId:'old-chat'}, {id:'other',name:'Workshop'}];
  const objectives=[{projectId:'funding',conversationId:'task-chat',status:'COMPLETED'}];
  assert.equal(workSnapshot(projects,'task-chat','Where were we?',[],objectives)[0]?.id,'funding');
  assert.equal(workSnapshot(projects,'task-chat','Work on Workshop',[],objectives)[0]?.id,'other');
  assert.deepEqual(workSnapshot(projects,'different-chat','Where were we?',[],objectives),[]);
  assert.deepEqual(workSnapshot(projects,'task-chat','Where were we?',[],[...objectives,{projectId:'other',conversationId:'task-chat'}]),[{ambiguous:true,names:['Business Plan','Workshop']}]);
});
