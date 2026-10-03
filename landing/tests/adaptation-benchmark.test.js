"use strict";
const test=require("node:test");const assert=require("node:assert/strict");
const {database}=require("../../scripts/adaptation-benchmark/local-store");
const {cases}=require("../../scripts/adaptation-benchmark/cases");
const {execute}=require("../../scripts/adaptation-benchmark/engine");
test("local PostgREST emulator preserves processed duplicate events and filters pending rows",async()=>{
 const db=database({interaction_events:[]});const u="https://benchmark.invalid/rest/v1/interaction_events?on_conflict=interaction_id";
 const req={method:"POST",headers:{prefer:"resolution=ignore-duplicates"},body:JSON.stringify({interaction_id:"a",processed_at:null,event_type:"inbound_reply"})};
 await db.fetch(u,req);await db.fetch("https://benchmark.invalid/rest/v1/interaction_events?interaction_id=eq.a",{method:"PATCH",body:JSON.stringify({processed_at:"done"})});
 assert.deepEqual(await (await db.fetch(u,req)).json(),[]);
 assert.deepEqual(await(await db.fetch("https://benchmark.invalid/rest/v1/interaction_events?processed_at=is.null&event_type=in.(inbound_reply,link_visit)")).json(),[]);
 await assert.rejects(db.fetch("https://production.example/rest/v1/interaction_events"),/rejected/);
});
test("benchmark specification has unique balanced cases and labels independent of application outputs",()=>{
 assert.equal(cases.length,24);assert.equal(new Set(cases.map(c=>c.id)).size,24);
 for(const [category,n]of Object.entries({supported:12,no_change:4,boundary:4,operational:4}))assert.equal(cases.filter(c=>c.category===category).length,n);
});
test("harness blocks external fetches and fixed arm cannot accidentally adapt",async()=>{
 const c={id:"harness-smoke",category:"test",events:[{body:"I prefer videos",interpretation:{},expected:{time:"09:00",frequency:2,format:"paper",summary:"detailed"}}]};
 const r=await execute(c,"fixed",()=>{throw new Error("Forbidden network");});
 assert.deepEqual(r.errors,[]);assert.equal(r.steps[0].observed.format,"paper");assert.equal(r.steps[0].prepared.status,200);assert.equal(r.api_calls,0);
 assert.equal(r.steps[0].checks.sent_nudge_unchanged,true);
});
