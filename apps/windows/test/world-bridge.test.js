"use strict";

const assert = require("node:assert/strict");
const { validateAuditEvent, validateInferenceRequest, WorldAuditStore, WorldControlStore, WorldChatStore, WorldBridge, WORLD_MODEL } = require("../src/world-bridge");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const event = () => ({
  id: "550e8400-e29b-41d4-a716-446655440000",
  occurredAt: new Date().toISOString(),
  category: "RESULT",
  summary: "Created a project file.",
  details: "projects/example/README.md",
  actionStatus: "SUCCEEDED",
});

assert.equal(validateAuditEvent(event()).summary, "Created a project file.");
assert.throws(() => validateAuditEvent({ ...event(), category: "EXECUTE_HOST" }), /category/i);
assert.throws(() => validateAuditEvent({ ...event(), summary: "x".repeat(281) }), /summary/i);
assert.throws(() => validateAuditEvent({ ...event(), unexpected: "host command" }), /field/i);
assert.throws(() => validateAuditEvent({ ...event(), occurredAt: "not a timestamp" }), /timestamp/i);

async function main() {
const auditRows = [];
let paused = false;
let inferenceCalls = 0;
const bridge = new WorldBridge({
  token: "a".repeat(43),
  auditStore: { append: value => { const row = { ...validateAuditEvent(value), sequence: auditRows.length + 1 }; auditRows.push(row); return row; } },
  infer: async (_messages, _limit, options) => { inferenceCalls += 1; return { content: "Local inference result.", durationMs: 15, model: options.model }; },
  getControlState: async () => ({ paused, heartbeatMinutes: 20, revision: 4 }),
});
const request = { requestId: "550e8400-e29b-41d4-a716-446655440001", messages: [{ role: "user", content: "What should I explore?" }], maxOutputTokens: 256 };
assert.equal(validateInferenceRequest(request).messages.length, 1);
assert.throws(() => validateInferenceRequest({ ...request, model: "attacker-selected-model" }), /field/i);
assert.throws(() => validateInferenceRequest({ ...request, tools: [{ name: "run_windows_command" }] }), /field/i);
assert.throws(() => validateInferenceRequest({ ...request, messages: [{ role: "tool", content: "x" }] }), /role/i);
assert.equal((await bridge.dispatch({ method: "POST", pathname: "/v1/infer", authorization: "Bearer wrong", body: request })).status, 401);
assert.equal(inferenceCalls, 0);
assert.equal(auditRows.filter(row => row.category === "SECURITY_DENIAL").length, 1);
const response = await bridge.dispatch({ method: "POST", pathname: "/v1/infer", authorization: `Bearer ${"a".repeat(43)}`, body: request });
assert.equal(response.status, 200);
assert.equal(response.body.model, WORLD_MODEL);
assert.equal(inferenceCalls, 1);
assert.equal((await bridge.dispatch({ method: "POST", pathname: "/v1/infer", authorization: `Bearer ${"a".repeat(43)}`, body: request })).status, 200);
assert.equal(inferenceCalls, 1, "duplicate requests reuse the bounded result");
assert.equal(auditRows.filter(row => row.category === "SYSTEM").length, 1, "host audit confirms a model call without storing its content");
paused = true;
assert.equal((await bridge.dispatch({ method: "POST", pathname: "/v1/infer", authorization: `Bearer ${"a".repeat(43)}`, body: { ...request, requestId: "550e8400-e29b-41d4-a716-446655440002" } })).status, 423);
assert.equal(inferenceCalls, 1);
assert.equal((await bridge.dispatch({ method: "POST", pathname: "/v1/audit", authorization: `Bearer ${"a".repeat(43)}`, body: { ...event(), category: "host.command" } })).status, 400);
assert.equal(auditRows.filter(row => row.category === "SECURITY_DENIAL").length, 3);
assert.equal((await bridge.dispatch({ method: "GET", pathname: "/v1/ollama/api/pull", authorization: `Bearer ${"a".repeat(43)}`, body: {} })).status, 404);
assert.deepEqual((await bridge.dispatch({ method: "GET", pathname: "/v1/control", authorization: `Bearer ${"a".repeat(43)}`, body: {} })).body, { paused: true, heartbeatMinutes: 20, revision: 4 });
assert.equal((await bridge.dispatch({ method: "POST", pathname: "/v1/control", authorization: `Bearer ${"a".repeat(43)}`, body: { paused: false } })).status, 404);

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "junction-world-audit-"));
try {
  const store = new WorldAuditStore(directory, { rotateBytes: 100_000 });
  const first = store.append(event());
  assert.equal(first.sequence, 1);
  assert.equal(store.append(event()).sequence, 1, "duplicate event IDs are idempotent");
  assert.equal(store.listSince(0).length, 1);
  assert.throws(() => store.update(first.id, { summary: "rewritten" }), /append.only/i);
  assert.throws(() => store.delete(first.id), /append.only/i);
  assert.equal(store.listSince(0)[0].summary, "Created a project file.");
  const controls = new WorldControlStore(path.join(directory, "controls.json"));
  assert.equal(controls.get().paused, true, "autonomy starts paused by default");
  assert.throws(() => controls.set({ paused: false, heartbeatMinutes: 1 }), /10 and 120/);
  assert.equal(controls.set({ paused: false, heartbeatMinutes: 20 }).revision, 1);
  assert.equal(new WorldControlStore(path.join(directory, "controls.json")).get().paused, false, "host control persists across restart");
  const chat = new WorldChatStore(path.join(directory, "chat.jsonl"), { auditStore: store });
  const acceptedChat = chat.enqueue({ deviceId: "android-01", content: "Hello, Junction." });
  assert.equal(acceptedChat.status, "QUEUED");
  assert.equal(chat.enqueue({ deviceId: "android-01", content: "Hello, Junction.", messageId: acceptedChat.id }).id, acceptedChat.id, "Android retries reuse the same queued message");
  assert.equal(chat.nextPending()[0].content, "Hello, Junction.");
  assert.equal(chat.acknowledge(acceptedChat.id), true);
  assert.equal(chat.nextPending().length, 0, "acknowledged messages are not redelivered");
  assert.equal(chat.enqueue({ deviceId: "android-01", content: "Hello, Junction.", messageId: acceptedChat.id }).status, "DELIVERED", "a retry after delivery does not create another guest message");
  assert.throws(() => chat.enqueue({ deviceId: "android-01", content: "x".repeat(4001) }), /characters/i);
  assert.equal(new WorldChatStore(path.join(directory, "chat.jsonl"), { auditStore: store }).nextPending().length, 0, "delivery state survives restart");
  const rotating = new WorldAuditStore(path.join(directory, "rotation"), { rotateBytes: 350, archives: 2 });
  for (let index = 0; index < 8; index++) rotating.append({ ...event(), id: `550e8400-e29b-41d4-a716-${String(index).padStart(12, "0")}` });
  const rotationFiles = fs.readdirSync(path.join(directory, "rotation"));
  assert.ok(rotationFiles.filter(name => name.endsWith(".gz")).length <= 2, "compressed audit retention has a fixed archive limit");
  assert.ok(fs.statSync(path.join(directory, "rotation", "junction-world-audit.jsonl")).size <= 350, "active audit file remains bounded");
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

console.log("World bridge bounds fixed-model inference and validates append-only audit tests passed.");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
