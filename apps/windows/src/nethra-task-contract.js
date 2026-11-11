'use strict';
const {createHash}=require('node:crypto');
const {DEFAULT_MODEL,profileFor}=require('./nethra-models');
const {CONTEXT_TOKENS}=require('./model-context');

const QUESTION_REASONS=Object.freeze(['PROGRESS','OWNER_PREFERENCE','CLARIFICATION','ACCESS','AUTHORIZATION']);
const openQuestions=state=>(state.questions||[]).filter(item=>item.status==='OPEN');
function questionForAnswer(task,{questionId=null,conversationId=null}={}){
  const questions=openQuestions(task);
  if(questionId!==null){
    if(typeof questionId!=='string'||!questionId||questionId.length>160)throw Error('Invalid owner question ID');
    const question=questions.find(item=>item.id===questionId);
    if(!question)throw Error('That question is not open on this task');
    return question;
  }
  const matching=conversationId?questions.filter(item=>(item.conversationId||task.conversationId)===conversationId):[];
  return (matching.length?matching:questions).at(-1)||null;
}

/** Blocking is scoped to the missing decision, rather than inferred from prose. */
function taskWork(task,state=task){
  const completed=new Set(state.completedSteps||[]);
  const pending=(state.plan||task.plan||[]).filter(step=>!completed.has(step));
  const blockers=openQuestions(state).filter(item=>item.blocking);
  const global=blockers.some(item=>!item.step);
  const blockedSteps=pending.map(step=>({step,questionIds:blockers.filter(item=>!item.step||item.step===step).map(item=>item.id)})).filter(item=>item.questionIds.length);
  const blocked=new Set(blockedSteps.map(item=>item.step));
  const executableSteps=pending.filter(step=>!blocked.has(step));
  return {executableSteps,blockedSteps,allBlocked:global||(pending.length>0&&executableSteps.length===0&&blockers.length>0)};
}

function ownerQuestion(task,state,args,at=Date.now()){
  if(!QUESTION_REASONS.includes(args.reason))throw Error('Choose the missing-input reason from the provided reasons');
  if(args.blocking&&args.reason==='PROGRESS')throw Error('A progress check-in cannot block the task');
  const step=args.step?.trim()||null,question=args.question.trim();
  if(!question)throw Error('An owner question must be nonempty');
  if(step&&(!(state.plan||[]).includes(step)||(state.completedSteps||[]).includes(step)))throw Error('A question must name one of the current pending plan steps');
  const id='question-'+createHash('sha256').update(JSON.stringify([task.id,question,args.reason,step,(task.ownerInputs||[]).at(-1)?.requestId||null])).digest('hex').slice(0,24);
  const previous=(state.questions||[]).find(item=>item.id===id);
  if(previous)return {question:previous,questions:state.questions,created:false,work:taskWork(task,state)};
  if(openQuestions(state).length>=8)throw Error('Eight owner questions are already open; use their saved answers or continue an executable step');
  const record={id,question,reason:args.reason,blocking:args.blocking===true,step,status:'OPEN',askedAt:at,conversationId:(task.ownerInputs||[]).at(-1)?.conversationId||task.conversationId||null};
  const questions=[...(state.questions||[]).filter(item=>item.status==='OPEN'),...(state.questions||[]).filter(item=>item.status!=='OPEN').slice(-2),record];
  return {question:record,questions,created:true,work:taskWork(task,{...state,questions})};
}

/** One host-authored contract used by background work, chat and task detail. */
function taskContract(task,{toolNames=[],state=task}={}){
  const id=task.model||DEFAULT_MODEL,profile=profileFor(id),available=new Set(toolNames);
  const questions=(state.questions||[]).filter(item=>item.status==='OPEN'||item.answer).slice(-10).map(item=>({...item,question:String(item.question||'').slice(0,1000),...(item.answer?{answer:String(item.answer).slice(0,1000)}:{})}));
  return {
    version:1,taskId:task.id,
    model:{id,thinking:profile.thinking,thinkingBudget:profile.thinkingBudget,contextTokens:CONTEXT_TOKENS},
    tools:[...available],modelInference:{available:available.has('run_model'),localOnly:true,samplesPerCall:3,maxSamples:50,model:id,note:'Use run_model for independent prompts or measurements; the host queues inference and saves results. No endpoint/credentials are needed. Resume a partial job using jobId.'},scope:{workspace:task.workspace,readRoots:task.readRoots||[],sources:task.sources||[]},
    permissions:{drafts:available.has('write_draft')?'CREATE_OR_VERSION':'UNAVAILABLE',codeWork:available.has('propose_code_work')?'REVIEWED_PROPOSALS_ONLY':'UNAVAILABLE',externalSending:false},
    continuation:{persistent:task.persistent!==false,continuous:task.continuous===true,mode:task.mode||'FINITE'},
    work:taskWork(task,state),questions,
    review:state.contextCheckpoint?.lastReview?{verdict:state.contextCheckpoint.lastReview.verdict,next:'Address the saved technical review. A REVISE verdict is not approval or an applied change.'}:null
  };
}

module.exports={QUESTION_REASONS,openQuestions,questionForAnswer,taskWork,ownerQuestion,taskContract};
