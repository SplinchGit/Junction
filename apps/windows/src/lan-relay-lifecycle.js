"use strict";

const { LanServer, privateIPv4Addresses } = require("./lan-server");

// Each listener is bound to one private interface, never a wildcard/public NIC.
// Polling also handles adapter arrival, sleep/resume and DHCP address changes.
class LanRelayLifecycle {
  constructor({ getAddresses = privateIPv4Addresses, serverFactory = options => new LanServer(options), pollMs = 5000, onStatus = () => {}, ...options } = {}) {
    this.options = options; this.getAddresses = getAddresses; this.serverFactory = serverFactory;
    this.pollMs = pollMs; this.onStatus = onStatus; this.servers = new Map();
    this.running = false; this.pending = null; this.timer = null; this.lastStatus = null;
  }
  report(code, address = null) {
    const status = JSON.stringify({ component: "lan-relay", code, address, port: this.port || this.options.port || 43111 });
    if (status !== this.lastStatus) { this.lastStatus = status; this.onStatus(JSON.parse(status)); }
  }
  info() {
    const server = [...this.servers.values()].find(value => value.isHealthy());
    if (!server) throw Object.assign(new Error("LAN service is waiting for an available private network interface."), { code: "LAN_UNAVAILABLE" });
    return server.info();
  }
  async start() {
    if (this.running) return;
    this.running = true;
    await this.refresh();
    if (this.running) { this.timer = setInterval(() => void this.refresh(), this.pollMs); this.timer.unref?.(); }
  }
  refresh() {
    if (!this.running) return Promise.resolve();
    if (this.pending) return this.pending;
    this.pending = this.reconcile().catch(error => this.report(this.errorCode(error))).finally(() => { this.pending = null; });
    return this.pending;
  }
  errorCode(error) {
    return ["EADDRINUSE", "EADDRNOTAVAIL", "EACCES", "LAN_IDENTITY_UNREADABLE", "LAN_ENCRYPTION_UNAVAILABLE"].includes(error?.code) ? error.code : "LAN_START_FAILED";
  }
  async reconcile() {
    const available = this.getAddresses();
    const addresses = [...new Set(this.options.bindAddress ? available.filter(address => address === this.options.bindAddress) : available)];
    for (const [address, server] of this.servers) {
      if (!addresses.includes(address) || !server.isHealthy()) { this.servers.delete(address); await server.stop(); }
    }
    if (!addresses.length) { this.report("LAN_WAITING_FOR_NETWORK"); return; }
    for (const address of addresses) {
      if (!this.running || this.servers.has(address)) continue;
      let server;
      try {
        if (!this.port) {
          const persistedPort = this.options.identityStore.getInstanceMetadata()?.port;
          this.port = this.options.port ?? persistedPort ?? 43111;
          if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65535) throw new Error("Invalid LAN port");
        }
        server = this.serverFactory({ ...this.options, port: this.port, bindAddress: address });
        await server.start();
        if (!this.running) { await server.stop(); return; }
        this.servers.set(address, server); this.report("LAN_LISTENING", address);
      } catch (error) { if (server) await server.stop().catch(() => {}); this.report(this.errorCode(error), address); }
    }
  }
  async stop() {
    this.running = false; clearInterval(this.timer); this.timer = null;
    await this.pending;
    const servers = [...this.servers.values()]; this.servers.clear();
    await Promise.all(servers.map(server => server.stop()));
  }
}

module.exports = { LanRelayLifecycle };
