# Supervisor update — draft

Draft for Hans to send. Adjust the greeting and tone to your usual register. Notes for you (not for sending) are at the bottom.

---

**Subject:** Thesis progress — scope narrowed to frequency adaptation, and two consistency items

Dear David,

A short update on where the minor thesis stands, and one decision I would like to confirm with you.

**1. Evaluation scope narrowed to a single adaptation dimension**

The system can adapt three things: message frequency, delivery time window, and which approved resource is sent. I have narrowed the *evaluated* dimension to **frequency only**. Delivery window and media selection remain implemented and will be demonstrated, but they will not be presented as separate optimisation studies.

This follows the revised proposal, §4.4, which states that one bounded adaptation dimension will provide the core experiment. Frequency is the only dimension with a trained model, frozen evaluation metrics, and a matched policy comparison already completed. Attempting to evaluate all three would require new protocols and baselines that will not fit before 23 October.

**2. Authoritative document, and a reference correction**

I am now treating the revised literature review and proposal dated 12 September as the authoritative version, superseding the earlier submitted copy.

While checking citations I found an error in its reference list. The Nahum-Shani entry currently merges two different papers: the author list and title belong to the 2018 *Annals of Behavioral Medicine* article (52(6), 446–462), while the DOI given belongs to a separate 2015 *Health Psychology* paper by different authors. I will correct this entry and use the corrected form in Part 2.

**3. Two consistency points between Part 1 and Part 2**

Reviewing the literature review against the implemented system, I found two places where Part 2 needs to state its position more precisely than Part 1 currently does:

- §2.6 criticises adaptive systems that optimise for engagement proxies. My system adapts frequency against a 24-hour interaction proxy, so I need to explain why this is defensible: the proxy governs communication logistics only, is bounded by a deterministic safety layer, and cannot alter the prescribed action or clinical goal. Part 2 will claim to address only the first of the three structural disconnections identified in §3, not all three.
- §2.6 describes the LLM as confined to the "message surface layer". In practice Gemini also produces the first week of nudges at intake and interprets explicit patient requests, in both cases inside a locked vocabulary with a deterministic validation gate. I would like to restate this more accurately, since the precise description is stronger than the current one.

**4. Status and remaining work**

The system is complete and the model artifact is frozen and hashed. Remaining work is evidence collection for the traceability and automation questions, then writing. The evaluation is entirely synthetic and no patient data is involved; the final implementation is not deployed, which is not required for a technical feasibility study.

Could you confirm that narrowing the evaluated dimension to frequency is acceptable, and let me know if you disagree with any of the above? I am happy to discuss at our next meeting.

Kind regards,
Hans

---

## Notes for Hans, not for sending

- The only real **ask** is item 1. Everything else is notification. If you want a faster reply, consider leading with that question.
- Item 3 involves **amending a submitted document**. Check whether your supervisor or the unit expects a formal erratum, or whether an in-text correction in Part 2 is sufficient.
- Check the thesis instructions for **AI-use disclosure requirements** before submission, and decide separately how you want to handle that. I have not put anything about it in this email, since it is your call.
- If the supervisor pushes back on narrowing the scope, the fallback is to keep frequency as the evaluated dimension and add one short demonstration trace each for time and media — that costs days, not weeks, and does not require new baselines.
