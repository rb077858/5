// Service worker: shows push notifications when the site is closed.
importScripts('./firebase-config.js');

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

if (self.LUZ_FIREBASE_CONFIG && self.LUZ_FIREBASE_CONFIG.apiKey) {
  importScripts('https://www.gstatic.com/firebasejs/12.3.0/firebase-app-compat.js',
                'https://www.gstatic.com/firebasejs/12.3.0/firebase-messaging-compat.js');
  firebase.initializeApp(self.LUZ_FIREBASE_CONFIG);
  // Messages carry a webpush.notification block, so the SDK displays them itself.
  firebase.messaging();
}

// Clicks on Firebase notifications are handled by the SDK (it opens fcmOptions.link); this covers the local test one.
self.addEventListener('notificationclick', e => {
  const data = e.notification.data || {};
  if (data.FCM_MSG) return;
  e.notification.close();
  const url = data.url || self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
