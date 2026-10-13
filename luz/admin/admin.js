import { KINDS, KIND_KEYS, WEEKDAYS, ADMIN_EMAIL, toMin, toHHMM, showTime, israelNow, weekdayOf, addDays, groupFor, normPrefs, validateDay, uid } from '../core.js';
import { configured, firebase } from '../firebase.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 3000); }
function openSheet(id) { $(id).classList.add('open'); }
function closeSheet(id) { $(id).classList.remove('open'); }
document.addEventListener('click', e => {
  if (e.target.matches('[data-close]')) e.target.closest('.sheet-bg').classList.remove('open');
  else if (e.target.classList.contains('sheet-bg')) e.target.classList.remove('open');
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.sheet-bg.open').forEach(x => x.classList.remove('open')); });
const ICON = {
  grip: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
  edit: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  copy: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  trash: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
};

const S = {
  demo: false,
  fb: null,
  published: null,     // last saved schedule
  draft: null,         // working copy
  history: [],
  key: 'd' + Math.min(israelNow().weekday, 5),   // 'd0'..'d5' | 't:<id>' | 'date:YYYY-MM-DD'
  dragMode: 'slots',
  users: [],
  messages: [],
  selected: new Set(),
  status: null,
};

// ================= auth =================
async function start() {
  if (!configured) {
    $('#loginMsg').innerHTML = 'Firebase עוד לא הוגדר (הקובץ <code>firebase-config.js</code> ריק). אפשר להיכנס למצב תצוגה בלי שמירה.';
    $('#googleBtn').textContent = 'מצב תצוגה';
    $('#googleBtn').onclick = () => enter(null);
    return;
  }
  S.fb = await firebase();
  const { auth, A } = S.fb;
  A.getRedirectResult(auth).catch(e => showLoginError(e));
  A.onAuthStateChanged(auth, user => {
    if (!user || user.isAnonymous) { $('#login').classList.remove('hidden'); $('#app').classList.add('hidden'); $('#logout').classList.add('hidden'); return; }
    if (user.email !== ADMIN_EMAIL) {
      $('#loginMsg').innerHTML = `החשבון <b>${esc(user.email)}</b> אינו מנהל. הכניסה מותרת רק ל־${ADMIN_EMAIL}.`;
      A.signOut(auth); return;
    }
    enter(user);
  });
  $('#googleBtn').onclick = async () => {
    const p = new A.GoogleAuthProvider(); p.setCustomParameters({ login_hint: ADMIN_EMAIL, prompt: 'select_account' });
    try { await A.signInWithPopup(auth, p); }
    catch (e) {
      if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') A.signInWithRedirect(auth, p);
      else showLoginError(e);
    }
  };
  $('#logout').onclick = () => A.signOut(auth).then(() => location.reload());
}
function showLoginError(e) {
  if (!e) return;
  $('#loginMsg').textContent = e.code === 'auth/unauthorized-domain' ? 'הדומיין הזה לא מאושר ב-Firebase. צריך להוסיף אותו ב-Authentication → Settings → Authorized domains.' : 'ההתחברות נכשלה: ' + (e.code || e.message);
}

async function enter(user) {
  S.demo = !user;
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  if (user) { $('#logout').classList.remove('hidden'); $('#who').textContent = user.email; }
  else $('#who').textContent = 'מצב תצוגה · שום דבר לא נשמר';
  const def = await (await fetch('../schedule-default.json', { cache: 'no-cache' })).json();
  S.defaultSchedule = def;
  if (S.demo) {
    setPublished(def);
    S.users = demoUsers();
    renderUsers();
  } else {
    const { db, F } = S.fb;
    const snap = await F.getDoc(F.doc(db, 'config', 'schedule'));
    if (!snap.exists()) { await F.setDoc(F.doc(db, 'config', 'schedule'), def); toast('המערכת המקורית נטענה לשרת'); }
    F.onSnapshot(F.doc(db, 'config', 'schedule'), s => { if (s.exists() && !isDirty()) setPublished(s.data()); else if (s.exists()) S.published = s.data(); });
    F.onSnapshot(F.collection(db, 'users'), s => { S.users = s.docs.map(d => ({ id: d.id, ...d.data() })); renderUsers(); renderAudHint(); });
    F.onSnapshot(F.query(F.collection(db, 'messages'), F.orderBy('createdAt', 'desc'), F.limit(100)), s => { S.messages = s.docs.map(d => ({ id: d.id, ...d.data() })); renderMessages(); });
    F.onSnapshot(F.doc(db, 'sent', 'status'), s => { S.status = s.exists() ? s.data() : null; renderStatus(); }, () => renderStatus());
    setInterval(renderStatus, 30000);
  }
  renderStatus();
}

function demoUsers() {
  const names = [['נועם', 'אברהם', 5], ['איתי', 'כהן', 4], ['יונתן', 'לוי', 5], ['אורי', 'מזרחי', 4], ['דביר', 'שפירא', 5], ['הראל', 'רוזן', 4]];
  return names.map(([f, l, u], i) => ({ id: 'demo' + i, firstName: f, lastName: l, units: u, group: groupFor(l), tokens: i % 3 ? ['x'] : [], notif: i % 3 ? 'granted' : 'denied', prefs: normPrefs(), blocked: i === 5, createdAt: null, lastSeen: null }));
}

// ================= tabs =================
$('#tabs').onclick = e => {
  const b = e.target.closest('button[data-tab]'); if (!b) return;
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('[data-pane]').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== b.dataset.tab));
  if (b.dataset.tab === 'settings') fillSettings();
};

