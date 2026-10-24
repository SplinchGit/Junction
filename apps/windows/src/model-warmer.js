"use strict";
const os = require("node:os");

// Idle retention choices map straight to Ollama keep_alive durations. "2h" matches the
// residency Junction has always used: a cold load of the 19 GB 30B model is ~50 s here.
const RETENTION = Object.freeze({ "15m": "15m", "30m": "30m", "1h": "1h", "2h": "2h", "4h": "4h", "8h": "8h" });
const DEFAULT_RETENTION = "2h";
const STARTUP = Object.freeze(["desktop", "always", "never"]);
const DEFAULT_STARTUP = "desktop";
const GiB = 1024 ** 3;
// Headroom kept free for Windows, Electron and the KV cache when the model is not fully in VRAM.
const MEMORY_HEADROOM_BYTES = 1.5 * GiB;
const RESIDENCY_CACHE_MS = 2_000;
const FAILURE_COOLDOWN_MS = { background: 120_000, interactive: 15_000 };

function retentionValue(value) { return Object.hasOwn(RETENTION, value) ? RETENTION[value] : RETENTION[DEFAULT_RETENTION]; }

/**
 * Loads the chat model before the owner's message arrives, without generating anything.
 * Warm-up never takes the inference slot: Ollama serialises a chat behind an in-progress
 * load of the same model and options, so holding Junction's lock would only delay
 * interactive work. Concurrent requests share one load; a resident copy is never reloaded.
 */
