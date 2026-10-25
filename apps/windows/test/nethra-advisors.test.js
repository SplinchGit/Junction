'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {parseClaudeStream,sendClaudeConsult,getClaudeStatus,resolveClaudeExecutable}=require('../src/claude-client');
const {AdvisorLimits,readCodexLimits}=require('../src/advisor-limits');
const {NethraTools}=require('../src/nethra-tools');
const {systemPrompt}=require('../src/nethra-runner');

const NOW=Date.parse('2026-10-25T20:00:00Z');
const rateEvent=(status,fiveHour,sevenDay)=>({type:'rate_limit_event',rate_limit_info:{status,resetsAt:(NOW+3_600_000)/1000,unifiedWindows:{five_hour:{utilization:fiveHour,resetsAt:(NOW+3_600_000)/1000},seven_day:{utilization:sevenDay,resetsAt:(NOW+86_400_000)/1000}}}});
const resultEvent=text=>({type:'result',subtype:'success',is_error:false,result:text,usage:{input_tokens:12,output_tokens:30,cache_read_input_tokens:4},modelUsage:{'claude-sonnet-5-5':{}}});
function fakeChild(lines,code=0,capture={}){
  return (command,args,options)=>{
    Object.assign(capture,{command,args,options,stdin:''});
    const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};
    child.stdin={on(){},write(value){capture.stdin+=value;},end(value){capture.stdin+=value||'';queueMicrotask(()=>{child.stdout.emit('data',lines.map(item=>JSON.stringify(item)).join('\n')+'\n');child.emit('close',code);});}};
    return child;
  };
}
function memoryStore(settings={}){const snapshots={};return {settings:()=>({advisorReservePercent:10,...settings}),advisorSnapshot:provider=>snapshots[provider]||null,recordAdvisorSnapshot:(provider,body)=>{snapshots[provider]=body;}};}

test('a Claude stream yields the reply, the served model, token use and live windows as percentages',()=>{
  const parsed=parseClaudeStream([rateEvent('allowed',0.06,0.44),resultEvent('Measure first, then change one thing.')].map(item=>JSON.stringify(item)).join('\n'));
  assert.equal(parsed.content,'Measure first, then change one thing.');
  assert.equal(parsed.model,'claude-sonnet-5-5');
  assert.deepEqual(parsed.usage,{input_tokens:12,cache_read_input_tokens:4,output_tokens:30});
  assert.deepEqual(parsed.rateLimit.windows.map(item=>[item.name,item.usedPercent]),[['five_hour',6],['seven_day',44]]);
  assert.equal(parsed.rateLimit.limitReached,false);
});

test('a Claude consultation has no tools, MCP servers, user settings or saved session, and sends the prompt on stdin',async()=>{
  const capture={},recorded=[];
  const reply=await sendClaudeConsult({prompt:'Objective: speed',workingDirectory:'C:/task',executable:'claude.exe',onRateLimit:item=>recorded.push(item),launch:fakeChild([rateEvent('allowed',0.1,0.2),resultEvent('Advice')],0,capture)});
  assert.equal(reply.content,'Advice');
  assert.equal(capture.options.shell,false);
  assert.equal(capture.options.cwd,'C:/task');
  assert.equal(capture.stdin,'Objective: speed');
  assert.ok(!capture.args.includes('Objective: speed'));
  const after=flag=>capture.args[capture.args.indexOf(flag)+1];
  assert.equal(after('--tools'),'');
  assert.equal(after('--setting-sources'),'');
  assert.equal(after('--model'),'sonnet');
  assert.ok(capture.args.includes('--strict-mcp-config'));
  assert.ok(capture.args.includes('--no-session-persistence'));
  assert.equal(recorded.length,1);
});

test('a rejected Claude turn is reported as a usage limit and still records the window',async()=>{
  const recorded=[];
  await assert.rejects(sendClaudeConsult({prompt:'q',executable:'claude.exe',onRateLimit:item=>recorded.push(item),launch:fakeChild([rateEvent('rejected',1,0.5),{type:'result',is_error:true,result:'Usage limit reached'}],1)}),error=>error.rateLimit?.limitReached===true);
  assert.equal(recorded[0].limitReached,true);
});