// ================= schedule draft =================
function setPublished(s) {
  S.published = clone(s);
  S.draft = clone(s);
  S.draft.days ||= {}; S.draft.templates ||= {}; S.draft.dates ||= {}; S.draft.subjects ||= [];
  S.history = [];
  renderSchedule();
}
const isDirty = () => S.draft && S.published && JSON.stringify(S.draft) !== JSON.stringify(S.published);
function change(fn) {
  S.history.push(JSON.stringify(S.draft));
  if (S.history.length > 80) S.history.shift();
  fn(S.draft);
  renderSchedule();
}
$('#undoBtn').onclick = () => { if (S.history.length) { S.draft = JSON.parse(S.history.pop()); renderSchedule(); } };
addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.target.matches('input,textarea')) { e.preventDefault(); $('#undoBtn').click(); } });
addEventListener('beforeunload', e => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });

$('#saveBtn').onclick = async () => {
  // refuse to publish a day with broken times
  const bad = Object.entries(allDayLists(S.draft)).find(([, items]) => Object.keys(validateDay(items)).length);
  if (bad && !confirm(`יש בעיות בשעות ב"${keyLabel(bad[0])}". לשמור בכל זאת?`)) { selectKey(bad[0]); return; }
  // drop overrides older than a week
  const cutoff = addDays(israelNow().date, -7);
  for (const d of Object.keys(S.draft.dates)) if (d < cutoff) delete S.draft.dates[d];
  if (S.demo) { S.published = clone(S.draft); renderSchedule(); toast('מצב תצוגה: לא נשמר בשרת'); return; }
  const btn = $('#saveBtn'); btn.disabled = true;
  try {
    const { db, F } = S.fb;
    await F.setDoc(F.doc(db, 'config', 'schedule'), { ...S.draft, updatedAt: F.serverTimestamp() });
    S.published = clone(S.draft); delete S.published.updatedAt;
    S.draft = clone(S.published);
    renderSchedule(); toast('המערכת נשמרה ופורסמה ✓');
  } catch (e) { toast('שגיאה בשמירה: ' + (e.code || e.message)); btn.disabled = false; }
};

function allDayLists(s) {
  const out = {};
  for (const [k, v] of Object.entries(s.days || {})) out['d' + k] = v;
  for (const [k, v] of Object.entries(s.templates || {})) out['t:' + k] = v.items;
  for (const [k, v] of Object.entries(s.dates || {})) if (v.items) out['date:' + k] = v.items;
  return out;
}
function keyLabel(key) {
  if (key[0] === 'd' && key[1] !== 'a') return 'יום ' + WEEKDAYS[+key.slice(1)];
  if (key.startsWith('t:')) return S.draft.templates[key.slice(2)]?.name || 'תבנית';
  const d = key.slice(5); return `${WEEKDAYS[weekdayOf(d)]} ${+d.slice(8)}/${+d.slice(5, 7)}`;
}
// the item list being edited, or null when the date has no list of its own
function curList(s = S.draft) {
  const k = S.key;
  if (k.startsWith('date:')) { const o = s.dates[k.slice(5)]; return o?.items || null; }
  if (k.startsWith('t:')) return s.templates[k.slice(2)]?.items || null;
  return (s.days[k.slice(1)] ||= []);
}
function selectKey(k) { S.key = k; renderSchedule(); }

function renderSchedule() {
  if (!S.draft) return;
  const dirty = isDirty();
  $('#savebar').classList.toggle('dirty', dirty);
  $('#dirtyMsg').textContent = dirty ? 'יש שינויים שלא פורסמו' : 'כל השינויים שמורים';
  $('#saveBtn').disabled = !dirty; $('#undoBtn').disabled = !S.history.length;

  const tabs = [0, 1, 2, 3, 4, 5].map(i => `<button data-k="d${i}" class="${S.key === 'd' + i ? 'on' : ''}">${WEEKDAYS[i]}</button>`)
    .concat(Object.entries(S.draft.templates).map(([id, t]) => `<button data-k="t:${id}" class="${S.key === 't:' + id ? 'on' : ''}">📋 ${esc(t.name)}</button>`));
  $('#dayTabs').innerHTML = tabs.join('');
  const today = israelNow().date;
  $('#dateChips').innerHTML = Object.keys(S.draft.dates).sort().filter(d => d >= addDays(today, -7))
    .map(d => `<button class="datechip ${S.key === 'date:' + d ? 'on' : ''}" data-k="date:${d}">${keyLabel('date:' + d)}${S.draft.dates[d].off ? ' · חופש' : S.draft.dates[d].template ? ' · תבנית' : ''}</button>`).join('');
  if (S.key.startsWith('date:')) $('#dateKey').value = S.key.slice(5);

  renderDayHead();
  renderLib();
  renderItems();
}
$('#dayTabs').onclick = e => { const b = e.target.closest('[data-k]'); if (b) selectKey(b.dataset.k); };
$('#dateChips').onclick = e => { const b = e.target.closest('[data-k]'); if (b) selectKey(b.dataset.k); };
$('#dateKey').onchange = e => { if (e.target.value) selectKey('date:' + e.target.value); };

