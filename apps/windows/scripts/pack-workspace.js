"use strict";

const fs = require("node:fs");
const path = require("node:path");
const asar = require("@electron/asar");
const { createRequire } = require("node:module");
const { execFileSync } = require("node:child_process");

function copyRuntimeDependencies(root, staging) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  function copy(name, from, destination, ancestors = new Map()) {
    const resolver = createRequire(path.join(from, "package.json"));
    const source = resolver.resolve.paths(name).map(directory => path.join(directory, name)).find(directory => fs.existsSync(path.join(directory, "package.json")));
    if (!source) throw new Error(`Required runtime dependency is missing: ${name}`);
    if (ancestors.get(name) === source) return;
    const target = path.join(destination, "node_modules", name);
    fs.cpSync(source, target, { recursive: true, filter: file => path.basename(file) !== "node_modules" });
    const pkg = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8"));
    const chain = new Map(ancestors); chain.set(name, source);
    for (const dependency of Object.keys(pkg.dependencies || {})) {
      if (pkg.optionalDependencies?.[dependency]) continue;
      copy(dependency, source, target, chain);
    }
  }
  for (const name of Object.keys(manifest.dependencies || {})) copy(name, root, staging);
  fs.writeFileSync(path.join(staging, "package.json"), JSON.stringify({ name: manifest.name, version: manifest.version, main: "src/main.js", dependencies: manifest.dependencies }));
}

function validateRuntimeDependencies(staging) {
  // Resolve every required edge inside staging; workspace node_modules must
  // never make a broken package appear to pass its smoke test.
  const seen = new Set();
  function visit(directory) {
    if (seen.has(directory)) return; seen.add(directory);
    const pkg = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
    const resolver = createRequire(path.join(directory, "package.json"));
    for (const name of Object.keys(pkg.dependencies || {})) {
      if (pkg.optionalDependencies?.[name]) continue;
      const resolved = resolver.resolve.paths(name).map(base => path.join(base, name)).find(base => fs.existsSync(path.join(base, "package.json")));
      if (!resolved || path.relative(staging, resolved).startsWith("..")) throw new Error(`Packaged runtime dependency is missing: ${name}`);
      visit(resolved);
    }
  }
  visit(staging);
  execFileSync(process.execPath, ["-e", `const {createRequire}=require('node:module');const r=createRequire(${JSON.stringify(path.join(staging, "package.json"))});for(const n of ['qrcode','selfsigned','ws','bonjour-service','multicast-dns'])r(n);`], { cwd: staging, stdio: "pipe" });
}

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
  copyRuntimeDependencies(root, staging);
  validateRuntimeDependencies(staging);
  await asar.createPackage(staging, path.join(output, "resources", "app.asar"));
  fs.cpSync(path.resolve(root, "../../services/pc-companion/src"), path.join(output, "resources", "pc-companion"), { recursive: true });
  fs.rmSync(staging, { recursive: true, force: true });
  console.log(output);
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { copyRuntimeDependencies, validateRuntimeDependencies };
