"use strict";

const multicastDns = require("multicast-dns");
const { Bonjour, Service } = require("bonjour-service");

const SERVICE_TYPE = "_junction._tcp.local";
const normalizeDnsName = value => String(value).trim().replace(/\.+$/, "").toLowerCase();

class MulticastDnsAdvertiser {
  constructor({ mdnsFactory = multicastDns } = {}) { this.mdnsFactory = mdnsFactory; this.mdns = null; this.record = null; this.announcementTimer = null; this.listener = query => this.answer(query); this.readyListener = () => this.announce(); this.errorListener = error => this.handleError(error); this.lastError = null; }
  publish(record) { this.record = { ...record, txt: { ...record.txt } }; this.mdns = this.mdnsFactory(); this.mdns.on("query", this.listener); this.mdns.on("ready", this.readyListener); this.mdns.on("error", this.errorListener); this.announcementTimer = setInterval(() => this.announce(), 3_000); this.announcementTimer.unref?.(); return this; }
  handleError(error) { this.lastError = error; this.stop(); }
  records() {
    const generated = new Service({ name: this.record.instanceId, type: "junction", protocol: "tcp", port: this.record.port, host: `${this.record.instanceId}.local`, txt: this.record.txt, disableIPv6: true }).records();
    const generatedAddress = generated.find(record => record.type === "A");
    return {
      ptr: generated.find(record => record.type === "PTR"),
      srv: generated.find(record => record.type === "SRV"),
      txt: generated.find(record => record.type === "TXT"),
      address: generatedAddress ? { ...generatedAddress, data: this.record.address } : { name: `${this.record.instanceId}.local`, type: "A", ttl: 120, data: this.record.address },
    };
  }
  announce() { if (this.mdns && this.record) { const records = this.records(); this.mdns.respond({ answers: [records.ptr, records.srv, records.txt, records.address] }); } }
  answer(query) {
    if (!this.record) return;
    const host = `${this.record.instanceId}.local`;
    const service = `${this.record.instanceId}.${SERVICE_TYPE}`;
    const names = new Set((query.questions || []).map(question => `${normalizeDnsName(question.name)}|${String(question.type).toUpperCase()}`));
    const records = this.records(), answers = [], additionals = [];
    if (names.has(`${SERVICE_TYPE}|PTR`) || names.has(`${SERVICE_TYPE}|ANY`)) { answers.push(records.ptr); additionals.push(records.srv, records.txt, records.address); }
    if (names.has(`${service}|SRV`) || names.has(`${service}|ANY`)) answers.push(records.srv);
    if (names.has(`${service}|TXT`) || names.has(`${service}|ANY`)) answers.push(records.txt);
    if (names.has(`${host}|A`) || names.has(`${host}|AAAA`) || names.has(`${host}|ANY`)) answers.push(records.address);
    if (answers.length) this.mdns.respond({ answers, additionals });
  }
  stop() { if (this.announcementTimer) clearInterval(this.announcementTimer); this.announcementTimer = null; if (!this.mdns) return; this.mdns.removeListener("query", this.listener); this.mdns.removeListener("ready", this.readyListener); this.mdns.removeListener("error", this.errorListener); this.mdns.destroy(); this.mdns = null; }
}

class BonjourAdvertiser {
  constructor({ bonjourFactory = (options, onError) => new Bonjour(options, onError) } = {}) { this.bonjourFactory = bonjourFactory; this.bonjour = null; this.service = null; this.lastError = null; }
  publish(record) {
    this.bonjour = this.bonjourFactory({ interface: record.address }, error => { this.lastError = error; });
    this.service = this.bonjour.publish({ name: record.instanceId, type: "junction", protocol: "tcp", port: record.port, host: `${record.instanceId}.local`, txt: record.txt, disableIPv6: true });
    const generateRecords = this.service.records.bind(this.service);
    this.service.records = () => generateRecords().filter(item => item.type !== "A" || item.data === record.address);
    return this;
  }
  stop() { const bonjour = this.bonjour, service = this.service; this.service = null; this.bonjour = null; if (service?.stop) service.stop(() => bonjour?.destroy()); else bonjour?.destroy(); }
}

class LanDiscovery {
  constructor({ advertiser = null } = {}) { this.advertiser = advertiser || new BonjourAdvertiser(); this.handle = null; }
  start({ instanceId, port, certificateFingerprint, address }) {
    if (!instanceId || !Number.isInteger(port) || !certificateFingerprint) throw new Error("LAN discovery metadata is incomplete.");
    if (this.handle?.stop) this.handle.stop();
    this.handle = this.advertiser.publish({ type: SERVICE_TYPE, instanceId: String(instanceId), port, address, txt: { protocolVersion: "1", instanceId: String(instanceId), certificateFingerprint: String(certificateFingerprint) } });
    return this.handle;
  }
  stop() { if (this.handle?.stop) this.handle.stop(); this.handle = null; if (this.advertiser?.stop) this.advertiser.stop(); }
}

module.exports = { BonjourAdvertiser, LanDiscovery, MulticastDnsAdvertiser, SERVICE_TYPE };
