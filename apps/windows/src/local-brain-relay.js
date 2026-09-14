"use strict";

const crypto = require("node:crypto");
const LOCAL_SOURCE = "junction_local_llm_v2";
const POLL_INTERVAL_MS = 5_000;
const LEASE_MS = 90_000;
const OLLAMA_TIMEOUT_MS = 120_000;
const STREAM_FLUSH_MS = 180;
const MAX_RESPONSE_CHARS = 48_000;
const HEARTBEAT_INTERVAL_MS = 15_000;

function decode(value) {
  if (!value) return undefined;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  return undefined;
}
function decodeDocument(document) { return Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, decode(value)])); }
function fields(value) {
  return { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typeof item === "number" ? { integerValue: String(Math.trunc(item)) } : { stringValue: String(item) }])) };
}
function crypt(key, aad, input, nonce, encrypt) {
  const material = Buffer.isBuffer(key) ? key : Buffer.from(key, "base64url");
  if (material.length !== 32) throw new Error("Invalid Local Junction pairing key.");
  const iv = nonce || crypto.randomBytes(12);
  const cipher = encrypt ? crypto.createCipheriv("aes-256-gcm", material, iv) : crypto.createDecipheriv("aes-256-gcm", material, iv);
  cipher.setAAD(Buffer.from(aad));
  if (!encrypt) cipher.setAuthTag(input.subarray(input.length - 16));
  const body = encrypt ? Buffer.concat([cipher.update(input), cipher.final(), cipher.getAuthTag()]) : Buffer.concat([cipher.update(input.subarray(0, -16)), cipher.final()]);
  return encrypt ? { ciphertext: body.toString("base64url"), nonce: iv.toString("base64url") } : body.toString("utf8");
}
async function readNdjson(stream, onEvent) {
  let buffered = "";
  for await (const chunk of stream) {
    buffered += Buffer.from(chunk).toString("utf8");
    const lines = buffered.split(/\r?\n/); buffered = lines.pop();
    for (const line of lines) if (line.trim()) await onEvent(JSON.parse(line));
  }
  if (buffered.trim()) await onEvent(JSON.parse(buffered));
}

