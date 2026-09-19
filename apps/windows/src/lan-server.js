"use strict";

const crypto = require("node:crypto");
const https = require("node:https");
const os = require("node:os");
const selfsigned = require("selfsigned");
const { WebSocketServer } = require("ws");
const { LanDiscovery } = require("./lan-discovery");
const { MAX_FRAME_BYTES, parseEnvelope, serializeEnvelope, isExpired, isRevoked } = require("./lan-protocol");

const PRIVATE_IPV4 = ip => {
  const octets = String(ip).split(".").map(Number);
  return octets.length === 4 && octets.every(value => Number.isInteger(value) && value >= 0 && value <= 255) &&
    ((octets[0] === 10) || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31));
};
function selectPrivateIPv4(bindAddress) {
  if (bindAddress) { if (!PRIVATE_IPV4(bindAddress)) throw new Error("LAN server bind address must be a private IPv4 address."); return bindAddress; }
  for (const interfaces of Object.values(os.networkInterfaces())) for (const entry of interfaces || []) if (entry.family === "IPv4" && !entry.internal && PRIVATE_IPV4(entry.address)) return entry.address;
  throw new Error("No private IPv4 LAN interface is available.");
}
function privateIPv4Addresses() {
  return [...new Set(Object.values(os.networkInterfaces()).flatMap(entries => (entries || []).filter(entry => (entry.family === "IPv4" || entry.family === 4) && !entry.internal && PRIVATE_IPV4(entry.address)).map(entry => entry.address)))].sort();
}
function certificateFingerprint(certificate) {
  try {
    const publicKey = new crypto.X509Certificate(certificate).publicKey.export({ type: "spki", format: "der" });
    return crypto.createHash("sha256").update(publicKey).digest("hex");
  } catch {
    // Test doubles may not contain a parseable certificate; production identities always do.
    return crypto.createHash("sha256").update(String(certificate)).digest("hex");
  }
}
function authMessage(nonce, instanceId, deviceId) { return `junction-lan-v1\n${nonce}\n${instanceId}\n${deviceId}`; }
function redactedError(error) { return String(error?.message || error || "LAN request failed").replace(/[\r\n]/g, " ").slice(0, 500); }
function createTlsIdentity(identityStore, advertisedHost = "junction.local", advertisedAddress = null) {
  const existing = identityStore.getTlsIdentity?.(); if (existing?.key && existing?.certificate) return existing;
  try {
    const altNames = [{ type: 2, value: `${String(advertisedHost).replace(/\.local$/i, "")}.local` }];
    if (advertisedAddress && PRIVATE_IPV4(advertisedAddress)) altNames.push({ type: 7, ip: advertisedAddress });
    const generated = selfsigned.generate([{ name: "commonName", value: "Junction LAN" }], { keySize: 2048, days: 3650, algorithm: "sha256", extensions: [{ name: "basicConstraints", cA: true }, { name: "keyUsage", keyCertSign: true, digitalSignature: true, keyEncipherment: true }, { name: "subjectAltName", altNames }] });
    const value = { key: generated.private, certificate: generated.cert };
    identityStore.setTlsIdentity(value.key, value.certificate); return value;
  } catch (error) { throw new Error(`Unable to create the local LAN TLS identity: ${redactedError(error)}`); }
}

