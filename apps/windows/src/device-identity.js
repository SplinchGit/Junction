"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function writeAtomic(file, value) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, value, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

class DeviceIdentityStore {
  constructor(directory, safeStorage) { this.directory = directory; this.safeStorage = safeStorage; this.file = path.join(directory, "device.json"); }
  load() {
    fs.mkdirSync(this.directory, { recursive: true });
    let stored = {};
    try { stored = JSON.parse(fs.readFileSync(this.file, "utf8")); } catch {
      // Preserve a damaged file for recovery instead of repeatedly trying to
      // parse it or silently destroying the only copy after an interrupted
      // shutdown/write. A new identity lets the app open immediately.
      try {
        if (fs.existsSync(this.file)) fs.renameSync(this.file, `${this.file}.${Date.now()}.corrupt`);
      } catch {}
    }
    if (!stored.deviceId) {
      stored = { deviceId: crypto.randomUUID(), name: process.env.COMPUTERNAME || "Windows PC", createdAt: new Date().toISOString(), syncEnabled: false };
      this.save(stored);
    }
    return stored;
  }
  save(value) { fs.mkdirSync(this.directory, { recursive: true }); writeAtomic(this.file, JSON.stringify(value, null, 2)); }
  claimOwner(uid) {
    const value=this.load();
    if(value.ownerUid&&value.ownerUid!==uid)throw new Error("This PC is already bound to another Junction owner.");
    const claimed={...value,ownerUid:uid};this.save(claimed);return claimed;
  }
  setSession(session) {
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error("Windows credential encryption is unavailable.");
    const encrypted = this.safeStorage.encryptString(JSON.stringify(session)).toString("base64");
    writeAtomic(path.join(this.directory, "firebase-session.bin"), encrypted);
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
    writeAtomic(file, this.safeStorage.encryptString(key).toString("base64"));
  }
  getProviderKey(providerId) {
    try { if(!/^[a-z0-9_-]{1,40}$/i.test(providerId)||!this.safeStorage.isEncryptionAvailable()) return ""; return this.safeStorage.decryptString(Buffer.from(fs.readFileSync(path.join(this.directory, `provider-${providerId}.bin`),"utf8"),"base64")); } catch { return ""; }
  }
  /** DPAPI-backed storage for Junction-owned device capabilities. */
  setSecureValue(name, value) {
    if (!/^[a-z0-9_-]{1,80}$/i.test(name) || !this.safeStorage.isEncryptionAvailable()) throw new Error("Windows credential encryption is unavailable.");
    const file = path.join(this.directory, `secure-${name}.bin`);
    if (!value) { try { fs.unlinkSync(file); } catch {} return; }
    writeAtomic(file, this.safeStorage.encryptString(value).toString("base64"));
  }
  getSecureValue(name) {
    try { if(!/^[a-z0-9_-]{1,80}$/i.test(name)||!this.safeStorage.isEncryptionAvailable()) return ""; return this.safeStorage.decryptString(Buffer.from(fs.readFileSync(path.join(this.directory, `secure-${name}.bin`),"utf8"),"base64")); } catch { return ""; }
  }
  /** Protected LAN identity storage. Secrets are kept behind Electron DPAPI safeStorage. */
  lanStore() { return new (require("./lan-identity").LanIdentityStore)(this.directory, this.safeStorage); }
  setLanTlsIdentity(key, certificate) { return this.lanStore().setTlsIdentity(key, certificate); }
  getLanTlsIdentity() { return this.lanStore().getTlsIdentity(); }
}

module.exports = { DeviceIdentityStore };
