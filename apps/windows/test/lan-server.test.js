"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { X509Certificate } = require("node:crypto");
const { test } = require("node:test");
const { LanServer, authMessage, certificateFingerprint, createTlsIdentity } = require("../src/lan-server");
const { LanDiscovery, SERVICE_TYPE } = require("../src/lan-discovery");
const lanServerSource = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/lan-server.js"), "utf8");
const mainSource = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/main.js"), "utf8");

class FakeSocket extends EventEmitter {
  constructor() { super(); this.sent = []; this.readyState = 1; }
  send(value) { this.sent.push(JSON.parse(value)); }
  close(code = 1000, reason = "") { this.readyState = 3; this.emit("close", code, reason); }
  receive(value) { this.emit("message", Buffer.from(JSON.stringify(value))); }
}

function identityFixture() {
  const keyPair = crypto.generateKeyPairSync("ed25519");
  return {
    keyPair,
    store: {
      getTlsIdentity: () => ({ key: "test-key", certificate: "test-cert" }),
      getInstanceMetadata: () => ({ instanceId: "pc-1", name: "Junction PC" }),
      setInstanceMetadata: () => {},
      getPairedAndroidKeys: () => ({ "phone-1": { publicKey: keyPair.publicKey.export({ type: "spki", format: "pem" }), expiresAt: Date.now() + 60_000 } }),
      getRevocationState: () => ({}),
    },
  };
}

async function authenticatedServer(runtime = {}) {
  const fixture = identityFixture();
  const server = new LanServer({ identityStore: fixture.store, runtime: { run: async () => ({ content: "answer" }), ...runtime }, now: () => 1_000 });
  const socket = new FakeSocket();
  server.accept(socket);
  socket.receive({ protocolVersion: 1, type: "hello", requestId: "h1", payload: { deviceId: "phone-1", certificateFingerprint: server.certificateFingerprint } });
  const challenge = socket.sent.find(message => message.type === "challenge");
  const signature = crypto.sign(null, Buffer.from(authMessage(challenge.payload.nonce, "pc-1", "phone-1")), fixture.keyPair.privateKey).toString("base64url");
  socket.receive({ protocolVersion: 1, type: "authenticate", requestId: "a1", payload: { deviceId: "phone-1", signature } });
  return { fixture, server, socket };
}

test("Android requestId cancellation aborts only its authenticated connection's run", async () => {
  let release, signal;
  const { server, socket } = await authenticatedServer({ run: async options => { signal = options.signal; await new Promise(resolve => { release = resolve; }); return { content: "unused" }; } });
  try {
    socket.receive({ protocolVersion: 1, type: "chat.send", requestId: "android-run", payload: { content: "hello" } });
    await new Promise(resolve => setImmediate(resolve));
    socket.receive({ protocolVersion: 1, type: "chat.cancel", requestId: "cancel-command", payload: { requestId: "android-run" } });
    assert.equal(socket.sent.at(-1).payload.cancelled, true);
    assert.equal(signal.aborted, true);
  } finally { release?.(); socket.close(); await server.stop(); }
});

test("rejects an explicit public or wildcard listener address", () => {
  for (const bindAddress of ["0.0.0.0", "8.8.8.8", "127.0.0.1"]) {
    assert.throws(() => new LanServer({ identityStore: identityFixture().store, bindAddress }), /private IPv4/);
  }
});

test("interface advertisers use distinct service names for the same trusted instance", () => {
  const { BonjourAdvertiser } = require("../src/lan-discovery");
  const configs = [];
  const advertiser = new BonjourAdvertiser({ bonjourFactory: () => ({ publish: config => { configs.push(config); return { records: () => [] }; } }) });
  advertiser.publish({ instanceId: "pc-1", address: "192.168.1.2", port: 43111, txt: { instanceId: "pc-1" } });
  advertiser.publish({ instanceId: "pc-1", address: "10.0.0.2", port: 43111, txt: { instanceId: "pc-1" } });
  assert.notEqual(configs[0].name, configs[1].name);
  assert.equal(configs[0].txt.instanceId, configs[1].txt.instanceId);
});

