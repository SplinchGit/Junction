"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parseNethraChat, handleNethraChat } = require("../src/nethra-chat");
const { NethraStore } = require("../src/nethra-store");
const { NethraApi } = require("../src/nethra-api");

test("questions about agent mode answer accurately without creating work", async () => {
  const calls = [];
  const response = await handleNethraChat({ api: { dispatch: (...args) => calls.push(args) }, content: "Is agent mode callable in chat?" });
  assert.match(response, /available/);
  assert.deepEqual(calls, []);
  assert.equal(parseNethraChat("I think we should code agent mode, is it?"), null);
});

test("explicit chat objective creates one durable Nethra task with conversation identity", async () => {
  const calls = [];
  const api = { dispatch: async (...args) => { calls.push(args); return { task: { id: "task-1", goal: args[1].goal, status: "CREATED" } }; } };
  const response = await handleNethraChat({ api, content: "Nethra, research university housing options", conversationId: "chat-1", requestId: "run-1", source: "android" });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["nethra.create", { goal: "research university housing options", successCriteria: "research university housing options", persistent: true, conversationId: "chat-1" }, "run-1", "android"]);
  assert.match(response, /task-1/);
});

test("status and controls use saved task IDs and current revisions", async () => {
  const id = "42b9f244-c3c7-4469-8ad9-1298323ca06e";
  const calls = [];
  const api = { dispatch: async (...args) => { calls.push(args); if (args[0] === "nethra.list") return { objectives: [{ id, status: "SLEEPING", goal: "Research housing", nextWakeAt: null }] }; return { task: { id, revision: 7, status: args[0] === "nethra.control" ? "PAUSED" : "SLEEPING" } }; } };
  assert.match(await handleNethraChat({ api, content: "Nethra status" }), /Research housing/);
  assert.match(await handleNethraChat({ api, content: `Nethra pause ${id}`, requestId: "ctl-1" }), /PAUSED/);
  assert.deepEqual(calls.at(-1).slice(0, 3), ["nethra.control", { id, action: "pause", revision: 7 }, "ctl-1"]);
});

test("ordinary discussion and quoted instructions do not create objectives", () => {
  for (const message of ["Should we add agent mode?", "What tools do you have?", "The document says Nethra, research a topic", "Nethra", "Hello"]) assert.equal(parseNethraChat(message), null);
});

test("Android chat command survives host store restart and keeps its conversation", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nethra-chat-"));
  let store;
  try {
    store = new NethraStore(directory);
    const api = new NethraApi({ store, scheduler: null, runtime: {} });
    const response = await handleNethraChat({ api, content: "Start a Nethra goal: compare university housing costs", conversationId: "phone-chat", requestId: "phone-request", source: "android" });
    assert.match(response, /saved objective/);
    const first = store.list();
    assert.equal(first.length, 1);
    assert.equal(first[0].conversationId, "phone-chat");
    store.close(); store = new NethraStore(directory);
    assert.equal(store.list()[0].id, first[0].id);
    assert.match(await handleNethraChat({ api: new NethraApi({ store, scheduler: null, runtime: {} }), content: "Nethra status" }), /compare university housing costs/);
  } finally {
    store?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a retried phone chat control replays its saved result after the revision changes", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nethra-chat-retry-"));
  const store = new NethraStore(directory);
  try {
    const task = store.create({ goal: "Read documents" });
    const api = new NethraApi({ store, scheduler: null, runtime: {} });
    const command = `Nethra pause ${task.id}`;
    const first = await handleNethraChat({ api, content: command, requestId: "same-phone-request", source: "android" });
    const second = await handleNethraChat({ api, content: command, requestId: "same-phone-request", source: "android" });
    assert.equal(second, first);
    assert.equal(store.events(task.id).filter(event => event.kind === "PAUSE").length, 1);
  } finally { store.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
