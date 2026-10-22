'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {NethraStore}=require('../src/nethra-store');const {NethraScheduler,clampWake}=require('../src/nethra-scheduler');
function fixture(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-scheduler-'));let time=1000000;const store=new NethraStore(directory,{now:()=>time});t.after(()=>{store.close();fs.rmSync(directory,{recursive:true,force:true});});return {store,now:()=>time,advance:n=>time+=n};}
test('successful runs persist checkpoints and sleeping tasks use no further executions before wake',async t=>{const f=fixture(t),a=f.store.create({goal:'Check later'});let runs=0;const scheduler=new NethraScheduler({...f,execute:async(task,{checkpoint,inference})=>{runs++;checkpoint({evidence:['source']});await inference(async()=>f.advance(5000));return {status:'SLEEPING',nextWakeAt:f.now()+1};}});await scheduler.tick();const task=f.store.get(a.id);assert.equal(task.nextWakeAt,1305000);assert.deepEqual(task.evidence,['source']);assert.equal(task.budget.totalMs,5000);await scheduler.tick();assert.equal(runs,1);});
test('concurrent schedulers cannot execute two objectives',async t=>{const f=fixture(t);f.store.create({goal:'One'});f.store.create({goal:'Two'});let finish,started;const ready=new Promise(r=>started=r);let runs=0;const execute=()=>{runs++;started();return new Promise(r=>finish=r);};const a=new NethraScheduler({...f,execute}),b=new NethraScheduler({...f,execute});const run=a.tick();await ready;await b.tick();assert.equal(runs,1);finish({status:'COMPLETED'});await run;});
test('pause aborts a running execution and preserves owner status',async t=>{const f=fixture(t),task=f.store.create({goal:'One'});let started;const ready=new Promise(r=>started=r);const scheduler=new NethraScheduler({...f,pollMs:10,execute:async(task,{signal})=>{started();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));return {status:'COMPLETED'};}});const run=scheduler.tick();await ready;const live=f.store.get(task.id);f.store.control(task.id,'pause',live.revision,'pause');await run;assert.equal(f.store.get(task.id).status,'PAUSED');});
test('errors back off durably and daily budgets prevent further execution',async t=>{const f=fixture(t),a=f.store.create({goal:'One'});f.store.setSettings({objectiveDailyBudgetMs:100});const scheduler=new NethraScheduler({...f,execute:async(_task,{inference})=>inference(async()=>{f.advance(100);throw new Error('offline');})});await scheduler.tick();assert.equal(f.store.get(a.id).status,'SLEEPING');assert.equal(f.store.get(a.id).errors.length,1);f.advance(300001);await scheduler.tick();assert.equal(f.store.get(a.id).nextWakeAt,86400000);});
test('a successful wake resets consecutive retry backoff but retains error history',async t=>{
  const f=fixture(t),task=f.store.create({goal:'One'});let attempt=0;
  const scheduler=new NethraScheduler({...f,execute:async()=>{
    attempt++;
    if(attempt===1||attempt===3)throw Error(`failure ${attempt}`);
    return {status:'SLEEPING',nextWakeAt:f.now()+300000};
  }});
  await scheduler.tick();assert.equal(f.store.get(task.id).retryCount,1);
  f.advance(300001);await scheduler.tick();assert.equal(f.store.get(task.id).retryCount,0);
  f.advance(300001);await scheduler.tick();
  const recovered=f.store.get(task.id);
  assert.equal(recovered.retryCount,1);assert.equal(recovered.errors.length,2);
  assert.equal(recovered.nextWakeAt,f.now()+300000);
});
test('wake bounds prevent a tight loop or a silently lost objective',()=>{assert.equal(clampWake(1,1000),301000);assert.equal(clampWake(9999999999,1000),604801000);});
test('nonpersistent objectives pause after yielding instead of automatically waking',async t=>{const f=fixture(t),task=f.store.create({goal:'One',persistent:false});const scheduler=new NethraScheduler({...f,execute:async()=>({status:'SLEEPING',nextWakeAt:f.now()+300000})});await scheduler.tick();assert.equal(f.store.get(task.id).status,'PAUSED');});
test('runner terminal checkpoints survive scheduler result handling and usage accounting',async t=>{const f=fixture(t),task=f.store.create({goal:'One'});const scheduler=new NethraScheduler({...f,execute:async(_task,{checkpoint,inference})=>{await inference(async()=>f.advance(50));const result={status:'COMPLETED',summary:'Verified outcome'};checkpoint(result);return result;}});await scheduler.tick();assert.equal(f.store.get(task.id).status,'COMPLETED');assert.equal(f.store.get(task.id).summary,'Verified outcome');assert.equal(f.store.get(task.id).budget.totalMs,50);assert.equal(scheduler.lastError,undefined);});

test('waiting in the real inference queue does not consume a daily allowance',async t=>{
  const {LocalAgentRuntime}=require('../src/local-agent-runtime');const {NethraRunner}=require('../src/nethra-runner');
  const f=fixture(t),task=f.store.create({goal:'Research housing'});f.store.setSettings({objectiveDailyBudgetMs:50});
  const runtime=new LocalAgentRuntime();let release,entered;const ready=new Promise(resolve=>entered=resolve);
  const held=runtime.withInference(async()=>{entered();await new Promise(resolve=>release=resolve);});await ready;
  let chats=0;runtime.chat=async()=>{chats++;f.advance(20);return {message:{content:'',tool_calls:[{function:{name:'request_input',arguments:{question:'Choose an area'}}}]}};};
  const runner=new NethraRunner({store:f.store,runtime,now:f.now});const scheduler=new NethraScheduler({...f,pollMs:10,execute:(task,options)=>runner.execute(task,options)});
  const run=scheduler.tick();await new Promise(resolve=>setTimeout(resolve,80));f.advance(5000);
  assert.equal(f.store.usage(task.id).taskMs,0);assert.equal(chats,0);
  release();await held;await run;
  assert.equal(chats,1);assert.equal(f.store.usage(task.id).taskMs,20);assert.equal(f.store.get(task.id).status,'WAITING_FOR_USER');
});

test('research waiting between model calls is excluded from inference usage',async t=>{
  const {NethraRunner}=require('../src/nethra-runner');const f=fixture(t),task=f.store.create({goal:'Research housing'});let calls=0;
  const runtime={withInference:fn=>fn(),chat:async()=>{calls++;f.advance(10);return {message:{content:'',tool_calls:[{function:calls===1?{name:'web_search',arguments:{query:'housing research'}}:{name:'request_input',arguments:{question:'Choose source'}}}]}};}};
  const researchCoordinator={run:async()=>{f.advance(5000);return {sources:[{url:'https://example.com/housing',title:'Housing',snippet:'Housing facts'}]};}};
  const runner=new NethraRunner({store:f.store,runtime,researchCoordinator,now:f.now});await new NethraScheduler({...f,execute:(task,options)=>runner.execute(task,options)}).tick();
  assert.equal(f.store.usage(task.id).taskMs,20);assert.equal(calls,2);
});
