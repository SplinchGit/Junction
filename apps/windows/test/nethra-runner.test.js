"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { NethraTools } = require('../src/nethra-tools');
const { NethraRunner,textualCall } = require('../src/nethra-runner');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nethra-')); t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const task = {id:'test',objective:'Prepare a report',workspace:root,readRoots:[root],plan:[],evidence:[]};
  const approvals=[]; const receipts=new Map();
  const store={get:()=>task,update:(_id,patch)=>Object.assign(task,patch),approvals:()=>approvals,requestApproval:(_id,a)=>{const entry={...a,id:'approval',status:'pending'};approvals.push(entry);return entry;},getAction:k=>receipts.get(k),reserveAction:(_id,k,tool,args)=>{if(receipts.has(k))return receipts.get(k);const a={key:k,status:'reserved',tool,args};receipts.set(k,a);return a;},finishAction:(k,result)=>{const a={...receipts.get(k),status:'completed',result};receipts.set(k,a);return a;}};
  return {root,task,store,approvals};
}
test('tools constrain real files, reject secrets and traversal, and write drafts',async t=>{
  const f=fixture(t); fs.writeFileSync(path.join(f.root,'notes.txt'),'facts');fs.writeFileSync(path.join(f.root,'.env'),'SECRET');
  const tools=new NethraTools({store:f.store});
  assert.equal((await tools.execute('read_file',{path:path.join(f.root,'notes.txt')},f.task)).content,'facts');
  for(const name of ['.env','../escape.txt']) await assert.rejects(tools.execute('read_file',{path:path.join(f.root,name)},f.task));
  const result=await tools.execute('write_draft',{path:'report.md',content:'report'},f.task);
  assert.equal(fs.readFileSync(result.path,'utf8'),'report');
  await assert.rejects(tools.execute('write_draft',{path:'report.md',content:'replacement'},f.task),/approval/i);
  assert.equal(fs.readFileSync(result.path,'utf8'),'report');
});

test('a long source remains readable through structured pages after restart and model handoff',async t=>{
  const {NethraStore}=require('../src/nethra-store');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-paged-source-'));
  let store=new NethraStore(directory);
  t.after(()=>{store.close();fs.rmSync(directory,{recursive:true,force:true});});
  let task=store.create({goal:'Read source.txt and report its final marker',plan:[]});
  store.update(task.id,{plan:['Read source.txt and report its final marker'],pendingSteps:['Read source.txt and report its final marker']});
  const source='Essay context with escaped text: \\" and an emoji 🐰.\n'.repeat(140)+'FINAL_MARKER_7391';
  fs.writeFileSync(path.join(task.workspace,'source.txt'),source);
  let firstCalls=0,firstPage;
  const firstRuntime={withInference:fn=>fn(),chat:async(_model,messages)=>{
    if(firstCalls++===0)return {message:{role:'assistant',tool_calls:[{function:{name:'read_file',arguments:{path:'source.txt'}}}]}};
    firstPage=JSON.parse(messages.at(-1).content);
    return {message:{role:'assistant',tool_calls:[{function:{name:'schedule_wake',arguments:{at:Date.now()+60_000,reason:'Continue reading the remaining source pages'}}}]}};
  }};
  await new NethraRunner({store,runtime:firstRuntime}).execute(store.get(task.id));
  assert.equal(typeof firstPage.content,'string');
  assert.ok(firstPage.nextOffset>0);assert.equal(firstPage.eof,false);
  task=store.get(task.id);
  assert.equal(task.contextCheckpoint.fileReads[0].nextOffset,firstPage.nextOffset);
  store.close();store=new NethraStore(directory);task=store.get(task.id);
  task=store.configure(task.id,{model:'junction-qwen3-next:80b-q3km'},task.revision,'read-pages-model-handoff');
  let assembled=firstPage.content,secondCalls=0;
  const runtime={withInference:fn=>fn(),chat:async(_model,messages)=>{
    assert.equal(_model,'junction-qwen3-next:80b-q3km');
    const seed=JSON.parse(messages[1].content);
    if(secondCalls++>0)assembled+=JSON.parse(messages.at(-1).content).content;
    const cursor=seed.workingCheckpoint.fileReads[0];
    return {message:{role:'assistant',tool_calls:[{function:cursor.nextOffset===null?
      {name:'finish_objective',arguments:{summary:'source.txt final marker is FINAL_MARKER_7391.'}}:
      {name:'read_file',arguments:{path:cursor.path,offset:cursor.nextOffset,sha256:cursor.sha256}}}]}};
  }};
  const result=await new NethraRunner({store,runtime}).execute(task);
  assert.equal(result.status,'COMPLETED');
  assert.equal(assembled,source);
  assert.equal(result.contextCheckpoint.fileReads[0].eof,true);
  assert.equal(result.contextCheckpoint.fileReads[0].nextOffset,null);
  assert.ok(store.get(task.id).evidence.filter(item=>item.tool==='read_file').every(item=>typeof item.result.content==='string'&&!item.result.truncated));
});

test('a source changed between pages can be reread from the start in the same pass',async t=>{
  const f=fixture(t),file=path.join(f.root,'source.txt');
  fs.writeFileSync(file,'Original source. '.repeat(400));
  let calls=0,firstPage,freshPage;
  const runtime={withInference:fn=>fn(),chat:async(_model,messages)=>{
    const stage=calls++;let action;
    if(stage===0)action={name:'read_file',arguments:{path:'source.txt',offset:0}};
    if(stage===1){
      firstPage=JSON.parse(messages.at(-1).content);fs.writeFileSync(file,'Revised source. '.repeat(400));
      action={name:'read_file',arguments:{path:'source.txt',offset:firstPage.nextOffset,sha256:firstPage.sha256}};
    }
    if(stage===2){
      assert.match(JSON.parse(messages.at(-1).content).error,/changed/i);
      action={name:'read_file',arguments:{path:'source.txt',offset:0}};
    }
    if(stage===3){freshPage=JSON.parse(messages.at(-1).content);action={name:'schedule_wake',arguments:{at:Date.now()+60_000,reason:'Continue from the revised source'}};}
    return {message:{role:'assistant',tool_calls:[{function:action}]}};
  }};
  await new NethraRunner({store:f.store,runtime}).execute(f.task);
  assert.ok(freshPage.content?.startsWith('Revised source.'));
  assert.notEqual(freshPage.sha256,firstPage.sha256);
  assert.equal(f.task.contextCheckpoint.fileReads[0].sha256,freshPage.sha256);
});

