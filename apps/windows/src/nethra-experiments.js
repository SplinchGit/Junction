'use strict';
const DAY=86_400_000;
const MIN_SAMPLES=5,MAX_SAMPLES=100,MIN_EFFECT=0.05,ALPHA=0.05;
const METRICS=Object.freeze({
  task_model_ms:{label:'task model call time',unit:'ms',better:'lower'},
  chat_response_ms:{label:'local chat response time',unit:'ms',better:'lower'},
  chat_tokens_per_second:{label:'local chat generation speed',unit:'tokens/s',better:'higher'}
});
const CHANGE_KINDS=new Set(['code','setting','other']);
const validDuration=value=>Number.isFinite(value)&&value>0&&value<=600_000;
const validSpeed=value=>Number.isFinite(value)&&value>0&&value<=1000;

function median(values){
  if(!values.length)return null;
  const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
}
// Abramowitz and Stegun 7.1.26; ample precision for a significance threshold.
function normalCdf(z){const t=1/(1+0.3275911*Math.abs(z)/Math.SQRT2),erf=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-z*z/2);return z>=0?(1+erf)/2:(1-erf)/2;}
/** Two-sided Mann-Whitney U (normal approximation, tie and continuity corrected). Timings are skewed, so no t-test. */
function mannWhitneyP(a,b){
  const all=[...a.map(value=>({value,group:0})),...b.map(value=>({value,group:1}))].sort((x,y)=>x.value-y.value);
  const n1=a.length,n2=b.length,total=n1+n2;let rankSum=0,ties=0;
  for(let i=0;i<total;){let j=i;while(j+1<total&&all[j+1].value===all[i].value)j++;const rank=(i+j)/2+1,count=j-i+1;ties+=count**3-count;for(let k=i;k<=j;k++)if(all[k].group===0)rankSum+=rank;i=j+1;}
  const u=rankSum-n1*(n1+1)/2,mean=n1*n2/2,sigma=Math.sqrt(n1*n2/12*((total+1)-ties/(total*(total-1))));
  if(!sigma)return 1;
  return Math.min(1,2*(1-normalCdf(Math.max(0,(Math.abs(u-mean)-0.5)/sigma))));
}

/** Measured values for one metric in [since, until]; never prompt or message text. */
function metricSamples({store,localData,taskId,metric,since,until,model=null}){
  if(metric==='task_model_ms')return (store.inferenceSamples?.(taskId,Math.max(0,Math.floor(since)),MAX_SAMPLES)||[]).filter(row=>row.at<=until&&validDuration(row.durationMs)).map(row=>({at:row.at,value:row.durationMs}));
  const field=metric==='chat_tokens_per_second'?'tokensPerSecond':'durationMs',valid=metric==='chat_tokens_per_second'?validSpeed:validDuration;
  return (localData?.usage?.()||[]).filter(row=>row.providerId==='local'&&Number.isSafeInteger(row.createdAt)&&row.createdAt>=since&&row.createdAt<=until&&valid(row[field])&&(!model||row.model===model)).slice(0,MAX_SAMPLES).map(row=>({at:row.createdAt,value:row[field],model:typeof row.model==='string'?row.model.slice(0,80):null}));
}
function mostCommon(values){const counts=new Map();for(const value of values)if(value)counts.set(value,(counts.get(value)||0)+1);return [...counts].sort((a,b)=>b[1]-a[1])[0]?.[0]||null;}
const summary=values=>({count:values.length,median:values.length?Math.round(median(values)*100)/100:null});

/** The baseline is frozen at start, so later samples can never leak into the "before" side. */
function startExperiment({store,localData,task,args,now=Date.now(),token}){
  const metric=METRICS[args.metric];if(!metric)throw new Error('Unknown experiment metric');
  const changeKind=CHANGE_KINDS.has(args.changeKind)?args.changeKind:'code';
  const samples=metricSamples({store,localData,taskId:task.id,metric:args.metric,since:now-7*DAY,until:now});
  const model=args.metric==='task_model_ms'?null:mostCommon(samples.map(item=>item.model));
  const values=samples.filter(item=>!model||item.model===model).map(item=>item.value);
  if(values.length<MIN_SAMPLES)throw new Error(`Only ${values.length} baseline sample${values.length===1?'':'s'} of ${metric.label} in the last 7 days; at least ${MIN_SAMPLES} are needed before a change can be tested`);
  return store.createExperiment(task.id,{hypothesis:String(args.hypothesis||'').slice(0,500),metric:args.metric,changeKind,model,workId:typeof args.workId==='string'?args.workId.slice(0,64):null,startedAt:now,baseline:{values,...summary(values),from:Math.min(...samples.map(item=>item.at)),to:now}},token);
}

