const {test}=require('node:test');const assert=require('node:assert/strict');
const {retryDeadline,engineeringPacket,validateVerification}=require('../src/foreman-executor');
test('capacity respects latest applicable reset; unknown reached capacity is not available',()=>{
 assert.equal(retryDeadline({rateLimits:{primary:{usedPercent:100,resetsAt:200},secondary:{usedPercent:100,resetsAt:300}}},100000),360000);
 assert.equal(retryDeadline({rateLimits:{rateLimitReachedType:'quota'}},100000),400000);
 assert.equal(retryDeadline({rateLimits:{primary:{usedPercent:10,resetsAt:300}}},100000),null);
});
test('verification only accepts explicit bounded argv; packet has owner scope and all evidence',()=>{
 assert.throws(()=>validateVerification([]),/verification/i);
 assert.throws(()=>validateVerification([{command:['npm','test'],cwd:'../escape'}]),/directory/i);
 assert.equal(validateVerification([{command:['node','--test'],cwd:'.'}]).length,1);
 const packet=engineeringPacket({objective:'Goal',baseSha:'abc',handoff:'Context',decisions:[]},{title:'Task',acceptance:'Pass',files:['a.js'],attempts:[]});
 for(const section of ['Objective','Architecture','Exact task','Relevant files','Constraints','Previous attempts','Build/test failures','Acceptance criteria','Requested output'])assert.ok(packet.includes(section));
});
