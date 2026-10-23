'use strict';

/** Deterministic attention gate. Source adapters must pass stable source IDs and revisions. */
class NethraAttention {
  constructor(store,{now=Date.now}={}) {this.store=store;this.now=now;this.errors=[];}
  observe({taskId,source,sourceId,revision,kind='SOURCE_CHANGED',evidenceRef=null,priority=3,reasoningRequired=true,dueAt=this.now()}) {
    for(const [label,value] of Object.entries({taskId,source,sourceId,revision,kind})){
      if(typeof value!=='string'||!value.trim()||value.length>200)throw new Error(`Invalid attention ${label}`);
    }
    if(evidenceRef!==null&&(typeof evidenceRef!=='string'||evidenceRef.length>500))throw new Error('Invalid evidence reference');
    if(!Number.isSafeInteger(priority)||priority<1||priority>5)throw new Error('Invalid attention priority');
    if(typeof reasoningRequired!=='boolean')throw new Error('Invalid reasoning requirement');
    if(!Number.isSafeInteger(dueAt)||dueAt<this.now()-60_000||dueAt>this.now()+604800000)throw new Error('Invalid attention due time');
    return this.store.observeAttention({taskId,source,sourceId,revision,kind,evidenceRef,priority,reasoningRequired,dueAt});
  }
  /** One objective's failure is recorded and never blocks check-ins for the others. */
  reconcileCheckIns() {
    let queued=0;this.errors=[];
    for(const task of this.store.list()){
      if(task.status!=='SLEEPING'||!task.persistent)continue;
      try{queued+=this.reconcileTask(task);}catch(error){this.errors.push({taskId:task.id,message:String(error?.message||error).slice(0,400)});}
    }
    return queued;
  }
  /** A profile can revisit verified, unfinished work once per new progress checkpoint. */
  reconcileInitiative() {
    let queued=0;
    for(const task of this.store.list()){
      if(task.status!=='SLEEPING'||!task.persistent)continue;
      const interval=task.autonomy==='ACTIVE'?15*60_000:task.autonomy==='BALANCED'?60*60_000:null;
      if(!interval||!Array.isArray(task.pendingSteps)||!task.pendingSteps.length)continue;
      const progress=task.lastMeaningfulProgressAt;
      if(!Number.isSafeInteger(progress)||progress<=(task.lastInitiativeProgressAt||0))continue;
      const dueAttention=this.store.pendingAttentionDue(task.id);
      if(Number.isSafeInteger(dueAttention)&&dueAttention<=this.now())continue;
      if(this.now()<Math.max(progress,task.lastExecutionAt||0,task.lastInitiativeAt||0)+interval)continue;
      if((task.dependencies||[]).some(id=>{try{return this.store.get(id).status!=='COMPLETED';}catch{return true;}}))continue;
      try{
        const result=this.observe({taskId:task.id,source:'objective',sourceId:'initiative',revision:`${progress}-${task.autonomy}`,kind:'INITIATIVE_REVIEW',evidenceRef:`objective:${task.id}`,priority:task.priority||3});
        this.store.update(task.id,{lastInitiativeProgressAt:progress,lastInitiativeAt:this.now()},'INITIATIVE_ELIGIBLE');
        if(result.created)queued++;
      }catch(error){this.errors.push({taskId:task.id,message:String(error?.message||error).slice(0,400)});}
    }
    return queued;
  }
  reconcileTask(task) {
    const count=(task.completedSteps||[]).length;
    const milestone=task.checkIn==='MILESTONES'&&count>(task.lastMilestoneCount||0);
    const timed=['DAILY','WEEKLY'].includes(task.checkIn)&&Number.isSafeInteger(task.nextDirectionCheckAt)&&task.nextDirectionCheckAt<=this.now();
    if(!milestone&&!timed)return 0;
    const progressed=milestone||(task.lastMeaningfulProgressAt||0)>(task.lastDirectionAt||0);
    let queued=0;
    if(progressed){
      // lastDirectionAt changes only after this review is recorded, so a crash retry reuses the revision.
      const revision=milestone?`milestone-${count}-${task.lastDirectionAt||0}`:`check-in-${task.nextDirectionCheckAt}`;
      const result=this.observe({taskId:task.id,source:'objective',sourceId:'direction',revision,kind:'DIRECTION_REVIEW',evidenceRef:`objective:${task.id}`,priority:task.priority||3});
      if(result.created)queued=1;
    }
    const interval=task.checkIn==='DAILY'?86_400_000:task.checkIn==='WEEKLY'?7*86_400_000:null;
    this.store.update(task.id,{lastDirectionAt:this.now(),lastMilestoneCount:count,nextDirectionCheckAt:interval?this.now()+interval:null},progressed?'DIRECTION_DUE':'DIRECTION_DEFERRED');
    return queued;
  }
}
module.exports={NethraAttention};
