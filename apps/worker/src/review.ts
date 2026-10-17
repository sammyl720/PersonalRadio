export type ReviewIssue={chapterOrdinal:number;reason:string};

export class ReviewFormatError extends Error{
 constructor(reason:string){super("invalid_review");this.name="ReviewFormatError";this.reason=reason;}
 reason:string;
}

export function checkedReview(value:unknown,chapters:{ordinal:number}[]):ReviewIssue[]{
 const fail=(reason:string):never=>{throw new ReviewFormatError(reason)};
 if(!value||typeof value!=="object")return fail("Return an object with approved and issues.");
 const review=value as {approved?:unknown;issues?:unknown};
 if(typeof review.approved!=="boolean"||!Array.isArray(review.issues))return fail("Return a boolean approved and an array of issues.");
 const ordinals=new Set(chapters.map(chapter=>chapter.ordinal));
 const grouped=new Map<number,string[]>();
 if(review.issues.length>20)return fail("Return no more than 20 specific issues, grouped by chapter.");
 for(const issue of review.issues){
  if(!issue||typeof issue!=="object")return fail("Each issue needs a chapterOrdinal and a reason.");
  const {chapterOrdinal,reason}=issue as {chapterOrdinal?:unknown;reason?:unknown};
  if(!Number.isInteger(chapterOrdinal)||!ordinals.has(chapterOrdinal as number))return fail("Use only these chapter ordinals: "+[...ordinals].join(", ")+".");
  if(typeof reason!=="string"||!reason.trim()||reason.length>500)return fail("Give every issue a nonempty reason of at most 500 characters.");
  const reasons=grouped.get(chapterOrdinal as number)||[];
  if(!reasons.includes(reason.trim()))reasons.push(reason.trim());
  grouped.set(chapterOrdinal as number,reasons);
 }
 if(!grouped.size&&!review.approved)return fail("If approved is false, explain at least one concrete issue; otherwise set approved to true.");
 const issues=[...grouped].map(([chapterOrdinal,reasons])=>({chapterOrdinal,reason:reasons.join(" ")}));
 if(issues.some(issue=>issue.reason.length>2000))return fail("Combine the concerns for each chapter into one reason of at most 2,000 characters.");
 return issues;
}
