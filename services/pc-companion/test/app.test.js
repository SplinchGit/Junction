"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { createHandler } = require("../src/app");

async function withServer(run) {
  const entries = [];
  const handler = createHandler({ token: "test-token", audit: { append: row => entries.push(row) }, inspectContext: async () => ({ provenance: "UNTRUSTED", elements: [] }) });
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`, entries); } finally { await new Promise(resolve => server.close(resolve)); }
}

test("requires authentication", () => withServer(async base => {
  assert.equal((await fetch(`${base}/v1/capabilities`)).status, 401);
}));

test("proposes, executes, and audits bounded inspection", () => withServer(async (base, entries) => {
  const headers = { authorization: "Bearer test-token", "content-type": "application/json" };
  const proposed = await fetch(`${base}/v1/proposals`, { method: "POST", headers, body: JSON.stringify({ capability: "inspect_windows_context", triggerProvenance: "OWNER" }) });
  assert.equal(proposed.status, 201);
  const proposal = (await proposed.json()).proposal;
  const executed = await fetch(`${base}/v1/proposals/${proposal.id}/execute`, { method: "POST", headers });
  assert.equal(executed.status, 200);
  assert.equal((await executed.json()).output.provenance, "UNTRUSTED");
  assert.deepEqual(entries.map(row => row.event), ["proposal_created", "execution_completed"]);
}));
