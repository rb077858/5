// Shared schedule logic: used by the site, the admin page and the notification sender (Node).
// No DOM access here.

export const TZ = 'Asia/Jerusalem';
export const ADMIN_EMAIL = 'rb077858@gmail.com';

export const KINDS = {
  lesson:   { label: 'שיעור',      short: 'שיעור' },
  seder:    { label: 'סדר לימוד',  short: 'סדר' },
  prayer:   { label: 'תפילה',      short: 'תפילה' },
  meal:     { label: 'ארוחה',      short: 'ארוחה' },
  break:    { label: 'הפסקה',      short: 'הפסקה' },
  activity: { label: 'פעילות',     short: 'פעילות' },
  routine:  { label: 'שגרה',       short: 'שגרה' },
};
export const KIND_KEYS = Object.keys(KINDS);

export const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
export const WEEKDAY_LETTERS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

// "from>to" pairs that notify by default: anything that isn't learning into learning,
// plus a new lesson straight after a seder or another lesson.
const LEARN = ['lesson', 'seder'];
export const DEFAULT_PREFS = {
  enabled: true,
  lead: 2,                       // minutes before the start
  days: [true, true, true, true, true, true],
  rules: [...KIND_KEYS.filter(k => !LEARN.includes(k)).flatMap(f => LEARN.map(t => `${f}>${t}`)), 'seder>lesson', 'lesson>lesson'],
};

export function normPrefs(p) {
  const d = DEFAULT_PREFS;
  p = p || {};
  return {
    enabled: p.enabled !== false,
    lead: Number.isFinite(p.lead) ? p.lead : d.lead,
    days: Array.isArray(p.days) && p.days.length === 6 ? p.days : d.days.slice(),
    rules: Array.isArray(p.rules) ? p.rules : d.rules.slice(),
  };
}

// ---------- time ----------
export const toMin = hhmm => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
export const toHHMM = min => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export const showTime = hhmm => { const m = toMin(hhmm); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };

const partsFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
// Current wall-clock time in Israel, regardless of the device's time zone.
export function israelNow(d = new Date()) {
  const p = Object.fromEntries(partsFmt.formatToParts(d).map(x => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  return { date, minutes: +p.hour * 60 + +p.minute, seconds: +p.second, weekday: weekdayOf(date) };
}
export function weekdayOf(date) { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

// ---------- people ----------
export function groupFor(lastName, letters = 'אבגדהוזחטיכל') {
  const c = String(lastName || '').trim().replace(/^[^א-ת]+/, '').charAt(0);
  return c && letters.includes(c) ? 1 : 2;
}
// profile = { group: 1|2, units: 4|5 } (either may be missing → show both options)
export function profileOf(user, schedule) {
  if (!user) return null;
  const group = user.groupOverride || groupFor(user.lastName, schedule?.groupRule?.letters);
  return { group, units: user.units };
}

// ---------- schedule ----------
// The day's raw item list for a date: a date override, a template, or the weekday plan.
export function dayPlan(schedule, date) {
  const o = schedule.dates?.[date];
  if (o) {
    if (o.off) return { items: [], note: o.note || 'אין לימודים', source: 'date' };
    if (o.template && schedule.templates?.[o.template]) return { items: schedule.templates[o.template].items, note: o.note || schedule.templates[o.template].name, source: 'template' };
    if (o.items) return { items: o.items, note: o.note || '', source: 'date' };
  }
  const wd = weekdayOf(date);
  if (wd === 6) return { items: [], note: 'שבת שלום', source: 'shabbat' };
  return { items: schedule.days?.[wd] || [], note: '', source: 'weekday' };
}

// Pick the variant that fits this student. With no profile, keep both and describe them.
export function resolveItem(it, profile) {
  if (!it.split || !it.variants) return { ...it };
  const key = it.split === 'group' ? profile?.group : profile?.units;
  const v = key != null ? it.variants[String(key)] : null;
  if (v) return { ...it, title: v.title || it.title, teacher: v.teacher || '', note: v.note || it.note, variantKey: String(key) };
  const label = it.split === 'group' ? (k => `קבוצה ${k}`) : (k => `${k} יח״ל`);
  const lines = Object.entries(it.variants).map(([k, x]) => `${label(k)}: ${x.title && !x.title.startsWith(it.title) ? x.title + ' – ' : ''}${x.teacher || ''}${x.note ? ` (${x.note})` : ''}`);
  return { ...it, teacher: lines.join(' · '), lines, mixed: true };
}

// Sorted, resolved items with gaps filled as implicit breaks.
export function personalDay(schedule, date, profile) {
  const plan = dayPlan(schedule, date);
  const items = plan.items.map(it => resolveItem(it, profile)).sort((a, b) => toMin(a.start) - toMin(b.start));
  const out = [];
  for (const it of items) {
    const prev = out[out.length - 1];
    if (prev && toMin(it.start) > toMin(prev.end)) out.push({ id: `gap-${prev.end}`, start: prev.end, end: it.start, kind: 'break', title: 'הפסקה', implicit: true });
    out.push(it);
  }
  return { ...plan, items: out };
}

// Every moment one thing ends and the next begins.
export function transitions(items) {
  const res = [];
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1], next = items[i];
    if (next.implicit) continue;
    res.push({ at: next.start, from: prev.kind, to: next.kind, prev, item: next });
  }
  return res;
}

export function wantsTransition(prefs, tr, weekday) {
  if (!prefs.enabled) return false;
  if (weekday < 6 && prefs.days[weekday] === false) return false;
  return prefs.rules.includes(`${tr.from}>${tr.to}`);
}

export function notificationText(tr, lead) {
  const it = tr.item;
  const when = lead > 0 ? `בעוד ${lead} דק׳` : 'עכשיו';
  const title = `${when}: ${it.title}`;
  const body = [it.teacher, `${showTime(it.start)}–${showTime(it.end)}`, it.note].filter(Boolean).join(' · ');
  return { title, body };
}

// Problems an admin should see before saving a day.
export function validateDay(items) {
  const issues = {};
  const sorted = items.map((x, i) => ({ x, i })).sort((a, b) => toMin(a.x.start) - toMin(b.x.start));
  sorted.forEach(({ x, i }, n) => {
    if (!/^\d{2}:\d{2}$/.test(x.start) || !/^\d{2}:\d{2}$/.test(x.end)) issues[i] = 'שעה לא תקינה';
    else if (toMin(x.end) <= toMin(x.start)) issues[i] = 'השעה המסיימת לפני ההתחלה';
    else if (n > 0 && toMin(x.start) < toMin(sorted[n - 1].x.end)) issues[i] = 'חופף לפריט הקודם';
    if (!x.title?.trim()) issues[i] = 'חסר שם';
  });
  return issues;
}

export const uid = () => Math.random().toString(36).slice(2, 10);
