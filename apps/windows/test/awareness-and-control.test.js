'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {NethraStore}=require('../src/nethra-store');
const {NethraApi}=require('../src/nethra-api');
const {handleNethraChat,parseNethraChat,resolveObjective}=require('../src/nethra-chat');
const {situationContext,sanitizeSession}=require('../src/assistant-environment');
const {PresenceTracker}=require('../src/presence');
const {AppearanceStore,APPEARANCE_DEFAULTS}=require('../src/appearance-store');

function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-control-'));const store=new NethraStore(dir);
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  return {dir,store,api:new NethraApi({store,runtime:{modelCapabilities:async()=>({})}})};
}

test('first-person task and schedule questions inspect host objectives rather than public search', () => {
  for (const question of ['What are you working on?', 'What tasks do you have scheduled?', 'Show my scheduled tasks', 'What are your current objectives?']) {
    assert.equal(parseNethraChat(question)?.action, 'list', question);
  }
  assert.equal(parseNethraChat('What is the current train schedule?'), null);
});

test('"continue that task" resolves the objective linked to this conversation',async t=>{
  const {store,api}=fixture(t);
  const mine=store.create({goal:'Track rail strike dates',conversationId:'chat-a',mode:'ONGOING'});store.create({goal:'Research bike locks',conversationId:'chat-b'});
  store.control(mine.id,'pause',store.get(mine.id).revision,'p1');
  const reply=await handleNethraChat({api,content:'continue that task',conversationId:'chat-a',requestId:'r1'});
  assert.match(reply,/Resumed “Track rail strike dates”/);
  assert.notEqual(store.get(mine.id).status,'PAUSED');
});

test('an ambiguous reference asks one question listing the candidates instead of guessing',async t=>{
  const {store,api}=fixture(t);
  store.create({goal:'Track rail strike dates'});store.create({goal:'Research bike locks'});
  const reply=await handleNethraChat({api,content:'pause that task',conversationId:'chat-z',requestId:'r2'});
  assert.match(reply,/Which task do you mean\?/);assert.match(reply,/rail strike/);assert.match(reply,/bike locks/);
  assert.ok(store.list().every(task=>task.status!=='PAUSED'),'nothing changed while ambiguous');
  const named=await handleNethraChat({api,content:'pause the bike locks task',conversationId:'chat-z',requestId:'r3'});
  assert.match(named,/Paused “Research bike locks”/);
});

test('"stop" pauses (reversible); only an explicit cancel ends an objective',async t=>{
  assert.equal(parseNethraChat('stop that task').command,'pause');
  assert.equal(parseNethraChat('cancel that task').command,'cancel');
  assert.equal(parseNethraChat('stop'),null);
  assert.equal(parseNethraChat('check the weather'),null);
  assert.equal(parseNethraChat('How is it going?'),null);
  assert.equal(parseNethraChat('check that task now').command,'wake');
  assert.equal(parseNethraChat('redirect that task to focus on official sources').direction,'focus on official sources');
});

test('continuing a sleeping objective checks it now; one waiting for the owner explains what it needs',async t=>{
  const {store,api}=fixture(t);
  const sleeping=store.create({goal:'Watch ferry timetables',conversationId:'chat-a'});store.update(sleeping.id,{status:'SLEEPING',nextWakeAt:Date.now()+86_400_000},'SETUP');
  assert.match(await handleNethraChat({api,content:'continue that task',conversationId:'chat-a',requestId:'w1'}),/Checking “Watch ferry timetables” now/);
  assert.ok(store.get(sleeping.id).nextWakeAt<=Date.now());
  const waiting=store.create({goal:'Plan a weekend trip',conversationId:'chat-b'});store.update(waiting.id,{status:'WAITING_FOR_USER',summary:'Which weekend works for you?'},'SETUP');
  const reply=await handleNethraChat({api,content:'carry on with that task',conversationId:'chat-b',requestId:'w2'});
  assert.match(reply,/Which weekend works for you\?/);assert.match(reply,/redirect that task/);
});

test('redirecting from chat keeps the objective and records the new direction',async t=>{
  const {store,api}=fixture(t);const task=store.create({goal:'Compare broadband deals',conversationId:'chat-a'});
  const reply=await handleNethraChat({api,content:'redirect that task to only include fibre providers',conversationId:'chat-a',requestId:'d1'});
  assert.match(reply,/Redirected/);assert.equal(store.get(task.id).ownerInputs.at(-1).text,'only include fibre providers');
});

