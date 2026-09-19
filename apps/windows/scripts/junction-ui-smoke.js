"use strict";
// Live renderer -> preload -> IPC -> search -> Ollama test. Live results are never mocked.
const { app } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { WebResearchClient } = require('../src/web-research');
const { LocalAgentRuntime } = require('../src/local-agent-runtime');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'junction-websearch-2026-')));
const directory = path.join(__dirname, '../test-results');
fs.mkdirSync(directory, {recursive:true});
const output = path.join(directory, 'junction-websearch-2026.json');
const models = process.argv.slice(2).length ? process.argv.slice(2) : ['qwen3:1.7b','qwen3.5:2b','lfm2.5:2.6b'];
const goal = 'Who won the 2026 football World Cup?';
const report = {generatedAt:new Date().toISOString(),goal,reference:{winner:'Spain',url:'https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/final-tournament-standings',note:'Independent test assertion; never supplied to the model.'},results:[]};
let current, blockSearch = false;
const originalFetch = global.fetch;
global.fetch = async (url, options) => {
  const isSearch = new URL(String(url)).hostname === 'html.duckduckgo.com';
  const startedAt = new Date().toISOString();
  const response = await originalFetch(url, options);
  if(isSearch && current) current.httpSearches.push({url:String(url),startedAt,status:response.status});
  return response;
};
const originalSearch = WebResearchClient.prototype.search;
WebResearchClient.prototype.search = async function(...args) {
  if(blockSearch) throw new Error('SMOKE_TEST_SEARCH_OFFLINE');
  return originalSearch.apply(this,args);
};
const originalChat = LocalAgentRuntime.prototype.chat;
LocalAgentRuntime.prototype.chat = async function(model,messages,definitions,signal) {
  current.modelCalls++;
  for(const message of messages.filter(message=>message.role==='tool' && message.tool_name==='web_search')) {
    try { const result=JSON.parse(message.content); if(result.ok && result.evidence) current.toolEvidence.push(result.evidence); } catch {}
  }
  return originalChat.call(this,model,messages,definitions,signal);
};
app.on('browser-window-created',(_event,window)=>{
  window.webContents.once('did-finish-load',async()=>{
    try {
      for(const model of models) {
        current={model,runId:`web2026-${model}`,httpSearches:[],toolEvidence:[],modelCalls:0,success:false};
        const started=Date.now();
        try {
          const result=await window.webContents.executeJavaScript(`(async()=>{
            await window.junction.setProvider({id:'local',model:${JSON.stringify(model)}});
            const conversation=await window.junction.newConversation();
            const reply=await window.junction.sendMessage({conversationId:conversation.id,content:${JSON.stringify(goal)},runId:${JSON.stringify(current.runId)}});
            await openConversation(conversation.id);
            return {reply,audit:await window.junction.audit()};
          })()`);
          current.durationMs=Date.now()-started;
          current.answer=result.reply.message.content;
          current.audit=result.audit.filter(row=>row.runId===current.runId);
          const answerOnly=current.answer.split('\n\nSources:')[0];
          const ids=[...answerOnly.matchAll(/\[(S\d+\.p\d+)\]/g)].map(match=>match[1]);
          const evidence=current.toolEvidence.flatMap(item=>item.sources).flatMap(source=>source.passages.map(passage=>({...passage,url:source.url})));
          current.citedPassages=evidence.filter(passage=>ids.includes(passage.id));
          const supportsWinner=text=>/Spain/i.test(text) && /2026/.test(text) && /won|winner|champion|winning/i.test(text);
          current.checks={
            liveHttpSearch:current.httpSearches.some(request=>request.status===200),
            evidenceDeliveredToModel:evidence.length>0,
            executedToolRecorded:current.audit.some(row=>row.event==='agent_tool_result' && row.capability==='web_search' && row.outcome==='success'),
            correctWinner:/Spain/i.test(answerOnly) && /won|winner|champion/i.test(answerOnly) && !/not yet|hasn't|has not|will be|not been/i.test(answerOnly),
            citationsExist:ids.length>0 && ids.every(id=>evidence.some(passage=>passage.id===id)),
            citedEvidenceSupportsWinner:current.citedPassages.some(passage=>supportsWinner(passage.text))
          };
          fs.writeFileSync(path.join(directory,`web2026-${model.replace(/[^a-z0-9.-]/gi,'-')}.png`),(await window.webContents.capturePage()).toPNG());
          blockSearch=true;
          const callsBefore=current.modelCalls;
          const failure=await window.webContents.executeJavaScript(`(async()=>{
            const conversation=await window.junction.newConversation();
            try { const result=await window.junction.sendMessage({conversationId:conversation.id,content:${JSON.stringify(goal)}}); return {answered:true,content:result.message.content}; }
            catch(error) {return {answered:false,error:error.message};}
          })()`);
          current.negativeControl={...failure,modelCalls:current.modelCalls-callsBefore};
          current.checks.searchFailureBlocksMemoryAnswer=!failure.answered && /SMOKE_TEST_SEARCH_OFFLINE/.test(failure.error) && current.negativeControl.modelCalls===0;
          current.success=Object.values(current.checks).every(Boolean);
        } catch(error) {current.error=error.message;current.durationMs=Date.now()-started;}
        finally {blockSearch=false;}
        report.results.push(current);
        fs.writeFileSync(output,JSON.stringify(report,null,2));
        console.log(JSON.stringify({model,success:current.success,durationMs:current.durationMs,checks:current.checks,error:current.error}));
      }
    } finally {app.exit(report.results.length===models.length && report.results.every(row=>row.success)?0:1);}
  });
});
require('../src/main');
