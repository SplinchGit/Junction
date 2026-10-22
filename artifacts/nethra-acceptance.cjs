'use strict';
// Scripted integration acceptance. No live model inference, phone, TLS listener,
// Windows process restart, or hardware claims are made by this harness.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
const source=path.resolve(__dirname,'../apps/windows/src');
const {NethraStore}=require(path.join(source,'nethra-store'));
const {NethraRunner}=require(path.join(source,'nethra-runner'));
const {NethraScheduler}=require(path.join(source,'nethra-scheduler'));
const {NethraApi}=require(path.join(source,'nethra-api'));
const {LocalAgentRuntime}=require(path.join(source,'local-agent-runtime'));
const {LanServer,authMessage}=require(path.join(source,'lan-server'));
const {actionKey}=require(path.join(source,'nethra-tools'));

const runLabel=process.argv[2]||'current';if(!/^[a-z-]{1,30}$/.test(runLabel))throw Error('Run label must contain lowercase letters and hyphens only');
const result={kind:'scripted-integration-acceptance',runLabel,simulatedInference:true,liveQwenInference:false,phoneHardware:false,networkListener:false,startedAt:new Date().toISOString(),checks:[],inferenceCalls:[],events:[],sourceHashes:{}};
for(const name of ['nethra-store','nethra-runner','nethra-scheduler','nethra-tools','nethra-api','local-agent-runtime','lan-server'])result.sourceHashes[name]=crypto.createHash('sha256').update(fs.readFileSync(path.join(source,`${name}.js`))).digest('hex');
const check=(name,test,detail)=>{assert.ok(test,name);result.checks.push({name,passed:true,...(detail?{detail}: {})});};
const call=(name,args)=>({function:{name,arguments:args}});
const response=(...calls)=>({message:{role:'assistant',content:'',thinking:'SIMULATED_PRIVATE_THINKING_NOT_FOR_STORAGE',tool_calls:calls}});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,label){const end=Date.now()+10000;while(Date.now()<end){if(predicate())return;await delay(10);}throw Error(`Timed out: ${label}`);}

class ScriptedRuntime extends LocalAgentRuntime{
  constructor(label,steps){super({fetchImpl:async()=>{throw Error('Network inference disabled in scripted acceptance');}});this.label=label;this.steps=steps;this.index=0;}
  async prepareModel(){/* Metadata/model preparation is simulated, like inference. */}
  async modelCapabilities(){return {known:true,thinking:true};}
  async chat(model,messages,definitions,signal,_onText,_format,options){
    signal?.throwIfAborted();assert.equal(model,'qwen3:30b');assert.equal(options.num_ctx,4096);assert.equal(options.thinking,true);
    const step=this.steps[this.index++];assert.ok(step,`Unexpected scripted inference in ${this.label}`);
    const observation={phase:this.label,index:this.index,model,toolNames:definitions.map(d=>d.function.name)};result.inferenceCalls.push(observation);
    return typeof step==='function'?await step({messages,definitions,options}):step;
  }
}
class FixtureSocket extends EventEmitter{
  constructor(){super();this.sent=[];this.readyState=1;}
  send(value){this.sent.push(JSON.parse(value));}
  close(code=1000,reason=''){this.readyState=3;this.emit('close',code,reason);}
}

