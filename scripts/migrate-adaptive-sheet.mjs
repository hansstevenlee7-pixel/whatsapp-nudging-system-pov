import { createRequire } from "node:module";

const require = createRequire(new URL("../landing/package.json", import.meta.url));
const { JWT } = require("google-auth-library");

const required = ["GOOGLE_SHEETS_SPREADSHEET_ID", "GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"];
for (const key of required) if (!process.env[key]) throw new Error(`${key} is required`);

const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const auth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});
const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`;
const headers = {
  nudges: ["media_asset_id", "adaptation_decision_id"],
  weekly_schedule: ["media_asset_id", "adaptation_decision_id"],
  schedule_state: ["read_at", "interacted_at", "last_inbound_message_sid"],
  media_assignments: ["assignment_id", "assigned_at", "user_id", "nudge_id", "behaviour_key", "media_asset_id", "adaptation_decision_id", "media_kind", "source_url", "tracked_url"],
  interaction_events: ["interaction_id", "event_at", "inbound_message_sid", "user_id", "from_phone", "reply_to_wa_message_id", "nudge_id", "body", "media_count", "correlation_method", "ack_status"],
  adaptation_decisions: ["decision_id", "decided_at", "user_id", "behaviour_key", "interaction_id", "signal_type", "rule_applied", "outcome", "reason", "selected_asset_id", "interpretation", "previous_state", "next_state"]
};

async function request(url, options = {}) {
  const authHeaders = await auth.getRequestHeaders();
  const normalized = typeof authHeaders.entries === "function" ? Object.fromEntries(authHeaders.entries()) : { ...authHeaders };
  const response = await fetch(url, { ...options, headers: { ...normalized, "content-type": "application/json", ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status}: ${body.error && body.error.message || "Google Sheets request failed"}`);
  return body;
}

const metadata = await request(`${base}?fields=sheets.properties(title)`);
const existingTabs = new Set((metadata.sheets || []).map(sheet => sheet.properties.title));
const missingTabs = Object.keys(headers).filter(name => !existingTabs.has(name) && !["nudges", "weekly_schedule", "schedule_state"].includes(name));
if (missingTabs.length) {
  await request(`${base}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: missingTabs.map(title => ({ addSheet: { properties: { title } } })) }) });
}

for (const [tab, additions] of Object.entries(headers)) {
  const sheetRange = `'${tab.replace(/'/g, "''")}'!1:1`;
  const range = encodeURIComponent(sheetRange);
  const current = await request(`${base}/values/${range}?majorDimension=ROWS`);
  const row = (current.values && current.values[0] || []).map(value => String(value).trim());
  const next = row.length ? row.concat(additions.filter(header => !row.includes(header))) : additions.slice();
  if (JSON.stringify(next) === JSON.stringify(row)) continue;
  await request(`${base}/values/${range}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ range: sheetRange, majorDimension: "ROWS", values: [next] }) });
  console.log(`Updated ${tab}: ${next.join(",")}`);
}
