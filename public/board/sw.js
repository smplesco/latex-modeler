/* Bump CACHE when you change index.html, or visitors keep the old copy. */
const CACHE = 'board-v1';   // Screenboard's cache inside LaTeX Modeler (was screenboard-v16 on its old site)
const SHARED = 'screenboard-shared';   // files shared to Screenboard from another app wait here for the page
const ASSETS = ['./', './index.html', './manifest.webmanifest',
                './icon-192.png', './icon-512.png', './icon-maskable.png'];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', e=>{
  e.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE && k!==SHARED).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});
self.addEventListener('fetch', e=>{
  const url = new URL(e.request.url);
  // "Share to Screenboard" on a phone: keep the files, then open the app, which picks them up
  if(e.request.method === 'POST' && url.origin === location.origin && url.searchParams.has('share-target')){
    e.respondWith((async ()=>{
      try{
        const form = await e.request.formData(), c = await caches.open(SHARED);
        let i = 0;
        for(const f of form.getAll('files')){
          if(!(f instanceof File) || f.size > 60e6 || i >= 12) continue;
          await c.put('./shared/' + Date.now() + '-' + (i++), new Response(f, {headers:{
            'content-type': f.type || 'application/octet-stream', 'x-name': encodeURIComponent(f.name || 'shared')}}));
        }
      }catch(err){}
      return Response.redirect('./?shared=1', 303);
    })());
    return;
  }
  if(e.request.method !== 'GET') return;
  // the app is one page: "./?new=whiteboard" and friends are the same file
  const nav = e.request.mode === 'navigate' && url.origin === location.origin;
  e.respondWith(
    caches.match(e.request, {ignoreSearch: nav}).then(hit=>
      hit || fetch(e.request).then(res=>{
        const copy = res.clone();
        if(!nav) caches.open(CACHE).then(c=>c.put(e.request, copy));
        return res;
      }).catch(()=>caches.match('./index.html'))
    )
  );
});
