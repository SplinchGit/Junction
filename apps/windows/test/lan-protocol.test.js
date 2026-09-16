"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { LanIdentityStore } = require("../src/lan-identity");
const {
  PROTOCOL_VERSION,
  validateEnvelope,
  serializeEnvelope,
  parseEnvelope,
  serializeChatEvent,
  serializeAuthMessage,
  serializeConversationSyncRecord,
  isExpired,
  isRevoked,
} = require("../src/lan-protocol");
const { LocalDataStore } = require("../src/local-data");

const envelope = serializeEnvelope("chat.delta", "request_01", { text: "hello" });
assert.deepEqual(parseEnvelope(envelope), {
  protocolVersion: PROTOCOL_VERSION,
  type: "chat.delta",
  requestId: "request_01",
  payload: { text: "hello" },
});
assert.equal(validateEnvelope(JSON.parse(envelope)).type, "chat.delta");

assert.deepEqual(serializeChatEvent("chat.started", "run_1", { conversationId: "conversation_1" }), {
  protocolVersion: 1, type: "chat.started", requestId: "run_1", payload: { conversationId: "conversation_1" },
});
assert.deepEqual(serializeAuthMessage("authenticate", "auth_1", { nonce: "n", signature: "s" }), {
  protocolVersion: 1, type: "authenticate", requestId: "auth_1", payload: { nonce: "n", signature: "s" },
});
assert.deepEqual(serializeConversationSyncRecord("updated", "conversation_1", 3, { title: "A" }), {
  id: "conversation_1", revision: 3, kind: "updated", value: { title: "A" },
});
assert.throws(() => serializeConversationSyncRecord("unknown", "conversation_1", 3, {}), /conversation sync/i);
assert.throws(() => serializeConversationSyncRecord("updated", 42, 3, {}), /conversation sync/i);
assert.throws(() => serializeConversationSyncRecord("updated", "conversation_1", 3, { content: "x".repeat(60 * 1024) }), /size/i);

assert.throws(() => parseEnvelope(JSON.stringify({ protocolVersion: 2, type: "ping", requestId: "x", payload: {} })), /protocol/i);
assert.throws(() => serializeEnvelope("unknown", "x", {}), /type/i);
assert.throws(() => serializeEnvelope("ping", "x".repeat(161), {}), /request/i);
assert.throws(() => parseEnvelope("x".repeat(70_000)), /size/i);
assert.equal(isExpired({ expiresAt: 100 }, 101), true);
assert.equal(isExpired({ expiresAt: 100 }, 99), false);
assert.equal(isRevoked({ revokedAt: 100 }, 99), false);
assert.equal(isRevoked({ revokedAt: 100 }, 100), true);

