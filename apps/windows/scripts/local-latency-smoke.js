"use strict";
// Real renderer/preload/IPC/Ollama check, using a disposable owner profile.
const { app } = require("electron");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const base = path.resolve(__dirname, "../src");
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "junction-latency-")));
require(path.join(base, "world-host-relay")).WorldHostRelay.prototype.start = function () {};
require(path.join(base, "lan-relay-lifecycle")).LanRelayLifecycle.prototype.start = async function () { throw new Error("Smoke profile: LAN disabled"); };
require(path.join(base, "local-brain-relay")).LocalBrainRelay.prototype.start = function () {};
require(path.join(base, "codex-client")).getCodexStatus = async () => ({ available: false });
const deadline = setTimeout(() => { console.error("Local latency smoke timed out"); app.exit(1); }, 180_000);
app.on("browser-window-created", (_event, window) => {
  window.webContents.once("did-finish-load", async () => {
    try {
      const result = await window.webContents.executeJavaScript(`(async () => {
        await window.junction.setProvider({id:'local',model:'qwen3:30b'});
        await newChat();
        let firstTextMs = null, updates = 0, renderedBeforeCompletion = false;
        const started = performance.now();
        const off = window.junction.onChatStream(value => {
          if (value.provider !== 'local' || !value.text) return;
          firstTextMs ??= Math.round(performance.now() - started);
          updates++;
          renderedBeforeCompletion ||= Boolean(document.querySelector('[data-streaming-reply="true"] .bubble')?.textContent);
        });
        document.getElementById('message-input').value = 'In three sentences explain why the sky is blue.';
        await send();
        off();
        const conversation = await window.junction.conversation(activeConversationId);
        return {firstTextMs,updates,renderedBeforeCompletion,wallMs:Math.round(performance.now()-started),answer:conversation.messages.at(-1)?.content};
      })()`);
      result.success = result.updates > 0 && result.renderedBeforeCompletion && /scatter/i.test(result.answer);
      const output = path.resolve(__dirname, "../../../artifacts/qwen14b-desktop-latency.json");
      fs.writeFileSync(output, JSON.stringify(result, null, 2));
      console.log(JSON.stringify(result));
      clearTimeout(deadline); app.exit(result.success ? 0 : 1);
    } catch (error) { console.error(error.stack); clearTimeout(deadline); app.exit(1); }
  });
});
require(path.join(base, "main"));
