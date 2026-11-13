'use strict';
const {createHash}=require('node:crypto');
const {ownerQuestion}=require('./nethra-task-contract');
const {wakeReason}=require('./nethra-scheduler');
const HALF_HOUR=30*60_000;
const PROVIDERS=['codex','claude'];
const BRIEF='Nethra is a persistent local companion with Tasks, Android pairing, voice, notifications, project context and Foreman. Nethra schedules; Codex and Claude engineer on shared main. Independently propose one small improvement. Return exactly three plain lines: Friction: one sentence; Improvement: one sentence under 240 characters; Test: measurable acceptance in 30–400 characters. Advice only, no implementation claims.';

const selfImprovementTask=task=>/^self[ -]improvement[.!]?$/i.test(String(task.goal||'').trim())&&!task.parentId;
const summarizeAdvice=advice=>String(advice||'').replace(/\s+/g,' ').trim().slice(0,320);
const coordinationContinue=/^continue co[- ]?ordination[.!]*$/i;
const dualProviderStart=/^(?:please\s+)?start (?:the (?:approved )?pilot )?with codex and claude[.!]*$/i;
const workControl=/^(?:please\s+)?(?:start|start scoped work|start with codex and claude|continue(?: co[- ]?ordination)?|resume|keep going|carry on)[.!]*$/i;
const emptyDirection=/^(?:here|there|this|that|it|this chat|this conversation)[.!?]*$/i;
const draftStartMessage=work=>work?.sharedCheckout
  ?'Draft saved. Reply “Start with Codex and Claude” in this task chat to authorize engineering and handoffs.'
  :'Draft saved. Start it in Work Activity to authorize engineering.';
