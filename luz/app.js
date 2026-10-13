import { KINDS, KIND_KEYS, WEEKDAYS, WEEKDAY_LETTERS, DEFAULT_PREFS, normPrefs, israelNow, addDays, weekdayOf, toMin, showTime,
  groupFor, profileOf, personalDay } from './core.js';
import { configured, firebase, pushToken, onForegroundPush } from './firebase.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('luz.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('luz.' + k, JSON.stringify(v)); } catch {} },
};

const state = {
  schedule: null,
  date: null,
  user: null,        // Firestore users/{uid} data
  uid: null,
  messages: [],
  viewProfile: store.get('viewProfile', null),   // for people who haven't registered
};

// ---------- utils ----------
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 3200); }
function openSheet(id) { $(id).classList.add('open'); }
function closeSheet(el) { el.closest('.sheet-bg').classList.remove('open'); }
document.addEventListener('click', e => {
  if (e.target.matches('[data-close]')) closeSheet(e.target);
  else if (e.target.classList.contains('sheet-bg')) e.target.classList.remove('open');
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.sheet-bg.open').forEach(x => x.classList.remove('open')); });

const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const heDate = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const hebDate = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const dateObj = d => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd, 12)); };
function profile() { return state.user ? profileOf(state.user, state.schedule) : state.viewProfile; }

// ---------- render: date + timeline ----------
function render() {
  const s = state.schedule; if (!s) return;
  $('#className').textContent = s.className || '';
  const now = israelNow();
  const date = state.date;
  const wd = weekdayOf(date);
  const isToday = date === now.date;
  $('#dayTitle').textContent = `יום ${WEEKDAYS[wd]}${isToday ? ' · היום' : date === addDays(now.date, 1) ? ' · מחר' : date === addDays(now.date, -1) ? ' · אתמול' : ''}`;
  let heb = ''; try { heb = hebDate.format(dateObj(date)); } catch {}
  $('#daySub').textContent = `${heDate.format(dateObj(date))}${heb ? ' · ' + heb : ''}`;
  $('#todayBtn').classList.toggle('hidden', isToday);
  $('#datePick').value = date;

  // week strip (Sunday → Saturday) around the selected date
  const sun = addDays(date, -wd);
  $('#week').innerHTML = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(sun, i);
    return `<button data-d="${d}" class="${d === date ? 'sel' : ''} ${d === now.date ? 'today' : ''}"><span>${WEEKDAY_LETTERS[i]}</span><b>${+d.slice(8)}</b></button>`;
  }).join('');

  const day = personalDay(s, date, profile());
  const tl = $('#timeline');
  if (!day.items.length) {
    tl.innerHTML = `<div class="empty"><div class="big">${wd === 6 ? '🕯️' : '🌿'}</div><p>${esc(day.note || 'אין מערכת ליום הזה')}</p></div>`;
  } else {
    const nowMin = now.minutes;
    tl.innerHTML = (day.note ? `<div class="banner" style="margin:6px 12px">${esc(day.note)}</div>` : '') + day.items.map((it, i) => {
      const a = toMin(it.start), b = toMin(it.end);
      const cls = !isToday ? '' : b <= nowMin ? 'past' : a <= nowMin ? 'cur' : '';
      return `<div class="item k-${it.kind} ${cls} ${it.implicit ? 'implicit' : ''}" data-i="${i}">
        <div class="t">${showTime(it.start)}</div>
        <div class="box">
          <h4>${esc(it.title)}</h4>
          ${it.lines ? it.lines.map(l => `<p>${esc(l)}</p>`).join('') : it.teacher ? `<p>${esc(it.teacher)}</p>` : ''}
          ${it.implicit ? '' : `<div class="meta"><span class="chip">${KINDS[it.kind]?.label || ''}</span><span class="tr">${showTime(it.start)}–${showTime(it.end)}</span>${it.note ? `<span>· ${esc(it.note)}</span>` : ''}</div>`}
        </div></div>`;
    }).join('');
  }
  renderNow(day, isToday, now);
  const p = profile();
  $('#viewAs').textContent = p ? `מוצג עבור קבוצה ${p.group || '?'}${p.units ? `, ${p.units} יח״ל אנגלית` : ''}` : 'מוצגים כל הקבוצות';
}

