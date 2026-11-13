'use strict';
const {createHash}=require('node:crypto');
const {existsSync}=require('node:fs');
const {join}=require('node:path');
const {inQuietHours,waitingFor}=require('./nethra-progress');
const {openQuestions}=require('./nethra-task-contract');

const MILESTONE_STATES=new Set(['ACTIVE','PLANNING','SLEEPING']);
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

/** Project preferences can reduce phone alerts within the global policy. */
function projectAllowsNotification(settings, task, milestone = false) {
  const rules=settings.projectNotifications||{};
  const mode=Object.hasOwn(rules,task.projectId)?rules[task.projectId]:null;
  return mode!=='OFF'&&(!milestone||mode!=='IMPORTANT');
}

/** The saved question is the outbox; delivery never stops an executable task. */
function postQuestions(task,store,localData,{settings=null,date=new Date()}={}){
  if(!['ACTIVE','PLANNING','SLEEPING'].includes(task.status))return 0;
  const policy=deliveryPolicy(settings,date);if(settings&&(policy.quiet||!policy.outcomes))return 0;
  let posted=0;
  for(const question of openQuestions(task)){
    const conversationId=question.conversationId||task.conversationId;
    if(!conversationId||!localData.conversation(conversationId))continue;
    const text=`${question.question}\n\nI’m continuing the available work while you decide.`;
    if(localData.addMessageOnce(conversationId,question.id,'assistant',text,'JUNCTION').created)posted++;
  }
  return posted;
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
  const question=task.status==='WAITING_FOR_USER'&&waitingFor(task,store).kind==='input'?[...openQuestions(task)].reverse().find(item=>item.blocking):null;
  const conversationId=question?.conversationId||task.conversationId;
  if(!REPORTABLE.has(task.status)||!conversationId||!localData.conversation(conversationId))return false;
  const policy=deliveryPolicy(settings,date);
  if(settings&&(policy.quiet||!policy.outcomes))return false;
  // The journal entry that put the task in this state identifies the episode: retries of one
  // outcome stay single, but the same question asked again later is a new message. Hashing only
  // status and text silently suppressed a repeat question forever (live, 25 October).
  let episode=task.revision;
  try{episode=(store.recentTaskEvents?.(task.id,100)||[]).find(event=>event.detail?.status===task.status)?.seq??episode;}catch{}
  const digest=createHash('sha256').update(`${task.status}\n${task.summary||''}\n${episode}`).digest('hex').slice(0,16);
  const messageId=`nethra-outcome-${task.id}-${digest}`.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,160);
  return localData.addMessageOnce(conversationId,messageId,'assistant',outcomeText(task,store),'JUNCTION').created;
}

/**
 * Individual model/tool steps belong in the Tasks work log, never in chat.
 * Keep this entry point for existing callers; milestones, important outcomes
 * and owner requests are still delivered by postMilestones/postOutcome.
 */
function postProgress(){return false;}

