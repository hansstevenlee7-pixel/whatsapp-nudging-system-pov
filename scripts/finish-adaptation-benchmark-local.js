"use strict";
// Finish only work that cannot call Gemini after provider quota exhaustion.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {cases}=require('./adaptation-benchmark/cases');
const {execute}=require('./adaptation-benchmark/engine');
const {explicitInterpretation}=require('../landing/api/_lib/adaptive-core');
const {summarize}=require('./adaptation-benchmark/run');
const root=path.resolve(__dirname,'..');const out=path.resolve(root,process.argv[2]);
const manifest=JSON.parse(fs.readFileSync(path.join(out,'manifest.json')));
for(const [file,hash]of Object.entries(manifest.configuration.source_hashes))if(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')!==hash)throw new Error('Frozen source changed: '+file);
(async()=>{
 const missing=[];
 for(const c of cases)for(const arm of ['fixed','rules','hybrid']){
  const file=path.join(out,'traces',`${c.id}--${arm}--1.json`);if(fs.existsSync(file))continue;
  const needsModel=c.events.some(e=>e.body!=null&&e.body!=='STOP'&&!explicitInterpretation(e.body).explicit);
  if(arm==='hybrid'&&needsModel){missing.push({case_id:c.id,reason:'Daily Gemini quota exhausted; not evaluated'});continue;}
  const trace=await execute(c,arm,async()=>{throw new Error('No network authorized in local completion');});trace.repeat=1;
  fs.writeFileSync(file,JSON.stringify(trace,null,2)+'\n');console.log(`${arm} ${c.id}: ${trace.success?'PASS':'FAIL'}`);
 }
 fs.writeFileSync(path.join(out,'pending-hybrid.json'),JSON.stringify({reason:'Gemini GenerateRequestsPerDayPerProjectPerModel-FreeTier limit 20 reached; do not interpret missing or fallback outcomes as model accuracy',missing_first_runs:missing},null,2)+'\n');
 const r=summarize(out);console.log(JSON.stringify({status:r.status,rows:r.rows,api:r.api}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
