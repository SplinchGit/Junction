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
      store.update(seeded.task, { status: "SLEEPING", nextWakeAt: Date.now() + 5 * 3600_000, wakeReason: { kind: "MONITOR", detail: "Routine daily monitoring check; a source change wakes it sooner", at: Date.now() + 5 * 3600_000 }, plan: ["Check the operator timetable page"], completedSteps: ["Check the operator timetable page"], pendingSteps: [], evidence: [{ tool: "web_search", result: { evidence: { query: "Oban ferry timetable", sources: [{ title: "CalMac timetable" }] } } }], summary: "Winter timetable unchanged; next check tomorrow." }, "SEEDED");
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
        for(let i=0;i<100&&!document.querySelector('#nethra-task-drawer .tracking');i++)await new Promise(r=>setTimeout(r,30));
        const text=document.querySelector('#nethra-task-drawer .tracking')?.textContent||'';document.querySelector('#nethra-task-drawer .tracking')?.scrollIntoView({block:'center'});
        return {text,redirect:!!document.querySelector('textarea[aria-label="Redirect objective"]'),checkNow:[...document.querySelectorAll('#nethra-task-drawer button')].some(b=>b.textContent==='Check now'),strip:document.getElementById('nethra-chat-strip').textContent};
      })()`);
      assert.match(tracking.text, /Routine daily monitoring/); assert.match(tracking.text, /Searched the web/);
      assert.equal(tracking.redirect, true); assert.equal(tracking.checkNow, true); assert.match(tracking.strip, /Next wake/);
      const drawer = await shot("appearance-task-tracking.png");
      const settings = await window.webContents.executeJavaScript(`(async()=>{document.getElementById('objective-status').click();showView('settings');await new Promise(r=>setTimeout(r,200));return {appearance:!!document.getElementById('appearance-settings'),readiness:document.querySelector('.settings').textContent.includes('Keep loaded after last use')};})()`);
      assert.deepEqual(settings, { appearance: true, readiness: true });
      const settingsShot = await shot("appearance-settings.png");
      await window.webContents.executeJavaScript(`(async()=>{window.JunctionAppearance.apply(await window.junction.setAppearance({mode:'system',palette:'moss',artwork:'none'}));showView('chat');})()`);
      const moss = await shot("appearance-moss-clean.png");
      assert.deepEqual(errors, [], "Renderer errors");
      console.log(JSON.stringify({ passed: true, state, reduced, persisted, tracking: { ...tracking, text: tracking.text.slice(0, 200) }, screenshots: [chatDark, chatLight, drawer, settingsShot, moss] }));
      clearTimeout(deadline); app.exit(0);
    } catch (error) { console.error(error.stack); console.error(JSON.stringify(errors)); clearTimeout(deadline); app.exit(1); }
  });
});
require("../src/main");
