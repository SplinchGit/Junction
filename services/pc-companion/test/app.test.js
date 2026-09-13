"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { createHandler } = require("../src/app");

async function withServer(run) {
  const entries = [];
  const requests = [];
  const ollamaFetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith("/v1/models")) return new Response(JSON.stringify({ object: "list", data: [{ id: "qwen3:1.7b" }] }), { headers: { "content-type": "application/json" } });
    return new Response("data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\ndata: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  };
  const handler = createHandler({ token: "test-token", audit: { append: row => entries.push(row) }, inspectContext: async () => ({ provenance: "UNTRUSTED", elements: [] }), ollamaUrl: "http://127.0.0.1:11434", fetchImpl: ollamaFetch });
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`, entries, requests); } finally { await new Promise(resolve => server.close(resolve)); }
}

test("requires authentication", () => withServer(async base => {
  assert.equal((await fetch(`${base}/v1/capabilities`)).status, 401);
}));

test("only the local-model proxy is available without a companion credential", () => withServer(async (base, _entries, requests) => {
  const models = await fetch(`${base}/v1/models`);
  assert.equal(models.status, 200);
  assert.equal((await models.json()).data[0].id, "qwen3:1.7b");
  const chat = await fetch(`${base}/v1/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "qwen3:1.7b", messages: [{ role: "user", content: "Hello" }], stream: true })
  });
  assert.equal(chat.status, 200);
  assert.match(await chat.text(), /Hello/);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, "http://127.0.0.1:11434/v1/chat/completions");
  assert.equal((await fetch(`${base}/v1/proposals`)).status, 401);
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
