'use strict';
const {handleNethraChat}=require('./nethra-chat');
const {handleTaskTurn}=require('./nethra-task-turn');
const {handleTaskFollowup}=require('./nethra-conversation');
const {ownerBrief,coordinationContinue,workControl,draftStartMessage}=require('./nethra-coordination');

async function handleOwnerWorkInstruction({content,conversationId,requestId,history=[],source='desktop',selectedLocalModel=null,api,store,findWork,ownerWork}){
  const text=String(content||'').trim();
  if(conversationId&&findWork&&workControl.test(text)){
    const start=/^(?:please\s+)?start\b/i.test(text);
    const linked=store.list().filter(task=>task.conversationId===conversationId&&!['COMPLETED','CANCELLED','FAILED'].includes(task.status));
    const task=linked.length===1?linked[0]:null;
    const state=task?.coordinateSelfImprovement?task.coordination:null;
    if(state?.workId){
      const work=findWork(state.workId);
      if(work?.sourceObjectiveId===task.id){
        if(task.status==='PAUSED'&&start)return 'Resume the Self Improvement task in Tasks before starting its draft in Work Activity.';
        if(task.status!=='PAUSED'){
          if(ownerBrief(task)!==(state.brief||'')){
            if(coordinationContinue.test(text)&&state.stage==='scope_changed'&&['STOPPED','COMPLETED'].includes(work.status)){
              return handleTaskTurn({store,conversationId,content,requestId});
            }
            return ['STOPPED','COMPLETED'].includes(work.status)
              ?'Reply “continue coordination” to consult on your new direction.'
              :'Your brief changed. In Work Activity, stop the previous draft or work, then reply “continue coordination”.';
          }
          if(work.status==='DRAFT')return draftStartMessage(work);
          if(start||coordinationContinue.test(text))return `Work Activity is ${work.status.toLowerCase().replaceAll('_',' ')}. ${work.nextAction||''}`.trim();
        }
      }
    }
  }
  const commandReply=await handleNethraChat({api,content,conversationId,requestId,source,selectedLocalModel});
  if(commandReply)return commandReply;
  const followup=await handleTaskFollowup({api,store,content,conversationId,history,requestId,source});
  if(followup)return followup;
  const taskReply=handleTaskTurn({store,conversationId,content,requestId});
  if(taskReply)return taskReply;
  const result=await ownerWork({content,conversationId,requestId,source});
  return result?.response||null;
}

module.exports={handleOwnerWorkInstruction};
