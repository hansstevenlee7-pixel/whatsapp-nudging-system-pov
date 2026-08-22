// Read-only live view of the two-stage feedback flow.
//
// Shows, for every schedule_state row, exactly where it sits in the state
// machine and flags anything the code says should be impossible — so a Sandbox
// run can be verified against the contract rather than eyeballed.
//
// Strictly read-only: values:batchGet only, never writes.
//
//   node scripts/watch-followup-state.mjs              # one snapshot
//   node scripts/watch-followup-state.mjs --watch      # poll every 20s
//   node scripts/watch-followup-state.mjs --all        # include untouched rows

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const WATCH = argv.includes("--watch");
const ALL = argv.includes("--all");

if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
  const dir = path.join(ROOT, "local");
  const file = fs.readdirSync(dir).find(n => n.endsWith(".json") && !n.startsWith("client_secret_"));
  if (!file) { console.error("No service-account key in local/."); process.exit(2); }
  const key = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = key.client_email;
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = key.private_key;
}
process.env.GOOGLE_SHEETS_SPREADSHEET_ID ||= "1Z0FKM3bVxM1wiDrli3wperdmZmj9b0nFDjecTbVmqzo";

const { readTabs } = require(path.join(ROOT, "landing/api/_lib/google-sheets.js"));

const t = v => String(v == null ? "" : v).trim();
const hhmm = v => { const ms = Date.parse(t(v)); return Number.isFinite(ms)
  ? new Intl.DateTimeFormat("en-GB", { timeZone: "Australia/Melbourne", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms) : "—"; };

// What the row *should* be doing next, derived the same way the workflows derive it.
function expectation(row, nowMs) {
  const status = t(row.status);
  const due = Date.parse(t(row.followup_due_at));
  if (status === "awaiting_commitment") {
    return Number.isFinite(due) && due <= nowMs
      ? "OVERDUE → next Workflow F tick writes commitment_response=NO_FEEDBACK"
      : "waiting for the patient to tap Yes / No";
  }
  if (status === "awaiting_followup") {
    if (t(row.followup_sent_at)) return "outcome check sent — waiting for Done / Not yet";
    return Number.isFinite(due) && due <= nowMs
      ? "DUE NOW → next Workflow F tick sends the outcome check"
      : `armed — outcome check due ${hhmm(row.followup_due_at)}`;
  }
  if (status === "declined") return "declined — no check will ever be sent";
  if (status === "no_feedback") return "window closed unanswered";
  if (status === "opted_out") return "cancelled by STOP";
  if (status === "done" || status === "not_yet") return "resolved";
  if (status === "sent") return "single-stage — waiting for Done / In progress / Not yet";
  return status || "(blank)";
}

// Invariants the implementation guarantees. Any hit here is a real bug, not noise.
function violations(row) {
  const out = [];
  const status = t(row.status);
  if (t(row.commitment_response) === "NOT_YET") out.push("commitment_response=NOT_YET is not a legal value");
  if (t(row.outcome_response) && !["DONE", "NOT_YET", "NO_FEEDBACK"].includes(t(row.outcome_response))) out.push(`outcome_response=${t(row.outcome_response)} is not legal`);
  if (t(row.commitment_response) && !["YES", "NO", "NO_FEEDBACK"].includes(t(row.commitment_response))) out.push(`commitment_response=${t(row.commitment_response)} is not legal`);
  if (status === "declined" && t(row.followup_due_at)) out.push("declined row still has followup_due_at — a check could be sent");
  if (status === "opted_out" && t(row.followup_due_at)) out.push("opted-out row still has followup_due_at");
  if (t(row.followup_sent_at) && !t(row.followup_wa_id)) out.push("followup_sent_at set without followup_wa_id — replies cannot correlate");
  if (t(row.outcome_response) && !t(row.followup_sent_at) && t(row.outcome_response) !== "NO_FEEDBACK") out.push("outcome recorded but no check was ever sent");
  if (t(row.commitment_response) === "NO" && t(row.followup_sent_at)) out.push("check was sent despite a declined commitment");
  return out;
}

async function snapshot() {
  const data = await readTabs(["schedule_state", "user"]);
  const users = new Map(data.user.rows.map(r => [String(r.user_id), r]));
  const nowMs = Date.now();
  const rows = data.schedule_state.rows.filter(r => t(r.nudge_id));
  const touched = rows.filter(r => ALL || t(r.followup_enabled) === "TRUE" || t(r.commitment_response) || t(r.outcome_response) ||
    ["awaiting_commitment", "awaiting_followup", "declined", "no_feedback", "opted_out"].includes(t(r.status)));

  console.clear?.();
  console.log(`\n  Two-stage feedback — live state   ${new Intl.DateTimeFormat("en-GB", { timeZone: "Australia/Melbourne", dateStyle: "medium", timeStyle: "medium" }).format(nowMs)} Melbourne`);
  console.log(`  ${rows.length} schedule_state rows, ${touched.length} in or past the two-stage flow` + (ALL ? " (--all)" : "") + "\n");

  if (!touched.length) {
    console.log("  Nothing yet. Approve a nudge with the follow-up on, then wait for Workflow B's next 5-minute tick.\n");
    return;
  }

  let bad = 0;
  for (const row of touched) {
    const user = users.get(String(row.user_id));
    console.log(`  ${String(row.nudge_id).slice(-30)}`);
    console.log(`    patient    ${user ? user.name : row.user_id}  [${user ? t(user.user_status) : "?"}]`);
    console.log(`    status     ${t(row.status) || "(blank)"}` + (t(row.followup_enabled) === "TRUE" ? `   follow-up ${t(row.followup_delay_hours)}h` : "   (single-stage)"));
    console.log(`    stage 1    commitment=${t(row.commitment_response) || "—"}   at ${hhmm(row.commitment_responded_at)}`);
    console.log(`    stage 2    outcome=${t(row.outcome_response) || "—"}   at ${hhmm(row.outcome_responded_at)}`);
    console.log(`    timing     sent ${hhmm(row.sent_at)}   due ${hhmm(row.followup_due_at)}   check sent ${hhmm(row.followup_sent_at)}`);
    console.log(`    sids       out=${t(row.wa_message_id).slice(0, 12) || "—"}  followup=${t(row.followup_wa_id).slice(0, 12) || "—"}  lastIn=${t(row.response_wa_id).slice(0, 12) || "—"}`);
    if (t(row.barrier_tag)) console.log(`    barrier    ${t(row.barrier_tag)}`);
    console.log(`    → ${expectation(row, nowMs)}`);
    const problems = violations(row);
    for (const p of problems) { console.log(`    !! ${p}`); bad++; }
    console.log("");
  }
  console.log(bad ? `  ${bad} contract violation(s) above — these should be impossible.\n` : "  No contract violations.\n");
}

await snapshot();
if (WATCH) {
  console.log("  Polling every 20s. Ctrl-C to stop.\n");
  setInterval(() => snapshot().catch(e => console.error("  read failed:", e.message)), 20000);
}
