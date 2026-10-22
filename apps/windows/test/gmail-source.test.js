'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {GmailSource,GMAIL_SCOPE}=require('../src/gmail-source');
const {CalendarSource,SecretVault,CALENDAR_SCOPE}=require('../src/calendar-source');
const {NethraStore}=require('../src/nethra-store');
const {NethraAttention}=require('../src/nethra-attention');
const {NethraTools}=require('../src/nethra-tools');

const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).map(byte=>byte^0x5a),decryptString:value=>Buffer.from(value).map(byte=>byte^0x5a).toString()};
const json=(body,status=200)=>({ok:status<300,status,json:async()=>body});
const clientId='1234-abc.apps.googleusercontent.com';
const added=(id,labels=['INBOX','UNREAD'])=>({messagesAdded:[{message:{id,threadId:`t-${id}`,labelIds:labels}}]});

function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gmail-source-'));let now=1_800_000_000_000;
  const store=new NethraStore(path.join(dir,'nethra'),{now:()=>now});
  const google={profileHistoryId:'100',history:[],historyId:'100',historyStatus:200,requests:[],revoked:[],scopes:{}};
  const fetchImpl=async(url,options={})=>{
    const target=String(url);google.requests.push(target);
    if(target.startsWith('https://oauth2.googleapis.com/token')){
      const form=new URLSearchParams(options.body),code=form.get('code');
      return json({access_token:'access',expires_in:3600,scope:google.scopes[code]||GMAIL_SCOPE,...(form.get('grant_type')==='authorization_code'?{refresh_token:`refresh-${code}`}:{})});
    }
    if(target.startsWith('https://oauth2.googleapis.com/revoke')){google.revoked.push(target);return json({});}
    if(target.endsWith('/users/me/profile'))return json({historyId:google.profileHistoryId});
    if(target.includes('/users/me/history?'))return google.historyStatus===200?json({history:google.history,historyId:google.historyId}):json({error:{message:'Requested entity was not found.'}},google.historyStatus);
    const message=target.match(/\/users\/me\/messages\/([^?]+)\?/);
    if(message)return json({id:message[1],threadId:`t-${message[1]}`,labelIds:['INBOX'],internalDate:String(now),payload:{headers:[{name:'From',value:'Tutor <tutor@uni.example>'},{name:'Subject',value:`Deadline moved ${message[1]}`},{name:'Date',value:'Thu, 22 Oct 2026 21:00:00 +0100'}]}});
    if(target.startsWith('https://www.googleapis.com/calendar/v3/'))return json({items:[]});
    throw new Error(`unexpected ${target}`);
  };
  let nextCode='gmail-code';
  const openExternal=async consent=>{const url=new URL(consent);google.consent=url;setImmediate(()=>fetch(`${url.searchParams.get('redirect_uri')}?code=${nextCode}&state=${url.searchParams.get('state')}`).catch(()=>{}));};
  const options={vault:new SecretVault(path.join(dir,'sources'),safeStorage),store,attention:new NethraAttention(store,{now:()=>now}),fetchImpl,openExternal,now:()=>now,pollMs:600_000};
  const gmail=new GmailSource(options),calendar=new CalendarSource(options);
  t.after(()=>{gmail.stop();calendar.stop();store.close();fs.rmSync(dir,{recursive:true,force:true});});
  return {store,gmail,calendar,google,advance:ms=>now+=ms,setCode:code=>{nextCode=code;}};
}

test('connect asks only for gmail.metadata and baselines from the mailbox history without attention',async t=>{
  const f=fixture(t),watcher=f.store.create({goal:'Watch for tutor replies',sources:['gmail']});
  const status=await f.gmail.connect({clientId});f.gmail.stop();
  assert.equal(f.google.consent.searchParams.get('scope'),GMAIL_SCOPE);
  assert.equal(status.status,'CONNECTED');assert.match(status.scope,/no message bodies/);
  assert.equal(f.gmail.state().historyId,'100');
  assert.equal(f.store.attention(watcher.id).length,0);
});

