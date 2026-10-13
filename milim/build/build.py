#!/usr/bin/env python3
"""Build index.html from a WhatsApp chat export.

Usage:  python3 build/build.py <export.zip | chat.txt>
        python3 build/build.py --from-data   (full page from build/data.json, no export needed)

Names: build/names.json maps sha256(sender) -> display name, so phone numbers
and full contact names never appear in the repo. Unknown senders show as "לא מזוהה".
Add a person:  python3 build/build.py --add "+972 50-000-0000" "שם"
"""
import collections, glob, hashlib, io, json, os, re, sys, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
NAMES = os.path.join(HERE, 'names.json')
ADJ = os.path.join(HERE, 'adjustments.json')  # graph images not to count: [{name, month, images, note}]
MEDIA_WORDS = 20
# Graph screenshots Ram posts with a 🔹 in the caption are free (not counted at all).
FREE_MEDIA_SENDER, FREE_MEDIA_MARK = 'ראם', '\U0001F539'
MEDIA_LINE = re.compile(r'^\s*(?:<Media omitted>|<?[\w ]+ omitted>?|\S+\.\w{2,4} \(file attached\))\s*$')

DIR = re.compile(r'[‎‏‪-‮⁨⁩]')
LINE = re.compile(r'^(\d+)/(\d+)/(\d+), (\d+):(\d+) - ([^:]+?): (.*)$')
SYS = re.compile(r'^\d+/\d+/\d+, \d+:\d+ - ')
# Word rules: whitespace and any symbol (- / _ + emoji ...) split words; punctuation
# (. , ! ? : ; quotes, geresh, parentheses) is ignored and does not split; a switch
# between Hebrew, English letters and digits starts a new word.
PUNCT = re.compile(r"""[.,!?;:'"׳״()\[\]{}…“”‘’«»־‐-―]""".replace('־‐-―', ''))
WORD = re.compile(r'[א-ת֑-ׇיִ-ﭏ]+|[A-Za-zÀ-ɏ]+|[0-9]+|[^\W\d_A-Za-zÀ-ɏא-ת]+')


def words_of(text):
    return WORD.findall(PUNCT.sub('', URL.sub(' ', text)))
URL = re.compile(r'https?://\S+')
EMOJI = re.compile('[\U0001F000-\U0001F3FA\U0001F400-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\u2300-\u23FF]')
STOP = set('של את זה על לא אני יש מה גם עם כל אם הוא היא אבל או כי רק אז לי לך לו לה אתה אתם הם הן אנחנו שלא זאת אין עוד כמו היה היו מי איך למה כן פה שם עד אחד אחת יותר הכי כבר עכשיו שזה מישהו משהו בזה אותו אותה אותי אותך שלי שלך שלו שלה שלנו שלכם להם לנו לכם אצל בין רוצה צריך יכול אפשר ממש סתם טוב בסדר אוקיי ok זו הזה הזאת היום מחר שיש ככה כך מתי איפה כאן אולי בגלל הרי בכל לכל מכל עליו עליה עלי ביום וזה וגם ואני ולא שאני שהוא שהם the'.split())


def norm(sender):
    s = DIR.sub('', sender).lstrip('~ ').strip()
    if re.fullmatch(r'[+\d\s()-]+', s):
        s = re.sub(r'\D', '', s)
    return s


def key(sender):
    return hashlib.sha256(norm(sender).encode()).hexdigest()[:16]


def load_names():
    with open(NAMES, encoding='utf-8') as f:
        return json.load(f)


def read_chat(path):
    if path.endswith('.zip'):
        with zipfile.ZipFile(path) as z:
            txt = [n for n in z.namelist() if n.endswith('.txt')][0]
            return z.read(txt).decode('utf-8')
    with open(path, encoding='utf-8') as f:
        return f.read()


def parse(text):
    msgs, cur = [], None
    for l in text.split('\n'):
        l = l.rstrip('\r')
        m = LINE.match(l)
        if m:
            d, mo, y, h, mi, s, t = m.groups()
            cur = {'d': f'{y}-{int(mo):02d}-{int(d):02d}', 't': int(h) * 60 + int(mi), 's': s, 'x': t}
            msgs.append(cur)
        elif SYS.match(l):
            cur = None
        elif cur is not None:
            cur['x'] += '\n' + l
    return msgs


def redact(t, phone_names):
    def at(m):
        return '@' + phone_names.get(key(m.group(0).lstrip('@')), 'מישהו')
    t = DIR.sub('', t)
    t = re.sub(r'@\+?972[\d\s-]{8,}\d', at, t)
    t = re.sub(r'\+?972[\s-]?\d{2}[\s-]?\d{3}[\s-]?\d{4}|\b05\d[\s-]?\d{3}[\s-]?\d{4}\b', '[מספר]', t)
    return t


