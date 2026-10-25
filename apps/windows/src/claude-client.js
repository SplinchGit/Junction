"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

// Junction runs the owner's own, unmodified Claude Code binary. It never reads,
// stores or forwards Claude credentials; sign-in stays inside Anthropic's own flow.
// The npm shim is a .cmd file, which cannot be spawned without a shell, so prefer
// the real executable it points at.
function resolveClaudeExecutable(env = process.env, exists = fs.existsSync) {
  if (env.JUNCTION_CLAUDE_PATH && exists(env.JUNCTION_CLAUDE_PATH)) return env.JUNCTION_CLAUDE_PATH;
  if (process.platform !== "win32") return "claude";
  const candidates = [
    path.join(env.USERPROFILE || os.homedir(), ".local", "bin", "claude.exe"),
    env.APPDATA && path.join(env.APPDATA, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"),
  ].filter(Boolean);
  return candidates.find(item => exists(item)) || "claude";
}

async function getClaudeStatus(run = execFileAsync, executable = resolveClaudeExecutable()) {
  try {
    const version = (await run(executable, ["--version"], { windowsHide: true, timeout: 10_000 })).stdout.trim();
    const status = JSON.parse((await run(executable, ["auth", "status"], { windowsHide: true, timeout: 10_000 })).stdout);
    const subscription = status.loggedIn === true && status.authMethod === "claude.ai";
    const plan = typeof status.subscriptionType === "string" ? status.subscriptionType.slice(0, 30) : "";
    return { installed: true, ready: subscription, subscription, plan, version: version.slice(0, 80), detail: subscription ? `Ready — using this PC's Claude ${plan || "subscription"} sign-in` : "Claude Code is not signed in with a Claude subscription" };
  } catch (error) {
    const detail = String(error.stderr || error.message || "Claude Code is not available").trim().slice(0, 240);
    return { installed: false, ready: false, subscription: false, plan: "", version: "", detail: detail || "Install Claude Code and sign in" };
  }
}

/** Claude reports utilization as a 0–1 fraction and reset times in epoch seconds. */
function claudeWindows(info) {
  const windows = [];
  for (const [name, value] of Object.entries(info?.unifiedWindows || {})) {
    if (!Number.isFinite(value?.utilization) || !Number.isFinite(value?.resetsAt)) continue;
    windows.push({ name: name.slice(0, 30), usedPercent: Math.round(Math.min(1, Math.max(0, value.utilization)) * 1000) / 10, resetsAt: value.resetsAt * 1000 });
  }
  return { windows, limitReached: info?.status === "rejected", limitResetsAt: Number.isFinite(info?.resetsAt) ? info.resetsAt * 1000 : null };
}

function parseClaudeStream(output) {
  let result = null, rateLimit = null, model = null;
  for (const line of String(output || "").split(/\r?\n/)) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type === "rate_limit_event" && event.rate_limit_info) rateLimit = claudeWindows(event.rate_limit_info);
    if (event.type === "result") result = event;
  }
  const used = Object.keys(result?.modelUsage || {});
  if (used.length) model = used[0];
  const usage = result?.usage ? Object.fromEntries(["input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens"].filter(key => Number.isSafeInteger(result.usage[key]) && result.usage[key] >= 0).map(key => [key, result.usage[key]])) : null;
  return { content: typeof result?.result === "string" ? result.result.trim() : "", isError: Boolean(result?.is_error), model, usage, rateLimit };
}

const ADVISOR_SYSTEM = "You are a technical advisor to Nethra, a local agent working on an owner-approved objective inside the Junction app. You have no tools and cannot see files, run code or browse. Give concise, concrete, verifiable advice in at most 250 words. Say what should be measured to confirm it. Never claim to have done anything.";

/** One tool-less, settings-less, non-persisted Claude turn. The prompt travels on stdin, never a shell. */
function sendClaudeConsult({ prompt, workingDirectory, model = "sonnet", signal, onRateLimit = () => {}, launch = spawn, executable = resolveClaudeExecutable() }) {
  signal?.throwIfAborted();
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--tools", "", "--strict-mcp-config", "--setting-sources", "", "--no-session-persistence", "--model", model, "--system-prompt", ADVISOR_SYSTEM];
  return new Promise((resolve, reject) => {
    const child = launch(executable, args, { cwd: workingDirectory || os.tmpdir(), windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "", settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timeout); signal?.removeEventListener("abort", abort); error ? reject(error) : resolve(value); };
    const abort = () => { child.kill(); finish(new Error("Claude consultation was interrupted.")); };
    const timeout = setTimeout(() => { child.kill(); finish(new Error("Claude consultation timed out.")); }, 180_000);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.on("error", error => finish(error));
    child.on("close", code => {
      const parsed = parseClaudeStream(stdout);
      // Record the live window even when the turn failed: a rejection is exactly what the gate needs to know.
      if (parsed.rateLimit) onRateLimit(parsed.rateLimit);
      if (parsed.rateLimit?.limitReached) return finish(Object.assign(new Error("Claude usage limit reached"), { rateLimit: parsed.rateLimit }));
      if (code !== 0 || parsed.isError) return finish(new Error((parsed.content || stderr.trim() || "Claude stopped before replying.").slice(0, 400)));
      if (!parsed.content) return finish(new Error("Claude completed without a reply."));
      finish(null, { content: parsed.content, model: parsed.model || model, usage: parsed.usage, rateLimit: parsed.rateLimit });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
  });
}

module.exports = { resolveClaudeExecutable, getClaudeStatus, claudeWindows, parseClaudeStream, sendClaudeConsult, ADVISOR_SYSTEM };