function postCoordinationChat(task,localData,project=null){
  if(!task.coordinateSelfImprovement||!task.conversationId||!localData?.conversation(task.conversationId))return false;
  const id=task.conversationId;
  let changed=false;
  const post=(key,content)=>{
    const digest=createHash('sha256').update(JSON.stringify([task.id,key])).digest('hex');
    changed=localData.addMessageOnce(id,`coordination-${digest}`,'assistant',content,'JUNCTION').created||changed;
  };
  for(const [provider,label] of [['codex','Codex / OpenAI'],['claude','Claude / Anthropic']]){
    const receipt=task.coordination?.advisors?.[provider];
    if(receipt?.status==='completed'&&receipt.advice)post([provider,receipt.at,receipt.advice],`**${label}${receipt.model?` (${receipt.model})`:''}**\n\n${receipt.advice}`);
  }
  if(project?.sourceObjectiveId===task.id&&project.status==='COMPLETED'){
    for(const step of project.tasks||[]){
      const receipt=step.attempts?.findLast(attempt=>attempt.status==='COMPLETED'&&attempt.tests?.length&&attempt.tests.every(test=>test.exitCode===0));
      if(!receipt)continue;
      const provider=receipt.provider==='codex'?'Codex / OpenAI':receipt.provider==='claude'?'Claude / Anthropic':'Engineering';
      const approval=project.codeReviewVerdict||'Saved work record';
      post(['verified',project.id,step.id,receipt.id],`**Nethra · Verified engineering checkpoint**\n\n${step.title}\n\nProvider: ${provider}\nVerification: ${receipt.tests.length} checks passed${receipt.headSha?` · ${receipt.headSha.slice(0,12)}`:''}\nApproval reference: ${approval} · ${project.id}\nNext action: ${project.nextAction||'Review Work Activity'}`);
    }
  }
  if(project&&project.id===task.coordination?.workId){
    const queued=project.tasks?.find(step=>step.status==='QUEUED');
    const approved=project.sourceObjectiveId===task.id&&project.codeReviewVerdict==='READY'
      &&Number.isFinite(task.coordination.approvedAt)&&task.coordination.brief===project.coordinationBrief;
    if(queued&&approved&&['DRAFT','RUNNING','WAITING_CAPACITY','WAITING_CODEX','PAUSED','STOPPED'].includes(project.status)){
      const provider=queued.attempts?.at(-1)?.provider||queued.kind;
      const label=provider==='codex'?'Codex / OpenAI':provider==='claude'?'Claude / Anthropic':'Awaiting assignment';
      const latest=queued.attempts?.at(-1);
      const evidence=latest?.headSha||project.reviewed?.diffHash||`work:${project.id}`;
      const fenced=['PAUSED','CANCELLED'].includes(task.status)||['PAUSED','STOPPED'].includes(project.status);
      const locked=project.sharedCheckout&&project.repoPath&&existsSync(join(project.repoPath,'.git','nethra-writer.lock'));
      const next=fenced?'Resume explicitly':locked?'Wait for the shared writer lock to clear':project.nextAction||'Await engineering pickup';
      post(['queue',project.id,queued.id,task.coordination.approvedAt,label,evidence,next],`**Nethra · Engineering queue receipt**\n\n${queued.title}\n\nApproval: Approved · ${new Date(task.coordination.approvedAt).toISOString()}\nProvider: ${label}\nEvidence: ${evidence}\nNext action: ${next}`);
    }
    const attempt=project.tasks?.find(item=>item.id===project.activeTask)?.attempts?.at(-1);
    const provider=attempt?.provider==='claude'?'Claude / Anthropic':attempt?.provider==='codex'?'Codex / OpenAI':null;
    const detail=project.status==='BLOCKED'?project.handoff:project.nextAction;
    if(detail)post([project.id,project.status,attempt?.id,attempt?.phase,provider,detail,project.retryAt],`**Nethra · Work Activity**\n\n${provider?`${provider} · `:''}${project.status}\n\n${String(detail).slice(0,900)}${Number.isFinite(project.retryAt)?`\n\nNext check: ${new Date(project.retryAt).toISOString()}`:''}`);
  }
  return changed;
}

/** Shared host settle hook; message identities, not an in-memory summary set, deduplicate episodes. */
function postTaskReports(task,store,localData,{date=new Date()}={}){
  if(!task.conversationId||!localData?.conversation(task.conversationId)||store.deletion?.(task.id))return false;
  const settings=store.settings(),options={settings,date,liveTaskId:store.liveTaskId()};
  let changed=postMilestones(task,store,localData,options)>0;
  changed=postQuestions(task,store,localData,options)>0||changed;
  changed=postProgress(task,store,localData,options)||changed;
  if(REPORTABLE.has(task.status)){
    if(postOutcome(task,store,localData,options)){store.clearReportPending(task.id);changed=true;}
    else {const policy=deliveryPolicy(settings,date);if(policy.quiet&&policy.outcomes)store.markReportPending(task.id);}
  }
  return changed;
}

