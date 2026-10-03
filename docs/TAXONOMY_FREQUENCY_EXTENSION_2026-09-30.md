# Taxonomy-grounded frequency experiment: scope extension

Hans authorised replacing the original frozen synthetic result if a new,
taxonomy-grounded experiment warrants it. The prior dataset, model, and metrics
remain archived as **v1** evidence; their hashes and historical claims are not
rewritten. The new dataset and comparison are explicitly **v2** and must carry
their own assumptions, hashes, methods, metrics, limitations and thesis wording.

Frequency remains the primary model action. It chooses whether to send the first
one, two or three clinician-approved messages in a week. The clinician owns each
message's action, pillar, category, nudge type and tone. A frequency policy does
not select, generate or modify clinical content. The v2 synthetic generator
mirrors those taxonomy fields and gives users hidden, individual response
affinities for a controlled test. These affinities and fixed scenario effects
are invented experimental assumptions, not calibrated patient behaviour.

The current v2 local study compares greedy logistic, contextual Thompson
sampling, and a random eligible-frequency reference on ten seeds. It separately
tests whether taxonomy features improve held-out Brier and PR-AUC over the
original frequency/history features. The Gemini v2 arm waits for the approved
v1 Gemini run to release the shared free-tier quota. The LLM sees a lossy
training summary; this input difference must accompany any three-method claim.

New evidence lives in `output/taxonomy_frequency_v2_2026-09-30/` and its
protocol in `scripts/taxonomy-frequency/README.md`. When all v2 arms finish,
review and update the thesis methods, Table 2, policy comparison and limitations
**together**, explicitly labelling which generator/version produced each number.
Do not replace only the favorable figure or compare v1 and v2 raw rates as if
they came from the same synthetic population. Real-user adherence, clinical
effectiveness and nudge-type-selection effects remain unevaluated.

After the v2 experiment was generated, Hans supplied the live Patient Database
spreadsheet. A separate **v3 source-shaped synthetic fixture** now mirrors the
populated table columns and their foreign-key links. It is documented in
`scripts/patient-schema-synthetic/README.md`. Its outcome rows are a projection
of the v2 simulator, not newly learned response behaviour, and its personal
fields are synthetic labels or null. Because the source contains only sparse
response events, the v3 fixture should be used for integration and data-contract
checks. It does not supersede the v2 policy comparison or justify a new
patient-calibrated performance claim. Any future v3 policy experiment needs a
new protocol and distinct results rather than relabelling the v2 metrics.
