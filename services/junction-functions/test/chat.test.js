const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

/**
 * Create an isolated handler with all provider calls mocked.
 * @return {object} Mock request helper and call counter.
 */
function harness({valid = true, upstreamOk = true} = {}) {
  let calls = 0;
  const fakeFetch = async () => {
    calls++;
    return {ok: upstreamOk, json: async () => ({output_text: "fixture"})};
  };
  const modules = {
    "firebase-functions/v2/options": {setGlobalOptions() {}},
    "firebase-functions/v2/https": {onRequest: (_options, fn) => fn},
    "firebase-functions/params": {
      defineSecret: () => ({value: () => "fixture-key"}),
    },
    "firebase-admin": {apps: [], initializeApp() {}, auth: () => ({
      verifyIdToken: async () => {
        if (!valid) throw new Error("invalid fixture token");
        return {uid: "owner"};
      },
    })},
    "node-fetch": fakeFetch,
  };
  const sandbox = {exports: {}, process: {env: {}}, fetch: fakeFetch,
    AbortSignal, require: (name) => {
      assert.ok(name in modules, `Unexpected dependency: ${name}`);
      return modules[name];
    }};
  const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
  vm.runInNewContext(source, sandbox);
  return {
    async send({token = "", method = "POST", message = "hello"} = {}) {
      const response = {code: 200, status(code) {
        this.code = code; return this;
      },
      json(value) {
        this.body = value; return this;
      }, set() {
        return this;
      }};
      const request = {method, body: {message}, get: () => token};
      await sandbox.exports.chatJunction(request, response);
      return response;
    },
    calls: () => calls,
  };
}
test("missing authentication never calls paid provider", async () => {
  const h = harness();
  assert.equal((await h.send()).code, 401);
  assert.equal(h.calls(), 0);
});
test("invalid authentication never calls paid provider", async () => {
  const h = harness({valid: false});
  assert.equal((await h.send({token: "Bearer invalid"})).code, 401);
  assert.equal(h.calls(), 0);
});
test("rejects method and size violations", async () => {
  const h = harness();
  assert.equal((await h.send({method: "GET"})).code, 405);
  const large = await h.send({
    token: "Bearer fixture", message: "a".repeat(16001),
  });
  assert.equal(large.code, 400);
  assert.equal(h.calls(), 0);
});
test("valid owner token reaches mocked provider", async () => {
  const h = harness();
  const result = await h.send({token: "Bearer fixture"});
  assert.equal(result.body.output_text, "fixture");
  assert.equal(h.calls(), 1);
});
test("upstream failure returns sanitized error", async () => {
  const h = harness({upstreamOk: false});
  assert.equal((await h.send({token: "Bearer fixture"})).code, 502);
});
