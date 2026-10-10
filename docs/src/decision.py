# Writes docs/images/decision.svg. Run: python3 docs/src/decision.py [output directory]
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'images')
from common import *
W, H, DUR = 780, 330, 18
GX = [90, 222, 354, 486, 618]       # gate centres
TRACK = 150
START, END = 36, 706
holds1 = [(8, 11), (15, 18), (22, 25), (29, 32), (36, 39)]
holds2 = [(58, 61), (65, 68), (72, 98)]   # run 2 stops at gate 3 and stays

def icon(i, cx, cy):
    s = 'stroke="#8b949e" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"'
    if i == 0:   # answer bubble with a tick
        return (f'<path d="M{cx-20} {cy-14} h40 a6 6 0 0 1 6 6 v16 a6 6 0 0 1 -6 6 h-22 l-10 8 v-8 h-8 a6 6 0 0 1 -6 -6 v-16 a6 6 0 0 1 6 -6 z" {s}/>'
                f'<path d="M{cx-9} {cy} l6 6 l12 -12" stroke="#3fb950" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>')
    if i == 1:   # bar filled past a threshold line
        return (f'<rect x="{cx-22}" y="{cy-6}" width="44" height="12" rx="3" {s}/>'
                f'<rect x="{cx-22}" y="{cy-6}" width="38" height="12" rx="3" fill="#8b949e" opacity=".45"/>'
                f'<line x1="{cx+10}" y1="{cy-14}" x2="{cx+10}" y2="{cy+14}" stroke="#e3b341" stroke-width="2" stroke-dasharray="3 3"/>')
    if i == 2:   # work still running: a ring with an open arc and dots
        return (f'<circle cx="{cx}" cy="{cy}" r="14" {s} stroke-dasharray="62 26"/>'
                f'<circle cx="{cx-5}" cy="{cy}" r="2" fill="#8b949e"/><circle cx="{cx}" cy="{cy}" r="2" fill="#8b949e"/><circle cx="{cx+5}" cy="{cy}" r="2" fill="#8b949e"/>')
    if i == 3:   # clock
        return (f'<circle cx="{cx}" cy="{cy}" r="15" {s}/><path d="M{cx} {cy-8} V{cy} l7 4" {s}/>')
    # toggle, off
    return (f'<rect x="{cx-20}" y="{cy-10}" width="40" height="20" rx="10" {s}/><circle cx="{cx-10}" cy="{cy}" r="6" fill="#8b949e"/>')

QS = [
 ('a real pause?', 'answer ended', 'normally', 'no: nothing', 'dim'),
 ('big enough?', 'context at the', 'threshold', 'no: nothing', 'dim'),
 ('all quiet?', 'no subagent, task', 'or timer running', 'no: waits', 'y'),
 ('not too soon?', 'last attempt was', 'a while ago', 'no: waits', 'y'),
 ('dry run off?', 'else it only', 'reports', 'no: only reports', 'dim'),
]
gates = ''
for i, (cx, (q, l1, l2, out, oc)) in enumerate(zip(GX, QS)):
    gates += f'  <g id="g{i}">{icon(i, cx, 92)}</g>\n'
    gates += f'  <line x1="{cx}" y1="{TRACK-18}" x2="{cx}" y2="{TRACK+18}" stroke="#30363d" stroke-width="2"/>\n'
    gates += f'  <text x="{cx}" y="{TRACK+46}" text-anchor="middle" class="fg" style="font-size:14px">{q}</text>\n'
    gates += f'  <text x="{cx}" y="{TRACK+64}" text-anchor="middle" class="dim" style="font-size:11px">{l1}</text>\n'
    gates += f'  <text x="{cx}" y="{TRACK+78}" text-anchor="middle" class="dim" style="font-size:11px">{l2}</text>\n'
    gates += f'  <text x="{cx}" y="{TRACK+100}" text-anchor="middle" class="{oc}" style="font-size:11px">{out}</text>\n'
    # highlight ring while the token asks this question
    ivs = [holds1[i], holds2[i] if i < len(holds2) else None]
    ivs = [v for v in ivs if v]
    if i > 2: ivs = [holds1[i]]
    gates += f'  <rect class="e" style="animation-name:hl{i}" x="{cx-62}" y="72" width="124" height="{TRACK+110-72}" rx="8" fill="none" stroke="#58a6ff" stroke-width="1.5" opacity="0"/>\n'
