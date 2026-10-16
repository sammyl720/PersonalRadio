import assert from "node:assert/strict";
import { test } from "vitest";
import { countWords, spokenMarkupIssue, spokenPacingIssues } from "../packages/content/src/index.ts";

const base=process.env.RADIO_TEST_BASE_URL;
const fixtureTest=base?test:test.skip;
fixtureTest("local fixture worker completes a private episode, playback, and answer",async()=>{
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
  const tuned=await call("settings","PATCH",{voiceUsdPerThousandCharacters:0.01,stylePreference:"lively"});
  assert.equal(tuned.data.settings.stylePreference,"lively");
  const invalidStyle=await call("settings","PATCH",{stylePreference:"make up the news"});assert.equal(invalidStyle.response.status,422);
  const personas=(await call("personas")).data.items;
  const anchor=personas.find(p=>p.name==="Calm Anchor"),guide=personas.find(p=>p.name==="Curious Guide"),companion=personas.find(p=>p.name==="Warm Companion");
  assert.ok(anchor&&guide&&companion);
  for(const [index,p] of [anchor,guide].entries()){const saved=await call("personas/"+p.id,"PATCH",{...p,voiceId:fixtureVoices[index].id});assert.equal(saved.response.status,200)}
  assert.equal((await call("personas/"+companion.id,"PATCH",{...companion,voiceId:null})).response.status,200);
  const configuredHosts=await call("personas");assert.equal(configuredHosts.data.fallbackVoiceId,fixtureVoices[0].id);
  const input={mode:"explainer",prompt:"Explain how a steam turbine converts heat into useful work (fixture review rewrite)",targetMinutes:10,primaryPersonaId:anchor.id,secondaryPersonaId:guide.id,language:"English",freshnessHours:24,sourceUrls:[],sourceNotes:"",voiceProfile:"latest",interactionEnabled:true};
  const key=crypto.randomUUID();let episodeId,doomedId,fallbackId,secondReviewId;
  try{
    const fallbackCreated=await call("episodes","POST",{...input,primaryPersonaId:companion.id,secondaryPersonaId:undefined,prompt:"Explain why steam turbines need a condenser (fallback voice fixture)"},{"Idempotency-Key":crypto.randomUUID()});
    assert.equal(fallbackCreated.response.status,202);fallbackId=fallbackCreated.data.episodeId;
    const fallbackDetail=(await call("episodes/"+fallbackId)).data;
    assert.equal(fallbackDetail.episode.personaSnapshot[0].name,"Warm Companion");
    assert.equal(fallbackDetail.episode.personaSnapshot[0].voiceId,fixtureVoices[0].id,"unconfigured host uses the owner's configured voice");
    const fallbackRemoved=await call("episodes/"+fallbackId,"DELETE",{});assert.equal(fallbackRemoved.response.status,202);
    for(let i=0;i<100;i++){if((await call("episodes/"+fallbackId)).response.status===404)break;await new Promise(resolve=>setTimeout(resolve,100))}
    assert.equal((await call("episodes/"+fallbackId)).response.status,404);fallbackId=undefined;
    const created=await call("episodes","POST",input,{"Idempotency-Key":key});assert.equal(created.response.status,202);episodeId=created.data.episodeId;
    const repeated=await call("episodes","POST",input,{"Idempotency-Key":key});assert.equal(repeated.data.jobId,created.data.jobId);
    const laterStyle=await call("settings","PATCH",{stylePreference:"deeper"});assert.equal(laterStyle.data.settings.stylePreference,"deeper");
    const snapshot=(await call("episodes/"+episodeId)).data;assert.equal(snapshot.episode.stylePreference,"lively","the episode keeps its creation-time style");
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
    assert.ok(detail.chapters.every(c=>c.turns.every(turn=>["neutral","warm","curious","playful","thoughtful"].includes(turn.delivery))),"delivery metadata survives the Site checkpoint");
    assert.ok(detail.chapters.every(c=>!c.spokenText.includes("[warm,")&&!c.spokenText.includes("[curious]")),"voice cues stay out of the transcript");
    assert.equal(detail.jobs[0].checkpoint.reviewResolved,true);
    assert.deepEqual([...detail.jobs[0].checkpoint.rewrittenOrdinals].sort(),[0,1,2]);
    assert.ok(detail.chapters.every(c=>c.turns.every(turn=>!spokenMarkupIssue(turn.text))),"review removes markup before voice synthesis");
    assert.ok(detail.chapters.every(c=>!spokenPacingIssues(c.turns,2).length&&c.turns.every(turn=>countWords(turn.text)<=260)),"chapters have bounded spoken beats with both hosts");
    assert.ok(detail.usage.some(event=>event.operation==="script_review_initial"));
    assert.ok(detail.usage.some(event=>event.operation==="chapter_rewrite"));
    assert.ok(detail.usage.some(event=>event.operation==="script_review_final"));
    const secondReview=await call("episodes","POST",{...input,prompt:"Explain why steam turbines need a condenser (fixture second review)",secondaryPersonaId:undefined},{"Idempotency-Key":crypto.randomUUID()});
    assert.equal(secondReview.response.status,202);secondReviewId=secondReview.data.episodeId;
    let revised;
    for(let i=0;i<100;i++){
      revised=(await call("episodes/"+secondReviewId)).data;
      if(revised.episode.state==="awaiting_approval")break;
      assert.notEqual(revised.episode.state,"failed",JSON.stringify(revised.jobs.at(-1)));
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    assert.equal(revised.episode.state,"awaiting_approval","a remaining final-review issue gets a second correction before paid speech");
    assert.equal(revised.jobs[0].checkpoint.reviewRound,1);
    assert.equal(revised.jobs[0].checkpoint.reviewResolved,true);
    assert.deepEqual(revised.jobs[0].checkpoint.reviewRemaining,[]);
    assert.equal(revised.usage.filter(event=>event.operation==="script_review_final").length,2);
    assert.equal(revised.usage.filter(event=>event.operation==="chapter_rewrite").length,2);
    assert.ok(revised.chapters[1].spokenText.includes("The second editorial pass corrected this chapter."));
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
    const concurrent=await Promise.all([2000,3000].map(positionMs=>call("episodes/"+episodeId+"/progress","PUT",{positionMs,speed:1,deviceSessionId:device,expectedRevision:1})));
    assert.deepEqual(concurrent.map(x=>x.response.status).sort(),[200,409]);
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
    const long=await call("episodes","POST",{...input,prompt:"Explain a steam turbine in a long fixture program",targetMinutes:60},{"Idempotency-Key":crypto.randomUUID()});
    assert.equal(long.response.status,202);doomedId=long.data.episodeId;
    let reachedVoice=false;
    for(let i=0;i<100;i++){
      const d=(await call("episodes/"+doomedId)).data;
      if(d.episode.state==="awaiting_approval"){
        const quote=d.jobs.find(x=>x.state==="awaiting_approval").checkpoint.quoteVersion;
        assert.equal((await call("episodes/"+doomedId+"/approve-cost","POST",{quoteVersion:quote})).response.status,202);
      }
      if(d.episode.state==="voicing"){reachedVoice=true;break}
      assert.notEqual(d.episode.state,"failed",JSON.stringify(d.jobs.at(-1)));
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    assert.ok(reachedVoice,"fixture episode reached synthesis before deletion");
    const removed=await call("episodes/"+doomedId,"DELETE",{});assert.equal(removed.response.status,202);
    let cleanupStatus;
    for(let i=0;i<100;i++){
      cleanupStatus=(await call("jobs/"+removed.data.jobId)).response.status;
      if(cleanupStatus===404)break;
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    assert.equal(cleanupStatus,404,"cleanup job and episode records were removed");
    assert.equal((await call("episodes/"+doomedId)).response.status,404);
  }finally{if(fallbackId)await call("episodes/"+fallbackId,"DELETE",{});if(episodeId)await call("episodes/"+episodeId,"DELETE",{});if(secondReviewId)await call("episodes/"+secondReviewId,"DELETE",{});if(doomedId)await call("episodes/"+doomedId,"DELETE",{});}
},180_000);
