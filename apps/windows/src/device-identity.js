"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

class DeviceIdentityStore {
  constructor(directory, safeStorage) { this.directory = directory; this.safeStorage = safeStorage; this.file = path.join(directory, "device.json"); }
  load() {
    fs.mkdirSync(this.directory, { recursive: true });
    let stored = {};
    try { stored = JSON.parse(fs.readFileSync(this.file, "utf8")); } catch {}
    if (!stored.deviceId) {
      stored = { deviceId: crypto.randomUUID(), name: process.env.COMPUTERNAME || "Windows PC", createdAt: new Date().toISOString(), syncEnabled: false };
      this.save(stored);
    }
    return stored;
  }
  save(value) { fs.mkdirSync(this.directory, { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(value, null, 2), { mode: 0o600 }); }
  claimOwner(uid) {
    const value=this.load();
    if(value.ownerUid&&value.ownerUid!==uid)throw new Error("This PC is already bound to another Junction owner.");
    const claimed={...value,ownerUid:uid};this.save(claimed);return claimed;
  }
  setSession(session) {
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error("Windows credential encryption is unavailable.");
    const encrypted = this.safeStorage.encryptString(JSON.stringify(session)).toString("base64");
    fs.writeFileSync(path.join(this.directory, "firebase-session.bin"), encrypted, { mode: 0o600 });
  }
  getSession() {
    try {
      if (!this.safeStorage.isEncryptionAvailable()) return null;
      const encrypted = Buffer.from(fs.readFileSync(path.join(this.directory, "firebase-session.bin"), "utf8"), "base64");
      return JSON.parse(this.safeStorage.decryptString(encrypted));
    } catch { return null; }
  }
  clearSession() { try { fs.unlinkSync(path.join(this.directory, "firebase-session.bin")); } catch {} }
  setProviderKey(providerId, key) {
    if (!/^[a-z0-9_-]{1,40}$/i.test(providerId)) throw new Error("Invalid provider identifier.");
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error("Windows credential encryption is unavailable.");
    const file=path.join(this.directory, `provider-${providerId}.bin`);
    if (!key) { try { fs.unlinkSync(file); } catch {} return; }
    fs.writeFileSync(file, this.safeStorage.encryptString(key).toString("base64"), { mode: 0o600 });
  }
  getProviderKey(providerId) {
    try { if(!/^[a-z0-9_-]{1,40}$/i.test(providerId)||!this.safeStorage.isEncryptionAvailable()) return ""; return this.safeStorage.decryptString(Buffer.from(fs.readFileSync(path.join(this.directory, `provider-${providerId}.bin`),"utf8"),"base64")); } catch { return ""; }
  }
}

module.exports = { DeviceIdentityStore };
