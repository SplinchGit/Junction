'use strict';
const {draftReceiptIsCurrent}=require('./nethra-tools');
const {verdictLine}=require('./nethra-experiments');
const {dailyLimits}=require('./nethra-scheduler');

const short=(value,max=240)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const FINISHED=new Set(['COMPLETED','CANCELLED','FAILED']);

/** One line describing a tool result, written by the host from the stored evidence. */
function evidenceLine(item){
  const result=item?.result||{};
  if(result.error)return `${item.tool} failed: ${short(result.error,160)}`;
  if(item.tool==='web_search'){const sources=(result.evidence?.sources||[]).slice(0,3).map(source=>short(source.title||source.url,80)).filter(Boolean);return `Searched the web for “${short(result.evidence?.query,100)}”${sources.length?`: ${sources.join('; ')}`:''}`;}
  if(item.tool==='write_draft')return `Saved draft ${short(result.path,160)} (${result.bytes??'?'} bytes)`;
  if(item.tool==='read_file')return `Read ${short(result.path,160)}`;
  if(item.tool==='list_directory')return `Listed ${short(result.path,160)}`;
  if(item.tool==='calendar_event')return `Read calendar event “${short(result.untrustedEvent?.summary,100)}”`;
  if(item.tool==='gmail_message')return `Read email headers: “${short(result.untrustedHeaders?.subject,100)}”`;
  if(item.tool==='phone_check')return `Asked the paired phone for a check (${short(result.state,30)})`;
  if(item.tool==='phone_result')return `Phone check ${short(result.state,30)}`;
  if(item.tool==='delegate_task')return 'Reviewed a bounded child research report';
  if(item.tool==='host_diagnostics')return 'Inspected host diagnostics';
  if(item.tool==='performance_report')return 'Read measured performance report';
  if(item.tool==='consult_codex')return 'Asked Codex for advice; no code was changed';
  if(item.tool==='consult_claude')return 'Asked Claude for advice; no code was changed';
  if(item.tool==='experiment')return result.result?verdictLine(result.result):result.status==='CHANGED'?'Recorded when the experiment change was applied':`Started an experiment with a baseline of ${result.baseline?.count??'?'} samples`;
  if(item.tool==='propose_code_work')return 'Prepared a development draft for owner review';
  return `${short(item.tool,40)} returned a result`;
}

/** Links to real outputs: completed draft writes whose file still matches its receipt. */
function outputs(task,store){
  const items=[];
  for(const receipt of store.actions?.(task.id)||[]){
    if(receipt.tool!=='write_draft'||receipt.status!=='COMPLETED')continue;
    items.push({kind:'draft',path:receipt.result?.path||receipt.args?.path,bytes:receipt.result?.bytes??null,sha256:receipt.result?.sha256||null,at:receipt.finishedAt||null,current:draftReceiptIsCurrent(receipt,task)});
  }
  return items.slice(-10);
}

/**
 * What the objective is waiting for, derived from durable state rather than narration.
 * kind: approval | input | blocked | owner_resume | dependency | budget | time | source | nothing
 */
function waitingFor(task,store,now=Date.now()){
  const pending=(store.approvals?.(task.id)||[]).filter(item=>item.status==='PENDING');
  if(pending.length)return {kind:'approval',detail:`${pending.length} approval${pending.length===1?'':'s'}: ${pending.map(item=>`${item.tool} ${short(item.args?.path,80)}`).join('; ')}`,approvals:pending.map(item=>item.id)};
  if(task.status==='WAITING_FOR_USER')return {kind:'input',detail:short(task.summary,500)||'Nethra needs a direction from you.'};
  if(task.status==='BLOCKED')return {kind:'blocked',detail:short(task.summary,500)||'An approval was rejected or expired.'};
  if(task.status==='PAUSED')return {kind:'owner_resume',detail:'Paused by you; resume to continue.'};
  const deps=(task.dependencies||[]).filter(id=>{try{return store.get(id).status!=='COMPLETED';}catch{return true;}});
  if(deps.length)return {kind:'dependency',detail:`Waiting for ${deps.length} other objective${deps.length===1?'':'s'} to complete.`};
  if(task.status==='SLEEPING'&&Number.isSafeInteger(task.nextWakeAt)){
    const reason=task.wakeReason;
    const usage=store.usage?.(task.id,now),settings=store.settings?.();
    if(reason?.kind==='BUDGET'||(usage&&settings&&(usage.taskMs>=dailyLimits(settings).taskMs||usage.globalMs>=dailyLimits(settings).globalMs)))return {kind:'budget',detail:`Daily model-time limit reached; resumes at ${new Date(task.nextWakeAt).toISOString()}.`};
    if(reason?.kind==='MONITOR'&&(task.sources||[]).length)return {kind:'source',detail:`A change in ${task.sources.join(' or ')}, or the routine check at ${new Date(task.nextWakeAt).toISOString()}.`};
    return {kind:'time',detail:reason?.detail||`Next scheduled check at ${new Date(task.nextWakeAt).toISOString()}.`};
  }
  return {kind:'nothing',detail:FINISHED.has(task.status)?'Finished.':'Ready to run when the PC model is free.'};
}

