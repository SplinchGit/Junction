"use strict";
// Real Electron renderer with an isolated profile: appearance persistence, the artwork and
// petal layers, reduced motion, the model-readiness pill and objective tracking. Offline: no
// inference, Ollama, LAN, relay or sign-in. Screenshots go to test-results/.
const { app } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "junction-appearance-ui-"));
app.setPath("userData", directory);
global.fetch = async () => { throw new Error("OFFLINE_UI_TEST_NETWORK_DISABLED"); };
require("../src/world-host-relay").WorldHostRelay.prototype.start = function () {};
require("../src/lan-relay-lifecycle").LanRelayLifecycle.prototype.start = async function () { throw new Error("OFFLINE_UI_TEST_LAN_DISABLED"); };
require("../src/local-brain-relay").LocalBrainRelay.prototype.start = function () {};
require("../src/nethra-scheduler").NethraScheduler.prototype.start = function () {};
require("../src/codex-client").getCodexStatus = async () => ({ available: false });
const results = process.env.JUNCTION_UI_RESULTS || path.join(__dirname, "../test-results");
fs.mkdirSync(results, { recursive: true });
const errors = [];
const deadline = setTimeout(() => { console.error("Appearance UI test timed out"); app.exit(1); }, 60000);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
app.on("browser-window-created", (_event, window) => {
  window.webContents.on("console-message", (_event, level, message) => { if (level >= 3) errors.push(message); });
  window.webContents.once("did-finish-load", async () => {
    try {
      const shot = async name => { await wait(700); const file = path.join(results, name); fs.writeFileSync(file, (await window.webContents.capturePage()).toPNG()); return file; };
      // Seed a conversation with an objective that is waiting on the owner.
      const {NethraStore} = require("../src/nethra-store");
      const seeded = await window.webContents.executeJavaScript(`(async()=>{
        const chat=await window.junction.newConversation();
        await window.junction.renameConversation({id:chat.id,title:'Ferry timetable tracking'});
        const {task}=await window.junction.nethra('nethra.create',{goal:'Track ferry timetable changes for the Oban route',conversationId:chat.id,mode:'ONGOING'});
        return {chat:chat.id,task:task.id};
      })()`);
      const store = new NethraStore(path.join(directory, "nethra"));
      store.update(seeded.task, { status: "SLEEPING", nextWakeAt: Date.now() + 5 * 3600_000, wakeReason: { kind: "MONITOR", detail: "Routine daily monitoring check; a source change wakes it sooner", at: Date.now() + 5 * 3600_000 }, plan: ["Check the operator timetable page"], completedSteps: ["Check the operator timetable page"], pendingSteps: [], evidence: [{ tool: "web_search", result: { evidence: { query: "Oban ferry timetable", sources: [{ title: "CalMac timetable" }] } } }], summary: "Winter timetable unchanged; next check tomorrow." }, "nethra_tool_result");
      store.createExperiment(seeded.task, { hypothesis: "Earlier warm-up shortens replies", metric: "chat_response_ms", changeKind: "setting", model: "qwen3:30b", workId: null, startedAt: Date.now(), baseline: { values: [7000, 7100, 7200, 7300, 7400], count: 5, median: 7200, from: Date.now() - 60_000, to: Date.now() } });
      store.close();
      const state = await window.webContents.executeJavaScript(`(async()=>{
        await openConversation(${JSON.stringify(seeded.chat)});
        await window.junction.setAppearance({mode:'dark',palette:'sakura',artwork:'sakura-mountain',backgroundIntensity:60,petals:true,petalIntensity:40,motion:'full'});
        window.JunctionAppearance.apply(await window.junction.appearance());
        await new Promise(r=>setTimeout(r,300));
        const pill=document.getElementById('model-pill');
        return {palette:document.documentElement.dataset.palette,artwork:document.documentElement.dataset.artwork,ambient:getComputedStyle(document.getElementById('ambient')).opacity,pill:pill?.dataset.state,pillText:pill?.textContent};
      })()`);
      assert.equal(state.palette, "sakura"); assert.equal(state.artwork, "sakura-mountain");
      assert.ok(["unavailable", "unknown"].includes(state.pill), `offline pill state: ${state.pill}`);
      window.focus(); await wait(400);
      const chatDark = await shot("appearance-sakura-dark.png");
      // The chat header shows how long the chat is and how much of it Nethra reads.
      const tokenLine = await window.webContents.executeJavaScript(`(()=>{renderMessages(Array.from({length:20},(_,i)=>({id:'m'+i,role:i%2?'assistant':'user',content:'y'.repeat(900),provenance:i%2?'JUNCTION':'OWNER',createdAt:Date.now(),...(i===19?{telemetry:{inputTokens:2411}}:{})})));return document.getElementById('chat-tokens').textContent;})()`);
      assert.match(tokenLine, /≈5\.2k tokens in this chat · Nethra reads the latest ≈1\.0k \(4 of 20 messages\) · last reply's prompt 2,411 of 8,192/);
      const tokenShot = await shot("chat-token-line.png");
      // Reduced motion stops the petal layer; the artwork remains.
      const reduced = await window.webContents.executeJavaScript(`(async()=>{
        window.JunctionAppearance.apply(await window.junction.setAppearance({motion:'reduced'}));
        return {running:window.JunctionAppearance.running(),motion:document.documentElement.dataset.motion};
      })()`);
      assert.equal(reduced.running, false); assert.equal(reduced.motion, "reduced");
      // Persistence across a renderer reload.
      await window.webContents.executeJavaScript(`location.reload()`);
      await wait(2500);
      const persisted = await window.webContents.executeJavaScript(`(async()=>({palette:document.documentElement.dataset.palette,artwork:document.documentElement.dataset.artwork,motion:(await window.junction.appearance()).motion}))()`);
      assert.deepEqual(persisted, { palette: "sakura", artwork: "sakura-mountain", motion: "reduced" });
      const light = await window.webContents.executeJavaScript(`(async()=>{
        window.JunctionAppearance.apply(await window.junction.setAppearance({mode:'light',motion:'full'}));
        await openConversation(${JSON.stringify(seeded.chat)});return true;})()`);
      assert.equal(light, true);
      const chatLight = await shot("appearance-sakura-light.png");
      const tracking = await window.webContents.executeJavaScript(`(async()=>{
        await window.junction.setAppearance({mode:'dark'});
        document.getElementById('objective-status').click();
        for(let i=0;i<100&&!document.querySelector('#view-tasks .tracking');i++)await new Promise(r=>setTimeout(r,30));
        const text=document.querySelector('#view-tasks .tracking')?.textContent||'';document.querySelector('#view-tasks .tracking')?.scrollIntoView({block:'center'});
        return {text,overview:document.querySelector('.task-progress-overview')?.textContent||'',cardProgress:document.querySelector('.task-card-progress')?.textContent||'',activity:document.querySelector('.task-activity')?.textContent||'',metrics:document.querySelector('.task-performance')?.textContent||'',experiments:document.querySelector('.task-experiments')?.textContent||'',redirect:!!document.querySelector('textarea[aria-label="Redirect objective"]'),checkNow:[...document.querySelectorAll('#view-tasks button')].some(b=>b.textContent==='Check now'),strip:document.getElementById('nethra-chat-strip').textContent};
      })()`);
      assert.match(tracking.text, /Routine daily monitoring/); assert.match(tracking.text, /Searched the web/);
      assert.match(tracking.overview,/Next action/);assert.match(tracking.cardProgress,/1 of 1/);assert.match(tracking.activity,/Searched the web/);assert.match(tracking.metrics,/No measured samples/);assert.match(tracking.experiments,/Earlier warm-up shortens replies.*Baseline recorded/);assert.doesNotMatch(tracking.experiments,/7000, 7100/);
      assert.equal(tracking.redirect, true); assert.equal(tracking.checkNow, true); assert.match(tracking.strip, /Next wake/);
      const drawer = await shot("appearance-task-tracking.png");
      const taskChat = await window.webContents.executeJavaScript(`(async()=>{
        document.querySelector('.task-card .task-title').click();
        for(let i=0;i<100&&!document.querySelector('.task-chat-activity');i++)await new Promise(r=>setTimeout(r,30));
        return {visible:document.getElementById('view-chat').classList.contains('active'),boxed:document.getElementById('messages').classList.contains('task-chat'),emptyHome:!!document.querySelector('#messages .chat-home'),actions:document.querySelector('.task-chat-activity')?.textContent||'',controls:[...document.querySelectorAll('.task-card-actions button')].map(b=>b.textContent)};
      })()`);
      assert.equal(taskChat.visible,true);assert.equal(taskChat.boxed,true);assert.equal(taskChat.emptyHome,false);assert.match(taskChat.actions,/Searched the web/);assert.deepEqual(taskChat.controls,['Pause','Edit','Delete']);
      const taskChatShot = await shot("appearance-task-chat.png");
      const settings = await window.webContents.executeJavaScript(`(async()=>{document.getElementById('objective-status').click();showView('settings');await new Promise(r=>setTimeout(r,200));return {appearance:!!document.getElementById('appearance-settings'),readiness:document.querySelector('.settings').textContent.includes('Keep loaded after last use'),advisors:document.querySelector('.settings').textContent.includes('Self-improvement advisors')&&document.querySelector('.settings').textContent.includes('Keep for my own use')};})()`);
      assert.deepEqual(settings, { appearance: true, readiness: true, advisors: true });
      const settingsShot = await shot("appearance-settings.png");
      await window.webContents.executeJavaScript(`(async()=>{window.JunctionAppearance.apply(await window.junction.setAppearance({mode:'system',palette:'moss',artwork:'none'}));showView('chat');})()`);
      const moss = await shot("appearance-moss-clean.png");
      assert.deepEqual(errors, [], "Renderer errors");
      console.log(JSON.stringify({ passed: true, state, reduced, persisted, tracking: { ...tracking, text: tracking.text.slice(0, 200) }, screenshots: [chatDark, chatLight, drawer, taskChatShot, settingsShot, moss] }));
      clearTimeout(deadline); app.exit(0);
    } catch (error) { console.error(error.stack); console.error(JSON.stringify(errors)); clearTimeout(deadline); app.exit(1); }
  });
});
require("../src/main");
