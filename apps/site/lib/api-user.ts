import { env } from "cloudflare:workers";
import { createEpisodeSchema, personaSchema, settingsPatchSchema, progressSchema, questionSchema } from "../../../packages/contracts/src/index";
import { parseSingleRange, sha256Hex, utf8 } from "../../../packages/content/src/index";
import { ApiError, adjustReservation, all, bodyJson, bucket, db, enforceOrigin, estimate, existingIdempotency, hashPayload, idempotencyKey, initializeOwner, j, now, one, owner, parsed, publicEpisode, releaseReservation, reply, requireEpisode, reserve, rid, run, safeSettings } from "./radio";

function parse<T>(schema:{safeParse:(value:unknown)=>{success:boolean;data?:T}},value:unknown):T{
 const result=schema.safeParse(value);if(!result.success)throw new ApiError("invalid_request",422,"Invalid request fields");return result.data as T;
}
function s(value:unknown){return String(value??"");}
function uuidPath(value:string){if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new ApiError("not_found",404,"Record not found");return value;}
function mappedPersona(p:any){return {id:p.id,name:p.name,description:p.description,instructions:p.instructions,tone:p.tone,pace:p.pace,voiceId:p.voice_id,voiceSettings:parsed(p.voice_settings_json,{}),active:!!p.active};}
export async function handleUser(request:Request,parts:string[]):Promise<Response>{
 const user=await owner();const id=user.id;await initializeOwner(id);
 const method=request.method,url=new URL(request.url);
 if(!["GET","HEAD"].includes(method))enforceOrigin(request);
 if(parts[0]==="me"&&method==="GET"){
  const settings=await one("SELECT * FROM owner_settings WHERE owner_user_id=?",id);
  return reply({user:{displayName:user.name,email:user.email},settings:safeSettings(settings),models:{research:"gpt-6-luna",review:"gpt-6.1-sol",voice:"eleven_v4",transcription:"scribe_v2"},connectivity:{workerConfigured:!!(env as any).WORKER_HMAC_SECRET,voiceCatalog:!!(await one("SELECT voice_id FROM voice_catalog LIMIT 1"))}});
 }
 if(parts[0]==="settings"){
  if(method==="GET"){return reply({settings:safeSettings(await one("SELECT * FROM owner_settings WHERE owner_user_id=?",id))});}
  if(method==="PATCH"){
   const input=parse<any>(settingsPatchSchema,await bodyJson(request));
   const map:Record<string,string>={defaultPersonaId:"default_persona_id",defaultLanguage:"default_language",defaultMinutes:"default_minutes",stylePreference:"style_preference",playbackSpeed:"playback_speed",interactionEnabled:"interaction_enabled",autoResume:"auto_resume",retainRecordings:"retain_recordings",episodeBudgetUsd:"episode_budget_usd",answerBudgetUsd:"answer_budget_usd",monthlyBudgetUsd:"monthly_budget_usd",voiceUsdPerThousandCharacters:"voice_usd_per_thousand_characters"};
   const entries=Object.entries(input);if(entries.length){
    const columns=entries.map(([k])=>map[k]+"=?").join(",");
    await run("UPDATE owner_settings SET "+columns+",updated_at=? WHERE owner_user_id=?",...entries.map(([,v])=>typeof v==="boolean"?(v?1:0):v),now(),id);
   }
   return reply({settings:safeSettings(await one("SELECT * FROM owner_settings WHERE owner_user_id=?",id))});
  }
 }
 if(parts[0]==="personas"){
  if(parts.length===1&&method==="GET"){return reply({items:(await all("SELECT * FROM personas WHERE owner_user_id=? AND archived_at IS NULL ORDER BY created_at",id)).map(mappedPersona)});}
  if(parts.length===1&&method==="POST"){
   const input=parse<any>(personaSchema,await bodyJson(request));
   const pid=rid(),t=now();
   await run("INSERT INTO personas(id,owner_user_id,name,description,instructions,tone,pace,voice_id,voice_settings_json,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",pid,id,input.name,input.description,input.instructions,input.tone,input.pace,input.voiceId,j(input.voiceSettings),input.active?1:0,t,t);
   return reply({id:pid},201);
  }
  if(parts.length===2){const pid=uuidPath(parts[1]);const old=await one("SELECT * FROM personas WHERE id=? AND owner_user_id=? AND archived_at IS NULL",pid,id);if(!old)throw new ApiError("not_found",404,"Host not found");
   if(method==="PATCH"){
    const input=parse<any>(personaSchema,await bodyJson(request));
    await run("UPDATE personas SET name=?,description=?,instructions=?,tone=?,pace=?,voice_id=?,voice_settings_json=?,active=?,updated_at=? WHERE id=? AND owner_user_id=?",input.name,input.description,input.instructions,input.tone,input.pace,input.voiceId,j(input.voiceSettings),input.active?1:0,now(),pid,id);
    return reply({item:mappedPersona(await one("SELECT * FROM personas WHERE id=?",pid))});
   }
   if(method==="DELETE"){await run("UPDATE personas SET archived_at=?,active=0 WHERE id=? AND owner_user_id=?",now(),pid,id);return reply({archived:true});}
  }
 }
 if(parts[0]==="voices"&&method==="GET"){return reply({items:await all("SELECT voice_id id,name,category,preview_url previewUrl FROM voice_catalog ORDER BY name")});}
 if(parts[0]==="voice-previews"&&method==="POST"){
  const input=await bodyJson(request),voiceId=s(input?.voiceId);
  const voice=await one("SELECT voice_id,name FROM voice_catalog WHERE voice_id=?",voiceId);
  if(!voice)throw new ApiError("invalid_voice",422,"Choose a voice from your account");
  const sample="Welcome to Personal Radio. Take a breath and settle in. Today, we'll look closely at an idea, find the useful details, and make sense of it together.";
  const cacheKey=await sha256Hex(utf8(j({voiceId,model:"eleven_v4",sample,settingsVersion:"1"})));
  const cached=await one("SELECT e.id,e.state,e.final_asset_id,j.id job_id FROM episodes e LEFT JOIN jobs j ON j.episode_id=e.id WHERE e.owner_user_id=? AND e.mode='preview' AND e.prompt=? AND e.deleted_at IS NULL ORDER BY e.created_at DESC LIMIT 1",id,cacheKey);
  if(cached)return reply({assetId:cached.final_asset_id,jobId:cached.job_id,state:cached.state},cached.final_asset_id?200:202);
  const settings=await one("SELECT * FROM owner_settings WHERE owner_user_id=?",id);
  if(settings.voice_usd_per_thousand_characters==null)throw new ApiError("voice_price_unknown",422,"Set a voice rate before previewing");
  const quote=Math.ceil(sample.length*settings.voice_usd_per_thousand_characters/1000*1.2*100)/100;
  if(quote>settings.answer_budget_usd)throw new ApiError("answer_budget",422,"Preview estimate exceeds the answer budget");
  const eid=rid(),jid=rid(),t=now();if(!await reserve(id,jid,eid,quote))throw new ApiError("monthly_budget",422,"Monthly budget would be exceeded");
  try{await db().batch([
   db().prepare("INSERT INTO episodes(id,owner_user_id,mode,prompt,source_notes,source_urls_json,requested_minutes,language,freshness_hours,voice_profile,interaction_enabled,persona_snapshot_json,title,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(eid,id,"preview",cacheKey,"","[]",10,"English",24,"latest",0,j([{name:voice.name,voiceId}]),"Voice preview","queued",t,t),
   db().prepare("INSERT INTO jobs(id,owner_user_id,episode_id,kind,stage,state,next_run_at,checkpoint_json,priority,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(jid,id,eid,"preview","voice","queued",t,j({sample}),15,t,t)
  ])}catch(e){await releaseReservation(jid);throw e}
  return reply({assetId:null,jobId:jid,state:"queued"},202);
 }
 if(parts[0]==="episodes"){
  if(parts.length===1&&method==="POST"){
   const input=parse<any>(createEpisodeSchema,await bodyJson(request));
   const key=idempotencyKey(request),hash=await hashPayload(input),old=await existingIdempotency(id,"POST /api/episodes",key,hash);
   if(old)return reply(old,202);
   const primary=await one("SELECT * FROM personas WHERE id=? AND owner_user_id=? AND active=1 AND archived_at IS NULL",input.primaryPersonaId,id);
   if(!primary)throw new ApiError("invalid_host",422,"Choose an active primary host");
   const secondary=input.secondaryPersonaId?await one("SELECT * FROM personas WHERE id=? AND owner_user_id=? AND active=1 AND archived_at IS NULL",input.secondaryPersonaId,id):null;
   if(input.secondaryPersonaId&&!secondary)throw new ApiError("invalid_host",422,"Choose an active second host");
   if(!primary.voice_id||secondary&&!secondary.voice_id)throw new ApiError("voice_unassigned",422,"Select an account voice for every host");
   const settings=await one("SELECT * FROM owner_settings WHERE owner_user_id=?",id);
   const active=await one("SELECT count(*) n FROM episodes WHERE owner_user_id=? AND state IN ('researching','writing','checking','voicing','assembling') AND deleted_at IS NULL",id);
   const queued=await one("SELECT count(*) n FROM episodes WHERE owner_user_id=? AND state='queued' AND deleted_at IS NULL",id);
   if(Number(active.n)>=1&&Number(queued.n)>=2)throw new ApiError("queue_full",429,"Two episodes are already queued");
   const quote=estimate(input.targetMinutes,settings.voice_usd_per_thousand_characters);
   if(quote.estimatedUsd!=null&&quote.estimatedUsd>settings.episode_budget_usd)throw new ApiError("episode_budget",422,"Estimate exceeds the per episode budget");
   const episodeId=rid(),jobId=rid(),t=now();
   if(quote.estimatedUsd!=null&&!await reserve(id,jobId,episodeId,quote.estimatedUsd))throw new ApiError("monthly_budget",422,"Monthly budget would be exceeded");
   const snapshot=[primary,secondary].filter(Boolean).map((p:any)=>mappedPersona(p));
   const response={episodeId,jobId,state:"queued",estimate:quote,pricingVersion:quote.pricingVersion};
   try{
    await db().batch([
     db().prepare("INSERT INTO episodes(id,owner_user_id,mode,prompt,source_notes,source_urls_json,requested_minutes,language,freshness_hours,voice_profile,style_preference,interaction_enabled,persona_snapshot_json,title,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(episodeId,id,input.mode,input.prompt,input.sourceNotes,j(input.sourceUrls),input.targetMinutes,input.language,input.freshnessHours,input.voiceProfile,settings.style_preference,input.interactionEnabled?1:0,j(snapshot),input.prompt.slice(0,100),"queued",t,t),
     db().prepare("INSERT INTO jobs(id,owner_user_id,episode_id,kind,stage,state,next_run_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(jobId,id,episodeId,"episode","research","queued",t,t,t),
     db().prepare("INSERT INTO idempotency_keys(owner_user_id,route,key,payload_hash,resource_id,response_json,expires_at) VALUES(?,?,?,?,?,?,?)").bind(id,"POST /api/episodes",key,hash,episodeId,j(response),new Date(Date.now()+86400000).toISOString())
    ]);
   }catch(e){await releaseReservation(jobId);const concurrent=await existingIdempotency(id,"POST /api/episodes",key,hash);if(concurrent)return reply(concurrent,202);throw e;}
   return reply(response,202);
  }
  if(parts.length===1&&method==="GET"){
   const params=url.searchParams,limit=Math.min(30,Math.max(1,Number(params.get("limit")||20)));
   const mode=params.get("mode"),state=params.get("state"),favorite=params.get("favorite"),search=params.get("search");
   let sql="SELECT * FROM episodes WHERE owner_user_id=? AND mode<>'preview' AND deleted_at IS NULL";const bind:any[]=[id];
   if(mode){sql+=" AND mode=?";bind.push(mode);}if(state){sql+=" AND state=?";bind.push(state);}
   if(favorite==="true")sql+=" AND favorite=1";
   if(search){sql+=" AND (title LIKE ? OR prompt LIKE ?)";bind.push("%"+search.slice(0,100)+"%","%"+search.slice(0,100)+"%");}
   const cursor=params.get("cursor");if(cursor){try{const [date,eid]=JSON.parse(atob(cursor));sql+=" AND (created_at<? OR (created_at=? AND id<?))";bind.push(date,date,eid);}catch{throw new ApiError("invalid_cursor",422,"Invalid cursor");}}
   sql+=" ORDER BY created_at DESC,id DESC LIMIT ?";bind.push(limit+1);
   const rows=await all(sql,...bind),visible=rows.slice(0,limit),last=visible.at(-1);
   return reply({items:visible.map(publicEpisode),nextCursor:rows.length>limit&&last?btoa(j([last.created_at,last.id])):null});
  }
  if(parts.length>=2){const eid=uuidPath(parts[1]),episode=await requireEpisode(id,eid);
   if(parts.length===2&&method==="GET"){
    const [chapters,sources,jobs,conversation,progress,usage]=await Promise.all([
     all("SELECT * FROM chapters WHERE owner_user_id=? AND episode_id=? AND script_version=? ORDER BY ordinal",id,eid,episode.script_version),
     all("SELECT * FROM sources WHERE owner_user_id=? AND episode_id=? ORDER BY retrieved_at",id,eid),
     all("SELECT id,kind,stage,state,error_code,checkpoint_json,updated_at FROM jobs WHERE owner_user_id=? AND episode_id=? ORDER BY created_at",id,eid),
     all("SELECT id,role,text,anchor_ms,chapter_id,asset_id,state,created_at FROM messages WHERE owner_user_id=? AND episode_id=? ORDER BY created_at",id,eid),
     one("SELECT * FROM playback_progress WHERE owner_user_id=? AND episode_id=?",id,eid),
     all("SELECT provider,model,operation,billable_units_json,estimated_usd,cost_status,created_at FROM usage_events WHERE owner_user_id=? AND episode_id=? ORDER BY created_at",id,eid)
    ]);
    return reply({episode:publicEpisode(episode),chapters:chapters.map(c=>({id:c.id,title:c.title,ordinal:c.ordinal,spokenText:c.spoken_text,turns:parsed(c.turns_json,[]),sourceIds:parsed(c.source_ids_json,[]),startMs:c.start_ms,durationMs:c.duration_ms})),sources:sources.map(x=>({id:x.id,url:x.url,publisher:x.publisher,title:x.title,publishedAt:x.published_at,retrievedAt:x.retrieved_at,claims:parsed(x.claims_json,[])})),jobs:jobs.map(x=>({...x,checkpoint:parsed(x.checkpoint_json,{})})),messages:conversation,progress,usage});
   }
   if(parts.length===2&&method==="PATCH"){
    const data=await bodyJson(request);if(typeof data!=="object"||data==null||Object.keys(data).some(k=>!["title","favorite"].includes(k)))throw new ApiError("invalid_request",422,"Only title and favorite can change");
    if(data.title!==undefined){if(typeof data.title!=="string"||data.title.length>120||!data.title.trim())throw new ApiError("invalid_title",422,"Invalid title");await run("UPDATE episodes SET title=?,updated_at=? WHERE id=? AND owner_user_id=?",data.title.trim(),now(),eid,id);}
    if(data.favorite!==undefined){if(typeof data.favorite!=="boolean")throw new ApiError("invalid_favorite",422,"Invalid favorite");await run("UPDATE episodes SET favorite=?,updated_at=? WHERE id=? AND owner_user_id=?",data.favorite?1:0,now(),eid,id);}
    return reply({episode:publicEpisode(await requireEpisode(id,eid))});
   }
   if(parts.length===2&&method==="DELETE"){
    const t=now(),jobId=rid();
    await db().batch([
     db().prepare("UPDATE episodes SET state='deleting',deleted_at=?,updated_at=? WHERE id=? AND owner_user_id=?").bind(t,t,eid,id),
     db().prepare("UPDATE jobs SET state='cancelled',lease_token=NULL,fence=fence+1,updated_at=? WHERE episode_id=? AND owner_user_id=? AND state IN ('queued','running','retry_wait')").bind(t,eid,id),
     db().prepare("INSERT INTO jobs(id,owner_user_id,episode_id,kind,stage,state,next_run_at,priority,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(jobId,id,eid,"cleanup","delete","queued",t,10,t,t)
    ]);
    return reply({jobId,state:"deleting"},202);
   }
   if(parts[2]==="cancel"&&method==="POST"){const t=now();await db().batch([db().prepare("UPDATE episodes SET state='cancelled',updated_at=? WHERE id=? AND owner_user_id=? AND state NOT IN ('ready','deleting')").bind(t,eid,id),db().prepare("UPDATE jobs SET state='cancelled',lease_token=NULL,fence=fence+1,updated_at=? WHERE episode_id=? AND owner_user_id=? AND state IN ('queued','running','retry_wait')").bind(t,eid,id)]);return reply({state:(await requireEpisode(id,eid)).state});}
   if(parts[2]==="retry"&&method==="POST"){
    const key=idempotencyKey(request),hash=await hashPayload({episodeId:eid}),old=await existingIdempotency(id,"retry:"+eid,key,hash);if(old)return reply(old,202);
    const job=await one("SELECT * FROM jobs WHERE owner_user_id=? AND episode_id=? AND kind='episode' ORDER BY created_at DESC LIMIT 1",id,eid);
    if(!job||job.state!=="failed")throw new ApiError("not_retryable",409,"Episode has no failed job");
    const retryCp=parsed<any>(job.checkpoint_json,{});delete retryCp.lastFailureKey;delete retryCp.retryCount;
    const t=now();await run("UPDATE jobs SET state='queued',error_code=NULL,checkpoint_json=?,next_run_at=?,lease_token=NULL,updated_at=? WHERE id=? AND owner_user_id=? AND state='failed'",j(retryCp),t,t,job.id,id);
    await run("UPDATE episodes SET state=?,updated_at=? WHERE id=? AND owner_user_id=?",job.stage==="voice"?"voicing":job.stage==="assembly"?"assembling":"queued",t,eid,id);
    const response={jobId:job.id,state:"queued"};await run("INSERT INTO idempotency_keys(owner_user_id,route,key,payload_hash,resource_id,response_json,expires_at) VALUES(?,?,?,?,?,?,?)",id,"retry:"+eid,key,hash,job.id,j(response),new Date(Date.now()+86400000).toISOString());return reply(response,202);
   }
   if(parts[2]==="approve-cost"&&method==="POST"){
    const data=await bodyJson(request);if(typeof data.quoteVersion!=="string")throw new ApiError("invalid_request",422,"quoteVersion is required");
    const job=await one("SELECT * FROM jobs WHERE owner_user_id=? AND episode_id=? AND state='awaiting_approval' ORDER BY created_at DESC LIMIT 1",id,eid);
    if(!job)throw new ApiError("not_awaiting_approval",409,"No quote needs approval");
    const cp=parsed<any>(job.checkpoint_json,{});if(cp.quoteVersion!==data.quoteVersion)throw new ApiError("stale_quote",409,"Quote changed");
    const settings=await one("SELECT * FROM owner_settings WHERE owner_user_id=?",id);
    if(settings.voice_usd_per_thousand_characters==null)throw new ApiError("voice_price_unknown",422,"Set a voice rate before approving synthesis");
    if(cp.quoteUsd>settings.monthly_budget_usd)throw new ApiError("monthly_budget",422,"Quote exceeds monthly cap");
    if(cp.quoteUsd>0&&!await adjustReservation(id,job.id,eid,cp.quoteUsd))throw new ApiError("monthly_budget",422,"Monthly budget would be exceeded");
    const refresh=cp.quoteUsd===0;
    cp.approvedQuoteVersion=refresh?null:cp.quoteVersion;
    await run("UPDATE jobs SET state='queued',stage=?,checkpoint_json=?,next_run_at=?,updated_at=? WHERE id=? AND owner_user_id=?",refresh?"check":"voice",j(cp),now(),now(),job.id,id);
    await run("UPDATE episodes SET state=?,updated_at=? WHERE id=? AND owner_user_id=?",refresh?"checking":"voicing",now(),eid,id);
    return reply({jobId:job.id,state:"queued"},202);
   }
   if(parts[2]==="progress"&&method==="PUT"){
    const input=parse<any>(progressSchema,await bodyJson(request));
    const old=await one("SELECT revision,device_session_id FROM playback_progress WHERE owner_user_id=? AND episode_id=?",id,eid);
    if(old&&old.revision!==input.expectedRevision)throw new ApiError("stale_progress",409,"Playback position changed on another device");
    if(!old&&input.expectedRevision!==0)throw new ApiError("stale_progress",409,"Playback position changed on another device");
    const saved=old?await run("UPDATE playback_progress SET position_ms=?,speed=?,device_session_id=?,revision=revision+1,updated_at=? WHERE owner_user_id=? AND episode_id=? AND revision=?",input.positionMs,input.speed,input.deviceSessionId,now(),id,eid,input.expectedRevision):await run("INSERT INTO playback_progress(owner_user_id,episode_id,position_ms,speed,device_session_id,revision,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner_user_id,episode_id) DO NOTHING",id,eid,input.positionMs,input.speed,input.deviceSessionId,1,now());
    if(saved.meta.changes!==1)throw new ApiError("stale_progress",409,"Playback position changed on another device");
    return reply({revision:input.expectedRevision+1});
   }
   if(parts[2]==="questions"&&method==="POST"){
    if(!episode.interaction_enabled||episode.state!=="ready")throw new ApiError("interaction_unavailable",409,"This episode is not ready for questions");
    const data=parse<any>(questionSchema,await bodyJson(request));
    const settings=await one("SELECT * FROM owner_settings WHERE owner_user_id=?",id);
    if(settings.voice_usd_per_thousand_characters==null)throw new ApiError("voice_price_unknown",422,"Set a voice rate in Settings before asking for spoken answers");
    const answerQuote=Math.ceil((1320*settings.voice_usd_per_thousand_characters/1000*1.2+0.02)*100)/100;
    if(answerQuote>settings.answer_budget_usd)throw new ApiError("answer_budget",422,"Answer estimate exceeds the answer budget");
    const recent=await one("SELECT count(*) n FROM messages WHERE owner_user_id=? AND role='user' AND created_at>?",id,new Date(Date.now()-60000).toISOString());
    if(Number(recent.n)>=10)throw new ApiError("question_rate",429,"Wait before asking another question");
    const conversation=await one("SELECT id FROM conversations WHERE owner_user_id=? AND episode_id=? LIMIT 1",id,eid);
    const cid=conversation?.id||rid(),mid=rid(),jid=rid(),t=now();
    if(!await reserve(id,jid,eid,answerQuote))throw new ApiError("monthly_budget",422,"Monthly budget would be exceeded");
    const inserts=[];
    if(!conversation)inserts.push(db().prepare("INSERT INTO conversations(id,episode_id,owner_user_id,created_at) VALUES(?,?,?,?)").bind(cid,eid,id,t));
    inserts.push(db().prepare("INSERT INTO messages(id,conversation_id,episode_id,owner_user_id,role,text,anchor_ms,chapter_id,state,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(mid,cid,eid,id,"user",data.text,data.anchorMs,data.chapterId,"queued",t));
    inserts.push(db().prepare("INSERT INTO jobs(id,owner_user_id,episode_id,kind,stage,state,next_run_at,checkpoint_json,priority,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(jid,id,eid,"answer","answer","queued",t,j({messageId:mid}),20,t,t));
    try{await db().batch(inserts)}catch(e){await releaseReservation(jid);throw e}
    return reply({conversationId:cid,messageId:mid,jobId:jid},202);
   }
   if(parts[2]==="voice-questions"&&method==="POST"){
    if(!episode.interaction_enabled||episode.state!=="ready")throw new ApiError("interaction_unavailable",409,"This episode is not ready for questions");
    const contentType=request.headers.get("content-type")||"";
    if(!contentType.startsWith("multipart/form-data"))throw new ApiError("invalid_content_type",415,"Expected multipart recording");
    const declared=Number(request.headers.get("content-length")||0);
    if(declared>10_500_000)throw new ApiError("too_large",413,"Recording must be under 10 MB");
    const data=await request.formData(),file=data.get("file"),anchorMs=Number(data.get("anchorMs"));
    if(!(file instanceof File)||file.size<=0||file.size>10_000_000)throw new ApiError("invalid_recording",422,"Recording must be under 10 MB");
    if(!["audio/mp4","audio/webm","audio/webm;codecs=opus"].includes(file.type))throw new ApiError("unsupported_recording",422,"Use MP4 or WebM audio");
    if(!Number.isSafeInteger(anchorMs)||anchorMs<0)throw new ApiError("invalid_anchor",422,"Invalid playback position");
    const settings=await one("SELECT * FROM owner_settings WHERE owner_user_id=?",id);
    if(settings.voice_usd_per_thousand_characters==null)throw new ApiError("voice_price_unknown",422,"Set a voice rate in Settings before asking for spoken answers");
    const answerQuote=Math.ceil((1320*settings.voice_usd_per_thousand_characters/1000*1.2+0.04)*100)/100;
    if(answerQuote>settings.answer_budget_usd)throw new ApiError("answer_budget",422,"Answer estimate exceeds the answer budget");
    const recent=await one("SELECT count(*) n FROM messages WHERE owner_user_id=? AND role='user' AND created_at>?",id,new Date(Date.now()-60000).toISOString());
    if(Number(recent.n)>=10)throw new ApiError("question_rate",429,"Wait before asking another question");
    const conversation=await one("SELECT id FROM conversations WHERE owner_user_id=? AND episode_id=? LIMIT 1",id,eid);
    const cid=conversation?.id||rid(),mid=rid(),jid=rid(),assetId=rid(),t=now(),bytes=new Uint8Array(await file.arrayBuffer());
    if(!await reserve(id,jid,eid,answerQuote))throw new ApiError("monthly_budget",422,"Monthly budget would be exceeded");
    const objectKey=[id,eid,episode.script_version,assetId].join("/");
    try{
     await bucket().put(objectKey,bytes,{httpMetadata:{contentType:file.type}});
     const inserts=[];
     if(!conversation)inserts.push(db().prepare("INSERT INTO conversations(id,episode_id,owner_user_id,created_at) VALUES(?,?,?,?)").bind(cid,eid,id,t));
     inserts.push(db().prepare("INSERT INTO assets(id,owner_user_id,episode_id,object_key,kind,mime,bytes,sha256,created_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(assetId,id,eid,objectKey,"recording",file.type,file.size,await sha256Hex(bytes),t));
     inserts.push(db().prepare("INSERT INTO messages(id,conversation_id,episode_id,owner_user_id,role,text,anchor_ms,asset_id,state,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(mid,cid,eid,id,"user","",anchorMs,assetId,"transcribing",t));
     inserts.push(db().prepare("INSERT INTO jobs(id,owner_user_id,episode_id,kind,stage,state,next_run_at,checkpoint_json,priority,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(jid,id,eid,"answer","transcription","queued",t,j({messageId:mid}),20,t,t));
     await db().batch(inserts);
    }catch(e){await bucket().delete(objectKey);await releaseReservation(jid);throw e}
    return reply({conversationId:cid,messageId:mid,jobId:jid},202);
   }
   if(parts[2]==="conversation"&&method==="GET"){return reply({items:await all("SELECT id,role,text,anchor_ms,chapter_id,asset_id,source_ids_json,state,created_at FROM messages WHERE owner_user_id=? AND episode_id=? ORDER BY created_at",id,eid)});}
  }
 }
 if(parts[0]==="jobs"&&parts.length===2&&method==="GET"){
  const job=await one("SELECT id,episode_id,kind,stage,state,error_code,checkpoint_json,attempt,updated_at FROM jobs WHERE id=? AND owner_user_id=?",uuidPath(parts[1]),id);
  if(!job)throw new ApiError("not_found",404,"Job not found");
  const chunks=await one("SELECT count(*) total,sum(CASE WHEN state='complete' THEN 1 ELSE 0 END) completed FROM audio_chunks WHERE job_id=? AND owner_user_id=?",job.id,id);
  return reply({job:{...job,checkpoint:parsed(job.checkpoint_json,{})},chunks:{total:Number(chunks.total),completed:Number(chunks.completed||0)}});
 }
 if(parts[0]==="assets"&&parts[2]==="audio"&&["GET","HEAD"].includes(method)){
  const asset=await one("SELECT a.* FROM assets a JOIN episodes e ON e.id=a.episode_id WHERE a.id=? AND a.owner_user_id=? AND e.owner_user_id=? AND e.deleted_at IS NULL AND a.bytes IS NOT NULL",uuidPath(parts[1]),id,id);
  if(!asset)throw new ApiError("not_found",404,"Audio not found");
  const size=Number(asset.bytes),range=parseSingleRange(request.headers.get("range"),size);
  if(range==="invalid")return new Response(null,{status:416,headers:{"Content-Range":"bytes */"+size,"Cache-Control":"private, no-store","Accept-Ranges":"bytes"}});
  const headers=new Headers({"Content-Type":asset.mime,"Accept-Ranges":"bytes","Cache-Control":"private, no-store","Content-Length":String(range?range.end-range.start+1:size)});
  if(range)headers.set("Content-Range","bytes "+range.start+"-"+range.end+"/"+size);
  if(url.searchParams.get("disposition")==="attachment")headers.set("Content-Disposition","attachment; filename=\"personal-radio-"+asset.episode_id+".mp3\"");
  if(method==="HEAD")return new Response(null,{status:range?206:200,headers});
  const object=await bucket().get(asset.object_key,range?{range:{offset:range.start,length:range.end-range.start+1}}:undefined);
  if(!object)throw new ApiError("asset_unavailable",503,"Audio is temporarily unavailable",true);
  return new Response(object.body,{status:range?206:200,headers});
 }
 throw new ApiError("not_found",404,"Route not found");
}
