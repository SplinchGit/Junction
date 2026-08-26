"use strict";

const fs = require("node:fs");
const path = require("node:path");

class AuditLog {
  constructor(filePath) {
    this.filePath = filePath;
  }
  append(entry) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const row = Object.freeze({ id: entry.id, timestamp: new Date().toISOString(), ...entry });
    fs.appendFileSync(this.filePath, `${JSON.stringify(row)}\n`, { encoding: "utf8", mode: 0o600 });
    return row;
  }
}

module.exports = { AuditLog };
