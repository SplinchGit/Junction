# Nethra Portable Models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let either local model continue the same Nethra objective and ship the working 80B alias in the app.

**Architecture:** Store a per-task model ID separate from task progress. Resolve model-specific inference settings at the runner boundary. Keep one tool harness and one durable record.

**Tech Stack:** Electron/CommonJS, Node test runner, SQLite, Ollama, Android Kotlin catalog.

**Spec:** `docs/superpowers/specs/2026-11-07-nethra-portable-models-design.md`

## Global Constraints

- Preserve existing task state and the default `qwen3:30b` for legacy tasks.
- The 80B option uses the local `junction-qwen3-next:80b-q3km` alias with its corrected Ollama template.
- No silent fallback or task-state fork on a model failure.

## Review Focus

- Existing tasks with no model field use 30B.
- Switching a sleeping task preserves its checkpoint and wakes useful pending work.
- An active task cannot change model midway through a call.
- 80B native tool calls work with thinking disabled.
- Packaged Windows and Android selectors expose the same local model ID.

---

### Task 1: Persist and expose the task model

- [ ] Add a failing store/API test for create, configure, legacy default, and preserved checkpoint.
- [ ] Implement validated model persistence and API fields.
- [ ] Run focused tests.

### Task 2: Run either model through the shared harness

- [ ] Add a failing runner test for 80B, model-specific options, and a 30B follow-up using the same task state.
- [ ] Replace the fixed model constant at the inference boundary; keep prompts generic.
- [ ] Run focused tests.

### Task 3: Expose and deploy model choice

- [ ] Add a failing catalog/UI contract test for the local alias.
- [ ] Update Windows and Android selectors, task controls, and status.
- [ ] Run Windows tests and Android build/tests, package Windows, launch the desktop shortcut, and verify the running app.
