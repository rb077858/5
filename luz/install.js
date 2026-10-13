// "Install app": a guided, animated walkthrough of Chrome's menu (or Safari's share sheet on iPhone).
// The page links the web app manifest only while the guide is open (?install), so Chrome offers
// installing the app from there and nowhere else.
const $ = s => document.querySelector(s);
const ua = navigator.userAgent;
const isIOS = /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(ua);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const platform = isIOS ? 'ios' : isAndroid ? 'android' : 'desktop';
const installing = new URLSearchParams(location.search).has('install');

let deferred = null;   // Chrome's own install prompt, when it offers one

const FLOWS = {
  android: {
    steps: ['לוחצים על שלוש הנקודות ⋮ למעלה', 'בוחרים "הוספה למסך הבית" או "התקנת אפליקציה"', 'מאשרים ב"התקנה"', 'האפליקציה במסך הבית 🎉'],
    menu: ['כרטיסייה חדשה', 'היסטוריה', 'הורדות', 'שיתוף…', { t: 'התקנת אפליקציה', hit: true, icon: '⊕' }, 'הגדרות'],
    dialog: { title: 'להתקין את האפליקציה?', ok: 'התקנה' },
  },
  desktop: {
    steps: ['לוחצים על שלוש הנקודות ⋮ בפינה', 'עוברים ל"העברה, שמירה ושיתוף"', 'בוחרים "התקנת הדף כאפליקציה…"', 'מאשרים ב"התקנה"', 'האפליקציה מותקנת במחשב 🎉'],
    menu: ['כרטיסייה חדשה', 'חלון חדש', 'היסטוריה', 'הורדות', { t: 'העברה, שמירה ושיתוף', hit: true, sub: true }, 'הגדרות'],
    sub: [{ t: 'התקנת הדף כאפליקציה…', hit: true, icon: '⊕' }, 'יצירת קוד QR', 'שמירת הדף בשם…'],
    dialog: { title: 'להתקין את האפליקציה?', ok: 'התקנה' },
  },
  ios: {
    steps: ['לוחצים על כפתור השיתוף ⬆︎ בתחתית', 'גוללים ובוחרים "הוספה למסך הבית"', 'לוחצים "הוספה" למעלה', 'נכנסים מהאייקון במסך הבית 🎉'],
    menu: ['העתקה', 'הוספה לרשימת קריאה', 'הוספת סימנייה', { t: 'הוספה למסך הבית', hit: true, icon: '⊞' }, 'הדפסה'],
    dialog: { title: 'הוספה למסך הבית', ok: 'הוספה' },
  },
};

function mockHTML(f) {
  const item = x => typeof x === 'string' ? `<li>${x}</li>` : `<li class="hit${x.sub ? ' has-sub' : ''}" data-hit>${x.icon ? `<span class="mi">${x.icon}</span>` : ''}${x.t}${x.sub ? '<span class="chev">‹</span>' : ''}</li>`;
  const ios = platform === 'ios';
  return `
  <div class="mock mock-${platform}" id="mock">
    ${ios ? '' : `<div class="m-bar"><span class="m-url">🔒 reembir.com/5/luz</span><span class="m-dots" data-target="dots">⋮</span></div>`}
    <div class="m-page">
      <div class="m-h"></div><div class="m-l"></div><div class="m-l s"></div><div class="m-card"></div><div class="m-card"></div>
    </div>
    ${ios ? `<div class="m-iosbar"><span class="m-url">reembir.com</span><span class="m-share" data-target="dots">⬆︎</span></div>` : ''}
    <ul class="m-menu" id="mMenu">${f.menu.map(item).join('')}</ul>
    ${f.sub ? `<ul class="m-menu m-sub" id="mSub">${f.sub.map(item).join('')}</ul>` : ''}
    <div class="m-dialog" id="mDialog"><div class="m-app"><img src="icon-192.png" alt=""><div><b>מערכת שעות</b><small>reembir.com</small></div></div>
      <b class="m-dt">${f.dialog.title}</b><div class="m-btns"><span>ביטול</span><span class="m-ok" data-target="ok">${f.dialog.ok}</span></div></div>
    <div class="m-home" id="mHome"><div class="m-ic"><img src="icon-192.png" alt=""><span>מערכת שעות</span></div></div>
    <div class="finger" id="finger"></div>
  </div>`;
}