hl_css = ''.join(opacity_kf(f'hl{i}', ([holds1[i]] + ([holds2[i]] if i < 3 else [])), fade=0.8) for i in range(5))

# token: x offset from START; fades in at the start of each run
def gate_tx(i): return GX[i] - START
def run(holds, first, last_gate, end_tx, fade_out):
    pts = [(first - 1, 0, 0, 0), (first, 1, 0, 0)]
    for i in range(last_gate + 1):
        a, b = holds[i]
        pts += [(a, 1, gate_tx(i), 0), (b if i < last_gate or end_tx is not None else b, 1, gate_tx(i), 0)]
    if end_tx is not None:
        pts += [(end_tx[0], 1, end_tx[1], 0), (fade_out, 1, end_tx[1], 0), (fade_out + 1.2, 0, end_tx[1], 0)]
    return pts
p1 = run(holds1, 2, 4, (44, END - START), 47.5)
# run 2: stops at gate 3 (index 2) and stays until it fades
p2 = [(51, 0, 0, 0), (52, 1, 0, 0)]
for i in range(2):
    a, b = holds2[i]; p2 += [(a, 1, gate_tx(i), 0), (b, 1, gate_tx(i), 0)]
a, b = holds2[2]
p2 += [(a, 1, gate_tx(2) - 14, 0), (97, 1, gate_tx(2) - 14, 0), (98.4, 0, gate_tx(2) - 14, 0)]
pts = [(0, 0, 0, 0)] + p1 + [(50, 0, 0, 0)] + p2 + [(100, 0, 0, 0)]
# keep time monotonic
clean = []
for p in pts:
    if clean and p[0] < clean[-1][0]: p = (clean[-1][0], *p[1:])
    clean.append(p)
tok_css = move_kf('tok', clean)
# token colour: green, yellow once it is held at the third gate in run 2
tok_css += '    @keyframes tokc { 0%, 71.9% { fill: #3fb950 } 72.5%, 100% { fill: #e3b341 } }\n'

E = [
 ('doneA', '<text x="706" y="136" text-anchor="middle" class="g" style="font-size:13px">hands over</text>', [(43, 49)], False),
 ('capA', '<text x="390" y="316" text-anchor="middle" class="dim">all clear: it hands over</text>', [(0, 49)], False),
 ('capB', '<text x="390" y="316" text-anchor="middle" class="dim">work still running: it waits for the next pause</text>', [(50, 99)], True),
]
css = ''.join(opacity_kf(i, ivs) for i, _, ivs, _ in E) + hl_css + tok_css
els = ''.join(f'  <g class="e{" fin" if fin else ""}" style="animation-name:{i}">{svg}</g>\n' for i, svg, _, fin in E)
track = f'  <line x1="{START}" y1="{TRACK}" x2="{END+10}" y2="{TRACK}" stroke="#21262d" stroke-width="2"/>\n'
tok = f'  <g class="e tokg" style="animation-name:tok"><circle class="tokc" cx="{START}" cy="{TRACK}" r="8"/></g>\n'
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-labelledby="t d">
  <title id="t">the questions context-relay asks at every pause, in order</title>
  <desc id="d">Five checks in a fixed order, each drawn as a symbol: a real pause, enough context, nothing running, enough time since the last attempt, dry run off. A dot passes them and the mod hands over; in a second run work is still running and the dot waits at the third check.</desc>
  <style>
{BASECSS}    .e {{ opacity: 0; animation-duration: {DUR}s; animation-timing-function: linear; animation-iteration-count: infinite; animation-fill-mode: both; }}
    .tokc {{ fill: #3fb950; animation: tokc {DUR}s linear infinite both; }}
{css}    @media (prefers-reduced-motion: reduce) {{
      .e {{ animation: none; opacity: 0; }} .e.fin {{ opacity: 1; }} .tokc {{ animation: none; }}
    }}
  </style>
{HEAD.format(W=W, H=H, cx=W//2)}  <text x="36" y="58" class="dim" style="font-size:13px">at every pause, in this order; the first “no” ends the check</text>
{track}{gates}{els}{tok}</svg>
'''
open(os.path.join(OUT, 'decision.svg'), 'w', encoding='utf-8').write(svg)
