'use strict';
const fs=require('node:fs');
const path=require('node:path');
const measurableAcceptance=value=>typeof value==='string'&&value.trim().length>=30;

function createCodeWorkProposer({foreman,junctionRepository}){
  return async ({objective,description,acceptance,review})=>{
    const root=fs.realpathSync(junctionRepository);
    if(!objective.allowCodeWork||!(objective.readRoots||[]).some(item=>{try{return fs.realpathSync(item)===root;}catch{return false;}}))throw new Error('Approve the Junction read folder and Codex work on Windows first');
    if(review?.source!=='codex'||typeof review.advice!=='string'||!review.advice.trim())throw new Error('A read-only Codex review of this code proposal is required first');
    if(!measurableAcceptance(acceptance))throw new Error('Provide measurable acceptance criteria before creating a code draft');
    const title=description.trim().replace(/\s+/g,' ').slice(0,240);
    const existing=foreman.list().find(project=>project.sourceObjectiveId===objective.id&&project.tasks?.some(task=>task.title===title&&task.acceptance===acceptance));
    if(existing)return {id:existing.id,status:existing.status};
    const project=await foreman.create({name:'Nethra Windows Self Improvement',repoPath:path.join(root,'apps','windows'),sourceObjectiveId:objective.id,conversationId:objective.conversationId,objective:`Nethra objective: ${objective.goal}. Proposed change: ${description}. Read-only Codex review (${String(review.model||'Codex').slice(0,80)}): ${review.advice.slice(0,1600)}. Owner Start is required before implementation; owner review and Apply are required before original-checkout changes.`,tasks:[{title,kind:'codex',acceptance}],verification:[{command:[process.platform==='win32'?'npm.cmd':'npm','test'],cwd:'.',protectedPaths:['test','package.json']}]});
    return {id:project.id,status:project.status};
  };
}
module.exports={createCodeWorkProposer,measurableAcceptance};
