import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";

const MAX_BYTES=256_000;
const TIMEOUT_MS=3000;

function publicIPv4(address:string){
 if(isIP(address)!==4)return false;
 const [a,b,c]=address.split(".").map(Number);
 if(a===0||a===10||a===127||a>=224)return false;
 if(a===100&&b>=64&&b<=127)return false;
 if(a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168)return false;
 if(a===192&&b===0&&c===0||a===192&&b===0&&c===2||a===192&&b===88&&c===99)return false;
 if(a===198&&b>=18&&b<=19||a===198&&b===51&&c===100||a===203&&b===0&&c===113)return false;
 return true;
}

function sourceUrl(value:string){
 try{
  const url=new URL(value);
  if(url.protocol!=="https:"||url.port&&url.port!=="443"||url.username||url.password||isIP(url.hostname))return null;
  return url;
 }catch{return null}
}

function validDate(value:string){
 const parsed=Date.parse(value.trim());
 if(!Number.isFinite(parsed)||parsed<Date.parse("1900-01-01")||parsed>Date.now()+86_400_000)return null;
 return new Date(parsed).toISOString();
}

function attrs(tag:string){
 const found=new Map<string,string>();
 for(const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))found.set(match[1].toLowerCase(),match[2]??match[3]??match[4]);
 return found;
}

export function publishedAtFromHtml(html:string):string|null{
 for(const match of html.matchAll(/<meta\b[^>]*>/gi)){
  const tag=attrs(match[0]);
  const key=(tag.get("property")||tag.get("name")||tag.get("itemprop")||"").toLowerCase();
  if(["article:published_time","datepublished","pubdate","dc.date","dc.date.issued","parsely-pub-date","publication_date","govuk:first-published-at"].includes(key)){
   const date=validDate(tag.get("content")||"");if(date)return date;
  }
 }
 for(const match of html.matchAll(/"datePublished"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/gi)){
  const date=validDate(match[1]);if(date)return date;
 }
 for(const match of html.matchAll(/<time\b[^>]*>/gi)){
  const tag=attrs(match[0]);
  if(/published|datepublished|pubdate/i.test([tag.get("itemprop"),tag.get("class"),tag.get("rel")].join(" "))){
   const date=validDate(tag.get("datetime")||"");if(date)return date;
  }
 }
 return null;
}

async function fetchHtml(url:URL,redirects=0):Promise<string|null>{
 if(redirects>2)return null;
 const addresses=await lookup(url.hostname,{all:true,verbatim:true}).catch(()=>[]);
 const target=addresses.find(x=>publicIPv4(x.address));
 if(!target)return null;
 return new Promise(resolve=>{
  let settled=false;
  const finish=(value:string|null)=>{if(settled)return;settled=true;clearTimeout(timer);resolve(value)};
  const req=request(url,{headers:{"Accept":"text/html","Accept-Encoding":"identity","User-Agent":"PersonalRadio/1.0 (publication metadata)"},lookup:(_hostname,options,callback)=>{
   if(options.all)(callback as (error:NodeJS.ErrnoException|null,addresses:{address:string;family:number}[])=>void)(null,[{address:target.address,family:4}]);
   else callback(null,target.address,4);
  }},res=>{
   const status=res.statusCode||0;
   if(status>=300&&status<400&&res.headers.location){
    res.resume();let next:URL|null=null;
    try{next=sourceUrl(new URL(res.headers.location,url).toString())}catch{}
    if(!next){finish(null);return}
    void fetchHtml(next,redirects+1).then(finish,()=>finish(null));return;
   }
   if(status!==200||!String(res.headers["content-type"]||"").toLowerCase().includes("text/html")){res.resume();finish(null);return}
   const chunks:Buffer[]=[];let bytes=0;
   res.on("data",(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>MAX_BYTES){req.destroy();finish(Buffer.concat(chunks).toString("utf8"))}else chunks.push(chunk)});
   res.on("end",()=>finish(Buffer.concat(chunks).toString("utf8")));
   res.on("error",()=>finish(null));
  });
  const timer=setTimeout(()=>{req.destroy();finish(null)},TIMEOUT_MS);
  req.on("error",()=>finish(null));req.end();
 });
}

export async function publicationDateForSource(value:string):Promise<string|null>{
 const url=sourceUrl(value);if(!url)return null;
 try{return publishedAtFromHtml(await fetchHtml(url)||"")}catch{return null}
}

export async function publicationDates(urls:string[]):Promise<(string|null)[]>{
 const results:(string|null)[]=Array(urls.length).fill(null);
 let next=0;
 await Promise.all(Array.from({length:Math.min(4,urls.length)},async()=>{
  while(next<urls.length){const index=next++;results[index]=await publicationDateForSource(urls[index])}
 }));
 return results;
}