function pilotChoice(text){
  const value=String(text||'').trim();
  const match=/^(?:please\s+)?(?:approve|aprove)\s+(?:the\s+)?(?:(codex|claude)(?:'s)?\s+)?pilot(?:,?\s+please)?(?:[.!]+\s*|$)([\s\S]*)$/i.exec(value);
  if(!match)return null;
  const trailing=match[2].split(/[.!]+/).map(part=>part.trim()).filter(Boolean);
  if(trailing.some(part=>!(/^(?:thanks|thank you)(?:,?\s+nethra)?$/i.test(part)||/^generally\s+(?:we['’]ll|we will|i)\s+prefer\s+(?:codex|claude)['’]s\s+work$/i.test(part))))return null;
  return match[1]?.toLowerCase()||'shared';
}
// A standing approval is the owner's one-time, bounded permission for Nethra to pick and start
// agreed pilots without a typed reply each time. It is read from the owner's own chat message,
// expires, caps pilots per day, and requires the owner to attest that paid credits are off.
const STANDING_DAY=86_400_000,STANDING_MAX_PER_DAY=5,STANDING_MAX_DAYS=14;
const standingRevoke=/^(?:please\s+)?(?:revoke|cancel|end|stop) standing approval[.!]*$/i;
const standingLike=/^standing approval\b/i;
const collaboratorNote=/^(?:Claude|Codex|GPT)(?: \([^)\n]{1,60}\))? note:/i;
/** {perDay,days} for a valid grant, {error} for a malformed one, null when the text is not a grant. */
function parseStandingApproval(text){
  const value=String(text||'').trim();
  if(!standingLike.test(value))return null;
  if(!/\bcredits off\b/i.test(value))return {error:'A standing approval must say “credits off” so I know no paid usage is authorised.'};
  const perDay=/\b(\d{1,2})\s+pilots?\s+(?:a|per)\s+day\b/i.exec(value),days=/\b(?:for\s+)?(\d{1,2})\s+days?\b/i.exec(value);
  const parsed={perDay:perDay?Number(perDay[1]):3,days:days?Number(days[1]):7};
  if(!(parsed.perDay>=1&&parsed.perDay<=STANDING_MAX_PER_DAY))return {error:`A standing approval allows 1 to ${STANDING_MAX_PER_DAY} pilots a day.`};
  if(!(parsed.days>=1&&parsed.days<=STANDING_MAX_DAYS))return {error:`A standing approval lasts 1 to ${STANDING_MAX_DAYS} days.`};
  return parsed;
}
const isStandingControl=text=>standingRevoke.test(String(text||'').trim())||standingLike.test(String(text||'').trim());
/** The owner's current grant: the latest valid grant that is neither revoked nor expired. */
function standingGrant(task,now=Date.now()){
  let grant=null;
  for(const input of task.ownerInputs||[]){
    const text=String(input.text||'').trim();
    if(standingRevoke.test(text)){grant=null;continue;}
    const parsed=parseStandingApproval(text);
    if(parsed&&!parsed.error&&Number.isFinite(input.at))grant={...parsed,grantedAt:input.at,expiresAt:input.at+parsed.days*STANDING_DAY};
  }
  return grant&&grant.expiresAt>now?grant:null;
}
function ownerBrief(task){
  const answered=new Set((task.questions||[]).map(question=>question.answerRequestId).filter(Boolean));
  for(const input of [...(task.ownerInputs||[])].reverse()){
    const text=String(input.text||'').trim();
    if(/^GPT brief:/i.test(text))return text.replace(/^GPT brief:\s*/i,'').slice(0,700);
    // An engineer's signed note in the owner's chat is discussion; only the owner's own words set direction.
    if(isStandingControl(text)||collaboratorNote.test(text))continue;
    if(input.kind==='answer'||answered.has(input.requestId)||pilotChoice(text)||workControl.test(text)||/^retry consultation[.!]?$/i.test(text)||(input.kind==='redirect'&&emptyDirection.test(text)))continue;
    if(text)return text.slice(0,700);
  }
  return '';
}
function allowsCoordinationWork(task,project){
  if(!task.coordination)return true;
  return task.coordinateSelfImprovement&&task.allowCodeWork&&!task.privateProjectWork&&!['PAUSED','CANCELLED','FAILED','COMPLETED'].includes(task.status)&&
    (project.coordinationBrief===undefined||ownerBrief(task)===project.coordinationBrief);
}
function proposal(advice){
  const fields={};
  const normalized=String(advice||'').replace(/\*\*(Friction|Improvement|Test):\*\*/g,'$1:');
  for(const match of normalized.matchAll(/(?:^|\s)(Friction|Improvement|Test):\s*([\s\S]*?)(?=\s+(?:Friction|Improvement|Test):|$)/g))fields[match[1]]=match[2].trim();
  if(!fields.Improvement||!fields.Test||fields.Improvement.length>240||fields.Test.length<30||fields.Test.length>400)return null;
  return {task:fields.Improvement,acceptance:fields.Test};
}
function decision(state){
  const proposals=Object.fromEntries(PROVIDERS.map(p=>[p,proposal(state.advisors[p]?.advice)]));
  const same=proposals.codex&&JSON.stringify(proposals.codex)===JSON.stringify(proposals.claude);
  const comparison=same?'Both advisors proposed the same pilot. This is advice, not verified evidence.': 'The advisors returned different proposals. Choose which scope to pursue; no consensus is assumed.';
  const choice=same?'Reply “approve pilot”.':PROVIDERS.filter(p=>proposals[p]).map(p=>`Reply “approve ${p} pilot” to choose ${p}.`).join(' ');
  return {proposals,question:`${comparison}\n${choice||'No complete proposal was returned.'} Reply “retry consultation” to repair incomplete advice, or “GPT brief: …” to change direction. Full advice is in Windows task diagnostics.\n${PROVIDERS.map(p=>`${p==='codex'?'Codex':'Claude'}: ${proposals[p]?`${proposals[p].task.slice(0,130)} Test: ${proposals[p].acceptance.slice(0,130)}`:'Advice needs a bounded Improvement and Test before approval.'}`).join('\n')}`};
}

/** Provider whose proposal a standing approval may pick unattended; null when the owner must choose (disagreement or nothing usable). */
function autoPilotProvider(state){
  const proposals=Object.fromEntries(PROVIDERS.map(p=>[p,state.advisors?.[p]?.status==='completed'?proposal(state.advisors[p].advice):null]));
  const usable=PROVIDERS.filter(p=>proposals[p]);
  if(usable.length===1)return usable[0];
  if(usable.length===2&&JSON.stringify(proposals.codex)===JSON.stringify(proposals.claude))return 'codex';
  return null;
}

async function runCoordination(task,{tools,store,checkpoint,signal,token,startWork=null,now=Date.now}){
  let current=task;
  let state={stage:'consulting',advisors:{},...task.coordination};
  // Counters survive every rebuild of the stage record, so a new brief cannot reset the daily cap.
  const carry=()=>({brief:state.brief,completedWork:state.completedWork,autoApprovals:state.autoApprovals});
  const grant=standingGrant(task,now());
  const recent=()=>(state.autoApprovals||[]).filter(at=>at>now()-STANDING_DAY);
  const standing=()=>Boolean(grant&&recent().length<grant.perDay);
  const save=async(patch,event)=>{
    signal?.throwIfAborted();
    const saved=await (checkpoint?checkpoint(patch,event):store.update(task.id,patch,event,token));
    if(!saved)throw Error('Objective lease was lost');
    current=store.get(task.id);
    return patch;
  };
  const persist=(patch,event)=>save({coordination:state,...patch},event);
  const sleep=(at,summary)=>persist({status:'SLEEPING',nextWakeAt:at,wakeReason:wakeReason('SCHEDULED',summary,at),summary},'COORDINATION_WAIT');
  const ask=async(question,stage)=>{
    const record=ownerQuestion(current,{...current,questions:(current.questions||[]).filter(q=>q.status!=='SUPERSEDED')},{question,reason:'OWNER_PREFERENCE',blocking:true},now());
    state={...state,stage,questionId:record.question.id};
    return persist({status:'WAITING_FOR_USER',nextWakeAt:null,questions:record.questions,summary:question},'COORDINATION_DECISION');
  };
  const answer=()=>current.questions?.find(q=>q.id===state.questionId&&q.status==='ANSWERED')?.answer;

  // Preserve the same bounded owner brief for both independent consultations.
  // A changed brief invalidates advice and approval, never a running engineering scope.
  const brief=ownerBrief(current);
  if(state.stage==='tracking'&&brief!==(state.brief||''))return ask('Your direction changed. Review and stop or revise the existing work in Work Activity before approving a replacement. Reply “continue coordination” after stopping the old work.','scope_changed');
  if(state.stage==='scope_changed'&&brief===(state.brief||'')){
    const questions=(current.questions||[]).map(question=>question.id===state.questionId&&question.status==='OPEN'?{...question,status:'SUPERSEDED'}:question);
    state={...state,stage:'tracking',questionId:null};
    await persist({questions},'COORDINATION_SCOPE_RESTORED');
  }
  if(state.stage==='scope_changed'){
    const work=tools.workStatus?.(state.workId);
    if(!coordinationContinue.test(answer()?.trim()||'')||!work||!['STOPPED','COMPLETED'].includes(work.status))return ask('In Work Activity, stop the previous draft or work. Then reply “continue coordination” to consult on your new direction.','scope_changed');
    state={stage:'consulting',advisors:{},...carry(),brief};
    await persist({summary:'Consulting on the revised direction.'},'COORDINATION_SCOPE_CHANGED');
  }
  if(state.stage!=='tracking'&&(state.brief===undefined||brief!==state.brief)){
    state=brief===(state.brief||'')?{...state,brief}:{stage:'consulting',advisors:{},...carry(),brief};
    await persist({summary:'Saved the consultation brief.'},'COORDINATION_BRIEF_SAVED');
  }

  if(!task.allowCodeWork||task.privateProjectWork){
    return sleep(now()+HALF_HOUR,task.privateProjectWork?'Coordination needs a task approved for external advisors.':'Enable Codex and Claude development work in the Windows task settings.');
  }
  if(state.stage==='revision_needed'){
    return ask(`The approved pilot needs a clearer scope or test before I can save a draft. ${state.draftReview} Reply “GPT brief: …” with the change you want reviewed.`, 'revision_needed');
  }
  if(state.stage==='interrupted'){
    if(!/^retry consultation[.!]?$/i.test(answer()?.trim()||''))return ask('An advisor request was interrupted before its result was saved. Reply “retry consultation” to try that advisor again.', 'interrupted');
    const advisors={...state.advisors};delete advisors[state.interruptedProvider];
    state={...state,stage:'consulting',advisors,questionId:null,interruptedProvider:null};
    await persist({summary:'Resuming the interrupted consultation.'},'COORDINATION_RESUMED');
  }
  if(state.stage==='consulting'){
    for(const provider of PROVIDERS){
      const prior=state.advisors[provider];
      if(prior?.status==='completed'||prior?.retryAt>now())continue;
      if(prior?.status==='requested'){
        state={...state,interruptedProvider:provider};
        return ask(`The ${provider} request was interrupted before a result was saved. Reply “retry consultation” to try it again.`,'interrupted');
      }
      state={...state,advisors:{...state.advisors,[provider]:{status:'requested',at:now()}}};
      await persist({summary:`Consulting ${provider==='codex'?'Codex':'Claude'}.`},'COORDINATION_CONSULTING');
      let receipt;
      try{
        const result=await tools.execute(`consult_${provider}`,{question:`${BRIEF}${state.brief?`\nOwner brief: ${state.brief}`:''}${state.completedWork?.length?`\nCompleted work receipts: ${JSON.stringify(state.completedWork.slice(-5))}. Propose the next unfinished improvement and avoid repeating completed work.`:''}`},current,{signal,token});
        if(!result?.advice?.trim())throw Error('Advisor returned no usable advice');
        receipt={status:'completed',advice:result.advice.slice(0,2800),model:result.model,at:now()};
      }catch(error){
        signal?.throwIfAborted();
        receipt={status:'waiting',reason:String(error.message).slice(0,300),retryAt:Number.isFinite(error.retryAt)?Math.max(now()+1000,error.retryAt+60_000):now()+HALF_HOUR};
      }
      state={...state,advisors:{...state.advisors,[provider]:receipt}};
      await persist({summary:receipt.status==='completed'?`Saved advice from ${provider}.`:`Waiting for ${provider}: ${receipt.reason}`},'COORDINATION_ADVISOR_RESULT');
    }
    const waiting=PROVIDERS.filter(provider=>state.advisors[provider]?.status!=='completed');
    // A resting provider does not hold up a standing approval while the other has a bounded proposal;
    // the independent review still happens before any draft is saved or started.
    const onlyWaiting=waiting.length&&standing()&&autoPilotProvider(state);
    if(waiting.length&&!onlyWaiting)return sleep(Math.min(...waiting.map(provider=>state.advisors[provider]?.retryAt||now()+HALF_HOUR)),`Waiting for ${waiting.join(' and ')} consultation.`);
    state={...state,stage:'decision',questionId:null};
    await persist({summary:'Advisor proposals saved.'},'COORDINATION_PROPOSALS_READY');
  }
  const ownerDecided=pilotChoice(answer())||/^retry consultation[.!]?$/i.test(answer()?.trim()||'');
  if(state.stage==='decision'&&!ownerDecided&&standing()&&autoPilotProvider(state)){
    // Supersede the open question: the owner pre-authorised this bounded choice.
    const provider=autoPilotProvider(state),questions=(current.questions||[]).map(q=>q.id===state.questionId&&q.status==='OPEN'?{...q,status:'SUPERSEDED'}:q);
    state={...state,stage:'drafting',selected:proposal(state.advisors[provider].advice),approvedAt:now(),approvedBy:'standing',autoApprovals:[...recent(),now()]};
    await persist({questions,summary:`Standing approval used for ${provider}’s pilot (${state.autoApprovals.length} of ${grant.perDay} today). Preparing the reviewed draft.`},'COORDINATION_PILOT_AUTO_APPROVED');
  }
  if(state.stage==='decision'&&!state.questionId){
    return ask(decision(state).question,'decision');
  }
  if(state.stage==='decision'){
    if(/^retry consultation[.!]?$/i.test(answer()?.trim()||'')){
      const advisors=Object.fromEntries(Object.entries(state.advisors).filter(([,receipt])=>proposal(receipt.advice)));
      state={...state,stage:'consulting',advisors,questionId:null};
      return persist({status:'SLEEPING',nextWakeAt:now()+1000,summary:'Retrying only incomplete advisor proposals.'},'COORDINATION_RETRY');
    }
    const {proposals,question}=decision(state),choice=pilotChoice(answer());
    const provider=choice==='shared'?(JSON.stringify(proposals.codex)===JSON.stringify(proposals.claude)?'codex':null):choice;
    const selected=provider&&proposals[provider];
    if(!selected)return ask(`I kept the saved proposals. I need a clear pilot choice before drafting.\n${question}`,'decision');
    state={...state,stage:'drafting',selected,approvedAt:now()};
    await persist({summary:'Pilot approved. Preparing the reviewed Work Activity draft.'},'COORDINATION_PILOT_APPROVED');
  }
  if(state.stage==='drafting'){
    let result;
    if(!state.selected)return ask(decision(state).question,'decision');
    try{result=await tools.execute('propose_code_work',state.selected,current,{signal,token});}
    catch(error){
      signal?.throwIfAborted();
      const at=Number.isFinite(error.retryAt)?Math.max(now()+1000,error.retryAt+60_000):now()+HALF_HOUR;
      return sleep(at,`Draft pending: ${String(error.message).slice(0,200)}`);
    }
    if(!result.workId){
      state={...state,draftReview:summarizeAdvice(result.review)};
      return ask(`The approved pilot needs a clearer scope or test before I can save a draft. ${state.draftReview} Reply “GPT brief: …” with the change you want reviewed.`, 'revision_needed');
    }
    state={...state,stage:'tracking',workId:result.workId};
    await persist({summary:draftStartMessage(tools.workStatus?.(result.workId))},'COORDINATION_DRAFT_READY');
  }
  const work=tools.workStatus?.(state.workId);
  if(!work)return sleep(now()+HALF_HOUR,'Work Activity record unavailable. Check the linked draft.');
  // Start only a draft this same standing approval chose, under the checks the owner's typed Start applies.
  if(work.status==='DRAFT'&&grant&&startWork&&state.approvedBy==='standing'&&work.sharedCheckout&&work.codeReviewVerdict==='READY'&&
     work.sourceObjectiveId===task.id&&work.conversationId===task.conversationId&&work.coordinationBrief===state.brief&&!store.approvals?.(task.id).some(item=>item.status==='PENDING')){
    const actionId=createHash('sha256').update(JSON.stringify(['standing-start',task.id,state.workId])).digest('hex');
    try{
      store.bindTaskReference?.(`work-start-${actionId}`,state.workId,task.conversationId,()=>task.id);
      const started=await startWork(state.workId,actionId);
      return sleep(now()+60_000,`Standing approval started Codex and Claude on the reviewed pilot (${String(started?.status||'RUNNING').toLowerCase().replaceAll('_',' ')}).`);
    }catch(error){
      signal?.throwIfAborted();
      return ask(`Foreman could not start the reviewed pilot automatically: ${String(error.message).slice(0,200)} Reply “Start with Codex and Claude” when ready.`,'tracking');
    }
  }
  if(work.status==='BLOCKED')return ask(`Engineering is blocked: ${work.blocker||work.nextAction||'The last attempt failed.'} The saved work needs repair before it can continue.`, 'tracking');
  if(work.status==='COMPLETED'){
    const completedWork=[...(state.completedWork||[]).filter(item=>item.id!==state.workId),{id:state.workId,at:now(),summary:work.nextAction}].slice(-50);
    state={stage:'consulting',advisors:{},...carry(),completedWork};
    return persist({status:'SLEEPING',nextWakeAt:now()+1000,summary:`${work.nextAction||'Engineering completed.'} Preparing the next bounded improvement.`},'COORDINATION_WORK_COMPLETED');
  }
  return sleep(Number.isFinite(work.retryAt)&&work.retryAt>now()?work.retryAt:now()+HALF_HOUR,
    work.status==='DRAFT'?draftStartMessage(work):work.nextAction||`Work Activity: ${work.status}.`);
}
module.exports={parseStandingApproval,standingGrant,runCoordination,selfImprovementTask,ownerBrief,allowsCoordinationWork,pilotChoice,coordinationContinue,dualProviderStart,workControl,emptyDirection,draftStartMessage};
