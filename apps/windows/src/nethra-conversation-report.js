'use strict';
const {createHash}=require('node:crypto');
const {inQuietHours,waitingFor,progressView}=require('./nethra-progress');

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
  // The journal entry that put the task in this state identifies the episode: retries of one
  // outcome stay single, but the same question asked again later is a new message. Hashing only
  // status and text silently suppressed a repeat question forever (live, 25 October).
  let episode=task.revision;
  try{episode=(store.recentTaskEvents?.(task.id,100)||[]).find(event=>event.detail?.status===task.status)?.seq??episode;}catch{}
  const digest=createHash('sha256').update(`${task.status}\n${task.summary||''}\n${episode}`).digest('hex').slice(0,16);
  const messageId=`nethra-outcome-${task.id}-${digest}`.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,160);
  return localData.addMessageOnce(task.conversationId,messageId,'assistant',outcomeText(task,store),'JUNCTION').created;
}

/**
 * After a productive cycle on a finite objective, tells its chat what was actually done
 * (host-recorded) and what comes next. One message per recorded accomplishment; nothing is
 * posted for cycles without progress, so a quiet objective stays quiet.
 */
function postProgress(task,store,localData,{settings=null,date=new Date(),liveTaskId=null}={}){
  // Ongoing monitors report verified milestones only; an ongoing task that is actively working
  // (continuous) reports its steps like any other, or the owner hears nothing at all.
  if((task.mode==='ONGOING'&&!task.continuous)||!task.conversationId||!localData.conversation(task.conversationId))return false;
  if(!['SLEEPING','ACTIVE','PLANNING'].includes(task.status)||task.lastCycleProgressed!==true)return false;
  const policy=deliveryPolicy(settings,date);
  if(settings&&(policy.quiet||!policy.milestones))return false;
  const view=progressView(task,store,{liveTaskId});
  if(!view.lastAccomplished)return false;
  const clock=at=>new Date(at).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
  const lines=[`Progress on "${String(task.goal||'').slice(0,120)}": ${view.lastAccomplished.line}.`];
  const passStart=view.activity.findIndex(item=>item.event==='CLAIMED');
  const actions=(passStart<0?view.activity:view.activity.slice(0,passStart)).filter(item=>['verified','advice','error'].includes(item.kind)).slice(0,4).reverse();
  if(actions.length)lines.push('Recorded actions:',...actions.map(item=>`• ${item.line} — ${item.actor}`));
  if(view.counts.total)lines.push(`${view.counts.done} of ${view.counts.total} steps done.`);
  if(view.next)lines.push(`Next: ${view.next}.`);
  if(view.wake)lines.push(view.wake.kind==='CONTINUE'&&task.continuous?'Continuing now.':`Next run ${clock(view.wake.at)}: ${view.wake.reason}.`);
  const note=String(task.summary||'').trim();
  if(note&&note.length<=400)lines.push(`\nMy note: ${note}`);
  lines.push('\nReply here to steer this task.');
  const messageId=`nethra-progress-${task.id}-${view.lastAccomplished.at}`.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,160);
  return localData.addMessageOnce(task.conversationId,messageId,'assistant',lines.join('\n'),'JUNCTION').created;
}

module.exports={postMilestones,postOutcome,postProgress,deliveryPolicy,outcomeText};
