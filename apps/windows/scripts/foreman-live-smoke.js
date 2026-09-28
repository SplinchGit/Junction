"use strict";
// Explicitly invoked integration proof. Uses the owner's existing Codex login once.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');const {Foreman}=require('../src/foreman');const {ForemanExecutor}=require('../src/foreman-executor');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'junction-foreman-live-')),repo=path.join(root,'source');fs.mkdirSync(repo);
 fs.writeFileSync(path.join(repo,'answer.js'),'module.exports = n => n + 1;\n');
 fs.writeFileSync(path.join(repo,'answer.test.js'),"const {test}=require('node:test');const assert=require('node:assert/strict');test('adds two',()=>assert.equal(require('./answer')(3),5));\n");
 const git=args=>execFileSync('git',['-C',repo,...args],{windowsHide:true,stdio:'pipe'});git(['init']);git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','-m','Fixture baseline']);
 const state=path.join(root,'state'),executor=new ForemanExecutor(path.join(root,'work'));let f=new Foreman(state,{executor});
 try{
  const p=await f.create({name:'Integration fixture',repoPath:repo,objective:'Fix answer.js to add two, keeping the existing test unchanged.',verification:[{command:['node','answer.test.js'],cwd:'.',timeoutMs:30000}],tasks:[{title:'Change answer.js to add two',kind:'codex',acceptance:'answer(3) equals 5 and the existing answer.test.js passes unchanged',files:['answer.js','answer.test.js']}]});
  console.log(JSON.stringify({stage:'created',root,projectId:p.id}));await f.control(p.id,'start',p.revision,'smoke-start');await f.idle();const result=f.get(p.id);console.log(JSON.stringify({stage:'result',status:result.status,handoff:result.handoff,retryAt:result.retryAt,tasks:result.tasks}));
  assert.equal(result.status,'COMPLETED');assert.equal(fs.readFileSync(path.join(repo,'answer.js'),'utf8'),'module.exports = n => n + 1;\n');
  await f.shutdown();f.close();f=new Foreman(state,{executor});assert.equal(f.get(p.id).status,'COMPLETED');console.log(JSON.stringify({passed:true,root,head:result.verifiedSha,events:f.events(p.id).length}));
 }finally{await f.shutdown();f.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