function renderDayHead() {
  const el = $('#dayHead'), k = S.key;
  if (k.startsWith('date:')) {
    const d = k.slice(5), o = S.draft.dates[d], wd = weekdayOf(d);
    const tplOpts = Object.entries(S.draft.templates).map(([id, t]) => `<button class="btn small" data-act="tpl" data-id="${id}">לפי ${esc(t.name)}</button>`).join('');
    if (!o) {
      el.innerHTML = `<b>${keyLabel(k)}</b><p class="hint">אין שינוי לתאריך הזה, ולכן הוא לפי ${wd === 6 ? 'שבת (אין מערכת)' : 'יום ' + WEEKDAYS[wd]}. אפשר ליצור לו מערכת מיוחדת:</p>
        <div class="row wrapline">${wd < 6 ? `<button class="btn small primary" data-act="copyDay">עריכה על בסיס יום ${WEEKDAYS[wd]}</button>` : ''}${tplOpts}<button class="btn small" data-act="empty">מערכת ריקה</button><button class="btn small" data-act="off">יום ללא לימודים</button></div>`;
    } else {
      el.innerHTML = `<div class="row wrapline"><b class="grow">${keyLabel(k)} · ${o.off ? 'יום ללא לימודים' : o.template ? 'לפי ' + esc(S.draft.templates[o.template]?.name || 'תבנית') : 'מערכת מיוחדת'}</b>
        ${o.template ? '<button class="btn small" data-act="detach">עריכה חופשית</button>' : ''}
        <button class="btn small danger" data-act="removeDate">ביטול השינוי (חזרה לרגיל)</button></div>
        <div class="field"><label for="dNote">הודעה שתופיע ביום הזה</label><input class="input" id="dNote" value="${esc(o.note || '')}" placeholder="${o.off ? 'למשל: חופשת סוכות' : 'למשל: יום סיור'}"></div>`;
      el.querySelector('#dNote').onchange = e => change(s => { s.dates[d].note = e.target.value.trim(); });
    }
  } else if (k.startsWith('t:')) {
    const id = k.slice(2), t = S.draft.templates[id];
    el.innerHTML = `<div class="row wrapline"><div class="field grow" style="margin:0"><label for="tName">שם התבנית</label><input class="input" id="tName" value="${esc(t.name)}"></div>
      <button class="btn small danger" data-act="delTpl">מחיקת התבנית</button></div>
      <p class="hint">תבנית היא מערכת מוכנה שאפשר להחיל על תאריך מסוים (למשל יום ראשון של שבת בבית).</p>`;
    el.querySelector('#tName').onchange = e => change(s => { s.templates[id].name = e.target.value.trim() || 'תבנית'; });
  } else {
    const wd = +k.slice(1);
    el.innerHTML = `<div class="row wrapline"><b class="grow">המערכת הקבועה של יום ${WEEKDAYS[wd]}</b>
      <select class="input" id="copyTo" style="width:auto"><option value="">העתקת היום הזה אל…</option>${[0, 1, 2, 3, 4, 5].filter(i => i !== wd).map(i => `<option value="d${i}">יום ${WEEKDAYS[i]}</option>`).join('')}<option value="newtpl">תבנית חדשה</option></select></div>`;
    el.querySelector('#copyTo').onchange = e => {
      const to = e.target.value; e.target.value = ''; if (!to) return;
      if (to === 'newtpl') { const name = prompt('שם התבנית:', `יום ${WEEKDAYS[wd]} מיוחד`); if (!name) return; const id = uid(); change(s => { s.templates[id] = { name, items: fresh(s.days[wd]) }; }); selectKey('t:' + id); return; }
      if (!confirm(`להחליף את כל המערכת של יום ${WEEKDAYS[+to.slice(1)]}?`)) return;
      change(s => { s.days[to.slice(1)] = fresh(s.days[wd]); }); toast('הועתק');
    };
  }
}
const fresh = items => clone(items || []).map(x => ({ ...x, id: uid() }));
$('#dayHead').onclick = e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const d = S.key.slice(5);
  switch (b.dataset.act) {
    case 'copyDay': change(s => { s.dates[d] = { items: fresh(s.days[weekdayOf(d)]), note: '' }; }); break;
    case 'tpl': change(s => { s.dates[d] = { template: b.dataset.id, note: '' }; }); break;
    case 'empty': change(s => { s.dates[d] = { items: [], note: '' }; }); break;
    case 'off': change(s => { s.dates[d] = { off: true, note: '' }; }); break;
    case 'detach': change(s => { const o = s.dates[d]; s.dates[d] = { items: fresh(s.templates[o.template]?.items), note: o.note || '' }; }); break;
    case 'removeDate': change(s => { delete s.dates[d]; }); break;
    case 'delTpl': if (confirm('למחוק את התבנית?')) { const id = S.key.slice(2); change(s => { delete s.templates[id]; for (const x of Object.values(s.dates)) if (x.template === id) { delete x.template; x.items = []; } }); selectKey('d0'); } break;
  }
};

// ---------- item list ----------
function describe(it) {
  if (it.split && it.variants) {
    const lab = it.split === 'group' ? k => `ק׳ ${k}` : k => `${k} יח״ל`;
    return Object.entries(it.variants).map(([k, v]) => `${lab(k)}: ${v.title && !v.title.startsWith(it.title) ? v.title + ' – ' : ''}${v.teacher || '—'}`).join(' · ');
  }
  return [it.teacher, it.note].filter(Boolean).join(' · ');
}
function renderItems() {
  const list = curList();
  const box = $('#items');
  const editable = !!list;
  $('#addBtn').disabled = $('#flowBtn').disabled = !editable;
  if (!list) {
    const o = S.key.startsWith('date:') && S.draft.dates[S.key.slice(5)];
    box.innerHTML = `<div class="empty"><p>${o?.off ? 'יום ללא לימודים' : o?.template ? 'התאריך משתמש בתבנית. כדי לשנות פריטים לחצו "עריכה חופשית".' : 'בחרו למעלה איך ליצור את המערכת לתאריך הזה'}</p></div>`;
    return;
  }
  const issues = validateDay(list);
  box.innerHTML = list.length ? list.map((it, i) => `
    <div class="it k-${it.kind} ${issues[i] ? 'bad' : ''}" data-i="${i}">
      <div class="handle" aria-label="גרירה">${ICON.grip}</div>
      <div class="tm">${showTime(it.start)}–${showTime(it.end)}<small>${toMin(it.end) - toMin(it.start)} דק׳</small></div>
      <div class="nm"><b>${esc(it.title)} <span class="chip" style="display:inline-flex">${KINDS[it.kind]?.label || ''}</span></b><span>${esc(describe(it)) || '&nbsp;'}</span>${issues[i] ? `<div class="issue">⚠ ${issues[i]}</div>` : ''}</div>
      <div class="ops"><button data-op="edit" aria-label="עריכה">${ICON.edit}</button><button data-op="dup" aria-label="שכפול">${ICON.copy}</button><button data-op="del" aria-label="מחיקה">${ICON.trash}</button></div>
    </div>`).join('') : `<div class="empty"><p>אין עדיין פריטים. הוסיפו מהמאגר או בכפתור "+ הוספה".</p></div>`;
}
$('#items').addEventListener('click', e => {
  const b = e.target.closest('[data-op]'); if (!b) { const row = e.target.closest('.it'); if (row && !e.target.closest('.handle')) editItem(+row.dataset.i); return; }
  const i = +b.closest('.it').dataset.i;
  if (b.dataset.op === 'edit') editItem(i);
  if (b.dataset.op === 'dup') change(() => { const l = curList(); const x = clone(l[i]); x.id = uid(); const dur = toMin(x.end) - toMin(x.start); x.start = x.end; x.end = toHHMM(Math.min(toMin(x.start) + dur, 1439)); l.splice(i + 1, 0, x); });
  if (b.dataset.op === 'del') { const it = curList()[i]; change(() => curList().splice(i, 1)); toast(`"${it.title}" נמחק · אפשר לבטל`); }
});