async function main(){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-acceptance-'));
  let store,scheduler,server,socket,reportTarget=null,reportWrites=0;let clock=Date.UTC(2026,9,20,12,0,0);const now=()=>clock;
  const realRename=fs.renameSync,realLink=fs.linkSync;
  fs.renameSync=function(from,to,...args){if(reportTarget&&path.resolve(to)===reportTarget)reportWrites++;return realRename.call(this,from,to,...args);};
  fs.linkSync=function(from,to,...args){if(reportTarget&&path.resolve(to)===reportTarget)reportWrites++;return realLink.call(this,from,to,...args);};
  try{
    const approvedRoot=path.join(temp,'owner-approved');fs.mkdirSync(approvedRoot);
    const factsFile=path.join(approvedRoot,'facts.txt');fs.writeFileSync(factsFile,'Verified local source: measured sample count is 17.');
    const outside=path.join(temp,'outside.txt');fs.writeFileSync(outside,'Outside scope');
    const directory=path.join(temp,'durable-store');store=new NethraStore(directory,{now});
    let task=store.create({goal:'Read the approved local facts, revisit later, review child evidence and replace the local report draft.',successCriteria:'The workspace report contains the measured sample count 17, supported by the approved source file and reviewed child evidence.',readRoots:[approvedRoot]});
    const id=task.id,reportFile=path.join(task.workspace,'report.md');reportTarget=path.resolve(reportFile);const finalContent='# Sample report\n\nVerified sample count: 17.\n';fs.writeFileSync(reportFile,'Preexisting draft; overwrite requires exact owner approval.');
    const steps=['Read source','Review child evidence','Replace report'];
    const firstRuntime=new ScriptedRuntime('initial-read-and-sleep',[
      response(call('read_file',{path:factsFile}),call('update_plan',{steps,completedSteps:['Read source']}),call('schedule_wake',{at:clock+300000,reason:'Return for the next planned local report review.'}))
    ]);
    let runner=new NethraRunner({store,runtime:firstRuntime,now});scheduler=new NethraScheduler({store,execute:(t,o)=>runner.execute(t,o),now,pollMs:10});
    await scheduler.tick();task=store.get(id);
    check('real scoped source read and durable evidence',task.evidence.some(e=>e.tool==='read_file'&&e.result.content.includes('17')));
    check('plan and completed step persisted',JSON.stringify(task.plan)===JSON.stringify(steps)&&task.completedSteps.includes('Read source'));
    check('explicit future wake persisted',task.status==='SLEEPING'&&task.nextWakeAt===clock+300000,{nextWakeAt:task.nextWakeAt});
    await assert.rejects(runner.tools.execute('read_file',{path:outside},task),/outside approved scope/);
    check('real out-of-scope file read rejected',true);
    await scheduler.stop();store.close();

    store=new NethraStore(directory,{now});task=store.get(id);
    check('first store reopen preserves sleep and evidence',task.status==='SLEEPING'&&task.evidence[0].result.content.includes('17'));
    const wakeRuntime=new ScriptedRuntime('automatic-wake-child-and-approval',[
      response(call('delegate_task',{task:`Read ${factsFile} and report the measured sample count for parent review.`})),
      ({definitions})=>{check('child exposes only bounded read-only capabilities',definitions.every(d=>['web_search','read_file','list_directory'].includes(d.function.name))&&!definitions.some(d=>d.function.name==='delegate_task'));return response(call('read_file',{path:factsFile}));},
      ({messages})=>{check('child receives actual file tool result',messages.some(m=>m.role==='tool'&&m.content.includes('sample count is 17')));return {message:{role:'assistant',content:'Reviewed source: measured sample count is 17. Parent must review this evidence.'}};},
      ({messages})=>{check('parent receives child result for review',JSON.stringify(messages).includes('Parent must review this evidence'));return response(call('write_draft',{path:'report.md',content:finalContent}));}
    ]);
    runner=new NethraRunner({store,runtime:wakeRuntime,now});scheduler=new NethraScheduler({store,execute:(t,o)=>runner.execute(t,o),now,pollMs:10});
    scheduler.start();await delay(40);
    check('polling before due time performs no inference',wakeRuntime.index===0);
    clock=task.nextWakeAt;await until(()=>store.get(id).status==='WAITING_FOR_USER','automatic due-time wake and approval');await scheduler.stop();
    task=store.get(id);const approval=store.approvals(id)[0];
    check('scheduler start/poll automatically wakes due objective',wakeRuntime.index===4&&task.lastExecutionAt===clock);
    check('bounded child evidence persisted',task.evidence.some(e=>e.tool==='delegate_task'&&e.result.requiresParentReview===true&&e.result.evidence.some(o=>o.tool==='read_file')));
    check('preexisting draft remains unchanged while approval pending',fs.readFileSync(reportFile,'utf8').startsWith('Preexisting draft')&&approval.status==='PENDING');
    check('approval binds exact canonical path and content',approval.args.path===reportFile&&approval.args.content===finalContent&&approval.key===actionKey(id,'write_draft',{path:reportFile,content:finalContent}));
    store.close();

    store=new NethraStore(directory,{now});
    check('second reopen preserves pending approval',store.approval(approval.id).status==='PENDING'&&store.get(id).status==='WAITING_FOR_USER');
    const finishRuntime=new ScriptedRuntime('approved-exact-write-and-finish',[
      ()=>{check('approved write executes before resumed model call',fs.readFileSync(reportFile,'utf8')===finalContent&&store.getAction(approval.key).status==='COMPLETED');return response(call('read_file',{path:'report.md'}),call('write_draft',{path:'report.md',content:finalContent}));},
      ({messages})=>{check('completion has verified current report evidence',messages.some(m=>m.role==='tool'&&m.content.includes('Verified sample count: 17')));return response(call('update_plan',{steps,completedSteps:steps}),call('finish_objective',{summary:'The local report now contains verified sample count 17, after parent review of child evidence and exact owner approval.'}));}
    ]);
    runner=new NethraRunner({store,runtime:finishRuntime,now});scheduler=new NethraScheduler({store,execute:(t,o)=>runner.execute(t,o),now,pollMs:10});const api=new NethraApi({store,scheduler,runtime:finishRuntime});

    // Reuse the repository's LAN fixture approach: actual protocol/parser/auth/API,
    // fixture sockets and fixture certificate; no real network/TLS/phone.
    const keys=crypto.generateKeyPairSync('ed25519');const identityStore={getTlsIdentity:()=>({key:'fixture-key',certificate:'fixture-certificate'}),getInstanceMetadata:()=>({instanceId:'acceptance-pc'}),getPairedAndroidKeys:()=>({'acceptance-android':{publicKey:keys.publicKey.export({type:'spki',format:'pem'}),expiresAt:clock+3600000}}),getRevocationState:()=>({})};
    server=new LanServer({identityStore,nethraApi:api,now,bindAddress:'192.168.1.2'});
    const untrusted=new FixtureSocket();server.accept(untrusted);await server.message(untrusted,Buffer.from(JSON.stringify({protocolVersion:1,type:'nethra.list',requestId:'unauth',payload:{}})));
    check('unauthenticated LAN Nethra access rejected',untrusted.readyState===3&&untrusted.sent.some(m=>m.type==='chat.error'));
    socket=new FixtureSocket();server.accept(socket);
    const send=async(type,payload,requestId)=>{const before=socket.sent.length;await server.message(socket,Buffer.from(JSON.stringify({protocolVersion:1,type,requestId,payload})));const messages=socket.sent.slice(before);assert.equal(messages.length,1,`One response for ${type}`);return messages[0];};
    let frame=await send('hello',{deviceId:'acceptance-android',certificateFingerprint:server.certificateFingerprint},'hello');
    const signature=crypto.sign(null,Buffer.from(authMessage(frame.payload.nonce,server.instanceId,'acceptance-android')),keys.privateKey).toString('base64url');
    frame=await send('authenticate',{deviceId:'acceptance-android',signature},'auth');
    check('paired Android fixture authenticates with real Ed25519 proof',frame.type==='authenticated'&&server.connectionState(socket)==='authenticated');
    frame=await send('nethra.create',{goal:'Grant extra PC access',readRoots:[approvedRoot]},'forbidden-scope');
    check('paired Android caller cannot grant PC read roots',frame.type==='chat.error'&&/Windows/.test(frame.payload.message));
    frame=await send('nethra.get',{id},'before-approval');check('authenticated LAN objective detail dispatch works',frame.type==='nethra.get.result'&&frame.payload.approvals[0].status==='PENDING');
    frame=await send('nethra.approve',{id:approval.id,approved:true},'approve-exact');check('approval accepted through authenticated Android LAN dispatch',frame.type==='nethra.approve.result'&&frame.payload.approval.status==='APPROVED');
    const replay=await send('nethra.approve',{id:approval.id,approved:true},'approve-exact');check('authenticated approval retransmission is idempotent',JSON.stringify(replay.payload)===JSON.stringify(frame.payload));

    scheduler.start();await until(()=>store.get(id).status==='COMPLETED','approved write and explicit completion');await scheduler.stop();
    task=store.get(id);const actions=store.db.prepare('SELECT body FROM actions').all().map(row=>JSON.parse(row.body));
    check('objective finishes after verified local report',task.status==='COMPLETED'&&task.pendingSteps.length===0&&fs.readFileSync(reportFile,'utf8')===finalContent);
    check('exact replacement has one completed action receipt',actions.length===1&&actions[0].status==='COMPLETED'&&actions[0].key===approval.key&&actions[0].args.content===finalContent);
    check('repeated exact draft request performs one physical replacement',reportWrites===1,{physicalReplacements:reportWrites});
    check('approved action is consumed exactly once',store.approval(approval.id).status==='CONSUMED');
    const completionCount=finishRuntime.index;await scheduler.tick();check('terminal objective cannot be scheduled again',finishRuntime.index===completionCount);
    frame=await send('nethra.get',{id},'completed-get');check('paired Android fixture sees completed durable outcome',frame.type==='nethra.get.result'&&frame.payload.task.status==='COMPLETED');
    result.events=store.events(id).map(({seq,at,kind,detail})=>({seq,at,kind,detail}));
    check('durable ledger excludes simulated private thinking',!JSON.stringify({task,events:result.events}).includes('SIMULATED_PRIVATE_THINKING_NOT_FOR_STORAGE'));
    result.objective={id,status:task.status,summary:task.summary,wakeAt:clock,approvalStatus:store.approval(approval.id).status,receiptCount:actions.length,evidenceTools:task.evidence.map(e=>e.tool),reportSha256:crypto.createHash('sha256').update(finalContent).digest('hex')};
    result.passed=true;
  }finally{
    fs.renameSync=realRename;fs.linkSync=realLink;socket?.close();if(server)await server.stop();if(scheduler)await scheduler.stop();store?.close();fs.rmSync(temp,{recursive:true,force:true});
  }
}

