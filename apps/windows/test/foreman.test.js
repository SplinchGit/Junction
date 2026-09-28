"use strict";
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Foreman}=require('../src/foreman');
const fixture=()=>fs.mkdtempSync(path.join(os.tmpdir(),'junction-foreman-'));
const input={name:'Demo',repoPath:'demo',objective:'Improve the approved demo',tasks:[{title:'Verify baseline',kind:'verify',acceptance:'Existing checks pass'}]};
const executor={inspect:async()=>({baseSha:'abc',baseBranch:'main'}),run:async()=>({headSha:'def',tests:[{exitCode:0}],summary:'Verified'})};
test('abrupt process death leaves interrupted work paused on recovery',()=>{
 const {spawnSync}=require('node:child_process');const dir=fixture();
 const program=`const {Foreman}=require(${JSON.stringify(require.resolve('../src/foreman'))});(async()=>{const f=new Foreman(${JSON.stringify(dir)},{executor:{inspect:async()=>({}),run:()=>new Promise(()=>{})}});const p=await f.create(${JSON.stringify(input)});await f.control(p.id,'start',p.revision,'start');process.exit(0)})()`;
 assert.equal(spawnSync(process.execPath,['-e',program],{encoding:'utf8'}).status,0);
 const f=new Foreman(dir,{executor});assert.equal(f.list()[0].status,'PAUSED');assert.equal(f.enabled.size,0);assert.ok(f.list()[0].tasks[0].attempts.length);f.close();
});
test('creation and reopen never dispatch; completed work and logs persist',async()=>{
 const dir=fixture();let calls=0;const e={...executor,run:async()=>{calls++;return executor.run()}};
 let f=new Foreman(dir,{executor:e});const p=await f.create(input);assert.equal(p.status,'DRAFT');assert.equal(calls,0);
 await f.control(p.id,'start',p.revision,'first');await f.idle();assert.equal(f.get(p.id).status,'COMPLETED');assert.equal(calls,1);f.close();
 f=new Foreman(dir,{executor:e});assert.equal(f.get(p.id).status,'COMPLETED');assert.equal(calls,1);assert.ok(f.events(p.id).length>=3);f.close();
});
test('pause during work fences late success; explicit resume required after reopen',async()=>{
 const dir=fixture();let finish;const f=new Foreman(dir,{executor:{...executor,run:()=>new Promise(r=>finish=r)}});const p=await f.create(input);
 await f.control(p.id,'start',p.revision,'s');await new Promise(r=>setImmediate(r));
 await f.control(p.id,'pause',f.get(p.id).revision,'p');finish(await executor.run());await f.idle();assert.equal(f.get(p.id).status,'PAUSED');assert.notEqual(f.get(p.id).tasks[0].status,'COMPLETED');f.close();
 const next=new Foreman(dir,{executor});assert.equal(next.get(p.id).status,'PAUSED');next.close();
});
test('controls are idempotent, stale revisions rejected and stop preserves context',async()=>{
 const f=new Foreman(fixture(),{executor});const p=await f.create(input);
 await f.control(p.id,'stop',p.revision,'x');await f.control(p.id,'stop',p.revision,'x');
 await assert.rejects(f.control(p.id,'resume',p.revision,'y'),/stale/i);assert.equal(f.get(p.id).status,'STOPPED');assert.equal(f.get(p.id).objective,input.objective);f.close();
});
test('capacity wait is durable but reboot does not schedule it',async()=>{
 const dir=fixture();const e={...executor,run:async()=>{throw Object.assign(new Error('rate limit'),{retryAt:Date.now()+600000})}};
 const f=new Foreman(dir,{executor:e});const p=await f.create(input);await f.control(p.id,'start',p.revision,'s');await f.idle();assert.equal(f.get(p.id).status,'WAITING_CODEX');f.close();
 const next=new Foreman(dir,{executor:e});assert.equal(next.get(p.id).status,'PAUSED');assert.ok(next.get(p.id).retryAt>Date.now());next.close();
});
test('failed verification cannot complete; corruption never resets state',async()=>{
 const dir=fixture();const f=new Foreman(dir,{executor:{...executor,run:async()=>({tests:[{exitCode:1}],summary:'failed'})}});const p=await f.create(input);await f.control(p.id,'start',p.revision,'s');await f.idle();assert.equal(f.get(p.id).status,'BLOCKED');f.close();
 fs.writeFileSync(path.join(dir,'foreman.sqlite'),'corrupt');assert.throws(()=>new Foreman(dir,{executor}));
});
test('backup failure cannot prevent Pause from aborting active work',async()=>{
 const dir=fixture();let now=100000,aborted=false;
 const e={...executor,run:(_p,_t,{signal})=>new Promise(resolve=>signal.addEventListener('abort',()=>{aborted=true;resolve({headSha:'late',tests:[{exitCode:0}],summary:'late'});},{once:true}))};
 const f=new Foreman(dir,{executor:e,now:()=>now});const p=await f.create(input);await f.control(p.id,'start',p.revision,'start');await new Promise(resolve=>setImmediate(resolve));
 now+=61000;fs.mkdirSync(path.join(dir,'foreman.backup.tmp'));await f.control(p.id,'pause',f.get(p.id).revision,'pause');await f.idle();
 assert.equal(aborted,true);assert.equal(f.get(p.id).status,'PAUSED');f.close();
});
test('an owner chat instruction starts new work immediately and later instructions queue in context',async()=>{
 const dir=fixture();let finish;const e={...executor,run:()=>new Promise(resolve=>finish=resolve)};const f=new Foreman(dir,{executor:e});
 const p=await f.submit({name:'Civlets',repoPath:'demo',objective:'Fix Civlets',conversationId:'chat',task:'Fix the build',acceptance:'The requested change is verified'});
 assert.equal(f.get(p.id).status,'RUNNING');assert.ok(f.enabled.has(p.id));
 await f.submit({projectId:p.id,task:'Then improve the scene',acceptance:'The follow-up is verified'});
 assert.equal(f.get(p.id).tasks.length,2);
 await f.control(p.id,'stop',f.get(p.id).revision,'stop-chat');finish({headSha:'late',tests:[{exitCode:0}],summary:'late'});await f.idle();
 assert.equal(f.get(p.id).status,'STOPPED');f.close();
});
