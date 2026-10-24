'use strict';
const {randomUUID,createHash}=require('node:crypto');
const {NethraAttention}=require('./nethra-attention');
const MIN_WAKE=300000, MAX_WAKE=604800000, MAX_RUNTIME=600000, LEASE_MS=660000;
function clampWake(at,now=Date.now(),min=MIN_WAKE,max=MAX_WAKE) {return Math.min(now+max,Math.max(now+min,Number.isFinite(at)?at:now+min));}
const MONITOR_INTERVAL_MS=Object.freeze({QUIET:7*86_400_000,BALANCED:86_400_000,ACTIVE:6*3_600_000});
function monitorWakeAt(task,now=Date.now()) {return now+(MONITOR_INTERVAL_MS[task.autonomy]||MONITOR_INTERVAL_MS.BALANCED);}
/** Wake reasons are host facts, written where nextWakeAt is chosen, never model narration. */
function wakeReason(kind,detail,at){return {kind,detail:String(detail||'').slice(0,300),at:Number.isSafeInteger(at)?at:null};}
const MONITOR_LABEL=Object.freeze({QUIET:'weekly',BALANCED:'daily',ACTIVE:'six-hourly'});
/**
 * What the model would see this wake, minus wall-clock. If it equals the previous cycle's and
 * that cycle made no progress, another inference would repeat itself: sleep instead.
 */
function inputFingerprint(task,store){
  let approvals=[],attention=[];
  try{approvals=store.approvals(task.id).map(item=>[item.id,item.status]);}catch{}
  try{attention=store.attention(task.id).filter(item=>item.state==='CLAIMED').map(item=>item.id);}catch{}
  return createHash('sha256').update(JSON.stringify([task.goal,task.successCriteria,task.plan||[],task.completedSteps||[],task.pendingSteps||[],(task.evidence||[]).map(item=>JSON.stringify(item)),(task.ownerInputs||[]).length,approvals,attention])).digest('hex');
}
function safeFailure(error) {
  const message=String(error?.message||error||'Execution failed');
  if(/(?:token|secret|password|authorization|credential|api[_-]?key)\s*[:=]/i.test(message))return 'Execution failed; check the local model or source connection.';
  return message.replace(/[\r\n]/g,' ').slice(0,500);
}

/**
 * A routine monitoring wake whose sources were already compared by their adapters needs
 * bookkeeping, not inference: no pending plan, no reasoning attention, no direction check.
 */
function isRoutineMonitor(task,now,sourceStatus,hasReasoningAttention){
  return task.mode==='ONGOING'&&task.lastMilestoneAt!=null&&(task.sources||[]).length>0
    &&!(task.pendingSteps||[]).length&&Boolean(sourceStatus)&&!hasReasoningAttention
    &&!(Number.isSafeInteger(task.nextDirectionCheckAt)&&task.nextDirectionCheckAt<=now);
}
// Warm the model this long before a wake that will need it (a cold load takes ~50 s here).
const PREWARM_LEAD_MS=120_000;

