'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {progressReporter}=require('../src/local-brain-relay');

test('a thousand thinking-token progress events cost one relay write, not a thousand',async()=>{
  let now=0;const writes=[];
  const report=progressReporter(async stage=>{writes.push(stage);},()=>now);
  report('Waiting for the PC model');
  for(let token=0;token<1000;token++){now+=50;report('Thinking on your PC');}
  await report.settled();
  assert.deepEqual(writes,['Waiting for the PC model','Thinking on your PC']);
});

test('rapid stage changes are limited to one write per interval',async()=>{
  let now=0;const writes=[];
  const report=progressReporter(async stage=>{writes.push(stage);},()=>now,5_000);
  for(let i=0;i<60;i++){now+=500;report(`stage ${i%3}`);}
  await report.settled();
  assert.ok(writes.length<=7,`expected <= 7 writes in 30 s, got ${writes.length}`);
});

test('progress writes are serialized and settle before the final status is written',async()=>{
  let now=0;const order=[];let release;
  const slow=new Promise(resolve=>{release=resolve;});
  const report=progressReporter(async stage=>{await slow;order.push(stage);},()=>now,0);
  report('Thinking on your PC');
  const finalWrite=report.settled().then(()=>order.push('done'));
  release();await finalWrite;
  assert.deepEqual(order,['Thinking on your PC','done']);
});

test('a failed progress write never breaks the reply',async()=>{
  const report=progressReporter(async()=>{throw new Error('429 RESOURCE_EXHAUSTED');},()=>0);
  report('Thinking on your PC');
  await assert.doesNotReject(report.settled());
});
