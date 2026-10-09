# Writes docs/relay.svg: the handover as a looping drawing. The numbers come from the
# constants below, so the end of the loop cannot drift away from what the README states:
# a fresh session started inside FRESH (common.py) in real handovers, so the loop ends inside it.
# The counting between START and PEAK is an illustration, not a measurement.
# Run: python3 docs/src/relay.py [output directory]
import os, sys
from common import THRESHOLD, FRESH
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
START = 30_000           # where the loop begins
PEAK = 201_000           # the last value counted before the handover
END = 80_000             # where the fresh session stands; must lie inside FRESH
STEPS = 18               # counted values between START and PEAK
assert FRESH[0] <= END <= FRESH[1], 'the loop must end inside the measured range'
TRAVEL = 408             # width in pixels the number travels while the bar fills

def pos(tokens):
    return round((tokens / THRESHOLD - START / THRESHOLD) / (1 - START / THRESHOLD) * TRAVEL, 1)

def scale(tokens):
    return f'{tokens / THRESHOLD:.3g}'.lstrip('0') if tokens < THRESHOLD else '1'

def num(v):
    return str(int(v)) if float(v).is_integer() else str(v)

ramp = [round(START / 1000 + (PEAK - START) / 1000 * i / STEPS) for i in range(STEPS + 1)]
labels = ['    <text class="n" style="animation-name:c%d" x="198" y="84">%dk</text>' % (i, v) for i, v in enumerate(ramp)]
labels.append('    <text class="n rest" style="animation-name:c%d" x="198" y="84">%dk</text>' % (STEPS + 1, END // 1000))
SVG = '''<svg xmlns="http://www.w3.org/2000/svg" width="780" height="250" viewBox="0 0 780 250" role="img" aria-labelledby="t d">
  <title id="t">context-relay handover, drawn as a loop</title>
  <desc id="d">The context bar fills past the threshold, the mod waits for a subagent, hands the session over and continues in a fresh one with a small context.</desc>
  <style>
    text { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 15px; }
    .dim { fill: #8b949e; } .fg { fill: #e6edf3; } .y { fill: #e3b341; } .g { fill: #3fb950; } .b { fill: #58a6ff; }
    .l, .n { opacity: 0; animation-duration: 14s; animation-timing-function: linear; animation-iteration-count: infinite; animation-fill-mode: both; }
    .bar { transform-box: fill-box; transform-origin: left center; animation: bar 14s linear infinite both, barc 14s linear infinite both; }
    .num { animation: follow 14s linear infinite both, barc 14s linear infinite both; }
    .a1 { animation-name: a1; } .a2 { animation-name: a2; } .a3 { animation-name: a3; } .a4 { animation-name: a4; }
    @keyframes follow { 0% { transform: translateX(0) } 30% { transform: translateX(@@TRAVEL@@px) } 62% { transform: translateX(@@TRAVEL@@px) } 64% { transform: translateX(@@ENDX@@px) } 100% { transform: translateX(@@ENDX@@px) } }
    @keyframes bar { 0% { transform: scaleX(@@S0@@) } 30% { transform: scaleX(@@ONE@@) } 62% { transform: scaleX(@@ONE@@) } 64% { transform: scaleX(@@S1@@) } 100% { transform: scaleX(@@S1@@) } }
    @keyframes barc { 0% { fill: #3fb950 } 26% { fill: #3fb950 } 30% { fill: #e3b341 } 62% { fill: #e3b341 } 64% { fill: #3fb950 } 100% { fill: #3fb950 } }
    @keyframes c0 { 0.00%, 1.66% { opacity: 1 } 1.67%, 100% { opacity: 0 } }
    @keyframes c1 { 0%, 1.66% { opacity: 0 } 1.67%, 3.32% { opacity: 1 } 3.33%, 100% { opacity: 0 } }
    @keyframes c2 { 0%, 3.32% { opacity: 0 } 3.33%, 4.99% { opacity: 1 } 5.00%, 100% { opacity: 0 } }
    @keyframes c3 { 0%, 4.99% { opacity: 0 } 5.00%, 6.66% { opacity: 1 } 6.67%, 100% { opacity: 0 } }
    @keyframes c4 { 0%, 6.66% { opacity: 0 } 6.67%, 8.32% { opacity: 1 } 8.33%, 100% { opacity: 0 } }
    @keyframes c5 { 0%, 8.32% { opacity: 0 } 8.33%, 9.99% { opacity: 1 } 10.00%, 100% { opacity: 0 } }
    @keyframes c6 { 0%, 9.99% { opacity: 0 } 10.00%, 11.66% { opacity: 1 } 11.67%, 100% { opacity: 0 } }
    @keyframes c7 { 0%, 11.66% { opacity: 0 } 11.67%, 13.32% { opacity: 1 } 13.33%, 100% { opacity: 0 } }
    @keyframes c8 { 0%, 13.32% { opacity: 0 } 13.33%, 14.99% { opacity: 1 } 15.00%, 100% { opacity: 0 } }
    @keyframes c9 { 0%, 14.99% { opacity: 0 } 15.00%, 16.66% { opacity: 1 } 16.67%, 100% { opacity: 0 } }
    @keyframes c10 { 0%, 16.66% { opacity: 0 } 16.67%, 18.32% { opacity: 1 } 18.33%, 100% { opacity: 0 } }
    @keyframes c11 { 0%, 18.32% { opacity: 0 } 18.33%, 19.99% { opacity: 1 } 20.00%, 100% { opacity: 0 } }
    @keyframes c12 { 0%, 19.99% { opacity: 0 } 20.00%, 21.66% { opacity: 1 } 21.67%, 100% { opacity: 0 } }
    @keyframes c13 { 0%, 21.66% { opacity: 0 } 21.67%, 23.32% { opacity: 1 } 23.33%, 100% { opacity: 0 } }
    @keyframes c14 { 0%, 23.32% { opacity: 0 } 23.33%, 24.99% { opacity: 1 } 25.00%, 100% { opacity: 0 } }
    @keyframes c15 { 0%, 24.99% { opacity: 0 } 25.00%, 26.66% { opacity: 1 } 26.67%, 100% { opacity: 0 } }
    @keyframes c16 { 0%, 26.66% { opacity: 0 } 26.67%, 28.32% { opacity: 1 } 28.33%, 100% { opacity: 0 } }
    @keyframes c17 { 0%, 28.32% { opacity: 0 } 28.33%, 29.99% { opacity: 1 } 30.00%, 100% { opacity: 0 } }
    @keyframes c18 { 0%, 29.99% { opacity: 0 } 30.00%, 63.49% { opacity: 1 } 63.50%, 100% { opacity: 0 } }
    @keyframes c19 { 0%, 63.99% { opacity: 0 } 64.00%, 95.99% { opacity: 1 } 96.00%, 100% { opacity: 0 } }
    @keyframes a1 { 0%, 31% { opacity: 0 } 33%, 95% { opacity: 1 } 98%, 100% { opacity: 0 } }
    @keyframes a2 { 0%, 47% { opacity: 0 } 49%, 95% { opacity: 1 } 98%, 100% { opacity: 0 } }
    @keyframes a3 { 0%, 61% { opacity: 0 } 63%, 95% { opacity: 1 } 98%, 100% { opacity: 0 } }
    @keyframes a4 { 0%, 72% { opacity: 0 } 74%, 95% { opacity: 1 } 98%, 100% { opacity: 0 } }
    @keyframes a5 { 0%, 83% { opacity: 0 } 85%, 95% { opacity: 1 } 98%, 100% { opacity: 0 } }
    @media (prefers-reduced-motion: reduce) {
      .l, .n, .bar, .num { animation: none; opacity: 1; }
      .n { opacity: 0; } .n.rest { opacity: 1; } .num { transform: translateX(@@ENDX@@px); fill: #3fb950; } .bar { transform: scaleX(@@S1@@); fill: #3fb950; }
    }
  </style>
  <rect width="780" height="250" rx="10" fill="#0d1117"/>
  <rect width="780" height="34" rx="10" fill="#161b22"/><rect y="24" width="780" height="10" fill="#161b22"/>
  <circle cx="22" cy="17" r="5.5" fill="#ff5f56"/><circle cx="42" cy="17" r="5.5" fill="#ffbd2e"/><circle cx="62" cy="17" r="5.5" fill="#27c93f"/>
  <text x="390" y="22" text-anchor="middle" class="dim" style="font-size:12px">context-relay</text>

  <text x="36" y="84" class="dim">context</text>
  <rect x="116" y="70" width="480" height="14" rx="3" fill="#21262d"/>
  <rect class="bar" x="116" y="70" width="480" height="14" rx="3"/>
  <line x1="593" y1="64" x2="593" y2="90" stroke="#8b949e" stroke-width="1" stroke-dasharray="3 3"/>
  <text x="593" y="56" text-anchor="middle" class="dim" style="font-size:11px">threshold @@TK@@k</text>
  <g class="num" style="transform-box:view-box">
@@LABELS@@
  </g>

  <g class="l a1"><text x="36" y="134" class="y">waiting</text><text x="140" y="134" class="fg">a subagent is still running</text></g>
  <g class="l a2"><text x="36" y="162" class="g">handover</text><text x="140" y="162" class="fg">/handoff  →  /clear  →  summary is the first message</text></g>
  <g class="l a3"><text x="36" y="190" class="b">typing</text><text x="140" y="190" class="fg">held meanwhile, sent right after the summary</text></g>
  <g class="l a4"><text x="36" y="218" class="g">fresh</text><text x="140" y="218" class="fg">carries on where you left off</text></g>
</svg>
'''
svg = (SVG
    .replace('@@LABELS@@', '\n'.join(labels))
    .replace('@@TRAVEL@@', str(TRAVEL))
    .replace('@@ENDX@@', num(pos(END)))
    .replace('@@S0@@', scale(START))
    .replace('@@S1@@', scale(END))
    .replace('@@ONE@@', '1')
    .replace('@@TK@@', str(THRESHOLD // 1000)))
open(os.path.join(OUT, 'relay.svg'), 'w', encoding='utf-8').write(svg)
