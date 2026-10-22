"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {Foreman}=require("../src/foreman");
const {handleOwnerWorkInstruction}=require("../src/owner-work-handler");

async function fixture(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"junction-owner-handler-"));
 // Only the external executor is replaced; persistence, scheduling and controls are real.
 const foreman=new Foreman(path.join(root,"state"),{executor:{
  inspect:async()=>({}),
  run:(_p,_task,{signal})=>new Promise(resolve=>signal.addEventListener("abort",()=>resolve({tests:[]}),{once:true}))
 }});
 t.after(async()=>{await foreman.shutdown();foreman.close();fs.rmSync(root,{recursive:true,force:true});});
 const project=await foreman.create({name:"Junction",repoPath:root,conversationId:"chat",objective:"Repair approved controls",tasks:[{title:"Repair controls",acceptance:"Controls work"}]});
 const send=content=>handleOwnerWorkInstruction({foreman,roots:[root],content,conversationId:"chat"});
 return {foreman,project,send,root};
}

test("owner pause, resume and stop preserve the saved queue and interrupted attempts",async t=>{
 const {foreman,project,send}=await fixture(t);
 const resumed=await send("Resume Junction");
 assert.equal(resumed?.status,"RUNNING");assert.equal(resumed.id,project.id);
 const paused=await send("Pause Junction");
 await foreman.idle();
 assert.equal(paused.status,"PAUSED");
 assert.equal(foreman.get(project.id).tasks.length,1);
 assert.equal(foreman.get(project.id).tasks[0].attempts[0].status,"INTERRUPTED");
 await send("Continue Junction");
 const stopped=await send("Stop Junction");await foreman.idle();
 assert.equal(stopped.status,"STOPPED");
 assert.equal(foreman.get(project.id).tasks.length,1);
 assert.equal(foreman.get(project.id).tasks[0].attempts.length,2);
});

test("status reports saved progress without changing revisions or creating tasks",async t=>{
 const {foreman,project,send}=await fixture(t);
 const p=foreman.get(project.id);
 p.handoff="Build failed: missing asset";p.nextAction="Restore asset then resume";p.status="BLOCKED";
 foreman.save(p,"BLOCKED",p.handoff);
 const before=foreman.get(project.id),result=await send("What's the status of Junction?");
 assert.equal(result?.status,"BLOCKED");assert.match(result.response,/Build failed: missing asset/);
 assert.match(result.response,/Restore asset then resume/);
 assert.deepEqual(foreman.get(project.id),before);
});

test("resuming active or completed work reports its actual status without another task",async t=>{
 const {foreman,project,send}=await fixture(t);
 await send("Resume Junction");
 assert.equal((await send("Resume Junction"))?.status,"RUNNING");
 await send("Pause Junction");await foreman.idle();
 const p=foreman.get(project.id);p.status="COMPLETED";p.tasks[0].status="COMPLETED";foreman.save(p,"COMPLETED","Done");
 const before=foreman.get(project.id);
 assert.equal((await send("Continue Junction")).status,"COMPLETED");
 assert.deepEqual(foreman.get(project.id),before);
});

test("concrete owner follow-up is queued with original objective and existing scope",async t=>{
 const {foreman,project,send}=await fixture(t);
 const result=await send("Fix the broken login button");
 assert.equal(result?.id,project.id);assert.equal(result.status,"RUNNING");
 const saved=foreman.get(project.id);
 assert.equal(saved.repoPath,project.repoPath);
 assert.equal(saved.objective,"Fix the broken login button");
 assert.equal(saved.tasks[0].title,"Fix the broken login button");
});

test("unscoped requests ask for scope and discussion stays in chat",async t=>{
 const {foreman,root}=await fixture(t);
 const before=foreman.list();
 const result=await handleOwnerWorkInstruction({foreman,roots:[root],content:"Fix NeverExistingWidget",conversationId:"other"});
 assert.equal(result?.status,"NEEDS_SCOPE");
 assert.equal(await handleOwnerWorkInstruction({foreman,content:"What do you think of Junction?"}),null);
 assert.deepEqual(foreman.list(),before);
});
