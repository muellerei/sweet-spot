# Writes docs/images/typing.svg. Run: python3 docs/src/held.py [output directory]
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'images')
from common import *
W, H, DUR = 780, 350, 22

def chip(x, y, text, cls, extra=''):
    w = len(text) * 9 + 18
    return (f'<rect x="{x}" y="{y}" width="{w}" height="26" rx="4" fill="#21262d" stroke="#30363d"/>'
            f'<text x="{x+9}" y="{y+18}" class="{cls}">{text}</text>')

E = []  # (id, svg, intervals, fin)

# labels of the two acts sit above the windows' gap, centered
E += [
 ('actA', '<text x="36" y="262" class="g">1 · it works</text>', [(0, 49)], False),
 ('actB', '<text x="36" y="262" class="y">2 · the submit fails</text>', [(50, 99)], True),
 ('prog', '<text x="52" y="96" class="dim" style="font-size:12px">handover running</text><rect x="52" y="104" width="258" height="10" rx="3" fill="#21262d"/>', [(4, 38), (52, 66)], False),
 ('held', '<text x="52" y="208" class="y" style="font-size:12px">held, not lost</text>', [(12, 38), (56, 66)], False),
 ('arrowlbl', '<text x="390" y="116" text-anchor="middle" class="dim" style="font-size:11px">/clear + submit</text>', [(36, 49), (64, 79)], False),
 ('cross', '<text x="390" y="146" text-anchor="middle" class="y" style="font-size:26px">✕</text>', [(67, 79)], False),
 ('empty', '<text x="478" y="152" class="y" style="font-size:12px">nothing arrived</text>', [(69, 80)], False),
 ('store', '<rect x="300" y="226" width="180" height="84" rx="8" fill="none" stroke="#30363d" stroke-dasharray="4 4"/><text x="408" y="258" class="dim" style="font-size:12px">kept</text>', [(66, 84)], False),
 ('redeliver', chip(470, 82, '/context-relay redeliver', 'b'), [(78, 98)], True),
 ('first', '<text x="474" y="202" class="dim" style="font-size:11px">first message</text>', [(44, 49), (88, 98)], True),
 ('capA', '<text x="390" y="334" text-anchor="middle" class="dim">typed meanwhile, the text is held and goes in with the summary</text>', [(0, 49)], False),
 ('capB', '<text x="390" y="334" text-anchor="middle" class="dim">nothing is lost: redeliver puts it in</text>', [(50, 99)], True),
]
Sx, Sy, Tx, Ty = 52, 130, 60, 166
chips = [
 ('chipT', chip(Tx, Ty, 'fix the tests', 'b')),
 ('chipS', chip(Sx, Sy, 'summary', 'g')),
]
def pts(first, again, fdx, sdx, sdy):
    return [(0, 0, 0, 0), (first - 0.6, 0, 0, 0), (first, 1, 0, 0), (38, 1, 0, 0), (44, 1, fdx, 0), (48.8, 1, fdx, 0), (49.6, 0, fdx, 0), (50, 0, 0, 0),
            (again - 0.6, 0, 0, 0), (again, 1, 0, 0), (66, 1, 0, 0), (69, 1, sdx, sdy), (82, 1, sdx, sdy), (88, 1, fdx, 0),
            (97, 1, fdx, 0), (98.5, 0, fdx, 0), (100, 0, 0, 0)]
css = ''.join(opacity_kf(i, ivs) for i, _, ivs, _ in E if ivs)
tp = pts(10, 54, 408, 250, 100); sp = pts(32, 62, 416, 258, 106)
css += move_kf('chipT', tp) + move_kf('chipS', sp)
# progress fill: grows in act 1 (4..30) and act 2 (52..62)
css += '    @keyframes fill { 0%, 4% { opacity: 1; transform: scaleX(0) } 30% { opacity: 1; transform: scaleX(1) } 38%, 52% { opacity: 0; transform: scaleX(1) } 52.01% { opacity: 1; transform: scaleX(0) } 62% { opacity: 1; transform: scaleX(1) } 66%, 100% { opacity: 0; transform: scaleX(1) } }\n'

els = ''.join(f'  <g class="e{" fin" if fin else ""}" style="animation-name:{i}">{svg}</g>\n' for i, svg, _, fin in E)
els += '  <rect class="fill e" x="52" y="104" width="258" height="10" rx="3" fill="#3fb950" style="animation-name:fill"/>\n'
els += ''.join(f'  <g class="e chip fin-chip" style="animation-name:{i}">{svg}</g>\n' for i, svg in chips)

static = f'''  <rect x="36" y="50" width="290" height="166" rx="8" fill="#161b22" stroke="#30363d"/>
  <text x="52" y="74" class="dim">old session</text>
  <rect x="52" y="158" width="258" height="38" rx="6" fill="#0d1117" stroke="#30363d"/>
  <rect x="454" y="50" width="290" height="166" rx="8" fill="#161b22" stroke="#30363d"/>
  <text x="470" y="74" class="dim" style="opacity:0">new session</text>
  <rect x="462" y="118" width="268" height="92" rx="6" fill="#0d1117" stroke="#30363d"/>
  <line x1="332" y1="130" x2="440" y2="130" stroke="#30363d" stroke-width="2"/><path d="M440 124 L452 130 L440 136 Z" fill="#30363d"/>
'''
# "new session" title placed at the top-left of the right window, redeliver chip sits to its right
static = static.replace('<text x="470" y="74" class="dim" style="opacity:0">new session</text>', '<text x="470" y="74" class="dim">new session</text>')
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-labelledby="t d">
  <title id="t">what happens to what you type during a handover, drawn as a loop</title>
  <desc id="d">While the summary is written you keep typing. The text is held and goes into the fresh session together with the summary. If that submit fails, both are kept, and redeliver puts them in.</desc>
  <style>
{BASECSS}    .e {{ opacity: 0; animation-duration: {DUR}s; animation-timing-function: linear; animation-iteration-count: infinite; animation-fill-mode: both; }}
    .fill {{ transform-box: fill-box; transform-origin: left center; }}
{css}    @media (prefers-reduced-motion: reduce) {{
      .e {{ animation: none; opacity: 0; }} .e.fin {{ opacity: 1; }} .fill {{ display: none; }} .chip {{ transform: translate(416px, 0); }}
    }}
  </style>
{HEAD.format(W=W, H=H, cx=W//2)}{static}{els}</svg>
'''
open(os.path.join(OUT, 'typing.svg'), 'w', encoding='utf-8').write(svg)
