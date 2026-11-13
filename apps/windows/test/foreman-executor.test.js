const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {ForemanExecutor,retryDeadline,engineeringPacket,validateVerification}=require('../src/foreman-executor');
test('shared checkout keeps both providers on main and verifies a separate snapshot without committing source',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'foreman-shared-')),repo=path.join(root,'repo');fs.mkdirSync(repo);
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8'}).trim();
 git('init','-b','main');fs.writeFileSync(path.join(repo,'answer.js'),'module.exports = 1;\n');fs.writeFileSync(path.join(repo,'owner.txt'),'original\n');git('add','.');git('-c','user.name=Test','-c','user.email=test@localhost','commit','-m','baseline');
 const head=git('rev-parse','HEAD');fs.writeFileSync(path.join(repo,'owner.txt'),'owner edit\n');
 const future=Math.floor(Date.now()/1000)+1800;let started=false;
 const server={readRateLimits:async()=>({rateLimits:{primary:{usedPercent:started?95:0,resetsAt:future}}}),request:async()=>({account:{type:'chatgpt'}}),stop:async()=>{},run:async({cwd,readOnly})=>{
  assert.equal(cwd,repo);assert.equal(readOnly,true);started=true;return {text:'diff --git a/answer.js b/answer.js\n--- a/answer.js\n+++ b/answer.js\n@@ -1 +1 @@\n-module.exports = 1;\n+module.exports = 2;\n',handoffRetryAt:future*1000};
 }};
 const executor=new ForemanExecutor(path.join(root,'state'),{server,advisorLimits:{snapshot:async()=>({checkedAt:Date.now(),windows:[{name:'five_hour',usedPercent:1,resetsAt:future*1000}]})},claudeStatus:async()=>({subscription:true}),runClaude:async({workingDirectory})=>{
  assert.equal(workingDirectory,repo);return {content:'diff --git a/answer.js b/answer.js\n--- a/answer.js\n+++ b/answer.js\n@@ -1 +1 @@\n-module.exports = 2;\n+module.exports = 3;\n'};
 }});
 executor.command=async cwd=>{assert.notEqual(cwd,repo);assert.equal(fs.readFileSync(path.join(cwd,'answer.js'),'utf8'),'module.exports = 3;\n');return {exitCode:0,stdout:'pass',stderr:''};};
 const p={id:'shared',sharedCheckout:true,autoHandoff:true,objective:'Fix answer',...await executor.inspect({repoPath:repo,verification:[{command:['node','--version']}]})};
 const task={id:'t',kind:'codex',title:'Set answer',acceptance:'Answer is three',files:['answer.js'],attempts:[{}]};
 const options={signal:new AbortController().signal,checkpoint:fields=>{Object.assign(task.attempts.at(-1),fields);if(fields.worktree)p.worktree=fields.worktree;}};
 await assert.rejects(executor.run(p,task,options),/handoff is ready/i);task.attempts.push({});
 const result=await executor.run(p,task,options);
 assert.equal(git('rev-parse','HEAD'),head);assert.equal(git('branch','--show-current'),'main');
 assert.equal(fs.readFileSync(path.join(repo,'owner.txt'),'utf8'),'owner edit\n');
 assert.equal(fs.readFileSync(path.join(repo,'answer.js'),'utf8'),'module.exports = 3;\n');
 assert.equal(result.sharedSourceHash,await executor.sourceHash(repo,false,p.scopeKind));
 // A failed verifier may have left an untracked file in its checkpoint. The next
 // verification must reflect the current canonical manifest, not that leftover.
 fs.writeFileSync(path.join(result.worktree,'stale.js'),'stale\n');
 const verified=await executor.run(p,{...task,kind:'verify',attempts:[{}]},options);
 assert.equal(fs.existsSync(path.join(verified.worktree,'stale.js')),false);
});
test('capacity respects latest applicable reset; unknown reached capacity is not available',()=>{
 assert.equal(retryDeadline({rateLimits:{primary:{usedPercent:100,resetsAt:200},secondary:{usedPercent:100,resetsAt:300}}},100000),360000);
 assert.equal(retryDeadline({rateLimits:{rateLimitReachedType:'quota'}},100000),400000);
 assert.equal(retryDeadline({rateLimits:{primary:{usedPercent:10,resetsAt:300}}},100000),null);
 assert.equal(retryDeadline({rateLimits:{primary:{usedPercent:10,resetsAt:90}}},100000),400000);
 assert.equal(retryDeadline({rateLimits:{primary:{usedPercent:100,resetsAt:90}}},100000),150000);
 assert.equal(retryDeadline({rateLimits:{primary:{resetsAt:300}}},100000),400000);
});

