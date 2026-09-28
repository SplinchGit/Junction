"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { providers } = require("../src/model-catalog");
const { LocalDataStore } = require("../src/local-data");
const { sendChat } = require("../src/provider-client");

const MODEL_ID = "nvidia/nemotron-3-ultra-550b-a55b:free";

function sse(events) {
  return {
    ok: true,
    status: 200,
    body: (async function* () {
      for (const event of events) yield Buffer.from(`data: ${JSON.stringify(event)}\n\n`);
      yield Buffer.from("data: [DONE]\n\n");
    })(),
  };
}

const openrouter = providers.find(provider => provider.id === "openrouter");
assert.ok(openrouter, "OpenRouter must be selectable");
assert.deepEqual(openrouter.models.map(model => model.id), [MODEL_ID]);
assert.equal(openrouter.models[0].name, "Nemotron 3 Ultra (FREE)");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "junction-openrouter-"));
try {
  const store = new LocalDataStore(directory);
  assert.equal(store.setProvider({ id: "openrouter", model: MODEL_ID }).id, "openrouter");
  assert.equal(new LocalDataStore(directory).provider().model, MODEL_ID);
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

(async () => {
  const requests = [];
  const chunks = [];
  const fetchImpl = async (_url, options) => {
    requests.push({ ...options, body: JSON.parse(options.body) });
    if (requests.length === 1) {
      return sse([
        { model: MODEL_ID, choices: [{ delta: { reasoning: "private", tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name: "web_search", arguments: '{"query":"current fact"}' } }] } }] },
      ]);
    }
    return sse([
      { model: MODEL_ID, choices: [{ delta: { content: "Hello" } }] },
      { choices: [{ delta: { content: " from Nemotron" } }], usage: { prompt_tokens: 12, completion_tokens: 4, completion_tokens_details: { reasoning_tokens: 2 } } },
    ]);
  };

  const result = await sendChat({
    config: { id: "openrouter", model: MODEL_ID },
    key: "test-key-never-log",
    messages: [{ role: "user", content: "Use the tool" }],
    memories: [{ category: "preference", content: "Use concise answers" }],
    context: null,
    research: null,
    fetchImpl,
    signal: new AbortController().signal,
    onChunk: content => chunks.push(content),
    tools: [{ type: "function", function: { name: "web_search", parameters: { type: "object" } } }],
    executeTool: async (name, args) => {
      assert.equal(name, "web_search");
      assert.deepEqual(args, { query: "current fact" });
      return { content: '{"ok":true}' };
    },
  });

  assert.equal(requests[0].body.model, MODEL_ID);
  assert.equal(requests[0].body.stream, true);
  assert.equal(requests[0].body.reasoning.effort, "high");
  assert.equal(requests[0].body.tools[0].function.name, "web_search");
  assert.equal(requests[1].body.messages.at(-1).tool_call_id, "call-1");
  assert.deepEqual(chunks, ["Hello", "Hello from Nemotron"]);
  assert.equal(result.content, "Hello from Nemotron");
  assert.equal(result.model, MODEL_ID);
  assert.equal(result.toolCalls, 1);
  assert.equal(result.toolsExecuted, 1);
  assert.equal(result.reasoningCharacters, 7);
  assert.equal(result.usage.completion_tokens_details.reasoning_tokens, 2);

  const rateLimited = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: "secret provider text" } }) });
  await assert.rejects(() => sendChat({ config: { id: "openrouter", model: MODEL_ID }, key: "hidden-key", messages: [{ role: "user", content: "Hi" }], fetchImpl: rateLimited }), /OpenRouter rate limit reached/);

  const source = ["../src/main.js", "../src/preload.js", "../renderer/parity.js"].map(file => fs.readFileSync(path.join(__dirname, file), "utf8")).join("\n");
  assert.match(source, /junction:chat-stream/);
  assert.match(source, /onChatStream/);
  assert.match(source, /signal:\s*controller\.signal/);
  console.log("OpenRouter Nemotron provider, streaming, tools, cancellation, and error tests passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
