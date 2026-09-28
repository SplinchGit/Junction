"use strict";

const FIXED_GUEST_ORIGIN = "http://127.0.0.1:43130";
const MAX_POLL_BYTES = 256 * 1024;
const MAX_EVENTS_PER_POLL = 100;
const MAX_INFER_PER_POLL = 4;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function exactKeys(value, required, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_GUEST_RESPONSE");
  const allowed = new Set([...required, ...optional]);
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !allowed.has(key))) throw new Error("INVALID_GUEST_RESPONSE");
}

class WorldHostRelay {
  constructor({ bridge, auditStore, controlStore, chatStore, fetchImpl = globalThis.fetch, now = () => Date.now(), onlineIntervalMs = 2_000, offlineIntervalMs = 30_000, controlIntervalMs = 2_000 } = {}) {
    if (!bridge || typeof bridge.dispatch !== "function" || !auditStore || !controlStore || !chatStore || typeof fetchImpl !== "function") throw new Error("Junction World relay dependencies are required.");
    this.bridge = bridge; this.auditStore = auditStore; this.controlStore = controlStore; this.chatStore = chatStore;
    this.fetch = fetchImpl; this.now = now; this.onlineIntervalMs = onlineIntervalMs; this.offlineIntervalMs = offlineIntervalMs;
    this.controlIntervalMs = controlIntervalMs;
    this.running = false; this.timer = null; this.controlTimer = null; this.pending = null; this.controlPending = null; this.state = "OFFLINE"; this.lastSuccessAt = null; this.lastError = null; this.pollCount = 0;
  }
  headers(control = this.controlStore.get()) {
    return { "content-type": "application/json", "x-junction-paused": control.paused ? "1" : "0", "x-junction-heartbeat-minutes": String(control.heartbeatMinutes), "x-junction-control-revision": String(control.revision) };
  }
  async request(path, method, body, control, { timeoutMs = 3_000 } = {}) {
    if (!["/v1/poll", "/v1/control", "/v1/messages", "/v1/inference-result", "/v1/audit/ack"].includes(path)) throw new Error("UNAVAILABLE_ROUTE");
    const response = await this.fetch(`${FIXED_GUEST_ORIGIN}${path}`, {
      method, redirect: "error", signal: AbortSignal.timeout(timeoutMs), headers: this.headers(control),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_POLL_BYTES) throw new Error("OVERSIZED_GUEST_RESPONSE");
    let value = {};
    if (bytes.length) { try { value = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("INVALID_GUEST_RESPONSE"); } }
    return { status: response.status, value };
  }
  async pollOnce() {
    if (this.pending) return this.pending;
    this.pending = this.performPoll().catch(error => {
      const code = ["INVALID_GUEST_RESPONSE", "OVERSIZED_GUEST_RESPONSE", "UNAVAILABLE_ROUTE"].includes(error.message) ? error.message : "GUEST_UNREACHABLE";
      this.state = code === "GUEST_UNREACHABLE" ? "OFFLINE" : "ERROR"; this.lastError = code;
      if (code !== "GUEST_UNREACHABLE") this.bridge.recordSecurityDenial?.("Rejected an invalid Junction World relay response.", code);
      return this.getStatus();
    }).finally(() => { this.pending = null; });
    return this.pending;
  }
  async performPoll() {
    const control = this.controlStore.get();
    const poll = await this.request("/v1/poll", "GET", undefined, control);
    if (poll.status !== 200) throw new Error("GUEST_UNREACHABLE");
    exactKeys(poll.value, ["auditEvents", "inferenceRequests"]);
    if (!Array.isArray(poll.value.auditEvents) || poll.value.auditEvents.length > MAX_EVENTS_PER_POLL || !Array.isArray(poll.value.inferenceRequests) || poll.value.inferenceRequests.length > MAX_INFER_PER_POLL) throw new Error("INVALID_GUEST_RESPONSE");
    const acceptedEventIds = [];
    for (const event of poll.value.auditEvents) {
      const result = await this.bridge.dispatch({ method: "POST", pathname: "/v1/audit", authorization: `Bearer ${this.bridge.token}`, body: event });
      if (result.status === 201 && result.body?.event?.id) acceptedEventIds.push(result.body.event.id);
      else if (result.status === 400 && typeof event?.id === "string" && UUID.test(event.id)) acceptedEventIds.push(event.id);
    }
    if (acceptedEventIds.length) {
      const ack = await this.request("/v1/audit/ack", "POST", { ids: acceptedEventIds }, control);
      if (ack.status !== 200 || ack.value.acknowledged !== true) throw new Error("INVALID_GUEST_RESPONSE");
    }
    for (const inference of poll.value.inferenceRequests) {
      const result = await this.bridge.dispatch({ method: "POST", pathname: "/v1/infer", authorization: `Bearer ${this.bridge.token}`, body: inference });
      const delivered = await this.request("/v1/inference-result", "POST", { requestId: inference?.requestId, status: result.status, response: result.body }, control);
      if (delivered.status !== 200 || delivered.value.accepted !== true) throw new Error("INVALID_GUEST_RESPONSE");
    }
    if (!control.paused) for (const message of this.chatStore.nextPending(8)) {
      const delivered = await this.request("/v1/messages", "POST", { id: message.id, conversationId: message.conversationId, deviceId: message.deviceId, content: message.content }, control);
      if (delivered.status === 200 && delivered.value.accepted === true) this.chatStore.acknowledge(message.id);
    }
    this.state = "ONLINE"; this.lastSuccessAt = new Date(this.now()).toISOString(); this.lastError = null; this.pollCount++;
    if (!this.controlPending) this.scheduleControl(0);
    return this.getStatus();
  }
  async performControl() {
    const control = this.controlStore.get();
    const response = await this.request("/v1/control", "POST", {}, control);
    exactKeys(response.value, ["accepted"]);
    if (response.status !== 200 || response.value.accepted !== true) throw new Error("INVALID_GUEST_RESPONSE");
  }
  getStatus() { return { state: this.state, lastSuccessAt: this.lastSuccessAt, lastError: this.lastError, pollCount: this.pollCount }; }
  async tick() {
    if (!this.running) return;
    await this.pollOnce();
    if (!this.running) return;
    this.timer = setTimeout(() => void this.tick(), this.state === "ONLINE" ? this.onlineIntervalMs : this.offlineIntervalMs);
    this.timer.unref?.();
  }
  scheduleControl(delayMs) {
    if (!this.running || this.controlPending) return;
    clearTimeout(this.controlTimer);
    this.controlTimer = setTimeout(() => void this.tickControl(), delayMs);
    this.controlTimer.unref?.();
  }
  async tickControl() {
    if (!this.running) return;
    this.controlPending = this.performControl().catch(error => {
      const code = ["INVALID_GUEST_RESPONSE", "OVERSIZED_GUEST_RESPONSE", "UNAVAILABLE_ROUTE"].includes(error.message) ? error.message : "GUEST_UNREACHABLE";
      this.lastError = code;
      if (code === "GUEST_UNREACHABLE") this.state = "OFFLINE";
      else { this.state = "ERROR"; this.bridge.recordSecurityDenial?.("Rejected an invalid Junction World control response.", code); }
    }).finally(() => {
      this.controlPending = null;
      if (!this.running) return;
      this.scheduleControl(this.state === "ONLINE" ? this.controlIntervalMs : this.offlineIntervalMs);
    });
    await this.controlPending;
  }
  start() { if (!this.running) { this.running = true; void this.tick(); void this.tickControl(); } }
  pollNow() { if (!this.running) return; clearTimeout(this.timer); this.timer = setTimeout(() => void this.tick(), 0); this.timer.unref?.(); }
  async stop() { this.running = false; clearTimeout(this.timer); clearTimeout(this.controlTimer); this.timer = null; this.controlTimer = null; await Promise.allSettled([this.pending, this.controlPending]); }
}

module.exports = { WorldHostRelay, FIXED_GUEST_ORIGIN };
