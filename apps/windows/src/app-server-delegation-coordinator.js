"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DelegationCoordinator } = require("./delegation-coordinator");
const { CodexAppServer } = require("./codex-app-server");

const WAITING = "waiting_for_capacity";
const CAPACITY_THRESHOLD_PERCENT = 95;
const RESUME_SAFETY_MS = 60_000;

function capacityWindow(rateLimits, now = Date.now()) {
  const groups = rateLimits?.rateLimitsByLimitId
    ? Object.values(rateLimits.rateLimitsByLimitId)
    : rateLimits?.rateLimits ? [rateLimits.rateLimits] : [];
  const blocked = groups.flatMap(group => [group.primary, group.secondary]
    .filter(Boolean)
    .filter(window => Number(window.usedPercent) >= CAPACITY_THRESHOLD_PERCENT || group.rateLimitReachedType)
    .map(window => ({
      limitId: group.limitId || "Codex",
      limitName: group.limitName || group.limitId || "Codex",
      usedPercent: Number(window.usedPercent),
      resetsAt: Number(window.resetsAt) * 1000
    }))
  ).filter(window => Number.isFinite(window.resetsAt) && window.resetsAt > now);
  if (!blocked.length) return null;
  const resumesAt = Math.max(...blocked.map(window => window.resetsAt)) + RESUME_SAFETY_MS;
  return { resumesAt, windows: blocked };
}

/** Delegation coordinator backed by persistent Codex App Server threads. */
class AppServerDelegationCoordinator extends DelegationCoordinator {
  constructor(directory, options = {}) {
    super(directory, options);
    this.appServer = options.appServer || new CodexAppServer({ onDiagnostic: value => this.audit("app_server_diagnostic", { value: value.slice(0, 500) }) });
    this.resumeTimers = new Map();
    for (const plan of this.plans) for (const project of plan.projects) {
      if (project.status === "running" || project.status === "queued") {
        project.status = WAITING;
        project.resumeAt = Date.now();
        project.summary = "Junction restarted; queued to resume its approved Codex task";
      }
      if (project.status === WAITING) this.scheduleResume(plan, project);
    }
    this.save();
  }