class LanServer {
  constructor({ identityStore, localData = null, runtime = null, discovery = null, getBootstrapState = null, httpsImpl = https, wsServerFactory = options => new WebSocketServer(options), bindAddress = null, port = 0, now = () => Date.now(), heartbeatMs = 30_000, maxUnauthenticatedConnections = 32, authTimeoutMs = 15_000, authorizationCheckMs = 1_000 } = {}) {
    if (!identityStore) throw new Error("LAN identity store is required.");
    this.identityStore = identityStore; this.localData = localData; this.runtime = runtime; this.discovery = discovery || new LanDiscovery(); this.getBootstrapState = getBootstrapState; this.https = httpsImpl; this.wsServerFactory = wsServerFactory; this.bindAddress = bindAddress; this.port = port; this.now = now; this.heartbeatMs = heartbeatMs; this.maxUnauthenticatedConnections = maxUnauthenticatedConnections; this.authTimeoutMs = authTimeoutMs; this.authorizationCheckMs = authorizationCheckMs; this.connections = new Map(); this.runs = new Map(); this.replayCache = new Map(); this.server = null; this.wss = null; this.heartbeat = null;
    this.instance = identityStore.getInstanceMetadata?.() || {}; this.instanceId = this.instance.instanceId || crypto.randomUUID(); this.bindHost = selectPrivateIPv4(bindAddress); const tls = createTlsIdentity(identityStore, this.instanceId, this.bindHost); this.tls = tls; this.certificateFingerprint = certificateFingerprint(tls.certificate);
    if (!this.instance.instanceId) { this.instance = { ...this.instance, instanceId: this.instanceId }; identityStore.setInstanceMetadata?.(this.instance); }
  }
  connectionState(socket) { return this.connections.get(socket)?.state || "closed"; }
  info() { return { host: this.bindHost, port: this.port, instanceId: this.instanceId, certificateFingerprint: this.certificateFingerprint }; }
  isHealthy() { return !!this.server?.listening && !this.listenerError && !this.discovery.advertiser?.lastError; }
  send(socket, type, requestId, payload = {}) { if (socket.readyState !== 1) return false; socket.send(serializeEnvelope(type, requestId, payload)); return true; }
  reject(socket, message) { try { this.send(socket, "chat.error", "error", { code: "LAN_AUTH_FAILED", message: redactedError(message) }); } catch {} try { socket.close(1008, "LAN authentication failed"); } catch {} }
  accept(socket) {
    if ([...this.connections.values()].filter(state => state.state !== "authenticated").length >= this.maxUnauthenticatedConnections) return this.reject(socket, "Too many unauthenticated LAN connections.");
    const state = { state: "connected", connectionId: crypto.randomUUID(), deviceId: null, nonce: null, challengeExpiresAt: 0, runs: new Set(), alive: true, authTimer: null }; this.connections.set(socket, state);
    state.authTimer = setTimeout(() => { if (state.state !== "authenticated") this.reject(socket, "LAN authentication deadline exceeded."); }, this.authTimeoutMs);
    socket.on("message", raw => this.message(socket, raw)); socket.on("pong", () => { state.alive = true; }); socket.on("close", () => this.disconnect(socket)); socket.on("error", () => this.disconnect(socket));
    return socket;
  }
  async message(socket, raw) {
    const state = this.connections.get(socket); if (!state) return;
    let envelope; try { envelope = parseEnvelope(raw); } catch (error) { return this.reject(socket, error); }
    try {
      if (state.state !== "authenticated") return envelope.type === "pair.bootstrap" ? this.bootstrapPair(socket, envelope) : envelope.type === "pair" ? this.pair(socket, envelope) : envelope.type === "hello" ? this.hello(socket, envelope) : envelope.type === "authenticate" ? this.authenticate(socket, envelope) : this.reject(socket, "Authentication required.");
      if (!this.authorized(socket)) return;
      if (envelope.type === "ping") return this.send(socket, "pong", envelope.requestId, {});
      if (envelope.type === "chat.send") return this.chat(socket, envelope);
      if (envelope.type === "chat.cancel") return this.cancel(socket, envelope);
      if (envelope.type === "conversation.sync") return this.sync(socket, envelope);
      if (envelope.type === "conversation.deleted") return this.deleteConversation(socket, envelope);
      if (envelope.type === "model.status") return this.send(socket, "model.status", envelope.requestId, { instanceId: this.instanceId });
    } catch (error) { this.send(socket, "chat.error", envelope.requestId, { code: "LAN_REQUEST_FAILED", message: redactedError(error) }); }
  }
  hello(socket, envelope) {
    const { deviceId, certificateFingerprint: fingerprint } = envelope.payload, paired = this.identityStore.getPairedAndroidKeys?.()[deviceId];
    const revoked = this.identityStore.getRevocationState?.()[deviceId];
    if (fingerprint !== this.certificateFingerprint || !paired || isExpired(paired, this.now()) || isRevoked(revoked, this.now())) return this.reject(socket, "Unknown, expired, revoked, or mismatched LAN identity.");
    const state = this.connections.get(socket); state.deviceId = deviceId; state.nonce = crypto.randomBytes(32).toString("base64url"); state.pairing = paired; state.challengeExpiresAt = this.now() + 60_000; state.state = "challenged";
    this.send(socket, "challenge", envelope.requestId, { nonce: state.nonce, instanceId: this.instanceId, certificateFingerprint: this.certificateFingerprint, expiresAt: state.challengeExpiresAt });
  }
  authenticate(socket, envelope) {
    const state = this.connections.get(socket);
    let valid = false;
    try {
      const signature = Buffer.from(String(envelope.payload.signature || ""), "base64url");
      const paired = this.identityStore.getPairedAndroidKeys?.()[state.deviceId];
      const revoked = this.identityStore.getRevocationState?.()[state.deviceId];
      const verificationKey = typeof paired?.publicKey === "string"
        ? (paired.publicKey.includes("BEGIN") ? crypto.createPublicKey(paired.publicKey) : crypto.createPublicKey({ key: Buffer.from(paired.publicKey, "base64"), format: "der", type: "spki" }))
        : paired?.publicKey;
      valid = state.state === "challenged" && this.now() < state.challengeExpiresAt && envelope.payload.deviceId === state.deviceId && paired && !isExpired(paired, this.now()) && !isRevoked(revoked, this.now()) && verificationKey && crypto.verify(verificationKey.asymmetricKeyType === "ec" ? "sha256" : null, Buffer.from(authMessage(state.nonce, this.instanceId, state.deviceId)), verificationKey, signature);
    } catch {}
    if (!valid) return this.reject(socket, "Invalid LAN authentication signature.");
    state.pairing = this.identityStore.getPairedAndroidKeys()[state.deviceId]; state.state = "authenticated"; clearTimeout(state.authTimer); state.authTimer = null; this.send(socket, "authenticated", envelope.requestId, { instanceId: this.instanceId, certificateFingerprint: this.certificateFingerprint });
  }
  pair(socket, envelope) {
    const payload = envelope.payload || {}, token = String(payload.token || ""), deviceId = String(payload.deviceId || ""), publicKey = String(payload.publicKey || "");
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(token) || !/^[A-Za-z0-9_-]{1,128}$/.test(deviceId) || !/^[A-Za-z0-9+/=_-]{40,256}$/.test(publicKey)) return this.reject(socket, "Invalid LAN pairing request.");
    let key;
    try { key = crypto.createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" }); } catch { return this.reject(socket, "Invalid Android public key."); }
    const entry = this.identityStore.consumeOneTimeToken?.(token, this.now());
    if (!entry || entry.instanceId !== this.instanceId) return this.reject(socket, "LAN pairing token is invalid or expired.");
    const paired = this.identityStore.getPairedAndroidKeys?.() || {};
    paired[deviceId] = { publicKey: key.export({ format: "der", type: "spki" }).toString("base64"), pairedAt: this.now(), expiresAt: Number.MAX_SAFE_INTEGER };
    this.identityStore.setPairedAndroidKeys(paired);
    this.send(socket, "authenticated", envelope.requestId, { paired: true, instanceId: this.instanceId, certificateFingerprint: this.certificateFingerprint });
    try { socket.close(1000, "paired"); } catch {}
  }
  async bootstrapPair(socket, envelope) {
    const payload = envelope.payload || {}, brainId = String(payload.brainId || ""), deviceId = String(payload.deviceId || ""), publicKey = String(payload.publicKey || ""), proofText = String(payload.proof || "");
    if (!this.getBootstrapState || !/^[A-Za-z0-9_-]{32,128}$/.test(brainId) || !/^[A-Za-z0-9_-]{1,128}$/.test(deviceId)) return this.reject(socket, "LAN bootstrap is unavailable.");
    const bootstrap = await this.getBootstrapState();
    if (!bootstrap || bootstrap.brainId !== brainId || typeof bootstrap.key !== "string") return this.reject(socket, "LAN bootstrap identity mismatch.");
    let key; try { key = crypto.createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" }); } catch { return this.reject(socket, "Invalid Android public key."); }
    const nonce = String(payload.nonce || "");
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(nonce) || isRevoked(this.identityStore.getRevocationState?.()[deviceId], this.now())) return this.reject(socket, "Invalid or revoked bootstrap identity.");
    if (!["ed25519", "ec"].includes(key.asymmetricKeyType)) return this.reject(socket, "Unsupported Android signing key.");
    const message = `junction-lan-bootstrap-v2\n${brainId}\n${deviceId}\n${publicKey}\n${this.certificateFingerprint}\n${this.instanceId}\n${nonce}`;
    const mac = role => crypto.createHmac("sha256", Buffer.from(bootstrap.key, "base64url")).update(`${role}\n${message}`).digest();
    const expected = mac("client");
    let supplied; try { supplied = Buffer.from(proofText, "base64url"); } catch { return this.reject(socket, "Invalid LAN bootstrap proof."); }
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return this.reject(socket, "Invalid LAN bootstrap proof.");
    const paired = this.identityStore.getPairedAndroidKeys?.() || {};
    paired[deviceId] = { publicKey: key.export({ format: "der", type: "spki" }).toString("base64"), pairedAt: this.now(), expiresAt: Number.MAX_SAFE_INTEGER };
    this.identityStore.setPairedAndroidKeys(paired);
    this.send(socket, "authenticated", envelope.requestId, { paired: true, instanceId: this.instanceId, certificateFingerprint: this.certificateFingerprint, serverProof: mac("server").toString("base64url") });
    try { socket.close(1000, "paired"); } catch {}
  }
  sync(socket, envelope) {
    const since = Number.isSafeInteger(envelope.payload?.sinceRevision) ? envelope.payload.sinceRevision : 0;
    const currentRevision = Number(this.localData?.lanRevision?.() || this.localData?.revision?.() || this.localData?.state?.lanRevision || 0);
    const events = this.localData?.lanEventsSince?.(since) || [];
    this.send(socket, "conversation.sync", envelope.requestId, { events, currentRevision });
  }
  deleteConversation(socket, envelope) {
    const id = String(envelope.payload?.conversationId || "");
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) throw new Error("Invalid conversation ID.");
    if (this.localData?.conversation(id)) this.localData.deleteConversation(id);
    this.send(socket, "conversation.deleted", envelope.requestId, { conversationId: id, currentRevision: this.localData?.lanRevision?.() || 0 });
  }
  authorized(socket, { reject = true } = {}) {
    const state = this.connections.get(socket); if (!state || state.state !== "authenticated") return false;
    const paired = this.identityStore.getPairedAndroidKeys?.()[state.deviceId]; const revoked = this.identityStore.getRevocationState?.()[state.deviceId];
    if (!paired || isExpired(paired, this.now()) || isRevoked(revoked, this.now())) { if (reject) this.reject(socket, "LAN authorization expired or revoked."); return false; }
    state.pairing = paired; return true;
  }
  runKey(state, requestId) { return `${state.connectionId}:${requestId}`; }
  async chat(socket, envelope) {
    const state = this.connections.get(socket), replayKey = this.runKey(state, envelope.requestId), replay = this.replayCache.get(replayKey);
    if (replay) { for (const event of replay) this.send(socket, event.type, envelope.requestId, event.payload); return; }
    if (state.runs.has(replayKey)) return this.send(socket, "chat.error", envelope.requestId, { code: "LAN_DUPLICATE_REQUEST", message: "Duplicate request ID." });
    const payload = envelope.payload, controller = new AbortController(), content = String(payload.content || "").trim(), events = [];
    if (!content) throw new Error("LAN chat content cannot be blank.");
    if (content.length > 20_000) throw new Error("LAN chat content is too long.");
    const emit = (type, payload = {}) => { events.push({ type, payload }); this.send(socket, type, envelope.requestId, payload); };
    const run = { socket, controller, authorizationTimer: null };
    try {
      this.runs.set(replayKey, run); state.runs.add(replayKey);
      run.authorizationTimer = setInterval(() => {
        if (this.authorized(socket, { reject: false })) return;
        controller.abort();
        this.disconnect(socket);
        try { socket.close(1008, "LAN authorization expired or revoked."); } catch {}
      }, this.authorizationCheckMs);
      emit("chat.started", { conversationId: payload.conversationId || null });
      let conversation = this.localData?.conversation(payload.conversationId) || this.localData?.createConversation?.(payload.conversationId);
      if (conversation && this.localData?.addMessage) { this.localData.addMessage(conversation.id, "user", String(payload.content || ""), "OWNER"); conversation = this.localData.conversation(conversation.id); }
      if (!this.runtime?.run) throw new Error("LAN model runtime is unavailable.");
      let streamed = "";
      const result = await this.runtime.run({ goal: content, model: payload.model, history: conversation?.messages?.slice(0, -1) || [], memories: this.localData?.memories?.() || [], context: payload.context || null, signal: controller.signal, runId: envelope.requestId, onProgress: progress => { if (!this.authorized(socket)) { controller.abort(); return; } const text = String(progress?.text || ""); const delta = text.startsWith(streamed) ? text.slice(streamed.length) : text; streamed = text; if (delta && !controller.signal.aborted) emit("chat.delta", { text: delta }); } });
      if (controller.signal.aborted || !this.authorized(socket)) { controller.abort(); return; }
      const assistantMessage = conversation && this.localData?.addMessage ? this.localData.addMessage(conversation.id, "assistant", String(result?.content || streamed), "JUNCTION") : null;
      emit("chat.complete", { conversationId: conversation?.id || payload.conversationId || null, messageId: assistantMessage?.id || null, content: result?.content || streamed, model: result?.model || payload.model || null, usage: result?.usage || null });
    } catch (error) { if (!controller.signal.aborted) emit("chat.error", { code: error?.name === "AbortError" ? "LAN_CANCELLED" : "LAN_MODEL_FAILED", message: redactedError(error) }); }
    finally { clearInterval(run.authorizationTimer); run.authorizationTimer = null; this.runs.delete(replayKey); state.runs.delete(replayKey); if (events.at(-1)?.type === "chat.complete" || events.at(-1)?.type === "chat.error") { this.replayCache.set(replayKey, events.slice(-1)); while (this.replayCache.size > 256) this.replayCache.delete(this.replayCache.keys().next().value); } }
  }
  cancel(socket, envelope) { const state = this.connections.get(socket), runId = envelope.payload.runId || envelope.payload.requestId || envelope.requestId, run = state && this.runs.get(this.runKey(state, runId)); if (!run || run.socket !== socket) return this.send(socket, "chat.cancel", envelope.requestId, { cancelled: false }); run.controller.abort(); return this.send(socket, "chat.cancel", envelope.requestId, { cancelled: true, runId }); }
  disconnect(socket) { const state = this.connections.get(socket); if (!state) return; clearTimeout(state.authTimer); for (const id of state.runs) { const run = this.runs.get(id); if (run) { clearInterval(run.authorizationTimer); run.authorizationTimer = null; run.controller.abort(); } } this.connections.delete(socket); }
  async start() {
    const host = this.bindHost || selectPrivateIPv4(this.bindAddress), previousPort = this.port, previousMetadata = this.instance; let server = null, wss = null, metadataSet = false, discoveryStarted = false;
    try {
      server = this.https.createServer({ key: this.tls.key, cert: this.tls.certificate }); wss = this.wsServerFactory({ server, maxPayload: MAX_FRAME_BYTES });
      server.prependListener?.("upgrade", (request, socket) => {
        if (!request?.socket?.encrypted) socket.destroy?.();
      });
      wss.on("connection", socket => this.accept(socket));
      await new Promise((resolve, reject) => { const failed = error => reject(error); server.once("error", failed); server.listen(this.port, host, () => { server.removeListener("error", failed); resolve(); }); });
      this.listenerError = null;
      server.on("error", error => { this.listenerError = error.code || "LAN_LISTENER_FAILED"; });
      const port = server.address().port; this.identityStore.setInstanceMetadata?.({ ...this.instance, instanceId: this.instanceId, port }); metadataSet = true; discoveryStarted = true; this.discovery.start({ instanceId: this.instanceId, port, address: host, certificateFingerprint: this.certificateFingerprint });
      this.server = server; this.wss = wss; this.port = port; this.heartbeat = setInterval(() => { for (const [socket, state] of this.connections) { if (!state.alive) { try { socket.terminate?.(); } catch {} this.disconnect(socket); } else { state.alive = false; socket.ping?.(); } } }, this.heartbeatMs);
      return { host, port, instanceId: this.instanceId, certificateFingerprint: this.certificateFingerprint };
    } catch (error) {
      if (discoveryStarted) { try { this.discovery.stop(); } catch {} }
      if (metadataSet) { try { this.identityStore.setInstanceMetadata?.(previousMetadata); } catch {} }
      try { await new Promise(resolve => wss?.close?.(() => resolve()) ?? resolve()); } catch {}
      try { await new Promise(resolve => server?.close?.(() => resolve()) ?? resolve()); } catch {}
      this.server = null; this.wss = null; this.port = previousPort; throw error;
    }
  }
  async stop() {
    clearInterval(this.heartbeat); this.heartbeat = null;
    for (const socket of this.connections.keys()) {
      this.disconnect(socket);
      try { socket.terminate ? socket.terminate() : socket.close(1001, "LAN server shutting down"); } catch {}
    }
    this.discovery.stop();
    await new Promise(resolve => this.wss?.close?.(() => resolve()) ?? resolve());
    if (this.server) { this.server.closeAllConnections?.(); await new Promise(resolve => this.server.close(() => resolve())); }
    this.server = null; this.wss = null; this.connections.clear(); this.runs.clear();
  }
}

module.exports = { LanServer, authMessage, certificateFingerprint, selectPrivateIPv4, privateIPv4Addresses, createTlsIdentity };