main().catch(error=>{result.passed=false;result.failure={message:error.message,stack:error.stack};process.exitCode=1;}).finally(()=>{
  result.completedAt=new Date().toISOString();const json=JSON.stringify(result,null,2);fs.writeFileSync(path.join(__dirname,'nethra-acceptance-result.json'),json);fs.writeFileSync(path.join(__dirname,`nethra-acceptance-${runLabel}-result.json`),json);
  const lines=['# Nethra scripted integration acceptance','',`Result: **${result.passed?'PASS':'FAIL'}**. ${result.checks.length} completed checks.`, '', 'Inference is deterministic and simulated. The harness uses the real store, runner, scheduler, tools, API, shared inference queue and LAN protocol/authentication code with real SQLite files, scoped filesystem files and Ed25519 signatures. Network inference is disabled. LAN sockets and certificate are fixtures; no TLS listener, phone hardware, packaged-host launch or live Qwen inference is exercised.', '', 'The clock is injected. After saving a future wake and closing/reopening the store, the harness starts the scheduler and advances that clock to the due timestamp. Polling automatically resumes the objective, runs a bounded read-only child, and requests an exact overwrite approval. After another store reopen, an authenticated Android LAN caller approves the exact content; the scheduler writes it once, verifies it, and completes the objective.', '', 'Run: `node artifacts/nethra-acceptance.cjs`.', '', 'Evidence: [nethra-acceptance-result.json](nethra-acceptance-result.json) contains source hashes, individual checks, scripted inference calls, objective result and durable event sequence. This evidence is separate from live Qwen testing.', '', ...result.checks.map(c=>`- PASS: ${c.name}`)];
  if(result.failure)lines.push('',`Failure: ${result.failure.message}`);
  lines.push('',`Run label: ${runLabel}. Baseline acceptance is preserved separately as nethra-acceptance-baseline-result.json; later repair verification must be assessed against the corresponding source hashes and regression evidence.`);
  fs.writeFileSync(path.join(__dirname,'nethra-acceptance-report.md'),lines.join('\n')+'\n');
  process.stdout.write(JSON.stringify({passed:result.passed,checks:result.checks.length,failure:result.failure?.message,simulatedInference:true})+'\n');
});
