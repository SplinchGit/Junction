"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DelegationCoordinator } = require("./delegation-coordinator");
const { CodexAppServer } = require("./codex-app-server");

const WAITING = "waiting_for_capacity";
const RETRY_MS = 5 * 60_000;

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
    const delay = Math.max(0, Math.min((project.resumeAt || Date.now()) - Date.now(), RETRY_MS));
    clearTimeout(this.resumeTimers.get(project.id));
    this.resumeTimers.set(project.id, setTimeout(() => {
      if (project.status === WAITING) this.runProject(plan, project).catch(error => this.fail(project, error));
    }, delay));
  }
  fail(project, error) {
    project.status = "failed";
    project.summary = String(error.message || error).slice(0, 180);
    this.save();
  }
  async runProject(plan, project, decision = "") {
    const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
    const run = plan.id.slice(0, 8);
    project.branch = project.branch || `junction/delegation/${run}/${slug}`;
    project.worktree = project.worktree || path.join(this.directory, "worktrees", run, slug);
    if (!fs.existsSync(project.worktree)) {
      fs.mkdirSync(path.dirname(project.worktree), { recursive: true });
      await this.exec("git", ["-C", project.repoPath, "worktree", "add", "-b", project.branch, project.worktree, project.baseSha], { windowsHide: true });
    }
    project.status = "running";
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
        project.status = WAITING;
        project.resumeAt = Date.now() + RETRY_MS;
        project.summary = "Codex capacity is temporarily unavailable; this approved job will resume automatically.";
        this.scheduleResume(plan, project);
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

module.exports = { AppServerDelegationCoordinator, WAITING };
