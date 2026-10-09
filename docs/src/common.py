# Numbers the pictures and the README state; check.py compares the README, plugin.json and
# the workflow against them, so none of them can drift on its own.
THRESHOLD = 200_000          # default of the threshold setting
FRESH = (62_000, 98_000)     # where a fresh session started in real handovers

HEAD = '''  <rect width="{W}" height="{H}" rx="10" fill="#0d1117"/>
  <rect width="{W}" height="34" rx="10" fill="#161b22"/><rect y="24" width="{W}" height="10" fill="#161b22"/>
  <circle cx="22" cy="17" r="5.5" fill="#ff5f56"/><circle cx="42" cy="17" r="5.5" fill="#ffbd2e"/><circle cx="62" cy="17" r="5.5" fill="#27c93f"/>
  <text x="{cx}" y="22" text-anchor="middle" class="dim" style="font-size:12px">context-relay</text>
'''
BASECSS = '''    text { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 15px; }
    .dim { fill: #8b949e; } .fg { fill: #e6edf3; } .y { fill: #e3b341; } .g { fill: #3fb950; } .b { fill: #58a6ff; }
'''

def opacity_kf(name, ivs, fade=0.6):
    pts = [(0, 0)]
    for a, b in ivs:
        pts += [(max(a - fade, 0), 0), (a, 1), (b, 1), (min(b + fade, 100), 0)]
    pts.append((100, 0))
    out = []
    for p, o in pts:
        if out and out[-1] == (p, o):
            continue
        out.append((p, o))
    return f'    @keyframes {name} {{ ' + ' '.join(f'{p:.2f}% {{ opacity: {o} }}' for p, o in out) + ' }\n'

def move_kf(name, pts):
    return f'    @keyframes {name} {{ ' + ' '.join(
        f'{p:.2f}% {{ opacity: {o}; transform: translate({dx}px, {dy}px) }}' for p, o, dx, dy in pts) + ' }\n'
