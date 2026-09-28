const {test}=require('node:test'),assert=require('node:assert/strict');
const {ForemanApi}=require('../src/foreman-api');
const {AppServerDelegationCoordinator}=require('../src/app-server-delegation-coordinator');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('Android cannot register host paths or forward arbitrary control fields',async()=>{
 const api=new ForemanApi({});await assert.rejects(api.dispatch('project.register',{},'a','android'),/Windows/);
 await assert.rejects(api.dispatch('task.control',{id:'x',action:'start',revision:1,command:'bad'},'b','android'),/fields/);
 await assert.rejects(api.dispatch('shell',{},'c','android'),/Unsupported/);
});
test('legacy coordinator does not resume capacity waits on application launch',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'legacy-foreman-'));fs.writeFileSync(path.join(dir,'plans.json'),JSON.stringify([{id:'plan',projects:[{id:'task',status:'waiting_for_capacity',resumeAt:0}]}]));
 let calls=0;const c=new AppServerDelegationCoordinator(dir,{appServer:{readRateLimits(){calls++;},stop(){}}});
 assert.equal(calls,0);assert.equal(c.plans[0].projects[0].status,'needs_decision');assert.equal(c.resumeTimers.size,0);c.shutdown();
});
