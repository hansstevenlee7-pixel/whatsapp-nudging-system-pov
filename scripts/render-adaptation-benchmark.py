"""Build an editable research report and a static local demonstration from saved traces.
Uses bundled python-docx/Pillow. Does not rerun or alter benchmark evidence.
"""
import json, sys, html, hashlib
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
out=Path(sys.argv[1]).resolve()
r=json.loads((out/'results.json').read_text())
# Incomplete provider-dependent results must remain visibly provisional.
traces=[json.loads(p.read_text()) for p in sorted((out/'traces').glob('*.json'))]
first=[t for t in traces if t['repeat']==1]
attempts=[json.loads(s) for s in (out/'api-attempts.jsonl').read_text().splitlines() if s]
lookup={(t['case_id'],t['arm'],t['repeat']):t for t in traces}
rows=r['rows']; names={'fixed':'Fixed schedule','rules':'Rules interpreter','hybrid':'Hybrid interpreter'}
# Presentation-only diagnostics are derived without changing frozen primary assertions.
provider_cases={(a['case_id'],a['repeat']) for a in attempts if a['status']!=200}
valid_fallback=[t for t in traces if t['arm']=='hybrid' and t['api_calls'] and (t['case_id'],t['repeat']) not in provider_cases]
valid_success=sum(t['success'] for t in valid_fallback)
metrics={'primary_results':r,'valid_provider_fallback_runs':len(valid_fallback),'successful_valid_provider_fallback_runs':valid_success,
 'provider_affected_runs':sorted(list(provider_cases)), 'model_versions':sorted({a.get('model_version','unknown') for a in attempts if a['status']==200}),
 'all_run_constraint_violations':{arm:sum(len(t['constraint_violations']) for t in traces if t['arm']==arm) for arm in names},
 'distinct_constraint_violation_cases':{arm:sorted({t['case_id'] for t in traces if t['arm']==arm and t['constraint_violations']}) for arm in names}}
