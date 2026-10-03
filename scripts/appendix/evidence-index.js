"use strict";

// Generates the factual tables behind the thesis Part 3 appendices: SHA-256 of
// every evidence file under output/, a code inventory with Git status, test
// counts per file and the software environment. Nothing here is typed by hand.
//
//   node scripts/appendix/evidence-index.js output/appendix_evidence_2026-10-04

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const cp = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.resolve(ROOT, process.argv[2] || "output/appendix_evidence");
const run = (cmd, args, cwd = ROOT) => cp.execFileSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const csv = rows => rows.map(row => row.map(value => /[",\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value)).join(",")).join("\n") + "\n";

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.name === ".DS_Store" || entry.name.startsWith("~$") || entry.name === "node_modules" || entry.name === "__pycache__") return [];
    return entry.isDirectory() ? walk(full) : [full];
  });
}

fs.mkdirSync(OUT, { recursive: true });
const rel = file => path.relative(ROOT, file).split(path.sep).join("/");

// 1. Evidence files.
const evidence = walk(path.join(ROOT, "output")).filter(file => !file.startsWith(OUT + path.sep)).sort();
fs.writeFileSync(path.join(OUT, "evidence_files_sha256.csv"),
  csv([["path", "bytes", "sha256"], ...evidence.map(file => [rel(file), fs.statSync(file).size, sha(file)])]));
const folders = {};
for (const file of evidence) {
  const folder = rel(file).split("/").slice(0, 2).join("/");
  folders[folder] = folders[folder] || { files: 0, bytes: 0 };
  folders[folder].files += 1; folders[folder].bytes += fs.statSync(file).size;
}

// 2. Code inventory with Git status.
const tracked = new Set(run("git", ["ls-files"]).split("\n").filter(Boolean));
const status = Object.fromEntries(run("git", ["status", "--porcelain", "--untracked-files=all"]).split("\n").filter(Boolean)
  .map(line => [line.slice(3).replace(/^"|"$/g, ""), line.slice(0, 2)]));
const GROUPS = [
  ["Clinician web pages and browser scripts", file => /^landing\/[^/]+\.(html|js|css)$/.test(file)],
  ["Server API handlers and libraries", file => /^landing\/api\/.*\.js$/.test(file)],
  ["Frozen model artifact", file => /^landing\/api\/_models\/.*\.json$/.test(file)],
  ["Automated tests and fixtures", file => /^landing\/tests\/.*\.js$/.test(file)],
  ["n8n workflow definitions", file => /^workflows\/.*\.json$/.test(file)],
  ["Database migrations", file => /^supabase\/migrations\/.*\.sql$/.test(file)],
  ["Evaluation, simulation and evidence scripts", file => /^scripts\/.*\.(js|mjs|py)$/.test(file)],
  ["Protocols and method notes for scripts", file => /^scripts\/.*\.md$/.test(file)]
];
const sources = walk(ROOT).map(rel).filter(file => !file.startsWith("output/") && !file.startsWith(".git/") && !file.startsWith(".vercel/"));
const inventory = [["group", "path", "lines", "git_status"]];
const summary = [];
for (const [group, match] of GROUPS) {
  const files = sources.filter(match).sort();
  let lines = 0; const counts = { committed_unchanged: 0, committed_modified: 0, not_committed: 0 };
  for (const file of files) {
    const n = fs.readFileSync(path.join(ROOT, file), "utf8").split("\n").length; lines += n;
    const state = !tracked.has(file) ? "not_committed" : status[file] ? "committed_modified" : "committed_unchanged";
    counts[state] += 1; inventory.push([group, file, n, state]);
  }
  summary.push({ group, files: files.length, lines, ...counts });
}
fs.writeFileSync(path.join(OUT, "code_inventory.csv"), csv(inventory));

// 3. Tests per file.
const testRows = [["test_file", "passed", "failed"]];
for (const file of fs.readdirSync(path.join(ROOT, "landing/tests")).filter(name => name.endsWith(".test.js")).sort()) {
  let output = "";
  try { output = run("node", ["--test", `tests/${file}`], path.join(ROOT, "landing")); } catch (error) { output = String(error.stdout || ""); }
  const number = label => Number((output.match(new RegExp(`^ℹ ${label} (\\d+)`, "m")) || [0, 0])[1]);
  testRows.push([file, number("pass"), number("fail")]);
}
fs.writeFileSync(path.join(OUT, "tests_per_file.csv"), csv(testRows));

// 4. Environment.
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "landing/package-lock.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "landing/package.json"), "utf8"));
let python = null;
try { python = run("python3", ["-c", "import sys, matplotlib; print(sys.version.split()[0], matplotlib.__version__)"]).trim().split(" "); } catch (_) { /* not installed */ }
const environment = {
  generated_at: new Date().toISOString(),
  git_commit: run("git", ["rev-parse", "HEAD"]).trim(),
  git_last_commit_date: run("git", ["log", "-1", "--format=%ad", "--date=short"]).trim(),
  git_changed_or_untracked_entries: Object.keys(status).length,
  node: process.version,
  os: run("sw_vers", ["-productVersion"]).trim(),
  runtime_dependencies: Object.fromEntries(Object.keys(pkg.dependencies || {}).map(name => [name, lock.packages[`node_modules/${name}`].version])),
  declared_node_engine: pkg.engines && pkg.engines.node,
  python: python && python[0], matplotlib: python && python[1],
  frozen_model_sha256: sha(path.join(ROOT, "landing/api/_models/frequency-logistic-v1.json")),
  synthetic_dataset: JSON.parse(run("node", ["scripts/generate-frequency-dataset.js"])),
  evidence_folders: folders,
  code_summary: summary,
  tests: { files: testRows.length - 1, passed: testRows.slice(1).reduce((s, r) => s + r[1], 0), failed: testRows.slice(1).reduce((s, r) => s + r[2], 0) }
};
fs.writeFileSync(path.join(OUT, "environment.json"), `${JSON.stringify(environment, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ evidence_files: evidence.length, tests: environment.tests, code_summary: summary }, null, 2)}\n`);
