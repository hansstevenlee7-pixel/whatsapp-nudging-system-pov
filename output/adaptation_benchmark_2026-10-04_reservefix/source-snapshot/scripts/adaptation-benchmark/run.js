"use strict";
const fs = require("node:fs"); const path = require("node:path"); const crypto = require("node:crypto"); const cp = require("node:child_process");
const { performance } = require("node:perf_hooks");
const { cases } = require("./cases"); const { execute, makeSeed, NOW } = require("./engine");
const { loadKey } = require("../frequency-comparison/gemini");
const ROOT = path.resolve(__dirname, "../..");
const sha = x => crypto.createHash("sha256").update(x).digest("hex");
const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
function sourceFiles(dir) { return fs.readdirSync(path.join(ROOT,dir), {withFileTypes:true}).flatMap(e=>e.isDirectory()?sourceFiles(`${dir}/${e.name}`): /\.(js|json|md)$/.test(e.name)?[`${dir}/${e.name}`]:[]); }
function sources() { return [...sourceFiles("scripts/adaptation-benchmark"), ...sourceFiles("landing/api"), "landing/tests/sheets-fixture.js", "scripts/frequency-comparison/gemini.js", "INSTRUCTIONS.md", "landing/package.json"].sort(); }
const ARMS = ["fixed", "rules", "hybrid"];
function summarize(out) {
  const traces = fs.readdirSync(path.join(out,"traces")).filter(f=>f.endsWith(".json")).map(f=>JSON.parse(fs.readFileSync(path.join(out,"traces",f))));
  const first = traces.filter(t=>t.repeat===1); const rows = ARMS.map(arm=> {
    const ts=first.filter(t=>t.arm===arm); const supported=ts.filter(t=>t.category==="supported"); const nc=ts.filter(t=>t.category==="no_change");
    const ints=ts.flatMap(t=>t.steps.filter(s=>typeof s.interpretation_correct==="boolean"));
    return { arm, completed:ts.length, success:ts.filter(t=>t.success).length, total:cases.length,
      supported_success:supported.filter(t=>t.success).length, supported_total:supported.length,
      no_change_failures:nc.filter(t=>t.steps.some(s=>s.checks.unrelated_preferences_preserved===false || ["time","frequency","format","summary"].some(k=>s.checks[`expected_${k}`]===false))).length, no_change_total:nc.length,
      constraint_violations:ts.reduce((s,t)=>s+t.constraint_violations.length,0), interpretation_correct:ints.filter(s=>s.interpretation_correct).length, interpretation_total:ints.length,
      mean_local_ms:ts.reduce((s,t)=>s+t.local_ms,0)/(ts.length||1),
      categories:Object.fromEntries(["supported","no_change","boundary","operational"].map(cat=>[cat,{success:ts.filter(t=>t.category===cat&&t.success).length,total:ts.filter(t=>t.category===cat).length}])) };
  });
  const paired=cases.map(c=>({case_id:c.id,category:c.category,...Object.fromEntries(ARMS.map(a=>[a,first.find(t=>t.arm===a&&t.case_id===c.id)?.success ?? null]))}));
  const pairedComplete=paired.filter(p=>p.rules!==null&&p.hybrid!==null);
  const callsFile=path.join(out,"api-attempts.jsonl"); const attempts=fs.existsSync(callsFile)?fs.readFileSync(callsFile,"utf8").trim().split("\n").filter(Boolean).map(JSON.parse):[];
  const repeated=cases.map(c=>traces.filter(t=>t.case_id===c.id&&t.arm==="hybrid")).filter(ts=>ts.some(t=>t.api_calls>0));
  const complete = rows.every(r=>r.completed===24) && repeated.every(ts=>ts.length===3);
  const result={status:complete?"COMPLETE":"INCOMPLETE", rows, paired, hybrid_minus_rules_percentage_points:pairedComplete.length?100*pairedComplete.reduce((s,p)=>s+Number(p.hybrid)-Number(p.rules),0)/pairedComplete.length:null,
    primary:"first execution of each case; repeats reported separately", repeat_consistency:{all_three_success:repeated.filter(ts=>ts.length===3&&ts.every(t=>t.success)).length,completed_three:repeated.filter(ts=>ts.length===3).length,eligible:repeated.length},
    api:{attempts:attempts.length,successful_http:attempts.filter(a=>a.status===200).length,failed_attempts:attempts.filter(a=>a.status!==200).length,
      invalid_payloads:attempts.filter(a=>a.valid_json===false&&a.status===200).length,prompt_tokens:attempts.reduce((s,a)=>s+(a.usage?.promptTokenCount||0),0),output_tokens:attempts.reduce((s,a)=>s+(a.usage?.candidatesTokenCount||0),0),thought_tokens:attempts.reduce((s,a)=>s+(a.usage?.thoughtsTokenCount||0),0),latency_ms:attempts.reduce((s,a)=>s+(a.elapsed_ms||0),0)},
    failures:traces.filter(t=>!t.success).map(t=>({case_id:t.case_id,arm:t.arm,repeat:t.repeat,failed_checks:t.failed_checks,errors:t.errors}))};
  json(path.join(out,"results.json"),result);
  const table=rows.map(r=>`| ${r.arm} | ${r.success}/${r.completed} | ${r.supported_success}/${r.supported_total} | ${r.no_change_failures}/${r.no_change_total} | ${r.constraint_violations} |`).join("\n");
  fs.writeFileSync(path.join(out,"per_case.csv"),"case_id,category,fixed,rules,hybrid\n"+paired.map(p=>[p.case_id,p.category,p.fixed,p.rules,p.hybrid].join(",")).join("\n")+"\n");
  fs.writeFileSync(path.join(out,"REPORT.md"),`# Bounded adaptation benchmark\n\nStatus: **${result.status}**. Local synthetic evaluation; no WhatsApp messages sent.\n\n| Arm | Task success | Supported requests | Unnecessary changes | Constraint violations |\n|---|---:|---:|---:|---:|\n${table}\n\nHybrid minus rules: ${result.hybrid_minus_rules_percentage_points?.toFixed(2)} percentage points on ${pairedComplete.length} paired cases. Repeat consistency: ${result.repeat_consistency.all_three_success}/${result.repeat_consistency.completed_three} cases succeeded in all three fresh runs.\n\nAPI attempts: ${result.api.attempts}; non-200/network failures: ${result.api.failed_attempts}; invalid JSON payloads: ${result.api.invalid_payloads}; prompt/output/thought tokens: ${result.api.prompt_tokens}/${result.api.output_tokens}/${result.api.thought_tokens}. The application can silently fall back to rules on provider errors; HTTP success is not evidence of model benefit.\n\n## Interpretation boundaries\n\nThe rules and hybrid arms differ only in reply interpretation. Both use the same existing downstream frozen logistic frequency policy and safety logic. Fixed retains initial preferences and skips automatic policy evaluation but shares STOP, consent, approved resources and delivery preparation. This is not a comparison of entirely model-free software against AI.\n\nCases were authored from requirements by the implementer, not independently adjudicated. Scores describe this deliberately selected suite, not a population. Direct phrases may overlap existing rules; paraphrases are not claimed to be representative or statistically independent. Three repetitions measure observed stability, not population reliability. No significance or equivalence claim follows.\n\nActual application inbound, interpretation, decision persistence, frequency worker, schedule application and delivery preparation run against local Sheets and minimal PostgREST emulators. Cloud persistence, concurrency, real delivery, and clinical benefit remain untested. History protection excludes legitimate inbound audit fields (interacted_at, last_inbound_message_sid, last_updated). Missing read evidence remains unknown; permitted rotation is not treated as clinical inference.\n\n## Failures\n\n${result.failures.map(f=>`- ${f.arm}/${f.case_id}/run-${f.repeat}: ${f.failed_checks.concat(f.errors).join("; ")}`).join("\n") || "None observed."}\n\n## Research grounding\n\nHevner et al. (2004), Design Science in Information Systems Research, MIS Quarterly 28(1), 75–105. https://doi.org/10.2307/25148625\n\nVenable, Pries-Heje and Baskerville (2016), FEDS, European Journal of Information Systems 25, 77–89. https://doi.org/10.1057/ejis.2014.36\n\nNahum-Shani et al. (2018), Just-in-Time Adaptive Interventions in Mobile Health, Annals of Behavioral Medicine 52(6), 446–462. https://doi.org/10.1007/s12160-016-9830-8\n\nYao et al. (2024), tau-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains. https://arxiv.org/abs/2406.12045 . Final-state evaluation is the methodological precedent; this is not a tau-bench run or leaderboard-comparable score.\n`);
  return result;
}
async function main() {
  const args=process.argv.slice(2); const out=path.resolve(ROOT,args.includes("--out")?args[args.indexOf("--out")+1]:"output/adaptation_benchmark_2026-10-02");
  if(args.includes("--report-only")){ console.log(JSON.stringify(summarize(out).rows)); return; }
  const live=args.includes("--live"); const model="gemini-2.5-flash"; const apiKey=live?loadKey(ROOT):null;
  if(live&&!apiKey) throw new Error("Gemini key unavailable; no hybrid result will be fabricated");
  process.env.GEMINI_CLASSIFIER_MODEL=model;
  if(apiKey) process.env.GEMINI_API_KEY=apiKey;
  const config={version:2,model,temperature:0,api_attempt_cap:56,prior_diagnostic_attempts:4,repetitions:3,simulated_now:NOW,live,source_hashes:Object.fromEntries(sources().map(f=>[f,sha(fs.readFileSync(path.join(ROOT,f)))]))};
  const configHash=sha(JSON.stringify(config)); fs.mkdirSync(path.join(out,"traces"),{recursive:true});
  const manifestPath=path.join(out,"manifest.json");
  if(fs.existsSync(manifestPath)) { if(JSON.parse(fs.readFileSync(manifestPath)).configuration_sha256!==configHash) throw new Error("Frozen configuration mismatch; use a new output directory"); }
  else {
    json(manifestPath,{created_at:new Date().toISOString(),configuration_sha256:configHash,configuration:config,node:process.version,git_commit:cp.execFileSync("git",["rev-parse","HEAD"],{cwd:ROOT,encoding:"utf8"}).trim(),working_tree:"dirty; exact source snapshot is authoritative"});
    json(path.join(out,"cases.json"),cases.map(c=>({...c,initial_state:makeSeed(c)})));
    for(const file of Object.keys(config.source_hashes)){ const target=path.join(out,"source-snapshot",file); fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(ROOT,file),target); }
  }
  if(args.includes("--freeze-only")){console.log("Protocol and source snapshot frozen: "+out);return;}
  const attemptsFile=path.join(out,"api-attempts.jsonl");
  let attemptCount=fs.existsSync(attemptsFile)?fs.readFileSync(attemptsFile,"utf8").trim().split("\n").filter(Boolean).length:0;
  const transport=global.fetch; let lastAttempt=0; let current;
  const apiFetch=async(url,options)=>{
    const pause=Math.max(0,13000-(performance.now()-lastAttempt));if(pause)await new Promise(r=>setTimeout(r,pause));
    if(attemptCount>=56) return new Response(JSON.stringify({error:"Benchmark API cap reached"}),{status:429});
    const record={attempt:++attemptCount, ...current, request:JSON.parse(options.body), started_at:new Date().toISOString()};
    // Write an attempt reservation before I/O so interruption cannot silently reset the cap.
    fs.appendFileSync(attemptsFile,JSON.stringify({...record,status:"pending"})+"\n");
    const t=performance.now();lastAttempt=t; let response;
    try {
      response=await transport(url,{...options,signal:AbortSignal.timeout(45000)});
      record.status=response.status; const raw=await response.text(); record.raw_response=raw.replace(/AIza[\w-]+/g,"[redacted]");
      try{const p=JSON.parse(raw);record.usage=p.usageMetadata;record.model_version=p.modelVersion;try{JSON.parse(p.candidates[0].content.parts[0].text);record.valid_json=true;}catch{record.valid_json=false;}}catch{record.valid_json=false;}
      response=new Response(raw,{status:response.status,headers:{"content-type":"application/json"}});
    }catch{record.status="network_error";response=new Response(JSON.stringify({error:"Network request failed"}),{status:503});}
    record.elapsed_ms=performance.now()-t;
    const lines=fs.readFileSync(attemptsFile,"utf8").trim().split("\n");lines[record.attempt-1]=JSON.stringify(record);fs.writeFileSync(attemptsFile,lines.join("\n")+"\n");
    return response;
  };
  for(const c of cases) for(const arm of live?ARMS:ARMS.slice(0,2)) {
    const firstFile=path.join(out,"traces",`${c.id}--${arm}--1.json`);
    let first=fs.existsSync(firstFile)?JSON.parse(fs.readFileSync(firstFile)):null;
    for(let repeat=1;repeat<=(arm==="hybrid"&&first?.api_calls>0?3:1);repeat++) {
      const file=path.join(out,"traces",`${c.id}--${arm}--${repeat}.json`);
      if(fs.existsSync(file)){if(repeat===1)first=JSON.parse(fs.readFileSync(file));continue;}
      current={case_id:c.id,arm,repeat}; const trace=await execute(c,arm,apiFetch);trace.repeat=repeat;json(file,trace);if(repeat===1)first=trace;
      console.log(`${arm} ${c.id} run ${repeat}: ${trace.success?"PASS":"FAIL"}${trace.errors.length?" "+trace.errors.join("; "):""}`);
      summarize(out);
    }
  }
  const result=summarize(out);console.log(JSON.stringify({status:result.status,rows:result.rows,api:result.api}));
}
if(require.main===module)main().catch(error=>{console.error(String(error.message).replace(/AIza[\w-]+/g,"[redacted]"));process.exitCode=1;});
module.exports={summarize};
