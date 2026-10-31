# Writes icon.svg, the square picture behind .claude-plugin/icon.png: the scale of
# docs/images/sweet-spot.svg without its words, so it stays legible at listing size.
# Positions come from the same numbers as that picture (common.py).
# Run: python3 docs/src/icon.py <output directory>, then render the SVG to a 1024 by 1024
# PNG, for example with headless Chrome (see CONTRIBUTING.md).
import os, sys
from common import THRESHOLD, FRESH
OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
SIZE = 1024
AXIS = 400_000                 # right end of the scale, as in sweet.py
X0, X1 = 112, 912              # scale on the icon, in pixels
TOP, H = 392, 240              # the band of the scale

def x(tokens):
    return round(X0 + tokens / AXIS * (X1 - X0), 1)

SVG = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" viewBox="0 0 {SIZE} {SIZE}">
  <defs>
    <linearGradient id="zone" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#3fb950" stop-opacity="0.25"/>
      <stop offset="0.12" stop-color="#3fb950" stop-opacity="0.75"/>
      <stop offset="0.55" stop-color="#3fb950" stop-opacity="0.75"/>
      <stop offset="0.80" stop-color="#e3b341" stop-opacity="0.75"/>
      <stop offset="1" stop-color="#e3b341" stop-opacity="0.20"/>
    </linearGradient>
  </defs>
  <rect width="{SIZE}" height="{SIZE}" rx="200" fill="#0d1117"/>
  <rect x="{X0}" y="{TOP}" width="{X1 - X0}" height="{H}" rx="40" fill="url(#zone)"/>
  <line x1="{x(THRESHOLD)}" y1="{TOP - 56}" x2="{x(THRESHOLD)}" y2="{TOP + H + 56}" stroke="#58a6ff" stroke-width="20" stroke-dasharray="42 20" stroke-linecap="round"/>
  <rect x="{x(FRESH[1]) - 18}" y="{TOP - 32}" width="36" height="{H + 64}" rx="18" fill="#e6edf3"/>
</svg>
'''

with open(os.path.join(OUT, 'icon.svg'), 'w') as f:
    f.write(SVG)
