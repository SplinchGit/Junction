"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {resolveOwnerWork}=require("../src/owner-work");

test("a conversational development request resolves an existing local folder",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"junction-owner-work-"));
  const civlets=path.join(root,"Civlets");fs.mkdirSync(civlets);
  const result=resolveOwnerWork({content:"Please keep working on Civlets and fix the failing build",conversationId:"chat",projects:[],roots:[root]});
  assert.equal(result.action,"submit");assert.equal(result.scopePath,fs.realpathSync(civlets));
  assert.match(result.task,/fix the failing build/i);
});

test("continue uses conversation context and stop is an immediate control",()=>{
  const projects=[{id:"p",name:"Neon Loft",repoPath:"C:\\art\\Neon Loft",conversationId:"chat",status:"PAUSED",updatedAt:2}];
  assert.deepEqual(resolveOwnerWork({content:"continue with the lighting pass",conversationId:"chat",projects,roots:[]}),{action:"submit",projectId:"p",task:"continue with the lighting pass"});
  assert.deepEqual(resolveOwnerWork({content:"stop working on this",conversationId:"chat",projects,roots:[]}),{action:"stop",projectId:"p"});
});
test("a named existing scope is continued instead of duplicated",()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"junction-existing-"));fs.mkdirSync(path.join(root,"Civlets"));const projects=[{id:"c",name:"Civlets",repoPath:path.join(root,"Civlets"),status:"DRAFT",updatedAt:1}];
 assert.deepEqual(resolveOwnerWork({content:"Work on Civlets and repair the build",conversationId:"new",projects,roots:[root]}),{action:"submit",projectId:"c",task:"Work on Civlets and repair the build"});
});

test("discussion about a project is not treated as authority to edit",()=>{
  assert.equal(resolveOwnerWork({content:"What do you think about the Civlets architecture?",conversationId:"chat",projects:[],roots:[]}),null);
});
