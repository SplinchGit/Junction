const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {ForemanExecutor,retryDeadline,engineeringPacket,validateVerification}=require('../src/foreman-executor');
test('capacity respects latest applicable reset; unknown reached capacity is not available',()=>{
 assert.equal(retryDeadline({rateLimits:{primary:{usedPercent:100,resetsAt:200},secondary:{usedPercent:100,resetsAt:300}}},100000),360000);
 assert.equal(retryDeadline({rateLimits:{rateLimitReachedType:'quota'}},100000),400000);
 assert.equal(retryDeadline({rateLimits:{primary:{usedPercent:10,resetsAt:300}}},100000),null);
});
test('verification only accepts explicit bounded argv; packet has owner scope and all evidence',()=>{
 assert.throws(()=>validateVerification([]),/verification/i);
 assert.throws(()=>validateVerification([{command:['npm','test'],cwd:'../escape'}]),/directory/i);
 assert.throws(()=>validateVerification([{command:['npm','test'],protectedPaths:['../escape']}]),/protected/i);
 assert.equal(validateVerification([{command:['node','--test'],cwd:'.'}]).length,1);
 const packet=engineeringPacket({objective:'Goal',baseSha:'abc',handoff:'Context',decisions:[]},{title:'Task',acceptance:'Pass',files:['a.js'],attempts:[]});
 for(const section of ['Objective','Architecture','Exact task','Relevant files','Constraints','Previous attempts','Build/test failures','Acceptance criteria','Requested output'])assert.ok(packet.includes(section));
});
test('candidate cannot weaken an explicitly protected verification input',async()=>{
 const repo=fs.mkdtempSync(path.join(os.tmpdir(),'foreman-checks-'));
 execFileSync('git',['init','-b','main'],{cwd:repo});
 fs.writeFileSync(path.join(repo,'answer.js'),'module.exports = n => n + 1;\n');
 fs.writeFileSync(path.join(repo,'assertions.js'),'module.exports = { expected: 3 };\n');
 fs.writeFileSync(path.join(repo,'answer.test.js'),"const assert=require('node:assert/strict'), checks=require('./assertions'); assert.equal(require('./answer')(1),checks.expected);\n");
 execFileSync('git',['add','--all'],{cwd:repo});execFileSync('git',['-c','user.name=Test','-c','user.email=test@localhost','commit','-m','fixture'],{cwd:repo});
 const server={readRateLimits:async()=>({rateLimits:{primary:{usedPercent:0}}}),run:async({cwd})=>{fs.writeFileSync(path.join(cwd,'assertions.js'),'module.exports = { expected: 2 };\n');return {text:'done'};},stop:async()=>{}};
 const executor=new ForemanExecutor(fs.mkdtempSync(path.join(os.tmpdir(),'foreman-state-')),{server});
 const inspected=await executor.inspect({repoPath:repo,verification:[{command:['node','answer.test.js'],cwd:'.',protectedPaths:['answer.test.js','assertions.js']}]});
 const project={id:'p',objective:'Fix answer',handoff:'Fixture',decisions:[],verification:inspected.verification,...inspected};
 const task={id:'t',title:'Fix implementation',kind:'codex',acceptance:'Test passes without changing it',files:['answer.js'],attempts:[{id:'a'}]};
 await assert.rejects(executor.run(project,task,{signal:new AbortController().signal,checkpoint(){}}),/changed verification/i);
});
