'use strict';

const {performance}=require('node:perf_hooks');
const {execFileSync}=require('node:child_process');
const {fitContext}=require('../src/model-context');

const samples=120;
const warmup=30;
const tools=[{type:'function',function:{name:'lookup',parameters:{type:'object',properties:{query:{type:'string'}}}}}];
const fixtures=[
  {name:'short',exchanges:5,toolBytes:500},
  {name:'compaction',exchanges:30,toolBytes:2400},
  {name:'heavy-compaction',exchanges:150,toolBytes:1200}
];

function measure({name,exchanges,toolBytes}){
  const messages=[{role:'system',content:'Follow the objective.'},{role:'user',content:'Summarize verified findings.'}];
  for(let index=0;index<exchanges;index++){
    messages.push({role:'assistant',content:'',tool_calls:[{function:{name:'lookup',arguments:{query:'synthetic observation '+index}}}]});
    messages.push({role:'tool',content:'synthetic observation '.repeat(Math.ceil(toolBytes/22)).slice(0,toolBytes)});
  }
  messages.push({role:'user',content:'What changed?'});
  const times=[];
  let result;
  for(let index=0;index<warmup+samples;index++){
    const input=messages.slice();
    const started=performance.now();
    result=fitContext(input,tools);
    const elapsed=performance.now()-started;
    if(index>=warmup)times.push(elapsed);
  }
  times.sort((a,b)=>a-b);
  const percentile=fraction=>Number(times[Math.ceil(times.length*fraction)-1].toFixed(3));
  return {name,exchanges,toolBytes,samples,warmup,p50Ms:percentile(.5),p95Ms:percentile(.95),result};
}

const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:__dirname,encoding:'utf8'}).trim();
console.log(JSON.stringify({revision,node:process.version,fixtures:fixtures.map(measure)},null,2));
