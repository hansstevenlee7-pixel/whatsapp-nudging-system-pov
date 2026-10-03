"use strict";

// The clinician-curated target-behaviour list behind the Monitor trace card.
// A behaviour is the triple (action_text, pillar, category): the action is free
// text the doctor owns, and pillar/category are locked enums that belong to the
// behaviour rather than to its prescription. These functions carry the whole
// identity, scoping and taxonomy-precedence contract.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  actionKey, behaviourTaxonomy, collectActions, actionTexts, findBehaviour,
  applyActionTaxonomy, countActionSlots, applyActionRename, validateActionEdit
} = require("../review-state");

const source = (prescription_id, action_text, tax) => Object.assign({ prescription_id, action_text }, tax || {});
const slot = (prescription_id, action_text, tax) => Object.assign({ prescription_id, action_text }, tax || {});
// collectActions returns behaviour objects; the ordering, dedupe and suppression
// contract below is about the wording alone, so it unwraps first.
const texts = out => actionTexts(out);

// ---- actionKey ------------------------------------------------------------

test("actionKey trims and lowercases so spacing and casing never split one behaviour", () => {
  assert.equal(actionKey("  Be in Bed by 10pm "), "be in bed by 10pm");
  assert.equal(actionKey("BE IN BED BY 10PM"), actionKey("be in bed by 10pm"));
  assert.equal(actionKey(null), "");
  assert.equal(actionKey(undefined), "");
  assert.equal(actionKey(""), "");
});

// ---- collectActions -------------------------------------------------------

test("an unapproved prescription unions its intake drafts with the live week", () => {
  const actions = collectActions({
    prescriptionId: "rx-1",
    sources: [source("rx-1", "Be in bed by 10pm")],
    slots: [slot("rx-1", "Dim the lights at 9:30pm")],
    added: [],
    removed: {},
    hasCanonicalSchedule: false
  });
  assert.deepEqual(texts(actions), ["Be in bed by 10pm", "Dim the lights at 9:30pm"]);
});

test("duplicates collapse case-insensitively and the first-seen casing wins", () => {
  const actions = collectActions({
    prescriptionId: "rx-1",
    sources: [source("rx-1", "Be in bed by 10pm")],
    slots: [slot("rx-1", "  BE IN BED BY 10PM  "), slot("rx-1", "")],
    added: ["be in bed by 10pm"],
    removed: {},
    hasCanonicalSchedule: false
  });
  assert.deepEqual(texts(actions), ["Be in bed by 10pm"]);
});

test("once a prescription has canonical slots the stale intake draft is ignored", () => {
  // The rename rewrote the slot but the source row keeps its old text, because
  // the server only backfills a blank source action_text.
  const actions = collectActions({
    prescriptionId: "rx-1",
    sources: [source("rx-1", "Be in bed by 10pm")],
    slots: [slot("rx-1", "Be in bed by 10:30pm")],
    added: [],
    removed: {},
    hasCanonicalSchedule: true
  });
  assert.deepEqual(texts(actions), ["Be in bed by 10:30pm"]);
});

test("a canonical patient with no slots for this prescription falls back to its drafts", () => {
  // Guards "Clear all" and the canonical-tombstone patient: without the
  // per-prescription fallback the vocabulary empties with no way back.
  const base = {
    prescriptionId: "rx-1",
    sources: [source("rx-1", "Be in bed by 10pm")],
    added: [],
    removed: {},
    hasCanonicalSchedule: true
  };
  assert.deepEqual(texts(collectActions(Object.assign({}, base, { slots: [] }))), ["Be in bed by 10pm"]);
  assert.deepEqual(
    texts(collectActions(Object.assign({}, base, { slots: [slot("rx-2", "Eat a side salad")] }))),
    ["Be in bed by 10pm"]
  );
});

