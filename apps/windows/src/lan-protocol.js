"use strict";

const PROTOCOL_VERSION = 1;
const MAX_FRAME_BYTES = 64 * 1024;
const MAX_PAYLOAD_BYTES = 60 * 1024;
const MAX_REQUEST_ID_LENGTH = 160;
const REQUEST_ID = /^[A-Za-z0-9_-]{1,160}$/;
const CONVERSATION_RECORD_KINDS = new Set(["created", "updated", "deleted", "message"]);
const TYPES = new Set([
  "hello", "challenge", "authenticate", "authenticated", "pair", "pair.bootstrap", "ping", "pong",
  "chat.send", "chat.started", "chat.delta", "chat.complete", "chat.error", "chat.cancel",
  "conversation.sync", "conversation.created", "conversation.updated", "conversation.deleted",
  "model.list", "model.status",
]);

function bytes(value) { return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value)); }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function validateEnvelope(value) {
  if (!object(value)) throw new Error("Invalid LAN envelope.");
  if (value.protocolVersion !== PROTOCOL_VERSION) throw new Error("Unsupported LAN protocol version.");
  if (typeof value.type !== "string" || !TYPES.has(value.type)) throw new Error("Invalid LAN envelope type.");
  if (typeof value.requestId !== "string" || !REQUEST_ID.test(value.requestId)) throw new Error("Invalid LAN request ID.");
  if (!object(value.payload)) throw new Error("Invalid LAN envelope payload.");
  if (bytes(value.payload) > MAX_PAYLOAD_BYTES) throw new Error("LAN envelope payload exceeds its size limit.");
  return value;
}
function serializeEnvelope(type, requestId, payload = {}) {
  const value = validateEnvelope({ protocolVersion: PROTOCOL_VERSION, type, requestId, payload });
  const serialized = JSON.stringify(value);
  if (bytes(serialized) > MAX_FRAME_BYTES) throw new Error("LAN envelope exceeds its size limit.");
  return serialized;
}
function parseEnvelope(serialized) {
  if (typeof serialized !== "string" && !Buffer.isBuffer(serialized)) throw new Error("LAN envelope must be JSON.");
  if (bytes(serialized) > MAX_FRAME_BYTES) throw new Error("LAN envelope exceeds its size limit.");
  let value; try { value = JSON.parse(String(serialized)); } catch { throw new Error("LAN envelope is not valid JSON."); }
  return validateEnvelope(value);
}
function typed(type, requestId, payload) { return JSON.parse(serializeEnvelope(type, requestId, payload)); }
function serializeChatEvent(type, requestId, payload = {}) {
  if (!type.startsWith("chat.")) throw new Error("Invalid chat event type.");
  return typed(type, requestId, payload);
}
function serializeAuthMessage(type, requestId, payload = {}) {
  if (!["hello", "challenge", "authenticate", "authenticated"].includes(type)) throw new Error("Invalid auth message type.");
  return typed(type, requestId, payload);
}
function serializeConversationSyncRecord(kind, id, revision, value = {}) {
  if (!CONVERSATION_RECORD_KINDS.has(kind) || typeof id !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(id) || !Number.isSafeInteger(revision) || revision < 0 || !object(value)) throw new Error("Invalid conversation sync record.");
  const record = { id, revision, kind, value };
  if (bytes(record) > MAX_PAYLOAD_BYTES) throw new Error("Conversation sync record exceeds its size limit.");
  return record;
}
function isExpired(value, now = Date.now()) { return !value || !Number.isFinite(value.expiresAt) || now >= value.expiresAt; }
function isRevoked(value, now = Date.now()) { return Boolean(value && Number.isFinite(value.revokedAt) && now >= value.revokedAt); }

module.exports = { PROTOCOL_VERSION, MAX_FRAME_BYTES, MAX_PAYLOAD_BYTES, MAX_REQUEST_ID_LENGTH, TYPES,
  validateEnvelope, serializeEnvelope, parseEnvelope, serializeChatEvent, serializeAuthMessage,
  serializeConversationSyncRecord, isExpired, isRevoked };
