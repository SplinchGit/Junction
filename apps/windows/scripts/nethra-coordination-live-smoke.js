"use strict";
// Explicitly invoked integration proof for Self Improvement coordination:
// consultation -> owner decision -> draft review -> Start -> Pause/Resume -> engineering -> verification -> notification.
// Uses the owner's signed-in Codex and Claude once each on a throwaway repository; never touches Junction's checkout.
// `--rehearsal` replaces the providers with fixtures to check this script's own plumbing. A rehearsal is not evidence.
// Every stage is reported as PASSED, UNAVAILABLE (a real service could not run; never counted as a pass) or FAILED.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync,spawnSync}=require('node:child_process');
const {NethraStore}=require('../src/nethra-store');
const {NethraApi}=require('../src/nethra-api');
const {NethraRunner}=require('../src/nethra-runner');
const {NethraScheduler}=require('../src/nethra-scheduler');
const {AdvisorLimits}=require('../src/advisor-limits');
const {DeviceCommandStore}=require('../src/device-commands');
const {Foreman}=require('../src/foreman');
const {ForemanExecutor}=require('../src/foreman-executor');
const {createCodeWorkProposer}=require('../src/nethra-code-work');
const {createWorkStatus,reconcileCodeWork}=require('../src/nethra-work-status');
const {allowsCoordinationWork}=require('../src/nethra-coordination');
const {queueCodeWorkNotification,notificationDeliveryPolicy}=require('../src/nethra-conversation-report');

const rehearsal=process.argv.includes('--rehearsal');
const output=process.argv.find(arg=>arg.startsWith('--out='))?.slice(6);
const report={at:new Date().toISOString(),mode:rehearsal?'REHEARSAL (fixture providers; not evidence)':'LIVE',stages:[]};
const stage=(name,result,detail={})=>{report.stages.push({name,result,...detail});console.log(JSON.stringify({stage:name,result,...detail}));};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(check,timeoutMs,label)=>{const end=Date.now()+timeoutMs;for(;;){const value=await check();if(value)return value;if(Date.now()>end)throw new Error(`Timed out waiting for ${label}`);await wait(250);}};
const BRIEF='GPT brief: This is a bounded integration check. In apps/windows/answer.js the exported function adds one; it must add two. Propose exactly that single-file change to apps/windows/answer.js as the improvement, with the test being that answer(3) equals 5 and the existing npm test passes unchanged.';

