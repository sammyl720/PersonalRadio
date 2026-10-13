import assert from "node:assert/strict";
import { test } from "vitest";
import { OpenAIAdapter, ProviderError, researchSources, retryAfterMs } from "../packages/providers/src/index.ts";

test("research keeps evidence citations instead of unrelated search results",()=>{
  const output=[
    {action:{sources:[{url:"https://example.com/archive/2026",title:"Archive"},{url:"https://example.com/news/story",title:"Story"}]}},
    {content:[{annotations:[{url:"https://example.com/news/story",title:"Direct report"},{url:"https://official.example/press/statement",title:"Statement"}]}]}
  ];
  assert.deepEqual(researchSources(output),[
    {url:"https://example.com/news/story",title:"Direct report"},
    {url:"https://official.example/press/statement",title:"Statement"}
  ]);
  assert.deepEqual(researchSources([output[0]]),[
    {url:"https://example.com/news/story",title:"Story"}
  ]);
  assert.deepEqual(researchSources([{action:{sources:[
    {url:"https://wspartners.bbc.com/schedules/bbc_world_service_europe/week/2026-10-10"},
    {url:"https://www.theguardian.com/world/2026/oct/13/all"},
    {url:"https://about.fb.com/news/page/189/?utm_source=openai"},
    {url:"https://apnews.com/article/23aa01c0c6922fbf0b564a0ff9b2c8e5"},
    {url:"https://mediacenter.imf.org/press-briefings/financial-stability-report"},
    {url:"https://www.reddit.com/r/news/comments/example"}
  ]}}]),[
    {url:"https://apnews.com/article/23aa01c0c6922fbf0b564a0ff9b2c8e5",title:null},
    {url:"https://mediacenter.imf.org/press-briefings/financial-stability-report",title:null}
  ]);
});

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
