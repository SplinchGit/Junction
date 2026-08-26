"use strict";

const crypto = require("node:crypto");

const Provenance = Object.freeze({ OWNER: "OWNER", JUNCTION: "JUNCTION", UNTRUSTED: "UNTRUSTED" });
const Decision = Object.freeze({ AUTO: "auto", CONFIRMED: "confirmed", REJECTED: "rejected", BLOCKED: "blocked" });

const CAPABILITIES = Object.freeze({
  inspect_windows_context: Object.freeze({
    name: "inspect_windows_context",
    version: 1,
    description: "Read a bounded UI Automation snapshot of the foreground Windows application.",
    effect: "read_only",
    risk: "low",
    confirmation: "not_required",
    outputProvenance: Provenance.UNTRUSTED,
    limits: Object.freeze({ maxElements: 100, maxTextLength: 500, timeoutMs: 5000 })
  })
});

function makeProposal(input) {
  if (!input || input.triggerProvenance !== Provenance.OWNER) {
    return { ok: false, decision: Decision.BLOCKED, reason: "Only an OWNER-provenance request may initiate a capability." };
  }
  const capability = CAPABILITIES[input.capability];
  if (!capability) return { ok: false, decision: Decision.BLOCKED, reason: "Capability is not allowlisted." };
  return {
    ok: true,
    proposal: {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      capability: capability.name,
      capabilityVersion: capability.version,
      triggerProvenance: input.triggerProvenance,
      effect: capability.effect,
      risk: capability.risk,
      arguments: {},
      decision: capability.confirmation === "not_required" ? Decision.AUTO : "pending"
    }
  };
}

module.exports = { CAPABILITIES, Decision, Provenance, makeProposal };
