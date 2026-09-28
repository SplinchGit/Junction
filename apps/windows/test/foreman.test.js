"use strict";
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Foreman}=require('../src/foreman');
const fixture=()=>fs.mkdtempSync(path.join(os.tmpdir(),'junction-foreman-'));
const input={name:'Demo',repoPath:'demo',objective:'Improve the approved demo',tasks:[{title:'Verify baseline',kind:'verify',acceptance:'Existing checks pass'}]};
const executor={inspect:async()=>({baseSha:'abc',baseBranch:'main'}),run:async()=>({headSha:'def',tests:[{exitCode:0}],summary:'Verified'})};
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
