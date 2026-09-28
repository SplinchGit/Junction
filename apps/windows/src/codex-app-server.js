"use strict";

const { spawn, execFile } = require("node:child_process");
const readline = require("node:readline");

/** Minimal supervised JSON-RPC client for the local Codex App Server. */
class CodexAppServer {
  constructor({ launch = spawn, onDiagnostic = () => {}, requestTimeoutMs = 30000, cwd } = {}) {
    this.requestTimeoutMs = requestTimeoutMs; this.cwd = cwd;
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
    if (this.process?.stdin?.writable) return;
    this.starting = new Promise((resolve, reject) => {
      const child = this.launch("codex", ["app-server", "-c", 'approval_policy="never"', "-c", "features.apps=false", "-c", "features.hooks=false", "-c", "features.multi_agent=false", "-c", "mcp_servers={}", "-c", 'web_search="disabled"', "-c", 'shell_environment_policy.inherit="core"'], { cwd: this.cwd, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
      this.process = child;
      const fail = error => { this.stop(); reject(error instanceof Error ? error : new Error(String(error))); };
      child.once("error", fail);
      child.stderr.on("data", () => this.onDiagnostic("Codex transport diagnostic (content omitted)"));
      child.once("close", code => {
        if(this.process !== child) return;
        const error = new Error(`Codex App Server stopped (${code ?? "unknown"}).`);
        for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
        this.pending.clear();
        this.process = null;
        for (const listener of [...this.listeners]) listener({ method: "transport/closed", error });
      });
      readline.createInterface({ input: child.stdout }).on("line", line => this.receive(line));
      this.request("initialize", { clientInfo: { name: "junction", title: "Junction", version: "0.1.0" }, capabilities: { experimentalApi: true } })
        .then(() => { this.notify("initialized", {}); resolve(); })
        .catch(fail);
    });
    try { await this.starting; } finally { this.starting = null; }
  }

  receive(line) {
    let message; try { message = JSON.parse(line); } catch { this.onDiagnostic(`Invalid App Server message: ${line.slice(0, 200)}`); return; }
    if (message.id != null && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id); this.pending.delete(message.id); clearTimeout(pending.timer);
      return message.error ? pending.reject(Object.assign(new Error(message.error.message || "Codex App Server request failed."), { data: message.error })) : pending.resolve(message.result);
    }
    if (message.id != null && message.method) { this.process?.stdin.write(JSON.stringify({id:message.id,error:{code:-32601,message:"Owner interaction required"}})+"\n"); return; }
    for (const listener of this.listeners) listener(message);
  }
  request(method, params = {}, timeoutMs = this.requestTimeoutMs) {
    if (!this.process?.stdin?.writable) return Promise.reject(new Error("Codex App Server is not running."));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.process.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
    });
  }
  notify(method, params = {}) { this.process?.stdin?.writable && this.process.stdin.write(`${JSON.stringify({ method, params })}\n`); }
  onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  /** Reads the ChatGPT-account windows used by this local Codex login. */
  async readRateLimits() {
    await this.start();
    return this.request("account/rateLimits/read");
  }

  async run({ threadId, cwd, prompt, model, onProgress = () => {}, onTurnStarted = () => {}, signal }) {
    await this.start();
    if (signal?.aborted) throw new Error("Paused");
    // The installed CLI's advertised default may differ from a newer desktop
    // app's user configuration. Choose its supported default, never a quota fallback.
    if (!model) { const catalog=await this.request("model/list",{}); model=catalog?.data?.find(item=>item.isDefault)?.model; }
    if (threadId) await this.request("thread/resume", { threadId });
    else threadId = (await this.request("thread/start", { cwd, ...(model ? {model} : {}), approvalPolicy: "never", sandbox: "workspace-write" })).thread.id;
    let turnId = null, finalText = "";
    let off, abort, timer;
    const completed = new Promise((resolve, reject) => {
      abort = () => { if(turnId)this.request("turn/interrupt",{threadId,turnId}).catch(()=>{}); reject(new Error("Paused")); };
      signal?.addEventListener("abort",abort,{once:true});
      timer=setTimeout(()=>{ abort(); },30*60*1000);
      off = this.onEvent(message => {
        if(message.method === "transport/closed") { reject(message.error); return; }
        if(message.params?.threadId !== threadId) return;
        if(turnId && message.params?.turnId && message.params.turnId !== turnId) return;
        const item = message.params?.item;
        if (message.method === "item/agentMessage/delta") {
          const delta = message.params?.delta || ""; finalText = (finalText + delta).slice(-64000); onProgress(delta); return;
        }
        if (message.method === "turn/completed" && (!turnId || message.params?.turn?.id === turnId)) {
          off();
          const turn = message.params?.turn;
          turn?.status === "completed" ? resolve({ threadId, turnId: turn.id, text: finalText }) : reject(Object.assign(new Error(turn?.error?.message || `Codex turn ${turn?.status || "failed"}.`), {data:turn?.error}));
        }
      });
    });
    completed.catch(()=>{});
    try {
    if(signal?.aborted) throw new Error("Paused");
    const started = await this.request("turn/start", {
      threadId, input: [{ type: "text", text: prompt }], cwd,
      approvalPolicy: "never", sandboxPolicy: { type: "workspaceWrite", writableRoots: [cwd], networkAccess: false }, ...(model ? {model} : {})
    });
    turnId = started.turn.id;
    onTurnStarted({ threadId, turnId });
    if(signal?.aborted) abort();
    return await completed;
    } finally { clearTimeout(timer); off?.(); signal?.removeEventListener("abort",abort); }
  }
  stop() {
    const child=this.process; this.process=null;
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error("Codex App Server stopped"));}this.pending.clear();
    for(const listener of [...this.listeners])listener({method:"transport/closed",error:new Error("Codex App Server stopped")});
    if(!child)return Promise.resolve();
    return new Promise(resolve=>{
      if(process.platform==='win32'&&Number.isInteger(child.pid))execFile('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:10000},()=>{child.kill();resolve();});
      else{child.kill();resolve();}
    });
  }
}

module.exports = { CodexAppServer };