/** A single saved decision lets the owner's spoken response use the ordinary task chat. */
function invitationQuestion(task,store,settings){
  if(settings.voiceInvitations!==true||task.status!=='WAITING_FOR_USER'||waitingFor(task,store).kind!=='input')return null;
  const questions=openQuestions(task);
  const question=questions.length===1?questions[0]:null;
  return question?.blocking&&['OWNER_PREFERENCE','CLARIFICATION'].includes(question.reason)&&question.askedAt>=(settings.notificationDeviceSince||0)?question:null;
}

function invitationEventId(taskId,questionId){
  return `nethra-voice-invitation-${createHash('sha256').update(JSON.stringify([taskId,questionId])).digest('hex')}`;
}

/** Uses a persisted transition, never a model-written completion sentence. */
function queueOutcomeNotification(task,store,queue,{date=new Date()}={}){
  const settings=store.settings(),policy=deliveryPolicy(settings,date);
  if(!queue||!settings.notificationDeviceId||policy.quiet||!policy.outcomes||store.deletion?.(task.id))return null;
  const current=store.get(task.id);
  if(!REPORTABLE.has(current.status)||!projectAllowsNotification(settings,current))return null;
  const event=(store.recentTaskEvents(current.id,100)||[]).find(e=>e.detail?.status===current.status);
  if(!event||event.at<settings.notificationDeviceSince)return null;
  const eventId=`nethra-notification-${current.id}-${event.seq}`;
  const question=invitationQuestion(current,store,settings);
  if(question){
    const existing=queue.notificationForRequest?.(eventId);
    if(existing)return existing; // Don't upgrade an already announced wait into another alert.
    const inviteId=invitationEventId(current.id,question.id);
    return queue.enqueueNotification({requestId:inviteId,taskId:current.id,deviceId:settings.notificationDeviceId,args:{
      eventId:inviteId,taskId:current.id,title:'Nethra would like to talk',
      body:'A task needs your decision before it can continue. Answer to open its voice conversation.',voiceInvite:true,questionId:question.id}});
  }
  const approval=current.status==='WAITING_FOR_USER'?store.approvals(current.id).find(item=>item.status==='PENDING'&&item.expiresAt>store.now()):null;
  const reply=current.status==='WAITING_FOR_USER'&&waitingFor(current,store).kind==='input';
  const body=approval?'This task needs your approval. Review the exact request before deciding.':{COMPLETED:'This task is complete. Open it to review the saved results.',WAITING_FOR_USER:'This task needs your input or approval before it can continue. Open it to review the request.',BLOCKED:'This task is blocked. Open it to review the blocker and choose what happens next.',FAILED:'This task stopped with an error. Open it to review the error and decide whether to retry.'}[current.status];
  return queue.enqueueNotification({requestId:eventId,taskId:current.id,deviceId:settings.notificationDeviceId,args:{eventId,taskId:current.id,title:`Nethra - ${String(current.goal).slice(0,160)}`,body,...(approval?{approvalId:approval.id}:reply?{reply:true}:{})}});
}

/** Low-priority verified milestones share one task/window notification, after the window closes. */
function queueMilestoneNotification(task,store,queue,{date=new Date()}={}){
  const settings=store.settings(),policy=deliveryPolicy(settings,date);
  if(!queue||!settings.notificationDeviceId||policy.quiet||!policy.milestones||store.deletion?.(task.id))return null;
  const current=store.get(task.id);
  if(!['ACTIVE','PLANNING','SLEEPING'].includes(current.status)||!projectAllowsNotification(settings,current,true))return null;
  const batch=store.latestMilestoneBatch(current.id,settings.notificationDeviceSince||0);
  if(!batch||batch.readyAt>store.now())return null;
  if(queue.hasMilestoneNotification?.(current.id,batch.seq,{includeStandalone:false}))return null;
  const eventId=`nethra-milestone-${current.id}-${batch.seq}`;
  const body=`${batch.count} verified milestone${batch.count===1?'':'s'} recorded. Open this task to review the saved evidence. No action is required; work continues according to its schedule.`;
  return queue.enqueueNotification({requestId:eventId,taskId:current.id,deviceId:settings.notificationDeviceId,args:{eventId,taskId:current.id,title:`Nethra - ${String(current.goal).slice(0,160)}`,body}});
}