/** PC-only endpoint for encrypted, paired local inference. */
class LocalBrainRelay {
  constructor({ projectId, getState, fetchImpl = fetch, ollamaUrl = "http://127.0.0.1:11434", intervalMs = POLL_INTERVAL_MS, workspacePath = "", createCodeDelegation = null, runLocalAgent = null, onCommandStarted = null, now = () => Date.now() }) {
    Object.assign(this, { projectId, getState, fetch: fetchImpl, ollamaUrl: ollamaUrl.replace(/\/$/, ""), intervalMs, workspacePath, createCodeDelegation, runLocalAgent, onCommandStarted, now, timer: null, polling: false, lastError: null, lastHeartbeatAt: 0 });
  }
  start() { if (this.timer || !this.projectId) return; this.timer = setInterval(() => this.poll().catch(error => { this.lastError = error.message; }), this.intervalMs); this.poll().catch(error => { this.lastError = error.message; }); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  root(brainId) { return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(this.projectId)}/databases/(default)/documents/local_brains/${encodeURIComponent(brainId)}`; }
  async request(url, session, options = {}) {
    const response = await this.fetch(url, { ...options, headers: { authorization: `Bearer ${session.idToken}`, "content-type": "application/json", ...(options.headers || {}) } });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error?.message || `Junction relay request failed (${response.status}).`);
    return body || {};
  }
  async query(brainId, session, collection, status) {
    const body = { structuredQuery: { from: [{ collectionId: collection }], where: { fieldFilter: { field: { fieldPath: "status" }, op: "EQUAL", value: { stringValue: status } } }, limit: 5 } };
    const rows = await this.request(`${this.root(brainId)}:runQuery`, session, { method: "POST", body: JSON.stringify(body) });
    return (rows || []).map(row => row.document).filter(Boolean).map(document => ({ document, data: decodeDocument(document) }));
  }
  async update(document, session, values, expected = null) {
    const mask = Object.keys(values).map(key => `updateMask.fieldPaths=${encodeURIComponent(key)}`).join("&");
    const precondition = expected ? `&currentDocument.updateTime=${encodeURIComponent(expected)}` : "";
    return this.request(`https://firestore.googleapis.com/v1/${document.name}?${mask}${precondition}`, session, { method: "PATCH", body: JSON.stringify(fields(values)) });
  }
  async create(brainId, path, session, values) { return this.request(`${this.root(brainId)}/${path}`, session, { method: "PATCH", body: JSON.stringify(fields(values)) }); }
  async heartbeat(state) {
    if (this.now() - this.lastHeartbeatAt < HEARTBEAT_INTERVAL_MS) return;
    const url = `${this.root(state.brainId)}?updateMask.fieldPaths=status&updateMask.fieldPaths=lastSeenAtMs`;
    await this.request(url, state.session, { method: "PATCH", body: JSON.stringify(fields({ status: "active", lastSeenAtMs: this.now() })) });
    this.lastHeartbeatAt = this.now();
  }
  async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      const state = await this.getState();
      if (!state?.brainId || !state?.session || !state?.key) return;
      await this.heartbeat(state);
      for (const pair of await this.query(state.brainId, state.session, "pairings", "claimed")) await this.activatePair(state, pair);
      const pending = await this.query(state.brainId, state.session, "commands", "pending");
      // `processing` is the pre-lease state written by released versions. Claim
      // it once on upgrade so a formerly silent request does not remain stuck.
      const legacyProcessing = await this.query(state.brainId, state.session, "commands", "processing");
      const running = await this.query(state.brainId, state.session, "commands", "running");
      const streaming = await this.query(state.brainId, state.session, "commands", "streaming");
      for (const command of [...pending, ...legacyProcessing, ...running, ...streaming]) {
        if ((command.data.status === "running" || command.data.status === "streaming") && Number(command.data.leaseUntilMs) > this.now()) continue;
        await this.run(state, command);
      }
      this.lastError = null;
    } finally { this.polling = false; }
  }
  async activatePair(state, item) {
    const uid = item.data.clientUid;
    if (!uid || uid.length > 200 || Number(item.data.expiresAtMs) < this.now()) return;
    await this.create(state.brainId, `clients/${encodeURIComponent(uid)}`, state.session, { clientUid: uid, status: "active" });
    await this.update(item.document, state.session, { status: "active" }, item.document.updateTime);
  }
  systemPrompt({ allowCodeDelegation = false } = {}) {
    return ["You are Junction Local Brain, the small local assistant for Junction.", "You are running on the owner's paired Windows PC through an encrypted relay. You have no direct computer, network, scheduling, or source-code tools.", this.workspacePath ? `The Junction repository on this PC is: ${this.workspacePath}.` : "", "Answer ordinary questions directly and concisely. Never claim that you changed files, searched the web, scheduled work, created a draft, or ran a tool.", allowCodeDelegation ? "This is an explicitly approved coding-delegation request. State the requested task on the first line exactly as JUNCTION_CODE_TASK: followed by a concise task. The PC will create a reviewable Codex draft; it never modifies the main branch automatically." : "Do not propose coding drafts. Coding delegation is only available through Junction's separate, owner-approved Projects workflow."].filter(Boolean).join("\n\n");
  }
  async markError(state, item, error) {
    const message = String(error?.message || error || "Local model request failed.").slice(0, 300);
    try { await this.update(item.document, state.session, { status: "error", error: message, leaseUntilMs: 0 }, null); } catch (writeError) { this.lastError = `${message}; unable to report it: ${writeError.message}`; }
  }
  async cancelled(state, item) {
    const document = await this.request(`https://firestore.googleapis.com/v1/${item.document.name}`, state.session);
    return decodeDocument(document).status === "cancel_requested";
  }
  async run(state, item) {
    const id = item.data.id || item.document.name.split("/").pop();
    try {
      this.onCommandStarted?.();
      await this.update(item.document, state.session, { status: "running", leaseUntilMs: this.now() + LEASE_MS, error: "" }, item.document.updateTime);
      const plaintext = crypt(state.key, `JBP1|${state.brainId}|${id}|request`, Buffer.from(item.data.ciphertext, "base64url"), Buffer.from(item.data.nonce, "base64url"), false);
      const payload = JSON.parse(plaintext);
      if (!Array.isArray(payload.messages) || typeof payload.model !== "string") throw new Error("Invalid encrypted local-model request.");
      if (payload.mode === "agent") await this.update(item.document, state.session, { leaseUntilMs: this.now() + 8 * 60_000 }, null);
      // A language model is not an authority to start coding work. Ordinary
      // phone chat intentionally cannot turn a hallucinated marker into a
      // Codex draft; that requires a future separately-approved request shape.
      const allowCodeDelegation = payload.mode === "code_delegation" && payload.ownerApproved === true;
      payload.messages = [{ role: "system", content: this.systemPrompt({ allowCodeDelegation }) }, ...payload.messages];
      let answer = "", thinking = "", final = null, sequence = 0, lastFlush = 0;
      const flush = async (force = false) => {
        if (!answer || (!force && this.now() - lastFlush < STREAM_FLUSH_MS)) return;
        const partial = crypt(state.key, `JBP1|${state.brainId}|${id}|partial`, Buffer.from(answer), null, true);
        await this.update(item.document, state.session, { status: "streaming", partialCiphertext: partial.ciphertext, partialNonce: partial.nonce, streamSequence: ++sequence, leaseUntilMs: this.now() + LEASE_MS }, null);
        lastFlush = this.now();
      };
      if (payload.mode === "agent") {
        if (!this.runLocalAgent) throw new Error("Local Agent is unavailable on this PC.");
        const ownerIndex = payload.messages.map(message => message.role).lastIndexOf("user");
        const goal = String(payload.messages[ownerIndex]?.content || "").trim();
        if (!goal) throw new Error("Local Agent request has no owner goal.");
        const controller = new AbortController();
        let checkingCancellation = false;
        const cancellationPoll = setInterval(async () => {
          if (checkingCancellation || controller.signal.aborted) return;
          checkingCancellation = true;
          try { if (await this.cancelled(state, item)) controller.abort(); } catch {} finally { checkingCancellation = false; }
        }, 1_000);
        try {
          const result = await this.runLocalAgent({ goal, model: payload.model, history: payload.messages.slice(0, ownerIndex), signal: controller.signal, isCancelled: () => this.cancelled(state, item) });
          answer = result.content; final = { eval_count: result.usage?.completion_tokens, eval_duration: 0 };
        } finally { clearInterval(cancellationPoll); }
      } else {
        const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
        try {
          const upstream = await this.fetch(`${this.ollamaUrl}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ model: payload.model, messages: payload.messages, stream: true, think: process.env.JUNCTION_OLLAMA_THINK === "true", options: { num_predict: 1024 } }) });
          if (!upstream.ok || !upstream.body) { const body = await upstream.json().catch(() => null); throw new Error(body?.error || `Local model returned HTTP ${upstream.status}.`); }
          await readNdjson(upstream.body, async event => { answer += String(event?.message?.content || ""); thinking += String(event?.message?.thinking || ""); if (event?.done) final = event; await flush(); });
          await flush(true);
        } finally { clearTimeout(timeout); }
      }
      answer = answer.trim();
      if (!answer) throw new Error("Local model returned an empty response.");
      const task = answer.match(/^JUNCTION_CODE_TASK:\s*(.+)/im)?.[1]?.trim();
      if (task && allowCodeDelegation && this.createCodeDelegation) {
        const plan = await this.createCodeDelegation(task);
        answer = `I created a Codex draft for this Junction change. Review and approve it in Junction on the PC before Codex starts.\n\n${answer.replace(/^JUNCTION_CODE_TASK:\s*.+\n?/im, "").trim()}`.trim();
        if (plan?.id) answer += `\n\nDraft: ${plan.id.slice(0, 8)}`;
      }
      const response = crypt(state.key, `JBP1|${state.brainId}|${id}|response`, Buffer.from(answer.slice(0, MAX_RESPONSE_CHARS)), null, true);
      const thought = thinking.trim(), encryptedThinking = thought ? crypt(state.key, `JBP1|${state.brainId}|${id}|thinking`, Buffer.from(thought.slice(0, MAX_RESPONSE_CHARS)), null, true) : null;
      const tokensPerSecond = Number(final?.eval_count) && Number(final?.eval_duration) ? (Number(final.eval_count) / (Number(final.eval_duration) / 1e9)).toFixed(1) : "";
      await this.update(item.document, state.session, { status: "done", responseCiphertext: response.ciphertext, responseNonce: response.nonce, thinkingCiphertext: encryptedThinking?.ciphertext || "", thinkingNonce: encryptedThinking?.nonce || "", tokensPerSecond, leaseUntilMs: 0 }, null);
    } catch (error) {
      if (error.name === "AbortError" && await this.cancelled(state, item).catch(() => false)) {
        await this.update(item.document, state.session, { status: "cancelled", error: "", leaseUntilMs: 0 }, null).catch(() => {});
      } else await this.markError(state, item, error.name === "AbortError" ? new Error("Local model timed out. Check Ollama and try again.") : error);
    }
  }
}
module.exports = { LocalBrainRelay, LOCAL_SOURCE, decodeDocument, crypt, readNdjson };