$('#dragMode').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.dragMode = b.dataset.v; [...e.currentTarget.children].forEach(x => x.classList.toggle('on', x === b)); };
$('#flowBtn').onclick = () => change(() => {
  const l = curList(); l.sort((a, b) => toMin(a.start) - toMin(b.start));
  for (let i = 1; i < l.length; i++) { const dur = toMin(l[i].end) - toMin(l[i].start); l[i].start = l[i - 1].end; l[i].end = toHHMM(Math.min(toMin(l[i].start) + Math.max(dur, 5), 1439)); }
});
$('#addBtn').onclick = () => {
  const l = curList(); const last = l[l.length - 1];
  const start = last ? last.end : '08:00';
  editItem(-1, { id: uid(), start, end: toHHMM(Math.min(toMin(start) + 45, 1439)), kind: 'lesson', title: '' });
};

// reorder rows: either the time windows stay and the content moves between them ("slots"),
// or each item carries its duration and the day is re-flowed from the first start ("flow").
function reorder(from, to) {
  if (from === to) return;
  change(() => {
    const l = curList();
    if (S.dragMode === 'slots') {
      // the time windows stay put; the content moves between them
      const slots = l.map(x => [x.start, x.end]);
      const [m] = l.splice(from, 1); l.splice(to, 0, m);
      l.forEach((x, i) => { [x.start, x.end] = slots[i]; });
    } else {
      const start = l.length ? toMin(l[0].start) : 480;
      const [m] = l.splice(from, 1); l.splice(to, 0, m);
      let t = start;
      for (const x of l) { const dur = toMin(x.end) - toMin(x.start); x.start = toHHMM(t); t += Math.max(dur, 5); x.end = toHHMM(Math.min(t, 1439)); }
    }
  });
  requestAnimationFrame(() => $('#items').children[to]?.classList.add('drop-flash'));
}

// pointer-based drag (works with touch and mouse)
$('#items').addEventListener('pointerdown', e => {
  const h = e.target.closest('.handle'); if (!h) return;
  e.preventDefault();
  const row = h.closest('.it'), box = $('#items');
  const from = +row.dataset.i;
  const rows = [...box.children];
  const startY = e.clientY;
  row.classList.add('dragging');
  let to = from;
  const rects = rows.map(r => r.getBoundingClientRect());
  const move = ev => {
    const dy = ev.clientY - startY;
    row.style.transform = `translateY(${dy}px)`;
    const y = rects[from].top + rects[from].height / 2 + dy;
    to = rects.filter((r, i) => i !== from && r.top + r.height / 2 < y).length;
    rows.forEach((r, i) => {
      if (r === row) return;
      const shift = from < to && i > from && i <= to ? -rects[from].height - 6 : from > to && i >= to && i < from ? rects[from].height + 6 : 0;
      r.style.transition = 'transform .15s'; r.style.transform = shift ? `translateY(${shift}px)` : '';
    });
    autoscroll(ev.clientY);
  };
  const up = () => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
    rows.forEach(r => { r.style.transform = ''; r.style.transition = ''; });
    row.classList.remove('dragging');
    reorder(from, to);
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
});
function autoscroll(y) { if (y < 70) scrollBy(0, -12); else if (y > innerHeight - 70) scrollBy(0, 12); }

