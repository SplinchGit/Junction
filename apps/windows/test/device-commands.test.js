'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const selfsigned=require('selfsigned');
const {DeviceCommandStore,tlsSigner}=require('../src/device-commands');
const {NethraStore}=require('../src/nethra-store');
const {NethraApi}=require('../src/nethra-api');
const {allowedSerial}=require('../scripts/junction-ops.cjs');

const tls=(()=>{const generated=selfsigned.generate([{name:'commonName',value:'Junction LAN'}],{keySize:2048,days:1,algorithm:'sha256'});return {key:generated.private,certificate:generated.cert};})();
function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'device-commands-'));let now=1_800_000_000_000;
  const stores=[];const open=(options={})=>{const store=new DeviceCommandStore(directory,{now:()=>now,...options});stores.push(store);return store;};
  t.after(()=>{for(const store of stores)store.close();fs.rmSync(directory,{recursive:true,force:true});});
  return {directory,open,signer:tlsSigner(tls,'instance-1'),advance:ms=>now+=ms,now:()=>now};
}
// Mirrors the phone: pin check, signature, expiry and single use.
function verify(envelope,pin,seen,now){
  const spki=Buffer.from(envelope.spki,'base64');
  if(crypto.createHash('sha256').update(spki).digest('hex')!==pin)return 'pin';
  const key=crypto.createPublicKey({key:spki,format:'der',type:'spki'});
  if(!crypto.verify('sha256',Buffer.from(envelope.body,'utf8'),key,Buffer.from(envelope.signature,'base64')))return 'signature';
  const body=JSON.parse(envelope.body);if(body.expiresAt<=now)return 'expired';if(seen.has(body.id))return 'replay';seen.add(body.id);return body;
}

test('commands queued without a key are signed by the host and verify against the pinned SPKI',t=>{
  const f=fixture(t),cli=f.open(),host=f.open({signer:f.signer});
  const command=cli.enqueue({kind:'STATUS',requestedBy:'claude',requestId:'r1'});
  assert.throws(()=>cli.pull('phone'),/Junction host/);
  const [envelope]=host.pull('phone');
  const body=verify(envelope,f.signer.fingerprint,new Set(),f.now());
  assert.equal(body.id,command.id);assert.equal(body.kind,'STATUS');assert.equal(body.deviceId,'phone');assert.equal(body.instanceId,'instance-1');
  const tampered={...envelope,body:envelope.body.replace('STATUS','SMOKE_TEST')};
  assert.equal(verify(tampered,f.signer.fingerprint,new Set(),f.now()),'signature');
  assert.equal(verify(envelope,'0'.repeat(64),new Set(),f.now()),'pin');
});

test('enqueue is idempotent per request and rejects unknown kinds, arguments and requesters',t=>{
  const f=fixture(t),store=f.open();
  const a=store.enqueue({kind:'COLLECT_LOGS',args:{lines:50},requestedBy:'codex',requestId:'same'});
  assert.equal(store.enqueue({kind:'COLLECT_LOGS',args:{lines:50},requestedBy:'codex',requestId:'same'}).id,a.id);
  assert.throws(()=>store.enqueue({kind:'COLLECT_LOGS',args:{lines:60},requestedBy:'codex',requestId:'same'}),/mismatch/);
  assert.throws(()=>store.enqueue({kind:'SHELL',requestedBy:'owner',requestId:'x'}),/Unsupported/);
  assert.throws(()=>store.enqueue({kind:'COLLECT_LOGS',args:{lines:5000},requestedBy:'owner',requestId:'y'}),/lines/);
  assert.throws(()=>store.enqueue({kind:'STATUS',args:{path:'/'},requestedBy:'owner',requestId:'z'}),/path/);
  assert.throws(()=>store.enqueue({kind:'STATUS',requestedBy:'stranger',requestId:'w'}),/requester/);
  assert.throws(()=>store.enqueue({kind:'CONFIRM_INSTALL',args:{versionCode:5},requestedBy:'owner',requestId:'v'}),/Missing/);
});

test('delivery is bound to one device, redelivered unchanged after silence, and results are final',t=>{
  const f=fixture(t),store=f.open({signer:f.signer});
  const command=store.enqueue({kind:'SMOKE_TEST',requestedBy:'owner',requestId:'r'});
  const [first]=store.pull('phone');
  assert.deepEqual(store.pull('phone'),[]);assert.deepEqual(store.pull('tablet'),[]);
  f.advance(121_000);
  const [again]=store.pull('phone');assert.deepEqual(again,first);
  assert.throws(()=>store.result('tablet',{id:command.id,state:'SUCCEEDED'}),/not delivered/);
  store.result('phone',{id:command.id,state:'SUCCEEDED',result:{checks:3}});
  assert.equal(store.result('phone',{id:command.id,state:'SUCCEEDED'}).result.checks,3);
  assert.throws(()=>store.result('phone',{id:command.id,state:'FAILED'}),/finished/);
  const other=store.enqueue({kind:'STATUS',requestedBy:'owner',requestId:'r2'});store.pull('phone');
  assert.throws(()=>store.result('phone',{id:other.id,state:'SUCCEEDED',result:'x'.repeat(20_000)}),/too large/);
});

