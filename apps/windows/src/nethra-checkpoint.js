'use strict';

const short=(value,max)=>String(value||'').slice(0,max);

/** Host facts for the next wake. Advice stays labelled as advice, never as an applied change. */
function checkpointAfterTool(previous,{name,args,result,at=Date.now()}){
  const checkpoint={...(previous||{})};
  if(name==='propose_code_work'&&result&&typeof result==='object'){
    checkpoint.activeHypothesis=short(args.task,1000);
    if(result.status==='REVISE')checkpoint.lastReview={verdict:'REVISE',proposal:short(args.task,1000),acceptance:short(args.acceptance,1000),feedback:short(result.review,2800),reviewedBy:short(result.reviewedBy,80),at,codeChanged:false};
    if(result.workId){checkpoint.codeWorkDraft={workId:short(result.workId,64),status:short(result.status,24),at,codeChanged:false};delete checkpoint.lastReview;}
  }
  if(name==='experiment'&&result&&typeof result==='object'&&!Array.isArray(result)&&result.id){
    checkpoint.lastExperiment={id:short(result.id,64),status:short(result.status,32),metric:short(result.metric,80),hypothesis:short(result.hypothesis,500),verdict:short(result.result?.verdict,40),at};
    if(result.hypothesis)checkpoint.activeHypothesis=short(result.hypothesis,500);
  }
  return checkpoint;
}

/** Optional orientation is shed before the newest owner input or working checkpoint. */
function seedForWake(value,maxChars=9000){
  const seed=structuredClone(value),size=()=>JSON.stringify(seed).length;
  for(const key of ['evidence','actionsSoFar','recentCommits']){
    while(size()>maxChars&&Array.isArray(seed[key])&&seed[key].length)key==='recentCommits'?seed[key].pop():seed[key].shift();
  }
  if(size()>maxChars)delete seed.repositoryGuide;
  while(size()>maxChars&&Array.isArray(seed.ownerInputs)&&seed.ownerInputs.length>1)seed.ownerInputs.shift();
  if(size()>maxChars)delete seed.hostFacts;
  const text=JSON.stringify(seed);
  if(text.length>maxChars)throw new Error(`Protected objective seed is ${text.length} characters, above its ${maxChars}-character limit`);
  return text;
}

module.exports={checkpointAfterTool,seedForWake};