test("a removed action is suppressed only while no live slot still uses it", () => {
  const removed = { "be in bed by 10pm": 1 };
  assert.deepEqual(
    texts(collectActions({
      prescriptionId: "rx-1", sources: [source("rx-1", "Be in bed by 10pm")],
      slots: [], added: [], removed, hasCanonicalSchedule: false
    })),
    []
  );
  // "Reset from saved schedule" restores a slot that uses it — it must reappear,
  // or the trace would hide an action the schedule is actively sending.
  assert.deepEqual(
    texts(collectActions({
      prescriptionId: "rx-1", sources: [source("rx-1", "Be in bed by 10pm")],
      slots: [slot("rx-1", "Be in bed by 10pm")], added: [], removed, hasCanonicalSchedule: false
    })),
    ["Be in bed by 10pm"]
  );
});

test("two prescriptions sharing identical action text keep independent lists", () => {
  const sources = [source("rx-1", "Walk for 20 minutes"), source("rx-2", "Walk for 20 minutes")];
  const slots = [slot("rx-2", "Take the stairs at work")];
  assert.deepEqual(
    texts(collectActions({ prescriptionId: "rx-1", sources, slots, added: [], removed: {}, hasCanonicalSchedule: false })),
    ["Walk for 20 minutes"]
  );
  assert.deepEqual(
    texts(collectActions({ prescriptionId: "rx-2", sources, slots, added: [], removed: {}, hasCanonicalSchedule: false })),
    ["Walk for 20 minutes", "Take the stairs at work"]
  );
});

// ---- countActionSlots -----------------------------------------------------

test("usage counts are scoped to one prescription and tolerate untrimmed slot text", () => {
  const slots = [
    slot("rx-1", "Be in bed by 10pm"),
    slot("rx-1", "  be in bed by 10PM  "),
    slot("rx-2", "Be in bed by 10pm"),
    slot("rx-1", "Dim the lights at 9:30pm")
  ];
  assert.equal(countActionSlots(slots, "rx-1", "Be in bed by 10pm"), 2);
  assert.equal(countActionSlots(slots, "rx-2", "Be in bed by 10pm"), 1);
  assert.equal(countActionSlots(slots, "rx-1", "Never scheduled"), 0);
  assert.equal(countActionSlots(slots, "rx-1", ""), 0);
});

// ---- applyActionRename ----------------------------------------------------

test("a rename rewrites only same-prescription matches and normalises their spelling", () => {
  const rows = [
    slot("rx-1", "Be in bed by 10pm"),
    slot("rx-1", "  be in bed by 10PM  "),
    slot("rx-2", "Be in bed by 10pm"),
    slot("rx-1", "Dim the lights at 9:30pm")
  ];
  const changed = applyActionRename(rows, "rx-1", "Be in bed by 10pm", "Be in bed by 10:30pm");
  assert.equal(changed, 2);
  assert.deepEqual(rows.map(row => row.action_text), [
    "Be in bed by 10:30pm",
    "Be in bed by 10:30pm",
    "Be in bed by 10pm",          // rx-2 untouched
    "Dim the lights at 9:30pm"
  ]);
});

test("a rename that matches nothing reports zero so the save gate stays clean", () => {
  // refreshValidity() gates Approve on scheduleDirty; marking dirty for a rename
  // that reaches no slot would let the clinician "save" a change that is in no
  // payload field and then read a success message.
  const rows = [slot("rx-1", "Be in bed by 10pm")];
  assert.equal(applyActionRename(rows, "rx-1", "Not scheduled anywhere", "Something else"), 0);
  assert.equal(applyActionRename(rows, "rx-2", "Be in bed by 10pm", "Something else"), 0);
  assert.equal(applyActionRename(rows, "rx-1", "Be in bed by 10pm", "   "), 0);
  assert.deepEqual(rows.map(row => row.action_text), ["Be in bed by 10pm"]);
});

// ---- validateActionEdit ---------------------------------------------------

