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

const tracked=[{id:"p",name:"Junction",conversationId:"chat",status:"PAUSED",updatedAt:2}];
test("work questions report status without adding work",()=>{
 for(const content of ["What are you working on?","How is the work going?","What's the status of Junction?","Show me the current tasks","Give me an update on Junction"])
  assert.deepEqual(resolveOwnerWork({content,conversationId:"chat",projects:tracked}),{action:"status",projectId:"p"},content);
 assert.deepEqual(resolveOwnerWork({content:"Show all work status",projects:tracked}),{action:"status",projectId:null});
});
test("pause and resume control the existing queue",()=>{
 for(const [content,action] of [["Pause the work","pause"],["Please pause Junction","pause"],["resume","resume"],["continue","resume"],["Continue working on Junction","resume"],["Stop Junction","stop"]])
  assert.deepEqual(resolveOwnerWork({content,conversationId:"chat",projects:tracked}),{action,projectId:"p"},content);
});
test("capability discussion and control questions never execute work",()=>{
 for(const content of ["How do I stop working on this?","Can you explain how to pause the work?","I'd like Junction to be able to create agents and update emails","I'd like to get Junction an agents mode that can create emails","Can you create emails?","I think we should update Junction someday","Don't stop working on this"])
  assert.equal(resolveOwnerWork({content,conversationId:"chat",projects:tracked}),null,content);
});
test("concrete polite changes still submit work",()=>{
 for(const content of ["Please fix the failing build","Can you fix the broken login button?","Update the header colour to blue"])
  assert.deepEqual(resolveOwnerWork({content,conversationId:"chat",projects:tracked}),{action:"submit",projectId:"p",task:content});
});
