"use strict";
const assert = require("node:assert/strict");
const { providers } = require("../src/model-catalog");
const { selectionFor, groupedProviderOptions } = require("../renderer/model-selection");

assert.deepEqual(groupedProviderOptions(providers).map(group => group.label), ["Local", "First Party", "OpenRouter", "Advanced"]);
assert.deepEqual(groupedProviderOptions(providers).find(group => group.label === "First Party").options.map(option => option.id), ["anthropic", "openai", "nvidia"]);

const switched = selectionFor(providers, "openrouter", "gpt-5.6-sol");
assert.equal(switched.provider.id, "openrouter");
assert.equal(switched.model.id, "nvidia/nemotron-3-ultra-550b-a55b:free");
assert.equal(switched.provider.source, "NVIDIA via OpenRouter");

const selected = selectionFor(providers, "openai", "gpt-5.6-sol");
assert.equal(selected.model.id, "gpt-5.6-sol");
console.log("Provider-first model selection passed");
