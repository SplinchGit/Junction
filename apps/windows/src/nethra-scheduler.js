'use strict';
const {randomUUID}=require('node:crypto');
const {NethraAttention}=require('./nethra-attention');
const MIN_WAKE=300000, MAX_WAKE=604800000, MAX_RUNTIME=600000, LEASE_MS=660000;
function clampWake(at,now=Date.now(),min=MIN_WAKE,max=MAX_WAKE) {return Math.min(now+max,Math.max(now+min,Number.isFinite(at)?at:now+min));}
const MONITOR_INTERVAL_MS=Object.freeze({QUIET:7*86_400_000,BALANCED:86_400_000,ACTIVE:6*3_600_000});
function monitorWakeAt(task,now=Date.now()) {return now+(MONITOR_INTERVAL_MS[task.autonomy]||MONITOR_INTERVAL_MS.BALANCED);}

/** Polling checks durable due dates; inference runs only after a successful claim. */
class NethraScheduler {
  constructor({store,execute,now=Date.now,pollMs=1000,owner=randomUUID(),onSettled=null,sourceStatus=null}) {this.store=store;this.execute=execute;this.onSettled=onSettled;this.sourceStatus=sourceStatus;this.now=now;this.pollMs=Math.max(10,pollMs);this.owner=owner;this.attention=new NethraAttention(store,{now});this.lastAttentionSweep=0;this.running=null;this.controller=null;this.stopping=false;}
  start() {if(this.timer)return;this.stopping=false;const poll=()=>this.tick().catch(error=>{this.lastError=error;});this.timer=setInterval(poll,this.pollMs);this.timer.unref?.();poll();}
  tick() {if(this.stopping)return Promise.resolve();if(this.running)return this.running;this.running=this.run().finally(()=>{this.running=null;});return this.running;}
  async run() {
    if(this.now()-this.lastAttentionSweep>=15_000){this.lastAttentionSweep=this.now();try{this.attention.reconcileCheckIns();this.attention.reconcileInitiative();if(this.attention.errors.length)this.lastError=new Error(`Attention sweep failed for ${this.attention.errors.length} objective(s): ${this.attention.errors[0].message}`);}catch(error){this.lastError=error;}}
    const claim=this.store.claim(this.owner,LEASE_MS);if(!claim)return;
    const {task,token}=claim,controller=new AbortController();this.controller=controller;
    // Source adapters have already compared stable revisions. A routine checkpoint with
    // no changed evidence needs bookkeeping, not a fresh 30B inference.
    if(task.mode==='ONGOING'&&task.lastMilestoneAt!=null&&(task.sources||[]).length>0
      &&!(task.pendingSteps||[]).length&&this.sourceStatus
      &&task.sources.every(source=>{try{return this.sourceStatus(source)?.status==='CONNECTED';}catch{return false;}})
      &&!this.store.hasClaimedReasoningAttention(task.id,token)
      &&!(Number.isSafeInteger(task.nextDirectionCheckAt)&&task.nextDirectionCheckAt<=this.now())){
      try{this.store.update(task.id,{status:'SLEEPING',nextWakeAt:monitorWakeAt(task,this.now())},'MONITOR_IDLE',token);}
      finally{this.store.release(task.id,token);this.controller=null;}
      return;
    }
    const started=this.now(),settings=this.store.settings();
    let abortReason='';
    const abort=reason=>{abortReason=reason;controller.abort(new Error(reason));};
    const heartbeat=setInterval(()=>{try{const live=this.store.get(task.id);if(['PAUSED','CANCELLED'].includes(live.status)){abort(live.status);return;}if(!this.store.renew(task.id,token,LEASE_MS)){abort('Lease lost');return;}const usage=this.store.usage(task.id);if(usage.globalMs>=settings.globalDailyBudgetMs||usage.taskMs>=settings.objectiveDailyBudgetMs)abort('Inference time budget reached');}catch(error){abort(error.message);}},Math.min(this.pollMs,1000));
    const deadline=setTimeout(()=>abort('Wake runtime limit reached'),MAX_RUNTIME);
    const inference=async callback=>{
      controller.signal.throwIfAborted();const usage=this.store.usage(task.id);
      const allowance=Math.min(MAX_RUNTIME,settings.globalDailyBudgetMs-usage.globalMs,settings.objectiveDailyBudgetMs-usage.taskMs);
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
      patch.nextWakeAt=patch.status==='SLEEPING'?clampWake(patch.nextWakeAt,this.now(),settings.minWakeMs,settings.maxWakeMs):null;
      // Attention observed during this cycle was not claimed; never sleep past it.
      const attentionDue=patch.status==='SLEEPING'?this.store.pendingAttentionDue?.(task.id):null;
      if(Number.isSafeInteger(attentionDue))patch.nextWakeAt=Math.min(patch.nextWakeAt,clampWake(attentionDue,this.now(),settings.minWakeMs,settings.maxWakeMs));
      this.store.update(task.id,patch,'EXECUTED',token);
    } catch(error) {
      const live=this.store.get(task.id);
      if(['PAUSED','CANCELLED','COMPLETED','FAILED','WAITING_FOR_USER','BLOCKED'].includes(live.status))return;
      try {
        const errors=[...live.errors,{at:this.now(),message:String(error?.message||error).slice(0,4000)}].slice(-50),retryCount=(Number(live.retryCount)||0)+1;
        const wake=clampWake(this.now()+MIN_WAKE*2**Math.min(retryCount-1,10),this.now(),settings.minWakeMs,settings.maxWakeMs);
        this.store.update(task.id,{status:task.persistent?'SLEEPING':'PAUSED',errors,retryCount,summary:abortReason||String(error?.message||error),nextWakeAt:wake},controller.signal.aborted?'INTERRUPTED':'RETRY_SCHEDULED',token);
      }catch(fenced){if(!/lease/i.test(fenced.message))throw fenced;}
    } finally {
      clearInterval(heartbeat);clearTimeout(deadline);removeAbort();
      try{this.store.endInference(task.id,token);}catch(error){if(!/lease/i.test(error.message))this.lastError=error;}
      this.store.release(task.id,token,completedCycle);this.controller=null;
      // Outcomes the owner should hear about go back to the conversation that started the work.
      if(this.onSettled){try{const settled=this.store.get(task.id);if(['COMPLETED','WAITING_FOR_USER','BLOCKED','FAILED'].includes(settled.status)||(settled.mode==='ONGOING'&&settled.status==='SLEEPING'))await this.onSettled(settled);}catch(error){this.lastError=error;}}
    }
  }
  async stop() {this.stopping=true;clearInterval(this.timer);this.timer=null;this.controller?.abort(new Error('Scheduler stopped'));await this.running;}
}
module.exports={NethraScheduler,clampWake,monitorWakeAt};
