"use strict";

const path = require("node:path");
const { execFile } = require("node:child_process");

function inspectWindowsContext(options = {}) {
  if (process.platform !== "win32") return Promise.reject(new Error("Windows UI Automation is available only on Windows."));
  const script = path.join(__dirname, "windows-uia.ps1");
  const maxElements = Math.min(Math.max(Number(options.maxElements) || 100, 1), 100);
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-MaxElements", String(maxElements)],
      { windowsHide: true, timeout: 5000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) return reject(new Error(`UI Automation inspection failed: ${stderr.trim() || error.message}`));
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error("UI Automation returned invalid JSON.")); }
      });
  });
}

module.exports = { inspectWindowsContext };
