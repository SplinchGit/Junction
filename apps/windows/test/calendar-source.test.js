'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {CalendarSource,SecretVault,CALENDAR_SCOPE}=require('../src/calendar-source');
const {NethraStore}=require('../src/nethra-store');
const {NethraAttention}=require('../src/nethra-attention');
const {NethraApi}=require('../src/nethra-api');
const {NethraTools}=require('../src/nethra-tools');

// Reversible stand-in for DPAPI so tests can prove nothing is stored in plain text.
const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).map(byte=>byte^0x5a),decryptString:value=>Buffer.from(value).map(byte=>byte^0x5a).toString()};
const json=(body,status=200)=>({ok:status<300,status,json:async()=>body});
const event=(id,etag,start,extra={})=>({id,etag,status:'confirmed',summary:`Event ${id}`,start:{dateTime:start},end:{dateTime:start},description:'private notes',attendees:[{email:'friend@example.com'}],...extra});

function fixture(t,{scope=CALENDAR_SCOPE,refresh='refresh-secret'}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'calendar-source-'));let now=1_800_000_000_000;
  const store=new NethraStore(path.join(dir,'nethra'),{now:()=>now});
  const google={events:[],requests:[],revoked:[],tokenError:null};
  const fetchImpl=async(url,options={})=>{
    const target=String(url);google.requests.push({url:target,options});
    if(target.startsWith('https://oauth2.googleapis.com/token')){
      if(google.tokenError)return json({error:google.tokenError},400);
      const form=new URLSearchParams(options.body);
      return json({access_token:`access-${google.requests.length}`,expires_in:3600,scope,...(form.get('grant_type')==='authorization_code'&&refresh?{refresh_token:refresh}:{}),pkce:form.get('code_verifier')});
    }
    if(target.startsWith('https://oauth2.googleapis.com/revoke')){google.revoked.push(target);return json({});}
    if(target.startsWith('https://www.googleapis.com/calendar/v3/'))return json({items:google.events});
    throw new Error(`unexpected ${target}`);
  };
  // Plays the owner's browser: follows the consent URL straight to the loopback callback.
  const openExternal=async consent=>{
    google.consent=new URL(consent);
    const redirect=google.consent.searchParams.get('redirect_uri'),state=google.state??google.consent.searchParams.get('state');
    setImmediate(()=>fetch(`${redirect}?code=auth-code&state=${state}`).catch(()=>{}));
  };
  const source=new CalendarSource({vault:new SecretVault(path.join(dir,'sources'),safeStorage),store,attention:new NethraAttention(store,{now:()=>now}),fetchImpl,openExternal,now:()=>now,pollMs:600_000});
  t.after(()=>{source.stop();store.close();fs.rmSync(dir,{recursive:true,force:true});});
  return {dir,store,source,google,advance:ms=>now+=ms,now:()=>now};
}
const clientId='1234-abc.apps.googleusercontent.com';

