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
      return {status:project.status,pausedByObjective:project.pausedByObjective||null,sharedCheckout:project.sharedCheckout===true,codeReviewVerdict:project.codeReviewVerdict||null,sourceObjectiveId:project.sourceObjectiveId||null,conversationId:project.conversationId||null,coordinationBrief:project.coordinationBrief,retryAt:project.retryAt,nextAction:project.nextAction,blocker:project.status==='BLOCKED'?project.handoff:null,promotedAt:promoted.length?Math.max(...promoted):null};
    }catch{return null;}
  };
}

/** Bounded Work Activity status for the Tasks views: who is working, what was last verified, what blocks it and when it is next checked. */
function codeWorkSummary(project){
  const active=project.tasks?.find(task=>task.id===project.activeTask)?.attempts.at(-1);
  const verified=(project.tasks||[]).flatMap(task=>(task.attempts||[]).map(attempt=>({attempt,title:task.title})))
    .filter(({attempt})=>attempt.status==='COMPLETED'&&attempt.tests?.length&&attempt.tests.every(test=>test.exitCode===0))
    .sort((a,b)=>(a.attempt.finishedAt||0)-(b.attempt.finishedAt||0)).at(-1);
  const waiting=['WAITING_CAPACITY','WAITING_CODEX'].includes(project.status);
  return {id:project.id,status:project.status,nextAction:String(project.nextAction||'').slice(0,240),provider:active?.provider||null,phase:active?.phase||null,
    retryAt:waiting&&Number.isFinite(project.retryAt)?project.retryAt:null,
    lastVerified:verified?{summary:String(verified.attempt.summary||verified.title).slice(0,240),at:verified.attempt.finishedAt||null}:null,
    blocker:project.status==='BLOCKED'?String(project.handoff||'').slice(0,240):null};
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

module.exports={createWorkStatus,reconcileCodeWork,codeWorkSummary};
