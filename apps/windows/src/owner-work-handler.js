"use strict";
const crypto = require("node:crypto");
const { resolveOwnerWork } = require("./owner-work");
function report(project) {
 const completed=project.tasks.filter(task=>task.status==="COMPLETED").length;
 return {id:project.id,status:project.status,response:`${project.name}: ${project.status}. ${completed}/${project.tasks.length} tasks completed. ${project.handoff || ""} Next: ${project.nextAction || "Awaiting owner instruction"}.`};
}
async function handleOwnerWorkInstruction({foreman,roots=[],content,conversationId=null}) {
 const projects=foreman.list(), instruction=resolveOwnerWork({content,conversationId,projects,roots});
 if(!instruction)return null;
 if(instruction.action==="needs_scope")return {id:null,status:"NEEDS_SCOPE",response:"Name the project or provide its folder path so I can work in the correct scope."};
 if(instruction.action==="status") {
  if(instruction.projectId)return report(foreman.get(instruction.projectId));
  return {id:null,status:"STATUS",response:projects.length?projects.map(project=>report(project).response).join("\n"):"There is no saved work yet."};
 }
 if(instruction.action==="submit")return report(await foreman.submit({projectId:instruction.projectId,repoPath:instruction.scopePath,name:instruction.name,task:instruction.task,objective:instruction.task,conversationId}));
 const project=foreman.get(instruction.projectId);
 if(instruction.action==="resume"&&["RUNNING","WAITING_CODEX","VERIFYING","COMPLETED"].includes(project.status))return report(project);
 return report(await foreman.control(project.id,instruction.action,project.revision,crypto.randomUUID()));
}
module.exports = {handleOwnerWorkInstruction};