test('connect uses PKCE, asks only for calendar.readonly, encrypts the grant and baselines silently',async t=>{
  const f=fixture(t);
  const watcher=f.store.create({goal:'Watch my week',sources:['calendar']});
  f.google.events=[event('a','e1',new Date(f.now()+86_400_000).toISOString())];
  const status=await f.source.connect({clientId,clientSecret:'desktop-secret'});
  f.source.stop();
  assert.equal(status.status,'CONNECTED');
  assert.equal(f.google.consent.searchParams.get('scope'),CALENDAR_SCOPE);
  assert.equal(f.google.consent.searchParams.get('code_challenge_method'),'S256');
  assert.match(f.google.consent.searchParams.get('redirect_uri'),/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  const exchange=f.google.requests.find(r=>new URLSearchParams(r.options.body||'').get('grant_type')==='authorization_code');
  assert.ok(new URLSearchParams(exchange.options.body).get('code_verifier').length>=43);
  const stored=fs.readFileSync(path.join(f.dir,'sources','calendar-grant.bin'),'utf8');
  assert.equal(stored.includes('refresh-secret'),false);assert.equal(Buffer.from(stored,'base64').toString().includes('refresh-secret'),false);
  assert.equal(f.store.attention(watcher.id).length,0);
});

test('changed, added and cancelled events become deduplicated attention only for watching objectives',async t=>{
  const f=fixture(t),day=86_400_000;
  const watcher=f.store.create({goal:'Watch deadlines',sources:['calendar']}),other=f.store.create({goal:'Unrelated'});
  f.store.update(watcher.id,{status:'SLEEPING',nextWakeAt:f.now()+7*day});
  f.google.events=[event('a','e1',new Date(f.now()+day).toISOString()),event('b','e1',new Date(f.now()+2*day).toISOString())];
  await f.source.connect({clientId});f.source.stop();
  f.advance(600_000);
  f.google.events=[event('a','e2',new Date(f.now()+day).toISOString()),event('c','e1',new Date(f.now()+3*day).toISOString())];
  const result=await f.source.sync();
  assert.deepEqual([result.changes,result.observed],[3,3]);
  const kinds=f.store.attention(watcher.id).map(item=>`${item.kind}:${item.sourceId}`).sort();
  assert.deepEqual(kinds,['SOURCE_ADDED:c','SOURCE_CHANGED:a','SOURCE_REMOVED:b']);
  assert.equal(f.store.attention(other.id).length,0);
  assert.equal(f.store.get(watcher.id).nextWakeAt,f.now());
  f.advance(600_000);
  assert.equal((await f.source.sync()).observed,0);
});

test('the model reads only compact event fields, and only for an objective that watches the calendar',async t=>{
  const f=fixture(t);
  const watcher=f.store.create({goal:'Plan around meetings',sources:['calendar']}),other=f.store.create({goal:'No calendar'});
  f.google.events=[event('a','e1',new Date(f.now()+3_600_000).toISOString())];
  await f.source.connect({clientId});f.source.stop();
  const tools=new NethraTools({store:f.store,calendar:f.source});
  const read=await tools.execute('calendar_event',{id:'a'},f.store.get(watcher.id));
  assert.equal(read.untrustedEvent.summary,'Event a');
  assert.equal(JSON.stringify(read).includes('private notes'),false);assert.equal(JSON.stringify(read).includes('friend@example.com'),false);
  await assert.rejects(tools.execute('calendar_event',{id:'a'},f.store.get(other.id)),/does not watch/);
});

test('a refused scope is revoked and nothing is stored',async t=>{
  const f=fixture(t,{scope:'openid'});
  await assert.rejects(f.source.connect({clientId}),/not granted/);
  assert.equal(f.google.revoked.length,1);
  assert.equal(f.source.status().status,'DISCONNECTED');
});

test('a forged consent callback is rejected',async t=>{
  const f=fixture(t);f.google.state='forged';
  await assert.rejects(f.source.connect({clientId}),/state mismatch/);
  assert.equal(f.source.status().status,'DISCONNECTED');
});

test('revoked access reports ERROR, and missed polls report STALE rather than connected',async t=>{
  const f=fixture(t);
  await f.source.connect({clientId});f.source.stop();
  f.advance(4*600_000);
  assert.equal(f.source.status().status,'STALE');
  f.source.access=null;f.google.tokenError='invalid_grant';
  await assert.rejects(f.source.sync());
  const status=f.source.status();
  assert.equal(status.status,'ERROR');assert.match(status.error,/reconnect/i);
  assert.equal(f.source.timer,null);
});

test('connecting is a Windows-only operation and status is reported honestly to the phone',async t=>{
  const f=fixture(t),api=new NethraApi({store:f.store,runtime:{modelCapabilities:async()=>({})},calendar:f.source});
  await assert.rejects(api.dispatch('nethra.source.calendar',{action:'connect',clientId},'c','android'),/Windows host/);
  assert.equal((await api.dispatch('nethra.status',{},'s','android')).sources.calendar.status,'DISCONNECTED');
  await assert.rejects(api.dispatch('nethra.create',{goal:'x',sources:['outlook']},'bad'),/sources/);
  const {task}=await api.dispatch('nethra.create',{goal:'Watch',sources:['calendar']},'ok','android');
  assert.deepEqual(task.sources,['calendar']);
  const changed=await api.dispatch('nethra.configure',{id:task.id,revision:task.revision,sources:[]},'cfg','android');
  assert.deepEqual(changed.task.sources,[]);
});
