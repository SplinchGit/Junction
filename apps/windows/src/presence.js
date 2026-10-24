"use strict";

// "Connected now" needs a live authenticated LAN socket. Otherwise freshness comes from the
// last authenticated request the phone made; nothing here pings or wakes the phone.
const RECENT_MS = 15 * 60_000;

/** Records when the paired phone last reached this PC, and over which transport. */
class PresenceTracker {
  constructor({ now = Date.now, lanClients = () => 0, relayStatus = () => null } = {}) {
    this.now = now; this.lanClients = lanClients; this.relayStatus = relayStatus; this.lastPhone = null;
  }
  seen(via, detail = "") {
    if (!["lan", "relay", "device_sync"].includes(via)) return;
    this.lastPhone = { at: this.now(), via, detail: String(detail).slice(0, 60) };
  }
  snapshot() {
    const now = this.now(), live = Number(this.lanClients()) || 0, last = this.lastPhone;
    const state = live > 0 ? "connected" : !last ? "not_seen_since_start" : now - last.at <= RECENT_MS ? "recent" : "stale";
    const relay = this.relayStatus();
    return { phone: { state, liveLanConnections: live, lastSeenAt: last?.at ?? null, via: last?.via ?? null, ageMs: last ? now - last.at : null }, relay: relay ? { enabled: Boolean(relay.enabled), error: relay.error || null } : null };
  }
}

module.exports = { PresenceTracker, RECENT_MS };
