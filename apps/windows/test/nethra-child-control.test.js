'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {NethraStore}=require('../src/nethra-store');
const {NethraApi}=require('../src/nethra-api');
const {NethraRunner}=require('../src/nethra-runner');
const {NethraTools}=require('../src/nethra-tools');

function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-child-controls-'));
  const store=new NethraStore(dir);
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  return {store,dir,api:new NethraApi({store,runtime:{}})};
}

test('child delegation requires an owner opt-in and does not grant child writes or recursion',async t=>{
  const {store,api,dir}=fixture(t),task=store.create({goal:'Draft a report'}),lease=store.claim('test');
  const tools=new NethraTools({store});
  assert.equal(store.settings().childDelegation,false);
  assert.ok(!tools.definitions({task}).some(tool=>tool.function.name==='delegate_task'));
  assert.throws(()=>store.startChild(task.id,'Collect evidence','run',lease.token),/disabled/);
  await api.dispatch('nethra.settings',{childDelegation:true},'enable','android');
  const reopened=new NethraStore(dir);try{assert.equal(reopened.settings().childDelegation,true);}finally{reopened.close();}
  assert.ok(tools.definitions({task}).some(tool=>tool.function.name==='delegate_task'));
  assert.deepEqual(new Set(tools.definitions({task,child:true}).map(tool=>tool.function.name)),new Set(['web_search','read_file','list_directory']));
});

for(const action of ['Stop child','Disable delegation','Stop through reopened store'])test(`${action} fences an in-flight child while the parent continues`,{timeout:3000},async t=>{
  const {store,api,dir}=fixture(t);
  store.setSettings({childDelegation:true});
  const parent=store.create({goal:'Review public report facts'}),lease=store.claim('test');
  let opened, lateResponse, observedAbort=false,turn=0;
  const entered=new Promise(resolve=>{opened=resolve;});
  const call=(name,args)=>({message:{role:'assistant',content:'',tool_calls:[{function:{name,arguments:args}}]}});
  const runtime={withInference:fn=>fn(),chat:async(_model,messages,_definitions,signal)=>{
    if(++turn===1)return call('delegate_task',{task:'Find report facts'});
    if(turn===2)return new Promise((resolve,reject)=>{
      signal.addEventListener('abort',()=>{observedAbort=true;reject(signal.reason);},{once:true});
      lateResponse=()=>resolve({message:{role:'assistant',content:'Late child model output'}});
      opened();
    });
    assert.ok(messages.some(message=>message.role==='tool'&&/stopped by the owner/i.test(message.content)));
    return call('schedule_wake',{at:Date.now()+600_000,reason:'Resume report work at the next checkpoint'});
  }};
  const running=new NethraRunner({store,runtime}).execute(lease.task,{token:lease.token});
  await entered;
  const detail=await api.dispatch('nethra.get',{id:parent.id},'detail','android');
  const [child]=detail.children;
  assert.equal(child.status,'ACTIVE');assert.equal(child.scope,'Find report facts');
  assert.equal(child.leaseToken,undefined);
  await assert.rejects(api.dispatch('nethra.child.stop',{id:'different-parent',childId:child.id},'mismatch','android'),/unknown|parent/i);
  if(action==='Stop child'){
    const stopped=await api.dispatch('nethra.child.stop',{id:parent.id,childId:child.id},'stop','android');
    assert.equal(stopped.child.status,'STOPPED');
  }else if(action==='Disable delegation'){
    await api.dispatch('nethra.settings',{childDelegation:false},'disable','android');
    assert.equal(store.settings().childDelegation,false);
  }else{
    const remote=new NethraStore(dir);
    try{remote.stopChild(parent.id,child.id,'remote-stop');}finally{remote.close();}
    lateResponse();
  }
  assert.equal(observedAbort,action!=='Stop through reopened store');
  assert.equal((await running).status,'SLEEPING');assert.equal(turn,3);
  assert.doesNotMatch(JSON.stringify(store.events(parent.id)),/Late child model output/);
  assert.throws(()=>store.finishChild(child.id,{report:'late result',evidence:[],requiresParentReview:true},lease.token),/fenced/);
  assert.equal((await api.dispatch('nethra.child.stop',{id:parent.id,childId:child.id},'stop','android')).child.status,'STOPPED');
  const reopened=new NethraStore(dir);try{assert.equal(reopened.children(parent.id)[0].status,'STOPPED');}finally{reopened.close();}
  assert.equal(store.list().length,1);
});

test('releasing a parent lease interrupts an unfinished child and permits a new pass',t=>{
  const {store}=fixture(t);store.setSettings({childDelegation:true});
  const task=store.create({goal:'Research report facts'}),first=store.claim('first');
  const child=store.startChild(task.id,'First research step','first',first.token);
  store.release(task.id,first.token,false);
  assert.equal(store.children(task.id).find(item=>item.id===child.id).status,'INTERRUPTED');
  const second=store.claim('second');
  assert.equal(store.startChild(task.id,'Second research step','second',second.token).status,'ACTIVE');
});

