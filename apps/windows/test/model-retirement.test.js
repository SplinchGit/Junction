"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { providers, normalizeLocalModel, normalizeModel, credentialProviderId } = require("../src/model-catalog");
const { LocalDataStore } = require("../src/local-data");
assert.deepEqual(providers.find(p => p.id === "local").models.map(m => m.id), ["qwen3:14b"]);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "junction-model-retirement-"));
for (const retired of ["qwen3:8b", "qwen3:30b", "qwen3.5:4b", "qwen3.5:2b", "qwen3:1.7b", "lfm2.5:2.6b", "gemma3:1b", ""]) {
  assert.equal(normalizeLocalModel(retired), "qwen3:14b");
  fs.writeFileSync(path.join(directory, "junction-local.json"), JSON.stringify({ provider: { id: "local", model: retired } }));
  const store = new LocalDataStore(directory);
  assert.equal(store.provider().model, "qwen3:14b");
  assert.equal(store.setProvider({ id: "local", model: retired }).model, "qwen3:14b");
  assert.equal(new LocalDataStore(directory).provider().model, "qwen3:14b");
}
assert.deepEqual(
  providers.filter(provider => provider.group === "First Party").map(provider => provider.id),
  ["anthropic", "openai", "nvidia"]
);
assert.equal(providers.find(provider => provider.id === "openrouter").group, "OpenRouter");
assert.equal(providers.find(provider => provider.id === "openrouter").source, "NVIDIA via OpenRouter");
assert.equal(credentialProviderId("openrouter"), "openrouter");
assert.equal(credentialProviderId("nvidia"), "nvidia");
assert.equal(normalizeModel("openrouter", "gpt-5.6-sol"), "nvidia/nemotron-3-ultra-550b-a55b:free");
console.log("Model retirement and persisted-selection migration passed");