test("discovery teardown destroys its socket even when sending goodbye fails", () => {
  const { BonjourAdvertiser } = require("../src/lan-discovery");
  let destroyed = 0;
  const advertiser = new BonjourAdvertiser();
  advertiser.bonjour = { destroy() { destroyed++; } };
  advertiser.service = { stop() { throw new Error("adapter removed"); } };
  assert.doesNotThrow(() => advertiser.stop());
  assert.equal(destroyed, 1);
  advertiser.stop(); assert.equal(destroyed, 1);
});

test("authenticates a paired Ed25519 client with a pinned certificate fingerprint", async () => {
  const { server, socket } = await authenticatedServer();
  assert.equal(socket.sent.at(-1).type, "authenticated");
  assert.equal(server.connectionState(socket), "authenticated");
});

test("bootstraps LAN trust from an existing local-brain pairing and rejects a bad proof", async () => {
  const phone = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" }), publicKey = phone.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const sharedKey = crypto.randomBytes(32), brainId = crypto.randomBytes(32).toString("base64url"), paired = {};
  const fixture = identityFixture(); fixture.store.getPairedAndroidKeys = () => paired; fixture.store.setPairedAndroidKeys = value => Object.assign(paired, value);
  const server = new LanServer({ identityStore: fixture.store, getBootstrapState: () => ({ brainId, key: sharedKey.toString("base64url") }) });
  const nonce = crypto.randomUUID();
  const request = (socket, proof) => socket.receive({ protocolVersion: 1, type: "pair.bootstrap", requestId: "bootstrap", payload: { brainId, deviceId: "phone-1", publicKey, proof, nonce } });
  const message = `junction-lan-bootstrap-v2\n${brainId}\nphone-1\n${publicKey}\n${server.certificateFingerprint}\n${server.instanceId}\n${nonce}`;
  const valid = crypto.createHmac("sha256", sharedKey).update(`client\n${message}`).digest("base64url");
  const accepted = new FakeSocket(); server.accept(accepted); request(accepted, valid); await new Promise(resolve => setImmediate(resolve));
  assert.equal(accepted.sent[0].type, "authenticated"); assert.ok(paired["phone-1"]?.publicKey);
  assert.equal(accepted.sent[0].payload.serverProof, crypto.createHmac("sha256", sharedKey).update(`server\n${message}`).digest("base64url"));
  const signed = new FakeSocket(); server.accept(signed);
  signed.receive({ protocolVersion: 1, type: "hello", requestId: "h", payload: { deviceId: "phone-1", certificateFingerprint: server.certificateFingerprint } });
  signed.receive({ protocolVersion: 1, type: "authenticate", requestId: "a", payload: { deviceId: "phone-1", signature: crypto.sign("sha256", Buffer.from(authMessage(signed.sent[0].payload.nonce, server.instanceId, "phone-1")), phone.privateKey).toString("base64") } });
  assert.equal(server.connectionState(signed), "authenticated"); signed.close();
  const rejected = new FakeSocket(); server.accept(rejected); request(rejected, crypto.randomBytes(32).toString("base64url")); await new Promise(resolve => setImmediate(resolve));
  assert.equal(rejected.sent[0].type, "chat.error");
  fixture.store.getRevocationState = () => ({ "phone-1": { revokedAt: 0 } });
  const revoked = new FakeSocket(); server.accept(revoked); request(revoked, valid); await new Promise(resolve => setImmediate(resolve));
  assert.equal(revoked.sent[0].type, "chat.error");
});

test("creates a local TLS identity with a usable advertised DNS SAN", () => {
  assert.doesNotMatch(lanServerSource, /execFileSync|openssl/);
  let saved;
  const identity = createTlsIdentity({ getTlsIdentity: () => null, setTlsIdentity: (key, certificate) => { saved = { key, certificate }; } }, "pc-1");
  assert.match(identity.key, /BEGIN (?:RSA )?PRIVATE KEY/);
  assert.match(identity.certificate, /BEGIN CERTIFICATE/);
  assert.deepEqual(saved, identity);
  assert.match(new X509Certificate(identity.certificate).subjectAltName, /DNS:pc-1\.local/);
  const publicKeyDer = new X509Certificate(identity.certificate).publicKey.export({ type: "spki", format: "der" });
  assert.equal(certificateFingerprint(identity.certificate), crypto.createHash("sha256").update(publicKeyDer).digest("hex"));
});

