"use strict";
const fs = require("node:fs");
const path = require("node:path");

// Same vocabulary as Android's AppearancePrefs so both apps describe one appearance system.
const MODES = ["system", "light", "dark"];
const PALETTES = ["junction", "sakura", "moss"];
const ARTWORK = ["none", "sakura-mountain"];
const MOTION = ["system", "reduced", "full"];
const DEFAULTS = Object.freeze({ mode: "system", palette: "junction", artwork: "none", backgroundIntensity: 55, petals: true, petalIntensity: 35, motion: "system" });

function validate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid appearance");
  const known = Object.keys(DEFAULTS);
  if (Object.keys(value).some(key => !known.includes(key))) throw new Error("Unknown appearance setting");
  const next = { ...DEFAULTS, ...value };
  if (!MODES.includes(next.mode)) throw new Error("Invalid light/dark mode");
  if (!PALETTES.includes(next.palette)) throw new Error("Invalid colour palette");
  if (!ARTWORK.includes(next.artwork)) throw new Error("Invalid artwork theme");
  if (!MOTION.includes(next.motion)) throw new Error("Invalid motion preference");
  if (typeof next.petals !== "boolean") throw new Error("Invalid petal preference");
  for (const key of ["backgroundIntensity", "petalIntensity"]) if (!Number.isInteger(next[key]) || next[key] < 0 || next[key] > 100) throw new Error(`Invalid ${key}`);
  return next;
}

/** Appearance preferences in the app's user-data folder; a damaged file falls back to defaults. */
class AppearanceStore {
  constructor(file) { this.file = file; }
  get() {
    try { return validate(JSON.parse(fs.readFileSync(this.file, "utf8"))); } catch { return { ...DEFAULTS }; }
  }
  set(patch) {
    const next = validate({ ...this.get(), ...(patch || {}) });
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
    fs.renameSync(temp, this.file);
    return next;
  }
}

module.exports = { AppearanceStore, APPEARANCE_DEFAULTS: DEFAULTS, validateAppearance: validate, MODES, PALETTES, ARTWORK, MOTION };
