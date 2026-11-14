'use strict';
// "Since we last spoke": a host-written digest of the objective journal (Samantha M5 step 1).
// No model call and no memory write. Every fact names the journal events it was built from, and
// the only free text is each objective's goal. Model-written summaries and questions are left out.
const short=(value,max=70)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const QUESTION_KINDS=new Set(['nethra_input_required','EVIDENCE_ONLY_STOPPED','NO_NEW_EVIDENCE_STOPPED','YIELD_EXHAUSTED','RETRY_EXHAUSTED','nethra_action_review','COORDINATION_DECISION']);
const APPROVAL_KINDS=new Set(['APPROVAL_REQUESTED','APPROVAL_RENEWED','nethra_approval_required']);
const plural=(count,word)=>`${count} ${word}${count===1?'':'s'}`;
function span(ms){
  if(ms<90_000)return 'under two minutes';
  if(ms<5_400_000)return `${Math.round(ms/60_000)} minutes`;
  if(ms<172_800_000)return `${Math.round(ms/3_600_000)} hours`;
  return `${Math.round(ms/86_400_000)} days`;
}

/** When the owner last wrote in any conversation, ignoring a message newer than `excludeWithinMs` (the turn being answered). */
function ownerLastSpokeAt(localData,{now=Date.now(),excludeWithinMs=0}={}){
  let latest=null;
  for(const conversation of localData?.state?.conversations||[])for(const message of conversation.messages||[]){
    if(message.role!=='user'||(message.provenance&&message.provenance!=='OWNER')||!Number.isFinite(message.createdAt))continue;
    if(message.createdAt>now-excludeWithinMs)continue;
    if(latest===null||message.createdAt>latest)latest=message.createdAt;
  }
  return latest;
}

/**
 * Facts from the journal since `since`, most important first. Facts about something waiting for the
 * owner are included only while the store still shows it waiting, so the digest stays true now.
 */
function sinceLastSpoke({store,since,now=Date.now()}){
  const events=store.recentEvents(since,2000).filter(event=>event.at<=now).reverse();
  const tasks=new Map(store.list().map(task=>[task.id,task]));
  const byTask=new Map();
  for(const event of events){if(!tasks.has(event.taskId))continue;if(!byTask.has(event.taskId))byTask.set(event.taskId,[]);byTask.get(event.taskId).push(event);}
  const name=task=>`“${short(task.goal)}”`;
  const groups={approval:[],question:[],completed:[],milestone:[],failure:[],budget:[]};
  const missed=[];let passes=0;const worked=new Set();
  for(const [taskId,list] of byTask){
    const task=tasks.get(taskId),of=kinds=>list.filter(event=>typeof kinds==='string'?event.kind===kinds:kinds.has(event.kind));
    const fact=(kind,line,source)=>({kind,taskId,line,at:source.at(-1).at,seqs:source.map(event=>event.seq)});
    const pending=(store.approvals?.(taskId)||[]).filter(item=>item.status==='PENDING');
    const approvals=of(APPROVAL_KINDS);
    if(approvals.length&&pending.length)groups.approval.push(fact('approval',`${name(task)} is waiting for your approval (${plural(pending.length,'request')}).`,approvals));
    const questions=of(QUESTION_KINDS);
    if(questions.length&&task.status==='WAITING_FOR_USER'&&!pending.length)groups.question.push(fact('question',`${name(task)} stopped and is waiting for your answer.`,[questions.at(-1)]));
    const completed=of('nethra_completed');
    if(completed.length)groups.completed.push(fact('completed',`${name(task)} finished.`,completed));
    const milestones=of('MILESTONE_VERIFIED');
    if(milestones.length)groups.milestone.push(fact('milestone',`${name(task)} reached ${plural(milestones.length,'verified milestone')}.`,milestones));
    const retries=of('RETRY_SCHEDULED');
    if(retries.length)groups.failure.push(fact('failure',`${name(task)} had ${retries.length===1?'1 failed work pass':`${retries.length} failed work passes`} and scheduled a retry.`,retries));
    const budget=of('BUDGET_WAIT');
    if(budget.length)groups.budget.push(fact('budget',`${name(task)} paused at the daily model-time limit.`,budget));
    missed.push(...of('MISSED'));
    const claimed=of('CLAIMED');if(claimed.length){passes+=claimed.length;worked.add(taskId);}
  }
  const facts=[...groups.approval,...groups.question,...groups.completed,...groups.milestone,...groups.failure,...groups.budget];
  if(missed.length){
    const longest=Math.max(...missed.map(event=>Number(event.detail?.gapMs)||0));
    facts.push({kind:'missed',taskId:null,line:`${plural(missed.length,'scheduled wake')} ${missed.length===1?'was':'were'} missed while the PC app was not running${longest?` (longest delay ${span(longest)})`:''}.`,at:missed.at(-1).at,seqs:missed.map(event=>event.seq)});
  }
  if(passes)facts.push({kind:'passes',taskId:null,line:`${passes===1?'1 work pass':`${passes} work passes`} ran across ${plural(worked.size,'objective')}.`,at:events.at(-1).at,seqs:events.filter(event=>event.kind==='CLAIMED'&&tasks.has(event.taskId)).map(event=>event.seq)});
  const next=[...tasks.values()].filter(task=>task.status==='SLEEPING'&&Number.isSafeInteger(task.nextWakeAt)).sort((a,b)=>a.nextWakeAt-b.nextWakeAt)[0];
  return {since,asOf:now,facts,nextWake:next?{taskId:next.id,at:next.nextWakeAt,goal:short(next.goal)}:null};
}

/** The digest as host facts for the chat context, whole lines only, inside `max` characters. */
function digestText(digest,{now=Date.now(),max=700}={}){
  const head=`- Since the owner last wrote (${span(now-digest.since)} ago), from the objective journal:`;
  if(!digest.facts.length)return `${head} nothing was recorded. If asked what happened, say nothing has happened on objectives since then.`;
  let text=head;
  for(const fact of digest.facts){if(text.length+fact.line.length+1>max)break;text+=` ${fact.line}`;}
  return text;
}
module.exports={sinceLastSpoke,digestText,ownerLastSpokeAt};
