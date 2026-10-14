import assert from "node:assert/strict";
import { test } from "vitest";
import { estimateEpisodeUsd, estimateVoiceCharacters, parseSingleRange, splitTurns, countWords, durationTempo, repeatedChapterOrdinals, readableTranscriptText, spokenMarkupIssue, voiceText } from "../packages/content/src/index.ts";

test("small tempo correction brings speech inside the duration tolerance",()=>{
  assert.equal(durationTempo(600000,600000),1);
  assert.equal(durationTempo(690000,600000),1);
  assert.ok(durationTempo(703280,600000)>1&&703280/durationTempo(703280,600000)<690000);
  assert.ok(durationTempo(480000,600000)<1&&480000/durationTempo(480000,600000)>510000);
});
import { createEpisodeSchema, settingsPatchSchema } from "../packages/contracts/src/index.ts";

test("voice estimate includes the retry reserve and preserves an unknown rate", () => {
  assert.equal(estimateVoiceCharacters(10), 8700);
  assert.equal(estimateEpisodeUsd(10, 0.01), 0.11);
  assert.equal(estimateEpisodeUsd(10, null), null);
});

test("single byte ranges handle seeking, suffixes, and invalid input", () => {
  assert.deepEqual(parseSingleRange("bytes=10-19", 100), {start:10,end:19});
  assert.deepEqual(parseSingleRange("bytes=95-", 100), {start:95,end:99});
  assert.deepEqual(parseSingleRange("bytes=-10", 100), {start:90,end:99});
  assert.equal(parseSingleRange("bytes=100-", 100), "invalid");
  assert.equal(parseSingleRange("bytes=20-10", 100), "invalid");
  assert.equal(parseSingleRange("bytes=0-1,5-6", 100), "invalid");
});

test("speech chunks preserve voices and respect the character ceiling", () => {
  const turns=[{voiceId:"host",text:"First sentence. Second sentence!"},{voiceId:"guest",text:"A reply?"}];
  const chunks=splitTurns(turns, 23);
  assert.ok(chunks.length>1);
  assert.ok(chunks.every(chunk=>chunk.reduce((n,turn)=>n+turn.text.length,0)<=23));
  assert.deepEqual(chunks.flat().map(turn=>turn.voiceId),["host","host","guest"]);
  assert.throws(()=>splitTurns([{voiceId:"host",text:"A sentence that is much too long."}],10));
  assert.equal(countWords("one two three"),3);
});

test("voice direction stays out of the transcript and avoids playful delivery for harm",()=>{
  const line="That shortcut is a tiny gift to your future self.";
  assert.equal(voiceText(line,"playful","latest"),"[lightly amused] "+line);
  assert.equal(voiceText(line,"playful","economy"),line);
  assert.equal(voiceText("The attack injured civilians.","playful","latest"),"[thoughtful, measured] The attack injured civilians.");
});

test("spoken scripts reject citation markup and old transcripts show readable labels",()=>{
  const marked="SecurityWeek [reported](https://example.com/report) the incident.";
  assert.match(spokenMarkupIssue(marked),/Markdown links/);
  assert.equal(readableTranscriptText(marked),"SecurityWeek reported the incident.");
  assert.match(spokenMarkupIssue("See www.example.com for details."),/web addresses/);
  assert.match(spokenMarkupIssue("[pause] Let's continue."),/stage directions/);
  assert.equal(spokenMarkupIssue("As SecurityWeek reported, the company confirmed the incident."),null);
});

test("long repeated spoken passages are attributed to the later chapter", () => {
  const words=Array.from({length:45},(_,i)=>`word${i}`).join(" ");
  assert.deepEqual(repeatedChapterOrdinals([
    {ordinal:0,spokenText:`Opening. ${words}`},
    {ordinal:1,spokenText:`A new introduction. ${words.toUpperCase()}!`}
  ]),[1]);
  assert.deepEqual(repeatedChapterOrdinals([
    {ordinal:0,spokenText:"Welcome back. Here is a short transition."},
    {ordinal:1,spokenText:"Welcome back. Here is a different argument."}
  ]),[]);
  assert.deepEqual(repeatedChapterOrdinals([{ordinal:0,spokenText:`${words}. ${words}`}]),[0]);
});

test("episode input rejects duplicate hosts and out of range duration", () => {
  const id="11111111-1111-4111-8111-111111111111";
  const base={mode:"explainer",prompt:"Explain a useful topic",targetMinutes:10,primaryPersonaId:id};
  assert.equal(createEpisodeSchema.safeParse(base).success,true);
  assert.equal(createEpisodeSchema.safeParse({...base,secondaryPersonaId:id}).success,false);
  assert.equal(createEpisodeSchema.safeParse({...base,targetMinutes:15}).success,false);
  assert.equal(settingsPatchSchema.safeParse({monthlyBudgetUsd:-1}).success,false);
});