  scheduleResume(plan, project) {
    const delay = Math.max(0, Math.min((project.resumeAt || Date.now()) - Date.now(), 0x7fffffff));
    clearTimeout(this.resumeTimers.get(project.id));
    this.resumeTimers.set(project.id, setTimeout(() => {
      if (project.status !== WAITING) return;
      // JavaScript timers cap at roughly 25 days. Preserve the exact deadline
      // if a future account window is longer than that rather than retrying it
      // early or replacing it with a made-up interval.
      if ((project.resumeAt || 0) > Date.now()) return this.scheduleResume(plan, project);
      this.runProject(plan, project).catch(error => this.fail(project, error));
    }, delay));
  }
  async waitForConfirmedCapacity(plan, project) {
    const availability = capacityWindow(await this.appServer.readRateLimits());
    if (!availability) return false;
    project.status = WAITING;
    project.resumeAt = availability.resumesAt;
    const names = availability.windows.map(window => `${window.limitName} ${window.usedPercent}%`).join(", ");
    project.summary = `Codex capacity is at ${names}; resumes after ${new Date(project.resumeAt).toLocaleString()}.`;
    this.scheduleResume(plan, project);
    this.save();
    this.audit("agent_waiting_for_capacity", { planId: plan.id, projectId: project.id, resumeAt: project.resumeAt, windows: availability.windows });
    this.refresh(plan);
    return true;
  }
  fail(project, error) {
    project.status = "failed";
    project.summary = String(error.message || error).slice(0, 180);
    this.save();
  }
  async runProject(plan, project, decision = "") {
    try {
      if (await this.waitForConfirmedCapacity(plan, project)) return;
    } catch (error) {
      // A status read is advisory before a turn begins. Do not prevent an
      // otherwise healthy Codex task from starting merely because the usage
      // endpoint is temporarily unavailable.
      this.audit("rate_limit_status_unavailable", { planId: plan.id, projectId: project.id, message: String(error.message || error).slice(0, 300) });
    }
    const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
    const run = plan.id.slice(0, 8);
    project.branch = project.branch || `junction/delegation/${run}/${slug}`;
    project.worktree = project.worktree || path.join(this.directory, "worktrees", run, slug);
    if (!fs.existsSync(project.worktree)) {
      fs.mkdirSync(path.dirname(project.worktree), { recursive: true });
      await this.exec("git", ["-C", project.repoPath, "worktree", "add", "-b", project.branch, project.worktree, project.baseSha], { windowsHide: true });
    }
    project.status = "running";
    project.resumeAt = null;
    project.summary = decision ? "Codex resumed with your decision" : "Codex is working in its isolated worktree";
    project.decisionRequest = null;
    this.save(); this.audit("agent_started", { planId: plan.id, projectId: project.id, branch: project.branch, threadId: project.codexThreadId || null });
    const prompt = [
      `Work only on ${project.name} in this isolated worktree.`,
      "Do not merge, push, modify another repository, access credentials, or request broad machine access.",
      "Implement the assigned work, run relevant tests, and commit all changes to the current delegation branch.",
      "If a product decision is required, end with exactly: JUNCTION_DECISION_REQUIRED: <concise question>.",
      `Shared owner instruction: ${plan.instruction}`,
      decision ? `Owner decision: ${decision}` : ""
    ].filter(Boolean).join("\n\n");
    try {
      const result = await this.appServer.run({
        threadId: project.codexThreadId || null,
        cwd: project.worktree,
        prompt,
        onTurnStarted: ids => { project.codexThreadId = ids.threadId; project.codexTurnId = ids.turnId; this.save(); },
        onProgress: delta => { project.lastOutput = `${project.lastOutput || ""}${delta}`.slice(-4000); project.summary = project.lastOutput.split(/\r?\n/).filter(Boolean).at(-1)?.slice(0, 180) || project.summary; this.save(); }
      });
      project.codexThreadId = result.threadId;
      project.codexTurnId = result.turnId;
      const decisionMatch = (result.text || project.lastOutput || "").match(/JUNCTION_DECISION_REQUIRED:\s*(.+)/i);
      if (decisionMatch) { project.status = "needs_decision"; project.decisionRequest = decisionMatch[1].trim(); }
      else await this.verify(project);
    } catch (error) {
      const message = String(error.message || error);
      if (/rate.?limit|usage.?limit|quota|capacity/i.test(message)) {
        try {
          if (!await this.waitForConfirmedCapacity(plan, project)) {
            project.status = "failed";
            project.summary = "Codex reported a capacity problem, but Junction could not read a confirmed reset time. The task state is preserved; retry it after checking Codex usage.";
          }
        } catch (rateLimitError) {
          project.status = "failed";
          project.summary = "Codex reported a capacity problem, but Junction could not read its usage windows. The task state is preserved; retry it after checking Codex usage.";
        }
      } else {
        project.status = "failed";
        project.summary = message.slice(0, 180);
      }
    }
    this.save(); this.audit("agent_finished", { planId: plan.id, projectId: project.id, status: project.status, threadId: project.codexThreadId || null, headSha: project.headSha }); this.refresh(plan);
  }
  cancel(planId, projectId) {
    const plan = this.get(planId), project = plan?.projects.find(item => item.id === projectId);
    if (!project || (project.status !== "running" && project.status !== WAITING)) throw new Error("This agent is not running or waiting.");
    clearTimeout(this.resumeTimers.get(project.id));
    this.resumeTimers.delete(project.id);
    if (project.codexThreadId && project.codexTurnId) this.appServer.request("turn/interrupt", { threadId: project.codexThreadId, turnId: project.codexTurnId }).catch(() => {});
    project.status = "cancelled"; project.summary = "Stopped by owner; branch, worktree, and Codex thread are preserved";
    this.save(); this.audit("agent_cancelled", { planId, projectId, threadId: project.codexThreadId || null }); this.refresh(plan);
  }
}

module.exports = { AppServerDelegationCoordinator, WAITING, capacityWindow };
