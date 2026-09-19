"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MIN_PAIRING_TTL_MS = 1000;
const MAX_PAIRING_TTL_MS = 5 * 60 * 1000;
const MAX_ONE_TIME_TOKENS = 256;
const MAX_ONE_TIME_TOKEN_STORAGE_BYTES = 64 * 1024;

function atomic(file, value) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, value, { mode: 0o600 }); fs.renameSync(temporary, file);
}
class LanIdentityStore {
  constructor(directory, safeStorage) { this.directory = directory; this.safeStorage = safeStorage; }
  file(name) { return path.join(this.directory, name); }
  put(name, value) {
    const target = path.resolve(this.file(name)).toLowerCase();
    const tokenFile = path.resolve(this.file("lan-tokens.bin")).toLowerCase();
    if (target === tokenFile) this.validateOneTimeTokens(value);
    if (!this.safeStorage?.isEncryptionAvailable()) throw Object.assign(new Error("Windows credential encryption is unavailable."), { code: "LAN_ENCRYPTION_UNAVAILABLE" });
    fs.mkdirSync(this.directory, { recursive: true }); atomic(this.file(name), this.safeStorage.encryptString(JSON.stringify(value)).toString("base64"));
  }
  get(name, fallback = null) {
    let encrypted;
    try { encrypted = fs.readFileSync(this.file(name), "utf8"); }
    catch (error) {
      if (error.code === "ENOENT") return fallback;
      throw Object.assign(new Error("Stored LAN identity could not be read. Restore access to the existing identity; it has not been replaced."), { code: "LAN_IDENTITY_UNREADABLE" });
    }
    if (!this.safeStorage?.isEncryptionAvailable()) throw Object.assign(new Error("Windows credential encryption is unavailable. The stored LAN identity has not been replaced."), { code: "LAN_ENCRYPTION_UNAVAILABLE" });
    try {
      const value = JSON.parse(this.safeStorage.decryptString(Buffer.from(encrypted, "base64")));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid identity record");
      if (name === "lan-tls.bin" && (!value.key || !value.certificate)) throw new Error("Invalid TLS identity");
      if (name === "lan-instance.bin" && !value.instanceId) throw new Error("Invalid instance identity");
      return value;
    } catch { throw Object.assign(new Error("Stored LAN identity could not be decrypted or is corrupt. Restore the existing identity; it has not been replaced."), { code: "LAN_IDENTITY_UNREADABLE" }); }
  }
  setTlsIdentity(key, certificate) { if (!key || !certificate) throw new Error("TLS identity is required."); this.put("lan-tls.bin", { key, certificate }); }
  getTlsIdentity() { return this.get("lan-tls.bin"); }
  setInstanceMetadata(metadata) { this.put("lan-instance.bin", { ...metadata }); }
  getInstanceMetadata() { return this.get("lan-instance.bin", {}); }
  setPairedAndroidKeys(keys) { this.put("lan-pairing.bin", { ...keys }); }
  getPairedAndroidKeys() { return this.get("lan-pairing.bin", {}); }
  setRevocationState(state) { this.put("lan-revocation.bin", { ...state }); }
  getRevocationState() { return this.get("lan-revocation.bin", {}); }
  validateOneTimeTokens(tokens) {
    const boundedTokens = Object.assign(Object.create(null), tokens);
    if (Object.keys(boundedTokens).length > MAX_ONE_TIME_TOKENS) throw new Error("Maximum one-time token count exceeded.");
    if (Buffer.byteLength(JSON.stringify(boundedTokens), "utf8") > MAX_ONE_TIME_TOKEN_STORAGE_BYTES) throw new Error("One-time token storage size exceeded.");
    return boundedTokens;
  }
  setOneTimeTokens(tokens) { this.put("lan-tokens.bin", this.validateOneTimeTokens(tokens)); }
  getOneTimeTokens() { return this.get("lan-tokens.bin", Object.create(null)); }
  createOneTimeToken({ ttlMs = 5 * 60 * 1000, now = Date.now(), metadata = {} } = {}) {
    if (typeof ttlMs !== "number" || !Number.isFinite(ttlMs) || ttlMs < MIN_PAIRING_TTL_MS || ttlMs > MAX_PAIRING_TTL_MS) throw new Error("Invalid one-time token TTL.");
    const token = crypto.randomBytes(32).toString("base64url");
    const tokens = this.getOneTimeTokens();
    for (const key of Object.keys(tokens)) if (!tokens[key] || tokens[key].used || !Number.isFinite(tokens[key].expiresAt) || tokens[key].expiresAt <= now) delete tokens[key];
    tokens[token] = { ...metadata, expiresAt: now + ttlMs, used: false }; this.setOneTimeTokens(tokens);
    return { token, expiresAt: tokens[token].expiresAt };
  }
  consumeOneTimeToken(token, now = Date.now()) {
    const tokens = this.getOneTimeTokens();
    if (typeof token !== "string" || !Object.prototype.hasOwnProperty.call(tokens, token)) return null;
    const entry = tokens[token];
    if (!entry || entry.used || !Number.isFinite(entry.expiresAt) || entry.expiresAt <= now) { delete tokens[token]; this.setOneTimeTokens(tokens); return null; }
    delete tokens[token]; this.setOneTimeTokens(tokens); return { ...entry, used: true };
  }
  status() {
    const metadata = this.getInstanceMetadata();
    return { instanceId: metadata.instanceId || null, port: metadata.port || null, pairedDeviceCount: Object.keys(this.getPairedAndroidKeys()).length, pairedDeviceIds: Object.keys(this.getPairedAndroidKeys()) };
  }
  revokeAll() { this.setPairedAndroidKeys({}); this.setRevocationState({}); return true; }
  revokeDevice(deviceId) {
    const clean = String(deviceId || "");
    if (!clean || !Object.prototype.hasOwnProperty.call(this.getPairedAndroidKeys(), clean)) return false;
    const paired = this.getPairedAndroidKeys(); delete paired[clean]; this.setPairedAndroidKeys(paired);
    const revoked = this.getRevocationState(); revoked[clean] = { revokedAt: Date.now() }; this.setRevocationState(revoked); return true;
  }
}
module.exports = { LanIdentityStore, MAX_ONE_TIME_TOKENS, MAX_ONE_TIME_TOKEN_STORAGE_BYTES };
