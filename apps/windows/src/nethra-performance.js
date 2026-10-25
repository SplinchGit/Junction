'use strict';
const DAY=86_400_000;
const validTime=(value,minimum,now)=>Number.isSafeInteger(value)&&value>=minimum&&value<=now;
const validDuration=value=>Number.isFinite(value)&&value>0&&value<=600_000;
function median(values){
  if(!values.length)return null;
  const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);
  return Math.round(sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2);
}
/** A read-only, bounded summary of recorded host measurements; no prompt or message text. */
function performanceReport({store,localData,taskId,now=Date.now()}){
  const windowStart=now-7*DAY;
  const intervals=(store.inferenceSamples?.(taskId,windowStart,100)||[]).filter(row=>validTime(row.at,windowStart,now)&&validDuration(row.durationMs));
  const chats=(localData?.usage?.()||[]).filter(row=>row.providerId==='local'&&validTime(row.createdAt,windowStart,now)&&validDuration(row.durationMs)).slice(0,100);
  const speeds=chats.map(row=>row.tokensPerSecond).filter(value=>Number.isFinite(value)&&value>0&&value<=1000);
  return {
    asOf:now,windowStart,windowDays:7,note:'Task model inference and local chat responses measure different workloads. These samples are a baseline, not a before-and-after speedup result.',
    objective:{source:'Nethra inference intervals',sampleCount:intervals.length,lastSampleAt:intervals.length?Math.max(...intervals.map(row=>row.at)):null,medianInferenceMs:median(intervals.map(row=>row.durationMs)),totalInferenceMs:intervals.reduce((sum,row)=>sum+row.durationMs,0),todayBudgetMs:store.usage?.(taskId,now)?.taskMs??null},
    chat:{source:'Saved local chat usage',sampleCount:chats.length,lastSampleAt:chats.length?Math.max(...chats.map(row=>row.createdAt)):null,medianResponseMs:median(chats.map(row=>row.durationMs)),medianTokensPerSecond:median(speeds)}
  };
}
module.exports={performanceReport};
