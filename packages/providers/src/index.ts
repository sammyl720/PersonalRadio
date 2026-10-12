export interface CallOptions { signal?:AbortSignal; timeoutMs?:number }
export interface ProviderResult<T> { data:T; requestId:string|null; usage:Record<string,number>; model:string }
export interface ResearchProvider { research(query:string, options?:CallOptions):Promise<ProviderResult<{text:string;sources:{url:string;title:string|null}[]}>> }
export interface TextProvider { generateStructured<T>(prompt:string, schema:object, name:string, options?:CallOptions):Promise<ProviderResult<T>> }
export interface SpeechProvider { synthesize(turns:{text:string;voiceId:string}[], profile:"latest"|"economy", options?:CallOptions):Promise<ProviderResult<Uint8Array>>;listVoices(options?:CallOptions):Promise<ProviderResult<{id:string;name:string;category:string|null;previewUrl:string|null}[]>> }
export interface TranscriptionProvider { transcribe(bytes:Uint8Array,mime:string,options?:CallOptions):Promise<ProviderResult<string>> }
export class ProviderError extends Error { usageRecorded=false; constructor(public provider:string,public status:number,public code:string,message:string,public requestId:string|null=null,public retryAfterMs:number|null=null,public uncertain=false){super(message)} }
function signalFor(options:CallOptions={}){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),options.timeoutMs??120000);options.signal?.addEventListener("abort",()=>controller.abort(),{once:true});return {signal:controller.signal,done:()=>clearTimeout(timer)}}
export function retryAfterMs(value:string|null,at=Date.now()){if(!value)return null;const seconds=Number(value),ms=Number.isFinite(seconds)?seconds*1000:Date.parse(value)-at;return Number.isFinite(ms)?Math.max(0,Math.min(3600000,Math.ceil(ms))):null;}
function providerFailure(provider:string,error:unknown,signal:AbortSignal):never{if(error instanceof ProviderError)throw error;throw new ProviderError(provider,signal.aborted?408:503,signal.aborted?"provider_timeout":"provider_network",signal.aborted?"Provider request timed out":"Provider connection failed",null,null,true);}
async function checked(response:Response,provider:string){if(!response.ok){const data=await response.text();let detail:any;try{detail=JSON.parse(data)}catch{}const reported=String(detail?.error?.code||detail?.detail?.status||"");const code=/quota|billing_hard_limit/i.test(reported)?"quota_exhausted":"provider_http_"+response.status;throw new ProviderError(provider,response.status,code,data.slice(0,300),response.headers.get("request-id")||response.headers.get("x-request-id"),retryAfterMs(response.headers.get("retry-after")));}return response;}
function outputText(response:any){return response.output_text||response.output?.flatMap((x:any)=>x.content||[]).filter((x:any)=>x.type==="output_text").map((x:any)=>x.text).join("")||""}
export class OpenAIAdapter implements ResearchProvider,TextProvider{
 constructor(private key:string,private researchModel="gpt-6-luna",private writingModel="gpt-6-luna"){}
 private async call(body:object,options:CallOptions){const t=signalFor(options);try{const r=await checked(await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{"Authorization":"Bearer "+this.key,"Content-Type":"application/json"},body:JSON.stringify(body),signal:t.signal}),"openai");return {value:await r.json() as any,requestId:r.headers.get("x-request-id")};}catch(error){providerFailure("openai",error,t.signal)}finally{t.done();}}
 async research(query:string,options:CallOptions={}):Promise<ProviderResult<{text:string;sources:{url:string;title:string|null}[]}>>{
  const {value,requestId}=await this.call({model:this.researchModel,reasoning:{effort:"low"},tools:[{type:"web_search"}],tool_choice:"required",include:["web_search_call.action.sources"],input:query},options);
  const sources=new Map<string,{url:string;title:string|null}>();
  for(const item of value.output||[]){
   for(const source of item.action?.sources||[]){if(source.url?.startsWith("https://"))sources.set(source.url,{url:source.url,title:source.title||null});}
   for(const content of item.content||[]){for(const a of content.annotations||[]){if(a.url?.startsWith("https://"))sources.set(a.url,{url:a.url,title:a.title||null});}}
  }
  return {data:{text:outputText(value),sources:[...sources.values()]},requestId:requestId||value.id||null,usage:{inputTokens:value.usage?.input_tokens||0,outputTokens:value.usage?.output_tokens||0},model:this.researchModel};
 }
 async generateStructured<T>(prompt:string,schema:object,name:string,options:CallOptions={}):Promise<ProviderResult<T>>{
  const {value,requestId}=await this.call({model:this.writingModel,reasoning:{effort:"low"},input:prompt,text:{format:{type:"json_schema",name,strict:true,schema}}},options);
  const text=outputText(value);if(!text)throw new ProviderError("openai",502,"empty_response","The model returned no text",requestId);
  return {data:JSON.parse(text) as T,requestId:requestId||value.id||null,usage:{inputTokens:value.usage?.input_tokens||0,outputTokens:value.usage?.output_tokens||0},model:this.writingModel};
 }
}
export class ElevenLabsAdapter implements SpeechProvider,TranscriptionProvider {
 constructor(private key:string,private latestModel="eleven_v4",private economyModel="eleven_flash_v2_5",private transcriptionModel="scribe_v2"){}
 async synthesize(turns:{text:string;voiceId:string}[],profile:"latest"|"economy",options:CallOptions={}):Promise<ProviderResult<Uint8Array>>{
  const t=signalFor(options);const model=profile==="latest"?this.latestModel:this.economyModel;
  try{
   let url:string,body:string;
   if(profile==="latest"){url="https://api.elevenlabs.io/v1/text-to-dialogue?output_format=mp3_44100_128";body=JSON.stringify({model_id:model,inputs:turns.map(x=>({text:x.text,voice_id:x.voiceId}))});}
   else {if(turns.some(x=>x.voiceId!==turns[0].voiceId))throw new ProviderError("elevenlabs",422,"economy_two_host","Economy voice requires one speaker per chunk");url="https://api.elevenlabs.io/v1/text-to-speech/"+encodeURIComponent(turns[0].voiceId)+"?output_format=mp3_44100_128";body=JSON.stringify({model_id:model,text:turns.map(x=>x.text).join(" ")})}
   const r=await checked(await fetch(url,{method:"POST",headers:{"xi-api-key":this.key,"Content-Type":"application/json"},body,signal:t.signal}),"elevenlabs");
   return {data:new Uint8Array(await r.arrayBuffer()),requestId:r.headers.get("request-id")||r.headers.get("x-request-id"),usage:{characters:turns.reduce((n,x)=>n+x.text.length,0)},model};
  }catch(error){providerFailure("elevenlabs",error,t.signal)}finally{t.done();}
 }
 async listVoices(options:CallOptions={}):Promise<ProviderResult<{id:string;name:string;category:string|null;previewUrl:string|null}[]>>{
  const t=signalFor(options);try{
   const r=await checked(await fetch("https://api.elevenlabs.io/v2/voices?page_size=100",{headers:{"xi-api-key":this.key},signal:t.signal}),"elevenlabs");
   const data=await r.json() as any;
   return {data:(data.voices||[]).map((v:any)=>({id:v.voice_id,name:v.name,category:v.category||null,previewUrl:v.preview_url||null})),requestId:r.headers.get("request-id"),usage:{},model:"voice_catalog"};
  }catch(error){providerFailure("elevenlabs",error,t.signal)}finally{t.done();}
 }
 async transcribe(bytes:Uint8Array,mime:string,options:CallOptions={}):Promise<ProviderResult<string>>{
  const t=signalFor(options);try{
   const form=new FormData();form.append("model_id",this.transcriptionModel);form.append("file",new Blob([bytes as any],{type:mime}),mime==="audio/mp4"?"question.m4a":"question.webm");
   const r=await checked(await fetch("https://api.elevenlabs.io/v1/speech-to-text",{method:"POST",headers:{"xi-api-key":this.key},body:form,signal:t.signal}),"elevenlabs");
   const data=await r.json() as any;return {data:data.text||"",requestId:r.headers.get("request-id"),usage:{seconds:0},model:this.transcriptionModel};
  }catch(error){providerFailure("elevenlabs",error,t.signal)}finally{t.done();}
 }
}
