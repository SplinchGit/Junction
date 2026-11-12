const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');const {PassThrough}=require('node:stream');
const {CodexAppServer}=require('../src/codex-app-server');
test('reuses initialized process and rejects pending calls when process dies',async()=>{
 let launches=0,child;const client=new CodexAppServer({launch:()=>{launches++;child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',1);child.stdin.on('data',b=>{const m=JSON.parse(b);if(m.method==='initialize')queueMicrotask(()=>child.stdout.write(JSON.stringify({id:m.id,result:{}})+'\n'));});return child;}});
 await client.start();await client.start();assert.equal(launches,1);const waiting=client.request('test');child.emit('close',1);await assert.rejects(waiting,/stopped/);
});
test('request timeout is bounded',async()=>{const c=new CodexAppServer({requestTimeoutMs:5});c.process={stdin:{writable:true,write(){}}};await assert.rejects(c.request('x'),/timed out/);});
test('thread start uses the installed protocol sandbox enum',async()=>{const c=new CodexAppServer();c.start=async()=>{};let sandbox;c.request=async(method,p)=>{if(method==='thread/start'){sandbox=p.sandbox;throw new Error('captured');}};await assert.rejects(c.run({cwd:'fixture',prompt:'test'}),/captured/);assert.equal(sandbox,'workspace-write');});

test('shared engineering cannot obtain a writable Codex sandbox',async()=>{
 const c=new CodexAppServer();c.start=async()=>{};c.stop=async()=>{};
 c.request=async(method,p)=>{
  if(method==='model/list')return {data:[{isDefault:true,model:'supported'}]};
  if(method==='thread/start'){assert.equal(p.sandbox,'read-only');return {thread:{id:'read-only'}};}
  if(method==='turn/start'){assert.deepEqual(p.sandboxPolicy,{type:'readOnly'});throw new Error('captured read-only turn');}
 };
 await assert.rejects(c.run({cwd:'fixture',prompt:'return patch',readOnly:true}),/captured read-only turn/);
});

test('final answer excludes commentary when returning a provider patch',async()=>{
 const c=new CodexAppServer();c.start=async()=>{};c.stop=async()=>{};
 c.request=async(method)=>{
  if(method==='model/list')return {data:[{isDefault:true,model:'supported'}]};
  if(method==='thread/start')return {thread:{id:'patch-thread'}};
  if(method==='turn/start'){
   setImmediate(()=>{for(const notify of c.listeners){
    notify({method:'item/agentMessage/delta',params:{threadId:'patch-thread',turnId:'turn',delta:'I am inspecting files.\n'}});
    notify({method:'item/completed',params:{threadId:'patch-thread',turnId:'turn',item:{type:'agentMessage',phase:'final_answer',text:'diff --git a/a.js b/a.js\n'}}});
    notify({method:'turn/completed',params:{threadId:'patch-thread',turn:{id:'turn',status:'completed'}}});
   }});
   return {turn:{id:'turn'}};
  }
 };
 const result=await c.run({cwd:'fixture',prompt:'patch',readOnly:true});
 assert.equal(result.text,'diff --git a/a.js b/a.js\n');
});
test('ambiguous turn start records its thread and terminates transport before retry',async()=>{
 const c=new CodexAppServer();c.start=async()=>{};let stopped=0;const checkpoints=[];
 c.stop=async()=>{stopped++;};
 c.request=async method=>{if(method==='model/list')return {data:[{isDefault:true,model:'supported'}]};if(method==='thread/start')return {thread:{id:'thread-1'}};if(method==='turn/start')throw new Error('turn/start timed out');};
 await assert.rejects(c.run({cwd:'fixture',prompt:'test',onTurnStarted:value=>checkpoints.push(value)}),/timed out/);
 assert.deepEqual(checkpoints,[{threadId:'thread-1',dispatchPending:true}]);assert.equal(stopped,1);
});
