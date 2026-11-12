"use strict";
const crypto = require('node:crypto');
const {NethraAttention}=require('./nethra-attention');
const {progressView}=require('./nethra-progress');
const {performanceReport}=require('./nethra-performance');
const {isSupportedLocalModel}=require('./model-catalog');
const {NEXT_80B_THINKING_Q4_MODEL}=require('./nethra-models');
const {taskContract}=require('./nethra-task-contract');
const {projectDocumentStatus}=require('./nethra-project-documents');
const {codeWorkSummary}=require('./nethra-work-status');
const TYPES = ['nethra.agent.create','nethra.projectDocument','nethra.project','nethra.edit','nethra.delete','nethra.warm','nethra.redirect','nethra.list','nethra.get','nethra.openChat','nethra.reunion','nethra.create','nethra.configure','nethra.control','nethra.approve','nethra.settings','nethra.status','nethra.answer','nethra.message','nethra.device.pull','nethra.device.result','nethra.device.enqueue','nethra.device.list','nethra.source.calendar','nethra.source.gmail','nethra.advisors','nethra.child.stop'];
const DEVICE_ID=/^[A-Za-z0-9._:-]{1,160}$/;
function childSummary(child) {
  return {id:child.id,scope:String(child.scope||'').slice(0,240),status:child.status,model:child.model,
    startedAt:child.startedAt,finishedAt:child.finishedAt??null,report:String(child.result?.report||'').slice(0,400),error:String(child.error||'').slice(0,200)};
}
class NethraApi {
  constructor({store,scheduler,runtime,localData=null,onSettings=async()=>{},deviceCommands=null,calendar=null,gmail=null,presence=null,onPhoneContact=null,advisors=null,describeTask=null,onDeleteTask=null,onCoordinationControl=null,listProjects=()=>[],listProjectDocuments=()=>[],readProjectDocument=null}) { Object.assign(this,{store,scheduler,runtime,localData,onSettings,deviceCommands,calendar,gmail,presence,onPhoneContact,advisors,describeTask,onDeleteTask,onCoordinationControl,listProjects,listProjectDocuments,readProjectDocument}); }
  async reconcileDeletions(id=null) {
    const records=id?[this.store.deletion(id)].filter(Boolean):this.store.pendingDeletions();
    for(const record of records){
      if(record.cleanup.related==='DONE')continue;
      try{
        this.deviceCommands?.cancelForTask(record.id);
        await this.onDeleteTask?.(record.id);
        this.store.finishDeletionEffects(record.id);
      }catch(error){this.store.finishDeletionEffects(record.id,error);}
    }
  }
  /** Model residency for clients: connecting vs. cold vs. loading vs. ready is shown, not guessed. */
  modelState(model='qwen3:30b'){
    const state=this.runtime.modelState?.(model)||{state:'unknown'};
    return {state:state.state,model:state.model||model,resident:Boolean(state.resident),warming:Boolean(state.warming),keepAlive:state.keepAlive||null,expiresAt:state.expiresAt||null,checkedAt:state.checkedAt||null,lastWarm:state.lastWarm||null,lastError:state.lastError||null,reason:state.reason||null};
  }
  activeModel(){
    const id=this.store.liveTaskId?.();
    return id?(this.store.get(id).model||'qwen3:30b'):null;
  }
  async dispatch(type,payload={},requestId=crypto.randomUUID(),source='desktop',{projectId,parentTaskId}={}) {
    if(!TYPES.includes(type))throw new Error('Unsupported Nethra operation');
    if(!payload||typeof payload!=='object'||Array.isArray(payload)||Buffer.byteLength(JSON.stringify(payload))>24000)throw new Error('Invalid Nethra payload');
    if(typeof requestId!=='string'||!requestId.length||requestId.length>160)throw new Error('Invalid request ID');
    const s=this.store;
    if(type==='nethra.child.stop'){
      if(typeof payload.id!=='string'||!payload.id||payload.id.length>160||typeof payload.childId!=='string'||!payload.childId||payload.childId.length>160)throw new Error('Invalid child task reference');
      return {child:childSummary(s.stopChild(payload.id,payload.childId,requestId))};
    }
    if(type==='nethra.list'){
      const offset=payload.offset??0;if(!Number.isSafeInteger(offset)||offset<0||offset>100000)throw new Error('Invalid objective list offset');
      const all=s.list();
      // live/step/progress let clients show where Nethra is without fetching each objective.
      const liveId=s.liveTaskId?.()??null,stepOf=t=>String((t.pendingSteps||[])[0]||'').slice(0,200)||null;
      const brief=t=>{try{const p=progressView(t,s,{liveTaskId:liveId});return {doing:p.doing,next:p.next,wake:p.wake,waitingFor:{kind:p.waitingFor.kind,detail:String(p.waitingFor.detail||'').slice(0,240)},lastAccomplished:p.lastAccomplished};}catch{return null;}};
      const objectives=all.slice(offset,offset+100).map(t=>({tracking:brief(t),live:t.id===liveId,step:stepOf(t),progress:{done:(t.completedSteps||[]).length,total:(t.completedSteps||[]).length+(t.pendingSteps||[]).length},id:t.id,parentId:t.parentId||null,conversationId:t.conversationId||null,goal:String(t.goal||'').slice(0,500),status:t.status,mode:t.mode||'FINITE',model:t.model||'qwen3:30b',coordinateSelfImprovement:t.coordinateSelfImprovement===true,revision:t.revision,nextWakeAt:t.nextWakeAt,lastExecutionAt:t.lastExecutionAt,summary:String(t.summary||'').slice(0,500),persistent:t.persistent,autonomy:t.autonomy||'BALANCED',priority:t.priority||3,checkIn:t.checkIn||'WEEKLY',sources:t.sources||[],nextDirectionCheckAt:t.nextDirectionCheckAt||null,continuous:t.continuous===true,allowCodeWork:t.allowCodeWork===true,usage:(()=>{try{const u=s.usage(t.id);return {todayMs:u.taskMs};}catch{return null;}})()}));
      const result={objectives,nextOffset:offset+objectives.length<all.length?offset+objectives.length:null,settings:{...s.settings(),thinking:true}};
      for(let length=250;Buffer.byteLength(JSON.stringify(result))>50000&&length>=80;length=Math.floor(length/2)-1){
        for(const task of objectives){task.goal=task.goal.slice(0,length);task.summary=task.summary.slice(0,length);if(task.tracking&&length<120)task.tracking={doing:task.tracking.doing,wake:task.tracking.wake,waitingFor:{kind:task.tracking.waitingFor.kind}};}
      }
      while(Buffer.byteLength(JSON.stringify(result))>50000&&objectives.length>1)objectives.pop();
      result.nextOffset=offset+objectives.length<all.length?offset+objectives.length:null;
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
      if(payload.diagnosticsCursor!==undefined){
        s.get(payload.id);
        const {seq,offset}=payload.diagnosticsCursor||{};
        if(!Number.isSafeInteger(seq)||seq<0||!Number.isSafeInteger(offset)||offset<0)throw new Error('Invalid diagnostics cursor');
        const rows=s.events(payload.id,Math.max(0,seq-1));
        const event=rows[0];if(!event)return {events:[],nextCursor:null};
        const full=JSON.stringify(event.detail);
        if(offset>full.length||(offset&&event.seq!==seq))throw new Error('Invalid diagnostics offset');
        const detail=full.slice(offset,offset+8000),end=offset+detail.length;
        return {events:[{seq:event.seq,at:event.at,kind:event.kind,detail,continued:offset>0}],nextCursor:end<full.length?{seq:event.seq,offset:end}:rows.length>1?{seq:event.seq+1,offset:0}:null};
      }
      const task=s.get(payload.id),approvals=s.approvals(task.id),events=s.events(task.id,Number.isSafeInteger(payload.after)?payload.after:0);
      const progress=progressView(task,s,{liveTaskId:s.liveTaskId?.()??null});
      const performance=performanceReport({store:s,localData:this.localData,taskId:task.id});
      // Raw sample values stay on the host; the view needs only the summaries and the verdict.
      const experiments=(s.experiments?.(task.id)||[]).slice(0,5).map(({baseline,...item})=>({...item,baseline:{count:baseline.count,median:baseline.median}}));
      const contract=this.describeTask?this.describeTask(task):taskContract(task);
      const children=(s.recentChildren?.(task.id,8)||[]).map(childSummary);
      const liveId=s.liveTaskId?.()??null;
      const agents=(s.recentAgents?.(task.id)||[]).map(agent=>{
        const tracking=progressView(agent,s,{liveTaskId:liveId});
        return {id:agent.id,goal:String(agent.goal).slice(0,160),status:agent.status,revision:agent.revision,
          live:agent.id===liveId,continuous:agent.continuous===true,mode:agent.mode,nextWakeAt:agent.nextWakeAt,
          tracking:{doing:tracking.doing,waitingFor:{kind:tracking.waitingFor.kind},wake:tracking.wake}};
      });
      const codeWork=this.listProjects().filter(project=>project.sourceObjectiveId===task.id).slice(0,4).map(codeWorkSummary);
      if(source==='desktop'){
        const projectDocuments=task.projectId?this.listProjectDocuments(task.projectId):[];
        return {task,codeWork,approvals,events,attention:s.attention(task.id),progress,performance,experiments,contract,children,agents,projects:this.listProjects().map(({id,name})=>({id,name})),projectDocuments,approvedDocumentStatus:projectDocumentStatus(task,projectDocuments)};
      }
      // Keep the exact actionable payload when it fits. Older approvals and
      // large evidence remain on Windows; the mobile frame is bounded.
      const pending=approvals.filter(item=>item.status==='PENDING');
      const selected=payload.approvalId===undefined ? (pending[0]||null) : (pending.find(item=>item.id===payload.approvalId&&item.expiresAt>s.now())||null);
      const short=(value,max)=>String(value||'').slice(0,max);
      const briefList=value=>(Array.isArray(value)?value:[]).slice(-8).map(item=>short(item,300));
      const mobileTask={id:task.id,parentId:task.parentId||null,conversationId:task.conversationId||null,goal:short(task.goal,1000),successCriteria:short(task.successCriteria,1000),status:task.status,mode:task.mode||'FINITE',model:task.model||'qwen3:30b',continuous:task.continuous===true,revision:task.revision,nextWakeAt:task.nextWakeAt,lastExecutionAt:task.lastExecutionAt,summary:short(task.summary,1000),plan:briefList(task.plan),completedSteps:briefList(task.completedSteps),pendingSteps:briefList(task.pendingSteps),evidence:(task.evidence||[]).slice(-4).map(item=>({tool:item.tool,result:short(JSON.stringify(item.result||item),800)})),errors:(task.errors||[]).slice(-3).map(item=>short(JSON.stringify(item),400)),persistent:task.persistent,thinking:task.thinking,autonomy:task.autonomy||'BALANCED',priority:task.priority||3,checkIn:task.checkIn||'WEEKLY',nextDirectionCheckAt:task.nextDirectionCheckAt||null,lastMeaningfulProgressAt:task.lastMeaningfulProgressAt||null};
      const mobileProgress={...progress,evidence:progress.evidence.slice(-4),outputs:progress.outputs.slice(-4).map(item=>({...item,path:String(item.path||'').slice(-200)}))};
            const coordination=task.coordinateSelfImprovement&&task.coordination?{stage:task.coordination.stage,advisors:Object.fromEntries(Object.entries(task.coordination.advisors||{}).map(([name,value])=>[name,{status:value.status,retryAt:value.retryAt??null,reason:short(value.reason,200)}]))}:null;
      const result={codeWork,coordination,...(payload.approvalId!==undefined&&!selected?{approvalUnavailable:true}:{}),progress:mobileProgress,performance,task:mobileTask,contract,children,agents,approvals:selected?[selected]:[],moreApprovals:Math.max(0,pending.length-(selected?1:0)),events:events.slice(-15).map(event=>({...event,detail:short(JSON.stringify(event.detail),300)})),attention:s.attention(task.id).slice(-10).map(item=>({kind:item.kind,source:item.source,evidenceRef:short(item.evidenceRef,300),state:item.state,dueAt:item.dueAt}))};
      if(Buffer.byteLength(JSON.stringify(result))>50000&&selected){
        const content=String(selected.args?.content||'');
        result.approvals=[{...selected,args:{...selected.args,content:content.slice(0,1000)},contentSha256:crypto.createHash('sha256').update(content).digest('hex'),reviewOnWindows:true}];
      }
      while(Buffer.byteLength(JSON.stringify(result))>50000&&result.events.length)result.events.shift();
      while(Buffer.byteLength(JSON.stringify(result))>50000&&result.attention.length)result.attention.shift();
      while(Buffer.byteLength(JSON.stringify(result))>50000&&result.children.length>1)result.children.pop();
      while(Buffer.byteLength(JSON.stringify(result))>50000&&result.agents.length>1)result.agents.pop();
      if(Buffer.byteLength(JSON.stringify(result))>50000)throw new Error('Objective detail is too large; inspect local evidence on Windows');
      return result;
    }
    if(type==='nethra.openChat') {
      if(!this.localData)throw new Error('Conversation storage is unavailable on this PC');
      const task=s.get(payload.id);
      if(task.conversationId&&this.localData.isConversationDeleted(task.conversationId))throw new Error('This task chat was deleted. The task remains available in Tasks.');
      let invitationEventId;
      if(payload.invitationQuestionId!==undefined||payload.invitationCommandId!==undefined){
        const {invitationQuestion,notificationDeliveryPolicy}=require('./nethra-conversation-report');
        const question=invitationQuestion(task,s,s.settings());
        const unavailable=()=>new Error('This voice invitation is no longer pending.');
        if(!question||question.id!==payload.invitationQuestionId||!this.deviceCommands||!DEVICE_ID.test(payload.deviceId||'')||
          typeof payload.invitationCommandId!=='string'||!DEVICE_ID.test(payload.invitationCommandId))throw unavailable();
        const command=this.deviceCommands.row(payload.invitationCommandId);
        const policy=value=>notificationDeliveryPolicy(value,s);
        if(!command||!['DELIVERED','SUCCEEDED'].includes(command.state)||command.kind!=='NETHRA_NOTIFICATION'||command.args.voiceInvite!==true||command.taskId!==task.id||
          command.args.questionId!==question.id||command.deliveredTo!==payload.deviceId||policy(command)==='cancel')throw unavailable();
        const accepted=this.deviceCommands.result(payload.deviceId,{id:command.id,state:'SUCCEEDED',result:{notificationAction:'ANSWER'}},{notificationPolicy:policy});
        if(accepted.ownerAction?.action!=='ANSWER'||accepted.ownerAction.disposition!=='ACKNOWLEDGED')throw unavailable();
        invitationEventId=command.args.eventId;
      }
      const invitation=invitationEventId?{invitationEventId}:{};
      if(task.conversationId)return {conversationId:task.conversationId,created:false,...invitation};
      const conversationId=`nethra_task_${task.id.replaceAll('-','_')}`;
      this.localData.ensureConversation(conversationId);
      const linked=s.linkConversation(task.id,conversationId);
      return {conversationId:linked.conversationId,created:linked.conversationId===conversationId,...invitation};
    }
    if(type==='nethra.agent.create'){
      if(typeof payload.id!=='string'||!DEVICE_ID.test(payload.id)||Object.keys(payload).some(key=>!['id','goal','successCriteria'].includes(key)))throw new Error('Invalid agent request');
      if(typeof payload.goal!=='string'||!payload.goal.trim()||payload.goal.length>2000||
        (payload.successCriteria!==undefined&&(typeof payload.successCriteria!=='string'||payload.successCriteria.length>1000)))throw new Error('Describe the agent assignment');
      return this.dispatch('nethra.create',{goal:payload.goal,successCriteria:payload.successCriteria,continuous:true},requestId,source,{parentTaskId:payload.id});
    }
    if(type==='nethra.create') {
      if(source!=='desktop'&&(payload.readRoots?.length||payload.workspace))throw new Error('Approve local read folders on Windows');
      if('continuous' in payload&&typeof payload.continuous!=='boolean')throw new Error('Invalid continuous preference');
      if(source!=='desktop'&&payload.allowCodeWork===true)throw new Error('Enable Codex development work on Windows');
      let task=s.create({...(parentTaskId?{parentTaskId}:{}),...(projectId?{projectId}:{}),goal:payload.goal,successCriteria:payload.successCriteria||payload.goal,persistent:payload.persistent!==false,conversationId:payload.conversationId||null,readRoots:source==='desktop'?(payload.readRoots||[]):[],thinking:true,autonomy:payload.autonomy||'BALANCED',priority:payload.priority??3,checkIn:payload.checkIn||'WEEKLY',sources:payload.sources||[],mode:payload.mode||'FINITE',model:payload.model||'qwen3:30b',continuous:payload.continuous===true,allowCodeWork:payload.allowCodeWork===true,requestId});
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
      if(Object.keys(payload).some(key=>!['id','revision','autonomy','priority','checkIn','sources','mode','continuous','allowCodeWork','model','coordinateSelfImprovement'].includes(key)))throw new Error('Unknown objective configuration');
      if(source!=='desktop'&&(payload.allowCodeWork===true||Object.hasOwn(payload,'coordinateSelfImprovement')))throw new Error('Change development coordination on Windows');
      const task=s.configure(payload.id,Object.fromEntries(['autonomy','priority','checkIn','sources','mode','continuous','allowCodeWork','model','coordinateSelfImprovement'].filter(key=>Object.hasOwn(payload,key)).map(key=>[key,payload[key]])),payload.revision,requestId);
      if(payload.coordinateSelfImprovement===false||payload.allowCodeWork===false)await this.onCoordinationControl?.(task,'pause');
      return {task};
    }
    if(type==='nethra.control'){
      const task=s.control(payload.id,payload.action,payload.revision,requestId);
      if(task.coordinateSelfImprovement&&['pause','cancel','resume'].includes(payload.action))await this.onCoordinationControl?.(task,payload.action);
      return {task};
    }
    if(type==='nethra.message'){
      const result=s.chatTurn(payload.id,payload.text,requestId,{conversationId:payload.conversationId||null,questionId:payload.questionId??null,noteOnly:payload.noteOnly===undefined?false:payload.noteOnly,revision:payload.revision??null});
      const task=s.get(payload.id);
      if(task.coordination?.stage==='tracking'&&require('./nethra-coordination').ownerBrief(task)!==(task.coordination.brief||''))await this.onCoordinationControl?.(task,'pause');
      return result;
    }
    if(type==='nethra.redirect'){
      if(typeof payload.instruction!=='string'||!payload.instruction.trim()||payload.instruction.length>10000)throw new Error('Provide a bounded new direction');
      if(payload.skipPendingDrafts!==undefined&&typeof payload.skipPendingDrafts!=='boolean')throw new Error('Invalid draft skip preference');
      const task=s.redirect(payload.id,payload.instruction.trim(),payload.revision,requestId,payload.skipPendingDrafts===true);
      if(task.coordination)await this.onCoordinationControl?.(task,'pause');
      return {task};
    }
    if(type==='nethra.projectDocument'){
      if(source!=='desktop'||!this.readProjectDocument)throw new Error('Manage project document access on Windows');
      return {task:s.setProjectDocument(payload.id,payload.documentId,payload.documentRevision,payload.revision,requestId,this.readProjectDocument)};
    }
    if(type==='nethra.project'){
      if(source!=='desktop')throw new Error('Assign projects in Junction on Windows');
      const {id,projectId,revision}=payload;
      return {task:s.assignProject(id,projectId,revision,requestId,key=>this.listProjects().some(project=>project.id===key))};
    }
    if(type==='nethra.edit'){
      const changes=Object.fromEntries(['goal','successCriteria'].filter(key=>Object.hasOwn(payload,key)).map(key=>[key,payload[key]]));
      const instruction=payload.instruction||'';
      if(typeof instruction!=='string'||instruction.length>10000)throw new Error('Invalid edit instruction');
      const replay=s.editReceipt(requestId,payload.id,changes,payload.revision,instruction,payload.execution);
      if(replay)return {task:replay};
      let execution=payload.execution;
      if(execution!==undefined&&!['preserve','replan','continue'].includes(execution))throw new Error('Invalid edit execution intent');
      if(execution===undefined){
        const stopped=['COMPLETED','CANCELLED','FAILED','PAUSED'].includes(s.get(payload.id).status);
        const negative=/\b(?:do not|don't|never|without)\b.*\b(?:resume|restart|continue|redo|retry|run)\b/i.test(instruction);
        const resume=/^(?:please\s+)?(?:continue|resume|restart|redo|retry|rework)\b/i.test(instruction.trim());
        const metadata=/\b(?:title|wording|typo|rename|spelling)\b/i.test(instruction);
        if(negative)execution='preserve';
        else if(resume)execution='continue';
        else if(metadata)execution='preserve';
        else if(stopped&&instruction.trim())return {clarification:'Should I keep this task stopped and update its wording, or continue work with your new direction?'};
        else execution=stopped?'preserve':'replan';
      }
      const task=s.edit(payload.id,changes,payload.revision,requestId,{execution,instruction});
      if(task.coordination&&execution!=='preserve')await this.onCoordinationControl?.(task,'pause');
      return {task};
    }
    if(type==='nethra.delete'){
      if(payload.confirm!==true)throw new Error('Confirm deletion');
      const result=s.remove(payload.id,requestId);
      this.scheduler?.abortTask?.(payload.id);
      await this.reconcileDeletions(payload.id);
      return s.deletionResult(payload.id);
    }
    if(type==='nethra.warm'){
      // Loading never generates text, appends messages or creates tasks. Respond immediately;
      // clients poll status (or pass wait:true) rather than holding a request open for a minute.
      const reason=typeof payload.reason==='string'&&/^[a-z_]{1,40}$/.test(payload.reason)?payload.reason:'client';
      if('wait' in payload&&typeof payload.wait!=='boolean')throw new Error('Invalid wait flag');
      const model=payload.model||'qwen3:30b';
      if(typeof model!=='string'||!isSupportedLocalModel(model))throw new Error('Unsupported local model');
      const activeModel=this.activeModel();
      if(activeModel&&activeModel!==model)return {model:{...this.modelState(model),state:'deferred',warming:false,reason:`An objective is running on ${activeModel}; ${model} warm-up will wait until that model pass ends.`}};
      const priority=['chat_open','new_chat','chat_return','voice','manual'].includes(reason)?'interactive':'background';
      const options={reason:`${source}:${reason}`,priority,force:reason==='manual'&&source==='desktop'};
      if(model===NEXT_80B_THINKING_Q4_MODEL&&!options.force)return {model:{...this.modelState(model),state:'deferred',warming:false,reason:'Thinking Q4 loads when you send a message or run a task.'}};
      const warmer=this.runtime.warmerFor?.(model)||(model==='qwen3:30b'?this.runtime.warmer:null);
      const warming=warmer?.warm?warmer.warm(options):Promise.resolve(this.runtime.prewarm?.(model,options));
      if(payload.wait===true)await warming;else warming?.catch?.(()=>{});
      return {model:this.modelState(model)};
    }
    if(type==='nethra.approve') {
      if(typeof payload.approved!=='boolean')throw new Error('Choose Approve or Reject');
      return {approval:s.decideApproval(payload.id,payload.approved,requestId)};
    }
    if(type==='nethra.answer') {
      if(typeof payload.answer!=='string'||!payload.answer.trim()||payload.answer.length>10000)throw new Error('Provide a bounded answer');
      return {task:s.answer(payload.id,payload.answer.trim(),payload.revision,requestId,payload.questionId??null)};
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
      if(type==='nethra.device.pull'){if(!DEVICE_ID.test(payload.deviceId||''))throw new Error('Invalid device');try{this.onPhoneContact?.();}catch{}return {commands:d.pull(payload.deviceId,{limit:5,notificationPolicy:command=>require('./nethra-conversation-report').notificationDeliveryPolicy(command,this.store,{projects:this.listProjects})})};}
      if(type==='nethra.device.result'){if(!DEVICE_ID.test(payload.deviceId||''))throw new Error('Invalid device');const command=d.result(payload.deviceId,{id:payload.id,state:payload.state,result:payload.result??null},{notificationPolicy:command=>require('./nethra-conversation-report').notificationDeliveryPolicy(command,this.store,{projects:this.listProjects})});
        // A result for an objective's check wakes that objective; the result itself stays untrusted data.
        if(command.taskId&&command.kind!=='NETHRA_NOTIFICATION')try{new NethraAttention(s,{now:s.now}).observe({taskId:command.taskId,source:'device',sourceId:command.id,revision:command.state,evidenceRef:`device:${command.id}`,priority:2});}catch(error){if(!/Unknown Nethra task/.test(error.message))throw error;}
        return {id:command.id,state:command.state,ownerAction:command.ownerAction||null};}
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
      // Side effects can await Windows startup registration. Serialize this shared settings
      // path so a failed registration cannot roll back a phone's newer acknowledged choice.
      const pending=this.settingsPending;
      let release;
      this.settingsPending=new Promise(resolve=>{release=resolve;});
      await pending;
      try {
      const allowed=['thinking','verbose','persistentStartup','minWakeMs','maxWakeMs','globalDailyMs','objectiveDailyMs','warmOnStartup','idleRetention','quietHours','proactiveUpdates','advisorReservePercent','notificationDeviceId','voiceInvitations','childDelegation','taskAgentsEnabled','projectNotification'];
      if(Object.keys(payload).some(key=>!allowed.includes(key)))throw new Error('Unknown Nethra setting');
      if(('persistentStartup' in payload||'warmOnStartup' in payload)&&source!=='desktop')throw new Error('Change Windows startup on this PC');
      if('advisorReservePercent' in payload&&source!=='desktop')throw new Error('Change advisor usage on this PC');
      if('thinking' in payload&&typeof payload.thinking!=='boolean')throw new Error('Invalid thinking preference');
      if(payload.thinking===false)throw new Error('Qwen3 30B always uses thinking');
      if('verbose' in payload&&typeof payload.verbose!=='boolean')throw new Error('Invalid verbose preference');
      if('persistentStartup' in payload&&typeof payload.persistentStartup!=='boolean')throw new Error('Invalid startup preference');
      if(Object.hasOwn(payload,'taskAgentsEnabled')){
        if(Object.keys(payload).length!==1)throw new Error('Change the full task agent setting separately');
        return {settings:s.setSettings({taskAgentsEnabled:payload.taskAgentsEnabled})};
      }
      const before=s.settings();
      const {projectNotification,...patch}=payload;
      if(Object.hasOwn(payload,'projectNotification')){
        if(source!=='desktop')throw new Error('Change project notification preferences on Windows');
        const {id,mode}=projectNotification||{};
        if(typeof id!=='string'||!['INHERIT','IMPORTANT','OFF'].includes(mode)||!this.listProjects().some(project=>project.id===id))throw new Error('Invalid project notification preference');
        const rules={...before.projectNotifications,[id]:mode};
        if(mode==='INHERIT')delete rules[id];
        patch.projectNotifications=rules;
      }
      const settings=s.setSettings(patch);
      try{await this.onSettings(settings,patch);}catch(error){s.setSettings(before,{restore:true});throw error;}
      return {settings};
      } finally { release(); }
    }
    // A status check from an opening client loads the model while the owner types. Newer
    // clients send warm:false for diagnostics (phone STATUS checks) and call nethra.warm.
    const runningModel=this.activeModel();
    if(payload.warm!==false&&(!runningModel||runningModel==='qwen3:30b'))this.runtime.prewarm?.('qwen3:30b',{reason:`${source}:status`,priority:'background'});
    let model={known:false,thinking:false};try{model=await this.runtime.modelCapabilities('qwen3:30b',AbortSignal.timeout(3000));}catch{}
    return {deletionCleanup:s.pendingDeletions?.().map(({id,cleanup})=>({id,cleanup}))||[],agent:'Nethra',model:'qwen3:30b',modelState:this.modelState(),presence:this.presence?.()||null,capabilities:model,thinkingRequired:true,settings:{...s.settings(),thinking:true},host:'Windows',schedulerRunning:Boolean(this.scheduler?.timer),activeObjectives:s.list().filter(t=>['PLANNING','ACTIVE'].includes(t.status)).length,sources:{calendar:this.calendar?.status()||{status:'DISCONNECTED'},gmail:this.gmail?.status()||{status:'DISCONNECTED'}}};
  }
}
module.exports={NethraApi,NETHRA_TYPES:TYPES};