test('only a Claude subscription sign-in counts as ready; Junction never sees the credential',async()=>{
  const run=status=>async(_command,args)=>({stdout:args[0]==='--version'?'2.1.306 (Claude Code)\n':JSON.stringify(status)});
  const ready=await getClaudeStatus(run({loggedIn:true,authMethod:'claude.ai',subscriptionType:'pro'}),'claude.exe');
  assert.equal(ready.ready,true);assert.equal(ready.plan,'pro');
  assert.equal((await getClaudeStatus(run({loggedIn:true,authMethod:'api_key'}),'claude.exe')).ready,false);
  assert.equal((await getClaudeStatus(async()=>{throw new Error('not found');},'claude.exe')).installed,false);
  assert.equal(resolveClaudeExecutable({JUNCTION_CLAUDE_PATH:'D:/claude.exe'},item=>item==='D:/claude.exe'),'D:/claude.exe');
});

test('the Codex limit query speaks the app-server protocol and converts reset times',async()=>{
  const sent=[];
  const launch=()=>{
    const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};
    const reply=message=>queueMicrotask(()=>child.stdout.emit('data',JSON.stringify(message)+'\n'));
    child.stdin={on(){},write(line){const message=JSON.parse(line);sent.push(message.method);if(message.id===0)reply({id:0,result:{}});if(message.id===1)reply({id:1,result:{rateLimits:{primary:{usedPercent:100,windowDurationMins:300,resetsAt:1792972357},secondary:{usedPercent:16,windowDurationMins:10080,resetsAt:1793559157},rateLimitReachedType:'rate_limit_reached',planType:'plus'}}});}};
    return child;
  };
  const limits=await readCodexLimits({launch});
  assert.deepEqual(sent,['initialize','initialized','account/rateLimits/read']);
  assert.deepEqual(limits.windows,[{name:'five_hour',usedPercent:100,resetsAt:1792972357000},{name:'seven_day',usedPercent:16,resetsAt:1793559157000}]);
  assert.equal(limits.limitReached,true);
});

test('advisors run freely below the owner ceiling and rest until the blocking window resets',async()=>{
  let windows=[{name:'five_hour',usedPercent:42,resetsAt:NOW+3_600_000},{name:'seven_day',usedPercent:70,resetsAt:NOW+86_400_000}];
  const limits=new AdvisorLimits({store:memoryStore(),now:()=>NOW,readCodex:async()=>({windows,limitReached:false}),codexCacheMs:0});
  assert.equal((await limits.check('codex')).available,true);
  windows=[{name:'five_hour',usedPercent:91,resetsAt:NOW+3_600_000},{name:'seven_day',usedPercent:70,resetsAt:NOW+86_400_000}];
  const resting=await limits.check('codex');
  assert.equal(resting.available,false);
  assert.equal(resting.nextAvailableAt,NOW+3_600_000);
  assert.match(resting.detail,/90%.*five_hour 91%/);
  // A reading from a window that has already reset no longer blocks.
  windows=[{name:'five_hour',usedPercent:100,resetsAt:NOW-1}];
  assert.equal((await limits.check('codex')).available,true);
});

test('the reserve is the owner’s: zero lets Nethra use everything up to the plan limit',async()=>{
  const windows=[{name:'five_hour',usedPercent:99,resetsAt:NOW+60_000}];
  const store=memoryStore({advisorReservePercent:0});
  assert.equal((await new AdvisorLimits({store,now:()=>NOW,readCodex:async()=>({windows,limitReached:false})}).check('codex')).available,true);
  assert.equal((await new AdvisorLimits({store,now:()=>NOW,readCodex:async()=>({windows,limitReached:true})}).check('codex')).available,false);
  // Live regression: a full five-hour window must not report the weekly reset as the return time.
  const full=[{name:'five_hour',usedPercent:100,resetsAt:NOW+3_600_000},{name:'seven_day',usedPercent:16,resetsAt:NOW+7*86_400_000}];
  assert.equal((await new AdvisorLimits({store:memoryStore(),now:()=>NOW,readCodex:async()=>({windows:full,limitReached:true})}).check('codex')).nextAvailableAt,NOW+3_600_000);
});

test('Claude availability follows its last reported window; with no reading yet it may try once',async()=>{
  const store=memoryStore(),limits=new AdvisorLimits({store,now:()=>NOW});
  const first=await limits.check('claude');
  assert.equal(first.available,true);assert.match(first.source,/no Claude reply/);
  limits.recordClaude({windows:[{name:'five_hour',usedPercent:95,resetsAt:NOW+600_000}],limitReached:false});
  assert.equal((await limits.check('claude')).nextAvailableAt,NOW+600_000);
});

