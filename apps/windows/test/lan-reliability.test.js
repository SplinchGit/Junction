"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { LanIdentityStore } = require("../src/lan-identity");

test("missing identity is new, but corrupt or unavailable encrypted identity fails closed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "junction-lan-"));
  try {
    const store = new LanIdentityStore(dir, { isEncryptionAvailable: () => true, decryptString: () => { throw new Error("secret contents"); } });
    assert.equal(store.getTlsIdentity(), null);
    fs.writeFileSync(path.join(dir, "lan-tls.bin"), "corrupt");
    assert.throws(() => store.getTlsIdentity(), error => error.code === "LAN_IDENTITY_UNREADABLE" && !error.message.includes("secret contents"));
    store.safeStorage.isEncryptionAvailable = () => false;
    assert.throws(() => store.getTlsIdentity(), { code: "LAN_ENCRYPTION_UNAVAILABLE" });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("relay recovers after absent NIC, DHCP changes, listener failure, and keeps multiple private NICs", async () => {
  const { LanRelayLifecycle } = require("../src/lan-relay-lifecycle");
  let addresses = [], fail = false;
  const instances = [], metadata = { instanceId: "stable", port: 43111 };
  const relay = new LanRelayLifecycle({ identityStore: { getInstanceMetadata: () => metadata }, getAddresses: () => addresses,
    serverFactory: options => {
      const instance = { options, healthy: true, stopped: false, async start() { if (fail) throw Object.assign(new Error("sensitive"), { code: "EADDRINUSE" }); }, async stop() { this.stopped = true; }, isHealthy() { return this.healthy; }, info() { return { host: options.bindAddress, port: options.port, instanceId: "stable", certificateFingerprint: "same" }; } };
      instances.push(instance); return instance;
    } });
  try {
    await relay.start(); assert.throws(() => relay.info(), { code: "LAN_UNAVAILABLE" });
    addresses = ["192.168.1.2", "10.0.0.2"]; await relay.refresh();
    assert.equal(relay.info().instanceId, "stable"); assert.equal(relay.servers.size, 2);
    addresses = ["192.168.1.3"]; await relay.refresh();
    assert.ok(instances[0].stopped); assert.ok(instances[1].stopped);
    assert.equal(relay.info().host, "192.168.1.3"); assert.equal(relay.info().port, 43111);
    instances.at(-1).healthy = false; fail = true; await relay.refresh();
    assert.throws(() => relay.info(), { code: "LAN_UNAVAILABLE" });
    fail = false; await relay.refresh(); assert.equal(relay.info().certificateFingerprint, "same");
  } finally { await relay.stop(); }
  assert.ok(instances.at(-1).stopped);
});

test("workspace dependency closure includes LAN modules and can load outside the workspace", () => {
  const { copyRuntimeDependencies, validateRuntimeDependencies } = require("../scripts/pack-workspace");
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "junction-package-"));
  try {
    copyRuntimeDependencies(path.resolve(__dirname, ".."), stage);
    validateRuntimeDependencies(stage);
    for (const name of ["selfsigned", "ws", "bonjour-service", "multicast-dns", "qrcode"]) assert.ok(fs.existsSync(path.join(stage, "node_modules", name, "package.json")));
    fs.rmSync(path.join(stage, "node_modules", "selfsigned"), { recursive: true, force: true });
    assert.throws(() => validateRuntimeDependencies(stage));
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
});
