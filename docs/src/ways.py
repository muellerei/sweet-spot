# Writes docs/images/ways.svg: the two ways a handover can go, side by side, for the
# "Handoff or compact" section of the README. Static on purpose: it compares, it does not
# tell a sequence. The only number is the threshold, taken from common.py.
# Run: python3 docs/src/ways.py [output directory]
import os, sys
from common import THRESHOLD, HEAD, BASECSS
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'images')
W, H = 780, 280

SVG = '''<svg xmlns="http://www.w3.org/2000/svg" width="@@W@@" height="@@H@@" viewBox="0 0 @@W@@ @@H@@" role="img" aria-labelledby="t d">
  <title id="t">the two ways sweet-spot hands a session over</title>
  <desc id="d">A context bar past the threshold of @@TK@@k splits into two ways. Handoff: the mod writes a handoff, clears the session, and a fresh session starts that holds only the handoff, which you can read as its first message. Compact: Claude Code's own /compact runs, and the same session goes on with a summary in place of the history; Claude Code decides what the summary keeps.</desc>
  <style>
@@CSS@@    .s { font-size: 14px; }
  </style>
@@HEAD@@
  <text x="36" y="84" class="dim">context</text>
  <rect x="116" y="70" width="480" height="14" rx="3" fill="#e3b341"/>
  <line x1="593" y1="64" x2="593" y2="90" stroke="#8b949e" stroke-width="1" stroke-dasharray="3 3"/>
  <text x="593" y="56" text-anchor="middle" class="dim" style="font-size:11px">threshold @@TK@@k</text>

  <!-- the split: one line down from the bar, a branch to each way -->
  <path d="M24 96 V 196 M24 128 H 32 M24 196 H 32" fill="none" stroke="#30363d" stroke-width="2"/>

  <text x="36" y="132" class="g">handoff</text>
  <text x="140" y="132" class="fg s">writes a handoff  →  /clear  →  a fresh session</text>
  <text x="140" y="154" class="dim s">holds only the handoff; you read it as the first message</text>

  <text x="36" y="200" class="b">compact</text>
  <text x="140" y="200" class="fg s">Claude Code's /compact  →  the same session goes on</text>
  <text x="140" y="222" class="dim s">a summary in place of the history; Claude Code decides what it keeps</text>

  <text x="@@RX@@" y="262" text-anchor="end" class="dim" style="font-size:12px">Drawn, not recorded.</text>
</svg>
'''
svg = (SVG
    .replace('@@HEAD@@', HEAD.format(W=W, H=H, cx=W // 2))
    .replace('@@CSS@@', BASECSS)
    .replace('@@W@@', str(W)).replace('@@H@@', str(H))
    .replace('@@RX@@', str(W - 40))
    .replace('@@TK@@', str(THRESHOLD // 1000)))
open(os.path.join(OUT, 'ways.svg'), 'w', encoding='utf-8').write(svg)