test('shared writer lock excludes another provider and never removes its lock',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'foreman-lock-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 execFileSync('git',['init','-b','main'],{cwd:root});
 const e=new ForemanExecutor(path.join(root,'state'),{server:{}}),p={id:'one',repoPath:root};
 const release=await e.acquireWriter(p);
 await assert.rejects(e.acquireWriter({...p,id:'two'}),/writer lock/);
 release();const second=await e.acquireWriter({...p,id:'two'});second();
});

test('shared patches reject protected files and source changes before any write',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'foreman-protected-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));execFileSync('git',['init','-b','main'],{cwd:root});
 fs.writeFileSync(path.join(root,'answer.test.js'),'before\n');
 const e=new ForemanExecutor(path.join(root,'state'),{server:{}}),p={repoPath:root};
 const before=await e.sourceHash(root,true);
 const patch='diff --git a/answer.test.js b/answer.test.js\n--- a/answer.test.js\n+++ b/answer.test.js\n@@ -1 +1 @@\n-before\n+weakened\n';
 await assert.rejects(e.applySharedPatch(p,root,patch,[],before),/protected verification/);
 assert.equal(fs.readFileSync(path.join(root,'answer.test.js'),'utf8'),'before\n');
 await assert.rejects(e.applySharedPatch(p,root,patch,[],before),error=>{
  assert.match(error.message,/\(answer\.test\.js\)$/,'names the offending relative path');
  assert.doesNotMatch(error.message,/weakened|before|[A-Za-z]:\\/,'never contents or absolute paths');
  return true;
 });
 fs.writeFileSync(path.join(root,'answer.test.js'),'owner changed\n');
 await assert.rejects(e.applySharedPatch(p,root,patch,[],before),/source changed/);
 assert.equal(fs.readFileSync(path.join(root,'answer.test.js'),'utf8'),'owner changed\n');
});

test('Claude LF diff applies to a CRLF scoped file in a canonical subfolder',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'foreman-crlf-')),folder=path.join(root,'app');
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(folder);execFileSync('git',['init','-b','main'],{cwd:root});
 fs.writeFileSync(path.join(folder,'answer.js'),'const answer = 1;\r\n');
 const e=new ForemanExecutor(path.join(root,'state'),{server:{}});
 fs.writeFileSync(path.join(folder,'answer.js'),'const answer = 1;\r\n\r\n');
 await e.applyClaudePatch(folder,'diff --git a/answer.js b/answer.js\n--- a/answer.js\n+++ b/answer.js\n@@ -1,2 +1,2 @@\n-const answer = 1;\n+const answer = 2;\n \n',{'answer.js':'const answer = 1;\r\n\r\n'});
 assert.equal(fs.readFileSync(path.join(folder,'answer.js'),'utf8'),'const answer = 2;\r\n\r\n');
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
test('plain local folders are accepted without adding Git metadata to them',async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'foreman-folder-'));fs.writeFileSync(path.join(folder,'scene.txt'),'home\n');
 const executor=new ForemanExecutor(fs.mkdtempSync(path.join(os.tmpdir(),'foreman-folder-state-')),{server:{stop:async()=>{}}});
 const inspected=await executor.inspect({repoPath:folder});assert.equal(inspected.scopeKind,'folder');assert.equal(inspected.baseSha,'local-folder');assert.ok(inspected.verification.length);
 const workspace=await executor.prepare({id:'folder',repoPath:folder,...inspected},{id:'task'},()=>{},new AbortController().signal);
 assert.equal(fs.existsSync(path.join(folder,'.git')),false);assert.equal(fs.readFileSync(path.join(workspace,'scene.txt'),'utf8'),'home\n');
});

