"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { WorldHostRelay } = require("../src/world-host-relay");

const event = { id: "550e8400-e29b-41d4-a716-446655440010", occurredAt: new Date().toISOString(), category: "WAKE", summary: "Junction World woke." };

test("host relay polls only the fixed loopback guest route and validates audit output", async () => {
  const requests = []; let appended = 0;
  const auditStore = { append: value => { appended++; return { ...value, sequence: appended }; } };
  const controlStore = { get: () => ({ paused: false, heartbeatMinutes: 15, revision: 1 }) };
  const chatStore = { nextPending: () => [], acknowledge: () => true };
  const bridge = { token: "b".repeat(43), auditStore, dispatch: async request => {
    assert.equal(request.pathname, "/v1/audit");
    return { status: 201, body: { event: auditStore.append(request.body) } };
  } };
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options });
    if (options.method === "GET") return new Response(JSON.stringify({ auditEvents: [event], inferenceRequests: [] }), { status: 200 });
    if (String(url).endsWith("/v1/audit/ack")) return new Response(JSON.stringify({ acknowledged: true }), { status: 200 });
    throw new Error("Unexpected route");
  };
  const relay = new WorldHostRelay({ bridge, auditStore, controlStore, chatStore, fetchImpl });
  const result = await relay.pollOnce();
  assert.equal(result.state, "ONLINE");
  assert.equal(appended, 1);
  assert.deepEqual(requests.map(request => request.url), ["http://127.0.0.1:43130/v1/poll", "http://127.0.0.1:43130/v1/audit/ack"]);
  assert.ok(requests.every(request => !Object.hasOwn(request.options.headers, "authorization")), "no bridge secret is copied into the guest");
});

test("host relay rejects unknown poll fields without forwarding them", async () => {
  const auditStore = { append() { throw new Error("must not append"); } };
  const bridge = { token: "c".repeat(43), auditStore, dispatch: async () => { throw new Error("must not dispatch"); } };
  const relay = new WorldHostRelay({ bridge, auditStore, controlStore: { get: () => ({ paused: true, heartbeatMinutes: 15, revision: 0 }) }, chatStore: { nextPending: () => [] }, fetchImpl: async () => new Response(JSON.stringify({ auditEvents: [], inferenceRequests: [], command: "run" }), { status: 200 }) });
  const result = await relay.pollOnce();
  assert.equal(result.state, "ERROR");
  assert.equal(result.lastError, "INVALID_GUEST_RESPONSE");
});

test("host relay acknowledges a schema-rejected audit event after recording the denial", async () => {
  const rejected = { ...event, category: "RUN_HOST_COMMAND" };
  const requests = [];
  const auditStore = { append() { return null; } };
  const bridge = { token: "d".repeat(43), auditStore, dispatch: async () => ({ status: 400, body: { error: "Invalid audit event." } }), recordSecurityDenial() {} };
  const relay = new WorldHostRelay({ bridge, auditStore, controlStore: { get: () => ({ paused: true, heartbeatMinutes: 15, revision: 0 }) }, chatStore: { nextPending: () => [] }, fetchImpl: async (url, options) => {
    requests.push({ url: String(url), body: options.body });
    if (options.method === "GET") return new Response(JSON.stringify({ auditEvents: [rejected], inferenceRequests: [] }), { status: 200 });
    return new Response(JSON.stringify({ acknowledged: true }), { status: 200 });
  } });
  await relay.pollOnce();
  assert.deepEqual(JSON.parse(requests[1].body), { ids: [event.id] });
});

test("host relay refreshes guest controls while an audit poll is still pending", async () => {
  const requests = [];
  let releasePoll;
  const auditStore = { append() { return null; } };
  const bridge = { token: "e".repeat(43), auditStore, dispatch: async () => ({ status: 201, body: {} }) };
  const relay = new WorldHostRelay({ bridge, auditStore, controlStore: { get: () => ({ paused: true, heartbeatMinutes: 15, revision: 4 }) }, chatStore: { nextPending: () => [] }, onlineIntervalMs: 1_000, offlineIntervalMs: 5, controlIntervalMs: 5, fetchImpl: async (url, options) => {
    requests.push({ url: String(url), method: options.method, body: options.body });
    if (String(url).endsWith("/v1/poll")) return await new Promise(resolve => { releasePoll = () => resolve(new Response(JSON.stringify({ auditEvents: [], inferenceRequests: [] }), { status: 200 })); });
    return new Response(JSON.stringify({ accepted: true }), { status: 200 });
  } });
  relay.start();
  for (let attempt = 0; attempt < 20 && !requests.some(request => request.url.endsWith("/v1/control")); attempt++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(requests.some(request => request.url.endsWith("/v1/control") && request.method === "POST"), "control heartbeat is independent of a pending audit poll");
  releasePoll();
  await relay.stop();
});
