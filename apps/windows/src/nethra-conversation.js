'use strict';
const {randomUUID}=require('node:crypto');
const path=require('node:path');

const FINISHED=new Set(['COMPLETED','CANCELLED','FAILED']);
const short=(value,max=500)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const normalized=value=>short(value,2000).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const TASK_CUE=/\b(?:task|tasks|objective|goal|approval|draft|work on|working on|continue|resume|pick up|carry on|already (?:be|is|was) one|that one|the one|how about now|performance|response times)\b/i;
const ACTIVE_REFERENCE=/\b(?:the|my|our|current|active|existing)\s+(?:task|objective|goal)\b/i;
const CONTINUE=/^(?:(?:ok(?:ay)?|right|well|yes|so)[,.\s]+)*(?:(?:please|can (?:you|we)|could (?:you|we)|would you|will you|let(?:'s| us))\s+)?(?:continue|resume|pick up|carry on|keep (?:going|working on)|work on (?:it|this|that|the (?:task|objective)|my task))\b/i;
const NEGATED_CONTROL=/\b(?:don['’]?t|do not|never|not yet|no need to)\b/i;
const DIRECTION=/^(?:basically\b|the goal is\b|it(?:'s| is) to\b|focus on\b|please (?:focus|use)\b)/i;
const BRIEF_STATUS=/^(?:now|how about now|how(?:'s| is) it (?:doing|going|coming along)|any (?:progress|news|update)|what(?:'s| is) happening|is it (?:working|running|done))\s*[?.!]*$/i;
const STATUS_QUESTION=/^(?:how (?:is|are|has)\b[\s\S]{0,120}\b(?:doing|going|coming along|progressing)|what(?:'s| is)\s+(?:the\s+)?(?:status|progress)\b|(?:show|tell me)\s+(?:the\s+)?(?:status|progress)\b|there should already\b)[\s\S]*[?.!]*$|^(?:can|could)\s+(?:you|we)\s+(?:see|find)\s+(?:it|that one|this one|(?:the|that|this|my|current)\s+(?:task|objective|goal))\s*[?.!]*$/i;
const SKIP_DRAFT=/\b(?:skip|set aside|move past|pass on)\b.{0,50}\b(?:draft|approval|overwrite)\b|\b(?:continue|carry on|keep working)\b.{0,50}\bwithout\b.{0,50}\b(?:draft|approval|overwrite)\b|^(?:set (?:it|that) aside|skip (?:it|that)) and continue\b/i;

const isTaskContinuation=content=>CONTINUE.test(content)&&!NEGATED_CONTROL.test(content)&&!DIRECTION.test(content);

function approvalPath(task,approval){
  const value=String(approval.args?.path||'').trim();
  if(!value)return 'an existing draft';
  const portable=value.replaceAll('\\','/'),marker=`/workspaces/${task.id}/`;
  const inside=portable.toLowerCase().indexOf(marker.toLowerCase());
  if(inside>=0)return short(portable.slice(inside+marker.length),180);
  const relative=task.workspace&&path.isAbsolute(value)?path.relative(task.workspace,value):value;
  return short(relative&&!relative.startsWith('..')?relative:value,180);
}

function continuationGate(task,approvals,progress=null){
  const drafts=approvals.filter(item=>item.status==='PENDING'&&item.tool==='write_draft');
  if(drafts.length)return `“${short(task.goal,160)}” has not resumed. Its goal is: ${short(task.successCriteria||task.goal,350)}. Pending approval to overwrite ${drafts.map(item=>`“${approvalPath(task,item)}”`).join(', ')}. Review the exact proposed content and approve or reject it in Tasks. If you want to move on without that overwrite, say “skip that draft and continue”; Nethra will set it aside and replan from the saved goal.`;
  return `“${short(task.goal,160)}” has not resumed. ${short(progress?.waitingFor?.detail||task.summary||'It needs your answer in Tasks before continuing.',350)}`;
}

async function continueReviewedTask({api,task,approvals=[],requestId,source}){
  if(task.status!=='WAITING_FOR_USER'||approvals.some(item=>item.status==='PENDING')||!/^Two code proposals were rejected in this work pass\./.test(task.summary||''))return null;
  const answer='Continue the saved task using its technical reviewer feedback. Gather missing evidence, revise the plan, save useful results and schedule the next step. This continuation replaces the old instruction to wait after two rejected proposals. Ask the owner only for unavailable access or a decision the host cannot supply.';
  await api.dispatch('nethra.answer',{id:task.id,answer,revision:task.revision},`${requestId}:continue-review`,source);
  return `Queued “${short(task.goal,160)}” to continue from its saved technical review. It will gather the missing evidence and revise its work; the existing plan and results are preserved.`;
}

/** Resolve a conversational reference against durable work, never against a model's claim. */
function focusedTask(tasks,content,conversationId,history=[]){
  const current=normalized(content);
  const named=tasks.filter(task=>normalized(task.goal).length>=4&&current.includes(normalized(task.goal)));
  if(named.length===1)return named[0];
  const allLinked=tasks.filter(task=>task.conversationId&&task.conversationId===conversationId);
  const activeLinked=allLinked.filter(task=>!FINISHED.has(task.status));
  const linked=activeLinked.length?activeLinked:allLinked;
  if(linked.length===1)return linked[0];
  if(linked.length>1)return null;
  for(const message of [...history].slice(-8).reverse()){
    const line=normalized(message?.content);
    const matches=tasks.filter(task=>normalized(task.goal).length>=4&&line.includes(normalized(task.goal)));
    if(matches.length===1)return matches[0];
  }
  const open=tasks.filter(task=>!FINISHED.has(task.status));
  return open.length===1?open[0]:null;
}

function taskSummary(task,detail){
  const current=detail?.task||task;
  const pending=(detail?.approvals||[]).filter(item=>item.status==='PENDING');
  const gate=detail?.progress?.waitingFor;
  const lines=[`“${short(current.goal,160)}” exists and is ${String(current.status).toLowerCase().replaceAll('_',' ')}.`];
  if(current.successCriteria)lines.push(`Its success criteria: ${short(current.successCriteria,650)}`);
  if(current.plan?.length)lines.push(`Saved plan: ${current.plan.map(step=>short(step,130)).join('; ')}.`);
  if(current.summary)lines.push(`Latest task note: ${short(current.summary,240)}.`);
  if(pending.length)lines.push(`Pending approval in Tasks: ${pending.map(item=>`${short(item.tool||item.action||'an action',70)} for “${approvalPath(current,item)}”`).join(', ')}. Review and approve or reject the exact action there; or say “skip that draft and continue” to set it aside and replan.`);
  else if(gate&&['input','blocked','owner_resume'].includes(gate.kind))lines.push(`Needs from you: ${short(gate.detail,250)}.`);
  if(current.conversationId)lines.push('Its task chat and work log are saved; open them from Tasks.');
  lines.push(`Task model: ${current.model||'qwen3:30b'}. Changing the chat model does not erase this work.`);
  return lines.join('\n');
}

/** Handle task follow-ups that ordinary chat models otherwise answer from stale history. */
async function handleTaskFollowup({api,store,content,conversationId=null,history=[],requestId,source='desktop'}){
  if(!api||!store||typeof content!=='string'||!content.trim()||content.length>10000)return null;
  const tasks=store.list();
  const task=focusedTask(tasks,content,conversationId,history);
  if(!task)return null;
  const hasRecentFocus=history.slice(-8).some(message=>normalized(message?.content).includes(normalized(task.goal)));
  const linked=task.conversationId===conversationId;
  const uniqueLinked=linked&&tasks.filter(item=>item.conversationId===conversationId&&!FINISHED.has(item.status)).length===1;
  const named=normalized(content).includes(normalized(task.goal));
  if(!named&&!linked&&!hasRecentFocus&&!ACTIVE_REFERENCE.test(content))return null;
  if(!TASK_CUE.test(content)&&!BRIEF_STATUS.test(content)&&!named)return null;
  requestId||=randomUUID();
  // A linked task chat already has a durable owner-note path for ordinary directions.
  if(uniqueLinked&&DIRECTION.test(content))return null;
  const statusQuery=BRIEF_STATUS.test(content)||STATUS_QUESTION.test(content);
  const control=CONTINUE.test(content)||SKIP_DRAFT.test(content);
  // A task's own chat is an input channel. Only explicit status/control requests
  // belong in this deterministic status path; other messages reach the worker.
  if(uniqueLinked&&!statusQuery&&!control)return null;
  let {task:current,...detail}=await api.dispatch('nethra.get',{id:task.id},`${requestId}:task-detail`,source);
  if(SKIP_DRAFT.test(content)&&!NEGATED_CONTROL.test(content)&&!FINISHED.has(current.status)){
    const skipId=`${requestId}:skip-pending-draft`;
    const pending=(detail.approvals||[]).filter(item=>item.status==='PENDING'&&item.tool==='write_draft');
    const alreadyApplied=(store.get(current.id).ownerInputs||[]).some(item=>item.requestId===skipId&&item.kind==='redirect');
    if(!pending.length&&!alreadyApplied)return `There is no pending draft overwrite for “${short(current.goal,160)}” to skip.\n${taskSummary(current,detail)}`;
    if(!alreadyApplied){
      const instruction=`The owner asked to continue the saved objective without the pending draft overwrite. Set that draft aside, replan useful work from the existing success criteria, and request a fresh exact approval before any overwrite. ${short(content,500)}`;
      await api.dispatch('nethra.redirect',{id:current.id,instruction,revision:current.revision,skipPendingDrafts:true},skipId,source);
    }
    ({task:current,...detail}=await api.dispatch('nethra.get',{id:current.id},`${requestId}:task-detail-after-skip`,source));
    return `I set aside the pending draft overwrite and queued “${short(current.goal,160)}” to replan from its saved goal. No file was overwritten.\n${taskSummary(current,detail)}`;
  }
  if(CONTINUE.test(content)&&!NEGATED_CONTROL.test(content)&&!DIRECTION.test(content)&&!FINISHED.has(current.status)){
    const continued=await continueReviewedTask({api,task:current,approvals:detail.approvals||[],requestId,source});
    if(continued)return continued;
    if(current.status==='WAITING_FOR_USER'||current.status==='BLOCKED')return continuationGate(current,detail.approvals||[],detail.progress);
    if(current.status==='PAUSED'||current.status==='SLEEPING'){
      const action=current.status==='PAUSED'?'resume':'wake';
      const result=await api.dispatch('nethra.control',{id:current.id,action,revision:current.revision},`${requestId}:task-${action}`,source);
      current=result.task;
    }
  }else if((DIRECTION.test(content)||(!uniqueLinked&&named&&!statusQuery))&&!FINISHED.has(current.status)&&!NEGATED_CONTROL.test(content)){
    const result=store.chatTurn(current.id,content,`${requestId}:task-note`,{conversationId});
    current=result.task;
    return `I saved your direction for “${short(current.goal,160)}”.\n${taskSummary(current,detail)}`;
  }
  return taskSummary(current,detail);
}

module.exports={focusedTask,taskSummary,continuationGate,continueReviewedTask,isTaskContinuation,handleTaskFollowup};
