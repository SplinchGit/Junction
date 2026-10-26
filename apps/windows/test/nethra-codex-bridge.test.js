'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {NethraTools}=require('../src/nethra-tools');
const {sendCodexChat,getCodexStatus}=require('../src/codex-client');
const {createCodeWorkProposer}=require('../src/nethra-code-work');
// Tests never query the owner's real plan usage.
const openLimits=()=>({check:async provider=>({provider,available:true,windows:[]}),invalidate(){},recordClaude(){}});

test('Codex login status on stderr still confirms ChatGPT subscription access',async()=>{
  const run=async(_command,args)=>args[0]==='--version'?{stdout:'codex-cli test\n',stderr:''}:{stdout:'',stderr:'Logged in using ChatGPT\n'};
  const status=await getCodexStatus(run);
  assert.equal(status.ready,true);
  assert.equal(status.subscription,true);
});

test('Codex subprocess gets EOF on stdin even when a prompt argument is supplied',async()=>{
  let launchOptions,launchArgs;
  const launch=(_command,args,options)=>{
    launchArgs=args;launchOptions=options;
    const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};
    queueMicrotask(()=>{child.stdout.emit('data',JSON.stringify({item:{type:'agent_message',text:'bridge ready'}})+'\n'+JSON.stringify({type:'turn.completed',usage:{input_tokens:100,cached_input_tokens:20,output_tokens:10}})+'\n');child.emit('close',0);});
    return child;
  };
  const result=await sendCodexChat({messages:[{role:'user',content:'ping'}],memories:[],workingDirectory:'C:/scope',model:'gpt-5.6-luna',isolated:true,launch});
  assert.equal(result.content,'bridge ready');
  assert.deepEqual(result.usage,{input_tokens:100,cached_input_tokens:20,output_tokens:10});
  assert.deepEqual(launchOptions.stdio,['ignore','pipe','pipe']);
  assert.ok(launchArgs.includes('--ignore-user-config'));
});

test('an objective can inspect real host limits and Codex readiness without asking the owner for logs',async()=>{
  const tools=new NethraTools({store:{get:()=>({status:'ACTIVE'})},codexStatus:async()=>({installed:true,ready:true,subscription:true,version:'codex-cli test'}),claudeStatus:async()=>({installed:true,ready:true,subscription:true,version:'2.1 (Claude Code)'}),advisorLimits:openLimits(),hostDiagnostics:()=>({model:'qwen3:30b',contextTokens:8192})});
  const names=tools.definitions({task:{allowCodeWork:true}}).map(item=>item.function.name);
  assert.ok(names.includes('host_diagnostics'));
  assert.ok(names.includes('consult_codex'));
  assert.ok(!tools.definitions({task:{allowCodeWork:false}}).some(item=>item.function.name==='consult_codex'));
  const result=await tools.execute('host_diagnostics',{}, {id:'self-improvement'});
  assert.equal(result.codex.ready,true);
  assert.equal(result.claude.ready,true);
  assert.equal(result.codex.liveLimits,'Advisors are not enabled for this objective');
  assert.equal(result.model.contextTokens,8192);
  assert.ok(!tools.definitions({child:true}).some(item=>item.function.name==='consult_codex'));
});

test('Codex consultation is bounded, read-only, and associated with the current objective',async()=>{
  const calls=[];
  const tools=new NethraTools({store:{get:()=>({status:'ACTIVE'})},codexStatus:async()=>({ready:true}),advisorLimits:openLimits(),codexConsult:async input=>{calls.push(input);return {content:'Measure first-token latency, then compare warm and cold turns.',model:'Codex test'};}});
  const task={id:'self-improvement',goal:'Self Improvement',successCriteria:'Improve speed and awareness',workspace:'C:/task-workspace',allowCodeWork:true};
  const result=await tools.execute('consult_codex',{question:'How should I measure response latency?'},task);
  assert.match(result.advice,/first-token latency/);
  assert.equal(result.source,'codex');
  assert.equal(calls[0].workingDirectory,task.workspace);
  assert.equal(calls[0].model,'gpt-5.6-luna');
  assert.equal(calls[0].isolated,true);
  assert.equal(calls[0].messages.length,1);
  assert.match(calls[0].messages[0].content,/Self Improvement/);
  assert.doesNotMatch(JSON.stringify(calls[0]),/readRoots|evidence|ownerInputs/);
  await assert.rejects(tools.execute('consult_codex',{question:'Again'},task,{signal:AbortSignal.abort()}));
  assert.equal(calls.length,1);
});

test('a resting advisor refuses with its reset time and never starts the CLI',async()=>{
  const live={id:'self-improvement',status:'ACTIVE',allowCodeWork:true};
  let calls=0;const resetsAt=Date.parse('2026-10-26T00:52:37Z');
  const limits={check:async()=>({available:false,detail:`Usage is at or above the 90% the owner allows (five_hour 100%). Available again at ${new Date(resetsAt).toISOString()}.`,nextAvailableAt:resetsAt}),invalidate(){},recordClaude(){}};
  const tools=new NethraTools({store:{get:()=>live},codexStatus:async()=>({ready:true}),advisorLimits:limits,codexConsult:async()=>{calls++;return {content:'Advice'};}});
  await assert.rejects(tools.execute('consult_codex',{question:'Pass'},live),/Codex is resting.*2026-10-26T00:52:37\.000Z.*Schedule a wake/);
  assert.equal(calls,0);
});

