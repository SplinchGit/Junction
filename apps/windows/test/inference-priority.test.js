'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {InferenceCoordinator,MAX_PREEMPTIONS}=require('../src/local-agent-runtime');
const {NethraStore}=require('../src/nethra-store');
const {NethraRunner}=require('../src/nethra-runner');

const tick=()=>new Promise(resolve=>setImmediate(resolve));
// A background step that runs until it finishes or its yield signal fires.
function backgroundStep(log,label){
  let finish;const done=new Promise(resolve=>finish=resolve);
  return {finish,callback:yielded=>new Promise((resolve,reject)=>{let stopped=false;log.push(`${label}:start`);yielded.addEventListener('abort',()=>{stopped=true;log.push(`${label}:yielded`);reject(yielded.reason);},{once:true});done.then(()=>{if(stopped)return;log.push(`${label}:done`);resolve(label);});})};
}

test('an owner message preempts a generating background step, which then resumes',async()=>{
  const queue=new InferenceCoordinator(),log=[];const step=backgroundStep(log,'objective');
  const background=queue.run(step.callback,null,{priority:'background',preemptible:true});
  await tick();
  const chat=queue.run(async()=>{log.push('chat');return 'answer';},null,{priority:'interactive'});
  assert.equal(await chat,'answer');
  await tick();step.finish();
  assert.equal(await background,'objective','the caller sees one result, not the preemption');
  assert.deepEqual(log,['objective:start','objective:yielded','chat','objective:start','objective:done']);
});

test('preemption is bounded so background work cannot starve',async()=>{
  const queue=new InferenceCoordinator(),log=[];const step=backgroundStep(log,'objective');
  const background=queue.run(step.callback,null,{priority:'background',preemptible:true});
  for(let index=0;index<MAX_PREEMPTIONS;index++){await tick();await queue.run(async()=>{log.push(`chat${index}`);},null,{priority:'interactive'});await tick();}
  // Out of preemptions: the next owner message waits for the step to finish.
  const last=queue.run(async()=>{log.push('chat-last');},null,{priority:'interactive'});
  await tick();assert.equal(log.at(-1),'objective:start');
  step.finish();await background;await last;
  assert.equal(log.filter(entry=>entry.endsWith(':yielded')).length,MAX_PREEMPTIONS);
  assert.deepEqual(log.slice(-2),['objective:done','chat-last']);
});

test('non-preemptible background work (World, warm-up) is never interrupted',async()=>{
  const queue=new InferenceCoordinator(),log=[];let release;
  const background=queue.run(yielded=>new Promise(resolve=>{yielded.addEventListener('abort',()=>log.push('yielded'));release=resolve;}),null,{priority:'background'});
  await tick();const chat=queue.run(async()=>log.push('chat'),null,{priority:'interactive'});
  await tick();assert.deepEqual(log,[]);release();await background;await chat;assert.deepEqual(log,['chat']);
});

test('an objective holds the model slot only during model calls, not during tool work',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-slot-'));
  const store=new NethraStore(dir);t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const task=store.create({goal:'Research housing policy changes'});
  const queue=new InferenceCoordinator();let releaseSearch,searchStarted;const started=new Promise(resolve=>searchStarted=resolve);
  let turn=0;
  const runtime={withInference:(fn,signal,options)=>queue.run(fn,signal,options),chat:async()=>({message:{role:'assistant',content:'',tool_calls:[turn++===0?{function:{name:'web_search',arguments:{query:'housing policy changes'}}}:{function:{name:'request_input',arguments:{question:'Which region?'}}}]}})};
  const research={run:()=>{searchStarted();return new Promise(resolve=>releaseSearch=()=>resolve({query:'housing policy changes',sources:[{id:'S1',title:'Housing',url:'https://example.gov',passages:[{id:'S1.p1',text:'housing policy changes',score:1}]}]}));}};
  const runner=new NethraRunner({store,runtime,researchCoordinator:research});
  const execution=runner.execute(store.get(task.id));
  await started;
  // While the objective waits on the web, an owner chat gets the model immediately.
  let chatRan=false;await queue.run(async()=>{chatRan=true;},null,{priority:'interactive'});
  assert.equal(chatRan,true);
  releaseSearch();await execution;
  assert.equal(store.get(task.id).status,'WAITING_FOR_USER');
});
