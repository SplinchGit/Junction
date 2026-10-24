'use strict';
const {createHash}=require('node:crypto');
const {inQuietHours,waitingFor}=require('./nethra-progress');

const REPORTABLE=new Set(['COMPLETED','WAITING_FOR_USER','BLOCKED','FAILED']);

/**
 * Proactive updates follow the owner's settings: ALL posts milestones and outcomes,
 * IMPORTANT posts only outcomes that finish or need the owner, OFF keeps both in Tasks.
 * During quiet hours nothing is posted and the durable cursors are left untouched, so the
 * update arrives once quiet hours end rather than being lost.
 */
function deliveryPolicy(settings,date=new Date()){
  const mode=settings?.proactiveUpdates||'ALL';
  return {quiet:inQuietHours(settings,date),milestones:mode==='ALL',outcomes:mode!=='OFF'};
}

/** The journal event is the durable outbox; the message ID makes crash retries safe. */
function postMilestones(task,store,localData,{settings=null,date=new Date()}={}){
  if(task.mode!=='ONGOING'||!task.conversationId||!localData.conversation(task.conversationId))return 0;
  const policy=deliveryPolicy(settings,date);
  if(settings&&policy.quiet)return 0;
  let posted=0;
  for(const event of store.milestoneEvents(task.id,localData.milestoneCursor(task.id))){
    const summary=String(event.detail?.summary||'').trim().slice(0,1200);
    if(!summary||(settings&&!policy.milestones)){localData.markMilestoneDelivered(task.id,event.seq);continue;}
    const messageId=`nethra-milestone-${event.seq}`;
    const text=`Update on "${String(task.goal||'').slice(0,160)}": ${summary}\n\nI’ll keep monitoring. The next check is saved in Tasks.`;
    if(localData.addMessageOnce(task.conversationId,messageId,'assistant',text,'JUNCTION').created)posted++;
    localData.markMilestoneDelivered(task.id,event.seq);
  }
  return posted;
}

function outcomeText(task,store){
  const goal=String(task.goal||'').slice(0,160),summary=String(task.summary||'').trim().slice(0,1200);
  if(task.status==='COMPLETED')return `Done: "${goal}".${summary?`\n\n${summary}`:''}`;
  if(task.status==='WAITING_FOR_USER'){
    const need=waitingFor(task,store);
    return need.kind==='approval'
      ? `"${goal}" is waiting for your approval: ${need.detail}.\n\nApprove or reject it in Tasks.`
      : `I need your input on "${goal}".${summary?`\n\n${summary}`:''}\n\nReply in Tasks, or tell me here what to do next.`;
  }
  if(task.status==='BLOCKED')return `"${goal}" is blocked.${summary?`\n\n${summary}`:''}\n\nOpen Tasks to unblock or redirect it.`;
  return `"${goal}" stopped with an error.${summary?`\n\n${summary}`:''}`;
}

/**
 * Posts one message per distinct outcome (status + summary) to the originating chat.
 * Idempotent across restarts through a stable message ID. Returns true when it posted.
 */
function postOutcome(task,store,localData,{settings=null,date=new Date()}={}){
  if(!REPORTABLE.has(task.status)||!task.conversationId||!localData.conversation(task.conversationId))return false;
  const policy=deliveryPolicy(settings,date);
  if(settings&&(policy.quiet||!policy.outcomes))return false;
  const digest=createHash('sha256').update(`${task.status}\n${task.summary||''}`).digest('hex').slice(0,16);
  const messageId=`nethra-outcome-${task.id}-${digest}`.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,160);
  return localData.addMessageOnce(task.conversationId,messageId,'assistant',outcomeText(task,store),'JUNCTION').created;
}

module.exports={postMilestones,postOutcome,deliveryPolicy,outcomeText};
