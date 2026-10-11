const CACHE="personal-radio-static-v1";
self.addEventListener("install",event=>{event.waitUntil(self.skipWaiting())});
self.addEventListener("activate",event=>{event.waitUntil(self.clients.claim())});
self.addEventListener("fetch",event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=="GET"||url.origin!==self.location.origin)return;
 if(!url.pathname.startsWith("/_next/static/")&&!["/favicon.svg","/manifest.webmanifest"].includes(url.pathname))return;
 event.respondWith(caches.open(CACHE).then(async cache=>{const saved=await cache.match(request);if(saved)return saved;const response=await fetch(request);if(response.ok)await cache.put(request,response.clone());return response;}));
});
self.addEventListener("message",event=>{if(event.data==="REMOVE_PRIVATE_CACHES")event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith("personal-radio-")).map(k=>caches.delete(k)))))});
