"use strict";
// Project Samantha M4 step 1: memory baseline. Seeds a throwaway LocalDataStore through the
// owner write path and asks each fixture question through the host chat runtime, one fresh
// conversation per question. Tools are disabled so every answer must come from recalled memory.
// It never touches the installed profile. Automatic marks are a first pass; read the replies.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {LocalDataStore}=require('../src/local-data');
const {LocalAgentRuntime}=require('../src/local-agent-runtime');
const {memoryContext}=require('../src/assistant-context');
const {runMemoryTraces,TRACE_SCHEMA}=require('../src/memory-trace');
const {sendClaudeConsult}=require('../src/claude-client');

const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'../test/fixtures/samantha-memory-baseline.json'),'utf8'));
const model=process.env.SAMANTHA_MODEL||'qwen3:30b';
const output=process.argv[2]||path.join(__dirname,'../test-results',`samantha-memory-baseline-${Date.now()}.json`);
const ABSTAIN=/\b(don'?t (know|have)|do not (know|have)|haven'?t (told|shared|mentioned|given)|have not (told|shared|mentioned|given)|never (told|shared|mentioned)|no record|not (been )?(told|shared|recorded|mentioned|specified|included)|isn'?t (recorded|in|mentioned|specified)|doesn'?t (include|mention|say|specify)|does not (include|mention|say|specify)|no (information|memory|mention)|not sure|unable to find)\b/i;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function mark(question,answer){
  const reply=answer.replace(/[\u2018\u2019]/g,"'");
  const hit=pattern=>new RegExp(pattern,'i').test(reply);
  const rejected=(question.reject||[]).filter(hit);
  if(question.abstain)return {pass:ABSTAIN.test(reply)&&!rejected.length,rejected};
  const missing=(question.expect||[]).filter(pattern=>!hit(pattern));
  return {pass:!missing.length&&!rejected.length,missing,rejected};
}

(async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'samantha-memory-'));
  const store=new LocalDataStore(directory);
  const runtime=new LocalAgentRuntime({toolRegistry:{definitions:()=>[],execute:async()=>{throw new Error('Tools are disabled in the memory baseline');},audit(){}}});
  // The same two judges the host wires in main.js: the local 80B model, then Claude on the subscription.
  const traceModel='junction-qwen3-next-thinking:80b-q4km';
  const local=async({system,prompt})=>(await runtime.withInference(async()=>{await runtime.prepareModel(traceModel);return runtime.chat(traceModel,[{role:'system',content:system},{role:'user',content:prompt}],[],AbortSignal.timeout(900_000),null,TRACE_SCHEMA,{thinking:true});},undefined,{priority:'background'})).message?.content;
  const frontier=async({system,prompt})=>(await sendClaudeConsult({prompt,systemPrompt:system,subscriptionOnly:true})).content;
  const writes=[],traces=[],ids=new Map();
  for(const [index,fact] of fixture.facts.entries()){
    const started=process.hrtime.bigint();
    const item=store.addMemory(fact.content,fact.category);
    writes.push(Number(process.hrtime.bigint()-started)/1e6);
    // Each fact is dated as if the owner had stated it on its fixture day.
    item.createdAt=item.validFrom=Date.parse(`${fact.statedAt}T09:00:00Z`)+index*60000;store.save();ids.set(item.id,fact.id);
    const traceStarted=Date.now();
    for(const trace of await runMemoryTraces({store,local,frontier})){
      const entry={fact:fact.id,checked:trace.checked,ms:Date.now()-traceStarted,supersede:trace.supersede.map(x=>({fact:ids.get(x.id),by:x.by,reason:x.reason})),unresolved:trace.unresolved.map(id=>ids.get(id)),expected:fact.supersedes||null};
      traces.push(entry);
      console.log(`TRACE ${fact.id} checked ${entry.checked} in ${Math.round(entry.ms/1000)}s -> ${entry.supersede.map(x=>`${x.fact} (${x.by})`).join(', ')||'nothing retired'}${entry.unresolved.length?`; unresolved ${entry.unresolved.join(', ')}`:''}`);
    }
    await sleep(5);
  }
  const memories=store.memories();
  const results=[];
  for(const question of fixture.questions){
    const recallStarted=process.hrtime.bigint();
    const recalled=memoryContext(memories,question.question,[]);
    const recallMs=Number(process.hrtime.bigint()-recallStarted)/1e6;
    const started=Date.now();let reply='',error=null;
    try{reply=String((await runtime.run({goal:question.question,model,history:[],memories,surface:'desktop',conversationId:`baseline-${question.id}`})).content||'');}
    catch(failure){error=String(failure?.message||failure);}
    const result={id:question.id,ability:question.ability,question:question.question,recalled,recallMs,reply,error,ms:Date.now()-started,...(error?{pass:false}:mark(question,reply))};
    results.push(result);
    console.log(`${result.pass?'PASS':'FAIL'} ${question.id} ${Math.round(result.ms/1000)}s ${JSON.stringify((error||reply).slice(0,200))}`);
    fs.mkdirSync(path.dirname(output),{recursive:true});
    fs.writeFileSync(output,JSON.stringify({model,today:fixture.today,writeMs:writes,traces,results},null,1));
  }
  const abilities={};
  for(const result of results){const row=abilities[result.ability]||={pass:0,total:0};row.total++;if(result.pass)row.pass++;}
  console.log(JSON.stringify(abilities));
  console.log(output);
  fs.rmSync(directory,{recursive:true,force:true});
})().catch(error=>{console.error(error);process.exit(1);});
