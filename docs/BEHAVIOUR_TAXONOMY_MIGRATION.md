# Behaviour taxonomy migration

`pillar` and `category` move **down from the prescription to the target behaviour**.
A behaviour is now the triple `(action_text, pillar, category)`, owned by the row
that carries it — a weekly slot or a source nudge. The prescription keeps its own
`pillar`/`category` as **defaults for new behaviours** and as the fallback for a
legacy row that has none. They are no longer a lock.

Research trace after this change:

```text
raw prescription → behaviour (action + pillar + category) → message → feedback
```

This continues the move `docs/ACTION_TAXONOMY_MIGRATION.md` began: that change took
the execution step off the prescription (`target_behavior` → `action_text` on the
slot). This one takes the rest of the taxonomy with it.

## Why

Two problems, one cause.

1. **Redundancy.** The trace card showed a `Taxonomy` step (pillar, category — owned
   by the prescription) directly above a `Target behaviour` step (action — owned by
   the slot). Two rows, two owners, one concept.
2. **One prescription was locked to one pillar.** A doctor's note — *"walk more, eat
   better, sleep by 10"* — spans three pillars. Covering all three meant creating
   three prescriptions and retyping the doctor's words into each. The prescription is
   the **note**, not the behaviour; only the behaviour has a single pillar.

Attaching the taxonomy to the thing it describes fixes both. The trace card became
one merged step where each row is a whole behaviour, and the weekly slot **picks**
one from that list instead of retyping free text.

## The migration — 2 columns

Append to the header row (rows are read by name, not position). **Leave every cell
blank.**

| Tab | Column |
|---|---|
| `nudges` | `category` |
| `weekly_schedule` | `category` |

Verify the two headers directly in the copied Sheet before deploying. The real
`loadClinicalData()` header assertion is also exercised by the local test suite.

`clinical-data.js` asserts these headers, so **the columns must exist before the
deploy** or every request 500s naming them. That loud failure is deliberate:
`rowData()` writes only keys present in the header row, so a missing column would
drop the clinician's value silently instead.

**Do not run `scripts/seed-weekly-schedule.js`** — it mints slot ids and would
duplicate portal-created slots.

## Blank behaviour (Case A, same posture as the action migration)

`pillar` was already populated on **every** live row of both tabs — 0 blanks across
50 `nudges` and 19 `weekly_schedule` rows when this was checked. Only `category` is
new, and it starts blank everywhere.

- **On read**, a blank falls back to the prescription's `category` (client-side,
  `ReviewState.behaviourTaxonomy`).
- **On write**, `schedule-store` fills it from the prescription when the slot sends
  none, so the clinician's first save of a patient's week persists it for real.
- **Therefore every existing behaviour renders exactly as it does today.** Nothing
  changes for a patient until a clinician deliberately re-files one.

## The contract: the card owns, the slot picks

- The **trace card** is the only place a behaviour is created, reworded, re-filed or
  deleted. Re-filing rewrites `pillar`/`category` on every slot using that behaviour,
  scoped to one prescription and matched case-insensitively through `actionKey`.
- The **weekly slot** carries a `<select>`, not a text field. Picking a behaviour
  adopts its whole triple. A stored action that is not in the list is pinned as a
  verbatim option and preselected — without that, a `<select>` snaps to its first
  option and *changes what the slot sends* merely by being rendered.
- The list is still **derived, never stored**: it is a view over the live weekly
  slots plus unsaved additions. There is no behaviour CRUD endpoint and no standalone
  Sheet column.

## Gates removed

| Where | What it did | Why it went |
|---|---|---|
| `schedule-store.js` | rejected a slot whose `pillar` disagreed with its prescription | that is now a legitimate multi-pillar plan |
| `prescription-store.js` | `pillarLock` — 409 on a pillar edit once anything was scheduled | pillar is only a default now; refusing to change a default is pure friction |
| `prescription-store.js` | cascaded a pillar change onto every source nudge | it would silently re-file behaviours the clinician deliberately put elsewhere |

Replaced by an **independent enum check**: a slot's `category` must be a member of
the enum if present, and may be blank. Reject-guarded exactly like `action_text`,
because rejection writes no taxonomy and a legacy plan carrying none must stay
rejectable.

`schedule-store.js` also adds `category` to `VERIFY_FIELDS`, writes
`slot.category || prescription.category` on the active slot, and copies `category`
onto every dated delivery beside `pillar` — Workflow B reads the dated row, so the
delivery must be self-describing.

**Workflow A is untouched.** Its `n.pillar !== pillarByPrescription[...]` check is
*intra-batch* — it validates one LLM response against itself, never against stored
rows — and its own prompt rule makes it self-satisfying, so it has never fired. Its
`Write Nudges` node uses `autoMapInputData`, so the new blank `category` column is
simply left empty and falls back. Touching an academically documented validation
gate for zero behavioural change was not worth it.

### One thing to note, not to lock

Changing a prescription's default `pillar` *could* retroactively re-label a legacy
behaviour through the read-path fallback. It cannot in practice, because every live
row already carries a real `pillar` — the fallback is only ever reached for
`category`, which is what the first save fills. Recorded here rather than encoded as
a lock.

## Known limitation

A behaviour added in the trace card and **never attached to a slot does not
persist** — and now loses its pillar and category too, not just its wording. This is
unchanged in kind from the action migration; this change only widens what is lost.
The UI says so on the row (`not scheduled`, with a title explaining it).

It is narrow in practice: `createPrescription` atomically writes a source nudge
carrying the full triple, and Workflow A writes one per `frequency_per_week`.

**Rejected alternative**, so it is not relitigated: persisting each behaviour as its
own source `nudges` row. It would make behaviours durable, but needs a new write
path, breaks "derived, never stored", orphans rows that `buildPatients` feeds to the
add picker and `seedWeekFromNudges`' fallback, and turns the delete-guard into a
Sheets deletion. Future work.

## Verification

```bash
cd landing && npm test
cd landing && npm run check
```

The DOM is what the tests cannot reach — there is no jsdom. In the browser:

- Add a second behaviour to a `physical_activity` prescription, file it under
  `nutrition` / `increase`, attach a nudge, Approve. Both slots persist their own
  pillar.
- **Reload: each slot's chips still show its own pillar and category, not the
  prescription's.** This is the precedence-inversion regression check — the old
  `slotFromNudge` read `(rx && rx.pillar) || n.pillar`, prescription first, which
  after this migration would have overwritten every slot's pillar on each reload.
- A legacy slot whose action is not in the list shows the pinned
  "— not in this prescription" option and does not silently snap.
- Renaming a behaviour still follows every slot using it; re-filing does too.
- Editing a prescription's default pillar succeeds and leaves behaviours alone.
