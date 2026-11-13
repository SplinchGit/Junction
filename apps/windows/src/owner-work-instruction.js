'use strict';
const {handleNethraChat}=require('./nethra-chat');
const {handleTaskTurn}=require('./nethra-task-turn');
const {handleTaskFollowup}=require('./nethra-conversation');
const {createHash}=require('node:crypto');
const {engineerOwnsCheckout}=require('./foreman');
const {ownerBrief,coordinationContinue,dualProviderStart,workControl,draftStartMessage}=require('./nethra-coordination');

const statusQuestion=/\b(?:where (?:did we get to|are we (?:at|up to))|what(?:['’]s| is) (?:the (?:latest|status)|blocking (?:this|us))|how(?:['’]s| is) (?:it|the (?:task|project|work)) going)\b/i;

async function handleOwnerWorkInstruction({content,conversationId,requestId,history=[],source='desktop',selectedLocalModel=null,api,store,findWork,startWork,ownerWork}){
  const text=String(content||'').trim();
  if(conversationId&&statusQuestion.test(text)&&!/^GPT brief:/i.test(text)){
    const linked=store.list().filter(task=>task.conversationId===conversationId);
    if(linked.length===1){
      const task=linked[0];
      const work=task.coordination?.workId?findWork?.(task.coordination.workId):null;
      if(work){
        const active=work.tasks?.find(item=>item.id===work.activeTask)||work.tasks?.at(-1);
        const attempt=active?.attempts?.at(-1);
        const title=active?.title?`\n\n${active.title}`:'';
        const failure=attempt?.error||'';
        const detail=work.status==='BLOCKED'&&/sandbox.*denied/i.test(failure)?'The patch reached verification, but the Windows sandbox denied the test command. Verification is still pending.':work.status==='BLOCKED'?(failure||work.handoff||work.nextAction||'').split(/\r?\n/)[0].slice(0,400):work.nextAction||'';
        return `**Nethra**\n\n${task.goal} is ${work.status.toLowerCase().replaceAll('_',' ')}.${title}${detail?`\n\n${detail}`:''}`;
      }
      return `**Nethra**\n\n${task.goal} is ${task.status.toLowerCase().replaceAll('_',' ')}.${task.summary?`\n\n${task.summary.slice(0,500)}`:''}`;
    }
  }
  const authorize=dualProviderStart.test(text);
  const startRequest=/^(?:please\s+)?start (?:the (?:approved )?pilot )?with codex and claude\b/i.test(text);
  if(conversationId&&findWork&&(workControl.test(text)||startRequest)){
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
          if(work.status==='DRAFT'){
            if(engineerOwnsCheckout(work))return draftStartMessage({engineerOwnsCheckout:true});
            if(!authorize||!startWork||!requestId)return draftStartMessage(work);
            if(!work.sharedCheckout||work.codeReviewVerdict!=='READY'||work.conversationId!==conversationId||work.coordinationBrief!==state.brief){
              return 'This draft needs a matching Codex READY review before it can start from this chat.';
            }
            const pending=store.approvals(task.id).some(item=>item.status==='PENDING');
            if(task.status==='BLOCKED'||pending||(task.status==='WAITING_FOR_USER'&&state.stage!=='scope_changed')){
              return 'Resolve the linked task’s pending decision or approval in Tasks before starting engineering.';
            }
            const actionId=createHash('sha256').update(JSON.stringify(['owner-chat-start',source,conversationId,requestId])).digest('hex');
            try{
              store.bindTaskReference(`work-start-${actionId}`,work.id,conversationId,()=>task.id);
              const result=await startWork(work,actionId);
              return `You authorized Codex and Claude for the reviewed pilot. Work Activity is ${result.status.toLowerCase().replaceAll('_',' ')}.`;
            }catch(error){
              return `Foreman could not start the draft. ${error.message}`;
            }
          }
          if(start||coordinationContinue.test(text))return `Work Activity is ${work.status.toLowerCase().replaceAll('_',' ')}. ${work.nextAction||''}`.trim();
        }
      }
    }
    if(authorize)return 'Open the task chat linked to the reviewed pilot, then send “Start with Codex and Claude”.';
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
