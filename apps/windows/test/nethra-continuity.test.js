'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {NethraStore}=require('../src/nethra-store');
const {LocalDataStore}=require('../src/local-data');
const {DeviceCommandStore}=require('../src/device-commands');
const {NethraApi}=require('../src/nethra-api');
const {NethraRunner}=require('../src/nethra-runner');
const {NethraScheduler}=require('../src/nethra-scheduler');
const {handleOwnerWorkInstruction}=require('../src/owner-work-instruction');
const {postTaskReports,queueOutcomeNotification}=require('../src/nethra-conversation-report');

test('recognized owner continuation uses one task through background execution, notification and original chat',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-continuity-'));
 const store=new NethraStore(dir),local=new LocalDataStore(path.join(dir,'local'));
 const queue=new DeviceCommandStore(dir,{signer:{instanceId:'host',spki:'test',sign:()=> 'test'}});
 t.after(()=>{queue.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});
 local.ensureConversation('business-chat');
 let task=store.create({goal:'Read funding file',conversationId:'business-chat',persistent:true});
 fs.writeFileSync(path.join(task.workspace,'facts.txt'),'Funding file facts for the business plan: eligibility must be checked.');
 task=store.save({...task,status:'COMPLETED'},'PREVIOUS_COMPLETION');
 let modelTurns=0;
 const runtime={withInference:fn=>fn(),chat:async()=>{
  modelTurns++;
  return {message:{role:'assistant',content:'',tool_calls:[
   {function:{name:'read_file',arguments:{path:'facts.txt'}}},
   {function:{name:'update_plan',arguments:{steps:['Read funding file'],completedSteps:['Read funding file']}}},
   {function:{name:'finish_objective',arguments:{summary:'Read the funding file and retained its source evidence.'}}}
  ]}};
 }};
 const runner=new NethraRunner({store,runtime,localData:local});
 const report=current=>{postTaskReports(current,store,local);queueOutcomeNotification(current,store,queue);};
 const scheduler=new NethraScheduler({store,execute:(current,options)=>runner.execute(current,options),onSettled:report});
 const api=new NethraApi({store,localData:local,scheduler,runtime,deviceCommands:queue});
 await api.dispatch('nethra.settings',{notificationDeviceId:'phone',quietHours:{enabled:false,start:'22:00',end:'07:00'}},'select-phone','android');
 // This is the recognized text entering the shared host route, not a microphone/emulator test.
 const ownerTurn={content:'Continue researching that',conversationId:'business-chat',requestId:'spoken-owner-turn',source:'android',api,store,ownerWork:async()=>{throw Error('Continuation escaped into a second task path');}};
 await handleOwnerWorkInstruction(ownerTurn);await handleOwnerWorkInstruction(ownerTurn);
 assert.equal(store.get(task.id).status,'ACTIVE');assert.equal(store.list().length,1);
 await scheduler.tick(); // Runs independently of the phone/call lifetime.
 const completed=store.get(task.id);
 assert.equal(completed.status,'COMPLETED');assert.ok(modelTurns>0);
 assert.ok(completed.evidence.some(item=>item.tool==='read_file'&&item.result.sha256));
 assert.equal(completed.ownerInputs.length,1);assert.equal(completed.conversationId,'business-chat');
 report(completed);assert.equal(queue.list().length,1);
 const delivered=await api.dispatch('nethra.device.pull',{deviceId:'phone'},'phone-pull','android');
 assert.equal(delivered.commands.length,1);
 const body=JSON.parse(delivered.commands[0].body);assert.equal(body.args.taskId,task.id);
 const chat=await api.dispatch('nethra.openChat',{id:body.args.taskId},'open-notification-chat','android');
 assert.equal(chat.conversationId,'business-chat');
 assert.ok(local.conversation('business-chat').messages.some(message=>message.content.startsWith('Done:')));
 await handleOwnerWorkInstruction(ownerTurn);assert.equal(store.get(task.id).status,'COMPLETED');
 assert.equal(store.list().length,1);assert.equal(queue.list().length,1);
});

test('a background task reloads owner project decisions and discards a turn based on a superseded decision',async t=>{
 const {Foreman}=require('../src/foreman');
 const {ForemanApi}=require('../src/foreman-api');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-project-direction-'));
 const store=new NethraStore(dir),foreman=new Foreman(path.join(dir,'projects'),{executor:{inspect:async()=>({})}});
 t.after(()=>{foreman.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});
 let project=await foreman.create({name:'Funding plan',objective:'Check funding',repoPath:'fixture',tasks:[{title:'Review sources',acceptance:'Record source evidence'}]});
 const api=new ForemanApi(foreman);
 const save=async(text,key)=>{({project}=await api.dispatch('project.context',{id:project.id,revision:project.revision,kind:'decision',action:'save',text,...(key?{key}:{})}));};
 await save('Research Scottish grants.');
 const task=store.create({goal:'Review funding eligibility',projectId:project.id}),lease=store.claim('test');
 let turns=0;
 const call=(name,args)=>({message:{role:'assistant',content:'',tool_calls:[{function:{name,arguments:args}}]}});
 const runtime={withInference:fn=>fn(),chat:async(_model,messages)=>{
   const prompt=messages.map(message=>message.content).join('\n');
   if(++turns===1){
     assert.match(prompt,/Research Scottish grants/);
     await save('Research Welsh grants.',project.context.decisions[0].id);
     return call('update_plan',{steps:['Review Scottish grants'],completedSteps:[]});
   }
   assert.match(prompt,/Research Welsh grants/);
   assert.doesNotMatch(prompt,/Research Scottish grants/);
   return call('schedule_wake',{at:Date.now()+600_000,reason:'Resume funding review'});
 }};
 const runner=new NethraRunner({store,runtime,projectById:id=>foreman.get(id)});
 const result=await runner.execute(lease.task,{token:lease.token});
 assert.equal(result.status,'SLEEPING');assert.equal(turns,2);assert.deepEqual(store.get(task.id).plan,[]);
});

