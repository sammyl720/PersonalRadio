import assert from "node:assert/strict";
import test from "node:test";
import { OpenAIAdapter, ProviderError, retryAfterMs } from "../packages/providers/src/index.ts";

test("Retry-After accepts seconds and HTTP dates",()=>{
  const now=Date.parse("2026-10-12T18:00:00Z");
  assert.equal(retryAfterMs("3",now),3000);
  assert.equal(retryAfterMs("Mon, 12 Oct 2026 18:00:05 GMT",now),5000);
  assert.equal(retryAfterMs("invalid",now),null);
});

test("provider timeout is uncertain and a quota error is actionable",async()=>{
  const original=globalThis.fetch;
  try{
    globalThis.fetch=async(_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener("abort",()=>reject(new DOMException("Aborted","AbortError")),{once:true}));
    await assert.rejects(new OpenAIAdapter("fixture-key").generateStructured("x",{},"test",{timeoutMs:5}),error=>error instanceof ProviderError&&error.code==="provider_timeout"&&error.uncertain&&error.status===408);
    globalThis.fetch=async()=>new Response(JSON.stringify({error:{code:"insufficient_quota"}}),{status:429,headers:{"Retry-After":"2"}});
    await assert.rejects(new OpenAIAdapter("fixture-key").generateStructured("x",{},"test"),error=>error instanceof ProviderError&&error.code==="quota_exhausted"&&error.retryAfterMs===2000&&!error.uncertain);
  }finally{globalThis.fetch=original;}
});
