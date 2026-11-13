'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {NethraStore}=require('../src/nethra-store');
const {runCoordination}=require('../src/nethra-coordination');

test('coordination saves independent advice, retries only the missing advisor and waits for owner approval',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-coordination-'));
 let now=Date.now();
 const store=new NethraStore(dir,{now:()=>now});
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 let task=store.create({goal:'Self Improvement',allowCodeWork:true,conversationId:'self-improvement'});
 task=store.configure(task.id,{coordinateSelfImprovement:true},task.revision,'enable');
 const calls=[];
 let waiting=true;
 const tools={async execute(name){
   calls.push(name);
   if(name==='consult_codex'&&waiting)throw Object.assign(new Error('Weekly limit'),{retryAt:now+3600_000});
   if(name==='propose_code_work')return {workId:'draft-1',status:'DRAFT'};
   return {advice:'Friction: unclear status. Improvement: show the next action. Test: Verify Pause stops the same job before another dispatch.'};
 },workStatus:()=>({status:'DRAFT',nextAction:'Waiting for your Start'})};
 const run=async()=>{
   const claim=store.claim('test');
   assert.ok(claim);
   try{return await runCoordination(claim.task,{store,tools,token:claim.token,now:()=>now});}
   finally{store.release(claim.task.id,claim.token);}
 };
 await run();
 task=store.get(task.id);
 assert.equal(task.status,'SLEEPING');
 assert.equal(task.nextWakeAt,now+3660_000);
 assert.equal(task.coordination.advisors.claude.status,'completed');
 assert.deepEqual(calls,['consult_codex','consult_claude']);
 waiting=false;now=task.nextWakeAt;
 await run();
 task=store.get(task.id);
 assert.equal(task.status,'WAITING_FOR_USER');
 assert.match(task.questions.at(-1).question,/Codex:.*Claude:/s);
 assert.deepEqual(calls,['consult_codex','consult_claude','consult_codex']);
 store.answer(task.id,'approve pilot',task.revision,'approved',task.coordination.questionId);
 await run();
 task=store.get(task.id);
 assert.equal(task.coordination.workId,'draft-1');
 assert.match(task.summary,/Start it in Work Activity/);
 assert.equal(calls.at(-1),'propose_code_work');
});

test('the owner chooses an actual advisor proposal and both advisors receive the saved brief',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-coordination-'));
 const store=new NethraStore(dir);
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 let task=store.create({goal:'Self Improvement',allowCodeWork:true,conversationId:'self-improvement'});
 store.note(task.id,'GPT brief: Make voice interruption reliable.');
 task=store.get(task.id);
 store.configure(task.id,{coordinateSelfImprovement:true},task.revision,'enable');
 const questions=[];let proposed;
 const tools={async execute(name,args){
   if(name==='propose_code_work'){proposed=args;return {workId:'voice-work'};}
   questions.push(args.question);
   return {advice:name==='consult_codex'?'Friction: delayed interruption.\nImprovement: Cancel speech on interruption.\nTest: Verify interruption stops playback within 500 milliseconds.':'Friction: stale status.\nImprovement: Show call state.\nTest: Verify the call state becomes idle after call teardown.'};
 },workStatus:()=>({status:'DRAFT',nextAction:'Waiting for Start'})};
 const run=async()=>{const claim=store.claim('test');assert.ok(claim);try{await runCoordination(claim.task,{store,tools,token:claim.token});}finally{store.release(claim.task.id,claim.token);}};
 await run();task=store.get(task.id);
 assert.equal(questions.length,2);assert.equal(questions[0],questions[1]);
 assert.match(questions[0],/Make voice interruption reliable/);
 assert.match(task.summary,/different proposals/i);
 store.chatTurn(task.id,"Approve the Claude pilot. Generally we'll prefer Claude's work. Thanks Nethra",'choose',{conversationId:task.conversationId,questionId:task.coordination.questionId});
 await run();
 assert.deepEqual(proposed,{task:'Show call state.',acceptance:'Verify the call state becomes idle after call teardown.'});
 assert.equal(store.get(task.id).coordination.workId,'voice-work');
 assert.equal(questions.length,2,'an approval must reuse the saved consultations');
});

