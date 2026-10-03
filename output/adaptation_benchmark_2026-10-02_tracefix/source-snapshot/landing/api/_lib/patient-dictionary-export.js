"use strict";

const { ensureTabs, readTabs, batchWrite, operation } = require("./google-sheets");
const { stateExportRows, timelineExportRows } = require("./patient-dictionary");

const HEADERS = {
  patient_adaptation_state: ["user_id", "scope", "behaviour_key", "state_version", "preferred_format", "preferred_frequency", "planned_frequency", "delivered_frequency", "observed_frequency", "last_change_at", "updated_at"],
  patient_adaptation_timeline: ["user_id", "event_id", "event_at", "event_type", "source", "scope", "behaviour_key", "signal", "rule_applied", "outcome", "reason", "previous_state", "new_state", "changed_fields", "selected_asset_id", "selected_media_kind", "nudge_id", "interaction_id"]
};

function clean(value) { return String(value == null ? "" : value).trim(); }

async function exportPatientDictionary(dictionary) {
  await ensureTabs(Object.keys(HEADERS), HEADERS);
  const tables = await readTabs(Object.keys(HEADERS));
  const operations = [];
  const currentRows = stateExportRows(dictionary);
  const current = tables.patient_adaptation_state;
  const stateIndex = new Map(current.rows.map(row => [`${clean(row.user_id)}|${clean(row.scope)}|${clean(row.behaviour_key)}`, row]));
  for (const row of currentRows) {
    const key = `${clean(row.user_id)}|${clean(row.scope)}|${clean(row.behaviour_key)}`;
    operations.push(operation("patient_adaptation_state", current, row, stateIndex.get(key) || null));
  }
  const timeline = tables.patient_adaptation_timeline;
  const existingEvents = new Set(timeline.rows.map(row => clean(row.event_id)).filter(Boolean));
  for (const row of timelineExportRows(dictionary)) {
    if (!row.event_id || existingEvents.has(row.event_id)) continue;
    existingEvents.add(row.event_id);
    operations.push(operation("patient_adaptation_timeline", timeline, row));
  }
  await batchWrite(operations);
  return { state_rows: currentRows.length, timeline_rows: operations.filter(item => item.tab === "patient_adaptation_timeline").length };
}

module.exports = { HEADERS, exportPatientDictionary };
