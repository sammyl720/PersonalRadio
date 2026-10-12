import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../app/chatgpt-auth";
import { errorBody } from "../../../packages/contracts/src/index";
import { estimateEpisodeUsd, PRICING_VERSION, sha256Hex, utf8 } from "../../../packages/content/src/index";

export type Row = Record<string, unknown>;
export const now=()=>new Date().toISOString();
export const rid=()=>crypto.randomUUID();
export const db=():D1Database=>{if(!env.DB) throw new Error("D1 binding is unavailable"); return env.DB;};
export const bucket=():R2Bucket=>{if(!env.BUCKET) throw new Error("R2 binding is unavailable"); return env.BUCKET;};
export async function one(sql:string,...args:unknown[]):Promise<any>{return db().prepare(sql).bind(...args).first();}
export async function all(sql:string,...args:unknown[]):Promise<any[]>{return (await db().prepare(sql).bind(...args).all()).results as any[];}
export async function run(sql:string,...args:unknown[]){return db().prepare(sql).bind(...args).run();}
export function j(value:unknown){return JSON.stringify(value);}
export function parsed<T>(value:unknown, fallback:T):T{try{return typeof value==="string"?JSON.parse(value) as T:fallback;}catch{return fallback;}}
export function reply(data:unknown,status=200,headers:Record<string,string>={}){return Response.json(data,{status,headers:{"Cache-Control":"private, no-store",...headers}});}
export function fail(code:string,message:string,status=400,retryable=false){return reply(errorBody(code,message,retryable),status);}
export class ApiError extends Error{constructor(public code:string,public status:number,message:string,public retryable=false){super(message);}}
export function enforceOrigin(request:Request){const origin=request.headers.get("origin");if(origin&&origin!==new URL(request.url).origin)throw new ApiError("invalid_origin",403,"Request origin is not allowed");}
export function enforceJson(request:Request){if(!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))throw new ApiError("invalid_content_type",415,"Expected application/json");}
export async function bodyJson(request:Request,limit=60_000){enforceJson(request);const text=await request.text();if(text.length>limit)throw new ApiError("too_large",413,"Request body is too large");try{return JSON.parse(text);}catch{throw new ApiError("invalid_json",422,"Request body is not valid JSON");}}
export async function owner():Promise<{id:string;name:string;email:string}>{
 const user=await getChatGPTUser();if(!user)throw new ApiError("unauthenticated",401,"Sign in with ChatGPT");
 const configured=(env as any).OWNER_CHATGPT_USER_ID || (process.env.NODE_ENV!=="production"?"local_seedy":null);
 if(!configured)throw new ApiError("owner_not_configured",503,"Owner identity has not been configured");
 if(user.userId!==configured)throw new ApiError("forbidden",403,"This private radio belongs to another account");
 return {id:user.userId,name:user.displayName,email:user.email};
}
export async function initializeOwner(ownerId:string){
 const t=now();
 await run("INSERT OR IGNORE INTO owner_settings(owner_user_id,updated_at) VALUES(?,?)",ownerId,t);
 const presets=[
 ["Calm Anchor","Even, measured delivery for news","Explain the facts plainly. Separate confirmed facts from claims.","steady","unhurried"],
 ["Curious Guide","Friendly explanations with useful examples","Ask the question a thoughtful listener would ask, then explain clearly.","inquisitive","natural"],
 ["Warm Companion","Relaxed conversation for longer listening","Keep the listener company with warmth and substance.","warm","relaxed"]
 ];
 const existing=await one("SELECT count(*) n FROM personas WHERE owner_user_id=?",ownerId);
 if(Number(existing?.n)===0){
  const inserts=await Promise.all(presets.map(async p=>{
   const h=await sha256Hex(utf8("personal-radio-preset:"+ownerId+":"+p[0]));
   const id=h.slice(0,8)+"-"+h.slice(8,12)+"-5"+h.slice(13,16)+"-a"+h.slice(17,20)+"-"+h.slice(20,32);
   return db().prepare("INSERT OR IGNORE INTO personas(id,owner_user_id,name,description,instructions,tone,pace,voice_id,voice_settings_json,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,ownerId,...p,null,"{}",1,t,t);
  }));
  await db().batch(inserts);
 }
 for(const p of presets){
  const rows=await all("SELECT id FROM personas WHERE owner_user_id=? AND name=? AND description=? AND instructions=? AND tone=? AND pace=? AND voice_id IS NULL AND voice_settings_json='{}' AND archived_at IS NULL ORDER BY created_at,id",ownerId,...p);
  if(rows.length>1)await db().batch(rows.slice(1).map(row=>db().prepare("UPDATE personas SET archived_at=?,active=0 WHERE id=? AND owner_user_id=? AND voice_id IS NULL AND archived_at IS NULL").bind(t,row.id,ownerId)));
 }
}
export async function requireEpisode(ownerId:string,id:string){
 const row=await one("SELECT * FROM episodes WHERE id=? AND owner_user_id=? AND deleted_at IS NULL",id,ownerId);
 if(!row)throw new ApiError("not_found",404,"Episode not found");return row;
}
export function safeSettings(row:any){return {
 timezone:row.timezone,defaultPersonaId:row.default_persona_id,defaultLanguage:row.default_language,defaultMinutes:row.default_minutes,
 playbackSpeed:row.playback_speed,interactionEnabled:!!row.interaction_enabled,autoResume:!!row.auto_resume,retainRecordings:!!row.retain_recordings,
 episodeBudgetUsd:row.episode_budget_usd,answerBudgetUsd:row.answer_budget_usd,monthlyBudgetUsd:row.monthly_budget_usd,
 voiceUsdPerThousandCharacters:row.voice_usd_per_thousand_characters,pricingVersion:row.pricing_version
};}
export function publicEpisode(row:any){return {
 id:row.id,title:row.title,mode:row.mode,prompt:row.prompt,requestedMinutes:row.requested_minutes,language:row.language,
 personaSnapshot:parsed(row.persona_snapshot_json,[]),state:row.state,cutoffAt:row.cutoff_at,actualDurationMs:row.actual_duration_ms,
 finalAssetId:row.final_asset_id,favorite:!!row.favorite,createdAt:row.created_at,updatedAt:row.updated_at,voiceProfile:row.voice_profile
};}
export async function hashPayload(value:unknown){return sha256Hex(utf8(j(value)));}
export async function existingIdempotency(ownerId:string,route:string,key:string,hash:string){
 const old=await one("SELECT * FROM idempotency_keys WHERE owner_user_id=? AND route=? AND key=? AND expires_at>?",ownerId,route,key,now());
 if(!old)return null;
 if(old.payload_hash!==hash)throw new ApiError("idempotency_conflict",409,"This key was used with different input");
 return parsed(old.response_json,{});
}
export function idempotencyKey(request:Request){
 const key=request.headers.get("idempotency-key");
 if(!key||key.length>128)throw new ApiError("missing_idempotency_key",422,"Idempotency-Key is required");
 return key;
}
export async function reserve(ownerId:string,jobId:string,episodeId:string,amount:number):Promise<boolean>{
 const first=new Date();first.setUTCDate(1);first.setUTCHours(0,0,0,0);
 const result=await run(
 "INSERT INTO reservations(id,job_id,episode_id,owner_user_id,reserved_usd,state,created_at,updated_at) SELECT ?,?,?,?,?,'active',?,? WHERE (SELECT coalesce(sum(reserved_usd),0) FROM reservations WHERE owner_user_id=? AND state='active' AND created_at>=?) + (SELECT coalesce(sum(estimated_usd),0) FROM usage_events WHERE owner_user_id=? AND created_at>=?) + ? <= (SELECT monthly_budget_usd FROM owner_settings WHERE owner_user_id=?)",
 rid(),jobId,episodeId,ownerId,amount,now(),now(),ownerId,first.toISOString(),ownerId,first.toISOString(),amount,ownerId);
 return result.meta.changes===1;
}
export async function adjustReservation(ownerId:string,jobId:string,episodeId:string,amount:number):Promise<boolean>{
 const existing=await one("SELECT id FROM reservations WHERE job_id=? AND owner_user_id=? AND state='active'",jobId,ownerId);
 if(!existing)return reserve(ownerId,jobId,episodeId,amount);
 const first=new Date();first.setUTCDate(1);first.setUTCHours(0,0,0,0);
 const result=await run("UPDATE reservations SET reserved_usd=?,updated_at=? WHERE id=? AND owner_user_id=? AND (SELECT coalesce(sum(reserved_usd),0) FROM reservations WHERE owner_user_id=? AND state='active' AND job_id<>? AND created_at>=?) + (SELECT coalesce(sum(estimated_usd),0) FROM usage_events WHERE owner_user_id=? AND created_at>=?) + ? <= (SELECT monthly_budget_usd FROM owner_settings WHERE owner_user_id=?)",amount,now(),existing.id,ownerId,ownerId,jobId,first.toISOString(),ownerId,first.toISOString(),amount,ownerId);
 return result.meta.changes===1;
}
export function estimate(minutes:number,rate:number|null){return {estimatedUsd:estimateEpisodeUsd(minutes,rate),voiceCharacters:minutes*145*6,voiceRateUsdPerThousand:rate,pricingVersion:PRICING_VERSION,assumptions:["145 spoken words per minute","6 characters per word","20% voice retry reserve","Text, search, storage and worker charges are separate"]};}
export async function releaseReservation(jobId:string){await run("UPDATE reservations SET state='released',updated_at=? WHERE job_id=? AND state='active'",now(),jobId);}
export async function validateLease(jobId:string,token:string,fence:number){
 const job=await one("SELECT * FROM jobs WHERE id=? AND lease_token=? AND fence=? AND state='running' AND lease_until>?",jobId,token,fence,now());
 if(!job)throw new ApiError("stale_lease",409,"Job lease expired or was replaced",true);
 const episode=await one("SELECT state,deleted_at FROM episodes WHERE id=? AND owner_user_id=?",job.episode_id,job.owner_user_id);
 if(!episode||job.kind!=="cleanup"&&(episode.deleted_at||["cancelled","deleting"].includes(episode.state)))throw new ApiError("cancelled",409,"Episode was cancelled");
 return job;
}
export async function authorizeInternal(request:Request){
 const secret=(env as any).WORKER_HMAC_SECRET as string|undefined;
 if(!secret)throw new ApiError("internal_unavailable",503,"Worker authentication is not configured");
 const stamp=request.headers.get("x-radio-timestamp")||"";
 const nonce=request.headers.get("x-radio-nonce")||"";
 const digest=request.headers.get("x-radio-sha256")||"";
 const signature=request.headers.get("x-radio-signature")||"";
 const time=Date.parse(stamp);
 if(!nonce||!digest||!signature||!Number.isFinite(time)||Math.abs(Date.now()-time)>300000)throw new ApiError("internal_auth",403,"Invalid worker signature");
 const path=new URL(request.url).pathname;
 const canonical=[request.method.toUpperCase(),path,stamp,nonce,digest].join("\n");
 const key=await crypto.subtle.importKey("raw",utf8(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
 const signatureBytes=Uint8Array.from(signature.match(/../g)?.map(x=>parseInt(x,16))||[]);
 if(signatureBytes.length!==32||!await crypto.subtle.verify("HMAC",key,signatureBytes,utf8(canonical)))throw new ApiError("internal_auth",403,"Invalid worker signature");
 const inserted=await run("INSERT OR IGNORE INTO worker_nonces(nonce,expires_at) VALUES(?,?)",nonce,new Date(Date.now()+300000).toISOString());
 if(inserted.meta.changes!==1)throw new ApiError("replayed_nonce",403,"Worker request was already used");
 if(request.method!=="GET"&&request.method!=="HEAD"&&request.headers.get("content-type")?.startsWith("application/json")){
   const clone=request.clone();const actual=await sha256Hex(new Uint8Array(await clone.arrayBuffer()));
   if(actual!==digest)throw new ApiError("invalid_digest",403,"Request digest mismatch");
 }
}
export function priceKnown(settings:any){return settings.voice_usd_per_thousand_characters!=null;}