function activityLine(event){
  if(event.kind==='CLAIMED')return {kind:'running',line:'Started a work pass',actor:'Junction',model:null};
  if(event.kind==='MODEL_STEP')return {kind:'running',line:event.detail?.scope==='child'?'Child researcher is working through the next action':'Thinking through the next action',actor:'Nethra',model:recordedModel(event.detail)||'qwen3:30b'};
  if(event.kind==='NETHRA_UPDATE')return {kind:'update',line:short(event.detail?.text,300),actor:'Nethra',model:recordedModel(event.detail)||'qwen3:30b'};
  if(event.kind==='TOOL_STARTED')return {kind:'running',line:toolStartedLine(event.detail?.tool),actor:'Nethra',model:recordedModel(event.detail)||'qwen3:30b'};
  if(event.kind==='TOOL_FAILED')return {kind:'error',line:`${short(event.detail?.tool,40).replaceAll('_',' ')} failed: ${short(event.detail?.error,160)}`,actor:'Nethra',model:recordedModel(event.detail)||'qwen3:30b'};
  if(event.kind==='nethra_plan_updated'){const total=event.detail?.plan?.length||0,left=event.detail?.pendingSteps?.length||0;return {kind:'verified',line:`Updated plan: ${total} steps, ${left} left`,actor:'Nethra',model:'qwen3:30b'};}
  if(event.kind==='nethra_tool_result'){
    const item=event.detail?.evidence?.at(-1);
    if(!item)return null;
    if(item.tool==='consult_codex'&&!item.result?.error)return {kind:'advice',line:evidenceLine(item),actor:'Codex',model:recordedModel(item.result)};
    if(item.tool==='consult_claude'&&!item.result?.error)return {kind:'advice',line:evidenceLine(item),actor:'Claude',model:recordedModel(item.result)};
    return {kind:item.result?.error?'error':'verified',line:evidenceLine(item),actor:'Nethra',model:'qwen3:30b'};
  }
  if(event.kind==='CODEX_ASSISTED_BRIDGE')return {kind:'advice',line:'Codex advice saved as a technical handoff; Nethra did not call it itself',actor:'Codex',model:recordedModel(event.detail?.evidence?.find(item=>item.tool==='consult_codex')?.result)};
  if(event.kind==='EXPERIMENT_CONCLUDED'&&event.detail?.result)return {kind:'verified',line:verdictLine(event.detail.result),actor:'Junction',model:null};
  if(event.kind==='EXPERIMENT_ABANDONED')return {kind:'verified',line:`Abandoned unused experiment baseline: ${short(event.detail?.reason,160)}`,actor:'Junction',model:null};
  if(event.kind==='CONTEXT_COMPACTED')return {kind:'waiting',line:`Compacted ${event.detail?.compacted??'some'} older tool result${event.detail?.compacted===1?'':'s'} to fit the context window`,actor:'Junction',model:null};
  if(event.kind==='BUDGET_WAIT')return {kind:'waiting',line:'Paused at the daily model-time limit',actor:'Junction',model:null};
  if(event.kind==='MILESTONE_VERIFIED')return {kind:'verified',line:`Verified milestone: ${short(event.detail?.summary,180)}`,actor:'Nethra',model:'qwen3:30b'};
  if(event.kind==='nethra_completed')return {kind:'verified',line:'Finished the task with verified evidence',actor:'Nethra',model:'qwen3:30b'};
  if(event.kind==='nethra_approved_action')return {kind:'verified',line:'Completed an owner-approved action',actor:'Nethra',model:'qwen3:30b'};
  if(event.kind==='CHILD_COMPLETED')return {kind:'verified',line:'Completed a bounded child research step',actor:'Nethra',model:'qwen3:30b'};
  if(event.kind==='nethra_input_required')return {kind:'waiting',line:'Asked you for a decision',actor:'Nethra',model:'qwen3:30b'};
  if(event.kind==='nethra_sleeping')return {kind:'waiting',line:'Scheduled a later check',actor:'Nethra',model:'qwen3:30b'};
  if(event.kind==='nethra_budget_reached')return {kind:'waiting',line:'Saved this pass to continue later',actor:'Nethra',model:'qwen3:30b'};
  if(event.kind==='EXECUTED')return {kind:'pass',line:'Finished this work pass',actor:'Junction',model:null};
  return null;
}
function toolStartedLine(tool){
  const names={update_plan:'Updating the plan',schedule_wake:'Scheduling the next check',request_input:'Preparing a question for you',consult_codex:'Asking Codex for advice',consult_claude:'Asking Claude for advice',web_search:'Searching the web',read_file:'Reading a file',list_directory:'Listing a directory',performance_report:'Reading measured performance',host_diagnostics:'Checking the host'};
  return names[tool]||`Running ${short(tool,40).replaceAll('_',' ')}`;
}
function recordedModel(result){
  const model=result?.model;
  return typeof model==='string'&&/^[A-Za-z0-9._:-]{1,80}$/.test(model)?model:null;
}
/**
 * Host-recorded progress, kept separate from the model's own summary ("narration").
 */
