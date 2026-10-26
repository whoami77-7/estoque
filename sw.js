const CACHE = 'puff-v17-20261026-tabela';
const SHELL = ['./','index.html','styles.css','app.js','model.mjs','money.mjs','currency-ui.mjs','shipments.mjs','notes.mjs','legacy.mjs','analytics.mjs','feedback.mjs','resilience.mjs','express.mjs','express-specs.mjs','rio-catalog.mjs','price-table.mjs','icon.svg','manifest.webmanifest','legacy.html'];
const SHELL_URLS = new Set(SHELL.map(path=>new URL(path,self.registration.scope).href));

self.addEventListener('install',event=>{
  // A version is installed as a complete bundle, bypassing Safari's HTTP cache.
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll([...SHELL_URLS].map(url=>new Request(url,{cache:'reload'})))));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE&&/^puff-v\d+-/.test(key)).map(key=>caches.delete(key)))));
});
// The app requests activation only after it can safely reload; never interrupt a save.
self.addEventListener('message',event=>{
  if(event.data?.type==='SKIP_WAITING')event.waitUntil(self.skipWaiting());
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||!SHELL_URLS.has(event.request.url))return;
  event.respondWith((async()=>{
    let cached;
    try{cached=await (await caches.open(CACHE)).match(event.request);}catch{}
    if(cached)return cached;
    // Safari may evict offline storage. Recover online without mixing a new file into this bundle.
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),10000);
    try{return await fetch(event.request,{cache:'reload',signal:controller.signal});}
    catch{return Response.error();}
    finally{clearTimeout(timeout);}
  })());
});