const ignored = fs.readFileSync(path.join(__dirname, "..", ".gitignore"), "utf8");
for (const pattern of ["lan-tls", "lan-instance", "lan-pairing", "lan-revocation", "lan-tokens", "\\*.key", "\\*.crt", "\\*.pem"]) assert.match(ignored, new RegExp(pattern));

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "junction-lan-identity-test-"));
const MAX_ONE_TIME_TOKENS = 256;
const MAX_ONE_TIME_TOKEN_STORAGE_BYTES = 64 * 1024;
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(value, "utf8"),
  decryptString: value => Buffer.from(value).toString("utf8"),
};
const identity = new LanIdentityStore(directory, safeStorage);
const issued = identity.createOneTimeToken({ now: 1000, ttlMs: 1000, metadata: { pairing: true } });
assert.deepEqual(identity.consumeOneTimeToken(issued.token, 1500), { pairing: true, expiresAt: 2000, used: true });
assert.equal(identity.consumeOneTimeToken(issued.token, 1500), null);
assert.equal(identity.consumeOneTimeToken("not-issued", 1500), null);
assert.equal(identity.consumeOneTimeToken("__proto__", 1500), null);
assert.throws(() => identity.createOneTimeToken({ ttlMs: 0 }), /ttl/i);
assert.throws(() => identity.createOneTimeToken({ ttlMs: -1 }), /ttl/i);
assert.throws(() => identity.createOneTimeToken({ ttlMs: Infinity }), /ttl/i);
assert.throws(() => identity.createOneTimeToken({ ttlMs: "1000" }), /ttl/i);
assert.throws(() => identity.createOneTimeToken({ ttlMs: 5 * 60 * 1000 + 1 }), /ttl/i);
const expired = identity.createOneTimeToken({ now: 1000, ttlMs: 1000 });
assert.equal(identity.consumeOneTimeToken(expired.token, 2000), null);
identity.createOneTimeToken({ now: 3000, ttlMs: 1000 });
assert.equal(Object.keys(identity.getOneTimeTokens()).length, 1);
const boundedDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "junction-lan-identity-bound-test-"));
const boundedIdentity = new LanIdentityStore(boundedDirectory, safeStorage);
for (let index = 0; index < MAX_ONE_TIME_TOKENS; index += 1) {
  boundedIdentity.createOneTimeToken({ now: 4000, ttlMs: 5 * 60 * 1000 });
}
assert.equal(Object.keys(boundedIdentity.getOneTimeTokens()).length, MAX_ONE_TIME_TOKENS);
assert.throws(
  () => boundedIdentity.createOneTimeToken({ now: 4000, ttlMs: 5 * 60 * 1000 }),
  /maximum one-time token count/i,
);
assert.equal(Object.keys(boundedIdentity.getOneTimeTokens()).length, MAX_ONE_TIME_TOKENS);
assert.throws(
  () => boundedIdentity.setOneTimeTokens({ oversized: { expiresAt: 9000, used: false, note: "x".repeat(MAX_ONE_TIME_TOKEN_STORAGE_BYTES) } }),
  /one-time token storage size/i,
);
assert.throws(
  () => boundedIdentity.put("lan-tokens.bin", { oversized: { expiresAt: 9000, used: false, note: "x".repeat(MAX_ONE_TIME_TOKEN_STORAGE_BYTES) } }),
  /one-time token storage size/i,
);
assert.throws(
  () => boundedIdentity.put(".\\lan-tokens.bin", { oversized: { expiresAt: 9000, used: false, note: "x".repeat(MAX_ONE_TIME_TOKEN_STORAGE_BYTES) } }),
  /one-time token storage size/i,
);
assert.equal(Object.keys(boundedIdentity.getOneTimeTokens()).length, MAX_ONE_TIME_TOKENS);
fs.rmSync(boundedDirectory, { recursive: true, force: true });
identity.setInstanceMetadata({ instanceId: "pc", secret: "do-not-expose" });
identity.setPairedAndroidKeys({ phone: "public-key" });
assert.deepEqual(identity.status(), { instanceId: "pc", port: null, pairedDeviceCount: 1, pairedDeviceIds: ["phone"] });
assert.equal(JSON.stringify(identity.status()).includes("do-not-expose"), false);
fs.rmSync(directory, { recursive: true, force: true });

const snapshotDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "junction-lan-snapshot-test-"));
let callbackEvent;
const snapshotStore = new LocalDataStore(snapshotDirectory, event => {
  callbackEvent = event;
  event.value.conversation.title = "mutated by callback";
  throw new Error("callback failure");
});
const snapshotConversation = snapshotStore.createConversation();
assert.equal(snapshotStore.conversation(snapshotConversation.id).title, "New conversation");
assert.equal(snapshotStore.lanEventsSince()[0].value.conversation.title, "New conversation");
assert.ok(callbackEvent);
assert.equal(snapshotStore.pendingSharedCount() > 0, true);
assert.equal(new LocalDataStore(snapshotDirectory).conversation(snapshotConversation.id).title, "New conversation");
fs.rmSync(snapshotDirectory, { recursive: true, force: true });

console.log("LAN protocol serialization, bounds, expiry, revocation, and secret-file ignore tests passed.");
