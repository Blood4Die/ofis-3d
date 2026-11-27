// Ofis 3D servis çalışanı: uygulama kapalıyken bile push bildirimlerini gösterir.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: 'Ofis 3D', body: event.data?.text() }; }
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const focused = wins.some((c) => c.focused && c.visibilityState === 'visible');
    // Uygulama önde ve görünürse uygulama içi bildirim yeterli; acil mesaj her durumda gösterilir
    if (focused && !d.urgent) return;
    await self.registration.showNotification(d.title || 'Ofis 3D', {
      body: d.body || '',
      tag: d.tag || 'ofis3d',
      renotify: true,
      requireInteraction: !!d.urgent,          // acil: kullanıcı tıklayana kadar ekranda kalır
      icon: 'icons/icon-192.png',
      badge: 'icons/badge-96.png',
      vibrate: d.urgent ? [300, 120, 300, 120, 600] : [120, 60, 120],
      data: { url: d.url || './' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of wins) {
      if (c.url.startsWith(self.registration.scope)) {
        await c.focus();
        c.postMessage({ type: 'open', url });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
