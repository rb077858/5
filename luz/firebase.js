// Firebase wiring for the browser. Everything degrades to "not configured" when firebase-config.js is empty.
const V = '12.3.0';
const CDN = `https://www.gstatic.com/firebasejs/${V}`;

export const config = self.LUZ_FIREBASE_CONFIG;
export const vapidKey = self.LUZ_VAPID_KEY;
export const configured = !!(config && config.apiKey && config.projectId);

let fb = null;
export async function firebase() {
  if (!configured) return null;
  if (fb) return fb;
  const [appM, authM, fsM] = await Promise.all([
    import(`${CDN}/firebase-app.js`),
    import(`${CDN}/firebase-auth.js`),
    import(`${CDN}/firebase-firestore.js`),
  ]);
  const app = appM.initializeApp(config);
  fb = { app, auth: authM.getAuth(app), db: fsM.getFirestore(app), A: authM, F: fsM };
  return fb;
}

// Push token for this browser, or a reason why there isn't one.
export async function pushToken() {
  const { app } = await firebase();
  if (!('serviceWorker' in navigator) || !('Notification' in window)) throw new Error('unsupported');
  const m = await import(`${CDN}/firebase-messaging.js`);
  if (!(await m.isSupported())) throw new Error('unsupported');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('denied');
  const reg = await navigator.serviceWorker.register(new URL('./firebase-messaging-sw.js', import.meta.url), { scope: new URL('./', import.meta.url).pathname });
  await navigator.serviceWorker.ready;
  return m.getToken(m.getMessaging(app), { vapidKey, serviceWorkerRegistration: reg });
}

// Show messages that arrive while the page is open (the service worker handles the rest).
export async function onForegroundPush(cb) {
  const { app } = await firebase();
  const m = await import(`${CDN}/firebase-messaging.js`);
  if (!(await m.isSupported())) return;
  m.onMessage(m.getMessaging(app), cb);
}