test('protected task state can exceed the compaction target when it fits the model context',async t=>{
  const f=fixture(t);
  const feedback='Preserve this exact reviewer requirement. '.repeat(65).slice(0,2600);
  Object.assign(f.task,{
    goal:'Read the reviewed source and continue implementing the existing objective',
    successCriteria:'Keep every acceptance requirement. '.repeat(28),
    plan:Array.from({length:5},(_,index)=>`Step ${index}: `+'Keep the recorded constraint. '.repeat(12)),
    ownerInputs:[{kind:'note',text:'Continue within the saved constraints. '.repeat(13)}],
    contextCheckpoint:{activeHypothesis:'Current hypothesis. '.repeat(45),lastReview:{verdict:'REVISE',proposal:'Exact reviewed proposal. '.repeat(40),acceptance:'Exact acceptance. '.repeat(55),feedback},fileReads:[{path:path.join(f.root,'source.txt'),sha256:'a'.repeat(64),offset:0,totalChars:12000,nextOffset:2400,eof:false}]}
  });
  let seenSeed;
  const runtime={withInference:fn=>fn(),chat:async(_model,messages,definitions)=>{
    seenSeed=JSON.parse(messages[1].content);
    const {estimateTokens,CONTEXT_TOKENS}=require('../src/model-context');
    assert.ok(estimateTokens(messages)+estimateTokens(definitions)<=CONTEXT_TOKENS-1792);
    return {message:{role:'assistant',tool_calls:[{function:{name:'schedule_wake',arguments:{at:Date.now()+60_000,reason:'Continue with the complete saved review and read cursor'}}}]}};
  }};
  const result=await new NethraRunner({store:f.store,runtime}).execute(f.task);
  assert.equal(result.status,'SLEEPING',result.summary);
  assert.equal(seenSeed.workingCheckpoint.lastReview.feedback,feedback);
  assert.equal(seenSeed.workingCheckpoint.fileReads[0].nextOffset,2400);
  assert.ok(JSON.stringify(seenSeed).length>9000);
});
test('a later pass saves a new revision of its own draft without blocking or replacing the original',async t=>{
  const {NethraStore}=require('../src/nethra-store');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-draft-revision-')),store=new NethraStore(directory);
  t.after(()=>{store.close();fs.rmSync(directory,{recursive:true,force:true});});
  const task=store.create({goal:'Maintain a measured performance report'}),tools=new NethraTools({store});
  const first=await tools.execute('write_draft',{path:'baseline.md',content:'9 samples; median 69331 ms'},task);
  const second=await tools.execute('write_draft',{path:'baseline.md',content:'17 samples; median 68206 ms'},task);
  const retry=await tools.execute('write_draft',{path:'baseline.md',content:'17 samples; median 68206 ms'},task);
  assert.notEqual(second.path,first.path);
  assert.equal(second.revisionOf,first.path);
  assert.equal(second.requestedPath,first.path);
  assert.equal(fs.readFileSync(first.path,'utf8'),'9 samples; median 69331 ms');
  assert.equal(fs.readFileSync(second.path,'utf8'),'17 samples; median 68206 ms');
  assert.deepEqual(retry,second);
  assert.equal(store.actions(task.id).filter(item=>item.status==='COMPLETED').length,2);
  assert.equal(store.approvals(task.id).length,0);
  fs.writeFileSync(path.join(task.workspace,'owner.md'),'Owner original');
  await assert.rejects(tools.execute('write_draft',{path:'owner.md',content:'replacement'},task),/approval/i);
  assert.equal(fs.readFileSync(path.join(task.workspace,'owner.md'),'utf8'),'Owner original');
});

test('requesting approval for a verified task draft saves a revision and continues with its receipt',async t=>{
  const {NethraStore}=require('../src/nethra-store');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-redundant-approval-')),store=new NethraStore(directory);
  t.after(()=>{store.close();fs.rmSync(directory,{recursive:true,force:true});});
  const task=store.create({goal:'Revise the saved performance proposal'}),tools=new NethraTools({store});
  const original=await tools.execute('write_draft',{path:'proposal.md',content:'Original proposal'},task);
  let calls=0,nextSeed;
  const runtime={withInference:fn=>fn(),chat:async(_model,messages)=>{
    if(calls++)nextSeed=JSON.parse(messages[1].content);
    return {message:{role:'assistant',content:'',tool_calls:[{function:calls===1?
      {name:'request_approval',arguments:{tool:'write_draft',args:{path:'proposal.md',content:'Revised proposal'}}}:
      {name:'schedule_wake',arguments:{at:Date.now()+60_000,reason:'Continue from the saved revised proposal'}}}]}};
  }};
  const result=await new NethraRunner({store,runtime,tools}).execute(task);
  assert.equal(result.status,'SLEEPING');
  assert.equal(store.approvals(task.id).length,0);
  assert.equal(fs.readFileSync(original.path,'utf8'),'Original proposal');
  const revision=nextSeed.workingCheckpoint.completedDrafts.find(item=>item.requestedPath===original.path);
  assert.ok(revision);
  assert.notEqual(revision.path,original.path);
  assert.equal(fs.readFileSync(revision.path,'utf8'),'Revised proposal');
  assert.deepEqual(await tools.execute('request_approval',{tool:'write_draft',args:{path:'proposal.md',content:'Revised proposal'}},store.get(task.id)),store.actions(task.id).find(item=>item.args.path===revision.path).result);
});

test('replanning can send new steps without repeating saved completed steps',async t=>{
  for(const completedSteps of [undefined,['Measured baseline']]){
    const f=fixture(t);Object.assign(f.task,{plan:['Measured baseline','Old next step'],completedSteps:['Measured baseline'],pendingSteps:['Old next step']});
    let calls=0,nextSeed;
    const runtime={withInference:fn=>fn(),chat:async(_model,messages)=>{
      if(calls++)nextSeed=JSON.parse(messages[1].content);
      return {message:{role:'assistant',content:'',tool_calls:[{function:calls===1?{name:'update_plan',arguments:{steps:['Revise the proposal'],...(completedSteps?{completedSteps}:{})}}:{name:'schedule_wake',arguments:{at:Date.now()+60_000,reason:'Continue the revised proposal'}}}]}};
    }};
    const result=await new NethraRunner({store:f.store,runtime}).execute(f.task);
    assert.deepEqual(result.plan,['Measured baseline','Revise the proposal']);
    assert.deepEqual(result.completedSteps,['Measured baseline']);
    assert.deepEqual(result.pendingSteps,['Revise the proposal']);
    assert.deepEqual(nextSeed.plan,result.plan);
  }
});

test('a plan can have no remaining steps while retaining its completed work',async t=>{
  const f=fixture(t);Object.assign(f.task,{plan:['Save baseline report'],completedSteps:[],pendingSteps:['Save baseline report']});
  let calls=0;
  const runtime={withInference:fn=>fn(),chat:async()=>({message:{role:'assistant',content:'',tool_calls:[{function:calls++===0?{name:'update_plan',arguments:{steps:[],completedSteps:['Save baseline report']}}:{name:'schedule_wake',arguments:{at:Date.now()+60_000,reason:'The report step is complete'}}}]}})};
  const result=await new NethraRunner({store:f.store,runtime}).execute(f.task);
  assert.deepEqual(result.plan,['Save baseline report']);
  assert.deepEqual(result.completedSteps,['Save baseline report']);
  assert.deepEqual(result.pendingSteps,[]);
});

test('explicit finish records completed plan steps when the actual task evidence satisfies the goal',async t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.root,'facts.txt'),'The measured marker is amber junction 47.');
  Object.assign(f.task,{goal:'Read facts.txt and report the measured marker',plan:['Read facts.txt and report the measured marker'],completedSteps:[],pendingSteps:['Read facts.txt and report the measured marker']});
  let calls=0;
  const runtime={withInference:fn=>fn(),chat:async()=>({message:{role:'assistant',content:'',tool_calls:[{function:calls++===0?{name:'read_file',arguments:{path:'facts.txt'}}:{name:'finish_objective',arguments:{summary:'facts.txt reports the measured marker amber junction 47.'}}}]}})};
  const result=await new NethraRunner({store:f.store,runtime}).execute(f.task);
  assert.equal(result.status,'COMPLETED');assert.equal(calls,2);
  assert.deepEqual(result.completedSteps,result.plan);assert.deepEqual(result.pendingSteps,[]);
});