(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-coordination-live-')),repo=path.join(root,'Junction'),app=path.join(repo,'apps','windows');
 report.root=root;
 fs.mkdirSync(path.join(app,'test'),{recursive:true});
 fs.writeFileSync(path.join(app,'answer.js'),'module.exports = n => n + 1;\n');
 fs.writeFileSync(path.join(app,'test','answer.test.js'),"const assert=require('node:assert/strict');assert.equal(require('../answer')(3),5);console.log('answer ok');\n");
 fs.writeFileSync(path.join(app,'package.json'),JSON.stringify({name:'coordination-fixture',private:true,scripts:{test:'node test/answer.test.js'}},null,1)+'\n');
 const git=(...args)=>execFileSync('git',['-C',repo,...args],{windowsHide:true,encoding:'utf8'}).trim();
 git('init','-b','main');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','-m','Fixture baseline');
 const head=git('rev-parse','HEAD'),lock=path.join(repo,'.git','nethra-writer.lock'),source=()=>fs.readFileSync(path.join(app,'answer.js'),'utf8');

 let nethraStore,foreman,deviceCommands,scheduler,api,executor;
 const open=()=>{
  nethraStore=new NethraStore(path.join(root,'nethra'));
  deviceCommands=new DeviceCommandStore(path.join(root,'nethra'),{signer:{instanceId:'smoke',spki:'smoke',sign:()=>'smoke'}});
  executor=new ForemanExecutor(path.join(root,'foreman','projects'),{mayWrite:project=>Boolean(foreman?.mayDispatch(project))});
  // Same linkage as main.js: engineering may run only while its Nethra task still authorizes it.
  foreman=new Foreman(path.join(root,'foreman'),{executor,mayDispatch:project=>{
   if(!project.sourceObjectiveId)return true;
   if(nethraStore.deletion(project.sourceObjectiveId))return false;
   return allowsCoordinationWork(nethraStore.get(project.sourceObjectiveId),project);
  }});
  const advisorLimits=new AdvisorLimits({store:nethraStore});executor.advisorLimits=advisorLimits;
  const runner=new NethraRunner({store:nethraStore,runtime:{},proposeCodeWork:createCodeWorkProposer({foreman,junctionRepository:repo,assertObjective:id=>nethraStore.get(id)}),workStatus:createWorkStatus(foreman),advisorLimits,projectById:id=>foreman.find(id)});
  if(rehearsal){
   const advice='Friction: answer.js adds one.\nImprovement: Change apps/windows/answer.js so the exported function adds two.\nTest: Verify answer(3) equals 5 and the existing npm test passes unchanged.';
   const gate={available:true,detail:'fixture'};
   Object.assign(advisorLimits,{check:async()=>gate,snapshot:async()=>({checkedAt:Date.now(),windows:[]}),invalidate(){},recordClaude(){}});
   Object.assign(runner.tools,{codexStatus:async()=>({ready:true}),claudeStatus:async()=>({ready:true}),
    codexConsult:async({messages})=>({content:/VERDICT/.test(messages[0].content)?'VERDICT: READY. Fixture review.':advice,model:'fixture-codex'}),
    claudeConsult:async()=>({content:advice,model:'fixture-claude'})});
   let turn=0;
   executor.server={start:async()=>{},stop:async()=>{},readRateLimits:async()=>({rateLimits:{primary:{usedPercent:1,resetsAt:Math.floor(Date.now()/1000)+3600}}}),
    request:async(method)=>method==='account/read'?{account:{type:'chatgpt'}}:{thread:{turns:[]}},
    run:async({signal,onTurnStarted})=>{const id=`fixture-${++turn}`;onTurnStarted({threadId:id,turnId:id,dispatchPending:false});await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,1500);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('Paused'));},{once:true});});
     return {threadId:id,turnId:id,text:'diff --git a/answer.js b/answer.js\n--- a/answer.js\n+++ b/answer.js\n@@ -1 +1 @@\n-module.exports = n => n + 1;\n+module.exports = n => n + 2;\n'};}};
   executor.command=async(cwd,command)=>{const r=spawnSync(command[0],command.slice(1),{cwd,encoding:'utf8',shell:process.platform==='win32'});return {exitCode:r.status,stdout:r.stdout||'',stderr:r.stderr||''};};
  }
  scheduler=new NethraScheduler({store:nethraStore,execute:(task,options)=>runner.execute(task,options),reconcileWork:async()=>reconcileCodeWork({store:nethraStore,projects:foreman.list()})});
  api=new NethraApi({store:nethraStore,scheduler,runtime:{},deviceCommands,listProjects:()=>foreman.list(),onCoordinationControl:async(task,action)=>{
   for(const project of foreman.list().filter(item=>item.sourceObjectiveId===task.id)){
    if(action==='resume'){if(project.status==='PAUSED'&&project.pausedByObjective===task.id&&foreman.mayDispatch(project))await foreman.control(project.id,'resume',project.revision,`coordination-resume-${task.id}-${project.id}-${task.revision}`);}
    else if(foreman.enabled.has(project.id))await foreman.control(project.id,action==='cancel'?'stop':'pause',project.revision,`coordination-${task.id}-${project.id}-${task.revision}`,{sourceObjectiveId:task.id});
   }
  }});
 };
 const close=async()=>{await scheduler?.stop?.();await foreman?.shutdown();foreman?.close();deviceCommands?.close();nethraStore?.close();};
 let request=0;const owner=(type,payload)=>api.dispatch(type,payload,`smoke-${++request}`,'desktop');
 const cycle=async()=>{await scheduler.run();};
 open();
 try{
  // 1. Owner creates the task, saves a brief and enables coordination through the desktop API.
  let {task}=await owner('nethra.create',{goal:'Self Improvement',persistent:true,allowCodeWork:true,readRoots:[repo],conversationId:'coordination-smoke'});
  await owner('nethra.message',{id:task.id,text:BRIEF,noteOnly:true});
  task=nethraStore.get(task.id);
  ({task}=await owner('nethra.configure',{id:task.id,revision:task.revision,coordinateSelfImprovement:true}));
  const id=task.id;

  // 2. Independent consultation with both signed-in advisors through the scheduler.
  await cycle();task=nethraStore.get(id);
  const advisors=Object.fromEntries(Object.entries(task.coordination?.advisors||{}).map(([name,value])=>[name,{status:value.status,model:value.model||null,reason:value.reason||null,retryAt:value.retryAt?new Date(value.retryAt).toISOString():null,advice:value.advice||null}]));
  const missing=['codex','claude'].filter(name=>advisors[name]?.status!=='completed');
  if(missing.length){
   stage('consultation','UNAVAILABLE',{advisors,taskStatus:task.status,nextWakeAt:task.nextWakeAt?new Date(task.nextWakeAt).toISOString():null,summary:task.summary});
   for(const name of ['owner decision','draft review','engineering','pause and resume','verification','notification','restart'])stage(name,'NOT RUN',{reason:`Waiting for ${missing.join(' and ')} consultation`});
   return;
  }
  assert.equal(task.status,'WAITING_FOR_USER');assert.equal(task.coordination.stage,'decision');
  assert.match(task.coordination.brief,/bounded integration check/);
  stage('consultation','PASSED',{advisors,brief:task.coordination.brief});

  // 3. Owner decision through the existing owner-question path.
  const question=task.questions.find(q=>q.id===task.coordination.questionId);
  const choice=/Reply “approve pilot”/.test(question.question)?'approve pilot':/approve codex pilot/.test(question.question)?'approve codex pilot':/approve claude pilot/.test(question.question)?'approve claude pilot':null;
  if(!choice){stage('owner decision','FAILED',{question:question.question});return;}
  await owner('nethra.message',{id,text:choice,questionId:question.id});
  stage('owner decision','PASSED',{question:question.question,answer:choice});

  // 4. Draft: Codex READY review, then a Foreman draft that waits for Start.
  await cycle();task=nethraStore.get(id);
  if(task.coordination.stage!=='tracking'){
   const unavailable=task.status==='SLEEPING';
   stage('draft review',unavailable?'UNAVAILABLE':'FAILED',{stage:task.coordination.stage,taskStatus:task.status,summary:task.summary,nextWakeAt:task.nextWakeAt?new Date(task.nextWakeAt).toISOString():null});
   for(const name of ['engineering','pause and resume','verification','notification','restart'])stage(name,'NOT RUN',{reason:'No approved draft'});
   return;
  }
  let project=foreman.get(task.coordination.workId);
  assert.equal(project.status,'DRAFT');assert.equal(project.sharedCheckout,true);assert.equal(project.codeReviewVerdict,'READY');assert.equal(source(),'module.exports = n => n + 1;\n');
  stage('draft review','PASSED',{workId:project.id,task:project.tasks[0].title,acceptance:project.tasks[0].acceptance,selected:task.coordination.selected});

  // 5. Owner Start with provider handoff, then Pause while the provider turn is in flight.
  await foreman.control(project.id,'start',project.revision,'smoke-start',{autoHandoff:true});
  const dispatched=await until(()=>{const p=foreman.get(project.id),a=p.tasks[0].attempts.at(-1);return (a?.provider&&a.threadId)||!foreman.enabled.has(p.id)?p:null;},180000,'provider dispatch');
  const firstAttempt=dispatched.tasks[0].attempts.at(-1);
  if(!foreman.enabled.has(project.id)||dispatched.status!=='RUNNING'){
   const capacity=['WAITING_CAPACITY','WAITING_CODEX'].includes(dispatched.status);
   stage('engineering',capacity?'UNAVAILABLE':'FAILED',{status:dispatched.status,nextAction:dispatched.nextAction,retryAt:dispatched.retryAt?new Date(dispatched.retryAt).toISOString():null,error:firstAttempt?.error||null,capacity:firstAttempt?.capacity||null});
   for(const name of ['pause and resume','verification','notification','restart'])stage(name,'NOT RUN',{reason:'Engineering did not start'});
   return;
  }
  const lockDuringTurn=fs.existsSync(lock);
  task=nethraStore.get(id);await owner('nethra.control',{id,action:'pause',revision:task.revision});
  await foreman.idle();project=foreman.get(project.id);
  const paused={status:project.status,pausedByObjective:project.pausedByObjective===id,lockDuringTurn,lockAfterPause:fs.existsSync(lock),sourceUnchanged:source()==='module.exports = n => n + 1;\n',attempt:project.tasks[0].attempts.at(-1).status,timers:foreman.timers.size};
  await wait(3000);paused.sourceUnchangedLater=source()==='module.exports = n => n + 1;\n';paused.dispatchesWhilePaused=foreman.get(project.id).tasks[0].attempts.length-1;
  const pauseOk=paused.status==='PAUSED'&&paused.pausedByObjective&&paused.lockDuringTurn&&!paused.lockAfterPause&&paused.sourceUnchanged&&paused.sourceUnchangedLater&&paused.dispatchesWhilePaused===0&&paused.timers===0;
  task=nethraStore.get(id);await owner('nethra.control',{id,action:'resume',revision:task.revision});
  paused.resumedSameWork=foreman.enabled.has(project.id)&&foreman.get(project.id).status==='RUNNING';
  stage('pause and resume',pauseOk&&paused.resumedSameWork?'PASSED':'FAILED',paused);

  // 6. Engineering and fixed verification on the shared main checkout.
  project=await until(()=>{const p=foreman.get(project.id);return !foreman.enabled.has(p.id)||['WAITING_CAPACITY','WAITING_CODEX'].includes(p.status)?p:null;},900000,'engineering result');
  const attempts=project.tasks[0].attempts.map(a=>({status:a.status,provider:a.provider||null,phase:a.phase||null,error:a.error?.slice(0,400)||null,tests:a.tests?.map(t=>({command:t.command,exitCode:t.exitCode}))||null,capacity:a.capacity||null}));
  const engineering={status:project.status,nextAction:project.nextAction,attempts,branch:git('branch','--show-current'),headUnchanged:git('rev-parse','HEAD')===head,source:source(),lockReleased:!fs.existsSync(lock),sameWork:project.tasks.length===1};
  if(project.status!=='COMPLETED'){
   const capacity=['WAITING_CAPACITY','WAITING_CODEX'].includes(project.status);
   stage('engineering',capacity?'UNAVAILABLE':'FAILED',{...engineering,retryAt:project.retryAt?new Date(project.retryAt).toISOString():null,blocker:project.handoff});
   for(const name of ['verification','notification','restart'])stage(name,'NOT RUN',{reason:'Engineering did not complete'});
   return;
  }
  const final=project.tasks[0].attempts.at(-1);
  const engineeringOk=engineering.source==='module.exports = n => n + 2;\n'&&engineering.branch==='main'&&engineering.headUnchanged&&engineering.lockReleased&&engineering.sameWork;
  stage('engineering',engineeringOk?'PASSED':'FAILED',engineering);
  const verificationOk=final.tests?.length>0&&final.tests.every(t=>t.exitCode===0)&&Boolean(project.verifiedSha)&&project.sharedSourceHash===await executor.sourceHash(project.repoPath,false,project.scopeKind);
  stage('verification',verificationOk?'PASSED':'FAILED',{tests:final.tests?.map(t=>({command:t.command,exitCode:t.exitCode,output:String(t.output||'').trim().slice(-200)})),checkpoint:project.verifiedSha,claudeHandoff:attempts.some(a=>a.provider==='claude')?'exercised':'not exercised: Codex stayed below 95% usage, so no live handoff was due'});

  // 7. Tasks views and the notification pipeline.
  scheduler.lastAttentionSweep=0;await cycle();task=nethraStore.get(id);
  const desktop=(await owner('nethra.get',{id})).codeWork[0];
  const phone=(await api.dispatch('nethra.get',{id},`smoke-${++request}`,'android'));
  assert.equal(desktop.status,'COMPLETED');assert.match(desktop.lastVerified.summary,/verification commands passed/);assert.deepEqual(phone.codeWork[0],desktop);
  nethraStore.setSettings({notificationDeviceId:'smoke-unpaired-phone',quietHours:{enabled:false,start:'22:00',end:'07:00'}});
  project=foreman.get(project.id);project.updatedAt=Math.max(project.updatedAt,nethraStore.settings().notificationDeviceSince||0);
  const command=queueCodeWorkNotification(nethraStore.get(id),project,nethraStore,deviceCommands);
  const again=queueCodeWorkNotification(nethraStore.get(id),project,nethraStore,deviceCommands);
  const delivery=command?notificationDeliveryPolicy(command,nethraStore,{projects:()=>[project]}):null;
  stage('notification',command&&again.id===command.id&&delivery==='deliver'?'PASSED':'FAILED',{queued:Boolean(command),deduplicated:again?.id===command?.id,policy:delivery,body:command?.args?.body,taskSummary:task.summary,tasksView:desktop,phoneDelivery:'UNAVAILABLE: no paired phone is attached to this run; only the queued command and delivery policy were checked'});

  // 8. Restart keeps the record and dispatches nothing.
  await close();open();
  project=foreman.get(project.id);task=nethraStore.get(id);
  const restart={work:project.status,provider:project.tasks[0].attempts.at(-1).provider,tests:project.tasks[0].attempts.at(-1).tests?.length||0,nextAction:project.nextAction,coordinationStage:task.coordination.stage,workId:task.coordination.workId===project.id,dispatching:foreman.enabled.size,source:source()};
  stage('restart',restart.work==='COMPLETED'&&restart.tests>0&&restart.coordinationStage==='tracking'&&restart.workId&&restart.dispatching===0&&restart.source==='module.exports = n => n + 2;\n'?'PASSED':'FAILED',restart);
 }finally{
  await close().catch(error=>console.error(error.message));
  report.passed=report.stages.length>0&&report.stages.every(item=>item.result==='PASSED');
  report.unavailable=report.stages.filter(item=>item.result==='UNAVAILABLE').map(item=>item.name);
  if(output)fs.writeFileSync(output,JSON.stringify(report,null,1)+'\n');
  console.log(JSON.stringify({mode:report.mode,passed:report.passed,unavailable:report.unavailable,failed:report.stages.filter(item=>item.result==='FAILED').map(item=>item.name),root}));
  // 0 = every stage passed; 2 = a real service was unavailable; 1 = a failure.
  process.exitCode=report.passed?0:report.stages.some(item=>item.result==='FAILED')?1:2;
 }
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
