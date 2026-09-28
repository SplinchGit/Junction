"use strict";
// Real Electron renderer/preload/IPC and local persistence, isolated from owner
// data and external services. No inference, voice, sign-in or paid API requests.
const { app } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "junction-offline-ui-"));
app.setPath("userData", directory);
global.fetch = async () => { throw new Error("OFFLINE_UI_TEST_NETWORK_DISABLED"); };
// Background transports have their own suites; never connect this test instance
// to James's phone/VM or advertise another Junction on his network.
require("../src/world-host-relay").WorldHostRelay.prototype.start = function () {};
require("../src/lan-relay-lifecycle").LanRelayLifecycle.prototype.start = async function () {
  throw new Error("OFFLINE_UI_TEST_LAN_DISABLED");
};
require("../src/local-brain-relay").LocalBrainRelay.prototype.start = function () {};
require("../src/codex-client").getCodexStatus = async () => ({available: false});
const errors = [];
const deadline = setTimeout(() => { console.error("Offline UI test timed out"); app.exit(1); }, 45000);
app.on("browser-window-created", (_event, window) => {
  window.webContents.on("console-message", (_event, level, message) => {
    if (level >= 3) errors.push(message);
  });
  window.webContents.once("did-finish-load", async () => {
    try {
      const result = await window.webContents.executeJavaScript(`(async () => {
        const views = [];
        for (const button of document.querySelectorAll('.nav[data-view]')) {
          button.click();
          const active = document.querySelector('.view.active');
          if (active?.id !== 'view-' + button.dataset.view) throw new Error('Navigation failed: ' + button.dataset.view);
          views.push(button.dataset.view);
        }
        const chat = await window.junction.newConversation();
        await window.junction.renameConversation({id:chat.id,title:'Offline smoke fixture'});
        const history = await window.junction.conversations();
        await window.junction.addMemory({category:'test',content:'Offline fixture fact'});
        const memory = await window.junction.memories();
        await window.junction.deleteMemory(memory.find(item=>item.content==='Offline fixture fact').id);
        const removed = !(await window.junction.memories()).some(item=>item.content==='Offline fixture fact');
        await window.junction.deleteConversation(chat.id);
        showView('chat');
        return {views,created:history.some(item=>item.id===chat.id),removed,extracted:!document.getElementById('open-mafioso'),hasPreload:typeof window.junction.audit==='function'};
      })()`);
      assert.deepEqual(result.views, ["chat", "feed", "projects", "audit", "context", "settings"]);
      for (const key of ["created", "removed", "extracted", "hasPreload"]) assert.equal(result[key], true, key);
      assert.deepEqual(errors, [], "Renderer errors");
      const output = path.join(__dirname, "../test-results/offline-ui-smoke.png");
      fs.writeFileSync(output, (await window.webContents.capturePage()).toPNG());
      console.log(JSON.stringify({passed: true, ...result, screenshot: output}));
      clearTimeout(deadline);
      app.exit(0);
    } catch (error) {
      console.error(error.stack); clearTimeout(deadline); app.exit(1);
    }
  });
});
require("../src/main");
