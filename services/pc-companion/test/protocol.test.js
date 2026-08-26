"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { Provenance, makeProposal } = require("../src/protocol");

test("allows the owner to propose the allowlisted read-only inspection", () => {
  const result = makeProposal({ capability: "inspect_windows_context", triggerProvenance: Provenance.OWNER });
  assert.equal(result.ok, true);
  assert.equal(result.proposal.decision, "auto");
  assert.equal(result.proposal.effect, "read_only");
});

test("blocks untrusted triggers and unknown capabilities", () => {
  assert.equal(makeProposal({ capability: "inspect_windows_context", triggerProvenance: Provenance.UNTRUSTED }).decision, "blocked");
  assert.equal(makeProposal({ capability: "run_shell", triggerProvenance: Provenance.OWNER }).decision, "blocked");
});