// ---------- subject library ----------
function renderLib() {
  const lib = S.draft.subjects;
  $('#lib').innerHTML = lib.length ? lib.map((s, i) => `<span class="chip k-${s.kind}" data-s="${i}" title="${esc(describe(s))}">${esc(s.title)}${s.split ? ' ⑂' : ''}</span>`).join('') : '<span class="hint">המאגר ריק</span>';
  $('#titles').innerHTML = lib.map(s => `<option value="${esc(s.title)}">`).join('');
}
function itemFromSubject(s, start) {
  const it = { id: uid(), start, end: toHHMM(Math.min(toMin(start) + 45, 1439)), kind: s.kind, title: s.title };
  if (s.teacher) it.teacher = s.teacher;
  if (s.split) { it.split = s.split; it.variants = clone(s.variants); }
  return it;
}
$('#lib').addEventListener('pointerdown', e => {
  const chip = e.target.closest('[data-s]'); if (!chip || !curList()) return;
  e.preventDefault();
  const s = S.draft.subjects[+chip.dataset.s];
  const x0 = e.clientX, y0 = e.clientY;
  let ghost = null, mark = null, at = -1;
  const box = $('#items');
  const move = ev => {
    if (!ghost && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
    if (!ghost) { ghost = chip.cloneNode(true); ghost.classList.add('ghost'); document.body.appendChild(ghost); mark = document.createElement('div'); mark.className = 'insert-mark'; }
    ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px';
    const r = box.getBoundingClientRect();
    if (ev.clientY > r.top - 20 && ev.clientY < r.bottom + 20) {
      const rows = [...box.querySelectorAll('.it')];
      at = rows.findIndex(row => { const b = row.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; });
      if (at < 0) at = rows.length;
      if (rows[at]) box.insertBefore(mark, rows[at]); else box.appendChild(mark);
    } else { at = -1; mark.remove(); }
    autoscroll(ev.clientY);
  };
  const up = () => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
    ghost?.remove(); mark?.remove();
    const l = curList();
    if (!ghost) { const last = l[l.length - 1]; change(() => curList().push(itemFromSubject(s, last ? last.end : '08:00'))); toast(`נוסף "${s.title}" בסוף היום`); return; }
    if (at < 0) return;
    const prev = l[at - 1];
    const start = prev ? prev.end : (l[0] ? toHHMM(Math.max(0, toMin(l[0].start) - 45)) : '08:00');
    change(() => {
      const list = curList(); const it = itemFromSubject(s, start);
      // make room: in flow mode push the rest later, otherwise squeeze into the gap
      if (S.dragMode === 'flow') { const dur = toMin(it.end) - toMin(it.start); for (let i = at; i < list.length; i++) { list[i].start = toHHMM(Math.min(toMin(list[i].start) + dur, 1435)); list[i].end = toHHMM(Math.min(toMin(list[i].end) + dur, 1439)); } }
      else if (list[at] && toMin(it.end) > toMin(list[at].start)) it.end = toMin(list[at].start) > toMin(it.start) ? list[at].start : it.end;
      list.splice(at, 0, it);
    });
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
});

// ---------- item editor (also used for subjects) ----------
let editing = null; // { i, item, mode: 'item'|'subject' }
function kindButtons(cur) {
  $('#iKind').innerHTML = KIND_KEYS.map(k => `<button type="button" class="k-${k} ${k === cur ? 'on' : ''}" data-v="${k}">${KINDS[k].label}</button>`).join('');
}
$('#iKind').onclick = e => { const b = e.target.closest('button'); if (!b) return; editing.item.kind = b.dataset.v; kindButtons(b.dataset.v); };
function splitButtons() {
  const it = editing.item;
  document.querySelectorAll('#iSplit button').forEach(b => b.classList.toggle('on', b.dataset.v === (it.split || '')));
  const keys = it.split === 'group' ? ['1', '2'] : it.split === 'units' ? ['4', '5'] : [];
  const lab = it.split === 'group' ? k => `קבוצה ${k} ${k === '1' ? '(א–ל)' : '(מ–ת)'}` : k => `${k} יח״ל`;
  $('#iVariants').innerHTML = keys.map(k => `<div class="variant"><h4>${lab(k)}</h4>
    <div class="row"><div class="field grow"><label>שם</label><input class="input" data-vk="${k}" data-f="title" value="${esc(it.variants?.[k]?.title || '')}" placeholder="${esc($('#iTitle').value)}"></div>
    <div class="field grow"><label>מורה</label><input class="input" data-vk="${k}" data-f="teacher" value="${esc(it.variants?.[k]?.teacher || '')}"></div>
    <div class="field grow"><label>חדר</label><input class="input" data-vk="${k}" data-f="note" value="${esc(it.variants?.[k]?.note || '')}"></div></div></div>`).join('');
  $('#iTeacher').closest('.field').classList.toggle('hidden', !!it.split);
}
$('#iSplit').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  collectVariants();
  const it = editing.item; it.split = b.dataset.v || undefined;
  if (it.split) { const keys = it.split === 'group' ? ['1', '2'] : ['4', '5']; const old = it.variants || {}; it.variants = Object.fromEntries(keys.map(k => [k, old[k] || { title: '', teacher: '' }])); }
  else delete it.variants;
  splitButtons();
};
function collectVariants() {
  const it = editing.item; if (!it.split) return;
  it.variants ||= {};
  document.querySelectorAll('#iVariants [data-vk]').forEach(inp => { (it.variants[inp.dataset.vk] ||= {})[inp.dataset.f] = inp.value.trim(); });
}
$('#iTitle').addEventListener('change', e => {
  // picking a known subject fills in the rest
  if (editing.mode !== 'item') return;
  const s = S.draft.subjects.find(x => x.title === e.target.value.trim()); if (!s) return;
  const it = editing.item;
  it.kind = s.kind; kindButtons(s.kind);
  if (s.split) { it.split = s.split; it.variants = clone(s.variants); delete it.teacher; } else { delete it.split; delete it.variants; it.teacher = s.teacher || ''; $('#iTeacher').value = it.teacher; }
  splitButtons();
});

