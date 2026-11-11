'use strict';
const {randomUUID,createHash}=require('node:crypto');
const scopedId=(requestId,scope)=>'task-'+createHash('sha256').update(JSON.stringify([requestId,scope])).digest('hex');

/** Shared chat adapter: every route addresses the same durable task record. */
function createObjectiveAccess({api,store}){
  const service=()=>typeof api==='function'?api():api;
  const database=()=>typeof store==='function'?store():store;
  const source=surface=>String(surface||'').startsWith('android')?'android':'desktop';
  const resolve=(reference,conversationId)=>{
    const value=String(reference||'').trim().toLowerCase(),tasks=database().list();
    const active=tasks.filter(task=>!['COMPLETED','CANCELLED','FAILED'].includes(task.status));
    const allLinked=conversationId?tasks.filter(task=>task.conversationId===conversationId):[];
    const activeLinked=allLinked.filter(task=>!['COMPLETED','CANCELLED','FAILED'].includes(task.status));
    const linked=activeLinked.length?activeLinked:allLinked;
    const matches=['current','that task','it'].includes(value)?(linked.length?linked:active):tasks.filter(task=>task.id.toLowerCase().startsWith(value)||task.goal.toLowerCase()===value||value.length>=4&&task.goal.toLowerCase().includes(value));
    if(matches.length!==1)throw Error(matches.length?'Several tasks match; use the ID from list_objectives.':'No saved task matches; use list_objectives first.');
    return matches[0];
  };
  return {
    create:async({goal,successCriteria,mode,conversationId,requestId,surface,model,continuous,projectId})=>{
      let {task}=await service().dispatch('nethra.create',{goal,successCriteria,mode,conversationId,persistent:true,...(model?{model}:{}),continuous:continuous??true},requestId,source(surface),{projectId});
      task=database().get(task.id);
      if(model&&task.model!==model||continuous!==undefined&&task.continuous!==continuous){
        task=database().get(task.id);
        ({task}=await service().dispatch('nethra.configure',{id:task.id,revision:task.revision,...(model?{model}:{}),continuous:continuous??task.continuous},scopedId(requestId,'configure'),source(surface)));
      }
      return task;
    },
    list:async()=>(await service().dispatch('nethra.list',{},randomUUID(),'desktop')).objectives,
    get:async(reference,conversationId)=>{
      const selected=resolve(reference,conversationId);
      const {task,progress,approvals,moreApprovals,contract}=await service().dispatch('nethra.get',{id:selected.id},randomUUID(),'desktop');
      return {id:task.id,goal:task.goal,successCriteria:task.successCriteria,status:task.status,mode:task.mode,model:task.model,plan:task.plan,completedSteps:task.completedSteps,pendingSteps:task.pendingSteps,summary:task.summary,contract,progress:{doing:progress?.doing||null,next:progress?.next||null,waitingFor:progress?.waitingFor||null,lastAccomplished:progress?.lastAccomplished||null,questions:progress?.questions||[]},pendingApprovals:approvals.filter(item=>item.status==='PENDING').map(item=>({tool:item.tool,id:item.id})),moreApprovals,taskChatSaved:Boolean(task.conversationId)};
    },
    message:async({reference,message,conversationId=null,requestId,surface})=>{
      if(typeof requestId!=='string'||!requestId)throw Error('An owner turn ID is required');
      const normalized=String(reference||'').trim().toLowerCase();
      const selectedId=database().bindTaskReference(scopedId(requestId,['reference',normalized,conversationId]),normalized,conversationId,()=>resolve(reference,conversationId).id);
      return service().dispatch('nethra.message',{id:selectedId,text:message,conversationId},scopedId(requestId,selectedId),source(surface));
    }
  };
}

module.exports={createObjectiveAccess};
