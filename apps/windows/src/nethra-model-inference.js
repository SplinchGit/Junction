'use strict';
const {createHash}=require('node:crypto');
const {DEFAULT_MODEL,NEXT_80B_MODEL,NEXT_80B_THINKING_MODEL,NEXT_80B_THINKING_Q4_MODEL,isNextThinkingModel,profileFor}=require('./nethra-models');
const {CONTEXT_TOKENS}=require('./model-context');
const SAMPLES_PER_CALL=3,MAX_SAMPLES=50,MAX_TOKENS=4096;
const round=n=>Math.round(n*1000)/1000;
function inferenceRequirement(task){
  const text=`${task.goal||task.objective||''}. ${task.successCriteria||''}`;
  if(!/\bbenchmark\b|\bmeasure\b.{0,120}\b(?:latency|tokens|wall.clock)\b/i.test(text))return null;
  const match=text.match(/\b(\d+)\s+(?:identical\s+)?(?:prompts?|samples?|runs?)\b/i);
  if(!match||Number(match[1])<1)return null;
  const model=[NEXT_80B_THINKING_Q4_MODEL,NEXT_80B_THINKING_MODEL,NEXT_80B_MODEL,DEFAULT_MODEL].find(id=>text.includes(id))||task.model||DEFAULT_MODEL;
  return {samples:Number(match[1]),model};
}
function inferenceCompletionError(task,jobs=[]){
  const required=inferenceRequirement(task);if(!required)return null;
  const matching=jobs.filter(job=>job.model===required.model);
  if(matching.some(job=>job.status==='COMPLETED'&&job.samples.length>=required.samples))return null;
  const actual=Math.max(0,...matching.map(job=>job.samples.length));
  return `This benchmark requires ${required.samples} measured samples with identical prompt/context on ${required.model}; the largest saved job has ${actual}. Start run_model with samples:${required.samples}, then continue its jobId until all samples are complete. A completed smaller job is not completion of the objective.`;
}
const measuredExecutionStep=step=>/\b(?:execute|run|measure|benchmark)\b/i.test(step)&&/\b(?:prompts?|samples?|model)\b/i.test(step);
function inputFor(args,task){
  if(!args||typeof args!=='object'||Array.isArray(args))throw Error('Provide a model job request');
  if(Object.keys(args).some(key=>!['jobId','prompt','system','samples','maxTokens','label','model'].includes(key)))throw Error('Unsupported model job argument');
  if(args.jobId!==undefined){if(typeof args.jobId!=='string'||!/^model-[a-f0-9]{32}$/.test(args.jobId))throw Error('Invalid model job ID: copy a saved jobId exactly without extra text');return null;}
  if(typeof args.prompt!=='string'||!args.prompt.trim()||args.prompt.length>4000)throw Error('Model prompt must contain 1–4000 characters');
  if(args.system!==undefined&&(typeof args.system!=='string'||args.system.length>1500))throw Error('Fixed model context must contain at most 1500 characters');
  if(args.label!==undefined&&(typeof args.label!=='string'||args.label.length>120))throw Error('Model job label is too long');
  const samples=args.samples??1,model=args.model||task.model||DEFAULT_MODEL;profileFor(model);
  // Thinking-only samples need room for reasoning plus the measured response.
  const maxTokens=args.maxTokens??(isNextThinkingModel(model)?2048:128);
  if(!Number.isSafeInteger(samples)||samples<1||samples>MAX_SAMPLES)throw Error('Choose 1–50 identical samples');
  const outputLimit=model===NEXT_80B_THINKING_Q4_MODEL?profileFor(model).outputTokens:MAX_TOKENS;
  if(!Number.isSafeInteger(maxTokens)||maxTokens<16||maxTokens>outputLimit)throw Error(`Choose a model output limit of 16–${outputLimit} tokens`);
  return {model,request:{prompt:args.prompt,system:args.system??'You are a helpful assistant.',samples,maxTokens,label:args.label||''}};
}
function statistics(samples){
  const sum=key=>samples.reduce((total,sample)=>total+sample[key],0),outputTokens=sum('outputTokens'),generationMs=sum('generationMs');
  return {count:samples.length,outputTokens,totalWallMs:sum('wallMs'),tokensPerSecond:generationMs?round(outputTokens*1000/generationMs):null,meanTokensPerSecond:samples.length?round(samples.reduce((n,s)=>n+s.outputTokens*1000/s.generationMs,0)/samples.length):null,meanWallMs:samples.length?round(sum('wallMs')/samples.length):null,meanQueueMs:samples.length?round(sum('queueMs')/samples.length):null};
}
/** Runs after the parent model turn released its queue slot. Samples have no tools/history. */
async function runModelJob({store,runtime,task,args,token,signal,inference=callback=>callback(),writeDraft,now=Date.now}){
  const input=inputFor(args,task);store.assertRunnable(task.id,token);
  const required=inferenceRequirement(task);
  if(input&&required&&input.request.samples<required.samples)throw Error(`This task requires samples:${required.samples} in the job request. samples is the TOTAL number of prompts, not the three-sample work batch. Start that total once, then resume with jobId.`);
  let job;
  if(input){const id='model-'+createHash('sha256').update(JSON.stringify([task.id,input])).digest('hex').slice(0,32);job=store.createModelJob(task.id,id,input,token);}
  else job=store.modelJob(task.id,args.jobId);
  let resumeInfo;
  if(args.jobId){
    for(const key of ['model','prompt','system','maxTokens','label'])if(Object.hasOwn(args,key)&&args[key]!== (key==='model'?job.model:job.request[key]))throw Error(`Saved model job context is fixed: omit ${key} or keep its unchanged value`);
    if(args.samples!==undefined&&(!Number.isSafeInteger(args.samples)||args.samples<1||args.samples>MAX_SAMPLES))throw Error('A repeated sample hint must be within 1–50; the saved job total remains unchanged');
    resumeInfo={fields:Object.keys(args).filter(key=>key!=='jobId'),requestedSamples:args.samples??null,remainingBefore:job.request.samples-job.samples.length,savedTotal:job.request.samples};
  }
  const profile=profileFor(job.model),messages=[{role:'system',content:job.request.system},{role:'user',content:job.request.prompt}];
  for(let count=0;count<SAMPLES_PER_CALL&&job.samples.length<job.request.samples;count++){
    signal?.throwIfAborted();store.assertRunnable(task.id,token);
    const queuedAt=now(),index=job.samples.length+1;
    const sample=await runtime.withInference(async yielded=>{
      const combined=yielded?(signal?AbortSignal.any([signal,yielded]):yielded):signal;
      combined?.throwIfAborted();store.assertRunnable(task.id,token);
      return inference(async()=>{
        const startedAt=now();
        store.recordActivity?.(task.id,'MODEL_STEP',{model:job.model,scope:'sample',jobId:job.id,index},token);
        const response=await runtime.chat(job.model,messages,[],combined,null,null,{thinking:profile.thinking,rawMeasurement:true,num_ctx:profile.contextTokens||CONTEXT_TOKENS,num_predict:job.request.maxTokens,temperature:0,noResourceRetry:true});
        combined?.throwIfAborted();store.assertRunnable(task.id,token);
        const content=response?.message?.content;
        if(response?.model&&response.model!==job.model)throw Error('Model response identity does not match the job');
        if(typeof content!=='string'||JSON.stringify(content).length>20000||!Number.isSafeInteger(response.eval_count)||response.eval_count<=0||!Number.isFinite(response.eval_duration)||response.eval_duration<=0)throw Error('Model response has no valid measured token metrics');
        return {index,at:startedAt,response:content,promptTokens:Number.isSafeInteger(response.prompt_eval_count)?response.prompt_eval_count:null,outputTokens:response.eval_count,generationMs:response.eval_duration/1e6,promptMs:Number.isFinite(response.prompt_eval_duration)?round(response.prompt_eval_duration/1e6):null,loadMs:Number.isFinite(response.load_duration)?round(response.load_duration/1e6):null,wallMs:Math.max(0,now()-startedAt),queueMs:Math.max(0,startedAt-queuedAt),doneReason:response.done_reason||null};
      });
    },signal,{priority:'background',preemptible:true});
    signal?.throwIfAborted();job=store.saveModelSample(task.id,job.id,sample,token);
  }
  const folder=`model-runs/${job.id}`,results=statistics(job.samples);
  for(const sample of job.samples)await writeDraft({path:`${folder}/sample-${String(sample.index).padStart(3,'0')}.json`,content:JSON.stringify({model:job.model,...sample},null,2)});
  const report={jobId:job.id,model:job.model,createdAt:job.createdAt,status:job.status,request:job.request,contextTokens:profile.contextTokens||CONTEXT_TOKENS,thinking:profile.thinking,temperature:0,statistics:results,columns:['index','promptTokens','outputTokens','wallMs','queueMs','generationMs','promptMs','loadMs'],measurements:job.samples.map(s=>[s.index,s.promptTokens,s.outputTokens,s.wallMs,s.queueMs,s.generationMs,s.promptMs,s.loadMs]),responseFiles:'sample-001.json through the completed sample count; each contains the exact response and measurements'};
  const artifact=await writeDraft({path:`${folder}/results-${String(job.samples.length).padStart(3,'0')}.json`,content:JSON.stringify(report,null,2)});
  const goalError=inferenceCompletionError(task,store.modelJobs(task.id));
  return {jobId:job.id,model:job.model,status:job.status,completed:job.samples.length,total:job.request.samples,statistics:results,path:artifact.path,sha256:artifact.sha256,...(resumeInfo?{resumeInfo}:{}),response:job.request.samples===1?job.samples[0]?.response.slice(0,1600):undefined,next:job.status==='COMPLETED'?(goalError||'Read the saved results and report the measured outcome.'):`Continue with run_model({jobId:"${job.id}"}); saved samples will not repeat.`};
}
function modelAccessQuestion(question,task){return question.status==='OPEN'&&question.reason==='ACCESS'&&String(question.question).toLowerCase().includes(String(task.model||DEFAULT_MODEL).toLowerCase())&&/inference|execute.{0,60}prompts|model.{0,20}(?:interface|endpoint|access)/i.test(question.question);}
module.exports={runModelJob,statistics,modelAccessQuestion,inferenceRequirement,inferenceCompletionError,measuredExecutionStep,SAMPLES_PER_CALL,MAX_SAMPLES,MAX_TOKENS};
