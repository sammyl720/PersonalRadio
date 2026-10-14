import { spawn } from "node:child_process";
import type { CallOptions, ProviderResult, ResearchProvider, SpeechProvider, TextProvider, TranscriptionProvider } from "../../../packages/providers/src/index.ts";
const example="A clear explanation starts with the central idea, then follows what causes it and what changes as a result. Consider a familiar everyday example. Each step leads naturally to the next, giving the listener a useful mental picture without forcing them to remember technical labels. A careful account also says where uncertainty remains, and why the distinction matters. In the end, the listener should understand how the pieces fit together and be able to explain the idea in plain language.";
function result<T>(data:T,model:string):ProviderResult<T>{return {data,model,requestId:"fixture",usage:{inputTokens:0,outputTokens:0}}}
export class FixtureOpenAI implements ResearchProvider,TextProvider{
 async research():Promise<ProviderResult<{text:string;sources:{url:string;title:string|null}[]}>>{return result({text:"Fixture research: no real news retrieval. This mode is for local testing only.",sources:[{url:"https://example.com/fixture-source",title:"Fixture source"}]},"fixture-research")}
 async generateStructured<T>(prompt:string,_schema:object,name:string):Promise<ProviderResult<T>>{
  if(name==="radio_outline"){const count=Number(prompt.match(/Return exactly (\d+) chapters/)?.[1]||4);return result({title:"Fixture program",chapters:Array.from({length:count},(_,i)=>({title:"Chapter "+(i+1),focus:"An illustrative step in the explanation"}))} as T,"fixture-writing")}
  if(name==="radio_review"){
   const needsRewrite=prompt.includes("fixture review rewrite")&&prompt.includes("Phase: initial");
   return result((needsRewrite?{approved:false,issues:[{chapterOrdinal:1,reason:"Fixture issue to exercise the bounded rewrite path."}]}:{approved:true,issues:[]}) as T,"fixture-review");
  }
  if(name==="radio_chapter"||name==="radio_chapter_rewrite"){
   const target=Number(prompt.match(/Aim for (\d+) spoken words/)?.[1]||400),words=example.split(/\s+/);
   const ordinal=Number(prompt.match(/Chapter ordinal: (\d+)/)?.[1]??Number(prompt.match(/Write chapter (\d+)/)?.[1]||1)-1);
   const blocks=Array.from({length:Math.ceil(target/22)},(_,segment)=>"In chapter "+(ordinal+1)+", example "+(segment+1)+", "+Array.from({length:18},(_,offset)=>words[(segment*18+offset)%words.length]).join(" ")+".");
   const personaCount=JSON.parse(prompt.match(/Personas: (\[[^\n]*\])/)?.[1]||"[]").length;
   const turns:{speaker:number;text:string;delivery:"curious"|"warm";sourceIds:string[]}[]=[];
   for(let start=0;start<blocks.length;start+=9){const beat=turns.length;turns.push({speaker:personaCount>1?beat%2:0,text:blocks.slice(start,start+9).join(" "),delivery:beat%2?"warm":"curious",sourceIds:[]})}
   if(name==="radio_chapter"&&ordinal===0&&prompt.includes("fixture review rewrite"))turns[0].text="[A source](https://example.com/report) explains the context. "+turns[0].text;
   if(name==="radio_chapter"&&ordinal===2&&prompt.includes("fixture review rewrite"))return result({title:"Fixture chapter",turns:[{speaker:0,text:blocks.join(" "),delivery:"curious",sourceIds:[]}]} as T,"fixture-writing");
   return result({title:"Fixture chapter",turns} as T,"fixture-writing")
  }
  return result({text:"This is a local fixture answer about the current chapter. It confirms that the saved question, response, and audio pipeline can complete without a paid provider call.",delivery:"warm"} as T,"fixture-writing");
 }
}
export class FixtureSpeech implements SpeechProvider,TranscriptionProvider{
 async synthesize(turns:{text:string;voiceId:string}[]):Promise<ProviderResult<Uint8Array>>{
  const bytes=await new Promise<Uint8Array>((resolve,reject)=>{const child=spawn("ffmpeg",["-hide_banner","-loglevel","error","-f","lavfi","-i","sine=frequency=220:duration=2","-ac","1","-b:a","96k","-f","mp3","pipe:1"]);const parts:Buffer[]=[];child.stdout.on("data",chunk=>parts.push(chunk));child.on("error",reject);child.on("close",code=>code===0?resolve(new Uint8Array(Buffer.concat(parts))):reject(new Error("fixture_audio_failed")))});
  return {...result(bytes,"fixture-voice"),usage:{characters:turns.reduce((n,turn)=>n+turn.text.length,0)}};
 }
 async listVoices(){return result([{id:"fixture-voice-a",name:"Fixture Voice A",category:"fixture",previewUrl:null},{id:"fixture-voice-b",name:"Fixture Voice B",category:"fixture",previewUrl:null}],"fixture-catalog")}
 async transcribe(){return result("What does the chapter mean?","fixture-scribe")}
}
