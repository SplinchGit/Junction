'use strict';

/** The journal event is the durable outbox; the message ID makes crash retries safe. */
function postMilestones(task,store,localData){
  if(task.mode!=='ONGOING'||!task.conversationId||!localData.conversation(task.conversationId))return 0;
  let posted=0;
  for(const event of store.milestoneEvents(task.id,localData.milestoneCursor(task.id))){
    const summary=String(event.detail?.summary||'').trim().slice(0,1200);
    if(!summary){localData.markMilestoneDelivered(task.id,event.seq);continue;}
    const messageId=`nethra-milestone-${event.seq}`;
    const text=`Update on "${String(task.goal||'').slice(0,160)}": ${summary}\n\nI’ll keep monitoring. The next check is saved in Tasks.`;
    if(localData.addMessageOnce(task.conversationId,messageId,'assistant',text,'JUNCTION').created)posted++;
    localData.markMilestoneDelivered(task.id,event.seq);
  }
  return posted;
}

module.exports={postMilestones};