(out/'presentation_metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
# Before/after diagram uses actual persisted observations, not illustrative values.
case_id='time-1'; ts=[lookup[(case_id,a,1)] for a in names]
font_path='/System/Library/Fonts/Supplemental/Arial.ttf'
f=lambda n:ImageFont.truetype(font_path,n)
im=Image.new('RGB',(1600,700),'white'); draw=ImageDraw.Draw(im)
draw.text((60,35),'One request through three systems',font=f(38),fill='#172a3a')
draw.text((60,100),'Initial schedule 09:00 | Approved window 08:00–20:00',font=f(26),fill='#42566a')
draw.text((60,145),'Request: Send at 18:30',font=f(26),fill='#42566a')
for i,t in enumerate(ts):
 x=60+i*510; obs=t['steps'][0].get('observed',{}); color='#16746f' if t['success'] else '#974a32'
 draw.rounded_rectangle((x,220,x+475,575),radius=16,fill='#f2f5f8',outline='#d4dde5',width=2)
 draw.text((x+25,250),names[t['arm']],font=f(29),fill='#172a3a')
 draw.text((x+25,325),'09:00  →  '+str(obs.get('time','unavailable')),font=f(38),fill=color)
 draw.text((x+25,410),'Frequency: '+str(obs.get('frequency','?'))+' per week',font=f(24),fill='#42566a')
 draw.text((x+25,465),'Task '+('PASS' if t['success'] else 'FAIL'),font=f(26),fill=color)
 draw.text((x+25,510),'Saved state and prepared message',font=f(20),fill='#42566a')
draw.text((60,630),'Observed case time-1. Timing changes, but history protection fails in both adaptive arms.',font=f(23),fill='#42566a')
im.save(out/'before_after.png')
# HTML demonstration exposes all results and a fully inspectable trace.
css='body{font:17px system-ui;max-width:1100px;margin:40px auto;padding:0 24px;color:#172a3a}table{border-collapse:collapse;width:100%;margin:20px 0}td,th{padding:10px;border-bottom:1px solid #ddd;text-align:left}th{background:#edf3f7}details{margin:14px 0;padding:15px;background:#f5f7f9}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}img{width:100%}.pass{color:#17664d}.fail{color:#963e29}'
parts=[f'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Bounded adaptation benchmark</title><style>{css}</style><h1>Bounded adaptation benchmark</h1>',
 '<p>INCOMPLETE model comparison: daily Gemini quota exhausted. All fixed and rules cases ran; two hybrid first runs and remaining repetitions are pending. The hybrid interpreter uses the repaired Gemini schema. These results do not establish real-user or clinical performance.</p>',
 '<table><tr><th>Arm</th><th>Task success</th><th>Supported requests</th><th>Constraint violations</th></tr>']
for row in rows:parts.append(f'<tr><td>{names[row["arm"]]}</td><td>{row["success"]}/{row["completed"]}</td><td>{row["supported_success"]}/12</td><td>{row["constraint_violations"]}</td></tr>')
parts+=['</table><img src="before_after.png" alt="Observed before and after schedule comparison for case time-1">', '<h2>Every case</h2>']
for p in r['paired']:
 parts.append(f'<details><summary>{html.escape(p["case_id"])} — '+ ' | '.join(f'{names[a]}: {"PENDING" if p[a] is None else "PASS" if p[a] else "FAIL"}' for a in names)+'</summary>')
 for a in names:
  t=lookup.get((p['case_id'],a,1));
  if t is None:
   parts.append('<p>Not evaluated: daily Gemini quota exhausted.</p>'); continue
  compact={'arm':a,'input':[s['input'] for s in t['steps']],'observed':[s.get('observed') for s in t['steps']], 'failed_checks':t['failed_checks'],'errors':t['errors'],'interpretations':[s.get('decision',{}).get('interpretation') for s in t['steps']]}
  parts.append('<pre>'+html.escape(json.dumps(compact,indent=2))+'</pre>')
 parts.append('</details>')
parts.append('<h2>Evidence</h2><p>See REPORT.md, results.json, api-attempts.jsonl, manifest.json and traces/ beside this page. API failures remain distinct from valid model interpretations. The fixed arm is a reference; rules versus hybrid is the primary comparison.</p></html>')
(out/'demo.html').write_text(''.join(parts))
# Editable report with fixed page breaks for predictable reading and rendering.
doc=Document(); sec=doc.sections[0];sec.top_margin=sec.bottom_margin=Inches(.7);sec.left_margin=sec.right_margin=Inches(.75)
style=doc.styles['Normal'];style.font.name='Arial';style.font.size=Pt(10);style.paragraph_format.space_after=Pt(6)
for n in ['Title','Heading 1','Heading 2']:
 doc.styles[n].font.name='Arial';doc.styles[n].font.color.rgb=RGBColor.from_string('172A3A')
doc.styles['Title'].font.color.rgb=RGBColor(0,0,0)
footer=sec.footer.paragraphs[0];footer.text='System POV research | Synthetic technical evaluation | '
fld=OxmlElement('w:fldSimple');fld.set(qn('w:instr'),'PAGE');footer._p.append(fld)
def p(text):doc.add_paragraph(text)
def h(text):doc.add_heading(text,1)
def table(headers,data):
 t=doc.add_table(rows=1,cols=len(headers));t.style='Light Shading Accent 1'
 for cell,s in zip(t.rows[0].cells,headers):cell.text=str(s)
 for row in data:
  cells=t.add_row().cells
  for cell,s in zip(cells,row):cell.text=str(s)
 for row in t.rows:
  trPr=row._tr.get_or_add_trPr(); flag=OxmlElement('w:cantSplit');trPr.append(flag)
 return t
fixed,rules,hybrid=rows
doc.add_heading('Comparing bounded adaptation in a messaging system',0)
p('Research evaluation report | Hans Lee | 2 October 2026')
p(f'The benchmark implementation and all 24 fixed and rules cases are complete, but the model comparison is INCOMPLETE because Gemini reached its daily free-tier quota. Fixed passed {fixed["success"]}/24 and rules passed {rules["success"]}/24. Hybrid passed {hybrid["success"]}/{hybrid["completed"]} completed first runs, many affected by provider errors. These unequal denominators are not a completed superiority comparison.')
h('Research question')
p('Does a rules-plus-Gemini reply interpreter fulfil changing requests more reliably than the existing deterministic interpreter, when downstream scheduling and delivery logic are shared? A fixed schedule provides a reference for disabling preference adaptation.')
h('Primary results')
table(['Arm','All tasks','Supported requests','Violations'],[[names[x['arm']],f'{x["success"]}/{x["completed"]}',f'{x["supported_success"]}/12',x['constraint_violations']] for x in rows])
p('Task success requires every expected output and protection to pass. A stored recommendation without the corresponding schedule or prepared-message change does not pass. Constraint violations are counted separately and cannot be offset by successful cases.')
doc.add_picture(str(out/'before_after.png'),width=Inches(6.6))
p('Figure 1. Actual before/after results for the direct timing request in case time-1. The evidence stops at local delivery preparation.')
doc.add_page_break();h('Method and reproducibility')
p('The suite contains 12 supported requests (media, summary length, timing and frequency, each in three language forms), four no-change cases, four boundary/override cases, and four operational cases. Expected outcomes were written from the project requirements before execution. The implementer authored both cases and labels; independent adjudication was not performed.')
p('The two adaptive arms share the existing frozen logistic frequency policy. “Rules interpreter” therefore describes the interpretation component, not an entirely model-free system. The fixed arm retains initial preferences and skips automatic policy evaluation; all arms share STOP, consent, approved media and delivery preparation.')
p('Signed synthetic inbound events run through the real webhook. Operational state and decisions use the actual application store operations against a minimal local PostgREST emulator. The real frequency worker applies schedule changes, and delivery preparation writes a reservation and prepares a message. Sheets uses the existing local test adapter. No WhatsApp message or production data was changed.')
p('The benchmark clock is fixed at 2 October 2026. A closed historical delivery supplies context; a missing read receipt remains unknown. Historical message and delivery fields are protected, while legitimate inbound audit metadata can change. Latency uses a monotonic clock rather than the frozen application clock.')
h('Integration defect and amendment')
p('Two initial attempts failed in the network-restricted sandbox. Two subsequent actual Gemini calls returned HTTP 400 because the existing responseSchema used nullable type arrays unsupported by that API schema representation. Those incomplete runs are retained separately. The repair uses scalar string types with nullable=true; the prompt, rules, model, temperature, cases and intended outcomes were unchanged.')
p('Before the remaining evaluation, absent and null optional preferences were normalized in the harness comparison. A pre-existing schedule test was anchored to its intended September date using the existing evaluation-time parameter. Production schedule code was not modified. All 215 regression tests passed after these changes. Passing existing tests did not establish success on the broader benchmark.')
h('Metrics')
p('Primary scores use the first execution per case. Reported diagnostics include supported-request fulfilment, no-change errors, exact interpretation matches, constraint violations, local latency and API usage. The protocol requires three fresh runs for Gemini-fallback cases; quota exhaustion interrupted this requirement. Repetitions are correlated scenario repetitions, not additional independent cases. No hypothesis test, equivalence claim or composite weighted score is used.')
p('Brier score is not used: the study scores actions and resulting states, not probabilities of interaction. Hevner and FEDS support controlled artifact evaluation; JITAI terminology describes decision points and tailoring rules. The final-state approach is inspired by tau-bench, without adopting its dataset or claiming leaderboard comparability.')
doc.add_page_break();h('Results by scenario')
table(['Case','Fixed','Rules','Hybrid'],[[x['case_id']]+['Pending' if x[a] is None else 'Pass' if x[a] else 'Fail' for a in names] for x in r['paired']])
p('Entries are first-run outcomes; Pending is not counted as a failure or success. The frozen cases and raw traces retain exact inputs, expected state, interpretation, policy output, prepared message and failed assertions.')
doc.add_page_break();h('Reliability and operational cost')
rep=r['repeat_consistency'];api=r['api']
p(f'{rep["all_three_success"]} of {rep["completed_three"]} completed repeated fallback cases passed all three fresh executions; {rep["eligible"] - rep["completed_three"]} started fallback cases lack a full repetition set. The repaired run made {api["attempts"]} API attempts, including {api["failed_attempts"]} non-200/network outcomes and {api["invalid_payloads"]} invalid JSON responses with HTTP 200. Four earlier diagnostic attempts are recorded separately. No automatic retries or paid fallback were used.')
p(f'For diagnostic context only, {valid_success}/{len(valid_fallback)} fallback executions with successful provider responses passed the task. This conditional count excludes provider failures and must not replace the primary operational score. Returned model versions: {", ".join(metrics["model_versions"])}.')
p(f'Reported prompt tokens: {api["prompt_tokens"]}; candidate output tokens: {api["output_tokens"]}; thought tokens: {api["thought_tokens"]}. Mean provider-attempt duration was {api["latency_ms"]/max(api["attempts"],1)/1000:.2f} seconds. Request pacing is excluded from that duration. These are observed costs; no currency price is assumed.')
table(['Arm','Interpretation matches','No-change errors','Mean local ms'],[[names[x['arm']],('Not applicable' if x['arm']=='fixed' else f'{x["interpretation_correct"]}/{x["interpretation_total"]}'),f'{x["no_change_failures"]}/{x["no_change_total"]}',f'{x["mean_local_ms"]:.2f}'] for x in rows])
h('Failure analysis')
for arm in ['rules','hybrid']:
 failed=[t for t in first if t['arm']==arm and not t['success']]
 p(names[arm]+': '+('; '.join(t['case_id']+' ('+', '.join(t['failed_checks']+t['errors'])+')' for t in failed) or 'No failed first-run cases.'))
p('The main negative system finding is historical-source mutation: when the recurring schedule points to the already-sent source nudge, schedule application changes that source status from sent to approved and adds reviewed_at. Requested timing/frequency may be correct, but the strict history protection fails. A separate finding is that a negated frequency request matches the more-often rule, so both adaptive arms change frequency incorrectly.')
p('A wrong deterministic match can affect both adaptive arms because the hybrid classifier bypasses Gemini when a rule reports an explicit request. Provider failures also fall back to deterministic interpretation. These mechanisms must be distinguished from a valid model response that interprets a request incorrectly.')
h('Limitations and conclusion')
p('This small, deliberately selected synthetic suite does not estimate real-user performance. Test phrases may overlap existing rules; paraphrases and repeats are not independent subjects. The storage emulators do not establish cloud persistence, concurrency, delivery, or production safety. The shared downstream model prevents attributing every system outcome solely to interpretation. No clinical, adherence or behavioural-benefit conclusion follows.')
p('Research completion means all frozen cases and failures are reported. Artifact acceptance is a separate question: any unmet required behaviour remains an unresolved finding. Negative results and integration failures are retained rather than removed or used to tune the final cases.')
doc.add_page_break();h('Reproduction and demonstration')
p('Repository: Whatsapp Nudging System - System POV. Frozen evidence is in output/adaptation_benchmark_2026-10-02_repaired. Use the manifest source hashes as the authoritative version; the working tree contains pre-existing changes.')
p('Resume pending cases after quota availability: node scripts/adaptation-benchmark/run.js --live --out output/adaptation_benchmark_2026-10-02_repaired. Existing traces, including quota-affected failures, are retained; source changes require a new directory. Completing pending cases alone does not remove provider confounding. A clean provider-available replication must be a separately labelled run, never overwrite these results. Rebuild summaries without model calls using --report-only and the same --out argument. Fresh independent reruns require a new directory and available Gemini access.')
p('For a five-minute demonstration, open demo.html. State the incomplete model comparison first. Explain the three arms and shared safeguards (one minute); inspect the timing figure, history failure, and successful media-2 hybrid trace (one minute); show a rules/hybrid disagreement (one minute); inspect a negative result and an API failure (one minute); finish with reproducibility and claim boundaries (one minute).')
h('References')
refs=[
'Hevner, A. R., March, S. T., Park, J., and Ram, S. (2004). Design Science in Information Systems Research. MIS Quarterly, 28(1), 75–105. https://doi.org/10.2307/25148625',
'Venable, J., Pries-Heje, J., and Baskerville, R. (2016). FEDS: A Framework for Evaluation in Design Science Research. European Journal of Information Systems, 25, 77–89. https://doi.org/10.1057/ejis.2014.36',
'Nahum-Shani, I., et al. (2018). Just-in-Time Adaptive Interventions in Mobile Health: Key Components and Design Principles for Ongoing Health Behavior Support. Annals of Behavioral Medicine, 52(6), 446–462. https://doi.org/10.1007/s12160-016-9830-8',
'Yao, S., Shinn, N., Razavi, P., and Narasimhan, K. (2024). tau-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains. https://arxiv.org/abs/2406.12045',
'Google AI for Developers. Gemini API structured output and Schema reference. Accessed 2 October 2026. https://ai.google.dev/gemini-api/docs/structured-output',
'Scikit-learn. Brier score loss documentation. Accessed 2 October 2026. https://scikit-learn.org/stable/modules/generated/sklearn.metrics.brier_score_loss.html']
for ref in refs:p(ref)
doc.save(out/'Adaptation_Benchmark_Research_Report.docx')
(out/'DEMONSTRATION.md').write_text('# Five minute demonstration\n\nOpen demo.html locally. No model calls or messages are needed.\n\n1. Explain fixed, rules interpreter and hybrid interpreter; downstream logic is shared.\n2. Show the real before/after timing figure, then expand time-1.\n3. Compare direct wording with paraphrases using the same expected state.\n4. Show nochange-negated and discuss deterministic fast-path limitations.\n5. Show api-attempts.jsonl failure status separately from valid model interpretations.\n6. Explain source snapshots, first-run scores, repeat consistency and limits.\n')
json_files=['results.json','presentation_metrics.json','before_after.png','demo.html','Adaptation_Benchmark_Research_Report.docx']
(out/'artifact_hashes.json').write_text(json.dumps({x:hashlib.sha256((out/x).read_bytes()).hexdigest() for x in json_files},indent=2)+'\n')
print(out/'Adaptation_Benchmark_Research_Report.docx')