test('a task can read only its approved project document revision and cannot send private research to web tools',async t=>{
 const {Foreman}=require('../src/foreman');
 const {NethraTools}=require('../src/nethra-tools');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-document-grant-'));
 const store=new NethraStore(dir),foreman=new Foreman(path.join(dir,'projects'),{executor:{inspect:async()=>({})}});
 t.after(()=>{foreman.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const project=await foreman.create({name:'Funding',objective:'Review eligibility',repoPath:'fixture',tasks:[{title:'Read notes',acceptance:'Check eligibility'}]});
 const source=path.join(dir,'notes.txt');fs.writeFileSync(source,'First revision only.');
 const first=await foreman.importDocument(project.id,'import-first',source);
 fs.writeFileSync(source,'Newer revision only.');await foreman.importDocument(project.id,'import-second',source);
 const readProjectDocument=(...args)=>foreman.getDocument(...args);
 const api=new NethraApi({store,readProjectDocument,listProjectDocuments:id=>foreman.listDocuments(id)});
 const tools=new NethraTools({store,readProjectDocument});
 const task=store.create({goal:'Read project eligibility document',projectId:project.id});
 const payload={id:task.id,revision:task.revision,documentId:first.id,documentRevision:1};
 await assert.rejects(api.dispatch('nethra.projectDocument',payload,'remote-grant','android'),/Windows/);
 const grant=(await api.dispatch('nethra.projectDocument',payload,'grant')).task;
 const detail=await api.dispatch('nethra.get',{id:task.id});
 assert.equal(detail.approvedDocumentStatus[0].status,'NEWER_AVAILABLE');
 assert.equal(detail.approvedDocumentStatus[0].latestRevision,2);
 assert.doesNotMatch(JSON.stringify(detail.approvedDocumentStatus),/Newer revision only/);
 const lease=store.claim('read');
 const read=revision=>tools.execute('read_file',{path:`project-document:${first.id}:${revision}`},lease.task,{token:lease.token});
 await assert.rejects(read(2),/not approved/);
 assert.equal((await read(1)).content,'First revision only.');
 assert.equal((await read(1)).sourceSha256,first.sha256);
 assert.equal(tools.definitions({task:lease.task}).some(tool=>tool.function.name==='web_search'),false);
 await assert.rejects(tools.execute('web_search',{query:'First revision only'},lease.task,{token:lease.token}),/private document task/);
 let turns=0;
 const call=(name,args)=>({message:{role:'assistant',content:'',tool_calls:[{function:{name,arguments:args}}]}});
 const runtime={withInference:fn=>fn(),chat:async(_model,messages)=>{
   const prompt=messages.map(message=>message.content).join('\n');
   if(++turns===1){
     assert.match(prompt,/NEWER_AVAILABLE/);
     assert.match(prompt,new RegExp(`project-document:${first.id}:1`));
     assert.doesNotMatch(prompt,/First revision only|Newer revision only/);
     foreman.removeDocument(project.id,first.id,2,'remove-document');
     return call('update_plan',{steps:['Use removed document'],completedSteps:[]});
   }
   assert.match(prompt,/UNAVAILABLE/);
   assert.doesNotMatch(prompt,/project-document:/);
   return call('schedule_wake',{at:Date.now()+600_000,reason:'Wait for owner document review'});
 }};
 const runner=new NethraRunner({store,runtime,readProjectDocument,listProjectDocuments:id=>foreman.listDocuments(id)});
 await runner.execute(lease.task,{token:lease.token});
 assert.equal(turns,2);assert.deepEqual(store.get(task.id).plan,[]);
 const unavailable=await api.dispatch('nethra.get',{id:task.id});
 assert.equal(unavailable.approvedDocumentStatus[0].status,'UNAVAILABLE');
 await assert.rejects(read(1),/not found/);
 await api.dispatch('nethra.projectDocument',{...payload,revision:store.get(task.id).revision,documentRevision:null},'revoke');
 await assert.rejects(read(1),/not approved/);
 assert.equal(store.get(task.id).privateProjectWork,true);
 assert.equal(grant.projectDocuments[0].revision,1);
});
