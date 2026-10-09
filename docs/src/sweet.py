# Writes docs/sweet-spot.svg: the scale of context size behind the Why section.
# Every position is computed from the numbers below, so the picture cannot disagree
# with them. The numbers are measured: the default threshold is the setting's default,
# a fresh session started inside FRESH (common.py) in real handovers (see the README).
# Run: python3 docs/src/sweet.py [output directory]
import os, sys
from common import THRESHOLD, FRESH
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
AXIS = 400_000                 # right end of the scale
X0, X1 = 40, 740               # scale on the card, in pixels

def x(tokens):
    return round(X0 + tokens / AXIS * (X1 - X0), 1)

def num(v):
    return str(int(v)) if float(v).is_integer() else str(v)

ticks = ''.join(
    f'<text x="{num(x(t))}" y="158">{"0" if t == 0 else f"{t // 1000}k"}</text>'
    for t in range(0, AXIS + 1, 100_000)
)
start = FRESH[1]               # the marker starts at the top of the fresh range
SVG = '''<svg xmlns="http://www.w3.org/2000/svg" width="780" height="250" viewBox="0 0 780 250" role="img" aria-labelledby="t d">
  <title id="t">the sweet spot of a session's context, drawn as a scale</title>
  <desc id="d">A scale of context size in tokens. A broad green range is the sweet spot, fading to amber past the default threshold of @@TK@@k, where calls cost more and recall gets worse. A marker fills along the scale, passes the threshold, and the session restarts small, at @@FRESH0@@k to @@FRESH1@@k tokens.</desc>
  <style>
    text { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 15px; }
    .dim { fill: #8b949e; } .fg { fill: #e6edf3; } .y { fill: #e3b341; } .g { fill: #3fb950; } .b { fill: #58a6ff; }
    .mk { animation: mk 12s linear infinite both; }
    .mkc { animation: mkc 12s linear infinite both; }
    @keyframes mk { 0% { transform: translateX(0) } 62% { transform: translateX(@@RUN@@px) } 70% { transform: translateX(@@RUN@@px) } 71% { transform: translateX(@@BACK@@px) } 100% { transform: translateX(@@BACK@@px) } }
    @keyframes mkc { 0% { fill: #3fb950 } 45% { fill: #3fb950 } 62% { fill: #e3b341 } 70% { fill: #e3b341 } 71% { fill: #3fb950 } 100% { fill: #3fb950 } }
    .fresh { animation: fresh 12s linear infinite both; }
    @keyframes fresh { 0% { opacity: 0 } 70% { opacity: 0 } 74% { opacity: 1 } 96% { opacity: 1 } 100% { opacity: 0 } }
  </style>
  <defs>
    <linearGradient id="zone" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#3fb950" stop-opacity="0.15"/>
      <stop offset="0.12" stop-color="#3fb950" stop-opacity="0.55"/>
      <stop offset="0.55" stop-color="#3fb950" stop-opacity="0.55"/>
      <stop offset="0.80" stop-color="#e3b341" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#e3b341" stop-opacity="0.10"/>
    </linearGradient>
  </defs>
  <rect width="780" height="250" rx="10" fill="#0d1117"/>
  <rect width="780" height="34" rx="10" fill="#161b22"/><rect y="24" width="780" height="10" fill="#161b22"/>
  <circle cx="22" cy="17" r="5.5" fill="#ff5f56"/><circle cx="42" cy="17" r="5.5" fill="#ffbd2e"/><circle cx="62" cy="17" r="5.5" fill="#27c93f"/>
  <text x="390" y="22" text-anchor="middle" class="dim" style="font-size:12px">context-relay</text>

  <text x="40" y="68" class="fg">context in one session</text>
  <text x="740" y="68" text-anchor="end" class="dim">tokens</text>

  <!-- scale: see x() in the generator -->
  <rect x="40" y="96" width="700" height="34" rx="6" fill="url(#zone)"/>
  <line x1="40" y1="140" x2="740" y2="140" stroke="#30363d"/>
  <g class="dim" text-anchor="middle" style="font-size:12px">
    @@TICKS@@
  </g>

  <text x="215" y="90" text-anchor="middle" class="g">sweet spot</text>
  <text x="600" y="90" text-anchor="middle" class="y">costs more, recall suffers</text>

  <text x="732" y="118" text-anchor="end" class="y" style="font-size:12px">hallucinations get likelier</text>

  <!-- threshold -->
  <line x1="@@TX@@" y1="86" x2="@@TX@@" y2="140" stroke="#58a6ff" stroke-width="2" stroke-dasharray="4 3"/>
  <text x="@@TX@@" y="184" text-anchor="middle" class="b">default threshold: @@TK@@k</text>
  <text x="@@TX@@" y="204" text-anchor="middle" class="dim" style="font-size:13px">yours to move</text>

  <!-- fresh start -->
  <g class="fresh">
    <path d="M@@F0@@ 168 v8 h@@FW@@ v-8" fill="none" stroke="#3fb950" stroke-width="1.5"/>
    <text x="@@FM@@" y="196" text-anchor="middle" class="g" style="font-size:13px">fresh session</text>
    <text x="@@FM@@" y="214" text-anchor="middle" class="dim" style="font-size:13px">@@FRESH0@@k to @@FRESH1@@k</text>
  </g>

  <!-- marker: starts at the top of the fresh range and runs a little past the threshold -->
  <g class="mk"><rect class="mkc" x="@@MX@@" y="90" width="6" height="46" rx="3"/></g>

  <text x="740" y="236" text-anchor="end" class="dim" style="font-size:12px">Drawn, not recorded. Nobody publishes where the line lies; the range is a sketch.</text>
</svg>
'''
svg = (SVG
    .replace('@@RUN@@', num(round(x(THRESHOLD + 10_000) - x(start), 1)))
    .replace('@@BACK@@', num(round(x(sum(FRESH) / 2) - x(start), 1)))
    .replace('@@TX@@', num(x(THRESHOLD)))
    .replace('@@TK@@', str(THRESHOLD // 1000))
    .replace('@@F0@@', num(x(FRESH[0])))
    .replace('@@FW@@', num(round(x(FRESH[1]) - x(FRESH[0]), 1)))
    .replace('@@FM@@', num(round(x(sum(FRESH) / 2), 1)))
    .replace('@@MX@@', num(round(x(start) - 3, 1)))
    .replace('@@FRESH0@@', str(FRESH[0] // 1000))
    .replace('@@FRESH1@@', str(FRESH[1] // 1000))
    .replace('@@TICKS@@', ticks))
open(os.path.join(OUT, 'sweet-spot.svg'), 'w', encoding='utf-8').write(svg)