test('consultations are journaled per advisor with no fixed daily count',t=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const {NethraStore}=require('../src/nethra-store');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-codex-budget-'));
  const store=new NethraStore(directory);
  t.after(()=>{store.close();fs.rmSync(directory,{recursive:true,force:true});});
  const first=store.create({goal:'Improve responsiveness'}),second=store.create({goal:'Improve task awareness'});
  for(let i=0;i<5;i++)store.recordConsult(i%2?second.id:first.id,'codex');
  assert.deepEqual(store.recordConsult(first.id,'claude'),{todayAcrossObjectives:1});
  assert.deepEqual(store.recordConsult(second.id,'codex'),{todayAcrossObjectives:6});
  assert.throws(()=>store.recordConsult(first.id,'other'),/Unknown advisor/);
});

test('only an opted-in objective can draft scoped Codex development work',async()=>{
  const proposed=[];
  const task={id:'self-improvement',goal:'Self Improvement',status:'ACTIVE',allowCodeWork:false};
  const tools=new NethraTools({store:{get:()=>task},codexStatus:async()=>({ready:true}),advisorLimits:openLimits(),codexConsult:async()=>({content:'Scoped proposal is testable.',model:'Codex test'}),proposeCodeWork:async input=>{proposed.push(input);return {id:'work-1',status:'DRAFT'};}});
  assert.ok(!tools.definitions({task}).some(item=>item.function.name==='propose_code_work'));
  assert.ok(!tools.definitions({task}).some(item=>item.function.name==='consult_codex'));
  await assert.rejects(tools.execute('consult_codex',{question:'Can you help?'},task),/not enabled/);
  await assert.rejects(tools.execute('propose_code_work',{task:'Improve Nethra context handling',acceptance:'Measure and pass focused tests'},task),/not enabled/);
  task.allowCodeWork=true;
  assert.ok(tools.definitions({task}).some(item=>item.function.name==='propose_code_work'));
  const result=await tools.execute('propose_code_work',{task:'Improve Nethra context handling',acceptance:'Measure and pass focused tests'},task);
  assert.equal(result.workId,'work-1');
  assert.equal(result.status,'DRAFT');
  assert.equal(proposed.length,1);
});

test('a code draft is saved only after Codex reviews that exact proposal',async()=>{
  const calls=[],drafts=[];
  const task={id:'self-improvement',goal:'Self Improvement',status:'ACTIVE',allowCodeWork:true,workspace:'C:/task-workspace'};
  const tools=new NethraTools({store:{get:()=>task},codexStatus:async()=>({ready:true}),advisorLimits:openLimits(),codexConsult:async input=>{calls.push(input.messages[0].content);return {content:'Feasible if chat token counts exclude private text.',model:'Codex test'};},proposeCodeWork:async input=>{drafts.push(input);return {id:'reviewed-1',status:'DRAFT'};}});
  const result=await tools.execute('propose_code_work',{task:'Show token counts for chats',acceptance:'Show measured counts without message text'},task);
  assert.equal(result.status,'DRAFT');
  assert.equal(drafts.length,1);
  assert.match(calls[0],/Show token counts for chats/);
  assert.match(calls[0],/Show measured counts without message text/);
  assert.match(drafts[0].review.advice,/exclude private text/);
  await assert.rejects(tools.execute('propose_code_work',{task:'Another change',acceptance:'Yes'},task),/measurable acceptance/i);
  assert.equal(drafts.length,1);
  assert.equal(calls.length,1);
  const unavailable=new NethraTools({store:{get:()=>task},codexStatus:async()=>({ready:false}),advisorLimits:openLimits(),proposeCodeWork:async()=>{throw Error('Draft must not be created');}});
  await assert.rejects(unavailable.execute('propose_code_work',{task:'Another change',acceptance:'The measured tests pass without regressions'},task),/Codex is not signed in/);
});

test('a scoped code proposal creates one paused Work Activity draft and reuses it on retry',async t=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-code-scope-'));
  fs.mkdirSync(path.join(root,'apps','windows'),{recursive:true});t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const projects=[],foreman={list:()=>projects,create:async input=>{const project={id:`draft-${projects.length+1}`,status:'DRAFT',...input};projects.push(project);return project;}};
  const propose=createCodeWorkProposer({foreman,junctionRepository:root});
  const objective={id:'task-1',goal:'Self Improvement',conversationId:'chat-1',allowCodeWork:true,readRoots:[root]};
  const input={objective,description:'Reduce Nethra latency',acceptance:'A before and after benchmark passes',review:{source:'codex',model:'Codex test',advice:'Measure baseline first.'}};
  const result=await propose(input);
  assert.equal(result.status,'DRAFT');
  assert.equal(projects[0].repoPath,path.join(root,'apps','windows'));
  assert.equal(projects[0].sourceObjectiveId,objective.id);
  assert.match(projects[0].objective,/Measure baseline first/);
  assert.equal((await propose(input)).id,result.id);
  assert.equal(projects.length,1);
  await propose({...input,description:'Expose task activity',acceptance:'Recorded progress is visible in the task chat'});
  assert.equal(projects.length,2);
  const longDescription='Improve task context. '+ 'Keep the full scoped proposal and its acceptance criteria available to the owner and implementation agent. '.repeat(4);
  await propose({...input,description:longDescription});
  assert.equal(projects.length,3);
  assert.ok(projects[2].tasks[0].title.length<=240);
  assert.match(projects[2].objective,/full scoped proposal/);
  await assert.rejects(propose({...input,objective:{...objective,readRoots:[]}}),/Approve the Junction read folder/);
});
