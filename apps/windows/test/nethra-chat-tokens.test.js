'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chatTokenSummary,chatTokenLine}=require('../renderer/chat-tokens');
const {canonicalHistory}=require('../src/assistant-context');

test('the token line counts what Nethra actually reads, exactly as chat history is built',()=>{
  const messages=Array.from({length:30},(_,i)=>({role:i%2?'assistant':'user',content:`message ${i} `+'x'.repeat(300+i*40)}));
  const seen=canonicalHistory(messages,'');
  const summary=chatTokenSummary(messages);
  assert.equal(summary.seenMessages,seen.length);
  assert.equal(summary.seenTokens,Math.ceil(seen.reduce((sum,item)=>sum+item.content.length,0)/3.5));
  assert.equal(summary.messages,30);assert.ok(summary.total>summary.seenTokens);
});

test('the line shows the measured prompt of the last reply when it was recorded',()=>{
  const messages=[{role:'user',content:'hello'},{role:'assistant',content:'hi there',telemetry:{inputTokens:2411}}];
  assert.equal(chatTokenLine(messages),"≈5 tokens in this chat · Nethra reads all of it · last reply's prompt 2,411 of 8,192");
  assert.match(chatTokenLine(Array.from({length:20},(_,i)=>({role:i%2?'assistant':'user',content:'y'.repeat(900)}))),/Nethra reads the latest ≈1\.0k \(4 of 20 messages\)/);
  assert.equal(chatTokenLine([]),'');
});