test("action edits reject blanks, overlong text and duplicates but allow a no-op", () => {
  const actions = ["Be in bed by 10pm", "Dim the lights at 9:30pm"];

  assert.equal(validateActionEdit({ value: "   ", current: "Be in bed by 10pm", actions, max: 1024 }).ok, false);
  assert.equal(validateActionEdit({ value: "x".repeat(1025), current: "", actions, max: 1024 }).ok, false);

  const clash = validateActionEdit({ value: "  dim the lights AT 9:30pm ", current: "Be in bed by 10pm", actions, max: 1024 });
  assert.equal(clash.ok, false);
  assert.match(clash.error, /already exists/);

  // Committing a row unchanged is not a duplicate of itself.
  assert.equal(validateActionEdit({ value: "Be in bed by 10pm", current: "Be in bed by 10pm", actions, max: 1024 }).ok, true);

  const ok = validateActionEdit({ value: "  Be in bed by 10:30pm  ", current: "Be in bed by 10pm", actions, max: 1024 });
  assert.deepEqual([ok.ok, ok.value], [true, "Be in bed by 10:30pm"]);
});

// ---- Prescription drafts (client mirror) ----------------------------------

const { validatePrescriptionDraft } = require("../review-state");

const TAX = {
  pillars: ["sleep", "physical_activity", "nutrition"],
  categories: ["increase", "establish", "maintain"],
  nudgeTypes: ["reminder", "reflection"],
  tones: ["encouraging", "neutral_informational"]
};

const editDraft = (over = {}) => Object.assign({
  pillar: "sleep", category: "establish", frequency_per_week: "3", duration_weeks: "8",
  issued_date: "2026-07-01", prescription_raw_text: "Sleep earlier", today: "2026-08-03"
}, TAX, over);

test("a prescription edit draft accepts valid fields and trims them", () => {
  const result = validatePrescriptionDraft(editDraft({ prescription_raw_text: "  Sleep earlier  " }));
  assert.equal(result.ok, true);
  assert.equal(result.value.prescription_raw_text, "Sleep earlier");
  assert.deepEqual(result.errors, {});
});

test("a prescription edit draft reports one error per bad field", () => {
  const result = validatePrescriptionDraft(editDraft({
    pillar: "vibes", category: "", frequency_per_week: "9", duration_weeks: "0", prescription_raw_text: "  "
  }));
  assert.equal(result.ok, false);
  assert.deepEqual(Object.keys(result.errors).sort(),
    ["category", "duration_weeks", "frequency_per_week", "pillar", "prescription_raw_text"]);
});

test("a prescription cannot be dated in the future", () => {
  assert.equal(validatePrescriptionDraft(editDraft({ issued_date: "2026-08-04" })).errors.issued_date,
    "The issue date cannot be in the future.");
  assert.equal(validatePrescriptionDraft(editDraft({ issued_date: "2026-08-03" })).ok, true);
});

test("creating additionally requires the first behaviour and its message", () => {
  const missing = validatePrescriptionDraft(editDraft({ creating: true }));
  assert.equal(missing.ok, false);
  assert.deepEqual(Object.keys(missing.errors).sort(), ["action_text", "message_body", "nudge_type", "tone_variant"]);

  const complete = validatePrescriptionDraft(editDraft({
    creating: true, action_text: "Be in bed by 10pm", nudge_type: "reminder",
    tone_variant: "encouraging", message_body: "Time to wind down."
  }));
  assert.equal(complete.ok, true);
  assert.equal(complete.value.action_text, "Be in bed by 10pm");
});

// ---- behaviourTaxonomy ----------------------------------------------------

test("a row's own taxonomy beats its prescription's, which is only a default", () => {
  const rx = { pillar: "physical_activity", category: "increase" };
  // The inversion guard. If the prescription won here, every reload would relabel
  // each slot with its prescription's pillar and the next save would persist it,
  // silently collapsing a multi-pillar prescription back to one.
  assert.deepEqual(behaviourTaxonomy({ pillar: "nutrition", category: "reduce" }, rx),
    { pillar: "nutrition", category: "reduce" });
  // A legacy row predating the category column inherits it and keeps its pillar.
  assert.deepEqual(behaviourTaxonomy({ pillar: "sleep", category: "" }, rx),
    { pillar: "sleep", category: "increase" });
  assert.deepEqual(behaviourTaxonomy({}, rx), { pillar: "physical_activity", category: "increase" });
  assert.deepEqual(behaviourTaxonomy({}, {}), { pillar: "", category: "" });
});

// ---- collectActions: taxonomy resolution ----------------------------------

