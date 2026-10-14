export const WORDS_PER_MINUTE = 145;
export const CHARS_PER_WORD = 6;
export const PRICING_VERSION = "2026-10-11-owner-rate-v1";
export const deliveries = ["neutral", "warm", "curious", "playful", "thoughtful"] as const;
export type Delivery = typeof deliveries[number];

const deliveryTags:Record<Exclude<Delivery,"neutral">,string>={
  warm:"[warm, conversational]",
  curious:"[curious]",
  playful:"[lightly amused]",
  thoughtful:"[thoughtful, measured]"
};
const graveSubject=/\b(?:kill(?:ed|ing)?|death|dead|fatal(?:ity|ities)?|casualt(?:y|ies)|injur(?:y|ies|ed)|attack(?:s|ed)?|war|missile(?:s)?|bomb(?:s|ing|ed)?|shooting(?:s)?|violence|victim(?:s)?|traffick(?:ed|ing)?|abuse|terror(?:ism|ist)?|hostage(?:s)?|massacre|disaster)\b/i;
export function voiceText(text:string,delivery:Delivery|undefined,profile:"latest"|"economy"){
  if(profile!=="latest"||!delivery||delivery==="neutral")return text;
  const safeDelivery=delivery==="playful"&&graveSubject.test(text)?"thoughtful":delivery;
  return deliveryTags[safeDelivery]+" "+text;
}

export function estimateVoiceCharacters(minutes:number) { return Math.ceil(minutes*WORDS_PER_MINUTE*CHARS_PER_WORD); }
export function estimateEpisodeUsd(minutes:number, rate:number|null, reserve=0.2) {
  if (rate == null) return null;
  return Math.ceil(estimateVoiceCharacters(minutes)*rate/1000*(1+reserve)*100)/100;
}
export function countWords(text:string) { return (text.trim().match(/\b[\p{L}\p{N}][\p{L}\p{N}'’-]*\b/gu) ?? []).length; }
export function durationTempo(actualMs:number,targetMs:number):number{
  if(!Number.isFinite(actualMs)||!Number.isFinite(targetMs)||actualMs<=0||targetMs<=0)throw new Error("invalid_duration");
  if(actualMs>targetMs*1.15)return Math.min(1.15,actualMs/(targetMs*1.12));
  if(actualMs<targetMs*0.85)return Math.max(0.87,actualMs/(targetMs*0.88));
  return 1;
}
export function repeatedChapterOrdinals(chapters:{ordinal:number;spokenText:string}[],passageWords=40):number[]{
  const seen=new Map<string,{ordinal:number;offset:number}>(),repeated=new Set<number>();
  for(const chapter of chapters){
    const words=(chapter.spokenText.toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)??[]);
    for(let offset=0;offset+passageWords<=words.length;offset++){
      const passage=words.slice(offset,offset+passageWords).join(" ");
      const first=seen.get(passage);
      if(first&&(first.ordinal!==chapter.ordinal||offset-first.offset>=passageWords))repeated.add(chapter.ordinal);
      else if(!first)seen.set(passage,{ordinal:chapter.ordinal,offset});
    }
  }
  return [...repeated];
}
export function splitTurns<T extends {text:string; voiceId:string}>(turns:T[], maxCharacters=1700): T[][] {
  const result:T[][]=[]; let current:T[]=[]; let length=0;
  const flush=()=>{if(current.length){result.push(current);current=[];length=0;}};
  for(const turn of turns){
    const sentences=turn.text.match(/[^.!?]+[.!?]+(?:[”"']?\s*|$)|[^.!?]+$/g) ?? [turn.text];
    for(const sentence of sentences){
      const piece=sentence.trim(); if(!piece) continue;
      if(piece.length>maxCharacters) throw new Error("A sentence exceeds the synthesis chunk limit");
      if(length+piece.length>maxCharacters) flush();
      current.push({...turn,text:piece}); length+=piece.length;
    }
  }
  flush(); return result;
}
export function parseSingleRange(header:string|null, size:number):{start:number;end:number}|null|"invalid"{
  if(!header) return null;
  if(!/^bytes=\d*-\d*$/.test(header)) return "invalid";
  const [first,last]=header.slice(6).split("-");
  if(first==="" && last==="") return "invalid";
  let start:number,end:number;
  if(first==="") {const suffix=Number(last); if(!Number.isSafeInteger(suffix)||suffix<=0) return "invalid";start=Math.max(0,size-suffix);end=size-1;}
  else {start=Number(first);end=last===""?size-1:Number(last);}
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start) return "invalid";
  return {start,end:Math.min(end,size-1)};
}
export function sha256Hex(data:Uint8Array):Promise<string>{return crypto.subtle.digest("SHA-256",new Uint8Array(data)).then(hash=>Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,"0")).join(""));}
export function utf8(value:string){return new TextEncoder().encode(value);}
