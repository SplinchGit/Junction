"use strict";
// The owner-only Junction API must remain reachable after switching between
// an encrypted overlay and a phone hotspot. Each connection uses pinned TLS
// and device authentication even on an untrusted physical LAN.
const assert = require("node:assert/strict");
const test = require("node:test");
const os = require("node:os");
const { selectPrivateIPv4, privateIPv4Addresses, preferredBindAddresses } = require("../src/lan-server");

function withInterfaces(interfaces, body) {
  const original = os.networkInterfaces;
  os.networkInterfaces = () => interfaces;
  try { return body(); } finally { os.networkInterfaces = original; }
}
const ipv4 = (address, internal = false) => ({ address, family: "IPv4", internal });

test("an overlay address is preferred over the physical private LAN", () => {
  withInterfaces({
    WiFi: [ipv4("10.164.57.103")],
    "Ethernet 4": [ipv4("192.168.56.1")],
    Tailscale: [ipv4("100.95.8.42")],
    Loopback: [ipv4("127.0.0.1", true)]
  }, () => {
    assert.equal(selectPrivateIPv4(null), "100.95.8.42");
    assert.deepEqual(privateIPv4Addresses(), ["10.164.57.103", "100.95.8.42", "192.168.56.1"]);
  });
});

test("the physical private LAN is still used when no overlay exists", () => {
  withInterfaces({ WiFi: [ipv4("10.164.57.103")], "Ethernet 4": [ipv4("192.168.56.1")] }, () => {
    assert.equal(selectPrivateIPv4(null), "10.164.57.103");
  });
});

test("an explicit overlay bind address is accepted", () => {
  assert.equal(selectPrivateIPv4("100.95.8.42"), "100.95.8.42");
  assert.equal(selectPrivateIPv4("10.164.57.103"), "10.164.57.103");
});

test("public and link-local addresses are still refused", () => {
  for (const address of ["8.8.8.8", "169.254.77.9", "100.128.0.1", "99.64.0.1", "172.32.0.1", "not-an-ip"]) {
    assert.throws(() => selectPrivateIPv4(address), /private IPv4/, address);
  }
});

test("paired phones can reconnect via hotspot while an overlay is active", () => {
  withInterfaces({
    WiFi: [ipv4("10.164.57.103")],
    "Ethernet 4": [ipv4("192.168.56.1")],
    Tailscale: [ipv4("100.95.8.42")]
  }, () => {
    assert.deepEqual(preferredBindAddresses(), ["10.164.57.103", "100.95.8.42", "192.168.56.1"]);
  });
});

test("without an overlay the physical private LAN is still bound", () => {
  withInterfaces({ WiFi: [ipv4("10.164.57.103")], "Ethernet 4": [ipv4("192.168.56.1")] }, () => {
    assert.deepEqual(preferredBindAddresses(), ["10.164.57.103", "192.168.56.1"]);
  });
});

test("a host with no usable private interface fails loudly", () => {
  withInterfaces({ WiFi: [ipv4("8.8.8.8")], Loopback: [ipv4("127.0.0.1", true)] }, () => {
    assert.throws(() => selectPrivateIPv4(null), /No private IPv4 LAN interface/);
  });
});