test('new inbox mail wakes watching objectives once; spam and promotions are ignored',async t=>{
  const f=fixture(t),watcher=f.store.create({goal:'Watch for tutor replies',sources:['gmail']}),other=f.store.create({goal:'Calendar only',sources:['calendar']});
  f.store.update(watcher.id,{status:'SLEEPING',nextWakeAt:f.advance(0)+86_400_000});
  await f.gmail.connect({clientId});f.gmail.stop();
  f.advance(600_000);
  f.google.history=[added('m1'),added('m1'),added('spam1',['SPAM']),added('promo1',['INBOX','CATEGORY_PROMOTIONS']),added('m2')];f.google.historyId='120';
  const result=await f.gmail.sync();
  assert.deepEqual([result.changes,result.observed],[2,2]);
  assert.deepEqual(f.store.attention(watcher.id).map(item=>`${item.source}:${item.kind}:${item.sourceId}`).sort(),['gmail:SOURCE_ADDED:m1','gmail:SOURCE_ADDED:m2']);
  assert.equal(f.store.attention(other.id).length,0);
  assert.equal(f.gmail.state().historyId,'120');
  // Only metadata is ever requested.
  assert.ok(f.google.requests.filter(url=>url.includes('/messages/')).every(url=>url.includes('format=metadata')));
  f.advance(600_000);
  assert.equal((await f.gmail.sync()).observed,0);
});

test('an expired history cursor re-baselines silently instead of replaying the inbox',async t=>{
  const f=fixture(t),watcher=f.store.create({goal:'Watch mail',sources:['gmail']});
  await f.gmail.connect({clientId});f.gmail.stop();
  f.google.historyStatus=404;f.google.profileHistoryId='900';
  const result=await f.gmail.sync();
  assert.equal(result.baseline,true);assert.equal(f.gmail.state().historyId,'900');
  assert.equal(f.store.attention(watcher.id).length,0);
  assert.equal(f.gmail.status().status,'CONNECTED');
});

test('the model reads headers only, and only for an objective that watches Gmail',async t=>{
  const f=fixture(t),watcher=f.store.create({goal:'Watch mail',sources:['gmail']}),other=f.store.create({goal:'No mail'});
  await f.gmail.connect({clientId});f.gmail.stop();
  f.google.history=[added('m9')];f.google.historyId='130';await f.gmail.sync();
  const tools=new NethraTools({store:f.store,gmail:f.gmail});
  const read=await tools.execute('gmail_message',{id:'m9'},f.store.get(watcher.id));
  assert.equal(read.bodyAvailable,false);assert.equal(read.untrustedHeaders.subject,'Deadline moved m9');
  assert.deepEqual(Object.keys(read.untrustedHeaders).sort(),['date','from','id','labels','receivedAt','subject','threadId']);
  await assert.rejects(tools.execute('gmail_message',{id:'m9'},f.store.get(other.id)),/does not watch Gmail/);
});

test('Gmail and Calendar hold independent grants; disconnecting one leaves the other',async t=>{
  const f=fixture(t);
  f.setCode('calendar-code');f.google.scopes['calendar-code']=CALENDAR_SCOPE;await f.calendar.connect({clientId});f.calendar.stop();
  f.setCode('gmail-code');await f.gmail.connect({clientId});f.gmail.stop();
  assert.equal(f.calendar.grant().refreshToken,'refresh-calendar-code');assert.equal(f.gmail.grant().refreshToken,'refresh-gmail-code');
  await f.gmail.disconnect();
  assert.equal(f.gmail.status().status,'DISCONNECTED');assert.equal(f.calendar.status().status,'CONNECTED');
  assert.ok(f.google.revoked.some(url=>url.includes('refresh-gmail-code')));
  assert.equal(f.google.revoked.some(url=>url.includes('refresh-calendar-code')),false);
});