test('a question about an already written report is answered from receipts so the task continues',async t=>{
  const {NethraStore}=require('../src/nethra-store');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-known-report-')),store=new NethraStore(directory);
  t.after(()=>{store.close();fs.rmSync(directory,{recursive:true,force:true});});
  let task=store.create({goal:'Continue performance improvement'});
  store.update(task.id,{plan:['Old completed step','Refine proposal'],completedSteps:['Old completed step'],pendingSteps:['Refine proposal']});
  await new NethraTools({store}).execute('write_draft',{path:'baseline.md',content:'Measured baseline: 9 samples, median 69331 ms.'},task);
  task=store.get(task.id);let calls=0,knownReply;
  const complete='Read performance_report and write baseline.md with actual counts';
  const runtime={withInference:fn=>fn(),chat:async(_model,messages)=>{
    if(calls===1)knownReply=JSON.parse(messages.at(-1).content);
    const call=[
      {name:'request_input',arguments:{reason:'OWNER_PREFERENCE',blocking:true,question:'Should I mark baseline.md as completed even though the file was not written yet?'}},
      {name:'update_plan',arguments:{steps:['Refine proposal'],completedSteps:[complete]}},
      {name:'schedule_wake',arguments:{at:Date.now()+60_000,reason:'Continue the proposal from the saved baseline'}}
    ][calls++];
    return {message:{role:'assistant',content:'',tool_calls:[{function:call}]}};
  }};
  const result=await new NethraRunner({store,runtime}).execute(task);
  assert.equal(result.status,'SLEEPING');assert.equal(calls,3);
  assert.equal(knownReply.alreadyKnown,true);assert.equal(knownReply.completedDrafts[0].path,path.join(task.workspace,'baseline.md'));
  assert.ok(result.completedSteps.includes(complete));
  assert.deepEqual(result.pendingSteps,['Refine proposal']);
  assert.equal(store.get(task.id).ownerInputs.length,0);
});

test('a genuine audience decision about a saved report still reaches the owner',async t=>{
  const {NethraStore}=require('../src/nethra-store');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-report-decision-')),store=new NethraStore(directory);
  t.after(()=>{store.close();fs.rmSync(directory,{recursive:true,force:true});});
  const task=store.create({goal:'Prepare a performance report'});
  await new NethraTools({store}).execute('write_draft',{path:'baseline.md',content:'Measured report for review.'},task);
  const question='Which audience should the saved baseline.md report target: engineers or customers?';let calls=0;
  const runtime={withInference:fn=>fn(),chat:async()=>({message:{role:'assistant',content:'',tool_calls:[{function:calls++===0?{name:'request_input',arguments:{reason:'OWNER_PREFERENCE',blocking:true,question}}:{name:'schedule_wake',arguments:{at:Date.now()+60_000,reason:'Continue later'}}}]}})};
  const result=await new NethraRunner({store,runtime}).execute(store.get(task.id));
  assert.equal(result.status,'WAITING_FOR_USER');assert.equal(result.summary,question);assert.equal(calls,1);
});

test('an owner-code wait cannot strand a task when no code-work draft exists',async t=>{
  const f=fixture(t);f.task.allowCodeWork=true;f.task.contextCheckpoint={lastReview:{verdict:'REVISE',feedback:'Define a request-local scope.'}};
  let calls=0,correction,seed;
  const runtime={withInference:fn=>fn(),chat:async(_model,messages)=>{
    seed=JSON.parse(messages[1].content);
    if(calls===1)correction=JSON.parse(messages.at(-1).content);
    return {message:{role:'assistant',content:'',tool_calls:[{function:calls++===0?{name:'schedule_wake',arguments:{at:Date.now()+86_400_000,reason:'Wait for owner to review and apply the verified code patch'}}:{name:'schedule_wake',arguments:{at:Date.now()+60_000,reason:'Continue revising the proposal from saved feedback'}}}]}};
  }};
  const result=await new NethraRunner({store:f.store,runtime}).execute(f.task);
  assert.equal(calls,2);assert.equal(seed.codeWorkState.draftExists,false);
  assert.match(correction.error,/no.*code.work draft|no.*patch/i);
  assert.equal(result.status,'SLEEPING');assert.match(result.summary,/Continue revising/);
});

test('a real code-work draft keeps its legitimate owner start gate',async t=>{
  const f=fixture(t);f.task.allowCodeWork=true;f.task.contextCheckpoint={codeWorkDraft:{workId:'real-draft',status:'DRAFT'}};
  let seed;
  const runtime={withInference:fn=>fn(),chat:async(_model,messages)=>{seed=JSON.parse(messages[1].content);return {message:{role:'assistant',content:'',tool_calls:[{function:{name:'schedule_wake',arguments:{at:Date.now()+60_000,reason:'Wait for owner to start the code work draft'}}}]}};}};
  const result=await new NethraRunner({store:f.store,runtime,workStatus:id=>id==='real-draft'?{status:'DRAFT',promotedAt:null}:null}).execute(f.task);
  assert.equal(seed.codeWorkState.workId,'real-draft');assert.equal(seed.codeWorkState.draftExists,true);
  assert.equal(result.status,'SLEEPING');assert.match(result.summary,/owner to start/);
});

test('the owner may review a local proposal before a code-work item exists',async t=>{
  for(const question of ['Would you like to review the local code proposal before I submit it?','Would you review my implementation plan before I submit the code proposal?']){
    const f=fixture(t);f.task.allowCodeWork=true;
    const runtime={withInference:fn=>fn(),chat:async()=>({message:{role:'assistant',content:'',tool_calls:[{function:{name:'request_input',arguments:{reason:'OWNER_PREFERENCE',blocking:true,question}}}]}})};
    const result=await new NethraRunner({store:f.store,runtime}).execute(f.task);
    assert.equal(result.status,'WAITING_FOR_USER');assert.equal(result.summary,question);
  }
});

test('following required technical review feedback does not need another owner choice',async t=>{
  const f=fixture(t);f.task.allowCodeWork=true;f.task.contextCheckpoint={lastReview:{verdict:'REVISE',feedback:'Define the cache boundary and exact parity fixtures.'}};
  let calls=0,answer;
  const runtime={withInference:fn=>fn(),chat:async(_model,messages)=>{
    if(calls===1)answer=JSON.parse(messages.at(-1).content);
    const call=[
      {name:'request_input',arguments:{reason:'OWNER_PREFERENCE',blocking:true,question:'Should I revise the proposal to include all required elements from the review feedback, or use the existing final.md draft as-is?'}},
      {name:'update_plan',arguments:{steps:['Address the required cache boundary and parity fixture feedback']}},
      {name:'schedule_wake',arguments:{at:Date.now()+60_000,reason:'Continue the required technical revisions'}}
    ][calls++];
    return {message:{role:'assistant',content:'',tool_calls:[{function:call}]}};
  }};
  const result=await new NethraRunner({store:f.store,runtime}).execute(f.task);
  assert.equal(result.status,'SLEEPING');assert.equal(calls,3);
  assert.equal(answer.alreadyKnown,true);assert.equal(answer.decision,'ADDRESS_REQUIRED_REVIEW');
  assert.deepEqual(result.pendingSteps,['Address the required cache boundary and parity fixture feedback']);
});