test('transient npm cache and test output do not block a source folder snapshot',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'foreman-cache-scope-')),state=fs.mkdtempSync(path.join(os.tmpdir(),'foreman-cache-state-'));
 t.after(()=>{fs.rmSync(folder,{recursive:true,force:true});fs.rmSync(state,{recursive:true,force:true});});
 fs.writeFileSync(path.join(folder,'source.js'),'module.exports = 1;\n');
 for(const dir of ['.npm-cache','test-results']){fs.mkdirSync(path.join(folder,dir));fs.writeFileSync(path.join(folder,dir,'generated.bin'),Buffer.alloc(33*1024*1024));}
 const executor=new ForemanExecutor(state,{server:{stop:async()=>{}}});
 const inspected=await executor.inspect({repoPath:folder});
 const workspace=await executor.prepare({id:'cache',repoPath:folder,...inspected},{id:'task'},()=>{},new AbortController().signal);
 assert.equal(fs.readFileSync(path.join(workspace,'source.js'),'utf8'),'module.exports = 1;\n');
 assert.equal(fs.existsSync(path.join(workspace,'.npm-cache')),false);
 assert.equal(fs.existsSync(path.join(workspace,'test-results')),false);
});
test('a verified folder candidate is promoted with an external rollback backup',async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'foreman-promote-'));fs.writeFileSync(path.join(folder,'scene.txt'),'before\n');const state=fs.mkdtempSync(path.join(os.tmpdir(),'foreman-promote-state-'));
 const executor=new ForemanExecutor(state,{server:{stop:async()=>{}}}),inspected=await executor.inspect({repoPath:folder}),project={id:'p',repoPath:folder,...inspected};
 const workspace=await executor.prepare(project,{id:'t'},value=>Object.assign(project,value),new AbortController().signal);fs.writeFileSync(path.join(workspace,'scene.txt'),'after\n');execFileSync('git',['add','--all'],{cwd:workspace});execFileSync('git',['-c','user.name=Test','-c','user.email=test@localhost','commit','-m','verified'],{cwd:workspace});
 const promoted=await executor.promoteVerified(project,{worktree:workspace,headSha:execFileSync('git',['rev-parse','HEAD'],{cwd:workspace,encoding:'utf8'}).trim()});
 assert.equal(fs.readFileSync(path.join(folder,'scene.txt'),'utf8'),'after\n');assert.equal(fs.readFileSync(path.join(promoted.backup,'scene.txt'),'utf8'),'before\n');assert.equal(fs.existsSync(path.join(folder,'.git')),false);
});

test('a reviewed candidate from a scoped folder is applied only by the owner action',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'foreman-reviewed-root-')),folder=path.join(root,'apps','windows'),state=fs.mkdtempSync(path.join(os.tmpdir(),'foreman-reviewed-state-'));
 t.after(()=>{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(state,{recursive:true,force:true});});
 fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'answer.js'),'before\n');
 execFileSync('git',['init','-b','main'],{cwd:root});execFileSync('git',['add','--all'],{cwd:root});execFileSync('git',['-c','user.name=Test','-c','user.email=test@localhost','commit','-m','fixture'],{cwd:root});
 const executor=new ForemanExecutor(state,{server:{stop:async()=>{}}}),inspected=await executor.inspect({repoPath:folder,verification:[{command:['node','--version'],cwd:'.'}]});
 assert.equal(inspected.scopeKind,'folder');
 const p={id:'p',repoPath:folder,...inspected};
 p.worktree=await executor.prepare(p,{id:'t'},()=>{},new AbortController().signal);
 fs.writeFileSync(path.join(p.worktree,'answer.js'),'after\n');execFileSync('git',['add','--all'],{cwd:p.worktree});execFileSync('git',['-c','user.name=Test','-c','user.email=test@localhost','commit','-m','verified'],{cwd:p.worktree});
 p.verifiedSha=execFileSync('git',['rev-parse','HEAD'],{cwd:p.worktree,encoding:'utf8'}).trim();
 const reviewed=await executor.review(p);p.reviewed={headSha:reviewed.headSha,diffHash:reviewed.diffHash,sourceHash:reviewed.sourceHash};
 assert.equal(fs.readFileSync(path.join(folder,'answer.js'),'utf8'),'before\n');
 await executor.applyReviewed(p);
 assert.equal(fs.readFileSync(path.join(folder,'answer.js'),'utf8'),'after\n');
 assert.match(execFileSync('git',['diff','--cached','--name-only'],{cwd:root,encoding:'utf8'}),/answer\.js/);
});

