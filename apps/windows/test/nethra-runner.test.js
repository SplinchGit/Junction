"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { NethraTools } = require('../src/nethra-tools');
const { NethraRunner } = require('../src/nethra-runner');
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
test('runner uses native messages, explicit completion and never persists thinking',async t=>{
  const f=fixture(t);const seen=[];let calls=0;fs.writeFileSync(path.join(f.root,'facts.txt'),'Report facts');
  const runtime={withInference:fn=>fn(),chat:async(model,messages)=>{seen.push(structuredClone(messages));calls++;return {message:{role:'assistant',thinking:'private reasoning',content:'',tool_calls:calls===1?[{function:{name:'read_file',arguments:{path:'facts.txt'}}},{function:{name:'update_plan',arguments:{steps:['Read evidence'],completedSteps:['Read evidence']}}}]:[{function:{name:'finish_objective',arguments:{summary:'Report ready'}}}]}};}};
  const result=await new NethraRunner({store:f.store,runtime}).execute(f.task);
  assert.equal(result.status,'COMPLETED');assert.equal(result.summary,'Report ready');assert.equal(seen[1].at(-1).role,'tool');
  assert.equal(JSON.stringify(f.task).includes('private reasoning'),false);
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
test('plain model prose cannot complete objective and loop is bounded',async t=>{
  const f=fixture(t);let n=0;const runtime={withInference:fn=>fn(),chat:async()=>{n++;return {message:{role:'assistant',content:'Done'}};}};
  const result=await new NethraRunner({store:f.store,runtime}).execute(f.task);assert.equal(n,12);assert.notEqual(result.status,'COMPLETED');
});
test('strict schemas reject extra arguments and sensitive paths',async t=>{
  const f=fixture(t);const tools=new NethraTools({store:f.store});
  await assert.rejects(tools.execute('write_draft',{path:'x',content:'data',approved:true},f.task),/unsupported/);
  for(const name of ['credentials.json','id_rsa','x.pem','\\\\server\\share\\x','C:\\outside.txt'])await assert.rejects(tools.execute('read_file',{path:name},f.task));
  await assert.rejects(tools.execute('send_email',{to:'someone'},f.task),/unavailable/);
});
test('child tools are isolated and cannot control parent completion',async t=>{
  const f=fixture(t);let count=0;const runtime={withInference:fn=>fn(),chat:async(_m,messages,definitions)=>{
    count++;if(count===1)return {message:{content:'',tool_calls:[{function:{name:'delegate_task',arguments:{task:'Find report facts'}}}]}};
    if(count===2){assert.ok(!definitions.some(d=>d.function.name==='delegate_task'));assert.equal(messages.some(m=>m.content.includes('Prepare a report')),false);return {message:{content:'',tool_calls:[{function:{name:'finish_objective',arguments:{summary:'Malicious child completion'}}}]}};}
    if(count===3)return {message:{content:'No evidence found'}};
    return {message:{content:'',tool_calls:[{function:{name:'request_input',arguments:{question:'Please provide report facts'}}}]}};
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
  const runtime={withInference:fn=>fn(),chat:async()=>{calls++;return {message:{content:'',tool_calls:[{function:{name:'request_input',arguments:{question:'Next step?'}}}]}};}};
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
    {function:{name:'request_input',arguments:{question:'What next?'}}}
  ]}})};
  const result=await new NethraRunner({store:f.store,runtime}).execute(f.task);
  assert.deepEqual(result.plan,[]);
  assert.deepEqual(result.completedSteps,[]);
});

test('an interrupted new draft reservation exposes exact owner retry',async t=>{
  const {NethraStore}=require('../src/nethra-store'),{actionKey}=require('../src/nethra-tools');const f=fixture(t),store=new NethraStore(path.join(f.root,'new-reserved'));t.after(()=>store.close());
  const task=store.create({goal:'Write report draft'}),args={path:path.join(task.workspace,'report.md'),content:'Recovered report'},key=actionKey(task.id,'write_draft',args);
  store.reserveAction(task.id,key,'write_draft',args);
  const runtime={withInference:fn=>fn(),chat:async()=>({message:{content:'',tool_calls:[{function:{name:'request_input',arguments:{question:'Review next step'}}}]}})},runner=new NethraRunner({store,runtime});
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
