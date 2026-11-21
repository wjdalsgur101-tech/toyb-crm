/* TOYB 영업 CRM service worker */
const V = 'toyb-crm-v5';
const SHELL = [
  './', './index.html', './app.css', './app.js', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './apple-touch-icon.png', './favicon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== V).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 암호화 데이터는 항상 네트워크 우선(최신 반영), 실패 시 캐시
  if (url.pathname.endsWith('data.enc.json')) {
    e.respondWith(
      fetch(req).then(r => {
        const copy = r.clone();
        caches.open(V).then(c => c.put(req, copy));
        return r;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // 내비게이션: 네트워크 우선 → 캐시 폴백
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }

  // 정적 자산: 캐시 우선
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(r => {
      if (r.ok && url.origin === location.origin) {
        const copy = r.clone();
        caches.open(V).then(c => c.put(req, copy));
      }
      return r;
    }).catch(() => hit))
  );
});
