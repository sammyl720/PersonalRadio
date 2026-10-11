import { createHash } from "node:crypto";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, all, authorizeInternal, bodyJson, bucket, db, j, now, one, parsed, releaseReservation, reply, rid, run, validateLease } from "./radio";

const uuid=z.string().uuid();
const lease=z.object({leaseToken:uuid,fence:z.number().int().positive()});
const stages=["research","outline","chapter","check","voice","assembly","approval","answer"] as const;
function checked<T>(schema:z.ZodType<T>,input:unknown):T{const p=schema.safeParse(input);if(!p.success)throw new ApiError("invalid_request",422,"Invalid internal command");return p.data;}
function headerLease(request:Request){return checked(lease,{leaseToken:request.headers.get("x-radio-lease"),fence:Number(request.headers.get("x-radio-fence"))});}
async function active(request:Request,jobId:string){const l=headerLease(request);return validateLease(jobId,l.leaseToken,l.fence);}
const assetInput=z.object({jobId:uuid,kind:z.enum(["chunk","final","answer","preview","recording"]),mime:z.enum(["audio/mpeg","audio/mp4","audio/webm"]),bytes:z.number().int().positive().max(100_000_000),sha256:z.string().regex(/^[0-9a-f]{64}$/),durationMs:z.number().int().min(0).nullable().default(null)});
const checkpointInput=z.object({leaseToken:uuid,fence:z.number().int().positive(),stage:z.enum(stages),checkpoint:z.record(z.unknown()).default({}),cutoffAt:z.string().datetime().optional(),sources:z.array(z.object({id:uuid,url:z.string().url().startsWith("https://"),publisher:z.string().nullable().default(null),title:z.string().nullable().default(null),publishedAt:z.string().nullable().default(null),retrievedAt:z.string().datetime(),claims:z.array(z.string()).default([])})).max(100).optional(),chapter:z.object({id:uuid,ordinal:z.number().int().min(0).max(20),title:z.string().min(1).max(200),turns:z.array(z.object({speaker:z.number().int().min(0).max(1),text:z.string().min(1).max(12000)})).min(1),sourceIds:z.array(uuid).default([])}).optional(),chunk:z.object({id:uuid,ordinal:z.number().int().min(0).max(1000),cacheKey:z.string().regex(/^[0-9a-f]{64}$/)}).optional(),quoteUsd:z.number().nonnegative().optional(),quoteVersion:z.string().optional()});
export async function handleInternal(request:Request,parts:string[]):Promise<Response>{
 await authorizeInternal(request);
 const method=request.method;
 if(parts[0]==="jobs"&&parts[1]==="claim"&&method==="POST"){
  checked(z.object({workerId:z.string().min(1).max(128)}),await bodyJson(request));
  const ownerId=(env as any).OWNER_CHATGPT_USER_ID||(process.env.NODE_ENV!=="production"?"local_seedy":null);
  if(!ownerId)throw new ApiError("owner_not_configured",503,"Owner is not configured");
  const t=now(),until=new Date(Date.now()+120000).toISOString(),token=rid();
  const row=await one("UPDATE jobs SET state='running',lease_token=?,fence=fence+1,lease_until=?,heartbeat_at=?,attempt=attempt+1,updated_at=? WHERE id=(SELECT j.id FROM jobs j JOIN episodes e ON e.id=j.episode_id WHERE j.owner_user_id=? AND e.owner_user_id=? AND ((j.state IN ('queued','retry_wait') AND j.next_run_at<=?) OR (j.state='running' AND j.lease_until<?)) AND (j.kind='cleanup' OR e.deleted_at IS NULL) ORDER BY j.priority DESC,j.created_at ASC LIMIT 1) RETURNING *",token,until,t,t,ownerId,ownerId,t,t);
  return reply({job:row?{id:row.id,kind:row.kind,episodeId:row.episode_id,stage:row.stage,attempt:row.attempt,leaseToken:row.lease_token,fence:row.fence,checkpoint:parsed(row.checkpoint_json,{})}:null});
 }
 if(parts[0]==="jobs"&&parts.length>=2){
  const jid=checked(uuid,parts[1]);
  if(parts[2]==="heartbeat"&&method==="POST"){
   const l=checked(lease,await bodyJson(request));await validateLease(jid,l.leaseToken,l.fence);
   const until=new Date(Date.now()+120000).toISOString();
   await run("UPDATE jobs SET lease_until=?,heartbeat_at=?,updated_at=? WHERE id=? AND lease_token=? AND fence=?",until,now(),now(),jid,l.leaseToken,l.fence);
   return reply({leaseUntil:until});
  }
  if(parts[2]==="input"&&method==="GET"){
   const job=await active(request,jid);
   const episode=await one("SELECT * FROM episodes WHERE id=? AND owner_user_id=?",job.episode_id,job.owner_user_id);
   const [settings,chapters,sources,chunks,assets,messages,reservation]=await Promise.all([
    one("SELECT * FROM owner_settings WHERE owner_user_id=?",job.owner_user_id),
    all("SELECT * FROM chapters WHERE episode_id=? AND owner_user_id=? AND script_version=? ORDER BY ordinal",job.episode_id,job.owner_user_id,episode.script_version),
    all("SELECT * FROM sources WHERE episode_id=? AND owner_user_id=?",job.episode_id,job.owner_user_id),
    all("SELECT * FROM audio_chunks WHERE episode_id=? AND owner_user_id=? AND script_version=? ORDER BY ordinal",job.episode_id,job.owner_user_id,episode.script_version),
    all("SELECT id,kind,bytes,duration_ms,mime,sha256 FROM assets WHERE episode_id=? AND owner_user_id=?",job.episode_id,job.owner_user_id),
    all("SELECT * FROM messages WHERE episode_id=? AND owner_user_id=? ORDER BY created_at DESC LIMIT 7",job.episode_id,job.owner_user_id),
    one("SELECT reserved_usd FROM reservations WHERE job_id=? AND owner_user_id=? AND state='active'",job.id,job.owner_user_id)
   ]);
   return reply({job:{id:job.id,kind:job.kind,stage:job.stage,checkpoint:parsed(job.checkpoint_json,{}),attempt:job.attempt},episode:{...episode,personaSnapshot:parsed(episode.persona_snapshot_json,[]),sourceUrls:parsed(episode.source_urls_json,[])},settings,chapters:chapters.map(c=>({...c,turns:parsed(c.turns_json,[]),sourceIds:parsed(c.source_ids_json,[])})),sources,chunks,assets,messages:messages.reverse(),reservation});
  }
  if(parts[2]==="checkpoint"&&method==="POST"){
   const input=checked(checkpointInput,await bodyJson(request,200_000));
   const job=await validateLease(jid,input.leaseToken,input.fence),t=now();
   const ep=await one("SELECT * FROM episodes WHERE id=? AND owner_user_id=?",job.episode_id,job.owner_user_id);
   const commands:D1PreparedStatement[]=[];
   if(input.sources){
    for(const source of input.sources)commands.push(db().prepare("INSERT OR IGNORE INTO sources(id,episode_id,owner_user_id,url,publisher,title,published_at,retrieved_at,claims_json) VALUES(?,?,?,?,?,?,?,?,?)").bind(source.id,ep.id,job.owner_user_id,source.url,source.publisher,source.title,source.publishedAt,source.retrievedAt,j(source.claims)));
   }
   if(input.chapter){
    const c=input.chapter,spoken=c.turns.map(x=>x.text).join(" ");
    commands.push(db().prepare("INSERT OR REPLACE INTO chapters(id,episode_id,owner_user_id,script_version,ordinal,title,turns_json,spoken_text,source_ids_json) VALUES(?,?,?,?,?,?,?,?,?)").bind(c.id,ep.id,job.owner_user_id,ep.script_version,c.ordinal,c.title,j(c.turns),spoken,j(c.sourceIds)));
   }
   if(input.chunk){
    const c=input.chunk;
    commands.push(db().prepare("INSERT INTO audio_chunks(id,episode_id,job_id,owner_user_id,script_version,ordinal,cache_key,state) VALUES(?,?,?,?,?,?,?,'pending') ON CONFLICT(episode_id,script_version,ordinal) DO UPDATE SET id=excluded.id,job_id=excluded.job_id,cache_key=excluded.cache_key,state='pending',asset_id=NULL,duration_ms=NULL,provider_request_id=NULL,attempts=audio_chunks.attempts+1").bind(c.id,ep.id,jid,job.owner_user_id,ep.script_version,c.ordinal,c.cacheKey));
   }
   let state="running",episodeState=input.stage==="research"?"researching":input.stage==="outline"||input.stage==="chapter"?"writing":input.stage==="check"?"checking":input.stage==="voice"?"voicing":input.stage==="assembly"?"assembling":ep.state;
   const cp:Record<string,unknown>={...parsed<Record<string,unknown>>(job.checkpoint_json,{}),...input.checkpoint};
   if(input.stage==="approval"){
    if(input.quoteUsd===undefined||!input.quoteVersion)throw new ApiError("invalid_quote",422,"Quote is required");
    cp.quoteUsd=input.quoteUsd;cp.quoteVersion=input.quoteVersion;state="awaiting_approval";episodeState="awaiting_approval";
   }
   commands.push(db().prepare("UPDATE jobs SET stage=?,state=?,checkpoint_json=?,lease_token=CASE WHEN ?='awaiting_approval' THEN NULL ELSE lease_token END,updated_at=? WHERE id=? AND lease_token=? AND fence=?").bind(input.stage,state,j(cp),state,t,jid,input.leaseToken,input.fence));
   commands.push(db().prepare("UPDATE episodes SET state=?,cutoff_at=coalesce(?,cutoff_at),updated_at=? WHERE id=? AND owner_user_id=?").bind(episodeState,input.cutoffAt||null,t,ep.id,job.owner_user_id));
   await db().batch(commands);
   return reply({state,stage:input.stage});
  }
  if(parts[2]==="complete"&&method==="POST"){
   const data=checked(z.object({leaseToken:uuid,fence:z.number().int().positive(),assetId:uuid.optional(),chapterTimes:z.array(z.object({id:uuid,startMs:z.number().int().min(0),durationMs:z.number().int().min(0)})).optional(),answerText:z.string().max(5000).optional(),messageId:uuid.optional()}),await bodyJson(request));
   const job=await validateLease(jid,data.leaseToken,data.fence);
   if(job.kind==="cleanup"){
    const objects=await all("SELECT object_key,multipart_state_json FROM assets WHERE owner_user_id=? AND episode_id=?",job.owner_user_id,job.episode_id);
    for(const object of objects){const mp=parsed<any>(object.multipart_state_json,null);if(mp?.uploadId){try{await bucket().resumeMultipartUpload(object.object_key,mp.uploadId).abort();}catch{}}await bucket().delete(object.object_key);}
    await db().batch([
     db().prepare("DELETE FROM usage_events WHERE owner_user_id=? AND episode_id=?").bind(job.owner_user_id,job.episode_id),
     db().prepare("DELETE FROM reservations WHERE owner_user_id=? AND episode_id=?").bind(job.owner_user_id,job.episode_id),
     db().prepare("DELETE FROM audio_chunks WHERE owner_user_id=? AND episode_id=?").bind(job.owner_user_id,job.episode_id),
     db().prepare("DELETE FROM messages WHERE owner_user_id=? AND episode_id=?").bind(job.owner_user_id,job.episode_id),
     db().prepare("DELETE FROM conversations WHERE owner_user_id=? AND episode_id=?").bind(job.owner_user_id,job.episode_id),
     db().prepare("DELETE FROM sources WHERE owner_user_id=? AND episode_id=?").bind(job.owner_user_id,job.episode_id),
     db().prepare("DELETE FROM chapters WHERE owner_user_id=? AND episode_id=?").bind(job.owner_user_id,job.episode_id),
     db().prepare("DELETE FROM playback_progress WHERE owner_user_id=? AND episode_id=?").bind(job.owner_user_id,job.episode_id),
     db().prepare("DELETE FROM assets WHERE owner_user_id=? AND episode_id=?").bind(job.owner_user_id,job.episode_id),
     db().prepare("DELETE FROM idempotency_keys WHERE owner_user_id=? AND resource_id=?").bind(job.owner_user_id,job.episode_id),
     db().prepare("DELETE FROM jobs WHERE owner_user_id=? AND episode_id=?").bind(job.owner_user_id,job.episode_id),
     db().prepare("DELETE FROM episodes WHERE owner_user_id=? AND id=?").bind(job.owner_user_id,job.episode_id)
    ]);
    return reply({deleted:true});
   }
   const asset=data.assetId?await one("SELECT * FROM assets WHERE id=? AND owner_user_id=? AND episode_id=? AND bytes IS NOT NULL",data.assetId,job.owner_user_id,job.episode_id):null;
   if(!asset)throw new ApiError("missing_audio",409,"Completed audio asset is required");
   const t=now(),commands:D1PreparedStatement[]=[];
   if(job.kind==="answer"){
    if(!data.messageId||!data.answerText)throw new ApiError("invalid_answer",422,"Answer text and message are required");
    const message=await one("SELECT * FROM messages WHERE id=? AND owner_user_id=? AND episode_id=? AND role='user'",data.messageId,job.owner_user_id,job.episode_id);
    if(!message)throw new ApiError("message_not_found",404,"Question not found");
    commands.push(db().prepare("UPDATE messages SET state='complete' WHERE id=?").bind(message.id));
    if(message.asset_id){
     const recording=await one("SELECT object_key FROM assets WHERE id=? AND owner_user_id=? AND episode_id=? AND kind='recording'",message.asset_id,job.owner_user_id,job.episode_id);
     if(recording){await bucket().delete(recording.object_key);commands.push(db().prepare("UPDATE messages SET asset_id=NULL WHERE id=?").bind(message.id));commands.push(db().prepare("DELETE FROM assets WHERE id=? AND owner_user_id=?").bind(message.asset_id,job.owner_user_id));}
    }
    commands.push(db().prepare("INSERT INTO messages(id,conversation_id,episode_id,owner_user_id,role,text,anchor_ms,chapter_id,asset_id,state,created_at) VALUES(?,?,?,?,?,?,?,?,?,'complete',?)").bind(rid(),message.conversation_id,job.episode_id,job.owner_user_id,"assistant",data.answerText,message.anchor_ms,message.chapter_id,asset.id,t));
   }else{
    commands.push(db().prepare("UPDATE episodes SET state='ready',final_asset_id=?,actual_duration_ms=?,updated_at=? WHERE id=? AND owner_user_id=?").bind(asset.id,asset.duration_ms,t,job.episode_id,job.owner_user_id));
    for(const c of data.chapterTimes||[])commands.push(db().prepare("UPDATE chapters SET start_ms=?,duration_ms=? WHERE id=? AND owner_user_id=? AND episode_id=?").bind(c.startMs,c.durationMs,c.id,job.owner_user_id,job.episode_id));
   }
   commands.push(db().prepare("UPDATE jobs SET state='completed',stage='complete',lease_token=NULL,updated_at=? WHERE id=? AND lease_token=? AND fence=?").bind(t,jid,data.leaseToken,data.fence));
   await db().batch(commands);await releaseReservation(jid);
   return reply({completed:true});
  }
  if(parts[2]==="fail"&&method==="POST"){
   const data=checked(z.object({leaseToken:uuid,fence:z.number().int().positive(),errorCode:z.string().max(80),retryable:z.boolean().default(false)}),await bodyJson(request));
   const job=await validateLease(jid,data.leaseToken,data.fence);
   const retry=data.retryable&&job.attempt<3;
   const next=new Date(Date.now()+Math.min(300000,30000*Math.pow(2,job.attempt-1))).toISOString();
   await run("UPDATE jobs SET state=?,error_code=?,lease_token=NULL,next_run_at=?,updated_at=? WHERE id=? AND lease_token=? AND fence=?",retry?"retry_wait":"failed",data.errorCode,next,now(),jid,data.leaseToken,data.fence);
   if(job.kind==="episode")await run("UPDATE episodes SET state=?,updated_at=? WHERE id=? AND owner_user_id=?",retry?job.stage==="voice"?"voicing":"queued":"failed",now(),job.episode_id,job.owner_user_id);
   if(!retry)await releaseReservation(jid);
   return reply({state:retry?"retry_wait":"failed"});
  }
 }
 if(parts[0]==="messages"&&parts[2]==="transcription"&&method==="POST"){
  const mid=checked(uuid,parts[1]);
  const data=checked(z.object({jobId:uuid,leaseToken:uuid,fence:z.number().int().positive(),text:z.string().trim().min(1).max(2000)}),await bodyJson(request));
  const job=await validateLease(data.jobId,data.leaseToken,data.fence);
  const result=await run("UPDATE messages SET text=?,state='transcribed' WHERE id=? AND owner_user_id=? AND episode_id=? AND role='user' AND state='transcribing'",data.text,mid,job.owner_user_id,job.episode_id);
  if(result.meta.changes!==1)throw new ApiError("message_not_found",404,"Recording message not found");
  return reply({saved:true});
 }
 if(parts[0]==="assets"&&parts[1]==="initiate"&&method==="POST"){
  const input=checked(assetInput,await bodyJson(request));
  const job=await active(request,input.jobId),id=rid();
  const ep=await one("SELECT script_version FROM episodes WHERE id=? AND owner_user_id=?",job.episode_id,job.owner_user_id);
  const key=[job.owner_user_id,job.episode_id,ep.script_version,id].join("/");
  const upload=await bucket().createMultipartUpload(key,{httpMetadata:{contentType:input.mime}});
  await run("INSERT INTO assets(id,owner_user_id,episode_id,object_key,kind,mime,sha256,duration_ms,multipart_state_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",id,job.owner_user_id,job.episode_id,key,input.kind,input.mime,input.sha256,input.durationMs,j({uploadId:upload.uploadId,parts:[],expectedBytes:input.bytes}),now());
  return reply({assetId:id,partSize:8*1024*1024});
 }
 if(parts[0]==="assets"&&parts.length>=3){
  const assetId=checked(uuid,parts[1]),asset=await one("SELECT * FROM assets WHERE id=?",assetId);
  if(!asset)throw new ApiError("not_found",404,"Asset not found");
  const jid=request.headers.get("x-radio-job")||"";
  const job=await active(request,checked(uuid,jid));
  if(job.owner_user_id!==asset.owner_user_id||job.episode_id!==asset.episode_id)throw new ApiError("forbidden",403,"Asset is not assigned to this job");
  if(parts[2]==="parts"&&method==="PUT"){
   const part=Number(parts[3]);if(!Number.isInteger(part)||part<1||part>100)throw new ApiError("invalid_part",422,"Invalid part number");
   const mp=parsed<any>(asset.multipart_state_json,null);if(!mp?.uploadId||!request.body)throw new ApiError("invalid_upload",409,"Multipart upload is unavailable");
   const declared=request.headers.get("x-radio-part-sha256");
   if(!declared||!/^[0-9a-f]{64}$/.test(declared))throw new ApiError("invalid_digest",422,"Part digest is required");
   const bytes=new Uint8Array(await request.arrayBuffer());
   if(bytes.byteLength>8*1024*1024)throw new ApiError("part_too_large",422,"Part is too large");
   if(createHash("sha256").update(bytes).digest("hex")!==declared)throw new ApiError("invalid_digest",422,"Part digest mismatch");
   const uploaded=await bucket().resumeMultipartUpload(asset.object_key,mp.uploadId).uploadPart(part,bytes);
   const count=bytes.byteLength;
   const partsList=(mp.parts as any[]).filter(x=>x.partNumber!==part);partsList.push({partNumber:part,etag:uploaded.etag,bytes:count});
   await run("UPDATE assets SET multipart_state_json=? WHERE id=? AND owner_user_id=?",j({...mp,parts:partsList}),assetId,job.owner_user_id);
   return reply({partNumber:part,etag:uploaded.etag});
  }
  if(parts[2]==="complete"&&method==="POST"){
   const mp=parsed<any>(asset.multipart_state_json,null);if(!mp?.uploadId)throw new ApiError("invalid_upload",409,"No multipart upload");
   const partsList=[...mp.parts].sort((a,b)=>a.partNumber-b.partNumber);
   if(!partsList.length||partsList.some((x,i)=>x.partNumber!==i+1))throw new ApiError("missing_part",409,"Upload parts are incomplete");
   if(partsList.some((x,i)=>i<partsList.length-1&&x.bytes<5*1024*1024))throw new ApiError("small_part",422,"Nonfinal parts must be at least 5 MiB");
   const total=partsList.reduce((sum,x)=>sum+x.bytes,0);
   if(total!==mp.expectedBytes)throw new ApiError("size_mismatch",422,"Upload size mismatch");
   await bucket().resumeMultipartUpload(asset.object_key,mp.uploadId).complete(partsList.map(x=>({partNumber:x.partNumber,etag:x.etag})));
   const object=await bucket().get(asset.object_key);if(!object?.body)throw new ApiError("missing_object",503,"Uploaded object is unavailable",true);
   const hash=createHash("sha256"),reader=object.body.getReader();let bytes=0;
   while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;hash.update(value);}
   if(bytes!==total||hash.digest("hex")!==asset.sha256){await bucket().delete(asset.object_key);throw new ApiError("checksum_mismatch",422,"Asset checksum mismatch");}
   await run("UPDATE assets SET bytes=?,multipart_state_json=NULL WHERE id=? AND owner_user_id=?",total,assetId,job.owner_user_id);
   return reply({assetId,bytes:total});
  }
  if(parts[2]==="abort"&&method==="POST"){
   const mp=parsed<any>(asset.multipart_state_json,null);if(mp?.uploadId)await bucket().resumeMultipartUpload(asset.object_key,mp.uploadId).abort();
   await run("DELETE FROM assets WHERE id=? AND owner_user_id=?",assetId,job.owner_user_id);return reply({aborted:true});
  }
  if(parts[2]==="download"&&method==="GET"){
   if(asset.bytes==null)throw new ApiError("asset_incomplete",409,"Asset is incomplete");
   const object=await bucket().get(asset.object_key);if(!object?.body)throw new ApiError("missing_object",503,"Asset is unavailable",true);
   return new Response(object.body,{headers:{"Content-Type":asset.mime,"Content-Length":String(asset.bytes),"Cache-Control":"private, no-store"}});
  }
 }
 if(parts[0]==="chunks"&&parts[2]==="complete"&&method==="POST"){
  const cid=checked(uuid,parts[1]);
  const data=checked(z.object({jobId:uuid,leaseToken:uuid,fence:z.number().int().positive(),assetId:uuid,durationMs:z.number().int().positive(),providerRequestId:z.string().nullable().default(null)}),await bodyJson(request));
  const job=await validateLease(data.jobId,data.leaseToken,data.fence);
  const chunk=await one("SELECT * FROM audio_chunks WHERE id=? AND job_id=? AND owner_user_id=?",cid,job.id,job.owner_user_id);
  const asset=await one("SELECT * FROM assets WHERE id=? AND owner_user_id=? AND episode_id=? AND bytes IS NOT NULL",data.assetId,job.owner_user_id,job.episode_id);
  if(!chunk||!asset)throw new ApiError("not_found",404,"Chunk or asset missing");
  await run("UPDATE audio_chunks SET state='complete',asset_id=?,duration_ms=?,provider_request_id=?,attempts=attempts+1 WHERE id=? AND job_id=?",asset.id,data.durationMs,data.providerRequestId,cid,job.id);
  return reply({completed:true});
 }
 if(parts[0]==="catalog"&&parts[1]==="voices"&&method==="POST"){
  const data=checked(z.object({voices:z.array(z.object({id:z.string().min(1).max(128),name:z.string().min(1).max(200),category:z.string().nullable(),previewUrl:z.string().url().nullable()})).max(500)}),await bodyJson(request,200_000));
  await db().batch(data.voices.map(v=>db().prepare("INSERT INTO voice_catalog(voice_id,name,category,preview_url,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(voice_id) DO UPDATE SET name=excluded.name,category=excluded.category,preview_url=excluded.preview_url,updated_at=excluded.updated_at").bind(v.id,v.name,v.category,v.previewUrl,now())));
  return reply({count:data.voices.length});
 }
 if(parts[0]==="usage"&&method==="POST"){
  const data=checked(z.object({jobId:uuid,leaseToken:uuid,fence:z.number().int().positive(),provider:z.string().max(50),model:z.string().max(100),operation:z.string().max(50),billableUnits:z.record(z.number()),estimatedUsd:z.number().nullable(),costStatus:z.enum(["estimated","confirmed","unknown","uncertain"]),requestId:z.string().nullable()}),await bodyJson(request));
  const job=await validateLease(data.jobId,data.leaseToken,data.fence);
  await run("INSERT INTO usage_events(id,job_id,episode_id,owner_user_id,provider,model,operation,billable_units_json,estimated_usd,cost_status,request_id,pricing_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",rid(),job.id,job.episode_id,job.owner_user_id,data.provider,data.model,data.operation,j(data.billableUnits),data.estimatedUsd,data.costStatus,data.requestId,"2026-10-11-owner-rate-v1",now());
  return reply({recorded:true});
 }
 throw new ApiError("not_found",404,"Internal route not found");
}