test("scopes active runs and replay by connection plus request ID", async () => {
  const releases = [];
  const runtime = { run: async () => { await new Promise(resolve => releases.push(resolve)); return { content: "answer" }; } };
  const first = await authenticatedServer(runtime);
  const second = new FakeSocket(); first.server.accept(second);
  second.receive({ protocolVersion: 1, type: "hello", requestId: "h2", payload: { deviceId: "phone-1", certificateFingerprint: first.server.certificateFingerprint } });
  const challenge = second.sent.at(-1).payload;
  second.receive({ protocolVersion: 1, type: "authenticate", requestId: "a2", payload: { deviceId: "phone-1", signature: crypto.sign(null, Buffer.from(authMessage(challenge.nonce, "pc-1", "phone-1")), first.fixture.keyPair.privateKey).toString("base64url") } });
  first.socket.receive({ protocolVersion: 1, type: "chat.send", requestId: "same", payload: { content: "one" } });
  second.receive({ protocolVersion: 1, type: "chat.send", requestId: "same", payload: { content: "two" } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(first.server.runs.size, 2);
  second.receive({ protocolVersion: 1, type: "chat.cancel", requestId: "cancel", payload: { runId: "same" } });
  assert.equal(second.sent.at(-1).payload.cancelled, true);
  assert.equal(first.socket.sent.at(-1).payload.cancelled, undefined);
  releases.forEach(resolve => resolve()); await new Promise(resolve => setImmediate(resolve));
});

test("closes an authenticated socket when its pairing is later revoked or expired", async () => {
  const fixture = identityFixture(); let now = 1_000;
  const server = new LanServer({ identityStore: fixture.store, now: () => now });
  const socket = new FakeSocket(); server.accept(socket);
  socket.receive({ protocolVersion: 1, type: "hello", requestId: "h", payload: { deviceId: "phone-1", certificateFingerprint: server.certificateFingerprint } });
  const challenge = socket.sent.at(-1).payload;
  socket.receive({ protocolVersion: 1, type: "authenticate", requestId: "a", payload: { deviceId: "phone-1", signature: crypto.sign(null, Buffer.from(authMessage(challenge.nonce, "pc-1", "phone-1")), fixture.keyPair.privateKey).toString("base64url") } });
  now = 1_001; fixture.store.getRevocationState = () => ({ "phone-1": { revokedAt: 1_001 } });
  socket.receive({ protocolVersion: 1, type: "ping", requestId: "p", payload: {} });
  assert.equal(socket.readyState, 3);
  assert.equal(server.connectionState(socket), "closed");
  now = 1_000; const expired = await authenticatedServer();
  expired.fixture.store.getPairedAndroidKeys = () => ({ "phone-1": { publicKey: expired.fixture.keyPair.publicKey.export({ type: "spki", format: "pem" }), expiresAt: 999 } });
  expired.socket.receive({ protocolVersion: 1, type: "model.status", requestId: "m", payload: {} });
  assert.equal(expired.socket.readyState, 3);
});

test("bounds unauthenticated sockets and closes silent sockets by deadline", async () => {
  const fixture = identityFixture(); const server = new LanServer({ identityStore: fixture.store, maxUnauthenticatedConnections: 1, authTimeoutMs: 10 });
  const first = new FakeSocket(); server.accept(first); const excess = new FakeSocket(); server.accept(excess);
  assert.equal(excess.readyState, 3);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(first.readyState, 3);
});

test("rolls back listener, websocket, discovery, and metadata when startup setup fails", async () => {
  const fixture = identityFixture(); let metadata = { instanceId: "pc-1", port: 42 }; let stopped = 0; let closed = 0;
  const http = { createServer: () => { const server = new EventEmitter(); server.listen = (_port, _host, callback) => { server.address = () => ({ port: 1234 }); callback(); }; server.close = callback => { closed++; callback(); }; return server; } };
  const wssFactory = () => { const wss = new EventEmitter(); wss.close = callback => { closed++; callback(); }; return wss; };
  const discovery = { start: () => { throw new Error("discovery failed"); }, stop: () => { stopped++; } };
  fixture.store.getInstanceMetadata = () => metadata;
  fixture.store.setInstanceMetadata = value => { metadata = value; };
  const server = new LanServer({ identityStore: fixture.store, httpsImpl: http, wsServerFactory: wssFactory, discovery, bindAddress: "192.168.1.2" });
  await assert.rejects(() => server.start(), /discovery failed/);
  assert.equal(server.server, null); assert.equal(server.wss, null); assert.equal(stopped, 1); assert.equal(closed, 2); assert.deepEqual(metadata, { instanceId: "pc-1", port: 42 });
});

test("publishes a LAN server only after startup completes", () => {
  assert.match(mainSource, /const candidateLanServer = new LanRelayLifecycle/);
  assert.match(mainSource, /await candidateLanServer\.start\(\);\s*lanServer = candidateLanServer/);
  assert.doesNotMatch(mainSource, /catch \(error\) \{ recordStartupIssue\("LAN server unavailable", error\); lanServer = null; \}/);
});

test("enforces challenge expiry and rechecks pairing revocation during authentication", () => {
  const fixture = identityFixture();
  let now = 1_000;
  const server = new LanServer({ identityStore: fixture.store, now: () => now });
  const socket = new FakeSocket(); server.accept(socket);
  socket.receive({ protocolVersion: 1, type: "hello", requestId: "h1", payload: { deviceId: "phone-1", certificateFingerprint: server.certificateFingerprint } });
  const challenge = socket.sent.at(-1).payload;
  assert.equal(challenge.expiresAt, 61_000);
  now = 61_000;
  const signature = crypto.sign(null, Buffer.from(authMessage(challenge.nonce, "pc-1", "phone-1")), fixture.keyPair.privateKey).toString("base64url");
  socket.receive({ protocolVersion: 1, type: "authenticate", requestId: "a1", payload: { deviceId: "phone-1", signature } });
  assert.equal(socket.readyState, 3);

  now = 1_000;
  const revokedSocket = new FakeSocket(); server.accept(revokedSocket);
  revokedSocket.receive({ protocolVersion: 1, type: "hello", requestId: "h2", payload: { deviceId: "phone-1", certificateFingerprint: server.certificateFingerprint } });
  const revokedChallenge = revokedSocket.sent.at(-1).payload;
  fixture.store.getRevocationState = () => ({ "phone-1": { revokedAt: 1_000 } });
  const revokedSignature = crypto.sign(null, Buffer.from(authMessage(revokedChallenge.nonce, "pc-1", "phone-1")), fixture.keyPair.privateKey).toString("base64url");
  revokedSocket.receive({ protocolVersion: 1, type: "authenticate", requestId: "a2", payload: { deviceId: "phone-1", signature: revokedSignature } });
  assert.equal(revokedSocket.readyState, 3);
});

test("rejects fingerprint mismatch, unknown, expired, and revoked clients", () => {
  const fixture = identityFixture();
  const server = new LanServer({ identityStore: fixture.store, now: () => 10_000 });
  for (const payload of [
    { deviceId: "phone-1", certificateFingerprint: "wrong" },
    { deviceId: "unknown", certificateFingerprint: server.certificateFingerprint },
  ]) {
    const socket = new FakeSocket(); server.accept(socket);
    socket.receive({ protocolVersion: 1, type: "hello", requestId: "h1", payload });
    assert.equal(socket.readyState, 3);
  }
  fixture.store.getPairedAndroidKeys = () => ({ phone: { publicKey: "bad", expiresAt: 1 } });
  const expired = new FakeSocket(); server.accept(expired);
  expired.receive({ protocolVersion: 1, type: "hello", requestId: "h1", payload: { deviceId: "phone", certificateFingerprint: server.certificateFingerprint } });
  assert.equal(expired.readyState, 3);
  fixture.store.getPairedAndroidKeys = () => ({ phone: { publicKey: "bad", expiresAt: 20_000 } });
  fixture.store.getRevocationState = () => ({ phone: { revokedAt: 1 } });
  const revoked = new FakeSocket(); server.accept(revoked);
  revoked.receive({ protocolVersion: 1, type: "hello", requestId: "h1", payload: { deviceId: "phone", certificateFingerprint: server.certificateFingerprint } });
  assert.equal(revoked.readyState, 3);
});

test("streams chat deltas, prevents duplicate requests, and cancels active work", async () => {
  let resolveRun;
  const runtime = { run: async request => { request.onProgress({ text: "one" }); request.onProgress({ text: "one two" }); await new Promise(resolve => { resolveRun = resolve; }); return { content: "one two" }; } };
  const { server, socket } = await authenticatedServer(runtime);
  socket.receive({ protocolVersion: 1, type: "chat.send", requestId: "run_1", payload: { conversationId: "c1", content: "hello" } });
  socket.receive({ protocolVersion: 1, type: "chat.send", requestId: "run_1", payload: { conversationId: "c1", content: "hello" } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(socket.sent.filter(message => message.type === "chat.started").length, 1);
  socket.receive({ protocolVersion: 1, type: "chat.cancel", requestId: "cancel_1", payload: { runId: "run_1" } });
  assert.equal(socket.sent.at(-1).type, "chat.cancel");
  resolveRun();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(socket.sent.filter(message => message.type === "chat.delta").map(message => message.payload.text), ["one", " two"]);
  assert.equal(socket.sent.some(message => message.type === "chat.complete"), false);
});

test("cleans up a run when conversation lookup throws", async () => {
  const intervals = new Set();
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  global.setInterval = (...args) => { const timer = originalSetInterval(...args); intervals.add(timer); return timer; };
  global.clearInterval = timer => { intervals.delete(timer); return originalClearInterval(timer); };
  try {
    const { server, socket } = await authenticatedServer();
    server.localData = { conversation: () => { throw new Error("conversation failed"); } };
    await server.chat(socket, { requestId: "lookup_failure", payload: { content: "hello" } });
    assert.equal(server.runs.size, 0);
    assert.equal(intervals.size, 0);
  } finally {
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
  }
});

test("revokes an active stream before emitting later deltas or completion", async () => {
  let progress; let release;
  const fixture = identityFixture();
  const runtime = { run: async request => { progress = request.onProgress; progress({ text: "first" }); await new Promise(resolve => { release = resolve; }); return { content: "first second" }; } };
  const server = new LanServer({ identityStore: fixture.store, runtime, now: () => 1_000 });
  const socket = new FakeSocket(); server.accept(socket);
  socket.receive({ protocolVersion: 1, type: "hello", requestId: "h", payload: { deviceId: "phone-1", certificateFingerprint: server.certificateFingerprint } });
  const challenge = socket.sent.at(-1).payload;
  socket.receive({ protocolVersion: 1, type: "authenticate", requestId: "a", payload: { deviceId: "phone-1", signature: crypto.sign(null, Buffer.from(authMessage(challenge.nonce, "pc-1", "phone-1")), fixture.keyPair.privateKey).toString("base64url") } });
  socket.receive({ protocolVersion: 1, type: "chat.send", requestId: "run", payload: { content: "hello" } });
  await new Promise(resolve => setImmediate(resolve));
  fixture.store.getRevocationState = () => ({ "phone-1": { revokedAt: 1_000 } });
  progress({ text: "first second" }); release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(socket.readyState, 3);
  assert.deepEqual(socket.sent.filter(message => message.type === "chat.delta").map(message => message.payload.text), ["first"]);
  assert.equal(socket.sent.some(message => message.type === "chat.complete"), false);
});

test("watchdog aborts a stalled chat after pairing revocation without sending more output", async () => {
  const fixture = identityFixture();
  let aborted = false;
  const runtime = {
    run: async ({ signal }) => await new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => { aborted = true; reject(Object.assign(new Error("aborted"), { name: "AbortError" })); }, { once: true });
    }),
  };
  const server = new LanServer({ identityStore: fixture.store, runtime, now: () => 1_000, authorizationCheckMs: 10 });
  const socket = new FakeSocket(); server.accept(socket);
  socket.receive({ protocolVersion: 1, type: "hello", requestId: "h", payload: { deviceId: "phone-1", certificateFingerprint: server.certificateFingerprint } });
  const challenge = socket.sent.at(-1).payload;
  socket.receive({ protocolVersion: 1, type: "authenticate", requestId: "a", payload: { deviceId: "phone-1", signature: crypto.sign(null, Buffer.from(authMessage(challenge.nonce, "pc-1", "phone-1")), fixture.keyPair.privateKey).toString("base64url") } });
  socket.receive({ protocolVersion: 1, type: "chat.send", requestId: "stalled", payload: { content: "hello" } });
  await new Promise(resolve => setImmediate(resolve));
  const outputBeforeRevoke = socket.sent.length;
  fixture.store.getRevocationState = () => ({ "phone-1": { revokedAt: 1_000 } });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(aborted, true);
  assert.equal(socket.readyState, 3);
  assert.equal(server.runs.size, 0);
  assert.deepEqual(socket.sent.slice(outputBeforeRevoke).filter(message => ["chat.delta", "chat.complete"].includes(message.type)), []);
});

test("rejects non-TLS websocket upgrades before they reach the websocket server", async () => {
  const fixture = identityFixture(); let accepted = 0; let destroyed = 0;
  const http = { createServer: () => { const server = new EventEmitter(); server.listen = (_port, _host, callback) => { server.address = () => ({ port: 1234 }); callback(); }; server.close = callback => callback(); return server; } };
  const wssFactory = () => { const wss = new EventEmitter(); wss.close = callback => callback(); wss.on("connection", () => { accepted++; }); return wss; };
  const server = new LanServer({ identityStore: fixture.store, httpsImpl: http, wsServerFactory: wssFactory, discovery: { start() {}, stop() {} }, bindAddress: "192.168.1.2" });
  await server.start();
  const upgradeSocket = { destroy: () => { destroyed++; } };
  server.server.emit("upgrade", { socket: upgradeSocket }, upgradeSocket, Buffer.alloc(0));
  assert.equal(destroyed, 1); assert.equal(accepted, 0);
  await server.stop();
});

test("replays completed request IDs without starting a second generation and bounds replay state", async () => {
  let runs = 0;
  const { server, socket } = await authenticatedServer({ run: async () => { runs += 1; return { content: "answer" }; } });
  socket.receive({ protocolVersion: 1, type: "chat.send", requestId: "completed_1", payload: { content: "hello" } });
  await new Promise(resolve => setImmediate(resolve));
  socket.receive({ protocolVersion: 1, type: "chat.send", requestId: "completed_1", payload: { content: "hello" } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runs, 1);
  assert.equal(socket.sent.filter(message => message.type === "chat.complete").length, 2);
  for (let index = 0; index < 300; index += 1) socket.receive({ protocolVersion: 1, type: "chat.send", requestId: `done_${index}`, payload: { content: "hello" } });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(server.replayCache.size <= 256);
});

test("advertises only the Junction service metadata", () => {
  const published = [];
  const discovery = new LanDiscovery({ advertiser: { publish: value => { published.push(value); return { stop() {} }; } } });
  discovery.start({ instanceId: "pc-1", port: 1234, certificateFingerprint: "fp", secret: "never" });
  assert.equal(published[0].type, SERVICE_TYPE);
  assert.deepEqual(published[0].txt, { protocolVersion: "1", instanceId: "pc-1", certificateFingerprint: "fp" });
  assert.equal(JSON.stringify(published).includes("never"), false);
});

test("answers service and address-resolution queries on the selected bind address", () => {
  const responses = [];
  const mdns = { on() {}, respond(value) { responses.push(value); }, removeListener() {}, destroy() {} };
  const advertiser = new (require("../src/lan-discovery").MulticastDnsAdvertiser)({ mdnsFactory: () => mdns });
  advertiser.publish({ instanceId: "pc-1", port: 1234, address: "192.168.1.20", txt: { protocolVersion: "1" } });
  for (const question of [
    { name: SERVICE_TYPE + ".", type: "PTR" },
    { name: "pc-1." + SERVICE_TYPE + ".", type: "SRV" },
    { name: "pc-1." + SERVICE_TYPE + ".", type: "TXT" },
    { name: "pc-1.local.", type: "A" },
    { name: "pc-1.local.", type: "AAAA" },
  ]) advertiser.answer({ questions: [question] });
  assert.equal(responses.length, 5);
  assert.deepEqual(responses[0].additionals.map(record => record.type), ["SRV", "TXT", "A"]);
  assert.equal(responses[3].answers[0].data, "192.168.1.20");
  assert.equal(JSON.stringify(responses).includes("secret"), false);
});

test("handles mDNS errors without an unhandled error event", () => {
  const mdns = new EventEmitter(); let destroyed = 0; mdns.destroy = () => { destroyed++; };
  const advertiser = new (require("../src/lan-discovery").MulticastDnsAdvertiser)({ mdnsFactory: () => mdns });
  advertiser.publish({ instanceId: "pc-1", port: 1234, address: "192.168.1.20", txt: {} });
  assert.doesNotThrow(() => mdns.emit("error", new Error("socket unavailable")));
  assert.equal(destroyed, 1); assert.equal(advertiser.mdns, null); assert.match(advertiser.lastError.message, /socket unavailable/);
});