test('review feedback does not replace owner budget or constraint decisions',async t=>{
  for(const question of ['Should I revise the proposal to include the paid hosting required by this feedback, or keep the existing local setup?','Should I revise the proposal to include all required elements from the review feedback even though that conflicts with your instruction to preserve the public API?']){
    const f=fixture(t);f.task.allowCodeWork=true;f.task.contextCheckpoint={lastReview:{verdict:'REVISE',feedback:'The proposal needs a changed API or hosted service.'}};
    const runtime={withInference:fn=>fn(),chat:async()=>({message:{role:'assistant',content:'',tool_calls:[{function:{name:'request_input',arguments:{reason:'OWNER_PREFERENCE',blocking:true,question}}}]}})};
    const result=await new NethraRunner({store:f.store,runtime}).execute(f.task);
    assert.equal(result.status,'WAITING_FOR_USER');assert.equal(result.summary,question);
  }
});
test('runner uses native messages, explicit completion and never persists thinking',async t=>{
  const f=fixture(t);const seen=[];let calls=0;fs.writeFileSync(path.join(f.root,'facts.txt'),'Report facts');
  const runtime={withInference:fn=>fn(),chat:async(model,messages)=>{seen.push(structuredClone(messages));calls++;return {message:{role:'assistant',thinking:'private reasoning',content:'',tool_calls:calls===1?[{function:{name:'read_file',arguments:{path:'facts.txt'}}},{function:{name:'update_plan',arguments:{steps:['Read evidence'],completedSteps:['Read evidence']}}}]:[{function:{name:'finish_objective',arguments:{summary:'Report ready'}}}]}};}};
  const result=await new NethraRunner({store:f.store,runtime}).execute(f.task);
  assert.equal(result.status,'COMPLETED');assert.equal(result.summary,'Report ready');assert.equal(seen[1].at(-1).role,'tool');
  assert.equal(JSON.stringify(f.task).includes('private reasoning'),false);
});

test('one objective can use 30B, 80B Instruct and 80B Thinking without changing its harness',async t=>{
  const f=fixture(t),calls=[];
  f.task.model='junction-qwen3-next:80b-q3km';
  const runtime={withInference:fn=>fn(),chat:async(model,messages,tools,signal,onText,format,options)=>{
    calls.push({model,options,system:messages[0].content});
    return {message:{role:'assistant',content:'',tool_calls:[{function:{name:'schedule_wake',arguments:{at:Date.now()+600_000,reason:'Continue work'}}}]}};
  }};
  const runner=new NethraRunner({store:f.store,runtime});
  await runner.execute(f.task);
  f.task.model='qwen3:30b';
  await runner.execute(f.task);
  f.task.model='junction-qwen3-next-thinking:80b-q3km';
  await runner.execute(f.task);
  assert.deepEqual(calls.map(call=>call.model),['junction-qwen3-next:80b-q3km','qwen3:30b','junction-qwen3-next-thinking:80b-q3km']);
  assert.deepEqual(calls.map(call=>call.options.thinking),[false,true,true]);
  assert.deepEqual(calls.map(call=>call.options.num_predict),[1536,1536,6144]);
  assert.equal(calls[2].options.thinkingBudget,undefined);
  assert.ok(calls.every(call=>!call.system.includes('qwen3:30b')));
});
test('a requested local file read cannot be replaced by a directory listing and a copied success criterion',async t=>{
  const f=fixture(t);
  f.task.objective='Read the approved facts file at facts.txt, then create report.md with its witness';
  f.task.successCriteria='report.md contains amber junction 47';
  fs.writeFileSync(path.join(f.root,'facts.txt'),'Acceptance witness: amber junction 47');
  const steps=['Read facts file','Write report'];let call=0;
  const runtime={withInference:fn=>fn(),chat:async()=>({message:{role:'assistant',content:'',tool_calls:++call===1?[
    {function:{name:'list_directory',arguments:{path:f.root}}},
    {function:{name:'write_draft',arguments:{path:'report.md',content:'amber junction 47'}}},
    {function:{name:'update_plan',arguments:{steps,completedSteps:steps}}}
  ]:call===2?[
    {function:{name:'finish_objective',arguments:{summary:'The report contains amber junction 47'}}}
  ]:[
    {function:{name:'request_input',arguments:{reason:'OWNER_PREFERENCE',blocking:true,question:'I still need to read the approved facts file.'}}}
  ]}})};
  const result=await new NethraRunner({store:f.store,runtime}).execute(f.task);
  assert.equal(result.status,'WAITING_FOR_USER');
  assert.equal(result.evidence.some(item=>item.tool==='read_file'),false);
});
test('one work pass can perform more than ten distinct steps before yielding',async t=>{
  const f=fixture(t);for(let i=0;i<11;i++)fs.writeFileSync(path.join(f.root,`source-${i}.txt`),`Report evidence ${i}`);
  let calls=0;const wakeAt=Date.now()+600_000;
  const runtime={withInference:fn=>fn(),chat:async()=>({message:{role:'assistant',content:'',tool_calls:[{function:calls<11?{name:'read_file',arguments:{path:`source-${calls++}.txt`}}:{name:'schedule_wake',arguments:{at:wakeAt,reason:'Review the gathered evidence next pass'}}}]}})};
  const result=await new NethraRunner({store:f.store,runtime}).execute(f.task);
  assert.equal(calls,11);assert.equal(result.status,'SLEEPING');assert.equal(result.evidence.length,11);
});

