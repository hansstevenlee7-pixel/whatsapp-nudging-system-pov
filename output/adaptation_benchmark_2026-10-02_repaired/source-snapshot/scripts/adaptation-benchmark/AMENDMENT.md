# Pre completion integration repair

The first frozen run (`output/adaptation_benchmark_2026-10-02`) stopped after two sandbox network failures. The next run (`output/adaptation_benchmark_2026-10-02_network`) stopped after two actual Gemini HTTP 400 responses. Both are retained as incomplete diagnostic runs, not pooled into the final comparison.

The existing classifier passed JSON Schema type arrays to Gemini's OpenAPI-style `responseSchema`, which requires a scalar type. Its five nullable string fields now use `type: string, nullable: true`. The prompt, model, temperature, deterministic rules, cases and expected outcomes remain unchanged. This repair is separately tested and the repaired source is frozen in a new output directory before evaluation.

Before evaluating timing/frequency cases, the harness's unrelated-preference comparison was corrected to treat absent and null optional values alike. This is representation normalization, not a changed expected preference. The existing schedule regression test was anchored to its intended September evaluation date using the existing time parameter; production schedule code was not changed.

Four prior external attempt reservations are counted against the 60-attempt study budget. The repaired runner has at most 56 further attempts. Zero retries are used. The original incomplete results remain visible and demonstrate an integration failure; the repaired evaluation answers the interpretation comparison.
