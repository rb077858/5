#!/usr/bin/env python3
"""Render the 'competition closed' page into index.html.

Runs automatically from build.py while build/closed.json exists.
To reopen the competition: delete build/closed.json and run build.py again.
The data stays in build/data.json either way.
"""
import collections, html, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
HEB_M = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']


def render():
    with open(os.path.join(HERE, 'closed.json'), encoding='utf-8') as f:
        cfg = json.load(f)
    with open(os.path.join(HERE, 'data.json'), encoding='utf-8') as f:
        d = json.load(f)
    month, people = cfg['month'], d['people']
    used = collections.Counter()
    for m in d['msgs']:
        if m[0][:7] == month:
            used[m[2]] += m[3]
    for k, v in d.get('adj', {}).items():
        mk, p = k.split('|')
        if mk == month:
            used[int(p)] -= 20 * v
    rows = [(used[i], people[i]) for i in range(len(people)) if people[i] != 'לא מזוהה']
    most = max(rows)
    writers = [r for r in rows if r[0] > 0]
    least = min(writers)
    silent = len(rows) - len(writers)
    last = d['msgs'][-1]
    asof = f"{int(last[0][8:])}.{int(last[0][5:7])}"
    closed_on = cfg['closed_on']
    mname = HEB_M[int(month[5:]) - 1]
    e = html.escape

    page = f"""<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#4A33C4">
<title>מחזור המלכים במילים</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Suez+One&family=Rubik:wght@400;500;600&display=swap">
<style>
:root{{--bg:#F2F1F8;--surface:#FFFFFF;--ink:#1C1838;--muted:#625E82;--line:#DEDBEC;--royal:#4A33C4;--gold:#946500;--gold-soft:#FAEDC8;
  --display:"Suez One","Rubik",Georgia,serif;--body:"Rubik",system-ui,-apple-system,"Segoe UI",Arial,sans-serif}}
@media (prefers-color-scheme: dark){{:root{{--bg:#110F24;--surface:#1B1835;--ink:#EEECFB;--muted:#A6A2C8;--line:#2E2A55;--royal:#9C8CFF;--gold:#F0C04A;--gold-soft:#3B311A;color-scheme:dark}}}}
*{{box-sizing:border-box}}
html,body{{margin:0;min-height:100%}}
body{{background:var(--bg);color:var(--ink);font-family:var(--body);line-height:1.55;padding-inline:16px;padding-block:max(40px,env(safe-area-inset-top)) 40px;display:grid;place-items:center;min-height:100vh}}
main{{max-width:520px;width:100%;display:grid;gap:22px;text-align:center}}
.emoji{{font-size:4.5rem;line-height:1}}
h1{{font-family:var(--display);font-weight:400;font-size:clamp(2.1rem,8vw,2.8rem);margin:0;line-height:1.15;text-wrap:balance}}
p{{margin:0;color:var(--muted);font-size:1.05rem;text-wrap:pretty}}
.tiles{{display:grid;grid-template-columns:1fr 1fr;gap:12px}}
.tile{{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:18px 12px;display:grid;gap:4px}}
.tile .lab{{font-size:.85rem;color:var(--muted)}}
.tile .name{{font-family:var(--display);font-size:1.7rem;color:var(--royal);line-height:1.2}}
.tile .num{{font-weight:600;font-variant-numeric:tabular-nums}}
.tile.top{{background:var(--gold-soft);border-color:transparent}}
.tile.top .name{{color:var(--gold)}}
.foot{{font-size:.85rem}}
@media (max-width:380px){{.tiles{{grid-template-columns:1fr}}}}
</style>
</head>
<body>
<main>
  <div class="emoji" aria-hidden="true">🏁</div>
  <h1>התחרות נסגרה</h1>
  <p>תחרות 500 המילים הסתיימה ב-{e(closed_on)}, ולא רק לחודש הזה. אין יותר מגבלת מילים, ואפשר לכתוב בקבוצה כמה שרוצים. תודה לכל המשתתפים!</p>
  <div class="tiles">
    <div class="tile top"><span class="lab">כתב הכי הרבה</span><span class="name">{e(most[1])}</span><span class="num">{most[0]} מילים</span></div>
    <div class="tile"><span class="lab">כתב הכי קצת</span><span class="name">{e(least[1])}</span><span class="num">{least[0]} מילים</span></div>
  </div>
  <p class="foot">לפי ההודעות עד {asof}.{f' {silent} חברים לא כתבו בכלל במהלך התחרות.' if silent else ''}</p>
</main>
</body>
</html>
"""
    with open(os.path.join(ROOT, 'index.html'), 'w', encoding='utf-8') as f:
        f.write(page)
    print('closed page:', most, least, 'silent', silent)


if __name__ == '__main__':
    render()