function renderNow(day, isToday, now) {
  const card = $('#nowCard'), tl = $('#timeline');
  tl.querySelector('.nowline')?.remove();
  if (!isToday || !day.items.length) { card.classList.add('hidden'); return; }
  const m = now.minutes + now.seconds / 60;
  const items = day.items;
  const i = items.findIndex(it => toMin(it.start) <= m && m < toMin(it.end));
  const next = items.find(it => toMin(it.start) > m && !it.implicit);
  // the red line
  let y = null;
  const els = tl.querySelectorAll('.item');
  if (i >= 0) {
    const el = els[i], it = items[i];
    const f = (m - toMin(it.start)) / (toMin(it.end) - toMin(it.start));
    const box = el.querySelector('.box');
    y = el.offsetTop + box.offsetTop + f * box.offsetHeight;
  } else if (m < toMin(items[0].start)) y = els[0].offsetTop;
  else if (m >= toMin(items[items.length - 1].end)) y = els[els.length - 1].offsetTop + els[els.length - 1].offsetHeight;
  if (y != null) {
    const line = document.createElement('div');
    line.className = 'nowline'; line.style.top = y + 'px';
    line.innerHTML = `<span>${Math.floor(now.minutes / 60)}:${String(now.minutes % 60).padStart(2, '0')}</span>`;
    tl.appendChild(line);
  }
  const fmtLeft = n => n >= 60 ? `${Math.floor(n / 60)} שע׳ ו־${n % 60} דק׳` : `${n} דק׳`;
  let html = '';
  if (i >= 0) {
    const it = items[i], a = toMin(it.start), b = toMin(it.end);
    html += `<div class="lbl">● עכשיו</div><div class="what">${esc(it.title)}</div>
      <div class="sub">${it.teacher ? esc(it.teacher) + ' · ' : ''}עד ${showTime(it.end)} · נשארו ${fmtLeft(Math.ceil(b - m))}</div>
      <div class="prog"><i style="width:${Math.round((m - a) / (b - a) * 100)}%"></i></div>`;
  } else if (next) {
    html += `<div class="lbl">● עוד לא התחיל</div><div class="what">היום מתחיל ב־${showTime(items[0].start)}</div>`;
  } else {
    html += `<div class="lbl">● היום הסתיים</div><div class="what">לילה טוב</div>`;
  }
  if (next) html += `<div class="next">הבא: <b>${esc(next.title)}</b> ב־${showTime(next.start)} (בעוד ${fmtLeft(Math.ceil(toMin(next.start) - m))})</div>`;
  card.innerHTML = html;
  card.classList.remove('hidden');
}

function legend() {
  $('#legend').innerHTML = KIND_KEYS.map(k => `<span class="chip k-${k}">${KINDS[k].label}</span>`).join('');
}

function setDate(d, push = true) {
  state.date = d;
  if (push) history.replaceState(null, '', d === israelNow().date ? location.pathname : '#' + d);
  render();
}
$('#prevDay').onclick = () => setDate(addDays(state.date, -1));
$('#nextDay').onclick = () => setDate(addDays(state.date, 1));
$('#todayBtn').onclick = () => setDate(israelNow().date);
$('#datePick').onchange = e => e.target.value && setDate(e.target.value);
$('#week').onclick = e => { const b = e.target.closest('button[data-d]'); if (b) setDate(b.dataset.d); };
// swipe between days
let sx = null, sy = null;
$('#timeline').addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
$('#timeline').addEventListener('touchend', e => {
  if (sx == null) return;
  const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null;
  if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) setDate(addDays(state.date, dx > 0 ? 1 : -1));
});
addEventListener('keydown', e => {
  if (document.querySelector('.sheet-bg.open') || e.target.matches('input,textarea,select')) return;
  if (e.key === 'ArrowRight') setDate(addDays(state.date, -1));
  if (e.key === 'ArrowLeft') setDate(addDays(state.date, 1));
});