let timer = null;
function play() {
  const f = FLOWS[platform];
  $('#installMock').innerHTML = mockHTML(f);
  $('#installSteps').innerHTML = f.steps.map((t, i) => `<li data-s="${i}"><span>${i + 1}</span>${t}</li>`).join('');
  const mock = $('#mock'), finger = $('#finger');
  const at = el => { const a = el.getBoundingClientRect(), b = mock.getBoundingClientRect(); return [a.left - b.left + a.width / 2, a.top - b.top + a.height / 2]; };
  const move = el => { const [x, y] = at(el); finger.style.transform = `translate(${x}px, ${y}px)`; };
  const tap = () => { finger.classList.remove('tap'); void finger.offsetWidth; finger.classList.add('tap'); };
  const mark = i => document.querySelectorAll('#installSteps li').forEach(li => li.classList.toggle('on', +li.dataset.s === i));
  const rest = () => { finger.style.transform = `translate(${mock.clientWidth / 2}px, ${mock.clientHeight + 30}px)`; };
  const reset = () => { mock.className = `mock mock-${platform}`; rest(); finger.classList.remove('tap'); mock.querySelectorAll('.press').forEach(x => x.classList.remove('press')); };

  // each beat: [delay before it, action]
  const beats = [];
  const add = (ms, fn) => beats.push([ms, fn]);
  add(300, () => { reset(); mark(0); });
  add(700, () => move(mock.querySelector('[data-target="dots"]')));
  add(700, () => { tap(); mock.classList.add('menu'); });
  add(600, () => { mark(1); move(mock.querySelector('#mMenu [data-hit]')); });
  add(700, () => { tap(); mock.querySelector('#mMenu [data-hit]').classList.add('press'); });
  if (f.sub) {
    add(400, () => mock.classList.add('sub'));
    add(600, () => { mark(2); move(mock.querySelector('#mSub [data-hit]')); });
    add(700, () => { tap(); mock.querySelector('#mSub [data-hit]').classList.add('press'); });
  }
  add(400, () => { mock.classList.remove('menu', 'sub'); mock.classList.add('dialog'); mark(f.steps.length - 2); });
  add(600, () => move(mock.querySelector('[data-target="ok"]')));
  add(700, () => { tap(); mock.querySelector('.m-ok').classList.add('press'); });
  add(500, () => { mock.classList.remove('dialog'); mock.classList.add('home'); mark(f.steps.length - 1); rest(); });
  add(2200, () => {});

  let i = 0;
  const next = () => { const [ms, fn] = beats[i]; timer = setTimeout(() => { fn(); i = (i + 1) % beats.length; next(); }, ms); };
  clearTimeout(timer); next();
}

function open() {
  const box = $('#installNow');
  box.classList.toggle('hidden', !deferred);
  $('#installHint').textContent = platform === 'ios'
    ? 'באייפון אפשר להתקין רק מ-Safari. אחרי ההתקנה נכנסים מהאייקון, ורק משם אפשר לקבל התראות.'
    : deferred ? 'אפשר ללחוץ על הכפתור, או לעשות את זה דרך התפריט של כרום כמו בהדגמה.'
      : 'עשו את זה דרך התפריט של כרום, כמו בהדגמה. אם האפשרות לא מופיעה, רעננו את הדף.';
  $('#installSheet').classList.add('open');
  play();
}
function close() {
  clearTimeout(timer);
  $('#installSheet').classList.remove('open');
  if (installing) {
    // installing is only offered from the guide: take the manifest away again
    document.querySelector('link[rel="manifest"]')?.remove();
    history.replaceState(null, '', location.pathname + location.hash);
  }
}

function start() {
  const btn = $('#installBtn');
  if (standalone) return;           // already running as the app
  btn.classList.remove('hidden');
  btn.onclick = () => {
    if (installing || isIOS) { open(); return; }
    location.search = 'install';    // reload with the manifest so Chrome allows installing
  };
  $('#installSheet').addEventListener('click', e => { if (e.target.id === 'installSheet' || e.target.closest('[data-iclose]')) close(); });
  $('#installNow').onclick = async () => {
    if (!deferred) return;
    deferred.prompt();
    const { outcome } = await deferred.userChoice.catch(() => ({}));
    deferred = null;
    if (outcome === 'accepted') close(); else open();
  };
  if (installing) {
    const link = document.createElement('link');
    link.rel = 'manifest'; link.href = 'manifest.webmanifest';
    document.head.appendChild(link);
    open();
  }
}

addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  if (!installing) return;          // not offered outside the guide
  deferred = e;
  if ($('#installSheet').classList.contains('open')) open();
});
addEventListener('appinstalled', () => {
  close();
  $('#installBtn').classList.add('hidden');
  const t = $('#toast'); t.textContent = 'האפליקציה הותקנה ✓'; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3000);
});

start();
