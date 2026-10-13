// Notification sender. Runs inside GitHub Actions (see .github/workflows/luz-notify.yml).
// It stays up for RUN_MINUTES, wakes every few seconds, and sends a push to every student whose
// chosen transition (e.g. break → lesson) starts now + their lead time. It also delivers admin messages.
// Runs overlap on purpose; every minute and every message is claimed in Firestore so nothing is sent twice.
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { readFileSync } from 'node:fs';
import { israelNow, addDays, weekdayOf, toMin, toHHMM, profileOf, personalDay, transitions, wantsTransition, notificationText, normPrefs, groupFor } from '../core.js';

const RUN_MINUTES = +(process.env.RUN_MINUTES || 125);
const SITE = process.env.SITE_URL || 'https://reembir.com/5/luz/';
const ICON = new URL('icon-192.png', SITE).href;

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || 'null');
if (!sa) { console.log('FIREBASE_SERVICE_ACCOUNT is not set, nothing to do.'); process.exit(0); }
initializeApp({ credential: cert(sa) });
const db = getFirestore();
const fcm = getMessaging();

const DEFAULT_SCHEDULE = JSON.parse(readFileSync(new URL('../schedule-default.json', import.meta.url)));
let schedule = DEFAULT_SCHEDULE;
let users = [];
const log = (...a) => console.log(new Date().toISOString(), ...a);

db.doc('config/schedule').onSnapshot(s => { if (s.exists) { schedule = s.data(); log('schedule loaded'); } }, e => log('schedule error', e.message));
db.collection('users').onSnapshot(s => {
  users = s.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }));
  log('users:', users.length);
  dropDuplicateTokens();
}, e => log('users error', e.message));

// A browser that registered twice (e.g. after its anonymous sign-in was lost) leaves the same
// device token on two student records. Keep it only on the record seen most recently.
function dropDuplicateTokens() {
  const seen = u => u.lastSeen?.toMillis?.() || u.createdAt?.toMillis?.() || 0;
  const owner = new Map();
  for (const u of [...users].sort((a, b) => seen(b) - seen(a)))
    for (const t of u.tokens || []) {
      if (!owner.has(t)) { owner.set(t, u); continue; }
      log('removing duplicate token from', u.id, '(kept on', owner.get(t).id + ')');
      u.tokens = u.tokens.filter(x => x !== t);
      u.ref.update({ tokens: FieldValue.arrayRemove(t) }).catch(() => {});
    }
}

// Send one notification to every device of the given users; drop tokens that are gone.
async function push(list) { // [{ user, title, body, tag }]
  const msgs = [], owners = [];
  const used = new Set();
  for (const { user, title, body, tag } of list) for (const token of user.tokens || []) {
    if (used.has(token)) continue;   // never the same notification twice to one device
    used.add(token);
    msgs.push({ token, webpush: { notification: { title, body, icon: ICON, badge: ICON, tag, renotify: true, lang: 'he', dir: 'rtl' }, fcmOptions: { link: SITE }, headers: { Urgency: 'high', TTL: '600' } } });
    owners.push({ user, token });
  }
  let ok = 0;
  for (let i = 0; i < msgs.length; i += 500) {
    const res = await fcm.sendEach(msgs.slice(i, i + 500));
    res.responses.forEach((r, j) => {
      if (r.success) { ok++; return; }
      const { user, token } = owners[i + j];
      const code = r.error?.code || '';
      // only a token Google says is gone gets removed; any other error leaves the device registered
      if (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token')) {
        log('token gone, removing from', user.id);
        user.ref.update({ tokens: FieldValue.arrayRemove(token) }).catch(() => {});
      } else {
        log('send failed', user.id, code, r.error?.message);
        db.doc('sent/status').set({ lastError: `${code}: ${r.error?.message || ''}`.slice(0, 300), lastErrorAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});
      }
    });
  }
  return ok;
}

// Claim a key once across all overlapping runs.
async function claim(id, data = {}) {
  try { await db.collection('sent').doc(id).create({ at: FieldValue.serverTimestamp(), ...data }); return true; }
  catch (e) { if (e.code === 6 || /already exists/i.test(e.message)) return false; throw e; }
}

// Who should hear about something at this exact minute?
function dueAt(now) {
  const out = [];
  for (const u of users) {
    if (u.blocked || !(u.tokens || []).length) continue;
    const prefs = normPrefs(u.prefs);
    if (!prefs.enabled) continue;
    const target = now.minutes + prefs.lead;           // the transition we announce now
    const date = target >= 1440 ? addDays(now.date, 1) : now.date;
    const at = toHHMM(target % 1440);
    const profile = profileOf(u, schedule) || { group: groupFor(u.lastName), units: u.units };
    const day = personalDay(schedule, date, profile);
    for (const tr of transitions(day.items)) {
      if (tr.at !== at || !wantsTransition(prefs, tr, weekdayOf(date))) continue;
      const { title, body } = notificationText(tr, prefs.lead);
      out.push({ user: u, title, body, tag: `luz-${date}-${at}` });
    }
  }
  return out;
}

let lastMinute = null;
async function tickSchedule() {
  const now = israelNow();
  const key = `${now.date}_${toHHMM(now.minutes).replace(':', '')}`;
  if (key === lastMinute) return;
  lastMinute = key;
  const due = dueAt(now);
  if (!due.length) return;
  if (!(await claim('m_' + key, { count: due.length }))) return;   // another run already took this minute
  const ok = await push(due);
  const label = `${toHHMM(now.minutes)} · ${due[0].title}`;
  log('schedule push', key, due.length, 'users,', ok, 'devices');
  db.doc('sent/status').set({ lastSent: label }, { merge: true }).catch(() => {});
}

// Admin messages: status 'pending' → we send → 'sent'.
const inflight = new Set();
db.collection('messages').where('status', '==', 'pending').onSnapshot(s => {
  for (const d of s.docs) if (!inflight.has(d.id)) { inflight.add(d.id); deliver(d).finally(() => inflight.delete(d.id)); }
}, e => log('messages error', e.message));
async function deliver(doc) {
  const ok = await db.runTransaction(async t => {
    const cur = await t.get(doc.ref);
    if (!cur.exists || cur.data().status !== 'pending') return false;
    t.update(doc.ref, { status: 'sending' }); return true;
  });
  if (!ok) return;
  const m = doc.data();
  try {
    const targets = users.filter(u => !u.blocked && (m.audience === 'all' || (m.uids || []).includes(u.id)));
    const delivered = await push(targets.map(user => ({ user, title: m.title, body: m.body || '', tag: 'msg-' + doc.id })));
    await doc.ref.update({ status: 'sent', sentAt: FieldValue.serverTimestamp(), delivered });
    log('message sent', doc.id, targets.length, 'users,', delivered, 'devices');
  } catch (e) {
    log('message failed', doc.id, e.message);
    await doc.ref.update({ status: 'failed', error: String(e.message).slice(0, 200) });
  }
}

const end = Date.now() + RUN_MINUTES * 60_000;
let beat = 0;
await new Promise(r => setTimeout(r, 4000)); // let the first snapshots arrive
while (Date.now() < end) {
  try {
    await tickSchedule();
    if (Date.now() - beat > 60_000) { beat = Date.now(); db.doc('sent/status').set({ beat: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {}); }
  } catch (e) { log('tick error', e.message); }
  await new Promise(r => setTimeout(r, 5000));
}
log('done');
process.exit(0);
