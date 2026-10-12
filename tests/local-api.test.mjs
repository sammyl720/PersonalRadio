import assert from "node:assert/strict";
import test from "node:test";

const base=process.env.RADIO_TEST_BASE_URL;
test("local fixture worker completes a private episode, playback, and answer",{skip:!base,timeout:180_000},async()=>{
  const origin=new URL(base);
  assert.ok(["localhost","127.0.0.1"].includes(origin.hostname),"Fixture test runs only on loopback");
  const login=await fetch(new URL("/signin-with-chatgpt?return_to=/",origin),{redirect:"manual"});
  assert.equal(login.status,302);
  const cookie=login.headers.get("set-cookie")?.split(";")[0];assert.ok(cookie);
  async function call(path,method="GET",body,headers={}){
    const response=await fetch(new URL("/api/"+path,origin),{method,headers:{Cookie:cookie,...body!==undefined?{"Content-Type":"application/json"}:{},...headers},body:body===undefined?undefined:JSON.stringify(body)});
    const data=await response.json().catch(()=>null);return {response,data};
  }
  const anonymous=await fetch(new URL("/api/episodes",origin));assert.equal(anonymous.status,401);
  const me=await call("me");assert.equal(me.response.status,200);
  const voices=await call("voices");const fixtureVoices=voices.data.items.filter(x=>x.id.startsWith("fixture-"));assert.ok(fixtureVoices.length>=2,"fixture worker must be running");
  await call("settings","PATCH",{voiceUsdPerThousandCharacters:0.01});
  const personas=(await call("personas")).data.items;assert.ok(personas.length>=2);
  for(const [index,p] of personas.slice(0,2).entries()){const saved=await call("personas/"+p.id,"PATCH",{...p,voiceId:fixtureVoices[index].id});assert.equal(saved.response.status,200)}
  const input={mode:"explainer",prompt:"Explain how a steam turbine converts heat into useful work (fixture review rewrite)",targetMinutes:10,primaryPersonaId:personas[0].id,secondaryPersonaId:personas[1].id,language:"English",freshnessHours:24,sourceUrls:[],sourceNotes:"",voiceProfile:"latest",interactionEnabled:true};
  const key=crypto.randomUUID();let episodeId;
  try{
    const created=await call("episodes","POST",input,{"Idempotency-Key":key});assert.equal(created.response.status,202);episodeId=created.data.episodeId;
    const repeated=await call("episodes","POST",input,{"Idempotency-Key":key});assert.equal(repeated.data.jobId,created.data.jobId);
    const conflict=await call("episodes","POST",{...input,prompt:"Another request with the same idempotency key"},{"Idempotency-Key":key});assert.equal(conflict.response.status,409);
    let detail;
    for(let i=0;i<100;i++){
      detail=(await call("episodes/"+episodeId)).data;
      if(detail.episode.state==="awaiting_approval"){
        const quote=detail.jobs.find(x=>x.state==="awaiting_approval").checkpoint.quoteVersion;
        const approved=await call("episodes/"+episodeId+"/approve-cost","POST",{quoteVersion:quote});assert.equal(approved.response.status,202);
      }
      if(detail.episode.state==="ready")break;
      assert.notEqual(detail.episode.state,"failed",JSON.stringify(detail.jobs.at(-1)));
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    assert.equal(detail.episode.state,"ready");assert.equal(detail.chapters.length,4);
    assert.equal(detail.jobs[0].checkpoint.reviewResolved,true);
    assert.deepEqual(detail.jobs[0].checkpoint.rewrittenOrdinals,[0]);
    assert.ok(detail.usage.some(event=>event.operation==="script_review_initial"));
    assert.ok(detail.usage.some(event=>event.operation==="chapter_rewrite"));
    assert.ok(detail.usage.some(event=>event.operation==="script_review_final"));
    assert.equal(detail.episode.personaSnapshot.length,2);
    assert.notEqual(detail.episode.personaSnapshot[0].voiceId,detail.episode.personaSnapshot[1].voiceId);
    assert.ok(detail.chapters.some(c=>c.turns.some(turn=>turn.speaker===1)),"the second host speaks");
    assert.ok(detail.usage.some(event=>event.operation==="speech"&&event.estimated_usd>0));
    const asset="assets/"+detail.episode.finalAssetId+"/audio";
    const unauthAudio=await fetch(new URL("/api/"+asset,origin));assert.equal(unauthAudio.status,401);
    const head=await fetch(new URL("/api/"+asset,origin),{method:"HEAD",headers:{Cookie:cookie}});assert.equal(head.status,200);assert.ok(Number(head.headers.get("content-length"))>100);
    const suffix=await fetch(new URL("/api/"+asset,origin),{headers:{Cookie:cookie,Range:"bytes=-100"}});assert.equal(suffix.status,206);assert.equal((await suffix.arrayBuffer()).byteLength,100);
    const invalid=await fetch(new URL("/api/"+asset,origin),{headers:{Cookie:cookie,Range:"bytes=0-1,3-4"}});assert.equal(invalid.status,416);
    const before=(await call("episodes/"+episodeId)).data.usage.length;
    await fetch(new URL("/api/"+asset,origin),{method:"HEAD",headers:{Cookie:cookie}});
    const after=(await call("episodes/"+episodeId)).data.usage.length;assert.equal(after,before,"replay makes no provider call");
    const device=crypto.randomUUID();const saved=await call("episodes/"+episodeId+"/progress","PUT",{positionMs:1000,speed:1,deviceSessionId:device,expectedRevision:0});assert.equal(saved.data.revision,1);
    const stale=await call("episodes/"+episodeId+"/progress","PUT",{positionMs:2000,speed:1,deviceSessionId:device,expectedRevision:0});assert.equal(stale.response.status,409);
    const question=await call("episodes/"+episodeId+"/questions","POST",{text:"What does the first chapter explain?",anchorMs:1000,chapterId:detail.chapters[0].id});assert.equal(question.response.status,202);
    let answer;
    for(let i=0;i<40;i++){
      answer=(await call("jobs/"+question.data.jobId)).data;
      if(answer.job.state==="completed")break;
      assert.notEqual(answer.job.state,"failed",answer.job.error_code);
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    assert.equal(answer.job.state,"completed");
    const conversation=(await call("episodes/"+episodeId+"/conversation")).data.items;
    assert.ok(conversation.some(x=>x.role==="assistant"&&x.asset_id));
  }finally{if(episodeId)await call("episodes/"+episodeId,"DELETE",{});}
});
