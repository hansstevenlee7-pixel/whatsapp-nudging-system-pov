"use strict";

const { behaviourKey } = require("./adaptive-core");
const adaptiveStore = require("./adaptive-store");

function scheduleShape(rows) {
  const grouped = new Map();
  for (const row of rows || []) {
    let key; try { key = behaviourKey(row); } catch (_) { continue; }
    const item = grouped.get(key) || { count: 0, modes: new Set() };
    item.count += 1;
    item.modes.add(String(row.media_selection_mode || "automatic"));
    grouped.set(key, item);
  }
  return grouped;
}

async function recordClinicianChanges(userId, before, after) {
  if (!adaptiveStore.configured()) return [];
  const previous = scheduleShape(before); const next = scheduleShape(after); const saved = [];
  const keys = new Set([...previous.keys(), ...next.keys()]);
  for (const key of keys) {
    const beforeValue = previous.get(key) || { count: 0, modes: new Set() };
    const afterValue = next.get(key) || { count: 0, modes: new Set() };
    const beforeMode = Array.from(beforeValue.modes).sort().join(",") || "automatic";
    const afterMode = Array.from(afterValue.modes).sort().join(",") || "automatic";
    if (beforeValue.count === afterValue.count && beforeMode === afterMode) continue;
    saved.push(await adaptiveStore.optional("recordClinicianDecision", { user_id: userId, behaviour_key: key,
      previous_state: { planned_frequency: beforeValue.count, media_selection_mode: beforeMode },
      next_state: { planned_frequency: afterValue.count, media_selection_mode: afterMode },
      changed_fields: ["planned_frequency", "media_selection_mode"], reason: "Clinician saved a weekly schedule or media change" }));
  }
  return saved;
}

module.exports = { scheduleShape, recordClinicianChanges };
