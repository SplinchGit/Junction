"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MAX_JOBS = 50;
const MAX_QUERIES = 3;
const MAX_SOURCES = 10;
const MAX_LEDGER_CHARS = 60_000;

function writeAtomic(file, value) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temporary, value, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function cleanQueries(values, original) {
  const unique = [];
  for (const value of [original, ...(Array.isArray(values) ? values : [])]) {
    const query = String(value || "").replace(/\s+/g, " ").trim().slice(0, 500);
    if (query.length >= 2 && !unique.some(item => item.toLowerCase() === query.toLowerCase())) unique.push(query);
  }
  return unique.slice(0, MAX_QUERIES);
}

function mergeResearch(query, results) {
  const byUrl = new Map();
  for (const result of results) for (const source of result.sources || []) {
    if (!byUrl.has(source.url)) byUrl.set(source.url, { ...source, passages: [...(source.passages || [])] });
  }
  let used = 0;
  const sources = [...byUrl.values()].slice(0, MAX_SOURCES).map((source, sourceIndex) => {
    const id = `S${sourceIndex + 1}`;
    const passages = [];
    for (const passage of source.passages || []) {
      if (used + passage.text.length > MAX_LEDGER_CHARS) break;
      used += passage.text.length;
      passages.push({ id: `${id}.p${passages.length + 1}`, text: passage.text, score: passage.score || 0 });
    }
    return { ...source, id, passages };
  });
  return { query, engine: "junction", createdAt: Date.now(), sources };
}

function citationAudit(answer, research) {
  const valid = new Set((research.sources || []).flatMap(source => source.passages.map(passage => passage.id)));
  const used = [...String(answer || "").matchAll(/\[(S\d+\.p\d+)\]/g)].map(match => match[1]);
  return { citations: [...new Set(used)], invalid: [...new Set(used.filter(id => !valid.has(id)))], hasCitations: used.length > 0 };
}

class ResearchCoordinator {
  constructor(directory, client) {
    this.file = path.join(directory, "research-jobs.json");
    this.client = client;
    this.jobs = this.load();
  }
  load() { try { const value = JSON.parse(fs.readFileSync(this.file, "utf8")); return Array.isArray(value) ? value : []; } catch { return []; } }
  save() { writeAtomic(this.file, JSON.stringify(this.jobs.slice(-MAX_JOBS), null, 2)); }
  list() { return [...this.jobs].reverse().map(({ evidence, ...job }) => ({ ...job, sourceCount: evidence?.sources?.length || 0 })); }
  get(id) { return this.jobs.find(job => job.id === id) || null; }
  async run(query, proposedQueries = []) {
    const clean = String(query || "").replace(/\s+/g, " ").trim();
    const job = { id: crypto.randomUUID(), query: clean, queries: cleanQueries(proposedQueries, clean), status: "running", createdAt: Date.now(), updatedAt: Date.now(), sourceCount: 0, error: null };
    this.jobs.push(job); this.save();
    try {
      const results = [];
      for (const planned of job.queries) {
        const result = await this.client.research(planned);
        results.push(result);
        job.sourceCount = new Set(results.flatMap(item => item.sources.map(source => source.url))).size;
        job.updatedAt = Date.now(); this.save();
      }
      job.evidence = mergeResearch(clean, results);
      job.sourceCount = job.evidence.sources.length;
      job.status = "ready"; job.updatedAt = Date.now(); this.save();
      return { ...job.evidence, jobId: job.id, queries: job.queries };
    } catch (error) {
      job.status = "failed"; job.error = String(error.message || error).slice(0, 240); job.updatedAt = Date.now(); this.save();
      throw error;
    }
  }
  recordAnswer(id, answer) {
    const job = this.get(id); if (!job?.evidence) return null;
    job.audit = citationAudit(answer, job.evidence); job.status = job.audit.invalid.length ? "citation_warning" : "complete"; job.updatedAt = Date.now(); this.save();
    return job.audit;
  }
}

module.exports = { ResearchCoordinator, citationAudit, cleanQueries, mergeResearch };
