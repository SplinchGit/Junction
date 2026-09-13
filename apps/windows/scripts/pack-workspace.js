"use strict";

const fs = require("node:fs");
const path = require("node:path");
const asar = require("@electron/asar");

async function main() {
  const root = path.resolve(__dirname, "..");
  const outputName = process.env.JUNCTION_PACK_OUTPUT || "workspace-win-unpacked";
  if (!/^[a-z0-9_-]+$/i.test(outputName)) throw new Error("Invalid workspace package output name.");
  const output = path.join(root, "dist", outputName);
  const staging = path.join(root, "dist", ".workspace-app");
  fs.rmSync(output, { recursive: true, force: true });
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(path.join(output, "resources"), { recursive: true });
  fs.mkdirSync(staging, { recursive: true });
  fs.cpSync(path.join(root, "node_modules", "electron", "dist"), output, { recursive: true });
  fs.renameSync(path.join(output, "electron.exe"), path.join(output, "Junction.exe"));
  fs.cpSync(path.join(root, "src"), path.join(staging, "src"), { recursive: true });
  fs.cpSync(path.join(root, "renderer"), path.join(staging, "renderer"), { recursive: true });
  // Runtime dependencies are not resolved from the developer workspace once
  // Electron is launched from app.asar. Keep this explicit and small so a
  // packaged local QR pairing screen cannot fail at startup.
  for (const dependency of ["qrcode", "pngjs", "dijkstrajs"]) {
    fs.cpSync(path.join(root, "node_modules", dependency), path.join(staging, "node_modules", dependency), { recursive: true });
  }
  fs.writeFileSync(path.join(staging, "package.json"), JSON.stringify({ name: "junction-windows", version: require("../package.json").version, main: "src/main.js" }));
  await asar.createPackage(staging, path.join(output, "resources", "app.asar"));
  fs.cpSync(path.resolve(root, "../../services/pc-companion/src"), path.join(output, "resources", "pc-companion"), { recursive: true });
  fs.rmSync(staging, { recursive: true, force: true });
  console.log(output);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
