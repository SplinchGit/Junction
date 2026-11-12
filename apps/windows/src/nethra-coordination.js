'use strict';
const {ownerQuestion}=require('./nethra-task-contract');
const {wakeReason}=require('./nethra-scheduler');
const HALF_HOUR=30*60_000;
const PROVIDERS=['codex','claude'];
const BRIEF='Nethra is a persistent local companion with Tasks, Android pairing, voice, notifications, project context and Foreman. Nethra schedules; Codex and Claude engineer on shared main. Independently propose one small improvement. Return exactly three plain lines: Friction: one sentence; Improvement: one sentence under 240 characters; Test: measurable acceptance in 30–400 characters. Advice only, no implementation claims.';

const selfImprovementTask=task=>/^self[ -]improvement[.!]?$/i.test(String(task.goal||'').trim())&&!task.parentId;
const summarizeAdvice=advice=>String(advice||'').replace(/\s+/g,' ').trim().slice(0,320);
const ownerBrief=task=>[...(task.ownerInputs||[])].reverse().find(i=>!/^\s*(?:approve (?:(?:codex|claude) )?pilot|retry consultation|continue coordination)[.!]?\s*$/i.test(i.text||''))?.text.replace(/^\s*GPT brief:\s*/i,'').trim().slice(0,700)||'';
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

async function runCoordination(task,{tools,store,checkpoint,signal,token,now=Date.now}){
  let current=task;
  let state={stage:'consulting',advisors:{},...task.coordination};
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
  if(state.stage==='scope_changed'){
    const work=tools.workStatus?.(state.workId);
    if(!/^continue coordination[.!]?$/i.test(answer()?.trim()||'')||!work||!['STOPPED','COMPLETED'].includes(work.status))return ask('Stop the old scope in Work Activity, then reply “continue coordination” to consult on your new direction.','scope_changed');
    state={stage:'consulting',advisors:{},brief};
    await persist({summary:'Consulting on the revised direction.'},'COORDINATION_SCOPE_CHANGED');
  }
  if(state.stage!=='tracking'&&(state.brief===undefined||brief!==state.brief)){
    state=brief===(state.brief||'')?{...state,brief}:{stage:'consulting',advisors:{},brief};
    await persist({summary:'Saved the consultation brief.'},'COORDINATION_BRIEF_SAVED');
  }

  if(!task.allowCodeWork||task.privateProjectWork){
    return sleep(now()+HALF_HOUR,task.privateProjectWork?'Coordination needs a task approved for external advisors.':'Enable Codex and Claude development work in the Windows task settings.');
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
        const result=await tools.execute(`consult_${provider}`,{question:`${BRIEF}${state.brief?`\nOwner brief: ${state.brief}`:''}`},current,{signal,token});
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
    if(waiting.length)return sleep(Math.min(...waiting.map(provider=>state.advisors[provider]?.retryAt||now()+HALF_HOUR)),`Waiting for ${waiting.join(' and ')} consultation.`);
    return ask(decision(state).question,'decision');
  }
  if(state.stage==='decision'){
    if(/^retry consultation[.!]?$/i.test(answer()?.trim()||'')){
      const advisors=Object.fromEntries(Object.entries(state.advisors).filter(([,receipt])=>proposal(receipt.advice)));
      state={...state,stage:'consulting',advisors,questionId:null};
      return persist({status:'SLEEPING',nextWakeAt:now()+1000,summary:'Retrying only incomplete advisor proposals.'},'COORDINATION_RETRY');
    }
    const {proposals,question}=decision(state),choice=/^approve (?:(codex|claude) )?pilot[.!]?$/i.exec(answer()?.trim()||'');
    const provider=choice?.[1]?.toLowerCase()||(!choice?.[1]&&choice&&JSON.stringify(proposals.codex)===JSON.stringify(proposals.claude)?'codex':null);
    const selected=provider&&proposals[provider];
    if(!selected)return ask(question,'decision');
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
      return ask(`The draft needs revision. No implementation started. ${state.draftReview}\n${decision(state).question}`,'decision');
    }
    state={...state,stage:'tracking',workId:result.workId};
    await persist({summary:'Draft saved. Start it in Work Activity to authorize engineering.'},'COORDINATION_DRAFT_READY');
  }
  const work=tools.workStatus?.(state.workId);
  if(!work)return sleep(now()+HALF_HOUR,'Work Activity record unavailable. Check the linked draft.');
  return sleep(Number.isFinite(work.retryAt)&&work.retryAt>now()?work.retryAt:now()+HALF_HOUR,
    work.status==='DRAFT'?'Draft saved. Start it in Work Activity to authorize engineering.':work.nextAction||`Work Activity: ${work.status}.`);
}
module.exports={runCoordination,selfImprovementTask,ownerBrief,allowsCoordinationWork};