function editItem(i, item) {
  const list = curList();
  editing = { i, mode: 'item', item: clone(item || list[i]) };
  openEditor(i < 0 ? 'פריט חדש' : 'עריכת פריט');
}
function editSubject(i, item) {
  editing = { i, mode: 'subject', item: clone(item || S.draft.subjects[i]) };
  openEditor(i < 0 ? 'מקצוע חדש' : 'עריכת מקצוע');
}
function openEditor(title) {
  const it = editing.item, isItem = editing.mode === 'item';
  $('#itemH').textContent = title;
  $('.times').classList.toggle('hidden', !isItem);
  $('#iStart').required = $('#iEnd').required = isItem;
  $('#iStart').value = it.start || ''; $('#iEnd').value = it.end || '';
  $('#iTitle').value = it.title || ''; $('#iTeacher').value = it.teacher || ''; $('#iNote').value = it.note || '';
  $('#iNote').closest('.field').classList.toggle('hidden', !isItem);
  $('#iDelete').classList.toggle('hidden', editing.i < 0);
  $('#iToLib').classList.toggle('hidden', !isItem);
  $('#iErr').textContent = '';
  kindButtons(it.kind || 'lesson'); splitButtons();
  openSheet('#itemSheet');
}
function readEditor() {
  collectVariants();
  const it = editing.item;
  it.title = $('#iTitle').value.trim();
  if (editing.mode === 'item') { it.start = $('#iStart').value; it.end = $('#iEnd').value; const n = $('#iNote').value.trim(); if (n) it.note = n; else delete it.note; }
  const t = $('#iTeacher').value.trim();
  if (!it.split && t) it.teacher = t; else delete it.teacher;
  if (it.split) for (const v of Object.values(it.variants)) { v.title ||= it.title; }
  return it;
}
$('#itemForm').onsubmit = e => {
  e.preventDefault();
  const it = readEditor();
  if (!it.title) { $('#iErr').textContent = 'חסר שם'; return; }
  if (editing.mode === 'item' && toMin(it.end) <= toMin(it.start)) { $('#iErr').textContent = 'שעת הסיום צריכה להיות אחרי ההתחלה'; return; }
  const { i, mode } = editing;
  change(s => {
    if (mode === 'subject') { if (i < 0) s.subjects.push({ ...it, id: uid() }); else s.subjects[i] = it; return; }
    const l = curList(s);
    if (i < 0) l.push(it); else l[i] = it;
    l.sort((a, b) => toMin(a.start) - toMin(b.start));
  });
  closeSheet('#itemSheet');
  if (mode === 'subject') renderSubjects();
};
$('#iDelete').onclick = () => {
  const { i, mode } = editing;
  change(s => { if (mode === 'subject') s.subjects.splice(i, 1); else curList(s).splice(i, 1); });
  closeSheet('#itemSheet'); if (mode === 'subject') renderSubjects();
};
$('#iToLib').onclick = () => {
  const it = readEditor(); if (!it.title) { $('#iErr').textContent = 'חסר שם'; return; }
  const sub = { id: uid(), title: it.title, kind: it.kind };
  if (it.teacher) sub.teacher = it.teacher;
  if (it.split) { sub.split = it.split; sub.variants = clone(it.variants); }
  change(s => { const j = s.subjects.findIndex(x => x.title === it.title); if (j >= 0) s.subjects[j] = { ...sub, id: s.subjects[j].id }; else s.subjects.push(sub); });
  toast('נשמר במאגר המקצועות');
};

// ---------- subjects tab ----------
function renderSubjects() {
  $('#subjectList').innerHTML = S.draft.subjects.map((s, i) => `<div class="card subj k-${s.kind}" data-i="${i}">
    <span class="chip">${KINDS[s.kind]?.label}</span><div class="grow"><b>${esc(s.title)}</b><div class="hint">${esc(describe(s))}</div></div>
    <button class="btn small" data-op="edit">עריכה</button><button class="btn small danger" data-op="del">מחיקה</button></div>`).join('') || '<div class="empty">אין מקצועות</div>';
  if (isDirty()) $('#subjectList').insertAdjacentHTML('afterbegin', '<div class="banner">יש שינויים שלא פורסמו · עברו ללשונית "מערכת" ולחצו "שמירה ופרסום"</div>');
}
$('#subjectList').onclick = e => {
  const b = e.target.closest('[data-op]'); if (!b) return; const i = +b.closest('[data-i]').dataset.i;
  if (b.dataset.op === 'edit') editSubject(i);
  if (b.dataset.op === 'del' && confirm('למחוק מהמאגר?')) { change(s => s.subjects.splice(i, 1)); renderSubjects(); }
};
$('#addSubject').onclick = () => editSubject(-1, { title: '', kind: 'lesson' });
document.querySelector('[data-tab="subjects"]').addEventListener('click', renderSubjects);