test('a question for an experiment ID already in host records keeps the pass running',async t=>{
  const f=fixture(t),id='f59db726-9373-4ef4-a021-8fe3e8d195e4';
  f.task.allowCodeWork=true;
  f.store.experiments=()=>[{id,metric:'task_model_ms',status:'BASELINE',hypothesis:'Measure latency'}];
  let calls=0;
  const runtime={withInference:fn=>fn(),chat:async(_model,messages)=>{
    calls++;
    if(calls===1)return {message:{role:'assistant',content:'',tool_calls:[{function:{name:'request_input',arguments:{reason:'OWNER_PREFERENCE',blocking:true,question:'Please provide the ID of the experiment to evaluate.'}}}]}};
    assert.ok(messages.some(message=>String(message.content).includes(id)));
    return {message:{role:'assistant',content:'',tool_calls:[{function:{name:'schedule_wake',arguments:{at:Date.now()+600_000,reason:'Continue after evaluating saved experiments'}}}]}};
  }};
  const result=await new NethraRunner({store:f.store,runtime,localData:{usage:()=>[]}}).execute(f.task);
  assert.equal(calls,2);
  assert.equal(result.status,'SLEEPING');
});
test('an ongoing objective saves a verified milestone and sleeps instead of completing',async t=>{
  const {NethraStore}=require('../src/nethra-store');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-monitor-'));
  const now=1_800_000_000_000,store=new NethraStore(path.join(root,'store'),{now:()=>now});
  t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
  const task=store.create({goal:'Track housing updates',mode:'ONGOING'});
  fs.writeFileSync(path.join(task.workspace,'facts.txt'),'Verified housing updates from the council.');
  const runtime={withInference:fn=>fn(),chat:async()=>({message:{role:'assistant',content:'',tool_calls:[
    {function:{name:'read_file',arguments:{path:'facts.txt'}}},
    {function:{name:'update_plan',arguments:{steps:['Read housing updates'],completedSteps:['Read housing updates']}}},
    {function:{name:'finish_objective',arguments:{summary:'Housing updates checked from the saved council document.'}}}
  ]}})};
  const result=await new NethraRunner({store,runtime,now:()=>now}).execute(task);
  assert.equal(result.status,'SLEEPING');
  assert.equal(result.nextWakeAt,now+86_400_000);
  assert.equal(store.get(task.id).status,'SLEEPING');
  assert.equal(store.events(task.id).filter(event=>event.kind==='MILESTONE_VERIFIED').length,1);
  const noChange={withInference:fn=>fn(),chat:async()=>({message:{role:'assistant',content:'',tool_calls:[{function:{name:'finish_objective',arguments:{summary:'No new housing updates.'}}}]}})};
  await new NethraRunner({store,runtime:noChange,now:()=>now+86_400_000}).execute(store.get(task.id));
  assert.equal(store.events(task.id).filter(event=>event.kind==='MILESTONE_VERIFIED').length,1);
  assert.equal(store.events(task.id).filter(event=>event.kind==='MONITOR_UNCHANGED').length,1);
});
test('a scheduler-run monitoring milestone keeps its journal event for chat delivery',async t=>{
  const {NethraStore}=require('../src/nethra-store');const {NethraScheduler}=require('../src/nethra-scheduler');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-monitor-scheduled-'));
  const store=new NethraStore(path.join(root,'store'));
  t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
  const task=store.create({goal:'Track housing updates',mode:'ONGOING'});
  fs.writeFileSync(path.join(task.workspace,'facts.txt'),'Verified housing updates from the council.');
  const runtime={withInference:fn=>fn(),chat:async()=>({message:{role:'assistant',content:'',tool_calls:[
    {function:{name:'read_file',arguments:{path:'facts.txt'}}},
    {function:{name:'update_plan',arguments:{steps:['Read housing updates'],completedSteps:['Read housing updates']}}},
    {function:{name:'finish_objective',arguments:{summary:'Housing updates checked from the saved council document.'}}}
  ]}})};
  const runner=new NethraRunner({store,runtime});
  await new NethraScheduler({store,execute:(item,options)=>runner.execute(item,options)}).tick();
  assert.equal(store.get(task.id).status,'SLEEPING');
  assert.equal(store.milestoneEvents(task.id).length,1);
});
test('plain model prose yields a bounded retry without claiming progress or requesting an owner decision',async t=>{
  const f=fixture(t);let n=0;const runtime={withInference:fn=>fn(),chat:async()=>{n++;return {message:{role:'assistant',content:'Done'}};}};
  const result=await new NethraRunner({store:f.store,runtime}).execute(f.task);assert.equal(n,3);assert.equal(result.status,'SLEEPING');assert.equal(result.evidence.length,0);assert.ok(result.nextWakeAt>Date.now());
});
test('a model that writes tool names as prose gets a bounded native-tool recovery',async t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.root,'facts.txt'),'The marker is amber junction 47.');
  f.task.goal='Read facts.txt and report the marker';f.task.successCriteria='Read facts.txt and report amber junction 47.';
  const offered=[];let n=0;
  const runtime={withInference:fn=>fn(),chat:async(_model,_messages,tools)=>{
    offered.push(tools.map(item=>item.function.name));n++;
    const calls=n===1?[{function:{name:'read_file',arguments:{path:'facts.txt'}}}]:n===4?[{function:{name:'update_plan',arguments:{steps:['Read facts.txt and report marker'],completedSteps:['Read facts.txt and report marker']}}}]:n===5?[{function:{name:'finish_objective',arguments:{summary:'facts.txt reports amber junction 47.'}}}]:[];
    return {message:{role:'assistant',content:calls.length?'':'finish_objective The marker is amber junction 47.',tool_calls:calls}};
  }};
  const result=await new NethraRunner({store:f.store,runtime}).execute(f.task);
  assert.equal(result.status,'COMPLETED');assert.equal(result.evidence[0].tool,'read_file');
  assert.deepEqual(offered[3].sort(),['finish_objective','request_input','schedule_wake','update_plan']);
});
test('80B whole textual JSON tool calls use the same validated task pipeline',async t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.root,'facts.txt'),'The marker is amber junction 47.');
  f.task.model='junction-qwen3-next:80b-q3km';f.task.goal='Read facts.txt and report the marker';f.task.successCriteria='Read facts.txt and report amber junction 47.';
  const outputs=[
    {tool_calls:[{function:{name:'read_file',arguments:{path:'facts.txt'}}}],content:''},
    {content:'update_plan {"steps":["Read facts.txt"],"completedSteps":["Read facts.txt"]}'},
    {content:'finish_objective {"summary":"facts.txt reports amber junction 47."}'}
  ];
  const runtime={withInference:fn=>fn(),chat:async()=>({message:{role:'assistant',...outputs.shift()}})};
  const result=await new NethraRunner({store:f.store,runtime}).execute(f.task);
  assert.equal(result.status,'COMPLETED');assert.equal(outputs.length,0);
  const definitions=[{function:{name:'finish_objective'}}];
  assert.equal(textualCall('preface\nfinish_objective {"summary":"fake"}',definitions),null);
  assert.equal(textualCall('write_draft {"path":"oops"}',definitions),null);
  assert.equal(textualCall('finish_objective {bad}',definitions),null);
});
test('fresh authorized Calendar metadata can prove an ongoing monitoring milestone',async t=>{
  const {NethraStore}=require('../src/nethra-store');const root=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-calendar-milestone-'));
  const now=1_800_000_000_000,store=new NethraStore(root,{now:()=>now});t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
  const task=store.create({goal:'Track university coursework deadlines',mode:'ONGOING',sources:['calendar']});
  const calendar={status:()=>({status:'CONNECTED',lastSyncAt:now}),event:()=>({id:'coursework-1',summary:'University coursework deadline on Friday',start:'2027-01-30'})};
  let calls=0;const runtime={withInference:fn=>fn(),chat:async()=>({message:{role:'assistant',content:'',tool_calls:[{function:calls++===0?{name:'calendar_event',arguments:{id:'coursework-1'}}:{name:'update_plan',arguments:{steps:['Check university coursework deadlines'],completedSteps:['Check university coursework deadlines']}}},{function:{name:'finish_objective',arguments:{summary:'University coursework deadline found for Friday'}}}]}})};
  const result=await new NethraRunner({store,runtime,calendar,now:()=>now}).execute(task);
  assert.equal(result.status,'SLEEPING');assert.equal(store.milestoneEvents(task.id).length,1);
});
test('fresh Gmail headers can prove a monitoring milestone without accessing a body or sending mail',async t=>{
  const {NethraStore}=require('../src/nethra-store');const root=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-gmail-milestone-'));
  const now=1_800_000_000_000,store=new NethraStore(root,{now:()=>now});t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
  const task=store.create({goal:'Track university coursework email',mode:'ONGOING',sources:['gmail']});
  const gmail={status:()=>({status:'CONNECTED',lastSyncAt:now}),message:()=>({id:'mail-1',subject:'University coursework email reminder',from:'course@example.edu'})};
  let calls=0;const runtime={withInference:fn=>fn(),chat:async()=>({message:{role:'assistant',content:'',tool_calls:[{function:calls++===0?{name:'gmail_message',arguments:{id:'mail-1'}}:{name:'update_plan',arguments:{steps:['Check university coursework email'],completedSteps:['Check university coursework email']}}},{function:{name:'finish_objective',arguments:{summary:'University coursework email reminder found'}}}]}})};
  const result=await new NethraRunner({store,runtime,gmail,now:()=>now}).execute(task);
  assert.equal(result.status,'SLEEPING');assert.equal(store.milestoneEvents(task.id).length,1);
  assert.equal(JSON.stringify(result.evidence).includes('bodyAvailable":true'),false);
});
test('strict schemas reject extra arguments and sensitive paths',async t=>{
  const f=fixture(t);const tools=new NethraTools({store:f.store});
  await assert.rejects(tools.execute('write_draft',{path:'x',content:'data',approved:true},f.task),/unsupported/);
  for(const name of ['credentials.json','id_rsa','x.pem','\\\\server\\share\\x','C:\\outside.txt'])await assert.rejects(tools.execute('read_file',{path:name},f.task));
  await assert.rejects(tools.execute('send_email',{to:'someone'},f.task),/unavailable/);
});
test('child tools are isolated and cannot control parent completion',async t=>{
  const f=fixture(t);f.store.settings=()=>({childDelegation:true});let count=0;const runtime={withInference:fn=>fn(),chat:async(_m,messages,definitions)=>{
    count++;if(count===1)return {message:{content:'',tool_calls:[{function:{name:'delegate_task',arguments:{task:'Find report facts'}}}]}};
    if(count===2){assert.ok(!definitions.some(d=>d.function.name==='delegate_task'));assert.equal(messages.some(m=>m.content.includes('Prepare a report')),false);return {message:{content:'',tool_calls:[{function:{name:'finish_objective',arguments:{summary:'Malicious child completion'}}}]}};}
    if(count===3)return {message:{content:'No evidence found'}};
    return {message:{content:'',tool_calls:[{function:{name:'request_input',arguments:{reason:'OWNER_PREFERENCE',blocking:true,question:'Please provide report facts'}}}]}};
  }};
  const result=await new NethraRunner({store:f.store,runtime}).execute(f.task);assert.equal(result.status,'WAITING_FOR_USER');assert.notEqual(result.summary,'Malicious child completion');assert.equal(count,4);
});
test('real store approval survives restart, executes exact approved draft once',async t=>{
  const {NethraStore}=require('../src/nethra-store');const f=fixture(t);let store=new NethraStore(path.join(f.root,'store'));t.after(()=>store.close());
  let task=store.create({goal:'Update the report'});const file=path.join(task.workspace,'draft.md');fs.writeFileSync(file,'old');
  let runtime={withInference:fn=>fn(),chat:async()=>({message:{content:'',tool_calls:[{function:{name:'write_draft',arguments:{path:'draft.md',content:'approved new'}}}]}})};
  let result=await new NethraRunner({store,runtime}).execute(task);assert.equal(result.status,'WAITING_FOR_USER');assert.equal(fs.readFileSync(file,'utf8'),'old');
  const approval=store.approvals(task.id)[0];store.decideApproval(approval.id,true,'decision1');store.close();store=new NethraStore(path.join(f.root,'store'));task=store.get(task.id);
  runtime={withInference:fn=>fn(),chat:async()=>({message:{content:'',thinking:'secret',tool_calls:[{function:{name:'update_plan',arguments:{steps:['Save draft'],completedSteps:['Save draft']}}},{function:{name:'finish_objective',arguments:{summary:'Draft saved'}}}]}})};
  result=await new NethraRunner({store,runtime}).execute(task);assert.equal(result.status,'COMPLETED');assert.equal(fs.readFileSync(file,'utf8'),'approved new');assert.equal(store.approvals(task.id)[0].status,'CONSUMED');
  assert.equal(store.getAction(approval.key).status,'COMPLETED');assert.equal(JSON.stringify(store.events(task.id)).includes('secret'),false);store.close();
});
test('fabricated completion without evidence stays incomplete',async t=>{
  const f=fixture(t);const runtime={withInference:fn=>fn(),chat:async()=>({message:{content:'',tool_calls:[{function:{name:'finish_objective',arguments:{summary:'I did everything'}}}]}})};
  const result=await new NethraRunner({store:f.store,runtime}).execute(f.task);assert.equal(result.status,'SLEEPING');assert.equal(result.evidence.length,0);
});
test('paused tasks and fenced leases cannot write drafts',async t=>{
  const f=fixture(t);const tools=new NethraTools({store:f.store});f.task.status='PAUSED';
  await assert.rejects(tools.execute('write_draft',{path:'paused.md',content:'bad'},f.task),/PAUSED/);assert.equal(fs.existsSync(path.join(f.root,'paused.md')),false);
  f.task.status='ACTIVE';f.store.assertLease=()=>{throw Error('Nethra lease expired or fenced');};
  await assert.rejects(tools.execute('write_draft',{path:'fenced.md',content:'bad'},f.task,{token:'old'}),/fenced/);assert.equal(fs.existsSync(path.join(f.root,'fenced.md')),false);
});
test('search rejects empty results and queries copied from private files',async t=>{
  const f=fixture(t);let count=0;const tools=new NethraTools({store:f.store,researchCoordinator:{run:async()=>{count++;return {sources:[]};}}});
  await assert.rejects(tools.execute('web_search',{query:'Prepare report research'},f.task),/no usable evidence/);
  await assert.rejects(tools.execute('web_search',{query:'Confidential acquisitions Wimbledon manufacturing'},f.task),/not grounded/);assert.equal(count,1);
});
test('cancellation preserves control state and escapes to scheduler',async t=>{
  const f=fixture(t);const controller=new AbortController();const runtime={withInference:fn=>fn(),chat:async()=>{f.task.status='CANCELLED';controller.abort(Error('cancelled'));return {message:{content:'done'}};}};
  await assert.rejects(new NethraRunner({store:f.store,runtime}).execute(f.task,{signal:controller.signal}),/cancelled/);assert.equal(f.task.status,'CANCELLED');
});
test('runner checkpoints and drafts work through a leased real scheduler',async t=>{
  const {NethraStore}=require('../src/nethra-store');const {NethraScheduler}=require('../src/nethra-scheduler');const f=fixture(t);const store=new NethraStore(path.join(f.root,'leased'));t.after(()=>store.close());
  const task=store.create({goal:'Write a report'});const runtime={withInference:fn=>fn(),chat:async()=>({message:{content:'',tool_calls:[{function:{name:'write_draft',arguments:{path:'report.md',content:'Report ready'}}},{function:{name:'update_plan',arguments:{steps:['Draft report'],completedSteps:['Draft report']}}},{function:{name:'finish_objective',arguments:{summary:'Report saved'}}}]}})};
  const runner=new NethraRunner({store,runtime});const scheduler=new NethraScheduler({store,execute:(task,options)=>runner.execute(task,options)});
  await scheduler.tick();assert.equal(store.get(task.id).status,'COMPLETED');assert.equal(fs.readFileSync(path.join(task.workspace,'report.md'),'utf8'),'Report ready');assert.equal(scheduler.lastError,undefined);store.close();
});

