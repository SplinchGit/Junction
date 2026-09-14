"use strict";

const { spawn } = require("node:child_process");
const readline = require("node:readline");

/** Minimal supervised JSON-RPC client for the local Codex App Server. */
class CodexAppServer {
  constructor({ launch = spawn, onDiagnostic = () => {} } = {}) {
    this.launch = launch;
    this.onDiagnostic = onDiagnostic;
    this.process = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.starting = null;
  }

  async start() {
    if (this.starting) return this.starting;
    this.starting = new Promise((resolve, reject) => {
      const child = this.launch("codex", ["app-server"], { windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
      this.process = child;
      const fail = error => { this.stop(); reject(error instanceof Error ? error : new Error(String(error))); };
      child.once("error", fail);
      child.stderr.on("data", value => this.onDiagnostic(String(value).trim()));
      child.once("close", code => {
        const error = new Error(`Codex App Server stopped (${code ?? "unknown"}).`);
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
        this.process = null;
      });
      readline.createInterface({ input: child.stdout }).on("line", line => this.receive(line));
      this.request("initialize", { clientInfo: { name: "junction", title: "Junction", version: "0.1.0" } })
        .then(() => { this.notify("initialized", {}); resolve(); })
        .catch(fail);
    });
    try { await this.starting; } finally { this.starting = null; }
  }

  receive(line) {
    let message; try { message = JSON.parse(line); } catch { this.onDiagnostic(`Invalid App Server message: ${line.slice(0, 200)}`); return; }
    if (message.id != null && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id); this.pending.delete(message.id);
      return message.error ? pending.reject(new Error(message.error.message || "Codex App Server request failed.")) : pending.resolve(message.result);
    }
    for (const listener of this.listeners) listener(message);
  }
  request(method, params = {}) {
    if (!this.process?.stdin?.writable) return Promise.reject(new Error("Codex App Server is not running."));
    const id = this.nextId++;
    this.process.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  notify(method, params = {}) { this.process?.stdin?.writable && this.process.stdin.write(`${JSON.stringify({ method, params })}\n`); }
  onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  /** Reads the ChatGPT-account windows used by this local Codex login. */
  async readRateLimits() {
    await this.start();
    return this.request("account/rateLimits/read");
  }

  async run({ threadId, cwd, prompt, model = "gpt-5.6-terra", onProgress = () => {}, onTurnStarted = () => {} }) {
    await this.start();
    if (threadId) await this.request("thread/resume", { threadId });
    else threadId = (await this.request("thread/start", { cwd, model, approvalPolicy: "never", sandbox: "workspaceWrite", serviceName: "junction" })).thread.id;
    let turnId = null, finalText = "";
    const completed = new Promise((resolve, reject) => {
      const off = this.onEvent(message => {
        const item = message.params?.item;
        if (message.method === "item/agentMessage/delta") {
          const delta = message.params?.delta || ""; finalText += delta; onProgress(delta); return;
        }
        if (message.method === "turn/completed" && (!turnId || message.params?.turn?.id === turnId)) {
          off();
          const turn = message.params?.turn;
          turn?.status === "completed" ? resolve({ threadId, turnId: turn.id, text: finalText }) : reject(new Error(turn?.error?.message || `Codex turn ${turn?.status || "failed"}.`));
        }
      });
    });
    const started = await this.request("turn/start", {
      threadId, input: [{ type: "text", text: prompt }], cwd,
      approvalPolicy: "never", sandboxPolicy: { type: "workspaceWrite", writableRoots: [cwd], networkAccess: false }, model
    });
    turnId = started.turn.id;
    onTurnStarted({ threadId, turnId });
    return completed;
  }
  stop() { this.process?.kill(); this.process = null; }
}

module.exports = { CodexAppServer };