test("each behaviour resolves its taxonomy through the whole fallback chain", () => {
  const out = collectActions({
    prescriptionId: "rx-1",
    sources: [
      source("rx-1", "Walk for 20 minutes", { pillar: "physical_activity", category: "increase" }),
      source("rx-1", "Eat a side salad", { pillar: "nutrition" }),
      source("rx-1", "Be in bed by 10pm")
    ],
    slots: [slot("rx-1", "Walk for 20 minutes", { pillar: "social_connection", category: "establish" })],
    added: [], removed: {}, hasCanonicalSchedule: false,
    pillar: "sleep", category: "maintain"
  });
  // A live slot outranks the source row it was built from — and because the two
  // genuinely disagree, that is also reported rather than quietly resolved.
  assert.deepEqual(out[0], { action_text: "Walk for 20 minutes", pillar: "social_connection", category: "establish", mixed: true });
  // ...the source row outranks the prescription, per field independently...
  assert.deepEqual(out[1], { action_text: "Eat a side salad", pillar: "nutrition", category: "maintain", mixed: false });
  // ...and a row with neither falls all the way through to the defaults.
  assert.deepEqual(out[2], { action_text: "Be in bed by 10pm", pillar: "sleep", category: "maintain", mixed: false });
});

test("one prescription carries behaviours in different pillars", () => {
  // The headline of this change: a doctor's note spanning pillars no longer needs
  // to be split into three prescriptions with the words retyped each time.
  const out = collectActions({
    prescriptionId: "rx-1",
    sources: [],
    slots: [
      slot("rx-1", "Walk for 20 minutes", { pillar: "physical_activity", category: "increase" }),
      slot("rx-1", "Eat a side salad", { pillar: "nutrition", category: "increase" }),
      slot("rx-1", "Be in bed by 10pm", { pillar: "sleep", category: "establish" })
    ],
    added: [], removed: {}, hasCanonicalSchedule: true,
    pillar: "physical_activity", category: "increase"
  });
  assert.deepEqual(out.map(b => b.pillar), ["physical_activity", "nutrition", "sleep"]);
  assert.equal(out.some(b => b.mixed), false);
});

test("an unsaved addition keeps the taxonomy the clinician chose for it", () => {
  const out = collectActions({
    prescriptionId: "rx-1",
    sources: [source("rx-1", "Walk for 20 minutes", { pillar: "physical_activity", category: "increase" })],
    slots: [],
    added: [{ action_text: "Eat a side salad", pillar: "nutrition", category: "increase" }],
    removed: {}, hasCanonicalSchedule: false,
    pillar: "physical_activity", category: "increase"
  });
  assert.deepEqual(out[1], { action_text: "Eat a side salad", pillar: "nutrition", category: "increase", mixed: false });

  // An override also beats a row that already exists — that is what makes an
  // in-flight re-file visible before it is saved.
  const refiled = collectActions({
    prescriptionId: "rx-1",
    sources: [],
    slots: [slot("rx-1", "Walk for 20 minutes", { pillar: "physical_activity", category: "increase" })],
    added: [{ action_text: "Walk for 20 minutes", pillar: "social_connection" }],
    removed: {}, hasCanonicalSchedule: true, pillar: "sleep", category: "maintain"
  });
  assert.deepEqual(refiled[0], { action_text: "Walk for 20 minutes", pillar: "social_connection", category: "increase", mixed: false });
});

test("rows disagreeing about one behaviour are flagged mixed, not silently arbitrated", () => {
  const out = collectActions({
    prescriptionId: "rx-1",
    sources: [],
    slots: [
      slot("rx-1", "Walk for 20 minutes", { pillar: "physical_activity", category: "increase" }),
      slot("rx-1", "walk for 20 MINUTES", { pillar: "nutrition", category: "increase" })
    ],
    added: [], removed: {}, hasCanonicalSchedule: true, pillar: "sleep", category: "maintain"
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].mixed, true);
  assert.equal(out[0].pillar, "physical_activity");   // first-seen still wins the value
});

// ---- actionTexts / findBehaviour -------------------------------------------