test('95 percent requests a handoff and Claude verifies the same isolated candidate',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'foreman-handoff-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const repo=path.join(root,'source');
 fs.mkdirSync(repo);
 fs.writeFileSync(path.join(repo,'answer.js'),'module.exports = 1;\n');
 const future=Math.floor(Date.now()/1000)+1800;
 let codexCalls=0,claudeCalls=0;
 const server={
  readRateLimits:async()=>({rateLimits:{primary:{usedPercent:codexCalls?95:94,resetsAt:future}}}),
  request:async()=>({account:{type:'chatgpt'}}),
  run:async({cwd,handoffAtCapacity})=>{
   codexCalls++;
   assert.equal(handoffAtCapacity({rateLimits:{primary:{usedPercent:94,resetsAt:future}}}),null);
   fs.writeFileSync(path.join(cwd,'answer.js'),'module.exports = 2;\n');
   return {text:'Implementation started; fix the expected result next',handoffRetryAt:handoffAtCapacity({rateLimits:{primary:{usedPercent:95,resetsAt:future}}})};
  },stop:async()=>{}
 };
 const limits={snapshot:async()=>({checkedAt:Date.now(),windows:[{name:'five_hour',usedPercent:20,resetsAt:future*1000}]}),recordClaude(){}};
 const executor=new ForemanExecutor(path.join(root,'state'),{server,advisorLimits:limits,claudeStatus:async()=>({subscription:true}),runClaude:async({prompt,subscriptionOnly})=>{
   claudeCalls++;
   assert.equal(subscriptionOnly,true);
   assert.match(prompt,/fix the expected result next/);
   assert.match(prompt,/module.exports = 2/);
   return {content:'diff --git a/answer.js b/answer.js\n--- a/answer.js\n+++ b/answer.js\n@@ -1 +1 @@\n-module.exports = 2;\n+module.exports = 3;\n'};
 }});
 executor.command=async(cwd)=>{assert.equal(fs.readFileSync(path.join(cwd,'answer.js'),'utf8'),'module.exports = 3;\n');return {exitCode:0,stdout:'ok',stderr:''};};
 const p={id:'p',objective:'Set answer',autoHandoff:true,...await executor.inspect({repoPath:repo,verification:[{cwd:'.',command:['node','--test']}]})};
 const task={id:'task',kind:'codex',title:'Set answer',acceptance:'Answer is three',files:[],attempts:[{}]};
 const options={signal:new AbortController().signal,checkpoint:fields=>Object.assign(task.attempts.at(-1),fields)};
 await assert.rejects(executor.run(p,task,options),/handoff is ready/i);
 assert.equal(task.attempts[0].provider,'codex');
 assert.ok(task.attempts[0].engineeringHandoff.sourceHash);
 task.attempts.push({});
 const result=await executor.run(p,task,options);
 assert.equal(task.attempts[1].provider,'claude');
 assert.deepEqual([codexCalls,claudeCalls],[1,1]);
 assert.equal(result.tests[0].exitCode,0);
 assert.equal(fs.readFileSync(path.join(repo,'answer.js'),'utf8'),'module.exports = 1;\n');
 await assert.rejects(executor.applyClaudePatch(result.worktree,'diff --git a/answer.js b/answer.js\n--- a/answer.js\n+++ b/answer.js\n@@ -1 +1 @@\n-module.exports = 3;\n+module.exports = 4;\n',{}),/file scope/);
});

test('a crashed host lock is reclaimed only after its recorded process has exited',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'foreman-stale-lock-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 execFileSync('git',['init','-b','main'],{cwd:root});
 const lock=path.join(root,'.git','nethra-writer.lock'),alive=new Set([4242]);
 const e=new ForemanExecutor(path.join(root,'state'),{server:{},processAlive:pid=>alive.has(pid)}),p={id:'one',repoPath:root};
 const write=value=>fs.writeFileSync(lock,JSON.stringify(value));
 // A running host, this process, and a lock without a host process (an engineer's manual lock) all keep ownership.
 for(const holder of [{pid:4242,nonce:'live'},{pid:process.pid,nonce:'self'},{pid:null,provider:'claude',nonce:'manual'},{pid:777}]){
  write(holder);await assert.rejects(e.acquireWriter(p),/writer lock/);
  assert.deepEqual(JSON.parse(fs.readFileSync(lock,'utf8')),holder);
 }
 fs.writeFileSync(lock,'not json');await assert.rejects(e.acquireWriter(p),/writer lock/);
 // An interrupted reclamation is never raced; it stays for a person to reconcile.
 write({pid:777,nonce:'crashed'});fs.writeFileSync(lock+'.reclaim','{}');
 await assert.rejects(e.acquireWriter(p),/writer lock/);fs.unlinkSync(lock+'.reclaim');
 const release=await e.acquireWriter(p);
 assert.equal(JSON.parse(fs.readFileSync(lock,'utf8')).pid,process.pid);assert.equal(fs.existsSync(lock+'.reclaim'),false);
 await assert.rejects(e.acquireWriter({...p,id:'two'}),/writer lock/);
 const interrupted={...JSON.parse(fs.readFileSync(lock,'utf8')),pid:777};
 release();assert.equal(fs.existsSync(lock),false);
 fs.writeFileSync(path.join(root,'interrupted.js'),'unverified edit\n');
 write(interrupted);
 await assert.rejects(e.acquireWriter(p),/interrupted checkpoint/);
 assert.deepEqual(JSON.parse(fs.readFileSync(lock,'utf8')),interrupted);
});

