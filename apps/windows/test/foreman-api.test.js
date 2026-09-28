const {test}=require('node:test'),assert=require('node:assert/strict');
const {ForemanApi}=require('../src/foreman-api');
const {AppServerDelegationCoordinator}=require('../src/app-server-delegation-coordinator');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Foreman}=require('../src/foreman');
test('Android cannot register host paths or forward arbitrary control fields',async()=>{
 const api=new ForemanApi({});await assert.rejects(api.dispatch('project.register',{},'a','android'),/Windows/);
 await assert.rejects(api.dispatch('task.control',{id:'x',action:'start',revision:1,command:'bad'},'b','android'),/fields/);
 await assert.rejects(api.dispatch('shell',{},'c','android'),/Unsupported/);
});
test('review holds project mutation lock across awaits',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'foreman-review-'));let release;
 const executor={inspect:async()=>({}),review:()=>new Promise(r=>release=r)};
 const f=new Foreman(dir,{executor}),api=new ForemanApi(f);const p=await f.create({name:'Review',objective:'Safe review',repoPath:'demo',tasks:[{title:'Task',acceptance:'Pass'}]});
 const pending=api.dispatch('task.review',{id:p.id,revision:p.revision});
 await assert.rejects(f.control(p.id,'start',p.revision,'start'),/review\/apply/);
 await assert.rejects(api.dispatch('task.enqueue',{id:p.id,revision:p.revision,title:'Another',acceptance:'Pass'}),/review\/apply/);
 release({headSha:'abc',diffHash:'hash',sourceHash:'source',summary:'review',patch:'diff'});await pending;assert.equal(f.get(p.id).status,'DRAFT');f.close();
});
test('retrying an enqueue request does not duplicate the task',async()=>{
 const f=new Foreman(fs.mkdtempSync(path.join(os.tmpdir(),'foreman-enqueue-')),{executor:{inspect:async()=>({})}}),api=new ForemanApi(f);
 const p=await f.create({name:'Queue',objective:'Queue',repoPath:'demo',tasks:[{title:'First',acceptance:'Pass'}]});
 const payload={id:p.id,revision:p.revision,title:'Second',acceptance:'Pass'};await api.dispatch('task.enqueue',payload,'same');await api.dispatch('task.enqueue',payload,'same');assert.equal(f.get(p.id).tasks.length,2);f.close();
});
test('legacy coordinator does not resume capacity waits on application launch',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'legacy-foreman-'));fs.writeFileSync(path.join(dir,'plans.json'),JSON.stringify([{id:'plan',projects:[{id:'task',status:'waiting_for_capacity',resumeAt:0}]}]));
 let calls=0;const c=new AppServerDelegationCoordinator(dir,{appServer:{readRateLimits(){calls++;},stop(){}}});
 assert.equal(calls,0);assert.equal(c.plans[0].projects[0].status,'needs_decision');assert.equal(c.resumeTimers.size,0);c.shutdown();
});
test('legacy quit during capacity check cannot restart Codex',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'legacy-quit-'));let release,runs=0;
 const c=new AppServerDelegationCoordinator(dir,{appServer:{readRateLimits:()=>new Promise(r=>release=r),run:async()=>{runs++;},stop(){}}});
 const p={id:'p',status:'queued'},plan={id:'plan',projects:[p]};c.plans=[plan];
 const run=c.runProject(plan,p);const quitting=c.shutdown();release({rateLimits:{primary:{usedPercent:0}}});await run;await quitting;assert.equal(runs,0);assert.equal(p.status,'needs_decision');
});
test('shutdown drains an authorized apply before storage closes',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'foreman-apply-'));let release;
 const executor={inspect:async()=>({}),applyReviewed:()=>new Promise(resolve=>release=()=>resolve({summary:'applied'})),stop:async()=>{}};
 const f=new Foreman(dir,{executor}),api=new ForemanApi(f);const p=await f.create({name:'Apply',objective:'Apply reviewed work',repoPath:'demo',tasks:[{title:'Task',acceptance:'Pass'}]});
 const apply=api.dispatch('task.apply',{id:p.id,revision:p.revision});let quitFinished=false;const quitting=f.shutdown().then(()=>quitFinished=true);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(quitFinished,false);release();await apply;await quitting;assert.equal(f.events(p.id).at(-1).kind,'APPLIED');f.close();
});