/**
 * Where the "after" window starts, or why it has not started yet. A code change is only ever a
 * host fact: a promoted Work Activity draft or a commit the host verified. Nethra's own word counts
 * for settings and other changes only (live, 26 October, it twice declared code changes that were
 * never made and asked the owner to restart for them).
 */
function changePoint(experiment,{store,workStatus,now}){
  const code=experiment.changeKind==='code';
  let at=code&&!String(experiment.changeActor||'').startsWith('Junction')?null:experiment.changeAt,actor=experiment.changeActor;
  if(!at&&experiment.workId&&workStatus){const work=workStatus(experiment.workId);if(work?.promotedAt>experiment.startedAt){at=work.promotedAt;actor='Junction (Work Activity promotion)';}}
  if(!at)return {waiting:'WAITING_FOR_CHANGE',detail:code?(experiment.workId?'The linked development draft has not been verified and promoted yet.':'No verified code change yet. Use mark_change with workId (a Work Activity draft) or commit (a sha that changed apps/windows/src after the baseline).'):'Mark the experiment change once it has been applied.'};
  if(experiment.changeKind!=='code')return {at,actor};
  // Code only takes effect in a Junction process started after the change.
  const started=store.hostStartsAfter?.(at)?.[0];
  if(!started)return {at,actor,waiting:'WAITING_FOR_RESTART',detail:'The change is code; restart Junction so new samples come from the changed build.'};
  return {at:started,actor,changeAt:at};
}

function evaluateExperiment({store,localData,task,experiment,workStatus=null,now=Date.now()}){
  if(experiment.status==='CONCLUDED')return experiment;
  const metric=METRICS[experiment.metric],point=changePoint(experiment,{store,workStatus,now});
  const base={metric:experiment.metric,label:metric.label,unit:metric.unit,better:metric.better,before:{count:experiment.baseline.count,median:experiment.baseline.median},evaluatedAt:now,...(point.actor?{changeRecordedBy:point.actor}:{})};
  if(point.waiting)return store.saveExperimentResult(task.id,experiment.id,{...base,verdict:point.waiting,detail:point.detail},false);
  const after=metricSamples({store,localData,taskId:task.id,metric:experiment.metric,since:point.at,until:now,model:experiment.model}).map(item=>item.value);
  if(after.length<MIN_SAMPLES)return store.saveExperimentResult(task.id,experiment.id,{...base,afterFrom:point.at,after:summary(after),verdict:'INSUFFICIENT_DATA',detail:`${after.length} of ${MIN_SAMPLES} samples since the change point.`},false);
  const before=experiment.baseline.values,p=mannWhitneyP(before,after),beforeMedian=median(before),afterMedian=median(after);
  const change=beforeMedian?(afterMedian-beforeMedian)/beforeMedian:0,favourable=metric.better==='lower'?change<0:change>0;
  const verdict=p<ALPHA&&Math.abs(change)>=MIN_EFFECT?(favourable?'IMPROVED':'REGRESSED'):'NO_CLEAR_CHANGE';
  return store.saveExperimentResult(task.id,experiment.id,{...base,afterFrom:point.at,after:summary(after),relativeChange:Math.round(change*1000)/1000,pValue:Math.round(p*10000)/10000,verdict,
    detail:`${metric.label} median ${summary(before).median} → ${summary(after).median} ${metric.unit} (${before.length} vs ${after.length} samples, p=${p.toFixed(3)}).`,
    caveat:'Real workloads, not a controlled benchmark: a change in what was asked can move these medians.'},true);
}

function verdictLine(result){
  if(!result)return 'Experiment started';
  const pct=Number.isFinite(result.relativeChange)?`${Math.abs(Math.round(result.relativeChange*100))}%`:'';
  if(result.verdict==='IMPROVED')return `Experiment: ${result.label} improved ${pct} (${result.before.count} vs ${result.after.count} samples)`;
  if(result.verdict==='REGRESSED')return `Experiment: ${result.label} got worse by ${pct} (${result.before.count} vs ${result.after.count} samples)`;
  if(result.verdict==='NO_CLEAR_CHANGE')return `Experiment: no clear change in ${result.label} (${result.before.count} vs ${result.after.count} samples)`;
  if(result.verdict==='INVALID')return `Experiment withdrawn as invalid: ${String(result.detail||'').slice(0,160)}`;
  if(result.verdict==='ABANDONED')return `Experiment abandoned: ${String(result.detail||'').slice(0,160)}`;
  return `Experiment waiting: ${String(result.detail||result.verdict).slice(0,160)}`;
}

module.exports={METRICS,MIN_SAMPLES,mannWhitneyP,metricSamples,startExperiment,evaluateExperiment,changePoint,verdictLine};
