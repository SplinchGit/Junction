'use strict';
const {spawn}=require('node:child_process');

const windowName=minutes=>minutes===300?'five_hour':minutes===10080?'seven_day':`${minutes}_minutes`;

/** Reads the signed-in ChatGPT account's live Codex windows. This queries limits; it does not spend them. */
function readCodexLimits({launch=spawn,timeoutMs=20_000}={}){
  return new Promise((resolve,reject)=>{
    const child=launch('codex',['app-server'],{windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
    let buffer='',settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);try{child.kill();}catch{}error?reject(error):resolve(value);};
    const timer=setTimeout(()=>finish(new Error('Codex limit check timed out')),timeoutMs);
    const send=message=>child.stdin.write(`${JSON.stringify(message)}\n`);
    child.on('error',error=>finish(error));
    child.stdin.on('error',()=>{});
    child.stdout.on('data',chunk=>{
      buffer+=String(chunk);let index;
      while((index=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,index);buffer=buffer.slice(index+1);
        let message;try{message=JSON.parse(line);}catch{continue;}
        if(message.id===0){send({method:'initialized'});send({id:1,method:'account/rateLimits/read'});}
        if(message.id===1){
          if(message.error)return finish(new Error(String(message.error.message||'Codex limit check failed').slice(0,200)));
          const limits=message.result?.rateLimits||{};
          const windows=[limits.primary,limits.secondary].filter(item=>Number.isFinite(item?.usedPercent)&&Number.isFinite(item?.resetsAt)).map(item=>({name:windowName(item.windowDurationMins),usedPercent:item.usedPercent,resetsAt:item.resetsAt*1000}));
          finish(null,{windows,limitReached:Boolean(limits.rateLimitReachedType||limits.spendControlReached),limitResetsAt:null,plan:typeof limits.planType==='string'?limits.planType.slice(0,30):null});
        }
      }
    });
    send({id:0,method:'initialize',params:{clientInfo:{name:'junction',version:'1'}}});
  });
}

/**
 * Live usage gate for Nethra's advisors. There is no fixed daily count: an advisor is
 * available while every live window is below the owner's reserve, and Nethra is told
 * exactly when the blocking window resets so it can schedule its next attempt.
 */
class AdvisorLimits{
  constructor({store,now=Date.now,readCodex=readCodexLimits,codexCacheMs=60_000}={}){Object.assign(this,{store,now,readCodex,codexCacheMs});this.codexCache=null;}
  reservePercent(){const value=this.store?.settings?.().advisorReservePercent;return Number.isFinite(value)?value:10;}
  recordClaude(snapshot){if(snapshot)this.store?.recordAdvisorSnapshot?.('claude',{...snapshot,checkedAt:this.now()});}
  async snapshot(provider){
    if(provider==='claude'){const saved=this.store?.advisorSnapshot?.('claude');return saved?{...saved,source:'last Claude reply'}:null;}
    if(this.codexCache&&this.now()-this.codexCache.checkedAt<this.codexCacheMs)return this.codexCache;
    try{this.codexCache={...await this.readCodex(),checkedAt:this.now(),source:'live Codex account query'};}
    catch(error){return {windows:[],limitReached:false,checkedAt:this.now(),source:'unavailable',error:String(error.message).slice(0,200)};}
    return this.codexCache;
  }
  invalidate(provider){if(provider==='codex')this.codexCache=null;}
  async check(provider){
    if(!['codex','claude'].includes(provider))throw new Error('Unknown advisor');
    const now=this.now(),reserve=this.reservePercent(),ceiling=100-reserve,snap=await this.snapshot(provider);
    if(!snap)return {provider,available:true,reservePercent:reserve,windows:[],checkedAt:null,source:'no Claude reply recorded yet',detail:'Limits are reported after the first consultation.'};
    // A window past its reset time no longer constrains anything, whatever it last read.
    const windows=(snap.windows||[]).map(item=>({...item,current:item.resetsAt>now}));
    const blocking=windows.filter(item=>item.current&&item.usedPercent>=ceiling);
    // A reached limit with no full window (e.g. a spend control) re-checks at the earliest reset rather than waiting a week.
    if(snap.limitReached&&!blocking.length){const resetsAt=snap.limitResetsAt||Math.min(...windows.filter(item=>item.current).map(item=>item.resetsAt));if(Number.isFinite(resetsAt)&&resetsAt>now)blocking.push({name:'limit',usedPercent:100,resetsAt});}
    const nextAvailableAt=blocking.length?Math.max(...blocking.map(item=>item.resetsAt)):null;
    const detail=blocking.length?`Usage is at or above the ${ceiling}% the owner allows (${blocking.map(item=>`${item.name} ${item.usedPercent}%`).join(', ')}). Available again at ${new Date(nextAvailableAt).toISOString()}.`:`Below the ${ceiling}% ceiling${windows.length?` (${windows.filter(item=>item.current).map(item=>`${item.name} ${item.usedPercent}%`).join(', ')})`:''}.`;
    return {provider,available:!blocking.length,reservePercent:reserve,windows:windows.map(({current,...item})=>({...item,stale:!current})),checkedAt:snap.checkedAt,source:snap.source,nextAvailableAt,detail,...(snap.error?{error:snap.error}:{})};
  }
}

module.exports={AdvisorLimits,readCodexLimits};
