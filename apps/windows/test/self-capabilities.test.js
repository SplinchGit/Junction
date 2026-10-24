'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {detectSearchRequirement} = require('../src/intent-router');
const {LocalAgentRuntime} = require('../src/local-agent-runtime');

test('own scheduling and tool questions are not public research', () => {
  for (const question of ["So what do you know about your agentic mode or tools? You can schedule work yes?", 'Can you schedule work?', 'What tools do you have?', 'Do you have web search?']) {
    assert.equal(detectSearchRequirement(question).required, false, question);
  }
  for (const question of ['What is the train schedule today?', 'Can you search for the latest agentic tools?', 'Can you schedule work to research today’s weather?']) {
    assert.equal(detectSearchRequirement(question).required, true, question);
  }
});

test('capability answers use registered tools without searching or creating work', async () => {
  const runtime = new LocalAgentRuntime({toolRegistry: {
    definitions: () => ['web_search','start_objective','list_objectives'].map(name => ({type:'function', function:{name}})),
    execute: async () => { throw new Error('A capability question must not execute a tool'); }, audit: () => {}
  }, fetchImpl: async () => { throw new Error('A capability question does not need inference'); }});
  const result = await runtime.runNow({goal:'So what do you know about your agentic mode or tools? You can schedule work yes?', model:'qwen3:30b', surface:'android-lan'});
  assert.match(result.content, /persistent objectives/i);
  assert.match(result.content, /Windows PC/i);
  assert.match(result.content, /start_objective/);
  assert.match(result.content, /haven.t created/i);
  assert.equal(result.toolsExecuted, 0);
});

test('missing scheduling tools are not advertised as available', async () => {
  const runtime = new LocalAgentRuntime({toolRegistry: {definitions:()=>[], execute:async()=>{throw Error('unexpected');},audit:()=>{}}, fetchImpl:async()=>{throw Error('unexpected');}});
  const result = await runtime.runNow({goal:'Can you schedule work?', model:'test'});
  assert.match(result.content, /not available/i);
  assert.doesNotMatch(result.content, /I can create/);
});
