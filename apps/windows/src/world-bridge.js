"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const WORLD_MODEL = "qwen3.5:2b";
function buildWorldInferencePayload(messages, maxOutputTokens) {
  return {
    model: WORLD_MODEL,
    messages,
    stream: false,
    think: false,
    format: "json",
    options: { num_predict: maxOutputTokens, temperature: 0 },
  };
}
const MAX_EVENT_SUMMARY = 280;
const MAX_EVENT_DETAILS = 4_000;
const MAX_EVENTS_IN_MEMORY = 20_000;
const MAX_HEARTBEAT_MINUTES = 120;
const EVENT_CATEGORIES = new Set([
  "WAKE", "SLEEP", "GOAL_CREATED", "GOAL_UPDATED", "GOAL_ABANDONED", "GOAL_COMPLETED",
  "REFLECTION", "INTENTION", "ACTION", "RESULT", "RESEARCH", "PROJECT_FILE",
  "COMMUNICATION", "ERROR", "SECURITY_DENIAL", "RESOURCE_WARNING", "SYSTEM",
]);
const ACTION_STATUSES = new Set(["INTENDED", "ATTEMPTED", "SUCCEEDED", "FAILED", "BLOCKED"]);
const COMMUNICATION_DIRECTIONS = new Set(["OWNER_TO_AGENT", "AGENT_TO_OWNER"]);
const MAX_CHAT_CHARS = 2_800;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactFields(value, required, optional = []) {
  if (!plainObject(value)) throw new Error("Request must be a JSON object.");
  const allowed = new Set([...required, ...optional]);
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(value, key)) throw new Error(`Missing field: ${key}.`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`Unexpected field: ${key}.`);
}

function validateAuditEvent(value, now = Date.now()) {
  exactFields(value, ["id", "occurredAt", "category", "summary"], ["details", "goalId", "actionId", "actionStatus", "durationMs", "resources", "communicationId", "conversationId", "communicationDirection"]);
  if (typeof value.id !== "string" || !UUID.test(value.id)) throw new Error("Invalid event ID.");
  if (typeof value.occurredAt !== "string" || value.occurredAt.length > 40 || !Number.isFinite(Date.parse(value.occurredAt))) throw new Error("Invalid event timestamp.");
  const timestamp = Date.parse(value.occurredAt);
  if (timestamp > now + 5 * 60_000 || timestamp < Date.UTC(2000, 0, 1)) throw new Error("Event timestamp is outside the accepted range.");
  if (!EVENT_CATEGORIES.has(value.category)) throw new Error("Invalid event category.");
  if (typeof value.summary !== "string" || !value.summary.trim() || value.summary.length > MAX_EVENT_SUMMARY) throw new Error("Invalid event summary.");
  const result = { id: value.id, occurredAt: new Date(timestamp).toISOString(), category: value.category, summary: value.summary.trim() };
  if (Object.prototype.hasOwnProperty.call(value, "details")) {
    if (typeof value.details !== "string" || value.details.length > MAX_EVENT_DETAILS) throw new Error("Invalid event details.");
    result.details = value.details;
  }
  for (const idField of ["goalId", "actionId"]) if (Object.prototype.hasOwnProperty.call(value, idField)) {
    if (typeof value[idField] !== "string" || !UUID.test(value[idField])) throw new Error(`Invalid ${idField}.`);
    result[idField] = value[idField];
  }
  if (Object.prototype.hasOwnProperty.call(value, "actionStatus")) {
    if (!ACTION_STATUSES.has(value.actionStatus)) throw new Error("Invalid action status.");
    result.actionStatus = value.actionStatus;
  }
  for (const idField of ["communicationId", "conversationId"]) if (Object.prototype.hasOwnProperty.call(value, idField)) {
    if (value.category !== "COMMUNICATION" || typeof value[idField] !== "string" || !UUID.test(value[idField])) throw new Error(`Invalid ${idField}.`);
    result[idField] = value[idField];
  }
  if (Object.prototype.hasOwnProperty.call(value, "communicationDirection")) {
    if (value.category !== "COMMUNICATION" || !COMMUNICATION_DIRECTIONS.has(value.communicationDirection)) throw new Error("Invalid communication direction.");
    result.communicationDirection = value.communicationDirection;
  }
  if (value.category === "COMMUNICATION" && (!result.communicationId || !result.conversationId || !result.communicationDirection)) throw new Error("Communication events require message and conversation IDs and a direction.");
  if (Object.prototype.hasOwnProperty.call(value, "durationMs")) {
    if (!Number.isSafeInteger(value.durationMs) || value.durationMs < 0 || value.durationMs > 15 * 60_000) throw new Error("Invalid event duration.");
    result.durationMs = value.durationMs;
  }
  if (Object.prototype.hasOwnProperty.call(value, "resources")) {
    exactFields(value.resources, [], ["workspaceFreeBytes", "memoryUsedBytes", "cpuPercent"]);
    const resources = {};
    for (const key of ["workspaceFreeBytes", "memoryUsedBytes"]) if (key in value.resources) {
      const number = value.resources[key];
      if (!Number.isSafeInteger(number) || number < 0) throw new Error(`Invalid resource field: ${key}.`);
      resources[key] = number;
    }
    if ("cpuPercent" in value.resources) {
      if (typeof value.resources.cpuPercent !== "number" || !Number.isFinite(value.resources.cpuPercent) || value.resources.cpuPercent < 0 || value.resources.cpuPercent > 100) throw new Error("Invalid resource field: cpuPercent.");
      resources.cpuPercent = value.resources.cpuPercent;
    }
    result.resources = resources;
  }
  return result;
}

