"use strict";

const LOCAL_SOURCE = "junction_local_llm";
const POLL_INTERVAL_MS = 10_000;
const MAX_RESPONSE_CHARS = 12_000;
const DEFAULT_MAX_TOKENS = 384;

function decode(value) {
  if (!value) return undefined;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("timestampValue" in value) return value.timestampValue;
  return undefined;
}

function decodeDocument(document) {
  return Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, decode(value)]));
}

function fields(value) {
  return { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, { stringValue: String(item) }])) };
}

/**
 * Tiny, bounded Firestore relay for Android's first-class Local LLM provider.
 * This is intentionally polling rather than a permanent cloud worker: it runs
 * only while Junction is open on the owner's PC, uses no Functions/Cloud Run,
 * and makes at most 8,640 pending-query reads per day.
 */
class LocalBrainRelay {
  constructor({ projectId, getSession, fetchImpl = fetch, ollamaUrl = "http://127.0.0.1:11434", intervalMs = POLL_INTERVAL_MS }) {
    this.projectId = projectId;
    this.getSession = getSession;
    this.fetch = fetchImpl;
    this.ollamaUrl = ollamaUrl.replace(/\/$/, "");
    this.intervalMs = intervalMs;
    this.timer = null;
    this.polling = false;
  }

  start() {
    if (this.timer || !this.projectId) return;
    this.timer = setInterval(() => this.poll().catch(() => {}), this.intervalMs);
    this.poll().catch(() => {});
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  root(uid) { return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(this.projectId)}/databases/(default)/documents/users/${encodeURIComponent(uid)}`; }

  async request(url, session, options = {}) {
    const response = await this.fetch(url, { ...options, headers: { authorization: `Bearer ${session.idToken}`, "content-type": "application/json", ...(options.headers || {}) } });
    if (!response.ok) {
      const failure = await response.json().catch(() => null);
      throw new Error(failure?.error?.message || `Junction relay request failed (${response.status}).`);
    }
    return response.status === 204 ? {} : response.json();
  }

  async pending(session) {
    const body = { structuredQuery: { from: [{ collectionId: "remote_commands" }], where: { fieldFilter: { field: { fieldPath: "status" }, op: "EQUAL", value: { stringValue: "pending" } } }, limit: 5 } };
    const rows = await this.request(`${this.root(session.uid)}:runQuery`, session, { method: "POST", body: JSON.stringify(body) });
    return (rows || []).map(row => row.document).filter(Boolean).map(document => ({ document, data: decodeDocument(document) }))
      .filter(item => item.data.source === LOCAL_SOURCE);
  }

  async update(document, session, values, expectedUpdateTime = null) {
    const mask = Object.keys(values).map(key => `updateMask.fieldPaths=${encodeURIComponent(key)}`).join("&");
    const precondition = expectedUpdateTime ? `&currentDocument.updateTime=${encodeURIComponent(expectedUpdateTime)}` : "";
    // Firestore returns a resource name (projects/.../documents/...), not a
    // fetchable URL. Prefix it here so a claimed request is updated on the
    // actual Firestore document rather than silently left pending.
    return this.request(`https://firestore.googleapis.com/v1/${document.name}?${mask}${precondition}`, session, { method: "PATCH", body: JSON.stringify(fields(values)) });
  }

  async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      const session = await this.getSession();
      for (const item of await this.pending(session)) await this.run(item, session);
    } finally { this.polling = false; }
  }

  async run(item, session) {
    try {
      // A conditional update keeps duplicate polling or a second PC from
      // executing a request already claimed by this PC.
      await this.update(item.document, session, { status: "processing" }, item.document.updateTime);
      const payload = JSON.parse(item.data.content || "{}");
      if (!Array.isArray(payload.messages) || typeof payload.model !== "string") throw new Error("Invalid local-model request.");
      const requestedMaxTokens = Number(payload.maxTokens);
      const maxTokens = Number.isInteger(requestedMaxTokens)
        ? Math.max(1, Math.min(requestedMaxTokens, 1024))
        : DEFAULT_MAX_TOKENS;
      const upstream = await this.fetch(`${this.ollamaUrl}/api/chat`, {
        method: "POST", headers: { "content-type": "application/json" },
        // The phone only receives the completed answer. Disable Qwen's hidden
        // reasoning stream here and bound generation so one remote turn cannot
        // hold the single local inference slot indefinitely.
        body: JSON.stringify({
          model: payload.model,
          messages: payload.messages,
          stream: false,
          think: false,
          options: { num_predict: maxTokens }
        })
      });
      const result = await upstream.json();
      if (!upstream.ok) throw new Error(result?.error?.message || `Local model returned HTTP ${upstream.status}.`);
      const text = String(result?.message?.content || "").trim();
      if (!text) throw new Error("Local model returned an empty response.");
      await this.update(item.document, session, { status: "done", assistantResponse: text.slice(0, MAX_RESPONSE_CHARS), completedAt: new Date().toISOString() });
    } catch (error) {
      console.warn("Local Junction relay failed:", error?.message || error);
      try {
        await this.update(item.document, session, { status: "error", error: String(error.message || error).slice(0, 500), completedAt: new Date().toISOString() });
      } catch (statusError) {
        console.warn("Local Junction relay could not record its failure:", statusError?.message || statusError);
      }
    }
  }
}

module.exports = { LocalBrainRelay, LOCAL_SOURCE, decodeDocument };