test('paired task detail keeps the active child and bounds historical child summaries',async t=>{
  const {store,api}=fixture(t);store.setSettings({childDelegation:true});
  const task=store.create({goal:'Research report facts'});
  for(let pass=0;pass<10;pass++){
    const lease=store.claim('worker');
    const child=store.startChild(task.id,`Research pass ${pass}`,lease.token,lease.token);
    store.finishChild(child.id,{report:'é'.repeat(4_000),evidence:[],requiresParentReview:true},lease.token);
    store.release(task.id,lease.token);
  }
  const lease=store.claim('worker');
  const active=store.startChild(task.id,'Current child task',lease.token,lease.token);
  const detail=await api.dispatch('nethra.get',{id:task.id},'bounded-detail','android');
  assert.equal(detail.children[0].id,active.id);
  assert.equal(detail.children[0].status,'ACTIVE');
  assert.equal(detail.children.length,8);
  assert.ok(detail.children.every(child=>child.report.length<=400&&child.leaseToken===undefined));
  assert.ok(Buffer.byteLength(JSON.stringify(detail))<=50_000);
});

test('owner-launched agents are durable task records with their own scope and stop controls',async t=>{
  const {store,dir,api}=fixture(t);
  const parent=store.create({goal:'Funding project',projectId:'funding',model:'junction-qwen3-next:80b-q3km',allowCodeWork:true,readRoots:[dir]});
  const request={id:parent.id,goal:'Draft the funding criteria summary'};
  const {task:agent}=await api.dispatch('nethra.agent.create',request,'launch-agent','android');
  assert.equal(agent.parentId,parent.id);assert.equal(agent.model,parent.model);assert.equal(agent.projectId,parent.projectId);
  assert.equal(agent.persistent,true);assert.equal(agent.allowCodeWork,false);assert.deepEqual(agent.readRoots,[]);
  assert.notEqual(agent.workspace,parent.workspace);
  assert.ok(new NethraTools({store}).definitions({task:agent}).some(tool=>tool.function.name==='write_draft'));
  await assert.rejects(api.dispatch('nethra.agent.create',{id:parent.id,goal:'Another assignment',readRoots:[dir]},'bad-scope','android'),/Invalid agent request/);
  await assert.rejects(api.dispatch('nethra.agent.create',{id:agent.id,goal:'Nested assignment'},'nested-agent','android'),/top-level/);
  assert.equal((await api.dispatch('nethra.agent.create',request,'launch-agent','android')).task.id,agent.id);
  assert.equal((await api.dispatch('nethra.get',{id:parent.id},'agents','android')).agents[0].id,agent.id);
  const reopened=new NethraStore(dir);try{assert.equal(reopened.get(agent.id).parentId,parent.id);}finally{reopened.close();}
  await api.dispatch('nethra.control',{id:agent.id,revision:agent.revision,action:'cancel'},'stop-agent','android');
  assert.equal(store.get(agent.id).status,'CANCELLED');assert.equal(store.get(parent.id).status,'CREATED');
});

test('disabling full task agents fences active work and keeps the parent available',async t=>{
  const {store,dir,api}=fixture(t);
  const parent=store.create({goal:'Parent task',priority:5});
  const request={id:parent.id,goal:'Draft a project section'};
  const {task:agent}=await api.dispatch('nethra.agent.create',request,'launch','android');
  const claim=store.claim('test');
  assert.equal(claim.task.id,agent.id);
  const detail=await api.dispatch('nethra.get',{id:parent.id},'live-agent-detail','android');
  assert.equal(detail.agents[0].live,true);
  assert.equal(detail.agents[0].continuous,true);
  const list=await api.dispatch('nethra.list',{},'live-agent-list','android');
  assert.equal(list.objectives.find(task=>task.id===agent.id).parentId,parent.id);
  await api.dispatch('nethra.settings',{taskAgentsEnabled:false},'disable','android');
  const paused=store.get(agent.id);
  assert.equal(paused.status,'PAUSED');
  assert.equal((await api.dispatch('nethra.get',{id:parent.id},'paused-agent-detail','android')).agents[0].live,false);
  assert.equal(store.renew(agent.id,claim.token),false);
  assert.throws(()=>store.update(agent.id,{status:'COMPLETED'},'EXECUTED',claim.token),/lease/i);
  assert.equal(store.get(parent.id).status,'CREATED');
  assert.equal((await api.dispatch('nethra.agent.create',request,'launch','android')).task.id,agent.id);
  await assert.rejects(api.dispatch('nethra.agent.create',request,'new-launch','android'),/disabled/);
  await assert.rejects(api.dispatch('nethra.control',{id:agent.id,revision:paused.revision,action:'resume'},'resume-disabled','android'),/disabled/);
  const reopened=new NethraStore(dir);
  try{
    assert.equal(reopened.settings().taskAgentsEnabled,false);
    assert.equal(reopened.claim('restart').task.id,parent.id);
  }finally{reopened.close();}
  await api.dispatch('nethra.settings',{taskAgentsEnabled:true},'enable','android');
  assert.equal(store.get(agent.id).status,'PAUSED');
  await api.dispatch('nethra.control',{id:agent.id,revision:paused.revision,action:'resume'},'resume-enabled','android');
  assert.equal(store.get(agent.id).status,'ACTIVE');
});
