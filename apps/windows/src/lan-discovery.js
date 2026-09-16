"use strict";

const multicastDns = require("multicast-dns");

const SERVICE_TYPE = "_junction._tcp.local";

class MulticastDnsAdvertiser {
  constructor({ mdnsFactory = multicastDns } = {}) { this.mdnsFactory = mdnsFactory; this.mdns = null; this.record = null; this.listener = query => this.answer(query); this.errorListener = error => this.handleError(error); this.lastError = null; }
  publish(record) { this.record = { ...record, txt: { ...record.txt } }; this.mdns = this.mdnsFactory(); this.mdns.on("query", this.listener); this.mdns.on("error", this.errorListener); return this; }
  handleError(error) { this.lastError = error; this.stop(); }
  answer(query) {
    if (!this.record) return;
    const host = `${this.record.instanceId}.local`;
    const service = `${this.record.instanceId}.${SERVICE_TYPE}`;
    const names = new Set((query.questions || []).map(question => `${String(question.name).toLowerCase()}|${String(question.type).toUpperCase()}`));
    const answers = [];
    if (names.has(`${SERVICE_TYPE}|PTR`) || names.has(`${SERVICE_TYPE}|ANY`)) answers.push(
      { name: SERVICE_TYPE, type: "PTR", ttl: 120, data: `${this.record.instanceId}.${SERVICE_TYPE}` },
    );
    if (names.has(`${service}|SRV`) || names.has(`${service}|ANY`)) answers.push({ name: service, type: "SRV", ttl: 120, data: { port: this.record.port, priority: 0, weight: 0, target: host } });
    if (names.has(`${service}|TXT`) || names.has(`${service}|ANY`)) answers.push({ name: service, type: "TXT", ttl: 120, data: Object.entries(this.record.txt).map(([key, value]) => `${key}=${value}`) });
    if (names.has(`${host}|A`) || names.has(`${host}|AAAA`) || names.has(`${host}|ANY`)) answers.push({ name: host, type: "A", ttl: 120, data: this.record.address });
    if (answers.length) this.mdns.respond({ answers });
  }
  stop() { if (!this.mdns) return; this.mdns.removeListener("query", this.listener); this.mdns.removeListener("error", this.errorListener); this.mdns.destroy(); this.mdns = null; }
}

class LanDiscovery {
  constructor({ advertiser = null } = {}) { this.advertiser = advertiser || new MulticastDnsAdvertiser(); this.handle = null; }
  start({ instanceId, port, certificateFingerprint, address }) {
    if (!instanceId || !Number.isInteger(port) || !certificateFingerprint) throw new Error("LAN discovery metadata is incomplete.");
    if (this.handle?.stop) this.handle.stop();
    this.handle = this.advertiser.publish({ type: SERVICE_TYPE, instanceId: String(instanceId), port, address, txt: { protocolVersion: "1", instanceId: String(instanceId), certificateFingerprint: String(certificateFingerprint) } });
    return this.handle;
  }
  stop() { if (this.handle?.stop) this.handle.stop(); this.handle = null; if (this.advertiser?.stop) this.advertiser.stop(); }
}

module.exports = { LanDiscovery, MulticastDnsAdvertiser, SERVICE_TYPE };
