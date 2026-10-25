'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {CONTEXT_TOKENS,fitContext,COMPACTED}=require('../src/model-context');
const {buildWorldInferencePayload}=require('../src/world-bridge');

test('every 30B caller asks for the same context, so the resident model is never reloaded',()=>{
  assert.equal(CONTEXT_TOKENS,8192);
  assert.equal(buildWorldInferencePayload([],100).options.num_ctx,CONTEXT_TOKENS);
  assert.equal(new (require('../src/model-warmer').ModelWarmer)().contextTokens,CONTEXT_TOKENS);
});

test('a long wake drops its oldest tool results instead of letting Ollama truncate silently',()=>{
  const big='x'.repeat(4000);
  const messages=[{role:'system',content:'system'},{role:'user',content:'seed'}];
  for(let i=0;i<8;i++)messages.push({role:'assistant',content:'',tool_calls:[{function:{name:'read_file',arguments:{path:`f${i}`}}}]},{role:'tool',tool_name:'read_file',content:big+i});
  const fit=fitContext(messages,[],{contextTokens:8192});
  assert.ok(fit.compacted>0);assert.equal(fit.fits,true);
  assert.equal(messages[0].content,'system');assert.equal(messages[1].content,'seed');
  assert.equal(messages.at(-1).content,big+7,'the newest result is kept');
  assert.equal(messages[3].content,COMPACTED,'the oldest result goes first');
  const small=[{role:'system',content:'s'},{role:'user',content:'u'},{role:'tool',content:'r'},{role:'assistant',content:'a'}];
  assert.equal(fitContext(small,[]).compacted,0);
});