test('write ownership is held only during a provider turn and released by handoff and Pause without a late patch',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'foreman-owner-')),repo=path.join(root,'repo');fs.mkdirSync(repo);
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8'}).trim();
 git('init','-b','main');fs.writeFileSync(path.join(repo,'answer.js'),'module.exports = 1;\n');git('add','.');git('-c','user.name=Test','-c','user.email=test@localhost','commit','-m','baseline');
 const lock=path.join(repo,'.git','nethra-writer.lock'),future=Math.floor(Date.now()/1000)+1800,owners=[];
 const patch=(from,to)=>`diff --git a/answer.js b/answer.js\n--- a/answer.js\n+++ b/answer.js\n@@ -1 +1 @@\n-module.exports = ${from};\n+module.exports = ${to};\n`;
 let started=false,pause=null;
 const server={readRateLimits:async()=>({rateLimits:{primary:{usedPercent:started?95:0,resetsAt:future}}}),request:async()=>({account:{type:'chatgpt'}}),stop:async()=>{},run:async()=>{
  owners.push(['codex',fs.existsSync(lock)]);started=true;return {text:patch(1,2),handoffRetryAt:future*1000};
 }};
 const executor=new ForemanExecutor(path.join(root,'state'),{server,advisorLimits:{snapshot:async()=>({checkedAt:Date.now(),windows:[{name:'five_hour',usedPercent:1,resetsAt:future*1000}]})},claudeStatus:async()=>({subscription:true}),runClaude:async()=>{
  owners.push(['claude',fs.existsSync(lock)]);pause?.abort();return {content:patch(2,3)};
 }});
 executor.command=async()=>({exitCode:0,stdout:'pass',stderr:''});
 const p={id:'shared',sharedCheckout:true,autoHandoff:true,objective:'Fix answer',...await executor.inspect({repoPath:repo,verification:[{command:['node','--version']}]})};
 const task={id:'t',kind:'codex',title:'Set answer',acceptance:'Answer is three',files:['answer.js'],attempts:[{}]};
 const run=signal=>executor.run(p,task,{signal,checkpoint:fields=>{Object.assign(task.attempts.at(-1),fields);if(fields.worktree)p.worktree=fields.worktree;}});
 await assert.rejects(run(new AbortController().signal),/handoff is ready/i);
 // The outgoing provider's checkpoint is saved and the lock is gone before the next provider is dispatched.
 assert.equal(fs.existsSync(lock),false);
 assert.equal(task.attempts[0].engineeringHandoff.changed[0],'answer.js');assert.ok(task.attempts[0].engineeringHandoff.codexRetryAt>Date.now());
 task.attempts.push({});pause=new AbortController();
 await assert.rejects(run(pause.signal));
 assert.deepEqual(owners,[['codex',true],['claude',true]]);
 assert.equal(fs.existsSync(lock),false);
 assert.equal(fs.readFileSync(path.join(repo,'answer.js'),'utf8'),'module.exports = 2;\n');
 // Resume continues the same saved work with the same provider handoff.
 task.attempts.push({});pause=null;
 const result=await run(new AbortController().signal);
 assert.equal(fs.readFileSync(path.join(repo,'answer.js'),'utf8'),'module.exports = 3;\n');
 assert.equal(result.tests[0].exitCode,0);assert.equal(fs.existsSync(lock),false);
});

