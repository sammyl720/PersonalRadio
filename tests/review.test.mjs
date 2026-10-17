import assert from "node:assert/strict";
import { test } from "vitest";
import { checkedReview, ReviewFormatError } from "../apps/worker/src/review.ts";

const chapters=[{ordinal:0},{ordinal:1},{ordinal:2},{ordinal:3}];

test("review keeps issues even when approval flag contradicts them",()=>{
 assert.deepEqual(checkedReview({approved:true,issues:[{chapterOrdinal:1,reason:"Unsupported claim."}]},chapters),[{chapterOrdinal:1,reason:"Unsupported claim."}]);
});

test("review combines duplicate chapter concerns without dropping either",()=>{
 const issues=checkedReview({approved:false,issues:[{chapterOrdinal:1,reason:"Unsupported claim."},{chapterOrdinal:1,reason:"Repetitive passage."}]},chapters);
 assert.deepEqual(issues,[{chapterOrdinal:1,reason:"Unsupported claim. Repetitive passage."}]);
});

test("review requests a correction when rejection has no actionable issue",()=>{
 assert.throws(()=>checkedReview({approved:false,issues:[]},chapters),(error)=>error instanceof ReviewFormatError&&error.reason.includes("concrete issue"));
});

test("review requests a correction for unknown chapter ordinals",()=>{
 assert.throws(()=>checkedReview({approved:false,issues:[{chapterOrdinal:4,reason:"Unsupported claim."}]},chapters),(error)=>error instanceof ReviewFormatError&&error.reason.includes("0, 1, 2, 3"));
});