test('pilot approval accepts a simple typo and rejects a conditional or negative instruction',()=>{
 const {pilotChoice}=require('../src/nethra-coordination');
 assert.equal(pilotChoice('Aprove codex pilot'),'codex');
 assert.equal(pilotChoice('Approve the Claude pilot, please.'),'claude');
 assert.equal(pilotChoice('Approve codex pilot only if it changes the scope.'),null);
 assert.equal(pilotChoice('Approve codex pilot. Wait for me before drafting.'),null);
 assert.equal(pilotChoice('Do not approve codex pilot.'),null);
 assert.equal(pilotChoice('Approve codex pilot?'),null);
});

test('a review requesting revision cannot loop through the same approved draft',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-coordination-'));
 const store=new NethraStore(dir);
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 let task=store.create({goal:'Self Improvement',allowCodeWork:true,conversationId:'self-improvement'});
 store.configure(task.id,{coordinateSelfImprovement:true},task.revision,'enable');
 let reviews=0;
 const tools={async execute(name){
  if(name==='propose_code_work'){reviews++;return {review:'VERDICT: REVISE Specify which receipt proves success.'};}
  return {advice:'Friction: Unclear status.\nImprovement: Show the active engineer.\nTest: Confirm the active engineer matches the current Foreman attempt.'};
 }};
 const run=async()=>{const claim=store.claim('test');try{await runCoordination(claim.task,{store,tools,token:claim.token});}finally{store.release(claim.task.id,claim.token);}};
 await run();task=store.get(task.id);
 store.answer(task.id,'approve pilot',task.revision,'approve',task.coordination.questionId);
 await run();task=store.get(task.id);
 assert.equal(task.coordination.stage,'revision_needed');
 assert.doesNotMatch(task.summary,/approve pilot/i);
 store.answer(task.id,'approve pilot',task.revision,'retry',task.coordination.questionId);
 await run();
 assert.equal(reviews,1);
});

test('an uncertain advisor call asks before retrying',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-coordination-'));
 const store=new NethraStore(dir);
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const task=store.create({goal:'Self Improvement',allowCodeWork:true,conversationId:'self-improvement'});
 store.configure(task.id,{coordinateSelfImprovement:true},task.revision,'enable');
 const claim=store.claim('test');
 store.update(task.id,{coordination:{stage:'consulting',advisors:{codex:{status:'requested'}}}},'TEST',claim.token);
 await runCoordination(store.get(task.id),{store,tools:{execute(){assert.fail('duplicate consultation');}},token:claim.token});
 assert.equal(store.get(task.id).coordination.stage,'interrupted');
 assert.match(store.get(task.id).summary,/retry consultation/);
 store.release(task.id,claim.token);
});

test('changed direction fences the old approved scope and invalidates old advice across restart',async t=>{
 const {allowsCoordinationWork,ownerBrief}=require('../src/nethra-coordination');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-coordination-'));
 let store=new NethraStore(dir);t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 let task=store.create({goal:'Self Improvement',allowCodeWork:true,conversationId:'c'});
 task=store.configure(task.id,{coordinateSelfImprovement:true},task.revision,'enable');
 store.note(task.id,'Prioritize voice interruption.');task=store.get(task.id);
 const project={coordinationBrief:ownerBrief(task)};
 assert.equal(allowsCoordinationWork(task,project),true);
 store.note(task.id,'Prioritize task deletion instead.');
 assert.equal(allowsCoordinationWork(store.get(task.id),project),false);
 store.close();store=new NethraStore(dir);
 const claim=store.claim('test');let consultations=0;
 await runCoordination(claim.task,{store,token:claim.token,tools:{execute:async(name,args)=>{consultations++;assert.match(args.question,/task deletion instead/);return {advice:'Friction: hidden deletion. Improvement: Show Delete at the top. Test: Verify Delete is visible without scrolling in task detail.'};}}});
 store.release(task.id,claim.token);
 assert.equal(consultations,2);assert.equal(store.get(task.id).status,'WAITING_FOR_USER');
 assert.ok(store.get(task.id).summary.length<=1000);
});