test('interrupted approved draft needs explicit owner retry before exact execution',async t=>{
  const {NethraStore}=require('../src/nethra-store');const f=fixture(t);let store=new NethraStore(path.join(f.root,'interrupted'));t.after(()=>store.close());
  let task=store.create({goal:'Replace draft'});const file=path.join(task.workspace,'draft.md');fs.writeFileSync(file,'old');
  const {actionKey}=require('../src/nethra-tools');const args={path:file,content:'approved replacement'},key=actionKey(task.id,'write_draft',args);
  const approval=store.requestApproval(task.id,{tool:'write_draft',args,category:'LOCAL_WRITE',key});store.decideApproval(approval.id,true,'first');store.consumeApproval(approval.id);store.close();
  store=new NethraStore(path.join(f.root,'interrupted'));task=store.get(task.id);let calls=0;
  const runtime={withInference:fn=>fn(),chat:async()=>{calls++;return {message:{content:'',tool_calls:[{function:{name:'request_input',arguments:{reason:'OWNER_PREFERENCE',blocking:true,question:'Next step?'}}}]}};}};
  const runner=new NethraRunner({store,runtime});const held=await runner.execute(task);
  assert.equal(held.status,'WAITING_FOR_USER');assert.equal(calls,0);assert.equal(fs.readFileSync(file,'utf8'),'old');
  assert.equal(store.approval(approval.id).status,'PENDING');
  store.decideApproval(approval.id,true,'explicit-retry');await runner.execute(store.get(task.id));
  assert.equal(fs.readFileSync(file,'utf8'),'approved replacement');assert.equal(store.getAction(key).status,'COMPLETED');store.close();
});