test('with neither provider available the wait ends at a confirmed reset or a recheck, never an assumed availability',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'foreman-neither-')),repo=path.join(root,'repo');fs.mkdirSync(repo);
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8'}).trim();
 git('init','-b','main');fs.writeFileSync(path.join(repo,'answer.js'),'module.exports = 1;\n');git('add','.');git('-c','user.name=Test','-c','user.email=test@localhost','commit','-m','baseline');
 const codexReset=Math.floor(Date.now()/1000)+7200,claudeReset=Date.now()+3600000;let dispatched=0,claude;
 const server={readRateLimits:async()=>({rateLimits:{primary:{usedPercent:97,resetsAt:codexReset}}}),request:async()=>({account:{type:'chatgpt'}}),stop:async()=>{},run:async()=>{dispatched++;}};
 const executor=new ForemanExecutor(path.join(root,'state'),{server,advisorLimits:{snapshot:async()=>claude,recordClaude(){}},claudeStatus:async()=>({subscription:false}),runClaude:async()=>{dispatched++;}});
 const p={id:'shared',sharedCheckout:true,autoHandoff:true,objective:'Fix answer',...await executor.inspect({repoPath:repo,verification:[{command:['node','--version']}]})};
 const task={id:'t',kind:'codex',title:'Set answer',acceptance:'Answer is three',files:['answer.js'],attempts:[{}]};
 const run=()=>executor.run(p,task,{signal:new AbortController().signal,checkpoint:fields=>{if(fields.worktree)p.worktree=fields.worktree;}}).then(()=>assert.fail('dispatched'),error=>error);
 claude={checkedAt:Date.now(),windows:[{name:'five_hour',usedPercent:99,resetsAt:claudeReset}]};
 let wait=await run();
 assert.equal(wait.retryAt,claudeReset+60000);assert.match(wait.capacityDetail,/confirmed provider capacity/);
 const justReset=Date.now()-10000;
 claude={checkedAt:Date.now(),limitReached:true,limitResetsAt:justReset,windows:[]};
 wait=await run();
 assert.equal(wait.retryAt,justReset+60000);
 // No usable Claude reading: recheck soon, but never later than Codex's confirmed reset and never a dispatch.
 claude=null;wait=await run();
 assert.ok(wait.retryAt>Date.now()&&wait.retryAt<=codexReset*1000+60000);
 assert.equal(dispatched,0);assert.equal(fs.existsSync(path.join(repo,'.git','nethra-writer.lock')),false);
 assert.equal(fs.readFileSync(path.join(repo,'answer.js'),'utf8'),'module.exports = 1;\n');
});