test('Pause outranks a due advisor retry; Resume retries only the missing advisor and restart never repeats saved steps',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-coordination-'));
 let now=Date.now();
 let store=new NethraStore(dir,{now:()=>now});
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 let task=store.create({goal:'Self Improvement',allowCodeWork:true,conversationId:'self-improvement'});
 task=store.configure(task.id,{coordinateSelfImprovement:true},task.revision,'enable');
 const calls=[];let codexReady=false;const reset=now+2*3600_000;
 let work={status:'WAITING_CAPACITY',retryAt:now+5*3600_000,nextAction:'Waiting for confirmed provider capacity'};
 const tools={async execute(name){
   calls.push(name);
   if(name==='consult_codex'&&!codexReady)throw Object.assign(new Error('Codex is resting'),{retryAt:reset});
   if(name==='propose_code_work')return {workId:'draft-1',status:'DRAFT'};
   return {advice:'Friction: unclear status. Improvement: show the next action. Test: Verify Pause stops the same job before another dispatch.'};
 },workStatus:()=>work};
 const run=async()=>{
   const claim=store.claim('test');if(!claim)return false;
   try{await runCoordination(claim.task,{store,tools,token:claim.token,now:()=>now});}finally{store.release(claim.task.id,claim.token);}
   return true;
 };
 assert.equal(await run(),true);task=store.get(task.id);
 assert.equal(task.nextWakeAt,reset+60_000);assert.equal(task.coordination.advisors.codex.status,'waiting');
 task=store.control(task.id,'pause',task.revision,'pause');
 codexReady=true;now=reset+10*60_000;
 assert.equal(await run(),false,'a paused task is not woken by its saved retry');
 assert.deepEqual(calls,['consult_codex','consult_claude']);
 // The wait and the completed advice survive a restart while paused.
 store.close();store=new NethraStore(dir,{now:()=>now});task=store.get(task.id);
 assert.equal(task.status,'PAUSED');assert.equal(task.coordination.advisors.claude.status,'completed');
 task=store.control(task.id,'resume',task.revision,'resume');
 assert.equal(await run(),true);
 assert.deepEqual(calls,['consult_codex','consult_claude','consult_codex']);
 task=store.get(task.id);assert.equal(task.status,'WAITING_FOR_USER');
 store.answer(task.id,'approve pilot',task.revision,'approved',task.coordination.questionId);
 assert.equal(await run(),true);task=store.get(task.id);
 assert.equal(task.coordination.stage,'tracking');assert.equal(task.coordination.workId,'draft-1');
 // Tracking reports the engineering record's own next check instead of inventing one.
 assert.equal(task.status,'SLEEPING');assert.equal(task.nextWakeAt,work.retryAt);assert.equal(task.summary,'Waiting for confirmed provider capacity');
 store.close();store=new NethraStore(dir,{now:()=>now});
 now=work.retryAt;work={status:'COMPLETED',retryAt:null,nextAction:'Review verified changes in the canonical main checkout; engineering owns the commit'};
 assert.equal(await run(),true);task=store.get(task.id);
 assert.equal(calls.filter(name=>name==='propose_code_work').length,1);assert.equal(calls.filter(name=>name.startsWith('consult_')).length,3);
 assert.match(task.summary,/engineering owns the commit/);assert.equal(task.coordination.stage,'consulting');
 assert.equal(task.coordination.completedWork[0].id,'draft-1');assert.equal(task.nextWakeAt,now+1000);
 store.close();store=new NethraStore(dir,{now:()=>now});
 assert.equal(store.get(task.id).coordination.completedWork.length,1);
 now+=1000;assert.equal(await run(),true);
 assert.equal(store.get(task.id).status,'WAITING_FOR_USER');
 assert.equal(calls.filter(name=>name==='propose_code_work').length,1);
});

test('blocked engineering reports its actual failure once and leaves no polling wake',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nethra-blocked-'));
 const store=new NethraStore(dir);
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 let task=store.create({goal:'Self Improvement',allowCodeWork:true,conversationId:'blocked-chat'});
 task=store.configure(task.id,{coordinateSelfImprovement:true},task.revision,'enable');
 store.update(task.id,{coordination:{stage:'tracking',brief:'',workId:'blocked-work',advisors:{}}});
 const claim=store.claim('test');
 await runCoordination(claim.task,{store,token:claim.token,tools:{workStatus:()=>({status:'BLOCKED',blocker:'Patch changes protected verification',nextAction:'Review failure'})}});
 store.release(task.id,claim.token);
 task=store.get(task.id);
 assert.equal(task.status,'WAITING_FOR_USER');assert.equal(task.nextWakeAt,null);
 assert.match(task.questions.at(-1).question,/Patch changes protected verification/);
 assert.equal(store.claim('test'),null);
});