/** One alert per closed project window, linked to the newest milestone's task. */
function queueProjectMilestoneNotifications(store,queue,{date=new Date(),tasks=store.list(),projectName=()=>null}={}){
  const settings=store.settings(),policy=deliveryPolicy(settings,date);
  if(!queue||!settings.notificationDeviceId||policy.quiet||!policy.milestones)return [];
  const groups=new Map();
  for(const task of tasks){
    if(!task.projectId||!MILESTONE_STATES.has(task.status)||!projectAllowsNotification(settings,task,true))continue;
    const batch=store.latestMilestoneBatch(task.id,settings.notificationDeviceSince||0);
    if(!batch||batch.readyAt>store.now()||queue.hasMilestoneNotification(task.id,batch.seq))continue;
    const projectKey=createHash('sha256').update(task.projectId).digest('hex');
    const eventId=`nethra-project-milestone-${projectKey}-${batch.start}`;
    if(!groups.has(eventId))groups.set(eventId,{projectId:task.projectId,start:batch.start,members:[]});
    groups.get(eventId).members.push({taskId:task.id,seq:batch.seq,count:batch.count});
  }
  return [...groups].map(([eventId,group])=>{
    group.members.sort((a,b)=>b.seq-a.seq);
    const taskId=group.members[0].taskId,count=group.members.reduce((sum,item)=>sum+item.count,0),size=group.members.length;
    const title=`Nethra - ${String(projectName(group.projectId)||'Project progress').slice(0,160)}`;
    const body=`${count} verified milestone${count===1?'':'s'} across ${size} task${size===1?'':'s'}. Open the most recent task to review its evidence. No action is required.`;
    return queue.enqueueNotification({requestId:eventId,taskId,deviceId:settings.notificationDeviceId,milestoneGroup:group,args:{eventId,taskId,title,body}});
  });
}