// ================= users =================
const dtFmt = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });
const fmtTs = t => t?.toDate ? dtFmt.format(t.toDate()) : '—';
const groupOf = u => u.groupOverride || groupFor(u.lastName, S.draft?.groupRule?.letters);
const pushOn = u => !u.blocked && (u.tokens || []).length && normPrefs(u.prefs).enabled;
function filteredUsers() {
  const q = $('#userSearch').value.trim(), f = $('#userFilter').value;
  return S.users.filter(u => {
    if (q && !`${u.firstName} ${u.lastName}`.includes(q)) return false;
    return f === 'all' || (f === 'active' && pushOn(u)) || (f === 'nopush' && !pushOn(u) && !u.blocked) || (f === 'blocked' && u.blocked)
      || (f === 'g1' && groupOf(u) === 1) || (f === 'g2' && groupOf(u) === 2) || (f === 'u4' && u.units === 4) || (f === 'u5' && u.units === 5);
  }).sort((a, b) => (a.lastName || '').localeCompare(b.lastName || '', 'he') || (a.firstName || '').localeCompare(b.firstName || '', 'he'));
}
function renderUsers() {
  $('#usersCount').textContent = S.users.length ? `(${S.users.length})` : '';
  const list = filteredUsers();
  $('#userList').innerHTML = list.length ? list.map(u => `
    <div class="card user ${u.blocked ? 'blocked' : ''}" data-id="${u.id}">
      <input type="checkbox" data-sel ${S.selected.has(u.id) ? 'checked' : ''} aria-label="בחירה">
      <div class="nm"><b>${esc(u.firstName)} ${esc(u.lastName)}</b>
        <div class="tags">
          <span class="tag">קבוצה ${groupOf(u)}${u.groupOverride ? ' (ידני)' : ''}</span><span class="tag">${u.units} יח״ל</span>
          ${u.blocked ? '<span class="tag bad">חסום</span>' : pushOn(u) ? `<span class="tag ok">התראות פעילות${u.tokens.length > 1 ? ` · ${u.tokens.length} מכשירים` : ''}</span>` : `<span class="tag bad">${u.notif === 'denied' ? 'התראות חסומות בדפדפן' : !normPrefs(u.prefs).enabled ? 'כיבה התראות' : 'אין התראות'}</span>`}
          <span class="tag">נרשם ${fmtTs(u.createdAt)}</span><span class="tag">נראה ${fmtTs(u.lastSeen)}</span>
        </div></div>
      <div class="ops">
        <button class="btn small" data-op="msg">הודעה</button>
        <button class="btn small" data-op="edit">פרטים</button>
        <button class="btn small ${u.blocked ? '' : 'danger'}" data-op="block">${u.blocked ? 'ביטול חסימה' : 'חסימה'}</button>
      </div>
    </div>`).join('') : `<div class="empty"><div class="big">👥</div><p>${S.users.length ? 'אין תוצאות' : 'עוד אף אחד לא נרשם'}</p></div>`;
  $('#msgSelected').disabled = !S.selected.size;
  $('#msgSelected').textContent = S.selected.size ? `הודעה ל־${S.selected.size} נבחרים` : 'הודעה לנבחרים';
}
$('#userSearch').oninput = renderUsers; $('#userFilter').onchange = renderUsers;
$('#selAll').onchange = e => { filteredUsers().forEach(u => e.target.checked ? S.selected.add(u.id) : S.selected.delete(u.id)); renderUsers(); };
$('#userList').addEventListener('change', e => { if (e.target.matches('[data-sel]')) { const id = e.target.closest('[data-id]').dataset.id; e.target.checked ? S.selected.add(id) : S.selected.delete(id); renderUsers(); } });
$('#userList').addEventListener('click', async e => {
  const b = e.target.closest('[data-op]'); if (!b) return;
  const u = S.users.find(x => x.id === b.closest('[data-id]').dataset.id);
  if (b.dataset.op === 'msg') composeTo([u.id]);
  if (b.dataset.op === 'block') {
    if (!u.blocked && !confirm(`לחסום את ${u.firstName} ${u.lastName}? הוא לא יקבל התראות ולא יוכל לשנות פרטים.`)) return;
    await updateUser(u, { blocked: !u.blocked });
  }
  if (b.dataset.op === 'edit') userDetails(u);
});
async function updateUser(u, data) {
  if (S.demo) { Object.assign(u, data); renderUsers(); toast('מצב תצוגה: לא נשמר'); return; }
  try { const { db, F } = S.fb; await F.updateDoc(F.doc(db, 'users', u.id), data); toast('עודכן ✓'); } catch (e) { toast('שגיאה: ' + (e.code || e.message)); }
}
function userDetails(u) {
  const p = normPrefs(u.prefs);
  const body = $('#userSheetBody');
  body.innerHTML = `<h2>${esc(u.firstName)} ${esc(u.lastName)}</h2>
    <div class="row"><div class="field grow"><label>שם פרטי</label><input class="input" id="uFn" value="${esc(u.firstName)}"></div><div class="field grow"><label>שם משפחה</label><input class="input" id="uLn" value="${esc(u.lastName)}"></div></div>
    <div class="row"><div class="field grow"><label>יחידות אנגלית</label><select class="input" id="uUnits"><option ${u.units === 4 ? 'selected' : ''}>4</option><option ${u.units === 5 ? 'selected' : ''}>5</option></select></div>
    <div class="field grow"><label>קבוצה</label><select class="input" id="uGroup"><option value="">אוטומטי (${groupFor(u.lastName, S.draft?.groupRule?.letters)})</option><option value="1" ${u.groupOverride === 1 ? 'selected' : ''}>1</option><option value="2" ${u.groupOverride === 2 ? 'selected' : ''}>2</option></select></div></div>
    <p class="hint">התראות: ${p.enabled ? 'מופעלות' : 'כבויות'} · ${p.lead ? p.lead + ' דק׳ לפני' : 'בזמן'} · ${p.rules.length} סוגי מעברים · מכשירים: ${(u.tokens || []).length}</p>
    <p class="hint" style="direction:ltr;text-align:left;word-break:break-all">${esc(u.ua || '')}</p>
    <div class="actions"><button class="btn danger" id="uDel">מחיקת תלמיד</button><button class="btn primary" id="uSave">שמירה</button></div>`;
  body.querySelector('#uSave').onclick = async () => {
    const g = body.querySelector('#uGroup').value;
    const data = { firstName: body.querySelector('#uFn').value.trim(), lastName: body.querySelector('#uLn').value.trim(), units: +body.querySelector('#uUnits').value, groupOverride: g ? +g : null };
    data.group = data.groupOverride || groupFor(data.lastName, S.draft?.groupRule?.letters);
    await updateUser(u, data); closeSheet('#userSheet');
  };
  body.querySelector('#uDel').onclick = async () => {
    if (!confirm('למחוק את התלמיד לגמרי?')) return;
    if (S.demo) { S.users = S.users.filter(x => x !== u); renderUsers(); } else { const { db, F } = S.fb; await F.deleteDoc(F.doc(db, 'users', u.id)).catch(e => toast(e.code)); }
    closeSheet('#userSheet');
  };
  openSheet('#userSheet');
}

