'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {textualCall}=require('../src/nethra-runner');
test('the 80B template may omit whitespace between a known tool name and its JSON object',()=>{
  const definitions=[{function:{name:'finish_objective'}}];
  assert.deepEqual(textualCall('finish_objective{"summary":"All fifty measured samples and the report are saved."}',definitions),{function:{name:'finish_objective',arguments:{summary:'All fifty measured samples and the report are saved.'}}});
  for(const value of ['finish_objective{"summary":"done"} extra text','I will finish_objective{"summary":"done"}','unknown_tool{"summary":"done"}','update_plan{"steps":[{"missing colon"}]}'])assert.equal(textualCall(value,definitions),null);
});
