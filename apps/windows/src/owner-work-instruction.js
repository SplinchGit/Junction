'use strict';
const {handleNethraChat}=require('./nethra-chat');
const {handleTaskTurn}=require('./nethra-task-turn');

async function handleOwnerWorkInstruction({content,conversationId,requestId,source='desktop',api,store,ownerWork}){
  const commandReply=await handleNethraChat({api,content,conversationId,requestId,source});
  if(commandReply)return commandReply;
  const taskReply=handleTaskTurn({store,conversationId,content,requestId});
  if(taskReply)return taskReply;
  const result=await ownerWork({content,conversationId,requestId,source});
  return result?.response||null;
}

module.exports={handleOwnerWorkInstruction};