test('consult_claude sends only the objective and question, and feeds the live window back to the gate',async()=>{
  const calls=[],recorded=[];
  const limits={check:async()=>({available:true}),invalidate(){},recordClaude:item=>recorded.push(item)};
  const task={id:'self-improvement',status:'ACTIVE',goal:'Self Improvement',successCriteria:'Faster replies',workspace:'C:/ws',allowCodeWork:true,readRoots:['C:/secret'],evidence:[{tool:'read_file'}]};
  const tools=new NethraTools({store:{get:()=>task},claudeStatus:async()=>({ready:true}),advisorLimits:limits,claudeConsult:async input=>{calls.push(input);input.onRateLimit({windows:[],limitReached:false});return {content:'Try warming earlier.',model:'claude-sonnet-5-5',usage:{output_tokens:9}};}});
  const result=await tools.execute('consult_claude',{question:'What should I measure?'},task);
  assert.equal(result.source,'claude');assert.equal(result.model,'claude-sonnet-5-5');
  assert.equal(calls[0].model,'sonnet');assert.equal(calls[0].workingDirectory,'C:/ws');
  assert.match(calls[0].prompt,/Self Improvement[\s\S]*What should I measure\?/);
  assert.doesNotMatch(calls[0].prompt,/secret|read_file/);
  assert.equal(recorded.length,1);
  await assert.rejects(tools.execute('consult_claude',{question:'q'},{...task,allowCodeWork:false}),/not enabled/);
});

test('objectives receive only the tools and instructions that apply to them',()=>{
  const tools=new NethraTools({store:{},localData:{usage:()=>[]},performanceReport:()=>({}),proposeCodeWork:()=>{}});
  const names=task=>tools.definitions({task}).map(item=>item.function.name);
  const plain=names({allowCodeWork:false,sources:[]});
  for(const name of ['calendar_event','gmail_message','phone_check','consult_claude','experiment'])assert.ok(!plain.includes(name),name);
  const improving=names({allowCodeWork:true,sources:['gmail']});
  for(const name of ['consult_codex','consult_claude','experiment','gmail_message'])assert.ok(improving.includes(name),name);
  assert.ok(!improving.includes('calendar_event'));
  assert.doesNotMatch(systemPrompt(new Set(plain)),/consult_claude|experiment|phone_check|gmail_message/);
  assert.match(systemPrompt(new Set(improving)),/consult_claude[\s\S]*experiment[\s\S]*gmail_message/);
});

test('a resting advisor points Nethra at the other one when it can answer now',async()=>{
  const task={id:'self-improvement',status:'ACTIVE',goal:'Self Improvement',allowCodeWork:true};
  const limits={check:async provider=>provider==='codex'?{available:false,detail:'Usage is at or above the 90% the owner allows (five_hour 100%).'}:{available:true},invalidate(){},recordClaude(){}};
  const tools=new NethraTools({store:{get:()=>task},codexStatus:async()=>({ready:true}),claudeStatus:async()=>({ready:true}),advisorLimits:limits});
  await assert.rejects(tools.execute('consult_codex',{question:'q'},task),/Claude is available now through consult_claude/);
});

test('advisors get Junction context, a word limit, and a reply that fits the evidence bound with its model intact',async()=>{
  const calls=[];const task={id:'s',status:'ACTIVE',goal:'Self Improvement',allowCodeWork:true};
  const tools=new NethraTools({store:{get:()=>task},claudeStatus:async()=>({ready:true}),advisorLimits:{check:async()=>({available:true}),invalidate(){},recordClaude(){}},claudeConsult:async input=>{calls.push(input);return {content:'z'.repeat(11_000),model:'claude-sonnet-5-5',usage:{output_tokens:2757}};}});
  const result=await tools.execute('consult_claude',{question:'What are the top bottlenecks?'},task);
  for(const part of ['Electron (Node.js)','qwen3:30b','at most 250 words'])assert.ok(calls[0].prompt.includes(part),part);
  assert.ok(JSON.stringify(result).length<=4000,'fits bounded() so nothing is truncated');
  assert.equal(result.model,'claude-sonnet-5-5');
});
