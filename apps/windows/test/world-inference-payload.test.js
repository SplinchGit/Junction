"use strict";

const assert = require("node:assert/strict");
const { buildWorldInferencePayload, WORLD_MODEL } = require("../src/world-bridge");

const messages = [{ role: "user", content: "Confirm Junction World is online." }];
assert.equal(typeof buildWorldInferencePayload, "function");
assert.deepEqual(buildWorldInferencePayload(messages, 384), {
  model: WORLD_MODEL,
  messages,
  stream: false,
  think: false,
  format: "json",
  options: { num_predict: 384, temperature: 0 },
});