class ModelWarmer {
  constructor({ fetchImpl = fetch, ollamaUrl = "http://127.0.0.1:11434", model = "qwen3:30b", contextTokens = 4096, retention = () => DEFAULT_RETENTION, freeMemory = () => os.freemem(), now = Date.now, loadTimeoutMs = 180_000, profile = null } = {}) {
    Object.assign(this, { fetch: fetchImpl, ollamaUrl: ollamaUrl.replace(/\/$/, ""), model, contextTokens, retention, freeMemory, now, loadTimeoutMs });
    // profile: optional {load(), save(value)} persisting the last observed GPU share across restarts.
    this.profile = profile;
    this.inflight = null; this.residencyCheck = null; this.listeners = new Set();
    this.snapshot = { state: "unknown", model, resident: false, checkedAt: null, reason: null, lastWarm: null, lastError: null, expiresAt: null, sizeVram: null, size: null };
    this.failedAt = 0; this.knownSize = null; this.knownVram = null; this.busy = 0;
    try { const saved = profile?.load?.(); if (Number.isFinite(saved?.sizeVram)) this.knownVram = saved.sizeVram; if (Number.isFinite(saved?.size)) this.knownSize = saved.size; } catch {}
  }
  keepAlive() { return retentionValue(this.retention()); }
  state() { return { ...this.snapshot, state: this.busy && this.snapshot.state === "ready" ? "busy" : this.snapshot.state, keepAlive: this.keepAlive(), warming: Boolean(this.inflight) }; }
  onChange(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  set(patch) {
    const before = this.state().state;
    Object.assign(this.snapshot, patch);
    if (this.state().state !== before) for (const listener of this.listeners) { try { listener(this.state()); } catch {} }
  }
  /** Inference markers so status can say "busy" without polling Ollama. */
  inferenceStarted() { this.busy++; this.set({}); }
  inferenceFinished({ ok = true, model = this.model } = {}) {
    this.busy = Math.max(0, this.busy - 1);
    // A completed chat proves residency at the chat context; Ollama just renewed keep_alive.
    if (ok && model === this.model) this.set({ state: "ready", resident: true, checkedAt: this.now(), reason: null, lastError: null });
    else this.set({});
  }
  matches(entry) { return entry && (entry.name === this.model || entry.model === this.model) && (entry.context_length == null || entry.context_length === this.contextTokens); }
  /** Cheap residency probe (one /api/ps), cached briefly so many clients opening at once cost one call. */
  async residency({ maxAgeMs = RESIDENCY_CACHE_MS } = {}) {
    if (this.snapshot.checkedAt && this.now() - this.snapshot.checkedAt < maxAgeMs && this.snapshot.state !== "unknown") return this.state();
    if (this.residencyCheck) return this.residencyCheck;
    this.residencyCheck = (async () => {
      try {
        const response = await this.fetch(`${this.ollamaUrl}/api/ps`, { signal: AbortSignal.timeout(3_000) });
        if (!response.ok) throw new Error(`Ollama status HTTP ${response.status}`);
        const models = (await response.json()).models || [];
        const entry = models.find(item => this.matches(item));
        const other = models.find(item => item.name === this.model || item.model === this.model);
        if (other?.size) this.knownSize = other.size;
        if (other?.size_vram != null && other.size_vram !== this.knownVram) { this.knownVram = other.size_vram; try { this.profile?.save?.({ size: this.knownSize, sizeVram: this.knownVram }); } catch {} }
        const loading = Boolean(this.inflight);
        this.set({ state: entry ? "ready" : loading ? "loading" : "cold", resident: Boolean(entry), checkedAt: this.now(), expiresAt: entry?.expires_at || null, sizeVram: entry?.size_vram ?? null, size: entry?.size ?? null, reason: entry ? null : other ? "resident at a different context size" : this.snapshot.reason });
      } catch (error) {
        this.set({ state: "unavailable", resident: false, checkedAt: this.now(), lastError: "Ollama is not reachable on this PC.", reason: String(error?.message || error).slice(0, 160) });
      } finally { this.residencyCheck = null; }
      return this.state();
    })();
    return this.residencyCheck;
  }
  async modelSize() {
    if (this.knownSize) return this.knownSize;
    try {
      const response = await this.fetch(`${this.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3_000) });
      const entry = ((await response.json()).models || []).find(item => item.name === this.model || item.model === this.model);
      if (entry?.size) this.knownSize = entry.size;
    } catch {}
    return this.knownSize;
  }
  /**
   * System RAM the load still needs: whatever does not fit in VRAM, plus headroom. Uses the
   * VRAM share Ollama last reported for this model (persisted). Before any observation it
   * assumes half the model lands in GPU memory; this PC was measured at 55%.
   */
  async memoryShortfall() {
    const size = await this.modelSize();
    if (!size) return 0;
    const vram = Number.isFinite(this.knownVram) ? this.knownVram : size * 0.5;
    const needed = Math.max(0, size - vram) + MEMORY_HEADROOM_BYTES;
    const free = this.freeMemory();
    return free >= needed ? 0 : needed - free;
  }
  /**
   * reason: what asked for it (startup, chat_open, voice, objective...). priority "interactive"
   * means the owner is looking at a client; "background" means automatic preparation.
   * force skips the memory guard and failure cooldown (an explicit "Load model" request).
   */
  warm({ reason = "unspecified", priority = "background", force = false } = {}) {
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      const started = this.now();
      const current = await this.residency({ maxAgeMs: 1_000 });
      if (current.resident) return { ...this.state(), outcome: "already_resident", reason };
      if (current.state === "unavailable") return { ...this.state(), outcome: "unavailable", reason };
      const cooldown = FAILURE_COOLDOWN_MS[priority] ?? FAILURE_COOLDOWN_MS.background;
      if (!force && this.failedAt && this.now() - this.failedAt < cooldown) return { ...this.state(), outcome: "cooldown", reason };
      if (!force) {
        const shortfall = await this.memoryShortfall();
        if (shortfall > 0) {
          this.set({ state: "deferred", reason: `Not enough free memory to load ${this.model} automatically (${(shortfall / GiB).toFixed(1)} GiB short).` });
          return { ...this.state(), outcome: "memory_pressure", reason };
        }
      }
      this.set({ state: "loading", reason: null, lastError: null });
      try {
        // An empty prompt is Ollama's documented load request: no tokens are generated.
        const response = await this.fetch(`${this.ollamaUrl}/api/generate`, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(this.loadTimeoutMs), body: JSON.stringify({ model: this.model, keep_alive: this.keepAlive(), options: { num_ctx: this.contextTokens } }) });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error || `Ollama load HTTP ${response.status}`);
        const loadMs = Number.isFinite(payload?.load_duration) ? Math.round(payload.load_duration / 1e6) : null;
        this.failedAt = 0;
        this.set({ state: "ready", resident: true, checkedAt: this.now(), lastWarm: { at: this.now(), reason, priority, wallMs: this.now() - started, loadMs, outcome: "loaded" } });
        return { ...this.state(), outcome: "loaded", reason };
      } catch (error) {
        this.failedAt = this.now();
        const message = String(error?.message || error).replace(/\s+/g, " ").slice(0, 200);
        this.set({ state: "failed", resident: false, checkedAt: this.now(), lastError: message, lastWarm: { at: this.now(), reason, priority, wallMs: this.now() - started, outcome: "failed" } });
        return { ...this.state(), outcome: "failed", reason };
      }
    })().finally(() => { this.inflight = null; });
    return this.inflight;
  }
}

module.exports = { ModelWarmer, RETENTION, DEFAULT_RETENTION, STARTUP, DEFAULT_STARTUP, retentionValue };
