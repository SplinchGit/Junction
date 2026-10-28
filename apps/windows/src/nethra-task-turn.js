'use strict';
const {randomUUID}=require('node:crypto');

const FINISHED=new Set(['COMPLETED','CANCELLED','FAILED']);

function handleTaskTurn({store,conversationId,content,requestId=randomUUID()}){
  if(!conversationId||!store)return null;
  const linked=store.list().find(task=>task.conversationId===conversationId&&!FINISHED.has(task.status));
  if(!linked)return null;
  const {task,kind,pendingApproval}=store.chatTurn(linked.id,String(content||'').trim().slice(0,4000),String(requestId));
  const goal=`“${String(task.goal).slice(0,100)}”`;
  if(kind==='answer')return `Thanks. I saved your answer for ${goal} and am continuing the task.`;
  if(pendingApproval)return `I saved your message for ${goal}. The task still needs your approval in Tasks; this message did not approve the action.`;
  if(task.status==='PAUSED')return `I saved your message for ${goal}. The task remains paused until you resume it.`;
  if(task.status==='BLOCKED')return `I saved your message for ${goal}. The task remains blocked; open Tasks to redirect or unblock it.`;
  if(task.status==='SLEEPING')return `I saved your message for ${goal} and brought its next check forward.`;
  return `I saved your message for ${goal}. Nethra will use it at the next task step.`;
}

module.exports={handleTaskTurn};
