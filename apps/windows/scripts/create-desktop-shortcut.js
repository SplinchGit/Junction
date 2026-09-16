"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const outputName = process.env.JUNCTION_PACK_OUTPUT || "workspace-win-unpacked";
const runtime = process.env.JUNCTION_RUNTIME_DIRECTORY
  ? path.resolve(process.env.JUNCTION_RUNTIME_DIRECTORY)
  : path.join(root, "dist", outputName);
const target = path.join(runtime, "Junction.exe");
const resources = path.join(runtime, "resources", "app.asar");
const desktop = path.join(os.homedir(), "Desktop");
const shortcut = path.join(desktop, "Junction.lnk");

if (process.platform !== "win32") throw new Error("The Junction desktop shortcut is only supported on Windows.");
if (!fs.existsSync(target) || !fs.existsSync(resources)) {
  throw new Error(`Packaged runtime is incomplete. Run npm run pack:workspace first: ${runtime}`);
}
fs.mkdirSync(desktop, { recursive: true });

function powershellString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const command = [
  "$shell = New-Object -ComObject WScript.Shell",
  `$shortcut = $shell.CreateShortcut(${powershellString(shortcut)})`,
  `$shortcut.TargetPath = ${powershellString(target)}`,
  `$shortcut.WorkingDirectory = ${powershellString(runtime)}`,
  `$shortcut.IconLocation = ${powershellString(`${target},0`)}`,
  "$shortcut.Description = 'Junction desktop companion'",
  "$shortcut.Save()"
].join("; ");
const encoded = Buffer.from(command, "utf16le").toString("base64");
const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { stdio: "inherit" });
if (result.status !== 0) process.exit(result.status || 1);
console.log(shortcut);