function progressView(task,store,{now=Date.now(),liveTaskId=null}={}){
  const evidence=(task.evidence||[]).slice(-6).map(item=>({tool:item.tool,line:evidenceLine(item),ok:!item.result?.error}));
  let last=null,activity=[];
  try{
    const events=store.recentTaskEvents?.(task.id,60)||store.events(task.id,0).slice(-60).reverse();
    activity=events.map(event=>{const detail=activityLine(event);return detail?{at:event.at,event:event.kind,...detail}:null;}).filter(Boolean).slice(0,14);
    const accomplished=activity.find(item=>['verified','advice'].includes(item.kind));
    if(accomplished)last={at:accomplished.at,line:accomplished.line,event:accomplished.event,actor:accomplished.actor,model:accomplished.model};
  }catch{}
  const live=liveTaskId===task.id;
  const liveAction=live&&['MODEL_STEP','TOOL_STARTED','CLAIMED'].includes(activity[0]?.event)?activity[0].line:null;
  const doing=live?(liveAction||`Working now${task.pendingSteps?.[0]?`: ${short(task.pendingSteps[0],160)}`:''}`):FINISHED.has(task.status)?null:task.status==='SLEEPING'?'Sleeping until the next wake':task.status==='PAUSED'?'Paused':['WAITING_FOR_USER','BLOCKED'].includes(task.status)?'Waiting for you':'Queued to run';
  const next=FINISHED.has(task.status)?null:task.pendingSteps?.[0]?short(task.pendingSteps[0],200):task.status==='SLEEPING'&&task.mode==='ONGOING'?'Check watched sources and report verified changes':(task.plan||[]).length?null:'Make a plan';
  return {
    doing,next,lastAccomplished:last,
    wake:Number.isSafeInteger(task.nextWakeAt)&&!FINISHED.has(task.status)?{at:task.nextWakeAt,kind:task.wakeReason?.kind||'UNKNOWN',reason:task.wakeReason?.detail||'Next scheduled wake'}:null,
    waitingFor:waitingFor(task,store,now),
    outputs:outputs(task,store),activity,
    evidence,
    narration:short(task.summary,600)||null,
    counts:{done:(task.completedSteps||[]).length,total:(task.completedSteps||[]).length+(task.pendingSteps||[]).length,evidence:(task.evidence||[]).length}
  };
}

/** Quiet hours are local wall-clock times; a window may cross midnight. */
function inQuietHours(settings,date=new Date()){
  const quiet=settings?.quietHours;if(!quiet?.enabled)return false;
  const minutes=value=>{const [h,m]=String(value).split(':').map(Number);return h*60+m;};
  const start=minutes(quiet.start),end=minutes(quiet.end),now=date.getHours()*60+date.getMinutes();
  if(start===end)return false;
  return start<end?now>=start&&now<end:now>=start||now<end;
}

module.exports={progressView,waitingFor,outputs,evidenceLine,inQuietHours};