// ================= messages =================
let aud = 'all', audUids = [];
function composeTo(uids) {
  aud = 'some'; audUids = uids;
  document.querySelector('[data-tab="messages"]').click();
  markAud(); $('#mTitle').focus();
}
$('#msgSelected').onclick = () => composeTo([...S.selected]);
$('#mAud').onclick = e => { const b = e.target.closest('button'); if (!b) return; aud = b.dataset.v; if (aud === 'some') audUids = [...S.selected]; markAud(); };
function markAud() { document.querySelectorAll('#mAud button').forEach(b => b.classList.toggle('on', b.dataset.v === aud)); renderAudHint(); }
function targets() {
  const ok = S.users.filter(u => !u.blocked);
  if (aud === 'some') return ok.filter(u => audUids.includes(u.id));
  if (aud === 'g1' || aud === 'g2') return ok.filter(u => groupOf(u) === +aud[1]);
  if (aud === 'u4' || aud === 'u5') return ok.filter(u => u.units === +aud[1]);
  return ok;
}
function renderAudHint() {
  const t = targets();
  $('#mAudHint').textContent = aud === 'all' ? `${t.length} תלמידים (לא כולל חסומים)` : `${t.length} תלמידים: ${t.slice(0, 8).map(u => u.firstName + ' ' + u.lastName).join(', ')}${t.length > 8 ? '…' : ''}`;
}
$('#mSend').onclick = async () => {
  const title = $('#mTitle').value.trim(), body = $('#mBody').value.trim(), push = $('#mPush').checked;
  if (!title) { toast('חסרה כותרת'); return; }
  const t = targets();
  if (aud !== 'all' && !t.length) { toast('אין נמענים'); return; }
  if (!confirm(`לשלוח ל־${aud === 'all' ? 'כל התלמידים' : t.length + ' תלמידים'}${push ? ' (כולל התראה)' : ''}?`)) return;
  const msg = { title, body, audience: aud === 'all' ? 'all' : 'some', uids: aud === 'all' ? [] : t.map(u => u.id), push, status: push ? 'pending' : 'sent', label: aud };
  if (S.demo) { S.messages.unshift({ ...msg, id: uid(), createdAt: null }); renderMessages(); toast('מצב תצוגה: לא נשלח'); return; }
  try {
    const { db, F } = S.fb;
    await F.addDoc(F.collection(db, 'messages'), { ...msg, createdAt: F.serverTimestamp() });
    $('#mTitle').value = ''; $('#mBody').value = ''; aud = 'all'; markAud();
    toast(push ? 'נשלח · ההתראה תצא תוך כמה שניות' : 'ההודעה פורסמה ✓');
  } catch (e) { toast('שגיאה: ' + (e.code || e.message)); }
};
function renderMessages() {
  const st = { pending: '⏳ ממתין לשרת', sending: '📤 נשלח…', sent: '✓ נשלח', failed: '⚠ נכשל' };
  const labels = { all: 'כולם', g1: 'קבוצה 1', g2: 'קבוצה 2', u4: '4 יח״ל', u5: '5 יח״ל' };
  $('#msgHistory').innerHTML = S.messages.length ? S.messages.map(m => `<div class="card mh" data-id="${m.id}">
    <div class="grow"><b>${esc(m.title)}</b>${m.body ? `<div>${esc(m.body)}</div>` : ''}
      <div class="hint">${fmtTs(m.createdAt)} · ${m.audience === 'all' ? 'כולם' : labels[m.label] || `${(m.uids || []).length} נבחרים`} · ${m.push ? (st[m.status] || m.status) + (m.delivered != null ? ` (${m.delivered} מכשירים)` : '') : 'באתר בלבד'}</div></div>
    <button class="btn small danger" data-op="del">מחיקה</button></div>`).join('') : '<div class="empty"><p>עוד לא נשלחו הודעות</p></div>';
}
$('#msgHistory').onclick = async e => {
  const b = e.target.closest('[data-op="del"]'); if (!b || !confirm('למחוק את ההודעה? (היא תיעלם גם מהאתר של התלמידים)')) return;
  const id = b.closest('[data-id]').dataset.id;
  if (S.demo) { S.messages = S.messages.filter(m => m.id !== id); renderMessages(); return; }
  const { db, F } = S.fb; await F.deleteDoc(F.doc(db, 'messages', id)).catch(err => toast(err.code));
};

// ================= settings =================
function renderStatus() {
  const el = $('#senderStatus'); if (!el) return;
  if (S.demo) { el.textContent = 'מצב תצוגה'; return; }
  const t = S.status?.beat?.toDate?.();
  if (!t) { el.innerHTML = 'שרת ההתראות עוד לא רץ אף פעם. בדקו את השלב של GitHub Actions ב-SETUP.md.'; return; }
  const ago = Math.round((Date.now() - t) / 60000);
  el.innerHTML = ago <= 3 ? `<span style="color:var(--ok)">● פעיל</span> · עדכון אחרון לפני ${ago || 'פחות מ־1'} דק׳${S.status.lastSent ? ` · התראה אחרונה: ${esc(S.status.lastSent)}` : ''}`
    : `<span style="color:var(--danger)">● לא פעיל</span> כבר ${ago} דק׳. בדקו בלשונית Actions במאגר ב-GitHub שהריצה "luz notifications" עובדת.`;
}
function fillSettings() {
  $('#sClass').value = S.draft.className || '';
  $('#sLetters').value = S.draft.groupRule?.letters || 'אבגדהוזחטיכל';
  renderStatus();
}
$('#sSave').onclick = () => {
  change(s => { s.className = $('#sClass').value.trim(); s.groupRule = { ...(s.groupRule || {}), letters: $('#sLetters').value.replace(/[^א-ת]/g, '') }; });
  $('#saveBtn').click();
};
$('#exportBtn').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(S.draft, null, 1)], { type: 'application/json' }));
  a.download = `schedule-${israelNow().date}.json`; a.click();
};
$('#importFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try { const data = JSON.parse(await f.text()); if (!data.days) throw new Error('bad'); change(s => { Object.keys(s).forEach(k => delete s[k]); Object.assign(s, data); }); toast('נטען · לחצו "שמירה ופרסום"'); document.querySelector('[data-tab="schedule"]').click(); }
  catch { toast('הקובץ לא תקין'); }
  e.target.value = '';
};
$('#resetBtn').onclick = () => {
  if (!confirm('לחזור למערכת המקורית מהתמונה? כל השינויים במערכת יימחקו (אחרי שמירה).')) return;
  change(s => { Object.keys(s).forEach(k => delete s[k]); Object.assign(s, clone(S.defaultSchedule)); });
  document.querySelector('[data-tab="schedule"]').click();
  toast('נטען · לחצו "שמירה ופרסום" כדי לאשר');
};

if (matchMedia('(min-width: 700px)').matches) $('#libBox').open = true;
start().catch(e => { console.error(e); $('#loginMsg').textContent = 'שגיאה בטעינה: ' + e.message; });
