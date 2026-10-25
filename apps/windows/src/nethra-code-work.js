'use strict';
const fs=require('node:fs');
const path=require('node:path');

function createCodeWorkProposer({foreman,junctionRepository}){
  return async ({objective,description,acceptance})=>{
    const root=fs.realpathSync(junctionRepository);
    if(!objective.allowCodeWork||!(objective.readRoots||[]).some(item=>{try{return fs.realpathSync(item)===root;}catch{return false;}}))throw new Error('Approve the Junction read folder and Codex work on Windows first');
    const existing=foreman.list().find(project=>project.sourceObjectiveId===objective.id);
    if(existing)return {id:existing.id,status:existing.status};
    const project=await foreman.create({name:'Nethra Windows Self Improvement',repoPath:path.join(root,'apps','windows'),sourceObjectiveId:objective.id,conversationId:objective.conversationId,objective:`Nethra objective: ${objective.goal}. ${description}`,tasks:[{title:description,kind:'codex',acceptance}],verification:[{command:[process.platform==='win32'?'npm.cmd':'npm','test'],cwd:'.',protectedPaths:['test','package.json']}]});
    return {id:project.id,status:project.status};
  };
}
module.exports={createCodeWorkProposer};
