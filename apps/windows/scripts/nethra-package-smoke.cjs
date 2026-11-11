'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {NethraStore}=require(path.resolve(__dirname,'../dist/win-unpacked/resources/app.asar/src/nethra-store'));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'junction-p0-package-'));
(async()=>{
let store;
try{
  store=new NethraStore(dir);
  const task=store.create({goal:'Packaged deletion fixture',requestId:'create'});
  store.remove(task.id,'delete');assert.equal(store.list().length,0);store.close();
  store=new NethraStore(dir);assert.equal(store.deletion(task.id).deleted,true);
  assert.throws(()=>store.create({goal:'Packaged deletion fixture',requestId:'create'}),/deleted/i);
  const {DeviceCommandStore}=require(path.resolve(__dirname,'../dist/win-unpacked/resources/app.asar/src/device-commands'));
  const {queueOutcomeNotification,queueMilestoneNotification,queueProjectMilestoneNotifications,notificationDeliveryPolicy}=require(path.resolve(__dirname,'../dist/win-unpacked/resources/app.asar/src/nethra-conversation-report'));
  const queue=new DeviceCommandStore(dir,{signer:{instanceId:'test',spki:'test',sign:()=> 'test'}});
  try {
    const {NethraApi}=require(path.resolve(__dirname,'../dist/win-unpacked/resources/app.asar/src/nethra-api'));
    const {LocalDataStore}=require(path.resolve(__dirname,'../dist/win-unpacked/resources/app.asar/src/local-data'));
    const {ownerQuestion}=require(path.resolve(__dirname,'../dist/win-unpacked/resources/app.asar/src/nethra-task-contract'));
    const api=new NethraApi({store,deviceCommands:queue,localData:new LocalDataStore(path.join(dir,'local'))});
    const parent=store.create({goal:'Packaged research agent fixture'});
    const lease=store.claim('packaged-agent');
    assert.throws(()=>store.startChild(parent.id,'Review a source','packaged',lease.token),/disabled/);
    await api.dispatch('nethra.settings',{childDelegation:true},'enable-agents','android');
    const child=store.startChild(parent.id,'Review a source','packaged',lease.token);
    assert.equal((await api.dispatch('nethra.get',{id:parent.id},'agent-details','android')).children[0].id,child.id);
    await api.dispatch('nethra.settings',{childDelegation:false},'disable-agents','android');
    assert.equal(store.children(parent.id)[0].status,'STOPPED');
    assert.equal(store.liveTaskId(),parent.id);
    const {task:agent}=await api.dispatch('nethra.agent.create',{id:parent.id,goal:'Prepare a separate funding draft'},'launch-task-agent','android');
    assert.equal(agent.parentId,parent.id);
    assert.notEqual(agent.workspace,parent.workspace);
    assert.equal((await api.dispatch('nethra.get',{id:parent.id},'full-agents','android')).agents[0].id,agent.id);
    await api.dispatch('nethra.control',{id:agent.id,revision:agent.revision,action:'cancel'},'stop-full-agent','android');
    assert.equal(store.get(agent.id).status,'CANCELLED');
    assert.equal(store.liveTaskId(),parent.id);
    store.release(parent.id,lease.token);
    store.save({...store.get(parent.id),status:'COMPLETED'},'DONE');
    await api.dispatch('nethra.settings',{notificationDeviceId:'test-phone',quietHours:{enabled:false,start:'22:00',end:'07:00'}},'choose-phone','android');
    let outcome=store.create({goal:'Packaged notification fixture'});
    outcome=store.save({...outcome,status:'COMPLETED'},'EXECUTED',{status:'COMPLETED'});
    const command=queueOutcomeNotification(outcome,store,queue);
    assert.equal(queueOutcomeNotification(outcome,store,queue).id,command.id);
    assert.equal(queue.pull('test-phone',{notificationPolicy:c=>notificationDeliveryPolicy(c,store)}).length,1);
    queue.result('test-phone',{id:command.id,state:'SUCCEEDED',result:{historySaved:true}});
    assert.equal(queue.pull('test-phone').length,0);
    let now=Date.now();store.now=()=>now;queue.now=()=>now;
    const choice=await api.dispatch('nethra.device.result',{deviceId:'test-phone',id:command.id,state:'SUCCEEDED',result:{notificationAction:'SNOOZE'}},'snooze','android');
    assert.equal(choice.ownerAction.action,'SNOOZE');
    assert.equal(queue.pull('test-phone',{notificationPolicy:c=>notificationDeliveryPolicy(c,store)}).length,0);
    now+=3600000;
    const reminder=await api.dispatch('nethra.device.pull',{deviceId:'test-phone'},'pull-reminder','android');
    assert.equal(reminder.commands.length,1);
    assert.equal(JSON.parse(reminder.commands[0].body).id,choice.ownerAction.reminderId);
    await api.dispatch('nethra.device.result',{deviceId:'test-phone',id:choice.ownerAction.reminderId,state:'SUCCEEDED',result:{notificationAction:'DISMISS'}},'dismiss','android');
    let monitor=store.create({goal:'Packaged milestone fixture',mode:'ONGOING'});
    monitor=store.save({...monitor,status:'SLEEPING'},'MILESTONE_VERIFIED');
    monitor=store.save(monitor,'MILESTONE_VERIFIED');
    assert.equal(queueMilestoneNotification(monitor,store,queue),null);
    now+=15*60_000;
    const milestone=queueMilestoneNotification(monitor,store,queue);
    assert.match(milestone.args.body,/2 verified milestones/);
    assert.equal(notificationDeliveryPolicy(milestone,store),'deliver');
    for(const goal of ['Project milestone one','Project milestone two']){
      const task=store.create({goal,projectId:'packaged-project',mode:'ONGOING'});
      store.save({...task,status:'SLEEPING'},'MILESTONE_VERIFIED');
    }
    now+=15*60_000;
    const [group]=queueProjectMilestoneNotifications(store,queue);
    assert.match(group.args.body,/2 verified milestones across 2 tasks/);
    assert.equal(notificationDeliveryPolicy(group,store),'deliver');
    await api.dispatch('nethra.settings',{voiceInvitations:true},'enable-invitations','android');
    const waiting=store.create({goal:'Packaged invitation fixture'});
    const {questions,question}=ownerQuestion(waiting,waiting,{question:'Which country?',reason:'OWNER_PREFERENCE',blocking:true},store.now());
    const invite=queueOutcomeNotification(store.save({...waiting,questions,status:'WAITING_FOR_USER'},'ASKED_OWNER'),store,queue);
    const delivered=await api.dispatch('nethra.device.pull',{deviceId:'test-phone'},'pull-invitation','android');
    assert.ok(delivered.commands.some(item=>JSON.parse(item.body).id===invite.id));
    const accepted=await api.dispatch('nethra.openChat',{id:waiting.id,invitationQuestionId:question.id,invitationCommandId:invite.id,deviceId:'test-phone'},'answer-invitation','android');
    assert.equal(accepted.invitationEventId,invite.args.eventId);
    assert.equal(queue.get(invite.id).ownerAction.action,'ANSWER');
    assert.equal(store.get(waiting.id).questions[0].status,'OPEN');
  } finally {queue.close();}
  const {Foreman}=require(path.resolve(__dirname,'../dist/win-unpacked/resources/app.asar/src/foreman'));
  const {ForemanApi}=require(path.resolve(__dirname,'../dist/win-unpacked/resources/app.asar/src/foreman-api'));
  const projects=new Foreman(path.join(dir,'projects'),{executor:{inspect:async()=>({})}});
  try {
    const project=await projects.create({name:'Packaged project',objective:'Check durable project context',repoPath:'fixture',tasks:[{title:'Review facts',acceptance:'Record the facts'}]});
    const source=path.join(dir,'funding.txt');fs.writeFileSync(source,'Verified funding notes.');
    const api=new ForemanApi(projects,{pickProjectDocument:async()=>source});
    const {document}=await api.dispatch('project.document.import',{id:project.id},'import');
    assert.equal(document.revision,1);
    assert.match((await api.dispatch('project.document.get',{id:project.id,documentId:document.id})).document.content,/Verified funding notes/);
    const {NethraApi}=require(path.resolve(__dirname,'../dist/win-unpacked/resources/app.asar/src/nethra-api'));
    const task=store.create({goal:'Review approved notes',projectId:project.id});
    const taskApi=new NethraApi({store,readProjectDocument:(...args)=>projects.getDocument(...args)});
    const {task:granted}=await taskApi.dispatch('nethra.projectDocument',{id:task.id,revision:task.revision,documentId:document.id,documentRevision:1},'grant');
    assert.equal(granted.projectDocuments[0].sha256,document.sha256);
    assert.equal(granted.privateProjectWork,true);
    assert.doesNotMatch(JSON.stringify(granted),/Verified funding notes/);
    const {textPdf}=require('../test/pdf-fixture.cjs');
    const pdf=path.join(dir,'funding.pdf');fs.writeFileSync(pdf,textPdf('Packaged PDF text'));
    const pdfApi=new ForemanApi(projects,{pickProjectDocument:async()=>pdf});
    const {document:pdfDocument}=await pdfApi.dispatch('project.document.import',{id:project.id},'import-pdf');
    assert.equal(projects.getDocument(project.id,pdfDocument.id).content,'Packaged PDF text');
  } finally {projects.close();}
  console.log(JSON.stringify({passed:true,packagedSqlite:true,deletion:true,restart:true,staleReplayRejected:true,notificationQueue:true,notificationRetryDedup:true,milestoneCoalescing:true,projectMilestoneCoalescing:true,notificationOwnerActions:true,researchAgentControl:true,fullTaskAgentControl:true,projectDocumentImport:true,projectPdfImport:true,projectDocumentGrant:true,voiceInvitationAnswer:true}));
}finally{
  store?.close();
  if(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep))fs.rmSync(dir,{recursive:true,force:true});
}

})().catch(error=>{console.error(error);process.exitCode=1;});
