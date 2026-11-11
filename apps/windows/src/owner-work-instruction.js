'use strict';
const {handleNethraChat}=require('./nethra-chat');
const {handleTaskTurn}=require('./nethra-task-turn');
const {handleTaskFollowup}=require('./nethra-conversation');

async function handleOwnerWorkInstruction({content,conversationId,requestId,history=[],source='desktop',api,store,ownerWork}){
  const commandReply=await handleNethraChat({api,content,conversationId,requestId,source});
  if(commandReply)return commandReply;
  const followup=await handleTaskFollowup({api,store,content,conversationId,history,requestId,source});
  if(followup)return followup;
  const taskReply=handleTaskTurn({store,conversationId,content,requestId});
  if(taskReply)return taskReply;
  const result=await ownerWork({content,conversationId,requestId,source});
  return result?.response||null;
}

module.exports={handleOwnerWorkInstruction};
