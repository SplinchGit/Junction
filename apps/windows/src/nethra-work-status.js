'use strict';
const {createHash}=require('node:crypto');
const {NethraAttention}=require('./nethra-attention');

/** The objective's read-only view of durable Work Activity state. */
function createWorkStatus(foreman){
  return id=>{
    try{
      const project=foreman.get(id);
      const promoted=project.tasks.flatMap(task=>task.attempts||[]).filter(attempt=>attempt.status==='COMPLETED'&&attempt.promoted).map(attempt=>attempt.finishedAt).filter(Number.isFinite);
      // Nethra candidates are applied only after separate owner review. Their
      // attempts deliberately have no automatic promotion receipt.
      if(Number.isSafeInteger(project.appliedAt)&&project.appliedAt>0)promoted.push(project.appliedAt);
      return {status:project.status,promotedAt:promoted.length?Math.max(...promoted):null};
    }catch{return null;}
  };
}

/** Reconcile durable executor state so missed notifications survive host restart. */
function reconcileCodeWork({store,projects,now=Date.now()}){
  const attention=new NethraAttention(store,{now:()=>now});let observed=0;
  for(const project of projects){
    if(!project.sourceObjectiveId)continue;
    let task;
    try{task=store.get(project.sourceObjectiveId);}catch(error){if(/Unknown Nethra task/.test(error.message))continue;throw error;}
    if(!task.allowCodeWork||['PAUSED','WAITING_FOR_USER','BLOCKED','COMPLETED','CANCELLED','FAILED'].includes(task.status))continue;
    const attempt=project.tasks?.flatMap(item=>item.attempts||[]).at(-1);
    const revision=createHash('sha256').update(JSON.stringify([project.status,project.verifiedSha||null,project.appliedAt||null,attempt?.startedAt||null,attempt?.finishedAt||null])).digest('hex');
    const result=attention.observe({taskId:task.id,source:'code-work',sourceId:project.id,revision,kind:'CODE_WORK_CHANGED',evidenceRef:`work:${project.id}`,priority:task.priority||3});
    if(result.created)observed++;
  }
  return observed;
}

module.exports={createWorkStatus,reconcileCodeWork};