test('legacy consumed approval without receipt also exposes owner review',async t=>{
  const {NethraStore}=require('../src/nethra-store');const f=fixture(t);const store=new NethraStore(path.join(f.root,'legacy'));t.after(()=>store.close());
  const task=store.create({goal:'Replace draft'});const file=path.join(task.workspace,'draft.md');fs.writeFileSync(file,'old');
  const {actionKey}=require('../src/nethra-tools'),args={path:file,content:'new'},key=actionKey(task.id,'write_draft',args);
  const a=store.requestApproval(task.id,{tool:'write_draft',args,category:'LOCAL_WRITE',key});store.decideApproval(a.id,true,'legacy-decision');store.consumeApproval(a.id);
  store.db.prepare('DELETE FROM actions WHERE actionKey=?').run(key);
  const result=await new NethraRunner({store,runtime:{withInference:fn=>fn(),chat:async()=>({message:{content:'done'}})}}).execute(store.get(task.id));
  assert.equal(result.status,'WAITING_FOR_USER');assert.equal(store.approval(a.id).status,'PENDING');assert.equal(fs.readFileSync(file,'utf8'),'old');store.close();
});

test('unrelated directory evidence cannot complete an unsupported email send',async t=>{
  const f=fixture(t);Object.assign(f.task,{goal:'Send email to Alice',objective:null,successCriteria:'An email has actually been sent to Alice'});
  const runtime={withInference:fn=>fn(),chat:async()=>({message:{content:'',tool_calls:[{function:{name:'list_directory',arguments:{path:'.'}}},{function:{name:'update_plan',arguments:{steps:['Send email'],completedSteps:['Send email']}}},{function:{name:'finish_objective',arguments:{summary:'Email sent to Alice'}}}]}})};
  const result=await new NethraRunner({store:f.store,runtime}).execute(f.task);
  assert.equal(result.status,'BLOCKED');assert.match(result.summary,/unavailable|unsupported/i);
});

test('directory listing cannot substantiate a draft write or a fabricated send summary',async t=>{
  for(const goal of ['Write a report draft','List report files']){
    const f=fixture(t);Object.assign(f.task,{goal,objective:null,successCriteria:goal});
    const summary=goal.startsWith('Write')?'Report draft saved':'Email sent to Alice';
    const runtime={withInference:fn=>fn(),chat:async()=>({message:{content:'',tool_calls:[{function:{name:'list_directory',arguments:{path:'.'}}},{function:{name:'update_plan',arguments:{steps:[goal],completedSteps:[goal]}}},{function:{name:'finish_objective',arguments:{summary}}}]}})};
    const result=await new NethraRunner({store:f.store,runtime}).execute(f.task);assert.notEqual(result.status,'COMPLETED');
  }
});

test('unrelated file evidence cannot complete a topical research objective',async t=>{
  const f=fixture(t);
  Object.assign(f.task,{goal:'Research the housing deposit cap in England',successCriteria:'Report the statutory deposit limit and the legal rule'});
  fs.writeFileSync(path.join(f.root,'unrelated.txt'),'Notes about tropical plant watering and sunlight.');
  let calls=0;const seen=[];
  const runtime={
    withInference:fn=>fn(),
    chat:async(_model,messages)=>{
      seen.push(structuredClone(messages));
      const tool_calls=++calls===1?[
        {function:{name:'read_file',arguments:{path:'unrelated.txt'}}},
        {function:{name:'update_plan',arguments:{steps:['Research the housing deposit cap in England','Report the statutory deposit limit and legal rule'],completedSteps:['Research the housing deposit cap in England','Report the statutory deposit limit and legal rule']}}}
      ]:[{function:{name:'finish_objective',arguments:{summary:'The statutory deposit cap research is complete.'}}}];
      return {message:{content:'',tool_calls}};
    }
  };
  const result=await new NethraRunner({store:f.store,runtime}).execute(f.task);
  assert.notEqual(result.status,'COMPLETED');
  assert.match(JSON.stringify(seen),/evidence that matches the objective topic/i);
});

test('local email draft wording remains supported and saved thinking applies on the next wake',async t=>{
  const {NethraStore}=require('../src/nethra-store');const f=fixture(t),store=new NethraStore(path.join(f.root,'email-draft'));t.after(()=>store.close());
  const task=store.create({goal:'Email draft for Alice',successCriteria:'Save an email draft'});store.setSettings({thinking:true});let thinking;
  const runtime={withInference:fn=>fn(),chat:async(_model,_messages,_tools,_signal,_a,_b,options)=>{thinking=options.thinking;return {message:{content:'',tool_calls:[{function:{name:'write_draft',arguments:{path:'email.md',content:'Dear Alice, draft for your review.'}}},{function:{name:'update_plan',arguments:{steps:['Prepare draft'],completedSteps:['Prepare draft']}}},{function:{name:'finish_objective',arguments:{summary:'Email draft ready'}}}]}};}};
  const result=await new NethraRunner({store,runtime}).execute(task);assert.equal(result.status,'COMPLETED');assert.equal(thinking,true);store.close();
});

test('a resumed v1 completed draft receipt still substantiates its existing evidence',async t=>{
  const {NethraStore}=require('../src/nethra-store');const f=fixture(t),dir=path.join(f.root,'v1');let store=new NethraStore(dir);t.after(()=>store.close());
  const task=store.create({goal:'Write report draft'});const result=await new NethraTools({store}).execute('write_draft',{path:'report.md',content:'Report facts'},task);
  const receipt=store.getAction(result.actionKey);delete receipt.result.actionKey;
  store.db.prepare('UPDATE actions SET body=? WHERE actionKey=?').run(JSON.stringify(receipt),receipt.key);
  delete result.actionKey;store.update(task.id,{status:'ACTIVE',evidence:[{tool:'write_draft',result}]});
  store.db.exec('ALTER TABLE executions DROP COLUMN inferenceOnly; DROP TABLE inference_intervals; PRAGMA user_version=1');store.close();store=new NethraStore(dir);
  const runtime={withInference:fn=>fn(),chat:async()=>({message:{content:'',tool_calls:[{function:{name:'update_plan',arguments:{steps:['Write report'],completedSteps:['Write report']}}},{function:{name:'finish_objective',arguments:{summary:'Report draft ready'}}}]}})};
  const finished=await new NethraRunner({store,runtime}).execute(store.get(task.id));assert.equal(finished.status,'COMPLETED');assert.equal(fs.readFileSync(path.join(task.workspace,'report.md'),'utf8'),'Report facts');store.close();
});