/** Polling checks durable due dates; inference runs only after a successful claim. */
class NethraScheduler {
  constructor({store,execute,now=Date.now,pollMs=1000,owner=randomUUID(),onSettled=null,sourceStatus=null,warmBefore=null,maxRuntimeMs=MAX_RUNTIME}) {this.maxRuntimeMs=maxRuntimeMs;this.store=store;this.execute=execute;this.onSettled=onSettled;this.sourceStatus=sourceStatus;this.warmBefore=warmBefore;this.warmedFor=null;this.now=now;this.pollMs=Math.max(10,pollMs);this.owner=owner;this.attention=new NethraAttention(store,{now});this.lastAttentionSweep=0;this.running=null;this.controller=null;this.stopping=false;}
  start() {if(this.timer)return;this.stopping=false;const poll=()=>this.tick().catch(error=>{this.lastError=error;});this.timer=setInterval(poll,this.pollMs);this.timer.unref?.();poll();}
  tick() {if(this.stopping)return Promise.resolve();if(this.running)return this.running;this.running=this.run().finally(()=>{this.running=null;});return this.running;}
  async run() {
    if(this.now()-this.lastAttentionSweep>=15_000){this.lastAttentionSweep=this.now();try{this.attention.reconcileCheckIns();this.attention.reconcileInitiative();if(this.attention.errors.length)this.lastError=new Error(`Attention sweep failed for ${this.attention.errors.length} objective(s): ${this.attention.errors[0].message}`);}catch(error){this.lastError=error;}this.prepareUpcoming();}
    const claim=this.store.claim(this.owner,LEASE_MS);if(!claim)return;
    const {task,token}=claim,controller=new AbortController();this.controller=controller;
    // Source adapters have already compared stable revisions. A routine checkpoint with
    // no changed evidence needs bookkeeping, not a fresh 30B inference.
    if(isRoutineMonitor(task,this.now(),this.sourceStatus,this.store.hasClaimedReasoningAttention(task.id,token))){
      const sources=task.sources.map(source=>{try{return {source,status:this.sourceStatus(source)?.status||'UNKNOWN'};}catch{return {source,status:'ERROR'};}});
      const unavailable=sources.filter(item=>item.status!=='CONNECTED');
      const summary=unavailable.length?`Waiting for fresh source access: ${unavailable.map(item=>`${item.source} ${item.status.toLowerCase()}`).join(', ')}. No new check was confirmed.`:task.summary;
      const wakeAt=monitorWakeAt(task,this.now());
      try{this.store.update(task.id,{status:'SLEEPING',summary,nextWakeAt:wakeAt,wakeReason:wakeReason('MONITOR',unavailable.length?'Routine check; a watched source was unavailable, so nothing was checked':`Routine ${MONITOR_LABEL[task.autonomy]||'daily'} monitoring check; a source change wakes it sooner`,wakeAt)},unavailable.length?'MONITOR_SOURCE_UNAVAILABLE':'MONITOR_IDLE',token);}
      finally{this.store.release(task.id,token);this.controller=null;}
      return;
    }
    const started=this.now(),settings=this.store.settings();
    const fingerprint=inputFingerprint(task,this.store);
    if(['CONTINUE','BACKOFF'].includes(task.wakeReason?.kind)&&task.lastCycleProgressed===false&&task.lastInferenceFingerprint===fingerprint){
      const unchanged=(task.unchangedWakes||0)+1;
      try{
        if(unchanged>=3)this.store.update(task.id,{status:'WAITING_FOR_USER',summary:'Nothing has changed since my last attempts and I have no useful next action. What should I try next?',nextWakeAt:null,unchangedWakes:unchanged,wakeReason:null},'NO_NEW_EVIDENCE_STOPPED',token);
        else{const wakeAt=clampWake(this.now()+settings.minWakeMs*2**unchanged,this.now(),settings.minWakeMs,settings.maxWakeMs);this.store.update(task.id,{status:'SLEEPING',nextWakeAt:wakeAt,unchangedWakes:unchanged,wakeReason:wakeReason('BACKOFF','No new evidence since the last attempt; inference skipped',wakeAt)},'NO_NEW_EVIDENCE',token);}
      }finally{this.store.release(task.id,token);this.controller=null;}
      if(unchanged>=3&&this.onSettled){try{await this.onSettled(this.store.get(task.id));}catch(error){this.lastError=error;}}
      return;
    }
    let abortReason='';
    const abort=reason=>{abortReason=reason;controller.abort(new Error(reason));};
    const heartbeat=setInterval(()=>{try{const live=this.store.get(task.id);if(['PAUSED','CANCELLED'].includes(live.status)){abort(live.status);return;}if(!this.store.renew(task.id,token,LEASE_MS)){abort('Lease lost');return;}const usage=this.store.usage(task.id);if(usage.globalMs>=settings.globalDailyBudgetMs||usage.taskMs>=settings.objectiveDailyBudgetMs)abort('Inference time budget reached');}catch(error){abort(error.message);}},Math.min(this.pollMs,1000));
    const deadline=setTimeout(()=>abort('Wake runtime limit reached'),this.maxRuntimeMs);
    const inference=async callback=>{
      controller.signal.throwIfAborted();const usage=this.store.usage(task.id);
      const allowance=Math.min(this.maxRuntimeMs,settings.globalDailyBudgetMs-usage.globalMs,settings.objectiveDailyBudgetMs-usage.taskMs);
      if(allowance<=0)throw new Error('Inference time budget reached');
      this.store.beginInference(task.id,token);const timer=setTimeout(()=>abort('Inference time budget reached'),allowance);
      try{return await callback();}finally{clearTimeout(timer);this.store.endInference(task.id,token);}
    };
    let removeAbort,completedCycle=false;
    const aborted=new Promise((_,reject)=>{const handler=()=>reject(controller.signal.reason);controller.signal.addEventListener('abort',handler,{once:true});removeAbort=()=>controller.signal.removeEventListener('abort',handler);});
    const checkpoint=(patch,event='CHECKPOINT')=>{if(controller.signal.aborted)throw controller.signal.reason;return this.store.update(task.id,patch,event,token);};
    try {
      const result=await Promise.race([Promise.resolve().then(()=>this.execute(task,{signal:controller.signal,token,checkpoint,inference})),aborted]);
      if(controller.signal.aborted)return;
      completedCycle=true;
      const live=this.store.get(task.id);
      if(['PAUSED','CANCELLED','COMPLETED','FAILED','WAITING_FOR_USER','BLOCKED'].includes(live.status))return;
      const patch={...(result||{})};
      if(!patch.status)patch.status='SLEEPING';
      if(['ACTIVE','PLANNING','CREATED'].includes(patch.status))patch.status='SLEEPING';
      if(!task.persistent&&patch.status==='SLEEPING')patch.status='PAUSED';
      patch.retryCount=0;
      const progressed=(live.lastMeaningfulProgressAt||0)>(task.lastMeaningfulProgressAt||0)
        ||(Array.isArray(patch.evidence)&&patch.evidence.length>(live.evidence||[]).length)
        ||(Array.isArray(patch.completedSteps)&&patch.completedSteps.length>(live.completedSteps||[]).length);
      const repeatedShortWake=patch.status==='SLEEPING'&&!progressed
        &&(!Number.isFinite(patch.nextWakeAt)||patch.nextWakeAt<=this.now()+settings.minWakeMs);
      patch.noProgressCycles=repeatedShortWake?(live.noProgressCycles||0)+1:0;
      // A source/check-in wake already revisited progress known at claim time.
      patch.lastInitiativeProgressAt=Math.max(live.lastInitiativeProgressAt||0,task.lastMeaningfulProgressAt||0);
      patch.lastInitiativeAt=this.now();
      if(patch.noProgressCycles>=6){
        patch.status='WAITING_FOR_USER';
        patch.summary='No meaningful progress after repeated short wake cycles. What should Nethra try next?';
      }
      const modelWake=Number.isFinite(patch.nextWakeAt);
      patch.nextWakeAt=patch.status==='SLEEPING'?clampWake(patch.nextWakeAt,this.now(),settings.minWakeMs,settings.maxWakeMs):null;
      patch.lastInferenceFingerprint=fingerprint;patch.lastCycleProgressed=progressed;patch.unchangedWakes=progressed?0:(live.unchangedWakes||0);
      // Keep a reason the runner already recorded (schedule_wake, monitoring); otherwise this is a continuation.
      if(patch.status!=='SLEEPING')patch.wakeReason=null;
      else if(live.wakeReason&&live.wakeReason.at===live.nextWakeAt&&modelWake)patch.wakeReason={...live.wakeReason,at:patch.nextWakeAt};
      else if(modelWake)patch.wakeReason=wakeReason('SCHEDULED','A follow-up chosen during the last run',patch.nextWakeAt);
      else patch.wakeReason=wakeReason('CONTINUE',progressed?'Continue the plan after saved progress':'Continue; the last cycle saved no new progress',patch.nextWakeAt);
      // Attention observed during this cycle was not claimed; never sleep past it.
      const attentionDue=patch.status==='SLEEPING'?this.store.pendingAttentionDue?.(task.id):null;
      if(Number.isSafeInteger(attentionDue)&&clampWake(attentionDue,this.now(),settings.minWakeMs,settings.maxWakeMs)<patch.nextWakeAt){patch.nextWakeAt=clampWake(attentionDue,this.now(),settings.minWakeMs,settings.maxWakeMs);patch.wakeReason=wakeReason('ATTENTION','A watched source or objective event arrived during the last run',patch.nextWakeAt);}
      this.store.update(task.id,patch,'EXECUTED',token);
    } catch(error) {
      const live=this.store.get(task.id);
      if(['PAUSED','CANCELLED','COMPLETED','FAILED','WAITING_FOR_USER','BLOCKED'].includes(live.status))return;
      try {
        if(abortReason==='Wake runtime limit reached'){
          // Running out of wall time (often because the owner's chats had priority) is a yield
          // with saved checkpoints, not a failure; repeated yields without progress still stop.
          const progressed=(live.lastMeaningfulProgressAt||0)>(task.lastMeaningfulProgressAt||0);
          const cycles=progressed?0:(live.noProgressCycles||0)+1,wake=clampWake(this.now()+settings.minWakeMs,this.now(),settings.minWakeMs,settings.maxWakeMs);
          if(cycles>=6)this.store.update(task.id,{status:'WAITING_FOR_USER',noProgressCycles:cycles,nextWakeAt:null,wakeReason:null,summary:'Repeated wakes ran out of time without new progress. What should Nethra try next?'},'YIELD_EXHAUSTED',token);
          else this.store.update(task.id,{status:task.persistent?'SLEEPING':'PAUSED',noProgressCycles:cycles,nextWakeAt:task.persistent?wake:null,wakeReason:task.persistent?wakeReason('CONTINUE','Resume after the wake time limit; progress was checkpointed',wake):null},'YIELDED',token);
          return;
        }
        const failure=safeFailure(error),errors=[...live.errors,{at:this.now(),message:failure}].slice(-50),retryCount=(Number(live.retryCount)||0)+1;
        const exhausted=retryCount>=5;
        const wake=exhausted?null:clampWake(this.now()+MIN_WAKE*2**Math.min(retryCount-1,10),this.now(),settings.minWakeMs,settings.maxWakeMs);
        const summary=exhausted?'Nethra could not complete five consecutive wake attempts. Please check the local model or source, then tell me to retry.':abortReason?safeFailure(abortReason):failure;
        this.store.update(task.id,{status:exhausted?'WAITING_FOR_USER':task.persistent?'SLEEPING':'PAUSED',errors,retryCount,summary,nextWakeAt:wake,wakeReason:wake&&task.persistent?wakeReason('RETRY',`Retry ${retryCount} of 4 after: ${failure.slice(0,160)}`,wake):null},exhausted?'RETRY_EXHAUSTED':controller.signal.aborted?'INTERRUPTED':'RETRY_SCHEDULED',token);
      }catch(fenced){if(!/lease/i.test(fenced.message))throw fenced;}
    } finally {
      clearInterval(heartbeat);clearTimeout(deadline);removeAbort();
      try{this.store.endInference(task.id,token);}catch(error){if(!/lease/i.test(error.message))this.lastError=error;}
      this.store.release(task.id,token,completedCycle);this.controller=null;
      // Outcomes the owner should hear about go back to the conversation that started the work.
      if(this.onSettled){try{const settled=this.store.get(task.id);if(['COMPLETED','WAITING_FOR_USER','BLOCKED','FAILED'].includes(settled.status)||(settled.mode==='ONGOING'&&settled.status==='SLEEPING'))await this.onSettled(settled);}catch(error){this.lastError=error;}}
    }
  }
  /**
   * Starts loading the model shortly before the next wake that will need inference, so the
   * objective does not spend its first minute on a cold load. Bookkeeping-only wakes and
   * budget-exhausted days do not warm anything. One warm request per upcoming wake.
   */
  prepareUpcoming() {
    if(!this.warmBefore)return;
    try{
      const now=this.now(),settings=this.store.settings();if(!settings.enabled)return;
      const usage=this.store.usage('__global__');if(usage.globalMs>=settings.globalDailyBudgetMs)return;
      const next=this.store.list().filter(task=>['SLEEPING','CREATED','ACTIVE','PLANNING'].includes(task.status)&&task.persistent!==false&&Number.isSafeInteger(task.nextWakeAt)&&task.nextWakeAt>now&&task.nextWakeAt-now<=PREWARM_LEAD_MS)
        .filter(task=>!isRoutineMonitor(task,task.nextWakeAt,this.sourceStatus,this.store.pendingAttentionDue?.(task.id)!=null))
        .sort((a,b)=>a.nextWakeAt-b.nextWakeAt)[0];
      if(!next)return;
      const key=`${next.id}:${next.nextWakeAt}`;if(this.warmedFor===key)return;this.warmedFor=key;
      Promise.resolve(this.warmBefore(next)).catch(()=>{});
    }catch(error){this.lastError=error;}
  }
  async stop() {this.stopping=true;clearInterval(this.timer);this.timer=null;this.controller?.abort(new Error('Scheduler stopped'));await this.running;}
}
module.exports={NethraScheduler,clampWake,monitorWakeAt,wakeReason,inputFingerprint,isRoutineMonitor,PREWARM_LEAD_MS};
