// "Install app": the page links the web app manifest only on ?install, so Chrome offers installing
// the app (its ⋮ menu and our one-tap button) only after the student chose "התקנה".
const $ = s => document.querySelector(s);
const ua = navigator.userAgent;
const isIOS = /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
let installing = new URLSearchParams(location.search).has('install');

let deferred = null;   // Chrome's install prompt

function render() {
  const btn = $('#installNow'), hint = $('#installHint');
  if (isIOS) {
    btn.classList.add('hidden');
    hint.textContent = 'באייפון: לוחצים על כפתור השיתוף ב-Safari ← "הוספה למסך הבית".';
  } else if (deferred) {
    btn.disabled = false; btn.textContent = 'התקנה עכשיו';
    hint.textContent = 'האפליקציה תיפתח בחלון משלה, בלי שורת כתובת.';
  } else {
    btn.disabled = true; btn.textContent = 'מכין התקנה…';
    hint.textContent = '';
  }
}
function open() { render(); $('#installSheet').classList.add('open'); }
function close() {
  $('#installSheet').classList.remove('open');
  if (installing) {
    // leave install mode completely: the next "התקנה" reloads into ?install from scratch
    installing = false;
    deferred = null;
    document.querySelector('link[rel="manifest"]')?.remove();
    history.replaceState(null, '', location.pathname + location.hash);
  }
}

function start() {
  if (standalone) return;           // already running as the app
  const b = $('#installBtn');
  b.classList.remove('hidden');
  b.onclick = () => { if (isIOS) open(); else location.search = 'install'; };
  $('#installSheet').addEventListener('click', e => { if (e.target.id === 'installSheet' || e.target.closest('[data-iclose]')) close(); });
  $('#installNow').onclick = async () => {
    if (!deferred) return;
    deferred.prompt();
    const { outcome } = await deferred.userChoice.catch(() => ({}));
    deferred = null;
    if (outcome === 'accepted') close(); else render();
  };
  if (installing) {
    const link = document.createElement('link');
    link.rel = 'manifest'; link.href = 'manifest.webmanifest';
    document.head.appendChild(link);
    open();
    // Chrome usually offers the prompt within a second or two; if not, say where else to find it
    setTimeout(() => { if (installing && !deferred && !isIOS) { $('#installNow').textContent = 'ההתקנה לא זמינה כרגע'; $('#installHint').textContent = 'ייתכן שהאפליקציה כבר מותקנת, או שהדפדפן לא תומך בהתקנה.'; } }, 6000);
  }
}

addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  if (!installing) return;          // not offered outside ?install
  deferred = e;
  render();
});
addEventListener('appinstalled', () => {
  close();
  $('#installBtn').classList.add('hidden');
  const t = $('#toast'); t.textContent = 'האפליקציה הותקנה ✓'; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3000);
});

start();
