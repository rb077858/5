#!/usr/bin/env python3
"""Draw 'words left this month' as a PNG from the data in index.html.

Usage:  python3 build/chart.py <out.png> [YYYY-MM]   (default: month of the last message)
"""
import collections, json, os, re, sys

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUDGET = 500
HEB_M = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']
ROYAL, GOLD_SOFT, GOLD, DANGER, INK, MUTED = '#4A33C4', '#FAEDC8', '#D9A520', '#C22B47', '#1C1838', '#625E82'


def main(out, month=None):
    html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    d = json.loads(re.search(r'<script id="data" type="application/json">(.*?)</script>', html, re.S).group(1).replace('<\\/', '</'))
    msgs, people = d['msgs'], d['people']
    last = msgs[-1]
    month = month or last[0][:7]
    used = collections.Counter()
    for m in msgs:
        if m[0][:7] == month:
            used[m[2]] += m[3]
    bonus = collections.Counter()
    for k, v in d.get('adj', {}).items():
        mk, p = k.split('|')
        if mk == month:
            used[int(p)] -= 20 * v  # graph images don't count
            bonus[people[int(p)]] += 20 * v
    rows = [(people[i], used[i]) for i in range(len(people)) if people[i] != 'לא מזוהה']
    rows.sort(key=lambda r: (BUDGET - r[1], r[0]))
    rows = rows[::-1]  # matplotlib draws bottom-up

    n = len(rows)
    fig, ax = plt.subplots(figsize=(9, 0.34 * n + 1.9), dpi=170)
    fig.patch.set_facecolor('white')
    for y, (name, u) in enumerate(rows):
        left = BUDGET - u
        if left < 0:
            ax.barh(y, BUDGET, color=DANGER, height=0.68)
            ax.text(BUDGET - 8, y, f'חרג ב-{-left}', va='center', ha='right', fontsize=9, color='white', fontweight='bold')
        else:
            ax.barh(y, BUDGET, color=GOLD_SOFT, height=0.68)
            ax.barh(y, left, color=ROYAL, height=0.68)
            ax.text(max(left - 8, 30), y, str(left), va='center', ha='right', fontsize=9, color='white', fontweight='bold')
        if u:
            ax.text(BUDGET + 6, y, f'{u} נוצלו', va='center', ha='left', fontsize=8, color=MUTED)
        if bonus[name]:
            ax.text(BUDGET + 66, y, f'+{bonus[name]}', va='center', ha='left', fontsize=8, color=GOLD, fontweight='bold')
    ax.set_yticks(range(n))
    ax.set_yticklabels([r[0] for r in rows], fontsize=10.5, color=INK)
    ax.set_xlim(0, 600)
    ax.set_xticks(range(0, 501, 100))
    ax.tick_params(axis='x', colors=MUTED, labelsize=8)
    ax.set_ylim(-0.6, n - 0.4)
    for s in ('top', 'right', 'bottom'):
        ax.spines[s].set_visible(False)
    ax.spines['left'].set_color('#DEDBEC')
    ax.xaxis.grid(True, color='#EEEDF5')
    ax.set_axisbelow(True)
    y, mo = month.split('-')
    stamp = f'{int(last[0][8:])}.{int(last[0][5:7])} בשעה {last[1]//60:02d}:{last[1]%60:02d}'
    ax.set_title(f'כמה מילים נשארו ב{HEB_M[int(mo)-1]} (מתוך 500)\nנכון ל-{stamp}', fontsize=14, color=INK, pad=12, loc='center')
    plt.tight_layout()
    plt.savefig(out, facecolor='white')
    print('saved', out, month)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
    else:
        main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