def write_full(raw):
    data = json.dumps(raw, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
    with open(os.path.join(HERE, 'template.html'), encoding='utf-8') as f:
        page = f.read().replace('__DATA__', data)
    with open(os.path.join(ROOT, 'index.html'), 'w', encoding='utf-8') as f:
        f.write(page)


def build(path):
    names = load_names()
    msgs = parse(read_chat(path))
    people, idx, out, rows, unknown, free = [], {}, [], [], collections.Counter(), 0
    for m in msgs:
        name = names.get(key(m['s']))
        if not name:
            name = 'לא מזוהה'
            unknown[DIR.sub('', m['s']).strip()] += 1
        raw = m['x'].replace('<This message was edited>', '')
        st = raw.strip()
        kind, body = 't', raw
        lines_ = raw.split('\n')
        if any(MEDIA_LINE.match(ln) for ln in lines_):
            if name == FREE_MEDIA_SENDER and FREE_MEDIA_MARK in raw:
                free += 1
                continue
            caption = '\n'.join(ln for ln in lines_ if not MEDIA_LINE.match(ln))
            kind, body = 'm', ''
        elif st in ('This message was deleted', 'You deleted this message', 'null'):
            kind, body = 'x', ''
        elif st.startswith('POLL:'):
            kind = 'p'
            lines = []
            for ln in raw.split('\n'):
                ln = re.sub(r'^(POLL|OPTION):\s*', '', ln.strip())
                ln = re.sub(r'\s*\(\d+ votes?\)\s*$', '', ln)
                if ln:
                    lines.append(ln)
            body = '\n'.join(lines)
        words = MEDIA_WORDS + len(words_of(caption)) if kind == 'm' else len(words_of(body))
        if name not in idx:
            idx[name] = len(people)
            people.append(name)
        clean = URL.sub('', redact(body, names)) if kind in 'tp' else ''
        toks = [w.lower() for w in words_of(clean)]
        toks = [w for w in toks if len(w) > 1 and w not in STOP and not w.isdigit()]
        emo = EMOJI.findall(clean)
        q = 1 if re.search(r'[?？]\s*$', clean) else 0
        out.append([m['d'], m['t'], idx[name], words, kind, len(emo), q])
        rows.append((m['d'][:7], idx[name], toks, emo))

    tops = {}
    for sc in sorted({r[0] for r in rows}) + ['all']:
        sel = [r for r in rows if sc == 'all' or r[0] == sc]
        cw, ce = collections.Counter(), collections.Counter()
        pw, pe = collections.defaultdict(collections.Counter), collections.defaultdict(collections.Counter)
        for _, p, toks, emo in sel:
            cw.update(toks); ce.update(emo); pw[p].update(toks); pe[p].update(emo)
        tops[sc] = {'w': cw.most_common(40), 'e': ce.most_common(14),
                    'pw': {p: c.most_common(12) for p, c in pw.items() if c},
                    'pe': {p: c.most_common(8) for p, c in pe.items() if c}}

    adj = collections.defaultdict(int)
    if os.path.exists(ADJ):
        with open(ADJ, encoding='utf-8') as f:
            for a in json.load(f):
                if a['name'] in idx:
                    adj[f"{a['month']}|{idx[a['name']]}"] += a['images']
    adj = dict(adj)
    raw = {'people': people, 'msgs': out, 'tops': tops, 'adj': adj}
    with open(os.path.join(HERE, 'data.json'), 'w', encoding='utf-8') as f:  # kept so the page can be rebuilt
        json.dump(raw, f, ensure_ascii=False, separators=(',', ':'))
    if os.path.exists(os.path.join(HERE, 'closed.json')):
        sys.path.insert(0, HERE)
        import closed  # competition is closed: show the summary page instead of the dashboard
        closed.render()
    else:
        write_full(raw)

    total = collections.Counter()
    for r in out:
        total[people[r[2]]] += r[3]
    for k, v in adj.items():
        print(f'  graph images {people[int(k.split("|")[1])]} {k.split("|")[0]}: {v} (-{v * MEDIA_WORDS} words)')
    print(f'{len(out)} messages, {sum(total.values())} words, last {out[-1][0]} {out[-1][1]//60:02d}:{out[-1][1]%60:02d}')
    for n, w in total.most_common():
        print(f'  {w:5d}  {n}')
    if free:
        print(f'free graph images (🔹 from {FREE_MEDIA_SENDER}): {free}')
    if unknown:
        print('UNKNOWN SENDERS (add with --add):', dict(unknown))


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == '--add':
        n = load_names()
        n[key(sys.argv[2])] = sys.argv[3]
        with open(NAMES, 'w', encoding='utf-8') as f:
            json.dump(n, f, ensure_ascii=False, indent=1, sort_keys=True)
        print('added', sys.argv[3])
    elif len(sys.argv) == 2 and sys.argv[1] == '--from-data':
        with open(os.path.join(HERE, 'data.json'), encoding='utf-8') as f:
            write_full(json.load(f))  # rebuild the full dashboard without a new export
        print('full page rebuilt from build/data.json')
    elif len(sys.argv) == 2:
        build(sys.argv[1])
    else:
        print(__doc__)