// ---------- registration status ----------
function renderCta() {
  const cta = $('#cta'), u = state.user;
  const banners = [];
  if (!configured) banners.push(`<div class="banner">שירות ההתראות עוד לא הוגדר (חסרות הגדרות Firebase). המערכת מוצגת כרגיל.</div>`);
  if (u?.blocked) banners.push(`<div class="banner bad">החשבון שלך נחסם על ידי המנהל ולא יקבל התראות.</div>`);
  $('#banners').innerHTML = banners.join('');
  cta.classList.toggle('on', !!u);
  if (!u) {
    $('#ctaTitle').textContent = 'התראות על כל שיעור';
    $('#ctaText').textContent = 'קבלו התראה כשמתחיל שיעור, אחרי הפסקה או ארוחה.';
    $('#ctaBtn').textContent = 'הרשמה';
    $('#ctaBtn').onclick = openRegister;
  } else {
    const p = normPrefs(u.prefs);
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    const ok = p.enabled && perm === 'granted' && (u.tokens || []).length;
    $('#ctaTitle').textContent = `שלום ${u.firstName}`;
    $('#ctaText').textContent = ok ? `ההתראות פעילות · ${p.lead ? p.lead + ' דק׳ לפני' : 'בזמן ההתחלה'} · קבוצה ${profileOf(u, state.schedule).group}, ${u.units} יח״ל`
      : perm === 'denied' ? 'ההתראות חסומות בדפדפן. צריך לאשר אותן בהגדרות האתר.'
      : !p.enabled ? 'ההתראות כבויות כרגע.' : 'עוד לא אושרו התראות במכשיר הזה.';
    $('#ctaBtn').textContent = ok ? 'התאמה' : 'הפעלה';
    $('#ctaBtn').onclick = ok ? openSettings : enablePush;
  }
}

function openRegister() {
  if (!configured) { toast('שירות ההתראות עוד לא הוגדר'); return; }
  const u = state.user;
  $('#fn').value = u?.firstName || ''; $('#ln').value = u?.lastName || '';
  setUnits(u?.units || null);
  updateGroupHint();
  $('#iosHint').textContent = isIOS && !standalone ? '📱 באייפון: כדי לקבל התראות צריך קודם להוסיף את האתר למסך הבית (שיתוף ← הוספה למסך הבית) ולהיכנס משם.' : '';
  $('#regErr').textContent = '';
  openSheet('#regSheet');
  setTimeout(() => $('#fn').focus(), 250);
}
let units = null;
function setUnits(v) { units = v; document.querySelectorAll('#unitsSeg button').forEach(b => b.classList.toggle('on', +b.dataset.v === v)); }
$('#unitsSeg').onclick = e => { const b = e.target.closest('button'); if (b) setUnits(+b.dataset.v); };
function updateGroupHint() {
  const ln = $('#ln').value.trim();
  $('#groupHint').textContent = ln ? `לפי שם המשפחה: קבוצה ${groupFor(ln, state.schedule?.groupRule?.letters)} (בהיסטוריה, לשון, תנ״ך, תורה והבעה)` : '';
}
$('#ln').oninput = updateGroupHint;

$('#regForm').onsubmit = async e => {
  e.preventDefault();
  const firstName = $('#fn').value.trim(), lastName = $('#ln').value.trim();
  const err = $('#regErr');
  if (!firstName || !lastName) { err.textContent = 'צריך למלא שם פרטי ושם משפחה'; return; }
  if (!/[א-ת]/.test(lastName)) { err.textContent = 'כתבו את שם המשפחה בעברית'; return; }
  if (!units) { err.textContent = 'צריך לבחור 4 או 5 יחידות'; return; }
  const btn = $('#regSubmit'); btn.disabled = true; err.textContent = '';
  try {
    const { auth, db, A, F } = await firebase();
    if (!auth.currentUser) await A.signInAnonymously(auth);
    const uid = auth.currentUser.uid;
    let token = null, notif = 'granted';
    try { token = await pushToken(); } catch (x) { notif = x.message === 'denied' ? 'denied' : 'unsupported'; console.warn(x); }
    const ref = F.doc(db, 'users', uid);
    const base = { firstName, lastName, units, group: groupFor(lastName, state.schedule?.groupRule?.letters), notif, ua: navigator.userAgent.slice(0, 180), lastSeen: F.serverTimestamp() };
    if (state.user) {
      await F.updateDoc(ref, { ...base, ...(token ? { tokens: F.arrayUnion(token) } : {}) });
    } else {
      await F.setDoc(ref, { ...base, prefs: DEFAULT_PREFS, tokens: token ? [token] : [], createdAt: F.serverTimestamp() });
    }
    closeSheet(btn);
    toast(token ? 'נרשמת! ההתראות פעילות ✓' : notif === 'denied' ? 'נרשמת, אבל ההתראות חסומות בדפדפן' : 'נרשמת. המכשיר הזה לא תומך בהתראות' + (isIOS && !standalone ? ' (צריך להוסיף למסך הבית)' : ''));
  } catch (x) {
    console.error(x);
    err.textContent = x.code === 'permission-denied' ? 'אין הרשאה (ייתכן שהחשבון נחסם)' : 'משהו השתבש: ' + (x.code || x.message);
  } finally { btn.disabled = false; }
};