test('a Claude rejection during handoff waits for the earlier provider reset and resumes the same task',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'foreman-handoff-rejection-')),repo=path.join(root,'repo');fs.mkdirSync(repo);
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8'}).trim();
 git('init','-b','main');fs.writeFileSync(path.join(repo,'answer.js'),'module.exports = 1;\n');git('add','.');git('-c','user.name=Test','-c','user.email=test@localhost','commit','-m','baseline');
 const now=Date.now(),codexReset=Math.floor(now/1000)+7200;
 const baseline=git('rev-parse','HEAD');
 const ready={checkedAt:now,windows:[{name:'five_hour',usedPercent:1,resetsAt:now+10800000}]};
 let claude=ready,rejection,codexReady=false,codexCalls=0,claudeCalls=0;
 const server={readRateLimits:async()=>({rateLimits:{primary:{usedPercent:codexReady?1:97,resetsAt:codexReset}}}),
  request:async method=>method==='command/exec'?{exitCode:0,stdout:'',stderr:''}:{account:{type:'chatgpt'}},
  start:async()=>{},stop:async()=>{},run:async()=>{codexCalls++;return {text:'diff --git a/answer.js b/answer.js\n--- a/answer.js\n+++ b/answer.js\n@@ -1 +1 @@\n-module.exports = 1;\n+module.exports = 2;\n'};}};
 const executor=new ForemanExecutor(path.join(root,'state'),{server,advisorLimits:{snapshot:async()=>claude,recordClaude:value=>{claude={...value,checkedAt:Date.now()};}},claudeStatus:async()=>({subscription:true}),runClaude:async({onRateLimit})=>{
  claudeCalls++;
  if(rejection)onRateLimit(rejection);
  throw Object.assign(new Error('Claude usage limit reached'),{rateLimit:rejection});
 }});
 const p={id:'shared',sharedCheckout:true,autoHandoff:true,objective:'Fix answer',...await executor.inspect({repoPath:repo,verification:[{command:['node','--version']}]})};
 const task={id:'t',kind:'codex',title:'Set answer',acceptance:'Answer is two',files:['answer.js'],attempts:[]};
 const run=()=>{const attempt={};task.attempts.push(attempt);return executor.run(p,task,{signal:new AbortController().signal,checkpoint:fields=>{Object.assign(attempt,fields);if(fields.worktree)p.worktree=fields.worktree;}});};

 for(const reset of [now+3600000,now+10800000]){
  claude=ready;rejection={limitReached:true,limitResetsAt:reset,windows:[]};
  await assert.rejects(run(),error=>error.retryAt===Math.min(reset,codexReset*1000)+60000);
  assert.equal(task.attempts.at(-1).provider,'claude');
  assert.equal(task.attempts.at(-1).engineeringHandoff.codexRetryAt,codexReset*1000+60000);
  assert.equal(fs.readFileSync(path.join(repo,'answer.js'),'utf8'),'module.exports = 1;\n');
 }
 claude=ready;rejection={limitReached:true,limitResetsAt:null,windows:[]};
 const before=Date.now();
 await assert.rejects(run(),error=>error.retryAt>=before+1800000&&error.retryAt<=Date.now()+1800000);
 await assert.rejects(run(),error=>error.retryAt===claude.checkedAt+1800000);
 claude=ready;rejection={limitReached:true,limitResetsAt:now-120000,windows:[]};
 await assert.rejects(run(),error=>error.retryAt>=before+1800000&&error.retryAt<=Date.now()+1800000);
 await assert.rejects(run(),error=>error.retryAt===claude.checkedAt+1800000);
 claude=ready;rejection=null;
 await assert.rejects(run(),error=>error.retryAt>=before+1800000&&error.retryAt<=Date.now()+1800000);
 await assert.rejects(run(),error=>error.retryAt===claude.checkedAt+1800000);
 assert.equal(claudeCalls,5);assert.equal(codexCalls,0);

 codexReady=true;
 fs.writeFileSync(path.join(repo,'answer.js'),'module.exports = 3;\n');
 await assert.rejects(run(),/differs from the saved handoff/);
 assert.equal(codexCalls,0);
 fs.writeFileSync(path.join(repo,'answer.js'),'module.exports = 1;\n');
 const result=await run();
 assert.equal(codexCalls,1);assert.equal(claudeCalls,5);
 assert.equal(result.tests[0].exitCode,0);
 assert.equal(fs.readFileSync(path.join(repo,'answer.js'),'utf8'),'module.exports = 2;\n');
 assert.equal(git('rev-parse','HEAD'),baseline);
});

test('a rejection can trigger one recheck after its deadline despite a recent Claude probe',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'foreman-probe-recheck-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const now=Date.now();let probes=0;
 const rejection={checkedAt:now-1900000,limitReached:true,limitResetsAt:null,windows:[]};
 const executor=new ForemanExecutor(root,{server:{},advisorLimits:{snapshot:async()=>rejection},
  claudeStatus:async()=>({subscription:true}),runClaude:async()=>{probes++;}});
 executor.lastClaudeProbeAt=now-2000000;
 assert.equal((await executor.claudeCapacity({probe:true})).ready,false);
 assert.equal((await executor.claudeCapacity({probe:true})).ready,false);
 assert.equal(probes,1);
});

test('a repository-root patch for a scoped subfolder applies only inside that folder',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'foreman-root-patch-')),scope=path.join(root,'apps','windows');
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(scope,{recursive:true});execFileSync('git',['init','-b','main'],{cwd:root});
 fs.writeFileSync(path.join(scope,'answer.js'),'module.exports = 1;\n');fs.writeFileSync(path.join(root,'outside.js'),'outside\n');
 const e=new ForemanExecutor(path.join(root,'state'),{server:{}}),p={repoPath:scope};
 const diff=name=>`diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n-module.exports = 1;\n+module.exports = 2;\n`;
 await assert.rejects(e.applySharedPatch(p,scope,diff('apps/windows/answer.js')+diff('outside.js').replace(/module\.exports = 1;/,'outside').replace(/module\.exports = 2;/,'changed'),[],await e.sourceHash(scope,true)),/additional file scope|scope/);
 assert.equal(fs.readFileSync(path.join(root,'outside.js'),'utf8'),'outside\n');
 await e.applySharedPatch(p,scope,diff('apps/windows/answer.js'),[],await e.sourceHash(scope,true));
 assert.equal(fs.readFileSync(path.join(scope,'answer.js'),'utf8'),'module.exports = 2;\n');
});