test('expired commands are never delivered and survive reopen as EXPIRED',t=>{
  const f=fixture(t),store=f.open({signer:f.signer});
  const command=store.enqueue({kind:'STATUS',requestedBy:'owner',requestId:'old',ttlMs:60_000});
  f.advance(60_000);
  assert.deepEqual(store.pull('phone'),[]);
  assert.equal(f.open().get(command.id).state,'EXPIRED');
});

test('the phone can only pull and report; issuing commands is a Windows operation',async t=>{
  const f=fixture(t),dir=fs.mkdtempSync(path.join(os.tmpdir(),'device-api-')),nethra=new NethraStore(dir);
  t.after(()=>{nethra.close();fs.rmSync(dir,{recursive:true,force:true});});
  const api=new NethraApi({store:nethra,runtime:{},deviceCommands:f.open({signer:f.signer})});
  await assert.rejects(api.dispatch('nethra.device.enqueue',{kind:'STATUS'},'phone-req','android'),/Windows host/);
  const {command}=await api.dispatch('nethra.device.enqueue',{kind:'STATUS',requestedBy:'nethra'},'desk-req');
  await assert.rejects(api.dispatch('nethra.device.pull',{deviceId:'bad device!'},'p0','android'),/Invalid device/);
  const {commands}=await api.dispatch('nethra.device.pull',{deviceId:'phone-1'},'p1','android');
  assert.equal(JSON.parse(commands[0].body).id,command.id);
  assert.equal((await api.dispatch('nethra.device.result',{deviceId:'phone-1',id:command.id,state:'SUCCEEDED',result:{ok:true}},'p2','android')).state,'SUCCEEDED');
  assert.equal((await api.dispatch('nethra.device.list',{})).commands[0].state,'SUCCEEDED');
});

test('ADB targets are limited to USB serials and Tailscale addresses',()=>{
  assert.equal(allowedSerial('R58R12ABCDE'),true);
  assert.equal(allowedSerial('100.101.5.9:5555'),true);
  assert.equal(allowedSerial('10.164.57.104:5555'),false);
  assert.equal(allowedSerial('192.168.1.20:5555'),false);
  assert.equal(allowedSerial('100.128.0.1:5555'),false);
  assert.equal(allowedSerial('adb-R58R-xyz._adb-tls-connect._tcp'),false);
});

test('Nethra can request read-only phone checks whose results wake the objective',async t=>{
  const f=fixture(t),dir=fs.mkdtempSync(path.join(os.tmpdir(),'device-tools-')),nethra=new NethraStore(dir,{now:f.now});
  t.after(()=>{nethra.close();fs.rmSync(dir,{recursive:true,force:true});});
  const {NethraTools}=require('../src/nethra-tools');
  const devices=f.open({signer:f.signer}),tools=new NethraTools({store:nethra,deviceCommands:devices});
  const task=nethra.create({goal:'Check the phone build'}),other=nethra.create({goal:'Unrelated'});
  nethra.update(task.id,{status:'SLEEPING',nextWakeAt:f.now()+86_400_000});
  assert.throws(()=>tools.validate('phone_check',{kind:'CONFIRM_INSTALL'}),/unsupported value/);
  assert.throws(()=>devices.enqueue({kind:'CONFIRM_INSTALL',args:{versionCode:1,sha256:'a'.repeat(64),sizeBytes:1},requestedBy:'nethra',requestId:'x'}),/read-only/);
  const live=nethra.get(task.id);
  const first=await tools.execute('phone_check',{kind:'SMOKE_TEST'},live);
  assert.equal((await tools.execute('phone_check',{kind:'SMOKE_TEST'},live)).id,first.id);
  const api=new NethraApi({store:nethra,runtime:{},deviceCommands:devices});
  await api.dispatch('nethra.device.pull',{deviceId:'phone-1'},'pull','android');
  await api.dispatch('nethra.device.result',{deviceId:'phone-1',id:first.id,state:'SUCCEEDED',result:{passed:true}},'result','android');
  const woken=nethra.get(task.id);
  assert.equal(woken.nextWakeAt,f.now());
  assert.equal(nethra.attention(task.id).at(-1).evidenceRef,`device:${first.id}`);
  const read=await tools.execute('phone_result',{id:first.id},nethra.get(task.id));
  assert.equal(read.state,'SUCCEEDED');assert.match(read.untrustedResult,/passed/);
  await assert.rejects(tools.execute('phone_result',{id:first.id},nethra.get(other.id)),/another objective/);
});
