'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {InferenceCoordinator}=require('../src/local-agent-runtime');

test('interactive work takes the next slot ahead of queued background work',async()=>{
  const queue=new InferenceCoordinator();const order=[];let release;
  const active=queue.run(()=>new Promise(resolve=>{release=()=>{order.push('active');resolve();};}),null,{priority:'background'});
  await new Promise(resolve=>setImmediate(resolve));
  const background=queue.run(()=>{order.push('background');},null,{priority:'background'});
  const interactive=queue.run(()=>{order.push('interactive');},null,{priority:'interactive'});
  release();await Promise.all([active,background,interactive]);
  assert.deepEqual(order,['active','interactive','background']);
});

test('background work gets a turn after three interactive requests',async()=>{
  const queue=new InferenceCoordinator();const order=[];let release;
  const active=queue.run(()=>new Promise(resolve=>{release=resolve;}),null,{priority:'background'});
  await new Promise(resolve=>setImmediate(resolve));
  const jobs=[1,2,3,4].map(n=>queue.run(()=>{order.push(`chat${n}`);},null,{priority:'interactive'}));
  jobs.push(queue.run(()=>{order.push('background');},null,{priority:'background'}));
  release();await Promise.all([active,...jobs]);
  assert.deepEqual(order,['chat1','chat2','chat3','background','chat4']);
});

test('cancelled queued work never starts',async()=>{
  const queue=new InferenceCoordinator();let release,called=false;
  const active=queue.run(()=>new Promise(resolve=>{release=resolve;}));
  await new Promise(resolve=>setImmediate(resolve));
  const controller=new AbortController();
  const waiting=queue.run(()=>{called=true;},controller.signal);
  controller.abort(new Error('cancelled'));
  await assert.rejects(waiting,/cancelled/);
  release();await active;assert.equal(called,false);
});
