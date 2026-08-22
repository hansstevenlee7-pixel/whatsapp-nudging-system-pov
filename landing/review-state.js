(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ReviewState = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  var DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

  function sourceToken(value) {
    return String(value || "").replace(/[^A-Za-z0-9_-]/g, "").slice(-48);
  }

  function weekday(value) {
    var date = new Date(String(value || "") + "T00:00:00Z");
    return Number.isNaN(date.getTime()) ? "" : DAYS[date.getUTCDay()];
  }

  function scheduleMatchesSource(row, source) {
    if (String(row.source_nudge_id || "") === String(source.nudge_id || "")) return true;
    var token = sourceToken(source.nudge_id);
    return !!token && String(row.nudge_id || "").startsWith("schd_" + token + "_");
  }

  function logicalSlotKey(row) {
    if (row.schedule_slot_id) return String(row.schedule_slot_id);
    var id = String(row.nudge_id || "").replace(/_\d{8}_(?:\d{4}_)?(\d+)$/, "_$1");
    return weekday(row.scheduled_date) + "|" + id;
  }

  function latestFirst(a, b) {
    var reviewed = String(b.reviewed_at || "").localeCompare(String(a.reviewed_at || ""));
    if (reviewed) return reviewed;
    return ((b.scheduled_date || "") + "T" + (b.scheduled_time || ""))
      .localeCompare((a.scheduled_date || "") + "T" + (a.scheduled_time || ""));
  }

  // Compatibility only: infer an initial schedule for patients that have not
  // yet been migrated to weekly_schedule. Never call this once canonical rows
  // exist, including inactive tombstones.
  function scheduleForSource(source, generated) {
    var seen = {};
    return (generated || [])
      .filter(function (row) {
        return ["approved", "sent"].includes(String(row.status || "")) && scheduleMatchesSource(row, source);
      })
      .sort(latestFirst)
      .filter(function (row) {
        var key = logicalSlotKey(row);
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      })
      .map(function (row) {
        return Object.assign({}, row, { source_nudge_id: source.nudge_id, status: "approved" });
      })
      .sort(function (a, b) {
        return ((a.scheduled_date || "") + "T" + (a.scheduled_time || ""))
          .localeCompare((b.scheduled_date || "") + "T" + (b.scheduled_time || ""));
      });
  }

  function activeWeeklySchedule(rows) {
    return (Array.isArray(rows) ? rows : [])
      .filter(function (row) { return String(row.status || "active") === "active"; })
      .slice()
      .sort(function (a, b) {
        return (DAYS.indexOf(a.day) - DAYS.indexOf(b.day)) ||
          String(a.scheduled_time || "").localeCompare(String(b.scheduled_time || "")) ||
          String(a.schedule_slot_id || "").localeCompare(String(b.schedule_slot_id || ""));
      });
  }

  // ---- Target behaviours (the clinician's action_text list) ----------------
  // The action is free text owned by the clinician, so it has no enum to key on.
  // Every comparison here goes through actionKey: the weekly slot editor stores
  // raw input and only the approve payload trims, so exact matching would
  // under-count usage and let the delete guard open on an in-use action.
  function actionKey(value) {
    return String(value == null ? "" : value).trim().toLowerCase();
  }

  function rowsForPrescription(rows, prescriptionId) {
    var id = String(prescriptionId == null ? "" : prescriptionId);
    return (Array.isArray(rows) ? rows : []).filter(function (row) {
      return row && String(row.prescription_id || "") === id;
    });
  }

  function actionsOf(rows) {
    return rows.map(function (row) { return String((row && row.action_text) || "").trim(); })
      .filter(function (value) { return value !== ""; });
  }

  // A target behaviour is the triple (action_text, pillar, category). The row that
  // carries it wins; the prescription supplies only a default, for a legacy row
  // written before this column existed. ONE definition, used by collectActions and
  // by the weekly editor's slotFromNudge, so the precedence cannot drift between
  // the trace card and the schedule — if it did, every reload would quietly
  // relabel each slot with its prescription's pillar and the next save would
  // persist that.
  function behaviourTaxonomy(row, prescription) {
    row = row || {};
    prescription = prescription || {};
    return {
      pillar: String(row.pillar || "").trim() || String(prescription.pillar || "").trim(),
      category: String(row.category || "").trim() || String(prescription.category || "").trim()
    };
  }

  // The list a clinician sees for one prescription. Sources are the LLM's intake
  // drafts; slots are the live weekly plan. Once a prescription has canonical
  // slots they win outright, so a renamed action cannot resurface as a stray
  // entry — but the fallback stays per prescription, otherwise "Clear all" or a
  // canonical tombstone would wipe the vocabulary with no way to recover it.
  //
  // Pass 1 below is the original algorithm over action *text*, unchanged: candidate
  // order, source precedence, first-seen casing, self-healing suppression. Pass 2
  // then resolves each surviving behaviour's taxonomy, each field falling through
  // independently: an unsaved override, then the first live slot, then the first
  // source row, then the prescription's default.
  function collectActions(input) {
    input = input || {};
    var prescriptionId = input.prescriptionId;
    var slotRows = rowsForPrescription(input.slots, prescriptionId);
    var sourceRows = rowsForPrescription(input.sources, prescriptionId);
    var slotActions = actionsOf(slotRows);
    var sourceActions = actionsOf(sourceRows);
    var added = (input.added || []).map(function (entry) {
      return typeof entry === "string" ? { action_text: entry } : (entry || {});
    });
    var ignoreSources = input.hasCanonicalSchedule === true && slotActions.length > 0;
    var candidates = (ignoreSources ? slotActions : sourceActions.concat(slotActions))
      .concat(added.map(function (entry) { return String(entry.action_text == null ? "" : entry.action_text).trim(); }))
      .filter(function (value) { return value !== ""; });

    var live = {};
    slotActions.forEach(function (value) { live[actionKey(value)] = true; });
    var removed = input.removed || {};
    var seen = {}, texts = [];
    candidates.forEach(function (value) {
      var key = actionKey(value);
      if (seen[key]) return;                     // first-seen casing wins
      if (removed[key] && !live[key]) return;    // suppression is self-healing
      seen[key] = true;
      texts.push(value);
    });

    var fallback = { pillar: String(input.pillar || "").trim(), category: String(input.category || "").trim() };
    var matching = function (rows, key) {
      return rows.filter(function (row) { return actionKey(row.action_text) === key; });
    };
    return texts.map(function (value) {
      var key = actionKey(value);
      var override = added.filter(function (entry) { return actionKey(entry.action_text) === key; }).pop() || {};
      var slotsWith = matching(slotRows, key);
      var sourcesWith = matching(sourceRows, key);
      var chain = [override].concat(slotsWith, sourcesWith, [fallback]);
      var pick = function (field) {
        for (var i = 0; i < chain.length; i += 1) {
          var candidate = String((chain[i] || {})[field] || "").trim();
          if (candidate) return candidate;
        }
        return "";
      };
      // Two rows under one behaviour disagreeing is recoverable but not silent:
      // whichever value wins is about to be written to all of them on save, so the
      // clinician is told rather than having one arbitrarily normalised behind them.
      var disagrees = function (field) {
        var values = slotsWith.concat(sourcesWith)
          .map(function (row) { return String(row[field] || "").trim(); })
          .filter(function (item) { return item !== ""; });
        return values.some(function (item) { return item !== values[0]; });
      };
      return {
        action_text: value, pillar: pick("pillar"), category: pick("category"),
        mixed: disagrees("pillar") || disagrees("category")
      };
    });
  }

  // The behaviour list is objects now; most consumers (a <select>, the duplicate
  // check in validateActionEdit) only ever wanted the wording.
  function actionTexts(behaviours) {
    return (Array.isArray(behaviours) ? behaviours : []).map(function (entry) {
      return typeof entry === "string" ? entry : String((entry && entry.action_text) || "");
    });
  }

  function findBehaviour(behaviours, action) {
    var key = actionKey(action);
    if (!key) return null;
    var found = (Array.isArray(behaviours) ? behaviours : []).filter(function (entry) {
      return actionKey(entry && entry.action_text) === key;
    });
    return found.length ? found[0] : null;
  }

  // Re-files a behaviour across every row that uses it. Same in-place contract and
  // same changed-count return as applyActionRename: a re-file that reaches no slot
  // is not savable, and marking the week dirty for it would let the clinician
  // "save" a change carried in no payload field and then read a success message.
  function applyActionTaxonomy(rows, prescriptionId, action, taxonomy) {
    var key = actionKey(action);
    if (!key) return 0;
    var next = taxonomy || {};
    var pillar = String(next.pillar == null ? "" : next.pillar).trim();
    var category = String(next.category == null ? "" : next.category).trim();
    if (!pillar && !category) return 0;
    var changed = 0;
    rowsForPrescription(rows, prescriptionId).forEach(function (row) {
      if (actionKey(row.action_text) !== key) return;
      var before = String(row.pillar || "") + "|" + String(row.category || "");
      if (pillar) row.pillar = pillar;
      if (category) row.category = category;
      if (before !== String(row.pillar || "") + "|" + String(row.category || "")) changed += 1;
    });
    return changed;
  }

  function countActionSlots(slots, prescriptionId, action) {
    var key = actionKey(action);
    if (!key) return 0;
    return rowsForPrescription(slots, prescriptionId).filter(function (row) {
      return actionKey(row.action_text) === key;
    }).length;
  }

  // Mutates matching rows in place and returns how many changed. In-place is
  // deliberate: renderWeek closures hold the slot objects and catalog()/
  // slotFromNudge() re-read state.selected.nudges, so returning copies would
  // force every caller to reassign and would strand those references.
  function applyActionRename(rows, prescriptionId, from, to) {
    var key = actionKey(from);
    var next = String(to == null ? "" : to).trim();
    if (!key || !next) return 0;
    var changed = 0;
    rowsForPrescription(rows, prescriptionId).forEach(function (row) {
      if (actionKey(row.action_text) !== key) return;
      row.action_text = next;
      changed += 1;
    });
    return changed;
  }

  // `current` is the row's own value, which must not count as a duplicate of
  // itself. Renaming onto another entry is rejected rather than merged.
  function validateActionEdit(input) {
    input = input || {};
    var value = String(input.value == null ? "" : input.value).trim();
    var max = input.max || 1024;
    if (!value) return { ok: false, value: value, error: "Describe the behaviour the patient should carry out." };
    if (value.length > max) return { ok: false, value: value, error: "Keep it to " + max + " characters or fewer." };
    var currentKey = actionKey(input.current);
    // actionTexts() so this accepts either the behaviour objects collectActions
    // returns or a plain list of wordings.
    var clash = actionTexts(input.actions).some(function (other) {
      return actionKey(other) !== currentKey && actionKey(other) === actionKey(value);
    });
    if (clash) return { ok: false, value: value, error: "That target behaviour already exists on this prescription." };
    return { ok: true, value: value, error: "" };
  }

  // ---- Outcome follow-up (client mirror of api/_lib/followup.js) ----------
  // The two-stage flow turns the initial nudge into a commitment question and
  // arms one delayed outcome check. The clinician owns both the switch and the
  // delay, so this validates them before a round trip; the server re-checks
  // identically and stays authoritative.
  var FOLLOWUP_MIN_HOURS = 1;
  var FOLLOWUP_MAX_HOURS = 72;
  var FOLLOWUP_PRESET_HOURS = [1, 2, 4, 8, 12, 24];
  // "Will you do this?" only makes sense for a nudge that asks the patient to act.
  var ACTIONABLE_NUDGE_TYPES = ["reminder", "challenge"];

  function isFollowupEnabled(value) {
    var clean = String(value == null ? "" : value).trim().toLowerCase();
    return clean === "true" || clean === "yes" || clean === "1" || clean === "on";
  }

  function isActionableNudgeType(value) {
    return ACTIONABLE_NUDGE_TYPES.indexOf(String(value == null ? "" : value).trim()) >= 0;
  }

  // Returns what should be sent on the wire plus a message the slot editor can
  // show inline. Delay is forced blank while the switch is off so a stale value
  // can never be mistaken for a live setting.
  function validateFollowup(input) {
    input = input || {};
    if (!isFollowupEnabled(input.enabled)) {
      return { ok: true, enabled: false, hours: "", error: "" };
    }
    if (!isActionableNudgeType(input.nudgeType)) {
      return { ok: false, enabled: true, hours: "",
        error: "An outcome follow-up only fits an actionable nudge (reminder or challenge)." };
    }
    var raw = String(input.hours == null ? "" : input.hours).trim();
    if (!raw) return { ok: false, enabled: true, hours: "", error: "Set how many hours later to ask." };
    if (!/^\d+$/.test(raw)) {
      return { ok: false, enabled: true, hours: raw, error: "Use a whole number of hours." };
    }
    var hours = Number(raw);
    if (hours < FOLLOWUP_MIN_HOURS || hours > FOLLOWUP_MAX_HOURS) {
      return { ok: false, enabled: true, hours: raw,
        error: "Choose between " + FOLLOWUP_MIN_HOURS + " and " + FOLLOWUP_MAX_HOURS + " hours." };
    }
    return { ok: true, enabled: true, hours: String(hours), error: "" };
  }

  // ---- Message options -----------------------------------------------------
  // Workflow A writes one `nudges` row per frequency_per_week, all sharing an
  // action and differing only in wording. The clinician should not be choosing
  // between five near-identical rows in a picker — they should add one nudge and
  // then flip between every wording the model produced. So the option list is a
  // *derived view* over the prescription's source rows, rebuilt whenever a slot
  // is created.
  //
  // Derived, never stored: only message_body and message_body_alt survive a save
  // to weekly_schedule, so on reload the list is regenerated from the source rows
  // and the saved body is matched back into it. That matching is the whole
  // contract — see the currentText rules below.
  var MESSAGE_TONES = ["encouraging", "neutral_informational"];

  function messageTextKey(value) {
    return String(value == null ? "" : value).trim().toLowerCase().replace(/\s+/g, " ");
  }

  function oppositeTone(tone) {
    return tone === "encouraging" ? "neutral_informational" : "encouraging";
  }

  function knownTone(value, fallback) {
    var clean = String(value == null ? "" : value).trim();
    if (MESSAGE_TONES.indexOf(clean) >= 0) return clean;
    return MESSAGE_TONES.indexOf(fallback) >= 0 ? fallback : "encouraging";
  }

  function buildMessageOptions(input) {
    input = input || {};
    var prescriptionId = String(input.prescriptionId == null ? "" : input.prescriptionId);
    var rows = (Array.isArray(input.sources) ? input.sources : []).filter(function (row) {
      return row && String(row.prescription_id || "") === prescriptionId;
    });

    // Scoped to the slot's own behaviour when that matches something, otherwise
    // the whole prescription. The fallback is load-bearing: renaming a slot's
    // action does not rename the source rows, and legacy rows carry no
    // action_text at all — without it a rename would empty the list mid-edit.
    var key = actionKey(input.actionText);
    var scoped = key ? rows.filter(function (row) { return actionKey(row.action_text) === key; }) : [];
    if (!scoped.length) scoped = rows;

    var seen = {}, options = [];
    var push = function (tone, text, alt, generated) {
      var clean = String(text == null ? "" : text).trim();
      var textKey = messageTextKey(clean);
      if (!clean || seen[textKey]) return;   // first occurrence keeps its tone and alt
      seen[textKey] = true;
      options.push({
        tone: tone, text: clean, origin: clean,
        alt: String(alt == null ? "" : alt).trim(),
        label: tone, generated: generated
      });
    };

    // Grouped, not interleaved: Options 1..N are "the N messages the model wrote
    // for this behaviour", which is how a 3x/week prescription is actually
    // produced. Their opposite-tone rewrites follow.
    scoped.forEach(function (row) { push(knownTone(row.tone_variant), row.message_body, row.message_body_alt, true); });
    scoped.forEach(function (row) { push(oppositeTone(knownTone(row.tone_variant)), row.message_body_alt, row.message_body, true); });

    var generatedCount = options.length;
    // Always last, always present. It carries a real tone rather than the literal
    // "custom": schedule-store maps custom -> neutral_informational on save, so a
    // placeholder tone would silently flip an encouraging message after a reload.
    var custom = {
      tone: knownTone(input.customTone), text: "", origin: "",
      alt: "", label: "doctor custom", generated: false
    };
    options.push(custom);

    var currentKey = messageTextKey(input.currentText);
    var selected;
    if (currentKey) {
      var match = -1;
      for (var i = 0; i < generatedCount; i++) {
        if (messageTextKey(options[i].text) === currentKey) { match = i; break; }
      }
      if (match >= 0) {
        selected = match;
      } else {
        // The saved body is not one the model wrote, so the clinician edited it.
        // It becomes the custom option, pre-filled and selected — this is what
        // makes a doctor's wording survive save -> reload -> edit.
        custom.text = custom.origin = String(input.currentText).trim();
        selected = generatedCount;
      }
    } else if (!generatedCount) {
      selected = 0;
    } else {
      // A fresh slot rotates through the wordings so one week does not read as
      // the same sentence seven times.
      var preferred = knownTone(input.preferredTone, "");
      var pool = [];
      for (var j = 0; j < generatedCount; j++) if (options[j].tone === preferred) pool.push(j);
      if (!pool.length) for (var k = 0; k < generatedCount; k++) pool.push(k);
      var ordinal = Number(input.ordinal);
      if (!Number.isFinite(ordinal) || ordinal < 0) ordinal = 0;
      selected = pool[Math.floor(ordinal) % pool.length];
    }

    return { options: options, selected: selected, generatedCount: generatedCount };
  }

  // The opposite-tone counterpart of the body being sent, or "" when there isn't
  // one. `origin` is what makes this self-invalidating: once the doctor edits a
  // generated option in place, the recorded alt is no longer the counterpart of
  // anything, so sending it would be a lie.
  function altForOption(option) {
    if (!option || option.generated !== true) return "";
    return messageTextKey(option.text) === messageTextKey(option.origin) ? String(option.alt || "") : "";
  }

  // ---- Prescription drafts (client mirror of prescription-store) ----------
  // The server is authoritative; this exists so the dialog can show per-field
  // errors before a round trip, and so the pillar lock can also account for
  // unsaved slots the server cannot see.
  function prescriptionDraftText(value) {
    return String(value == null ? "" : value).trim();
  }

  function wholeNumberInRange(value, min, max) {
    var number = Number(prescriptionDraftText(value));
    return Number.isInteger(number) && number >= min && number <= max;
  }

  function validatePrescriptionDraft(input) {
    input = input || {};
    var creating = input.creating === true;
    var pillars = input.pillars || [];
    var categories = input.categories || [];
    var nudgeTypes = input.nudgeTypes || [];
    var tones = input.tones || [];
    var actionMax = input.actionMax || 1024;
    var value = {
      pillar: prescriptionDraftText(input.pillar),
      category: prescriptionDraftText(input.category),
      frequency_per_week: prescriptionDraftText(input.frequency_per_week),
      duration_weeks: prescriptionDraftText(input.duration_weeks),
      issued_date: prescriptionDraftText(input.issued_date),
      prescription_raw_text: prescriptionDraftText(input.prescription_raw_text)
    };
    var errors = {};
    if (pillars.indexOf(value.pillar) < 0) errors.pillar = "Choose a pillar.";
    if (categories.indexOf(value.category) < 0) errors.category = "Choose a behaviour category.";
    if (!wholeNumberInRange(value.frequency_per_week, 1, 7)) errors.frequency_per_week = "Enter 1 to 7 times per week.";
    if (!wholeNumberInRange(value.duration_weeks, 1, 52)) errors.duration_weeks = "Enter 1 to 52 weeks.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value.issued_date)) errors.issued_date = "Enter the date it was issued.";
    else if (input.today && value.issued_date > input.today) errors.issued_date = "The issue date cannot be in the future.";
    if (!value.prescription_raw_text) errors.prescription_raw_text = "Enter the doctor's own words.";
    else if (value.prescription_raw_text.length > 4000) errors.prescription_raw_text = "Keep it to 4000 characters or fewer.";

    if (creating) {
      value.action_text = prescriptionDraftText(input.action_text);
      value.nudge_type = prescriptionDraftText(input.nudge_type);
      value.tone_variant = prescriptionDraftText(input.tone_variant);
      value.message_body = prescriptionDraftText(input.message_body);
      if (!value.action_text) errors.action_text = "Describe the first target behaviour.";
      else if (value.action_text.length > actionMax) errors.action_text = "Keep it to " + actionMax + " characters or fewer.";
      if (nudgeTypes.indexOf(value.nudge_type) < 0) errors.nudge_type = "Choose a nudge type.";
      if (tones.indexOf(value.tone_variant) < 0) errors.tone_variant = "Choose a tone.";
      if (!value.message_body) errors.message_body = "Write the first message.";
      else if (value.message_body.length > 1024) errors.message_body = "Keep it to 1024 characters or fewer.";
    }
    return { ok: Object.keys(errors).length === 0, value: value, errors: errors };
  }

  function hydratePatient(patient) {
    var copy = Object.assign({}, patient);
    var sources = Array.isArray(patient.nudges) ? patient.nudges : [];
    var generated = Array.isArray(patient.schedule_nudges) ? patient.schedule_nudges : [];
    var weekly = Array.isArray(patient.weekly_schedule) ? patient.weekly_schedule : [];
    var hasCanonicalSchedule = patient.has_canonical_schedule === true || weekly.length > 0;
    var active = activeWeeklySchedule(weekly);
    var matchedRows = [];

    // Keep intake/source nudges intact for review status, traceability, and the
    // add picker. The editor reads weekly_schedule separately.
    if (!hasCanonicalSchedule) {
      sources.forEach(function (source) {
        if (String(source.status || "") !== "approved") return;
        var saved = scheduleForSource(source, generated);
        matchedRows = matchedRows.concat(saved);
      });
    }

    var dateRows = hasCanonicalSchedule ? active : matchedRows;
    var starts = dateRows.map(function (row) { return String(row.start_date || row.scheduled_date || ""); })
      .filter(function (value) { return /^\d{4}-\d{2}-\d{2}$/.test(value); }).sort();
    var ends = dateRows.map(function (row) { return String(row.end_date || row.scheduled_date || ""); })
      .filter(function (value) { return /^\d{4}-\d{2}-\d{2}$/.test(value); }).sort();

    copy.nudges = sources;
    copy.schedule_nudges = generated;
    copy.weekly_schedule = active;
    copy.has_canonical_schedule = hasCanonicalSchedule;
    copy.legacy_schedule = hasCanonicalSchedule ? [] : matchedRows;
    copy.schedule_start_date = starts[0] || "";
    copy.schedule_end_date = ends[ends.length - 1] || "";
    return copy;
  }

  return {
    sourceToken: sourceToken,
    logicalSlotKey: logicalSlotKey,
    scheduleForSource: scheduleForSource,
    activeWeeklySchedule: activeWeeklySchedule,
    hydratePatient: hydratePatient,
    actionKey: actionKey,
    behaviourTaxonomy: behaviourTaxonomy,
    collectActions: collectActions,
    actionTexts: actionTexts,
    findBehaviour: findBehaviour,
    applyActionTaxonomy: applyActionTaxonomy,
    countActionSlots: countActionSlots,
    applyActionRename: applyActionRename,
    validateActionEdit: validateActionEdit,
    validatePrescriptionDraft: validatePrescriptionDraft,
    FOLLOWUP_MIN_HOURS: FOLLOWUP_MIN_HOURS,
    FOLLOWUP_MAX_HOURS: FOLLOWUP_MAX_HOURS,
    FOLLOWUP_PRESET_HOURS: FOLLOWUP_PRESET_HOURS,
    ACTIONABLE_NUDGE_TYPES: ACTIONABLE_NUDGE_TYPES,
    isFollowupEnabled: isFollowupEnabled,
    isActionableNudgeType: isActionableNudgeType,
    validateFollowup: validateFollowup,
    MESSAGE_TONES: MESSAGE_TONES,
    messageTextKey: messageTextKey,
    oppositeTone: oppositeTone,
    buildMessageOptions: buildMessageOptions,
    altForOption: altForOption
  };
});
