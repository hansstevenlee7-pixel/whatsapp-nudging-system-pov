"use strict";

// The per-slot message option list.
//
// Workflow A writes one `nudges` row per frequency_per_week — same behaviour,
// different wording. The clinician adds one nudge and flips between those
// wordings, so the option list is derived from the prescription's source rows
// rather than stored. Only message_body and message_body_alt survive a save, so
// every reload re-derives the list and matches the saved body back into it.
// These tests pin that round trip, because there is no jsdom and the DOM half
// can only be smoke-tested by hand.

const test = require("node:test");
const assert = require("node:assert/strict");
const ReviewState = require("../review-state");

const { buildMessageOptions, altForOption, MESSAGE_TONES } = ReviewState;

function source(overrides) {
  return Object.assign({
    prescription_id: "rx-1", action_text: "Walk 20 minutes",
    message_body: "", message_body_alt: "", tone_variant: "encouraging"
  }, overrides);
}

// Three wordings, exactly what a frequency_per_week of 3 produces.
function threeSources() {
  return [
    source({ message_body: "Time for your walk.", message_body_alt: "Your walk is scheduled now." }),
    source({ message_body: "Another day, another walk.", message_body_alt: "Today's walk is due." }),
    source({ message_body: "Wonderful progress — walk time.", message_body_alt: "Walk session due." })
  ];
}

function build(overrides) {
  return buildMessageOptions(Object.assign({
    sources: threeSources(), prescriptionId: "rx-1", actionText: "Walk 20 minutes",
    currentText: "", customTone: "encouraging", preferredTone: "encouraging", ordinal: 0
  }, overrides));
}

test("every generated wording becomes an option, primaries first, then one custom", function () {
  const result = build();

  assert.equal(result.generatedCount, 6, "3 bodies + 3 alternates");
  assert.equal(result.options.length, 7, "plus exactly one doctor-custom");

  // Primaries in source order, so Option 1..3 read as "what the model wrote".
  assert.deepEqual(result.options.slice(0, 3).map(o => o.text), [
    "Time for your walk.", "Another day, another walk.", "Wonderful progress — walk time."
  ]);
  assert.deepEqual(result.options.slice(3, 6).map(o => o.text), [
    "Your walk is scheduled now.", "Today's walk is due.", "Walk session due."
  ]);
  assert.ok(result.options.slice(0, 6).every(o => o.generated === true));

  const custom = result.options[6];
  assert.equal(custom.generated, false);
  assert.equal(custom.label, "doctor custom");
  assert.equal(custom.text, "");
});

test("blank bodies are skipped and duplicate wordings collapse to one option", function () {
  const result = build({
    sources: [
      source({ message_body: "Take a walk.", message_body_alt: "" }),
      source({ message_body: "   ", message_body_alt: "" }),
      // Same sentence, different spacing and case — one option, not three.
      source({ message_body: "take   a  walk.", message_body_alt: "" }),
      source({ message_body: "TAKE A WALK.", message_body_alt: "" })
    ]
  });
  assert.equal(result.generatedCount, 1);
  assert.equal(result.options[0].text, "Take a walk.", "first occurrence keeps its exact casing");
});

test("a duplicate never overwrites the first occurrence's tone or alternate", function () {
  const result = build({
    sources: [
      source({ message_body: "Walk now.", message_body_alt: "First alt.", tone_variant: "encouraging" }),
      source({ message_body: "walk now.", message_body_alt: "Second alt.", tone_variant: "neutral_informational" })
    ]
  });
  assert.equal(result.options[0].tone, "encouraging");
  assert.equal(result.options[0].alt, "First alt.");
});

test("rows belonging to another prescription are excluded", function () {
  const result = build({
    sources: [
      source({ message_body: "Mine." }),
      source({ prescription_id: "rx-2", message_body: "Someone else's." })
    ]
  });
  assert.deepEqual(result.options.filter(o => o.generated).map(o => o.text), ["Mine."]);
});

test("options are scoped to the slot's behaviour when that matches any source row", function () {
  const result = build({
    actionText: "Eat 5 serves of veg",
    sources: [
      source({ action_text: "Walk 20 minutes", message_body: "Walk message." }),
      source({ action_text: "Eat 5 serves of veg", message_body: "Veg message." })
    ]
  });
  assert.deepEqual(result.options.filter(o => o.generated).map(o => o.text), ["Veg message."]);
});

test("scoping falls back to the whole prescription when no source row matches the behaviour", function () {
  // Renaming a slot's action does not rename the source rows, and legacy rows
  // carry no action_text at all. Without this fallback the clinician's option
  // list would empty itself the moment they edited the action.
  const renamed = build({
    actionText: "Walk 30 minutes after dinner",
    sources: [source({ action_text: "Walk 20 minutes", message_body: "Only wording." })]
  });
  assert.deepEqual(renamed.options.filter(o => o.generated).map(o => o.text), ["Only wording."]);

  const legacy = build({
    actionText: "Walk 20 minutes",
    sources: [source({ action_text: "", message_body: "Legacy wording." })]
  });
  assert.deepEqual(legacy.options.filter(o => o.generated).map(o => o.text), ["Legacy wording."]);
});

