"use strict";

const crypto = require("node:crypto");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { AuditLog } = require("./audit");
const { createHandler } = require("./app");
const { inspectWindowsContext } = require("./windows-context");

const host = "127.0.0.1";
const port = Number(process.env.JUNCTION_PC_PORT || 43110);
const token = process.env.JUNCTION_PC_TOKEN || crypto.randomBytes(32).toString("base64url");
const auditPath = process.env.JUNCTION_PC_AUDIT_PATH || path.join(os.homedir(), ".junction", "pc-companion-audit.jsonl");
function startCompanion(options = {}) {
  const selectedHost = options.host || host;
  const selectedPort = options.port ?? port;
  const selectedToken = options.token || token;
  const selectedAuditPath = options.auditPath || auditPath;
  const handler = createHandler({ token: selectedToken, audit: new AuditLog(selectedAuditPath), inspectContext: options.inspectContext || inspectWindowsContext, ollamaUrl: options.ollamaUrl || process.env.OLLAMA_HOST || "http://127.0.0.1:11434" });
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(selectedPort, selectedHost, () => resolve({ server, host: selectedHost, port: server.address().port, token: selectedToken, auditPath: selectedAuditPath }));
  });
}

if (require.main === module) {
  startCompanion().then(result => {
    console.log(`Junction PC companion listening on http://${result.host}:${result.port}`);
    console.log(`Session token: ${result.token}`);
    console.log(`Audit log: ${result.auditPath}`);
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { startCompanion };