function validateInferenceRequest(value) {
  exactFields(value, ["requestId", "messages", "maxOutputTokens"]);
  if (typeof value.requestId !== "string" || !UUID.test(value.requestId)) throw new Error("Invalid inference request ID.");
  if (!Array.isArray(value.messages) || value.messages.length < 1 || value.messages.length > 20) throw new Error("Invalid inference messages.");
  let total = 0;
  const messages = value.messages.map(message => {
    exactFields(message, ["role", "content"]);
    if (!new Set(["system", "user", "assistant"]).has(message.role)) throw new Error("Invalid inference role.");
    if (typeof message.content !== "string" || message.content.length > 8_000) throw new Error("Invalid inference content.");
    total += Buffer.byteLength(message.content, "utf8");
    return { role: message.role, content: message.content };
  });
  if (total > 32 * 1024) throw new Error("Inference context exceeds its size limit.");
  if (!Number.isSafeInteger(value.maxOutputTokens) || value.maxOutputTokens < 16 || value.maxOutputTokens > 512) throw new Error("Invalid inference output limit.");
  return { requestId: value.requestId, messages, maxOutputTokens: value.maxOutputTokens };
}

class WorldAuditStore {
  constructor(directory, { rotateBytes = 2 * 1024 * 1024, archives = 8, now = () => Date.now() } = {}) {
    this.directory = directory;
    this.file = path.join(directory, "junction-world-audit.jsonl");
    this.rotateBytes = rotateBytes;
    this.maxArchives = archives;
    this.now = now;
    this.records = [];
    this.byId = new Map();
    this.sequence = 0;
    fs.mkdirSync(directory, { recursive: true });
    this.load();
  }
  archivePath(index) { return path.join(this.directory, `junction-world-audit.${index}.jsonl.gz`); }
  readLines(file, compressed) {
    if (!fs.existsSync(file)) return [];
    const bytes = fs.readFileSync(file);
    const text = (compressed ? zlib.gunzipSync(bytes) : bytes).toString("utf8");
    return text.split(/\r?\n/).filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  }
  load() {
    const records = [];
    for (let index = this.maxArchives; index >= 1; index--) records.push(...this.readLines(this.archivePath(index), true));
    records.push(...this.readLines(this.file, false));
    for (const record of records.slice(-MAX_EVENTS_IN_MEMORY)) {
      if (!Number.isSafeInteger(record.sequence) || record.sequence < 1 || typeof record.id !== "string") continue;
      this.records.push(record); this.byId.set(record.id, record); this.sequence = Math.max(this.sequence, record.sequence);
    }
    while (this.records.length > MAX_EVENTS_IN_MEMORY) this.records.shift();
  }
  rotateIfNeeded(nextBytes) {
    if (!fs.existsSync(this.file) || fs.statSync(this.file).size + nextBytes <= this.rotateBytes) return;
    const current = fs.readFileSync(this.file);
    for (let index = this.maxArchives; index >= 1; index--) {
      const target = this.archivePath(index);
      const source = index === 1 ? null : this.archivePath(index - 1);
      try {
        if (index === this.maxArchives) fs.rmSync(target, { force: true });
        if (source && fs.existsSync(source)) fs.renameSync(source, target);
      } catch (error) { throw new Error(`Audit rotation failed safely: ${error.message}`); }
    }
    fs.writeFileSync(this.archivePath(1), zlib.gzipSync(current), { flag: "wx", mode: 0o600 });
    fs.writeFileSync(this.file, "", { flag: "w", mode: 0o600 });
  }
  append(input) {
    const event = validateAuditEvent(input, this.now());
    const previous = this.byId.get(event.id);
    if (previous) return previous;
    const record = { ...event, sequence: this.sequence + 1, receivedAt: new Date(this.now()).toISOString() };
    const line = `${JSON.stringify(record)}\n`;
    this.rotateIfNeeded(Buffer.byteLength(line));
    fs.appendFileSync(this.file, line, { encoding: "utf8", mode: 0o600 });
    this.sequence = record.sequence;
    this.records.push(record); this.byId.set(record.id, record);
    while (this.records.length > MAX_EVENTS_IN_MEMORY) {
      const expired = this.records.shift(); this.byId.delete(expired.id);
    }
    return record;
  }
  listSince(sequence = 0, limit = 500) {
    const since = Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : 0;
    const safeLimit = Number.isSafeInteger(limit) ? Math.max(1, Math.min(1000, limit)) : 500;
    return this.records.filter(record => record.sequence > since).slice(0, safeLimit);
  }
  update() { throw new Error("World audit history is append-only."); }
  delete() { throw new Error("World audit history is append-only."); }
}