test('resolution prefers a topic match, then the linked objective, then the only open one',()=>{
  const objectives=[{id:'1',goal:'Track rail strikes',status:'SLEEPING',conversationId:'a'},{id:'2',goal:'Research bike locks',status:'ACTIVE',conversationId:'b'}];
  assert.equal(resolveObjective(objectives,'b','').task.id,'2');
  assert.equal(resolveObjective(objectives,'z','rail').task.id,'1');
  assert.equal(resolveObjective(objectives,'z','').choices.length,2);
  assert.equal(resolveObjective([objectives[0]],'z','').task.id,'1');
  assert.ok(resolveObjective([],'z','').none);
});

test('situation distinguishes access, a timestamped check, staleness and unavailability',()=>{
  const now=Date.UTC(2026,9,24,17,0);
  const text=situationContext({surface:'android-relay',now,timeZone:'Europe/London',sources:{calendar:{status:'CONNECTED',lastSyncAt:now-600_000},gmail:{status:'STALE',lastSyncAt:now-7_200_000}},presence:{phone:{state:'stale',ageMs:3*3_600_000,via:'relay'}},capabilities:['web_search','list_objectives'],objectives:[]});
  assert.match(text,/Europe\/London/);assert.match(text,/18:00/);
  assert.match(text,/encrypted relay/);
  assert.match(text,/Google Calendar connected \(read-only\), last checked by the host .*10 min ago/);
  assert.match(text,/Gmail headers connected but its last check is stale/);
  assert.match(text,/last reached this PC 3 h ago via the relay \(stale; it may be offline\)/);
  assert.match(text,/Nothing on the PC can send email/);
  assert.match(text,/connected but unchecked, or unavailable/);
  assert.ok(text.length<=2400);
  const never=situationContext({surface:'desktop',now,timeZone:'UTC',sources:{},presence:{phone:{state:'not_seen_since_start'}}});
  assert.match(never,/Google Calendar disconnected, unavailable to you/);assert.match(never,/state is unknown/);
});

test('voice session state is per turn: active calls say so, text chat says it is not speaking',()=>{
  const voice=situationContext({surface:'android-lan',session:sanitizeSession({mode:'voice',voiceActive:true,input:'spoken',spokenOutput:true,sessionId:'call_7',elapsedMs:125_000,callState:'active'})});
  assert.match(voice,/Voice call active .*session call_7, 2:05 elapsed/);assert.match(voice,/will be spoken aloud/);
  const text=situationContext({surface:'android-lan',session:sanitizeSession({mode:'text',voiceActive:false,input:'typed'})});
  assert.match(text,/No voice call is active; this is text chat\. Do not say you are speaking/);
  assert.equal(sanitizeSession({mode:'karaoke'}),null);
  assert.equal(sanitizeSession({mode:'voice',sessionId:'../../x',elapsedMs:-5}).sessionId,null);
  assert.match(situationContext({surface:'android-lan'}),/did not report call state/);
});

test('presence reports a live LAN socket, recent and stale contact honestly',()=>{
  let now=1_000_000,live=0;const presence=new PresenceTracker({now:()=>now,lanClients:()=>live});
  assert.equal(presence.snapshot().phone.state,'not_seen_since_start');
  presence.seen('relay');now+=60_000;assert.equal(presence.snapshot().phone.state,'recent');
  now+=3_600_000;assert.equal(presence.snapshot().phone.state,'stale');
  live=1;assert.equal(presence.snapshot().phone.state,'connected');
  presence.seen('telepathy');assert.equal(presence.snapshot().phone.via,'relay');
});

test('appearance settings persist, validate and survive a damaged file',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'appearance-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'appearance.json'),store=new AppearanceStore(file);
  assert.deepEqual(store.get(),APPEARANCE_DEFAULTS);
  store.set({artwork:'sakura-mountain',palette:'sakura',motion:'reduced',petalIntensity:20});
  const reopened=new AppearanceStore(file).get();
  assert.equal(reopened.artwork,'sakura-mountain');assert.equal(reopened.motion,'reduced');assert.equal(reopened.petalIntensity,20);assert.equal(reopened.mode,'system');
  assert.throws(()=>store.set({palette:'neon'}),/palette/);assert.throws(()=>store.set({backgroundIntensity:140}),/backgroundIntensity/);assert.throws(()=>store.set({blink:true}),/Unknown/);
  fs.writeFileSync(file,'{not json');assert.deepEqual(new AppearanceStore(file).get(),APPEARANCE_DEFAULTS);
});

test('the renderer petal layer honours reduced motion and stops when hidden',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../renderer/appearance.js'),'utf8');
  assert.match(source,/prefers-reduced-motion: reduce/);
  assert.match(source,/visibilityState==="visible"/);
  assert.match(source,/settings\.motion==="full"\|\|\(settings\.motion==="system"&&!reducedQuery\.matches\)/);
  assert.match(source,/cancelAnimationFrame/);
});
