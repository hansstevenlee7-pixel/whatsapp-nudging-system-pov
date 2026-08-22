// Read-only check that the Sheet migrations the portal requires are complete —
// the two-stage feedback columns, and the behaviour taxonomy's `category`.
//
// Confirms the portal will boot BEFORE you deploy it, rather than finding out
// from a 500 afterwards. It runs the real loadClinicalData() — the same header
// asserts the live handlers use — so if this passes, the Monitor will load.
//
// Strictly read-only: it issues one values:batchGet and writes nothing. It never
// prints the service-account key.
//
//   node scripts/verify-followup-migration.mjs
//
// Credentials are taken from GOOGLE_SERVICE_ACCOUNT_EMAIL /
// GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY / GOOGLE_SHEETS_SPREADSHEET_ID if set,
// otherwise from the service-account JSON in local/ (gitignored).

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPREADSHEET_ID = "1Z0FKM3bVxM1wiDrli3wperdmZmj9b0nFDjecTbVmqzo";

// Columns the recent migrations add, per tab. Everything else is pre-existing and
// is still checked, because loadClinicalData asserts the full contract.
// `category` completes the behaviour triple (action_text × pillar × category) on
// the row that owns it, so one prescription can span pillars.
const ADDED = {
  nudges: ["followup_enabled", "followup_delay_hours", "category"],
  weekly_schedule: ["followup_enabled", "followup_delay_hours", "category"],
  schedule_state: [
    "parent_nudge_id", "delivered_at", "followup_enabled", "followup_delay_hours",
    "commitment_response", "commitment_responded_at",
    "followup_due_at", "followup_sent_at", "followup_wa_id",
    "outcome_response", "outcome_responded_at"
  ],
  // The append-only inbound reply log. /api/whatsapp-inbound asserts these, so a
  // missing column 500s every patient reply — and, worse, silently, because the
  // reply would be lost before anything recorded that it arrived.
  inbound_messages: [
    "inbound_id", "received_at", "from_phone", "to_phone", "wa_message_id", "context_wa_id",
    "body", "button_text", "button_payload", "opt_out_type",
    "user_id", "matched_nudge_id", "stage", "classification", "applied", "note", "raw_payload"
  ]
};

function loadCredentials() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    return "environment variables";
  }
  const dir = path.join(ROOT, "local");
  const candidate = fs.existsSync(dir)
    ? fs.readdirSync(dir).find(name => name.endsWith(".json") && !name.startsWith("client_secret_"))
    : null;
  if (!candidate) {
    console.error("No credentials found.\n" +
      "  Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,\n" +
      "  or place the service-account JSON in local/ (gitignored).");
    process.exit(2);
  }
  const key = JSON.parse(fs.readFileSync(path.join(dir, candidate), "utf8"));
  if (!key.client_email || !key.private_key) {
    console.error(`local/${candidate} is not a service-account key.`);
    process.exit(2);
  }
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = key.client_email;
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = key.private_key;
  return `local/${candidate}`;
}

const source = loadCredentials();
process.env.GOOGLE_SHEETS_SPREADSHEET_ID ||= SPREADSHEET_ID;

console.log("\n  Sheet migration check — two-stage feedback + behaviour taxonomy + reply log");
console.log("  ─────────────────────────────────────────────────────────────────────────");
console.log(`  spreadsheet   ${process.env.GOOGLE_SHEETS_SPREADSHEET_ID}`);
console.log(`  credentials   ${source}`);
console.log(`  service acct  ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL}`);
console.log("  mode          read-only (values:batchGet)\n");

const { readTabs } = require(path.join(ROOT, "landing/api/_lib/google-sheets.js"));
const { loadClinicalData } = require(path.join(ROOT, "landing/api/_lib/clinical-data.js"));

let failed = false;

// Per-tab detail first, so a missing column is named precisely.
let data;
try {
  data = await readTabs(Object.keys(ADDED));
} catch (error) {
  console.error(`  Could not read the spreadsheet: ${error.message}\n`);
  process.exit(2);
}

for (const [tab, columns] of Object.entries(ADDED)) {
  const headers = data[tab].headers;
  const missing = columns.filter(column => !headers.includes(column));
  const label = missing.length ? "MISSING" : "ok";
  console.log(`  ${tab.padEnd(16)} ${String(headers.length).padStart(2)} columns   ${label}`);
  for (const column of missing) {
    console.log(`      - ${column}`);
    failed = true;
  }
  // A near-miss is the likeliest mistake, so name it rather than just "missing".
  for (const column of missing) {
    const close = headers.find(header =>
      header.toLowerCase().replace(/[^a-z]/g, "") === column.toLowerCase().replace(/[^a-z]/g, ""));
    if (close) console.log(`        (found "${close}" — check spelling/case/whitespace)`);
  }
}

// Then the real thing: exactly what every handler runs on every request.
console.log("");
try {
  // Explicitly including inbound_messages: it is not in the default tab set,
  // because no read path needs it, so the default call would not check it.
  await loadClinicalData(["user", "questionnaire", "prescriptions", "nudges", "weekly_schedule", "schedule_state", "inbound_messages"]);
  console.log("  loadClinicalData()  PASSED — every header contract is satisfied.");
} catch (error) {
  console.log(`  loadClinicalData()  FAILED — ${error.message}`);
  failed = true;
}

if (failed) {
  console.log("\n  Migration incomplete. Add the columns above to the header row");
  console.log("  (blank values on existing rows) and re-run. Do not deploy yet.\n");
  process.exit(1);
}

console.log("\n  Migration complete. The portal will boot against this spreadsheet.");
console.log("  Nothing was written.\n");
