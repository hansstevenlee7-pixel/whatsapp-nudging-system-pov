"use strict";
const test=require("node:test");const assert=require("node:assert/strict");
const {classifyReply}=require("../api/_lib/reply-classifier");
test("Gemini fallback uses nullable scalar schema fields and parses a response",async t=>{
 const old=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY="test-only";
 t.after(()=>{if(old===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=old;});
 const result=await classifyReply("Condense future explanations into a few words.",{action_alternatives:[]},async(url,options)=>{
  const request=JSON.parse(options.body);const p=request.generationConfig.responseSchema.properties;
  for(const key of ["format","summary_length","tone","time","action"]){assert.equal(p[key].type,"string");assert.equal(p[key].nullable,true);}
  return new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({explicit:true,format:null,summary_length:"short",tone:null,time:null,frequency_delta:0,action:null})}]}}]}),{status:200});
 });assert.equal(result.summary_length,"short");assert.equal(result.explicit,true);
});