function coordinationProgress(project,now){
  const interval=75*60_000;
  let active=0,evidenceAt=0;
  for(const attempt of (project.tasks||[]).flatMap(item=>item.attempts||[])){
    if(!Number.isFinite(attempt.activeAt))continue;
    const duration=Math.max(0,(attempt.finishedAt||(attempt.status==='RUNNING'&&project.status==='RUNNING'?now:attempt.activeAt))-attempt.activeAt);
    if(Number.isFinite(attempt.lastEvidenceAt))evidenceAt=active+Math.min(duration,Math.max(0,attempt.lastEvidenceAt-attempt.activeAt));
    active+=duration;
  }
  const intervalNumber=Math.floor(active/interval);
  return intervalNumber&&evidenceAt>(intervalNumber-1)*interval?intervalNumber:null;
}
function codeWorkEvent(task,project,now=Date.now()){
  const ready=project.status==='COMPLETED'&&project.verifiedSha&&!project.appliedAt;
  const blocked=project.status==='BLOCKED';
  if(project.sourceObjectiveId!==task.id||!project.autoHandoff)return null;
  if(!ready&&!blocked){
    if(!task.coordinateSelfImprovement||['PAUSED','CANCELLED'].includes(task.status)||!['RUNNING','WAITING_CAPACITY','WAITING_CODEX'].includes(project.status))return null;
    const interval=coordinationProgress(project,now);
    return interval?{id:`nethra-code-work-${task.id}-${project.id}-progress-${interval}`,progress:true,body:'Development work has a saved checkpoint or verification result. Open Tasks to see the next action.'}:null;
  }
  const attempt=project.tasks?.find(item=>item.id===project.activeTask)?.attempts.at(-1);
  const version=ready?project.verifiedSha:attempt?.id;
  if(!version)return null;
  return {id:`nethra-code-work-${task.id}-${project.id}-${version}`,body:ready?'A verified code candidate is ready for review in Work Activity.':'Coding work needs your attention. Open Work Activity to see what stopped it.'};
}
function queueCodeWorkNotification(task,project,store,queue,{date=new Date()}={}){
  const settings=store.settings(),policy=deliveryPolicy(settings,date),event=codeWorkEvent(task,project,store.now());
  if(!event||!policy.outcomes||(event.progress&&!policy.milestones)||!settings.notificationDeviceId||!projectAllowsNotification(settings,task)||project.updatedAt<(settings.notificationDeviceSince||0))return null;
  return queue.enqueueNotification({requestId:event.id,taskId:task.id,deviceId:settings.notificationDeviceId,
    args:{eventId:event.id,taskId:task.id,title:'Nethra — development work',body:event.body}});
}
function notificationDeliveryPolicy(command,store,{date=new Date(),projects=()=>[]}={}){
  const settings=store.settings(),policy=deliveryPolicy(settings,date);
  if(!policy.outcomes||settings.notificationDeviceId!==command.deviceId||store.deletion(command.taskId))return 'cancel';
  const task=store.get(command.taskId);
  const eventId=command.notificationSourceEventId||command.args.eventId;
  if(eventId.startsWith(`nethra-code-work-${task.id}-`)){
    if(!projectAllowsNotification(settings,task)||!projects().some(project=>{const event=codeWorkEvent(task,project,store.now());return project.updatedAt>=(settings.notificationDeviceSince||0)&&event?.id===eventId&&(!event.progress||policy.milestones);}))return 'cancel';
    return policy.quiet?'hold':'deliver';
  }
  if(command.args.voiceInvite){
    const question=invitationQuestion(task,store,settings);
    if(command.expiresAt<=store.now()||!projectAllowsNotification(settings,task)||!question||question.id!==command.args.questionId||eventId!==invitationEventId(task.id,question.id))return 'cancel';
    return policy.quiet?'hold':'deliver';
  }
  if(command.milestoneGroup){
    const {projectId,start,members}=command.milestoneGroup;
    if(!policy.milestones||task.projectId!==projectId||!projectAllowsNotification(settings,task,true))return 'cancel';
    for(const member of members){
      if(store.deletion(member.taskId))return 'cancel';
      const current=store.get(member.taskId);
      if(current.projectId!==projectId||!MILESTONE_STATES.has(current.status))return 'cancel';
      const batch=store.latestMilestoneBatch(member.taskId,settings.notificationDeviceSince||0);
      if(!batch||batch.start!==start||batch.seq!==member.seq||batch.count!==member.count)return 'cancel';
      if(batch.readyAt>store.now())return 'hold';
    }
    return policy.quiet?'hold':'deliver';
  }
  const milestone=eventId.startsWith(`nethra-milestone-${task.id}-`);
  if(!projectAllowsNotification(settings,task,milestone))return 'cancel';
  if(milestone){
    if(!policy.milestones||!['ACTIVE','PLANNING','SLEEPING'].includes(task.status))return 'cancel';
    const batch=store.latestMilestoneBatch(task.id,settings.notificationDeviceSince||0);
    if(!batch||eventId!==`nethra-milestone-${task.id}-${batch.seq}`)return 'cancel';
    return policy.quiet||batch.readyAt>store.now()?'hold':'deliver';
  }
  const event=store.recentTaskEvents(task.id,100).find(e=>e.detail?.status===task.status);
  if(!REPORTABLE.has(task.status)||!event||event.at<settings.notificationDeviceSince||eventId!==`nethra-notification-${task.id}-${event.seq}`)return 'cancel';
  if(command.args.reply&&(task.status!=='WAITING_FOR_USER'||waitingFor(task,store).kind!=='input'))return 'cancel';
  if(command.args.approvalId&&!store.approvals(task.id).some(item=>item.id===command.args.approvalId&&item.status==='PENDING'&&item.expiresAt>store.now()))return 'cancel';
  return policy.quiet?'hold':'deliver';
}

module.exports={queueCodeWorkNotification,invitationQuestion,queueProjectMilestoneNotifications,notificationDeliveryPolicy,queueMilestoneNotification,queueOutcomeNotification,postTaskReports,postMilestones,postOutcome,postProgress,postQuestions,postCoordinationChat,deliveryPolicy,outcomeText};