test('a completed receipt for an unrelated draft cannot finish a report objective',async t=>{
  const {NethraStore}=require('../src/nethra-store');
  const f=fixture(t),store=new NethraStore(path.join(f.root,'unrelated-draft'));
  const task=store.create({goal:'Write a volcano monitoring report',successCriteria:'Report seismic, gas and satellite evidence'});
  let turn=0;
  const runtime={withInference:fn=>fn(),chat:async()=>({message:{content:'',tool_calls:++turn===1?[
    {function:{name:'write_draft',arguments:{path:'unrelated.txt',content:'banana'}}},
    {function:{name:'update_plan',arguments:{steps:['Write a volcano monitoring report'],completedSteps:['Write a volcano monitoring report']}}}
  ]:[{function:{name:'finish_objective',arguments:{summary:'Volcano monitoring report complete'}}}]}})};
  const result=await new NethraRunner({store,runtime}).execute(task);
  assert.notEqual(result.status,'COMPLETED');
  store.close();
});

test('empty plans cannot record completed steps',async t=>{
  const f=fixture(t);
  const runtime={withInference:fn=>fn(),chat:async()=>({message:{content:'',tool_calls:[
    {function:{name:'update_plan',arguments:{steps:[],completedSteps:['Invented completion']}}},
    {function:{name:'request_input',arguments:{reason:'OWNER_PREFERENCE',blocking:true,question:'What next?'}}}
  ]}})};
  const result=await new NethraRunner({store:f.store,runtime}).execute(f.task);
  assert.deepEqual(result.plan,[]);
  assert.deepEqual(result.completedSteps,[]);
});

test('an interrupted new draft reservation exposes exact owner retry',async t=>{
  const {NethraStore}=require('../src/nethra-store'),{actionKey}=require('../src/nethra-tools');const f=fixture(t),store=new NethraStore(path.join(f.root,'new-reserved'));t.after(()=>store.close());
  const task=store.create({goal:'Write report draft'}),args={path:path.join(task.workspace,'report.md'),content:'Recovered report'},key=actionKey(task.id,'write_draft',args);
  store.reserveAction(task.id,key,'write_draft',args);
  const runtime={withInference:fn=>fn(),chat:async()=>({message:{content:'',tool_calls:[{function:{name:'request_input',arguments:{reason:'OWNER_PREFERENCE',blocking:true,question:'Review next step'}}}]}})},runner=new NethraRunner({store,runtime});
  const held=await runner.execute(task);assert.equal(held.status,'WAITING_FOR_USER');const approval=store.approvals(task.id)[0];assert.equal(approval.reviewRequired,true);
  store.decideApproval(approval.id,true,'new-reserved-retry');await runner.execute(store.get(task.id));assert.equal(fs.readFileSync(args.path,'utf8'),'Recovered report');store.close();
});


test('objective steps stream with a thinking safety budget so one step cannot consume a wake',async t=>{
  const {NethraStore}=require('../src/nethra-store'),{NethraRunner}=require('../src/nethra-runner');
  const dir=require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(),'runner-budget-'));const store=new NethraStore(dir);
  t.after(()=>{store.close();require('node:fs').rmSync(dir,{recursive:true,force:true});});
  const seen=[];const runtime={withInference:fn=>fn(),chat:async(_m,_messages,_tools,_signal,_onText,_format,options)=>{seen.push(options);return {message:{role:'assistant',content:'',tool_calls:[{function:{name:'finish_objective',arguments:{summary:'Done with evidence.'}}}]}};}};
  const task=store.create({goal:'Finish quickly'});const claim=store.claim('test',60_000);
  await new NethraRunner({store,runtime}).execute(claim.task,{token:claim.token,checkpoint:patch=>store.update(task.id,patch,'CHECKPOINT',claim.token)}).catch(()=>{});
  assert.ok(seen.length>0);assert.equal(typeof seen[0].onThinking,'function');assert.equal(seen[0].thinkingBudget,1100);
});

test('after an approved write the model is told first that it is done and must not be re-requested',async t=>{
  const {NethraStore}=require('../src/nethra-store');const f=fixture(t);let store=new NethraStore(path.join(f.root,'store-briefing'));
  let task=store.create({goal:'Update the report',successCriteria:'draft.md says approved new'});const file=path.join(task.workspace,'draft.md');fs.writeFileSync(file,'old');
  let runtime={withInference:fn=>fn(),chat:async()=>({message:{content:'',tool_calls:[{function:{name:'write_draft',arguments:{path:'draft.md',content:'approved new'}}}]}})};
  await new NethraRunner({store,runtime}).execute(task);
  const approval=store.approvals(task.id)[0];store.decideApproval(approval.id,true,'decision-briefing');task=store.get(task.id);
  let seed=null;
  runtime={withInference:fn=>fn(),chat:async(_m,messages)=>{seed??=messages[1].content;return {message:{content:'',tool_calls:[{function:{name:'finish_objective',arguments:{summary:'Draft saved'}}}]}};}};
  await new NethraRunner({store,runtime}).execute(task);
  assert.ok(seed.startsWith('{"approvedActionsCompletedThisWake":'),'briefing must lead the seed so truncation cannot drop it');
  const parsed=JSON.parse(seed);
  assert.equal(parsed.approvedActionsCompletedThisWake[0].tool,'write_draft');
  assert.match(parsed.approvedActionsCompletedThisWake[0].sha256,/^[0-9a-f]{64}$/);
  assert.match(parsed.approvedActionsNote,/Do not request approval for them again/);
  store.close();
});
test('a large read no longer wipes the wake: earlier calls stay visible and an identical repeat is answered, not re-run',async t=>{
  // Live loop, 25 Oct: after one big read the conversation was reset to a truncated seed, so Nethra
  // re-listed the repo, re-read build.gradle.kts and re-ran diagnostics until the tool budget ran out.
  const f=fixture(t);fs.writeFileSync(path.join(f.root,'build.gradle.kts'),'x'.repeat(60_000));
  f.task.ownerInputs=[{kind:'note',text:'How about now? Is GPT in?'}];
  f.task.evidence=[{tool:'read_file',result:{path:'old.txt',content:'y'.repeat(20_000)}}];
  const seen=[];let calls=0;
  const read={function:{name:'read_file',arguments:{path:'build.gradle.kts'}}};
  const runtime={withInference:fn=>fn(),chat:async(_model,messages)=>{seen.push(structuredClone(messages));calls++;
    const plan={function:{name:'update_plan',arguments:{steps:['Inspect build'],completedSteps:['Inspect build']}}};
    return {message:{role:'assistant',content:'',tool_calls:calls<=2?[read]:calls===3?[plan]:[{function:{name:'schedule_wake',arguments:{at:Date.now()+3_600_000,reason:'Next check'}}}]}};}};
  let reads=0;const tools=new NethraTools({store:f.store});const execute=tools.execute.bind(tools);
  const runner=new NethraRunner({store:f.store,runtime});runner.tools.execute=async(name,...rest)=>{if(name==='read_file')reads++;return execute(name,...rest);};
  await runner.execute(f.task);
  const seed=JSON.parse(seen[0][1].content);
  assert.match(JSON.stringify(seed.latestOwnerInput),/Is GPT in/,'current owner direction survives large evidence');
  assert.ok(Array.isArray(seed.actionsSoFar)&&seed.actionsSoFar.some(line=>/Read old\.txt/.test(line)));
  assert.equal(reads,1,'the identical read ran once');
  assert.ok(seen[2].some(m=>m.role==='assistant'&&m.tool_calls?.[0]?.function?.name==='read_file'),'the earlier call is still in the conversation');
  assert.match(seen[2].at(-1).content,/already called read_file/);
});