test("a saved body that the model wrote reselects its own option, leaving custom empty", function () {
  const result = build({ currentText: "Another day, another walk." });
  assert.equal(result.selected, 1);
  assert.equal(result.options[result.selected].generated, true);
  assert.equal(result.options[result.generatedCount].text, "", "custom stays empty");
});

test("a saved body the model never wrote comes back as the selected doctor-custom option", function () {
  // The save -> reload contract. The clinician edited the wording; it must
  // survive, stay selected, and not masquerade as a generated option.
  const edited = "Walk to the park and back, twice around the oval.";
  const result = build({ currentText: edited });

  assert.equal(result.selected, result.generatedCount, "the trailing custom option");
  const custom = result.options[result.selected];
  assert.equal(custom.generated, false);
  assert.equal(custom.text, edited);
  assert.equal(custom.origin, edited);
  // Every model wording is still offered, so the edit is reversible.
  assert.equal(result.generatedCount, 6);
});

test("matching a saved body ignores case and whitespace drift from Sheets", function () {
  const result = build({ currentText: "  another   DAY, another walk.  " });
  assert.equal(result.selected, 1, "must not be mistaken for a doctor edit");
  assert.equal(result.options[result.generatedCount].text, "");
});

test("a fresh slot rotates through the wordings of its preferred tone", function () {
  const picks = [0, 1, 2, 3].map(ordinal => {
    const result = build({ ordinal });
    return result.options[result.selected].text;
  });
  assert.deepEqual(picks, [
    "Time for your walk.", "Another day, another walk.",
    "Wonderful progress — walk time.", "Time for your walk."
  ], "three encouraging bodies, then wrap");
});

test("rotation falls back to all wordings when none carries the preferred tone", function () {
  const result = build({ preferredTone: "neutral_informational", ordinal: 1, sources: [
    source({ message_body: "One.", tone_variant: "encouraging" }),
    source({ message_body: "Two.", tone_variant: "encouraging" })
  ] });
  assert.equal(result.options[result.selected].generated, true);
  assert.equal(result.options[result.selected].text, "Two.");
});

test("a prescription with no usable wording still yields a selectable custom option", function () {
  const result = build({ sources: [source({ message_body: "", message_body_alt: "" })] });
  assert.equal(result.generatedCount, 0);
  assert.equal(result.options.length, 1);
  assert.equal(result.selected, 0);
  assert.equal(result.options[0].generated, false);
});

test("the custom option carries a real tone, falling back when given a bad one", function () {
  // schedule-store maps a "custom" tone to neutral_informational on save, so a
  // placeholder here would silently flip an encouraging message after a reload.
  assert.equal(build({ customTone: "neutral_informational" }).options.at(-1).tone, "neutral_informational");
  assert.equal(build({ customTone: "custom" }).options.at(-1).tone, "encouraging");
  assert.equal(build({ customTone: "" }).options.at(-1).tone, "encouraging");
});

test("every option carries a tone the server will accept", function () {
  // buildApprovePayload sends option.tone as tone_variant; schedule-store
  // rejects anything outside its enum, so this invariant keeps a save from 400ing.
  for (const customTone of ["encouraging", "neutral_informational", "custom", "", null]) {
    const result = build({ customTone });
    for (const option of result.options) {
      assert.ok(MESSAGE_TONES.includes(option.tone), `unexpected tone: ${option.tone}`);
    }
  }
});

test("altForOption reports the counterpart only while the wording is untouched", function () {
  const result = build();
  const generated = result.options[0];
  assert.equal(altForOption(generated), "Your walk is scheduled now.");

  // The doctor edits a generated option in place — the recorded alternate is no
  // longer the counterpart of anything, so it must not be sent.
  generated.text = "Time for your walk around the block.";
  assert.equal(altForOption(generated), "");

  assert.equal(altForOption(result.options.at(-1)), "", "a custom body has no counterpart");
  assert.equal(altForOption(null), "");
  assert.equal(altForOption({ generated: true, text: "x", origin: "x", alt: "" }), "");
});

test("altForOption tolerates whitespace drift between text and origin", function () {
  assert.equal(
    altForOption({ generated: true, text: " Walk   now. ", origin: "Walk now.", alt: "Counterpart." }),
    "Counterpart."
  );
});

test("each call returns fresh option objects, so two slots never edit each other", function () {
  // renderWeek binds the textarea straight to the option object, so a shared
  // reference would let one slot rewrite another's message.
  const first = build();
  const second = build();
  first.options[0].text = "Rewritten by slot one.";
  assert.equal(second.options[0].text, "Time for your walk.");
  assert.notEqual(first.options[0], second.options[0]);
});