/** Host-owned controls. The guest can read this state but cannot write it. */
class WorldControlStore {
  constructor(file, { now = () => Date.now() } = {}) {
    this.file = file;
    this.now = now;
    this.state = { paused: true, heartbeatMinutes: 15, revision: 0, updatedAt: new Date(now()).toISOString() };
    try {
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      if (plainObject(saved) && typeof saved.paused === "boolean" && Number.isSafeInteger(saved.heartbeatMinutes) && saved.heartbeatMinutes >= 10 && saved.heartbeatMinutes <= MAX_HEARTBEAT_MINUTES && Number.isSafeInteger(saved.revision) && saved.revision >= 0) this.state = saved;
    } catch {}
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  get() { return { ...this.state }; }
  set({ paused = this.state.paused, heartbeatMinutes = this.state.heartbeatMinutes } = {}) {
    if (typeof paused !== "boolean") throw new Error("Paused must be a boolean.");
    if (!Number.isSafeInteger(heartbeatMinutes) || heartbeatMinutes < 10 || heartbeatMinutes > MAX_HEARTBEAT_MINUTES) throw new Error("Heartbeat must be between 10 and 120 minutes.");
    const next = { paused, heartbeatMinutes, revision: this.state.revision + 1, updatedAt: new Date(this.now()).toISOString() };
    const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(next)}\n`, { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, this.file);
    this.state = next;
    return this.get();
  }
}

/** Durable, bounded host-to-guest queue. Message content is shown only as communication audit records. */
class WorldChatStore {
  constructor(file, { auditStore, now = () => Date.now(), maxPending = 32 } = {}) {
    if (!auditStore || typeof auditStore.append !== "function") throw new Error("World audit store is required for Android messages.");
    this.file = file; this.auditStore = auditStore; this.now = now; this.maxPending = maxPending; this.pending = []; this.deviceTimes = new Map();
    try {
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Array.isArray(saved)) this.pending = saved.filter(item => item && UUID.test(item.id) && UUID.test(item.conversationId) && typeof item.content === "string" && item.content.length <= MAX_CHAT_CHARS && Number.isFinite(item.queuedAt)).slice(-maxPending);
    } catch {}
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  persist() {
    const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(this.pending)}\n`, { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }
  enqueue({ deviceId, content, conversationId = "550e8400-e29b-41d4-a716-446655440000", messageId = crypto.randomUUID() } = {}) {
    const deny = reason => {
      this.auditStore.append({ id: crypto.randomUUID(), occurredAt: new Date(this.now()).toISOString(), category: "SECURITY_DENIAL", summary: "Rejected a Junction World message request.", details: reason.slice(0, 120), actionStatus: "BLOCKED" });
      throw new Error(reason);
    };
    if (typeof deviceId !== "string" || !SAFE_ID.test(deviceId)) return deny("Invalid paired device ID.");
    if (typeof content !== "string" || !content.trim() || content.length > MAX_CHAT_CHARS) return deny(`Message must contain 1 to ${MAX_CHAT_CHARS} characters.`);
    if (typeof conversationId !== "string" || !UUID.test(conversationId)) return deny("Invalid conversation ID.");
    if (typeof messageId !== "string" || !UUID.test(messageId)) return deny("Invalid communication ID.");
    const existing = this.pending.find(item => item.id === messageId);
    if (existing) {
      if (existing.content !== content.trim() || existing.deviceId !== deviceId) throw new Error("Communication ID was reused with different content.");
      if (!this.auditStore.records?.some(record => record.communicationId === messageId)) this.auditStore.append({ id: crypto.randomUUID(), occurredAt: new Date(existing.queuedAt).toISOString(), category: "COMMUNICATION", summary: "Message sent to Junction World from Android.", details: existing.content, communicationId: messageId, conversationId: existing.conversationId, communicationDirection: "OWNER_TO_AGENT" });
      return { id: messageId, conversationId, status: "QUEUED" };
    }
    if (this.auditStore.records?.some(record => record.communicationId === messageId)) return { id: messageId, conversationId, status: "DELIVERED" };
    const cutoff = this.now() - 60_000;
    const recent = (this.deviceTimes.get(deviceId) || []).filter(timestamp => timestamp > cutoff);
    if (recent.length >= 10) return deny("Android message rate limit exceeded.");
    if (this.deviceTimes.size >= 128 && !this.deviceTimes.has(deviceId)) this.deviceTimes.delete(this.deviceTimes.keys().next().value);
    recent.push(this.now()); this.deviceTimes.set(deviceId, recent);
    this.pending = this.pending.filter(item => this.now() - item.queuedAt < 7 * 24 * 60 * 60_000);
    if (this.pending.length >= this.maxPending) throw new Error("Junction World's message queue is full.");
    const id = messageId;
    const queuedAt = this.now();
    const item = { id, conversationId, deviceId, content: content.trim(), queuedAt };
    this.pending.push(item); this.persist();
    if (!this.auditStore.records?.some(record => record.communicationId === id)) {
      this.auditStore.append({ id: crypto.randomUUID(), occurredAt: new Date(queuedAt).toISOString(), category: "COMMUNICATION", summary: "Message sent to Junction World from Android.", details: item.content, communicationId: id, conversationId, communicationDirection: "OWNER_TO_AGENT" });
    }
    return { id, conversationId, status: "QUEUED" };
  }
  nextPending(limit = 8) { return this.pending.slice(0, Math.max(1, Math.min(8, limit))).map(item => ({ ...item })); }
  acknowledge(id) {
    if (typeof id !== "string" || !UUID.test(id)) return false;
    const next = this.pending.filter(item => item.id !== id);
    if (next.length === this.pending.length) return false;
    this.pending = next; this.persist(); return true;
  }
}

class WorldBridge {
  constructor({ token, auditStore, infer, getControlState, now = () => Date.now() } = {}) {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(token)) throw new Error("A strong World Bridge token is required.");
    if (!auditStore || typeof auditStore.append !== "function") throw new Error("World audit store is required.");
    if (typeof infer !== "function") throw new Error("A bounded local inference function is required.");
    if (typeof getControlState !== "function") throw new Error("World control state is required.");
    this.token = token; this.auditStore = auditStore; this.infer = infer; this.getControlState = getControlState;
    this.now = now;
    this.inferenceActive = false; this.inferenceTimes = []; this.inferenceResults = new Map(); this.denialWindow = 0; this.denialCount = 0;
  }
  static token(identityStore) {
    let token = identityStore.getSecureValue("world-bridge-token-v1");
    if (!token) { token = crypto.randomBytes(32).toString("base64url"); identityStore.setSecureValue("world-bridge-token-v1", token); }
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) throw new Error("Stored World Bridge token is invalid.");
    return token;
  }
  authenticated(value) {
    const supplied = Buffer.from(String(value || "").replace(/^Bearer\s+/i, ""));
    const expected = Buffer.from(this.token);
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  }
  recordSecurityDenial(summary, details = "") {
    const current = this.now();
    if (current - this.denialWindow >= 60_000) { this.denialWindow = current; this.denialCount = 0; }
    if (this.denialCount >= 30) return null;
    this.denialCount += 1;
    return this.auditStore.append({ id: crypto.randomUUID(), occurredAt: new Date(current).toISOString(), category: "SECURITY_DENIAL", summary, ...(details ? { details: details.slice(0, 500) } : {}), actionStatus: "BLOCKED" });
  }
  async dispatch({ method, pathname, authorization, body }) {
    if (!this.authenticated(authorization)) {
      this.recordSecurityDenial("Rejected an unauthenticated World Bridge request.");
      return { status: 401, body: { error: "Unauthorized" } };
    }
    if (method === "POST" && pathname === "/v1/infer") {
      let request;
      try { request = validateInferenceRequest(body); } catch (error) {
        this.recordSecurityDenial("Rejected an invalid inference request.", error.message);
        return { status: 400, body: { error: "Invalid inference request." } };
      }
      const control = await this.getControlState();
      if (control?.paused) {
        this.recordSecurityDenial("Blocked an inference request while Junction World is paused.");
        return { status: 423, body: { error: "Junction World is paused." } };
      }
      if (this.inferenceResults.has(request.requestId)) return this.inferenceResults.get(request.requestId);
      const minuteAgo = this.now() - 60_000;
      this.inferenceTimes = this.inferenceTimes.filter(timestamp => timestamp > minuteAgo);
      if (this.inferenceActive || this.inferenceTimes.length >= 12) return { status: 429, body: { error: "Inference is busy or rate limited." } };
      this.inferenceActive = true; this.inferenceTimes.push(this.now());
      try {
        const started = this.now();
        const result = await this.infer(request.messages, request.maxOutputTokens, { signal: AbortSignal.timeout(120_000), model: WORLD_MODEL });
        const content = typeof result === "string" ? result : result?.content;
        if (typeof content !== "string" || content.length > 16_000) {
          this.auditStore.append({ id: crypto.randomUUID(), occurredAt: new Date(this.now()).toISOString(), category: "ERROR", summary: "Local model returned an invalid response.", actionStatus: "FAILED" });
          const failed = { status: 502, body: { error: "Local model returned an invalid response." } };
          this.cacheInference(request.requestId, failed); return failed;
        }
        const durationMs = Number.isSafeInteger(result?.durationMs) ? result.durationMs : Math.max(0, this.now() - started);
        this.auditStore.append({ id: crypto.randomUUID(), occurredAt: new Date(this.now()).toISOString(), category: "SYSTEM", summary: "Completed a bounded local-model request.", details: `Model: ${WORLD_MODEL}; output: ${content.length} characters.`, actionStatus: "SUCCEEDED", durationMs: Math.min(durationMs, 15 * 60_000) });
        const completed = { status: 200, body: { requestId: request.requestId, model: WORLD_MODEL, content, durationMs } };
        this.cacheInference(request.requestId, completed); return completed;
      } catch {
        this.auditStore.append({ id: crypto.randomUUID(), occurredAt: new Date(this.now()).toISOString(), category: "ERROR", summary: "Local model request failed.", actionStatus: "FAILED" });
        const failed = { status: 502, body: { error: "Local model request failed." } };
        this.cacheInference(request.requestId, failed); return failed;
      } finally { this.inferenceActive = false; }
    }
    if (method === "POST" && pathname === "/v1/audit") {
      try { return { status: 201, body: { event: this.auditStore.append(body) } }; }
      catch (error) {
        const denial = this.recordSecurityDenial("Rejected an invalid audit submission.", error.message);
        return { status: 400, body: { error: "Invalid audit event.", denialSequence: denial?.sequence ?? null } };
      }
    }
    if (method === "GET" && pathname === "/v1/control") {
      const state = await this.getControlState();
      return { status: 200, body: { paused: Boolean(state?.paused), heartbeatMinutes: state?.heartbeatMinutes ?? 15, revision: state?.revision ?? 0 } };
    }
    this.recordSecurityDenial("Rejected an unavailable World Bridge operation.");
    return { status: 404, body: { error: "Operation unavailable." } };
  }
  cacheInference(requestId, response) {
    this.inferenceResults.set(requestId, response);
    while (this.inferenceResults.size > 128) this.inferenceResults.delete(this.inferenceResults.keys().next().value);
  }
}

module.exports = { WorldBridge, WorldAuditStore, WorldControlStore, WorldChatStore, WORLD_MODEL, EVENT_CATEGORIES, buildWorldInferencePayload, validateAuditEvent, validateInferenceRequest };