async function enablePush() {
  try {
    const token = await pushToken();
    const { db, F } = await firebase();
    await F.updateDoc(F.doc(db, 'users', state.uid), { tokens: F.arrayUnion(token), notif: 'granted', 'prefs.enabled': true });
    toast('ההתראות פעילות ✓');
  } catch (x) {
    toast(x.message === 'denied' ? 'ההתראות חסומות. אפשרו אותן בהגדרות האתר בדפדפן' : x.message === 'unsupported' ? (isIOS && !standalone ? 'באייפון צריך קודם להוסיף את האתר למסך הבית' : 'הדפדפן הזה לא תומך בהתראות') : 'שגיאה: ' + (x.code || x.message));
  }
}

// ---------- settings ----------
function openSettings() {
  const u = state.user;
  const body = $('#setBody');
  if (!u) {
    const vp = state.viewProfile || {};
    body.innerHTML = `<p class="hint">עוד לא נרשמת. אפשר לבחור איך להציג את המערכת, או להירשם כדי לקבל התראות.</p>
      <div class="field"><label>קבוצה</label><div class="seg" id="vpG"><button data-v="1">קבוצה 1 (א–ל)</button><button data-v="2">קבוצה 2 (מ–ת)</button></div></div>
      <div class="field"><label>אנגלית</label><div class="seg" id="vpU"><button data-v="4">4 יח״ל</button><button data-v="5">5 יח״ל</button></div></div>
      <div class="actions"><button class="btn" id="vpClear">הצג הכול</button><button class="btn primary" id="vpReg">הרשמה להתראות</button></div>`;
    const mark = () => { body.querySelectorAll('#vpG button').forEach(b => b.classList.toggle('on', +b.dataset.v === state.viewProfile?.group)); body.querySelectorAll('#vpU button').forEach(b => b.classList.toggle('on', +b.dataset.v === state.viewProfile?.units)); };
    const setVp = (k, v) => { state.viewProfile = { ...(state.viewProfile || {}), [k]: v }; store.set('viewProfile', state.viewProfile); mark(); render(); };
    body.querySelector('#vpG').onclick = e => { const b = e.target.closest('button'); if (b) setVp('group', +b.dataset.v); };
    body.querySelector('#vpU').onclick = e => { const b = e.target.closest('button'); if (b) setVp('units', +b.dataset.v); };
    body.querySelector('#vpClear').onclick = () => { state.viewProfile = null; store.set('viewProfile', null); mark(); render(); };
    body.querySelector('#vpReg').onclick = () => { closeSheet(body); openRegister(); };
    mark(); openSheet('#setSheet'); return;
  }
  const p = normPrefs(u.prefs);
  const learnFirst = ['lesson', 'seder', 'prayer', 'meal', 'break', 'activity', 'routine'];
  body.innerHTML = `
    <div class="row" style="margin:14px 0"><div class="grow"><b>התראות</b><div class="hint">הפעלה או השתקה של כל ההתראות</div></div>
      <label class="switch"><input type="checkbox" id="pEnabled" ${p.enabled ? 'checked' : ''}><span></span></label></div>
    <div class="field"><label>מתי להתריע</label>
      <select class="input" id="pLead">${[0, 1, 2, 3, 5, 10].map(n => `<option value="${n}" ${n === p.lead ? 'selected' : ''}>${n ? `${n} דקות לפני` : 'בדיוק בזמן ההתחלה'}</option>`).join('')}</select></div>
    <div class="field"><label>באילו ימים</label><div class="daypick">${WEEKDAY_LETTERS.slice(0, 6).map((l, i) => `<label><input type="checkbox" data-day="${i}" ${p.days[i] ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
    <div class="field"><label>על אילו מעברים להתריע</label>
      <div class="hint">שורה = מה נגמר, עמודה = מה מתחיל. למשל: הפסקה ← שיעור.</div>
      <div class="row" style="gap:6px;flex-wrap:wrap;margin:6px 0">
        <button class="btn small" data-preset="learn">רק כניסה לשיעורים</button>
        <button class="btn small" data-preset="all">כל מעבר</button>
        <button class="btn small" data-preset="none">ניקוי</button>
      </div>
      <div class="scrollx"><table class="matrix"><thead><tr><th></th>${learnFirst.map(k => `<th><div class="colhead">${KINDS[k].label}</div></th>`).join('')}</tr></thead>
      <tbody>${learnFirst.map(f => `<tr><th class="from">${KINDS[f].label} ←</th>${learnFirst.map(t => `<td><input type="checkbox" data-rule="${f}>${t}" ${p.rules.includes(`${f}>${t}`) ? 'checked' : ''} aria-label="${KINDS[f].label} אל ${KINDS[t].label}"></td>`).join('')}</tr>`).join('')}</tbody></table></div>
    </div>
    <div class="actions"><button class="btn" id="pTest">התראת ניסיון</button><button class="btn primary" id="pSave">שמירה</button></div>
    <hr style="border:0;border-top:1px solid var(--line);margin:20px 0">
    <div class="row"><div class="grow"><b>${esc(u.firstName)} ${esc(u.lastName)}</b><div class="hint">קבוצה ${profileOf(u, state.schedule).group} · ${u.units} יח״ל אנגלית</div></div>
      <button class="btn small" id="pEdit">עריכת פרטים</button></div>
    <div class="actions"><button class="btn danger" id="pLeave">ביטול הרשמה</button></div>`;
  body.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => {
    const learn = ['lesson', 'seder'];
    body.querySelectorAll('[data-rule]').forEach(c => {
      const [f, t] = c.dataset.rule.split('>');
      c.checked = b.dataset.preset === 'all' ? f !== t || learn.includes(t) : b.dataset.preset === 'learn' ? DEFAULT_PREFS.rules.includes(c.dataset.rule) : false;
    });
  });
  body.querySelector('#pSave').onclick = async () => {
    const prefs = {
      enabled: body.querySelector('#pEnabled').checked,
      lead: +body.querySelector('#pLead').value,
      days: [...body.querySelectorAll('[data-day]')].map(c => c.checked),
      rules: [...body.querySelectorAll('[data-rule]:checked')].map(c => c.dataset.rule),
    };
    try {
      const { db, F } = await firebase();
      await F.updateDoc(F.doc(db, 'users', state.uid), { prefs });
      toast('ההגדרות נשמרו ✓'); closeSheet(body);
    } catch (x) { toast('שגיאה בשמירה: ' + (x.code || x.message)); }
  };
  body.querySelector('#pTest').onclick = async () => {
    try {
      if (Notification.permission !== 'granted') await enablePush();
      const reg = await navigator.serviceWorker.getRegistration(new URL('./', location.href).pathname);
      const opts = { body: 'כך תיראה התראה לפני שיעור', icon: 'icon-192.png', badge: 'icon-192.png', lang: 'he', dir: 'rtl', data: { url: location.href } };
      if (reg) await reg.showNotification('בעוד 2 דק׳: אנגלית', opts); else new Notification('בעוד 2 דק׳: אנגלית', opts);
    } catch (x) { toast('לא ניתן להציג התראה במכשיר הזה'); }
  };
  body.querySelector('#pEdit').onclick = () => { closeSheet(body); openRegister(); };
  body.querySelector('#pLeave').onclick = async () => {
    if (!confirm('לבטל את ההרשמה? לא יגיעו יותר התראות.')) return;
    try {
      const { auth, db, F, A } = await firebase();
      await F.deleteDoc(F.doc(db, 'users', state.uid));
      await A.signOut(auth);
      closeSheet(body); toast('ההרשמה בוטלה');
    } catch (x) { toast('שגיאה: ' + (x.code || x.message)); }
  };
  openSheet('#setSheet');
}
$('#openSettings').onclick = openSettings;

// ---------- messages ----------
function renderMsgs() {
  const seen = store.get('seenMsgs', 0);
  const unread = state.messages.filter(m => (m.createdAt?.toMillis?.() || 0) > seen).length;
  $('#openMsgs').dataset.n = unread;
  const fmt = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });
  $('#msgList').innerHTML = state.messages.length ? state.messages.map(m => `<div class="msg"><b>${esc(m.title)}</b>${m.body ? `<div>${esc(m.body)}</div>` : ''}<time>${m.createdAt ? fmt.format(m.createdAt.toDate()) : ''}${m.audience === 'some' ? ' · אישית' : ''}</time></div>`).join('')
    : `<div class="empty"><div class="big">📭</div><p>${state.user ? 'אין הודעות' : 'אחרי ההרשמה יופיעו כאן הודעות מהמנהל'}</p></div>`;
}
$('#openMsgs').onclick = () => {
  renderMsgs(); openSheet('#msgSheet');
  const last = Math.max(0, ...state.messages.map(m => m.createdAt?.toMillis?.() || 0));
  store.set('seenMsgs', Math.max(store.get('seenMsgs', 0), last));
  $('#openMsgs').dataset.n = 0;
};

// ---------- data ----------
async function loadDefault() {
  const r = await fetch('schedule-default.json', { cache: 'no-cache' });
  return r.json();
}

async function connect() {
  const { auth, db, A, F } = await firebase();
  F.onSnapshot(F.doc(db, 'config', 'schedule'), snap => {
    if (snap.exists()) { state.schedule = snap.data(); store.set('schedule', state.schedule); render(); renderCta(); }
  }, e => console.warn('schedule', e));
  let unsubs = [];
  A.onAuthStateChanged(auth, user => {
    unsubs.forEach(f => f()); unsubs = [];
    state.uid = user?.uid || null;
    if (!user) { state.user = null; state.messages = []; renderCta(); render(); renderMsgs(); return; }
    let touched = false;
    unsubs.push(F.onSnapshot(F.doc(db, 'users', user.uid), async snap => {
      state.user = snap.exists() ? snap.data() : null;
      renderCta(); render();
      if (state.user && !touched && !state.user.blocked) {
        touched = true;
        const upd = { lastSeen: F.serverTimestamp() };
        // keep this device's push token fresh
        if ('Notification' in window && Notification.permission === 'granted') {
          try { const t = await pushToken(); if (!(state.user.tokens || []).includes(t)) upd.tokens = F.arrayUnion(t); upd.notif = 'granted'; } catch {}
        }
        F.updateDoc(snap.ref, upd).catch(() => {});
      }
    }, () => {}));
    const msgs = { all: [], me: [] };
    const merge = () => { state.messages = [...msgs.all, ...msgs.me].sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)).slice(0, 50); renderMsgs(); };
    unsubs.push(F.onSnapshot(F.query(F.collection(db, 'messages'), F.where('audience', '==', 'all')), s => { msgs.all = s.docs.map(d => d.data()); merge(); }, () => {}));
    unsubs.push(F.onSnapshot(F.query(F.collection(db, 'messages'), F.where('uids', 'array-contains', user.uid)), s => { msgs.me = s.docs.map(d => d.data()); merge(); }, () => {}));
  });
  onForegroundPush(p => toast(`${p.notification?.title || ''} ${p.notification?.body ? '· ' + p.notification.body : ''}`)).catch(() => {});
}

(async function init() {
  legend();
  const h = location.hash.slice(1);
  state.date = /^\d{4}-\d{2}-\d{2}$/.test(h) ? h : israelNow().date;
  state.schedule = store.get('schedule', null);
  if (!state.schedule || !configured) state.schedule = await loadDefault();
  render(); renderCta(); renderMsgs();
  if (configured) connect().catch(e => { console.error(e); toast('אין חיבור לשרת. מוצגת המערכת השמורה'); });
  // keep the now-line moving; jump to the new day at midnight if the user is on "today"
  let lastToday = israelNow().date;
  setInterval(() => {
    const t = israelNow().date;
    if (t !== lastToday && state.date === lastToday) state.date = t;
    lastToday = t;
    render();
  }, 30000);
  addEventListener('hashchange', () => { const h = location.hash.slice(1); if (/^\d{4}-\d{2}-\d{2}$/.test(h) && h !== state.date) setDate(h, false); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  // scroll the current item into view on first load
  requestAnimationFrame(() => document.querySelector('.item.cur')?.scrollIntoView({ block: 'center' }));
})();
