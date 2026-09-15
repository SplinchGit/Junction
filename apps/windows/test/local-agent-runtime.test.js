"use strict";

const assert = require("node:assert/strict");
const { LocalAgentRuntime } = require("../src/local-agent-runtime");

function response(message) { return { ok: true, json: async () => ({ message, prompt_eval_count: 2, eval_count: 1 }) }; }
function harness(outputs, { execute } = {}) {
  const requests = [], executions = [], audits = [];
  const toolRegistry = {
    definitions: () => [{ type: "function", function: { name: "web_search", description: "test", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } }],
    audit: (...args) => audits.push(args),
    execute: async (name, args) => { executions.push({ name, args }); return execute ? execute(name, args) : { content: JSON.stringify({ ok: true, evidence: "[S1.p1] Test evidence" }) }; }
  };
  let index = 0;
  const runtime = new LocalAgentRuntime({ toolRegistry, limits: { iterations: outputs.length, toolCalls: 6, searches: 3, timeoutMs: 10_000 }, fetchImpl: async (_url, options) => { requests.push(JSON.parse(options.body)); return response(outputs[Math.min(index++, outputs.length - 1)]); } });
  return { runtime, requests, executions, audits };
}
function call(query) { return { role: "assistant", content: "", tool_calls: [{ function: { name: "web_search", arguments: { query } } }] }; }

(async () => {
  const multi = harness([call("London weather"), call("Edinburgh weather"), { role: "assistant", content: "London and Edinburgh compared [S1.p1]" }]);
  const result = await multi.runtime.run({ goal: "Compare London weather and Edinburgh weather", model: "selected-model", runId: "weather-run" });
  assert.equal(result.toolCalls, 2);
  assert.equal(multi.executions.length, 2);
  assert.ok(multi.requests.every(request => request.model === "selected-model"));
  assert.ok(multi.requests[1].messages.some(message => message.role === "tool" && message.tool_name === "web_search"));
  const completed = multi.audits.find(entry => entry[0] === "model_run_completed");
  assert.equal(completed[4].runId, "weather-run");
  assert.equal(completed[4].toolCalls, 2);
  assert.deepEqual(completed[4].toolNames, ["web_search"]);

  const plain = harness([{ role: "assistant", content: "A stable answer from model knowledge." }]);
  assert.equal((await plain.runtime.run({ goal: "Say something", model: "tiny" })).content, "A stable answer from model knowledge.");
  assert.equal(plain.executions.length, 0, "natural-language tool claims must never execute a tool");

  const falseClaim = harness([
    { role: "assistant", content: "I accessed the internet via search and found the answer." },
    call("London weather"),
    { role: "assistant", content: "The recorded result says London is cloudy [S1.p1]." },
  ]);
  const corrected = await falseClaim.runtime.run({ goal: "Find London weather", model: "tiny" });
  assert.equal(corrected.toolsExecuted, 1);
  assert.equal(falseClaim.executions.length, 1);
  assert.match(falseClaim.requests[1].messages.at(-1).content, /No web_search tool completed/);
  assert.ok(falseClaim.audits.some(entry => entry[0] === "model_claim_blocked"));

  const repeatedFalseClaim = harness([
    { role: "assistant", content: "I searched the internet." },
    { role: "assistant", content: "My web search found it." },
  ]);
  await assert.rejects(() => repeatedFalseClaim.runtime.run({ goal: "Find it", model: "tiny" }), /claimed web access/);

  const malformed = harness([{ role: "assistant", content: "", tool_calls: [{ function: { name: "web_search", arguments: "{bad" } }] }, { role: "assistant", content: "The tool request was malformed." }]);
  await malformed.runtime.run({ goal: "Explain a malformed request", model: "tiny" });
  assert.equal(malformed.executions.length, 0);
  assert.equal(malformed.audits.find(entry => entry[0] === "model_run_completed")[4].toolCalls, 1);
  assert.match(malformed.requests[1].messages.at(-1).content, /Malformed arguments/);

  const duplicate = harness([call("London weather"), call("London weather"), { role: "assistant", content: "Used the first result [S1.p1]" }]);
  await duplicate.runtime.run({ goal: "London weather", model: "tiny" });
  assert.equal(duplicate.executions.length, 1);
  assert.match(duplicate.requests[2].messages.at(-1).content, /Duplicate tool request blocked/);

  const failed = harness([call("London weather"), { role: "assistant", content: "Search failed, so I cannot verify it." }], { execute: async () => { throw new Error("deterministic tool failure"); } });
  await failed.runtime.run({ goal: "London weather", model: "tiny" });
  assert.match(failed.requests[1].messages.at(-1).content, /deterministic tool failure/);

  const limited = harness([call("one"), call("two")]);
  limited.runtime.limits.iterations = 2;
  await assert.rejects(() => limited.runtime.run({ goal: "one two", model: "tiny" }), /iteration limit/);

  const cancelled = harness([{ role: "assistant", content: "should not run" }]);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => cancelled.runtime.run({ goal: "cancel me", model: "tiny", signal: controller.signal }), error => error.name === "AbortError");
  console.log("Native local-agent loop, multi-step, failure, duplicate, limit, and cancellation tests passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