test("actionTexts unwraps behaviours and tolerates a plain string list", () => {
  assert.deepEqual(actionTexts([{ action_text: "Walk" }, { action_text: "Sleep" }]), ["Walk", "Sleep"]);
  assert.deepEqual(actionTexts(["Walk", "Sleep"]), ["Walk", "Sleep"]);
  assert.deepEqual(actionTexts(null), []);
});

test("findBehaviour matches through actionKey so casing and spacing never miss", () => {
  const behaviours = [{ action_text: "Walk for 20 minutes", pillar: "physical_activity", category: "increase" }];
  assert.equal(findBehaviour(behaviours, "  WALK FOR 20 MINUTES ").pillar, "physical_activity");
  assert.equal(findBehaviour(behaviours, "Something else"), null);
  assert.equal(findBehaviour(behaviours, ""), null);
});

// ---- applyActionTaxonomy ---------------------------------------------------

test("re-filing a behaviour rewrites only its own prescription's rows", () => {
  const rows = [
    slot("rx-1", "Be in bed by 10pm", { pillar: "sleep", category: "establish" }),
    slot("rx-1", "  be in bed by 10PM  ", { pillar: "sleep", category: "establish" }),
    slot("rx-2", "Be in bed by 10pm", { pillar: "sleep", category: "establish" }),
    slot("rx-1", "Dim the lights", { pillar: "sleep", category: "establish" })
  ];
  const changed = applyActionTaxonomy(rows, "rx-1", "Be in bed by 10pm", { pillar: "stress_management", category: "reduce" });
  assert.equal(changed, 2);
  assert.deepEqual(rows.map(row => row.pillar), ["stress_management", "stress_management", "sleep", "sleep"]);
  assert.deepEqual(rows.map(row => row.category), ["reduce", "reduce", "establish", "establish"]);
});

test("a re-file that changes nothing reports zero so the save gate stays clean", () => {
  // Same contract as applyActionRename: marking the week dirty for a change that
  // reached no slot would enable Approve and report a false success.
  const rows = [slot("rx-1", "Be in bed by 10pm", { pillar: "sleep", category: "establish" })];
  assert.equal(applyActionTaxonomy(rows, "rx-1", "Not scheduled", { pillar: "nutrition" }), 0);
  assert.equal(applyActionTaxonomy(rows, "rx-2", "Be in bed by 10pm", { pillar: "nutrition" }), 0);
  assert.equal(applyActionTaxonomy(rows, "rx-1", "Be in bed by 10pm", {}), 0);
  // Re-selecting the value it already has is a no-op, not a dirty week.
  assert.equal(applyActionTaxonomy(rows, "rx-1", "Be in bed by 10pm", { pillar: "sleep", category: "establish" }), 0);
  assert.deepEqual(rows[0], { prescription_id: "rx-1", action_text: "Be in bed by 10pm", pillar: "sleep", category: "establish" });
});

test("a blank field leaves that column alone rather than clearing it", () => {
  // The trace card sends both selects together, but a partial write must never
  // blank a column: a slot with no category is legal, a slot with a wiped pillar
  // is not — the server rejects it and the week becomes unsavable.
  const rows = [slot("rx-1", "Be in bed by 10pm", { pillar: "sleep", category: "establish" })];
  assert.equal(applyActionTaxonomy(rows, "rx-1", "Be in bed by 10pm", { pillar: "", category: "reduce" }), 1);
  assert.deepEqual([rows[0].pillar, rows[0].category], ["sleep", "reduce"]);
});

test("pillar and category are only defaults for new behaviours", () => {
  // Nothing anywhere locks them: the prescription's values reach a behaviour only
  // when the behaviour's own row carries none, so changing them never re-labels a
  // behaviour that has already been filed.
  const filed = [slot("rx-1", "Walk for 20 minutes", { pillar: "physical_activity", category: "increase" })];
  const before = collectActions({
    prescriptionId: "rx-1", sources: [], slots: filed, added: [], removed: {},
    hasCanonicalSchedule: true, pillar: "physical_activity", category: "increase"
  });
  const after = collectActions({
    prescriptionId: "rx-1", sources: [], slots: filed, added: [], removed: {},
    hasCanonicalSchedule: true, pillar: "sleep", category: "maintain"   // defaults changed
  });
  assert.deepEqual(before, after);
});
