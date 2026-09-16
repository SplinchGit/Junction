"use strict";
// Pages of idempotent records travel inside the existing encrypted pairing
// protocol. They are data only; importing a conversation never invokes a model.
const MAX_PAGE_BYTES = 35_000;
const fs = require("node:fs"), path = require("node:path");
function messageRecords(conversationId, message) {
  const value = { id: message.id, role: canonicalRole(message.role), content: message.content, createdAt: message.createdAt, provenance: message.provenance };
  if (value.content.length <= 4000) return [{ kind: "message", conversationId, value }];
  const chunks = [];
  for (let start = 0; start < value.content.length;) {
    let end = Math.min(start + 4000, value.content.length);
    const code = value.content.charCodeAt(end - 1);
    if (end < value.content.length && code >= 0xD800 && code <= 0xDBFF) end--;
    chunks.push(value.content.slice(start, end)); start = end;
  }
  return chunks.map((content, index) => ({ kind: "message_part", conversationId, value: { ...value, content, index, count: chunks.length } }));
}
function validId(id) { return typeof id === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(id); }
function canonicalRole(role) { return ({ USER: "user", ASSISTANT: "assistant", MODEL: "assistant", SYSTEM: "system" })[String(role).toUpperCase()] || "system"; }
class PairedConversationSync {
  constructor(store, onChanged = () => {}) {
    this.store = store; this.onChanged = onChanged;
    this.partsFile = path.join(store.directory, "paired-message-parts.json");
    try { this.parts = JSON.parse(fs.readFileSync(this.partsFile, "utf8")); } catch { this.parts = {}; }
  }
  saveParts() { fs.mkdirSync(this.store.directory, { recursive: true }); fs.writeFileSync(`${this.partsFile}.tmp`, JSON.stringify(this.parts)); fs.renameSync(`${this.partsFile}.tmp`, this.partsFile); }
  version() { return require("node:crypto").createHash("sha256").update(JSON.stringify([this.store.state.conversations, this.store.state.conversationTombstones])).digest("hex"); }
  records() {
    const records = [];
    for (const conversation of this.store.state.conversations) {
      const { messages, ...metadata } = conversation;
      records.push({ kind: "conversation", value: metadata });
      for (const message of messages) records.push(...messageRecords(conversation.id, message));
    }
    for (const item of this.store.state.conversationTombstones || []) records.push({ kind: "delete", value: item });
    return records;
  }
  sync(payload) {
    if (!Array.isArray(payload.records) || Buffer.byteLength(JSON.stringify(payload.records)) > MAX_PAGE_BYTES) throw new Error("Conversation sync page exceeds its size limit.");
    const before = JSON.stringify([this.store.state.conversations, this.store.state.conversationTombstones]);
    for (const record of payload.records) {
      let value = record?.value;
      if (!value || !validId(value.id)) throw new Error("Invalid conversation sync identifier.");
      if (record.kind === "conversation" || record.kind === "delete") {
        if (!Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt)) throw new Error("Invalid conversation timestamps.");
        if (record.kind === "delete" && !(value.deletedAt > 0)) throw new Error("Invalid conversation deletion.");
        this.store.mergeSharedConversation({ id: value.id, title: String(value.title || "New conversation").slice(0, 80), createdAt: value.createdAt, updatedAt: value.updatedAt, ...(record.kind === "delete" ? { deletedAt: value.deletedAt } : {}) }, []);
      } else if (record.kind === "message" || record.kind === "message_part") {
        if (!validId(record.conversationId) || typeof value.content !== "string" || !Number.isFinite(value.createdAt)) throw new Error("Invalid conversation message.");
        const conversation = this.store.conversation(record.conversationId);
        if (!conversation || conversation.messages.some(message => message.id === value.id)) continue;
        if (record.kind === "message_part") {
          if (!Number.isInteger(value.index) || !Number.isInteger(value.count) || value.count < 1 || value.count > 1000 || value.index < 0 || value.index >= value.count || value.content.length > 4000) throw new Error("Invalid message chunk.");
          const key = `${record.conversationId}:${value.id}`;
          const parts = this.parts[key] ||= {};
          parts[value.index] = value.content;
          this.saveParts();
          if (!Array.from({ length: value.count }, (_, index) => Object.hasOwn(parts, index)).every(Boolean)) continue;
          value = { ...value, content: Array.from({ length: value.count }, (_, index) => parts[index]).join("") };
        }
        if (conversation) this.store.mergeSharedConversation(conversation, [{ id: value.id, content: value.content, createdAt: value.createdAt, role: canonicalRole(value.role), provenance: ["OWNER", "JUNCTION", "UNTRUSTED"].includes(value.provenance) ? value.provenance : "UNTRUSTED", sourceRef: `shared:paired:${value.id}` }]);
        if (record.kind === "message_part") { delete this.parts[`${record.conversationId}:${value.id}`]; this.saveParts(); }
      } else throw new Error("Unknown conversation sync record.");
    }
    if (before !== JSON.stringify([this.store.state.conversations, this.store.state.conversationTombstones])) this.onChanged();
    const all = this.records(), start = Math.max(0, Math.min(Number(payload.cursor) || 0, all.length));
    const page = []; let cursor = start, bytes = 2;
    while (cursor < all.length) {
      const size = Buffer.byteLength(JSON.stringify(all[cursor])) + 1;
      if (size > MAX_PAGE_BYTES) throw new Error("A conversation message is too large to sync in one encrypted page.");
      if (bytes + size > MAX_PAGE_BYTES) break;
      page.push(all[cursor++]); bytes += size;
    }
    return { records: page, nextCursor: cursor < all.length ? cursor : 0, version: this.version() };
  }
}
module.exports = { PairedConversationSync, canonicalRole, messageRecords };
