// "Install app": the page links the web app manifest only on ?install, so Chrome offers installing
// the app (its ⋮ menu and our one-tap button) only after the student chose "התקנה".
const $ = s => document.querySelector(s);
const ua = navigator.userAgent;
const isIOS = /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
let installing = new URLSearchParams(location.search).has('install');
const store = {
  get: k => { try { return localStorage.getItem('luz.' + k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem('luz.' + k) : localStorage.setItem('luz.' + k, v); } catch {} },
};

let deferred = null;     // Chrome's install prompt
let phase = 'preparing'; // preparing | ready | working | installed | unavailable | ios
let giveUp = null;

const TEXT = {
  preparing: { btn: 'מכין התקנה…', hint: '' },
  ready: { btn: 'התקנה עכשיו', hint: 'האפליקציה תיפתח בחלון משלה, בלי שורת כתובת.' },
  working: { btn: 'סגירה', hint: '', status: 'ההתקנה מתבצעת ברקע. זה לוקח בדרך כלל עד חצי דקה, ואז האייקון יופיע במסך הבית (או ברשימת האפליקציות במחשב). אפשר לסגור את החלון.' },
  installed: { btn: 'סגירה', hint: 'כדי לפתוח: מחפשים את "מערכת שעות" במסך הבית או ברשימת האפליקציות. בכרום במחשב יש גם כפתור "פתיחה באפליקציה" בשורת הכתובת.', status: 'האפליקציה כבר מותקנת במכשיר הזה', done: true },
  unavailable: { btn: 'סגירה', hint: 'ייתכן שהאפליקציה כבר מותקנת (מחפשים "מערכת שעות" במסך הבית), או שהדפדפן הזה לא תומך בהתקנה. אם מחקתם אותה, רעננו את הדף ונסו שוב.' },
  ios: { btn: 'סגירה', hint: 'באייפון: לוחצים על כפתור השיתוף ב-Safari ← "הוספה למסך הבית".' },
};

function render() {
  const t = TEXT[phase], btn = $('#installNow'), st = $('#installStatus');
  btn.textContent = t.btn;
  btn.disabled = phase === 'preparing';
  btn.classList.toggle('primary', phase === 'ready' || phase === 'preparing');
  $('#installHint').textContent = t.hint;
  st.classList.toggle('hidden', !t.status);
  st.classList.toggle('done', !!t.done);
  $('#installStatusText').textContent = t.status || '';
}
function setPhase(p) { phase = p; clearTimeout(giveUp); render(); }
function open() { render(); $('#installSheet').classList.add('open'); }
function close() {
  $('#installSheet').classList.remove('open');
  clearTimeout(giveUp);
  if (installing) {
    // leave install mode completely: the next "התקנה" reloads into ?install from scratch
    installing = false;
    deferred = null;
    document.querySelector('link[rel="manifest"]')?.remove();
    history.replaceState(null, '', location.pathname + location.hash);
  }
}

// Is the app already installed on this device? Chrome answers through the manifest's
// related_applications; the flag we keep covers browsers that can't tell.
async function alreadyInstalled() {
  try {
    if (navigator.getInstalledRelatedApps) {
      const apps = await navigator.getInstalledRelatedApps();
      if (apps.length) return true;
      // Chrome can answer, and says it's not installed: forget an old flag (the app was removed)
      if (deferred) store.set('installed', null);
    }
  } catch {}
  return store.get('installed') === '1' && !deferred;
}

async function start() {
  if (standalone) { store.set('installed', '1'); return; }   // running as the app
  const b = $('#installBtn');
  b.classList.remove('hidden');
  b.onclick = () => {
    if (isIOS) { setPhase('ios'); open(); }
    else location.search = 'install';
  };
  $('#installSheet').addEventListener('click', e => { if (e.target.id === 'installSheet' || e.target.closest('[data-iclose]')) close(); });
  $('#installNow').onclick = async () => {
    if (phase !== 'ready') { close(); return; }
    deferred.prompt();
    const { outcome } = await deferred.userChoice.catch(() => ({}));
    deferred = null;
    if (outcome === 'accepted') { store.set('installed', '1'); setPhase('working'); }
    else setPhase('unavailable');
  };
  if (!installing) return;
  const link = document.createElement('link');
  link.rel = 'manifest'; link.href = 'manifest.webmanifest';
  document.head.appendChild(link);
  setPhase('preparing'); open();
  // Chrome offers its prompt within a second or two, but never for an app that is already installed
  giveUp = setTimeout(async () => {
    if (phase !== 'preparing') return;
    setPhase(await alreadyInstalled() || store.get('installed') === '1' ? 'installed' : 'unavailable');
  }, 4000);
  if (await alreadyInstalled() && phase === 'preparing' && !deferred) setPhase('installed');
}

addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  if (!installing) return;          // not offered outside ?install
  deferred = e;
  store.set('installed', null);     // Chrome offers it, so it isn't installed (any more)
  if (phase === 'preparing' || phase === 'installed' || phase === 'unavailable') setPhase('ready');
});
addEventListener('appinstalled', () => {
  store.set('installed', '1');
  // Chrome reports this as soon as the student confirms; the icon still takes a while to appear
  if ($('#installSheet').classList.contains('open')) setPhase('working');
});

start();
