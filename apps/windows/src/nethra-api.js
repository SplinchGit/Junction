"use strict";
const crypto = require('node:crypto');
const {NethraAttention}=require('./nethra-attention');
const {progressView}=require('./nethra-progress');
const {performanceReport}=require('./nethra-performance');
const TYPES = ['nethra.edit','nethra.delete','nethra.warm','nethra.redirect','nethra.list','nethra.get','nethra.openChat','nethra.reunion','nethra.create','nethra.configure','nethra.control','nethra.approve','nethra.settings','nethra.status','nethra.answer','nethra.device.pull','nethra.device.result','nethra.device.enqueue','nethra.device.list','nethra.source.calendar','nethra.source.gmail','nethra.advisors'];
const DEVICE_ID=/^[A-Za-z0-9._:-]{1,160}$/;
class NethraApi {
  constructor({store,scheduler,runtime,localData=null,onSettings=async()=>{},deviceCommands=null,calendar=null,gmail=null,presence=null,onPhoneContact=null,advisors=null}) { Object.assign(this,{store,scheduler,runtime,localData,onSettings,deviceCommands,calendar,gmail,presence,onPhoneContact,advisors}); }
  /** Model residency for clients: connecting vs. cold vs. loading vs. ready is shown, not guessed. */
  modelState(){
    const state=this.runtime.modelState?.()||{state:'unknown'};
    return {state:state.state,model:state.model||'qwen3:30b',resident:Boolean(state.resident),warming:Boolean(state.warming),keepAlive:state.keepAlive||null,expiresAt:state.expiresAt||null,checkedAt:state.checkedAt||null,lastWarm:state.lastWarm||null,lastError:state.lastError||null,reason:state.reason||null};
  }
  async dispatch(type,payload={},requestId=crypto.randomUUID(),source='desktop') {
    if(!TYPES.includes(type))throw new Error('Unsupported Nethra operation');
    if(!payload||typeof payload!=='object'||Array.isArray(payload)||Buffer.byteLength(JSON.stringify(payload))>24000)throw new Error('Invalid Nethra payload');
    if(typeof requestId!=='string'||!requestId.length||requestId.length>160)throw new Error('Invalid request ID');
    const s=this.store;
    if(type==='nethra.list'){
      // live/step/progress let clients show where Nethra is without fetching each objective.
      const liveId=s.liveTaskId?.()??null,stepOf=t=>String((t.pendingSteps||[])[0]||'').slice(0,200)||null;
      const brief=t=>{try{const p=progressView(t,s,{liveTaskId:liveId});return {doing:p.doing,next:p.next,wake:p.wake,waitingFor:{kind:p.waitingFor.kind,detail:String(p.waitingFor.detail||'').slice(0,240)},lastAccomplished:p.lastAccomplished};}catch{return null;}};
      const objectives=s.list().slice(0,100).map(t=>({tracking:brief(t),live:t.id===liveId,step:stepOf(t),progress:{done:(t.completedSteps||[]).length,total:(t.completedSteps||[]).length+(t.pendingSteps||[]).length},id:t.id,conversationId:t.conversationId||null,goal:String(t.goal||'').slice(0,500),status:t.status,mode:t.mode||'FINITE',revision:t.revision,nextWakeAt:t.nextWakeAt,lastExecutionAt:t.lastExecutionAt,summary:String(t.summary||'').slice(0,500),persistent:t.persistent,autonomy:t.autonomy||'BALANCED',priority:t.priority||3,checkIn:t.checkIn||'WEEKLY',sources:t.sources||[],nextDirectionCheckAt:t.nextDirectionCheckAt||null,continuous:t.continuous===true,allowCodeWork:t.allowCodeWork===true,usage:(()=>{try{const u=s.usage(t.id);return {todayMs:u.taskMs};}catch{return null;}})()}));
      const result={objectives,settings:{...s.settings(),thinking:true}};
      for(let length=250;Buffer.byteLength(JSON.stringify(result))>50000&&length>=0;length=Math.floor(length/2)-1){
        for(const task of objectives){task.goal=task.goal.slice(0,length);task.summary=task.summary.slice(0,length);if(task.tracking&&length<120)task.tracking={doing:task.tracking.doing,wake:task.tracking.wake,waitingFor:{kind:task.tracking.waitingFor.kind}};}
      }
      if(Buffer.byteLength(JSON.stringify(result))>50000)throw new Error('Objective list exceeds the transport limit');
      return result;
    }
    if(type==='nethra.reunion'){
      const since=payload.since??0;
      if(!Number.isSafeInteger(since)||since<0||since>Date.now())throw new Error('Invalid reunion start time');
      const objectives=s.list().slice(0,100);
      return {modelInvoked:false,asOf:Date.now(),objectives:objectives.map(task=>({id:task.id,status:task.status,summary:String(task.summary||'').slice(0,300),nextWakeAt:task.nextWakeAt})),pendingApprovals:objectives.reduce((count,task)=>count+s.approvals(task.id).filter(item=>item.status==='PENDING').length,0),events:s.recentEvents(since,30).map(event=>({seq:event.seq,taskId:event.taskId,at:event.at,kind:event.kind,detail:JSON.stringify(event.detail).slice(0,300)}))};
    }
    if(type==='nethra.get') {
      const task=s.get(payload.id),approvals=s.approvals(task.id),events=s.events(task.id,Number.isSafeInteger(payload.after)?payload.after:0);
      const progress=progressView(task,s,{liveTaskId:s.liveTaskId?.()??null});
      const performance=performanceReport({store:s,localData:this.localData,taskId:task.id});
      // Raw sample values stay on the host; the view needs only the summaries and the verdict.
      const experiments=(s.experiments?.(task.id)||[]).slice(0,5).map(({baseline,...item})=>({...item,baseline:{count:baseline.count,median:baseline.median}}));
      if(source==='desktop')return {task,approvals,events,attention:s.attention(task.id),progress,performance,experiments};
      // Keep the exact actionable payload when it fits. Older approvals and
      // large evidence remain on Windows; the mobile frame is bounded.
      const pending=approvals.filter(item=>item.status==='PENDING');
      const selected=pending.length?pending[0]:null;
      const short=(value,max)=>String(value||'').slice(0,max);
      const briefList=value=>(Array.isArray(value)?value:[]).slice(-8).map(item=>short(item,300));
      const mobileTask={id:task.id,conversationId:task.conversationId||null,goal:short(task.goal,1000),successCriteria:short(task.successCriteria,1000),status:task.status,mode:task.mode||'FINITE',revision:task.revision,nextWakeAt:task.nextWakeAt,lastExecutionAt:task.lastExecutionAt,summary:short(task.summary,1000),plan:briefList(task.plan),completedSteps:briefList(task.completedSteps),pendingSteps:briefList(task.pendingSteps),evidence:(task.evidence||[]).slice(-4).map(item=>({tool:item.tool,result:short(JSON.stringify(item.result||item),800)})),errors:(task.errors||[]).slice(-3).map(item=>short(JSON.stringify(item),400)),persistent:task.persistent,thinking:task.thinking,autonomy:task.autonomy||'BALANCED',priority:task.priority||3,checkIn:task.checkIn||'WEEKLY',nextDirectionCheckAt:task.nextDirectionCheckAt||null,lastMeaningfulProgressAt:task.lastMeaningfulProgressAt||null};
      const mobileProgress={...progress,evidence:progress.evidence.slice(-4),outputs:progress.outputs.slice(-4).map(item=>({...item,path:String(item.path||'').slice(-200)}))};
      const result={progress:mobileProgress,performance,task:mobileTask,approvals:selected?[selected]:[],moreApprovals:Math.max(0,pending.length-(selected?1:0)),events:events.slice(-15).map(event=>({...event,detail:short(JSON.stringify(event.detail),300)})),attention:s.attention(task.id).slice(-10).map(item=>({kind:item.kind,source:item.source,evidenceRef:short(item.evidenceRef,300),state:item.state,dueAt:item.dueAt}))};
      if(Buffer.byteLength(JSON.stringify(result))>50000&&selected){
        const content=String(selected.args?.content||'');
        result.approvals=[{...selected,args:{...selected.args,content:content.slice(0,1000)},contentSha256:crypto.createHash('sha256').update(content).digest('hex'),reviewOnWindows:true}];
      }
      while(Buffer.byteLength(JSON.stringify(result))>50000&&result.events.length)result.events.shift();
      while(Buffer.byteLength(JSON.stringify(result))>50000&&result.attention.length)result.attention.shift();
      if(Buffer.byteLength(JSON.stringify(result))>50000)throw new Error('Objective detail is too large; inspect local evidence on Windows');
      return result;
    }
    if(type==='nethra.openChat') {
      if(!this.localData)throw new Error('Conversation storage is unavailable on this PC');
      const task=s.get(payload.id);
      if(task.conversationId){if(this.localData.isConversationDeleted(task.conversationId))throw new Error('This task chat was deleted. The task remains available in Tasks.');return {conversationId:task.conversationId,created:false};}
      const conversationId=`nethra_task_${task.id.replaceAll('-','_')}`;
      this.localData.ensureConversation(conversationId);
      const linked=s.linkConversation(task.id,conversationId);
      return {conversationId:linked.conversationId,created:linked.conversationId===conversationId};
    }
    if(type==='nethra.create') {
      if(source!=='desktop'&&(payload.readRoots?.length||payload.workspace))throw new Error('Approve local read folders on Windows');
      if('continuous' in payload&&typeof payload.continuous!=='boolean')throw new Error('Invalid continuous preference');
      if(source!=='desktop'&&payload.allowCodeWork===true)throw new Error('Enable Codex development work on Windows');
      let task=s.create({goal:payload.goal,successCriteria:payload.successCriteria||payload.goal,persistent:payload.persistent!==false,conversationId:payload.conversationId||null,readRoots:source==='desktop'?(payload.readRoots||[]):[],thinking:true,autonomy:payload.autonomy||'BALANCED',priority:payload.priority??3,checkIn:payload.checkIn||'WEEKLY',sources:payload.sources||[],mode:payload.mode||'FINITE',continuous:payload.continuous===true,allowCodeWork:payload.allowCodeWork===true,requestId});
      // Every objective gets a chat: progress, questions and outcomes go there, and the
      // owner's replies there reach the objective.
      if(!task.conversationId&&this.localData){
        const conversationId=`nethra_task_${task.id.replaceAll('-','_')}`;
        this.localData.ensureConversation(conversationId);
        try{this.localData.renameConversation(conversationId,`Task: ${String(task.goal).replace(/\s+/g,' ').slice(0,60)}`);}catch{}
        task=s.linkConversation(task.id,conversationId);
      }
      return {task};
    }
    if(type==='nethra.configure'){
      if(Object.keys(payload).some(key=>!['id','revision','autonomy','priority','checkIn','sources','mode','continuous','allowCodeWork'].includes(key)))throw new Error('Unknown objective configuration');
      if(source!=='desktop'&&payload.allowCodeWork===true)throw new Error('Enable Codex development work on Windows');
      return {task:s.configure(payload.id,Object.fromEntries(['autonomy','priority','checkIn','sources','mode','continuous','allowCodeWork'].filter(key=>Object.hasOwn(payload,key)).map(key=>[key,payload[key]])),payload.revision,requestId)};
    }
    if(type==='nethra.control')return {task:s.control(payload.id,payload.action,payload.revision,requestId)};
    if(type==='nethra.redirect'){
      if(typeof payload.instruction!=='string'||!payload.instruction.trim()||payload.instruction.length>4000)throw new Error('Provide a bounded new direction');
      return {task:s.redirect(payload.id,payload.instruction.trim(),payload.revision,requestId)};
    }
    if(type==='nethra.edit'){
      const changes=Object.fromEntries(['goal','successCriteria'].filter(key=>Object.hasOwn(payload,key)).map(key=>[key,payload[key]]));
      return {task:s.edit(payload.id,changes,payload.revision,requestId)};
    }
    if(type==='nethra.delete'){
      if(payload.confirm!==true)throw new Error('Confirm deletion');
      return s.remove(payload.id,requestId);
    }
    if(type==='nethra.warm'){
      // Loading never generates text, appends messages or creates tasks. Respond immediately;
      // clients poll status (or pass wait:true) rather than holding a request open for a minute.
      const reason=typeof payload.reason==='string'&&/^[a-z_]{1,40}$/.test(payload.reason)?payload.reason:'client';
      if('wait' in payload&&typeof payload.wait!=='boolean')throw new Error('Invalid wait flag');
      const priority=['chat_open','new_chat','chat_return','voice','manual'].includes(reason)?'interactive':'background';
      const warming=this.runtime.warmer?this.runtime.warmer.warm({reason:`${source}:${reason}`,priority,force:reason==='manual'&&source==='desktop'}):Promise.resolve(this.runtime.prewarm?.());
      if(payload.wait===true)await warming;else warming?.catch?.(()=>{});
      return {model:this.modelState()};
    }
    if(type==='nethra.approve') {
      if(typeof payload.approved!=='boolean')throw new Error('Choose Approve or Reject');
      return {approval:s.decideApproval(payload.id,payload.approved,requestId)};
    }
    if(type==='nethra.answer') {
      if(typeof payload.answer!=='string'||!payload.answer.trim()||payload.answer.length>4000)throw new Error('Provide a bounded answer');
      return {task:s.answer(payload.id,payload.answer.trim(),payload.revision,requestId)};
    }
    if(type==='nethra.source.calendar'||type==='nethra.source.gmail'){
      const key=type.slice('nethra.source.'.length),sourceApi=this[key],label=key==='gmail'?'Gmail':'Google Calendar';
      // Consent happens in the browser on this PC, so connecting is a Windows-only operation.
      if(source!=='desktop')throw new Error(`Connect ${label} on the Windows host`);
      if(!sourceApi)throw new Error(`${label} monitoring is unavailable on this host`);
      if(payload.action==='connect')return {[key]:await sourceApi.connect({clientId:payload.clientId,clientSecret:payload.clientSecret||''})};
      if(payload.action==='disconnect')return {[key]:await sourceApi.disconnect()};
      if(payload.action==='sync'){const result=await sourceApi.sync();return {[key]:sourceApi.status(),result};}
      throw new Error(`Unknown ${label} action`);
    }
    if(type.startsWith('nethra.device.')){
      const d=this.deviceCommands;if(!d)throw new Error('Device commands are unavailable on this host');
      // The phone is authenticated by pinned TLS or the paired relay key; deviceId only selects its queue.
      if(type==='nethra.device.pull'){if(!DEVICE_ID.test(payload.deviceId||''))throw new Error('Invalid device');try{this.onPhoneContact?.();}catch{}return {commands:d.pull(payload.deviceId,{limit:5})};}
      if(type==='nethra.device.result'){if(!DEVICE_ID.test(payload.deviceId||''))throw new Error('Invalid device');const command=d.result(payload.deviceId,{id:payload.id,state:payload.state,result:payload.result??null});
        // A result for an objective's check wakes that objective; the result itself stays untrusted data.
        if(command.taskId)try{new NethraAttention(s,{now:s.now}).observe({taskId:command.taskId,source:'device',sourceId:command.id,revision:command.state,evidenceRef:`device:${command.id}`,priority:2});}catch(error){if(!/Unknown Nethra task/.test(error.message))throw error;}
        return {id:command.id,state:command.state};}
      if(source!=='desktop')throw new Error('Device commands are issued from the Windows host');
      if(type==='nethra.device.enqueue')return {command:d.enqueue({kind:payload.kind,args:payload.args||{},requestedBy:payload.requestedBy||'owner',deviceId:payload.deviceId||'*',ttlMs:payload.ttlMs,requestId})};
      return {commands:d.list(payload.limit||20)};
    }
    if(type==='nethra.advisors') {
      if(source!=='desktop')throw new Error('Advisor usage is shown on this PC');
      if(!this.advisors)throw new Error('Advisors are unavailable on this host');
      return this.advisors();
    }
    if(type==='nethra.settings') {
      const allowed=['thinking','verbose','persistentStartup','minWakeMs','maxWakeMs','globalDailyMs','objectiveDailyMs','warmOnStartup','idleRetention','quietHours','proactiveUpdates','advisorReservePercent'];
      if(Object.keys(payload).some(key=>!allowed.includes(key)))throw new Error('Unknown Nethra setting');
      if(('persistentStartup' in payload||'warmOnStartup' in payload)&&source!=='desktop')throw new Error('Change Windows startup on this PC');
      if('advisorReservePercent' in payload&&source!=='desktop')throw new Error('Change advisor usage on this PC');
      if('thinking' in payload&&typeof payload.thinking!=='boolean')throw new Error('Invalid thinking preference');
      if(payload.thinking===false)throw new Error('Qwen3 30B always uses thinking');
      if('verbose' in payload&&typeof payload.verbose!=='boolean')throw new Error('Invalid verbose preference');
      if('persistentStartup' in payload&&typeof payload.persistentStartup!=='boolean')throw new Error('Invalid startup preference');
      const before=s.settings(),settings=s.setSettings(payload);
      try{await this.onSettings(settings,payload);}catch(error){s.setSettings(before);throw error;}
      return {settings};
    }
    // A status check from an opening client loads the model while the owner types. Newer
    // clients send warm:false for diagnostics (phone STATUS checks) and call nethra.warm.
    if(payload.warm!==false)this.runtime.prewarm?.('qwen3:30b',{reason:`${source}:status`,priority:'background'});
    let model={known:false,thinking:false};try{model=await this.runtime.modelCapabilities('qwen3:30b',AbortSignal.timeout(3000));}catch{}
    return {agent:'Nethra',model:'qwen3:30b',modelState:this.modelState(),presence:this.presence?.()||null,capabilities:model,thinkingRequired:true,settings:{...s.settings(),thinking:true},host:'Windows',schedulerRunning:Boolean(this.scheduler?.timer),activeObjectives:s.list().filter(t=>['PLANNING','ACTIVE'].includes(t.status)).length,sources:{calendar:this.calendar?.status()||{status:'DISCONNECTED'},gmail:this.gmail?.status()||{status:'DISCONNECTED'}}};
  }
}
module.exports={NethraApi,NETHRA_TYPES:TYPES};
