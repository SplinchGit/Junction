const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');const {PassThrough}=require('node:stream');
const {CodexAppServer}=require('../src/codex-app-server');
test('reuses initialized process and rejects pending calls when process dies',async()=>{
 let launches=0,child;const client=new CodexAppServer({launch:()=>{launches++;child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',1);child.stdin.on('data',b=>{const m=JSON.parse(b);if(m.method==='initialize')queueMicrotask(()=>child.stdout.write(JSON.stringify({id:m.id,result:{}})+'\n'));});return child;}});
 await client.start();await client.start();assert.equal(launches,1);const waiting=client.request('test');child.emit('close',1);await assert.rejects(waiting,/stopped/);
});
test('request timeout is bounded',async()=>{const c=new CodexAppServer({requestTimeoutMs:5});c.process={stdin:{writable:true,write(){}}};await assert.rejects(c.request('x'),/timed out/);});
test('thread start uses the installed protocol sandbox enum',async()=>{const c=new CodexAppServer();c.start=async()=>{};let sandbox;c.request=async(method,p)=>{if(method==='thread/start'){sandbox=p.sandbox;throw new Error('captured');}};await assert.rejects(c.run({cwd:'fixture',prompt:'test'}),/captured/);assert.equal(sandbox,'workspace-write');});
