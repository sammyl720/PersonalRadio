import assert from "node:assert/strict";
import { test } from "vitest";
import { needsVoiceApproval } from "../apps/worker/src/budget.ts";

test("voice synthesis requires an active reservation after a failed job",()=>{
 assert.equal(needsVoiceApproval(0.08,0.75,null,5,"quote-1","quote-1"),true);
 assert.equal(needsVoiceApproval(0.08,0.75,0.5,5,"quote-1","quote-1"),true);
 assert.equal(needsVoiceApproval(0.08,0.75,0.75,5,null,"quote-1"),false);
 assert.equal(needsVoiceApproval(0.08,0.75,0.75,0.5,"quote-1","quote-1"),false);
 assert.equal(needsVoiceApproval(0.08,0.75,0.75,0.5,null,"quote-1"),true);
});
