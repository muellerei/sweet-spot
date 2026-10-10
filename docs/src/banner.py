# Writes docs/images/banner-light.svg and docs/images/banner-dark.svg. With --social, writes social-preview.svg
# instead (the picture behind docs/images/social-preview.png; render it to 1280x640 PNG).
# Run: python3 docs/src/banner.py [output directory] [--social]
import os, re, sys
args = [a for a in sys.argv[1:] if a != '--social']
OUT = args[0] if args else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'images')
SOCIAL = '--social' in sys.argv
T = {
 'light': dict(bg1='#ffffff', bg2='#eef3fb', dot='#0d1117', dota='0.07', gauge='#eaeef3', stroke='#c3ccd6', title='#1f2328', sub='#31363d', small='#59636e', a1='#0284c7', a2='#7c3aed', warn='#bf8700'),
 'dark':  dict(bg1='#0d1117', bg2='#161b22', dot='#ffffff', dota='0.06', gauge='#21262d', stroke='#30363d', title='#e6edf3', sub='#c9d1d9', small='#8b949e', a1='#58a6ff', a2='#bc8cff', warn='#e3b341'),
}
def svg(theme, w, h, big=False):
    c = T[theme]
    s = 1.0 if not big else 1.25
    mx, my = (110, (h-170*s)/2) if not big else (150, (h-170*s)/2-40)
    tx = 470 if not big else 560
    ty = h/2+ (4 if not big else -10)
    fs = 78 if not big else 92
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-label="sweet-spot: hands a long Claude Code session over to a fresh one">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{c['bg1']}"/><stop offset="1" stop-color="{c['bg2']}"/></linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="{c['a1']}"/><stop offset="1" stop-color="{c['a2']}"/></linearGradient>
    <linearGradient id="fill" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="{c['a1']}"/><stop offset="1" stop-color="{c['a2']}"/></linearGradient>
    <pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.2" fill="{c['dot']}" opacity="{c['dota']}"/></pattern>
    <clipPath id="g1"><rect x="0" y="0" width="120" height="120" rx="26"/></clipPath>
    <style>
      .mono {{ font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; }}
      .sans {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }}
      .card {{ animation: card 5s ease-in-out infinite; }}
      @keyframes card {{ 0%, 15% {{ transform: translate(0,0); opacity: 0; }} 25% {{ transform: translate(0,0); opacity: 1; }} 60%, 80% {{ transform: translate(104px,0); opacity: 1; }} 90% {{ transform: translate(104px,0); opacity: 0; }} 100% {{ transform: translate(0,0); opacity: 0; }} }}
      .old {{ animation: old 5s ease-in-out infinite; transform-box: fill-box; transform-origin: bottom; }}
      @keyframes old {{ 0%, 55% {{ transform: scaleY(1); }} 85%, 100% {{ transform: scaleY(0.12); }} }}
      .new {{ animation: nw 5s ease-in-out infinite; transform-box: fill-box; transform-origin: bottom; }}
      @keyframes nw {{ 0%, 55% {{ transform: scaleY(0.12); }} 85%, 100% {{ transform: scaleY(0.85); }} }}
    </style>
  </defs>
  <rect width="{w}" height="{h}" rx="24" fill="url(#bg)"/>
  <rect width="{w}" height="{h}" rx="24" fill="url(#dots)"/>
  <g transform="translate({mx} {my}) scale({s})">
    <g transform="translate(0 25)">
      <rect width="120" height="120" rx="26" fill="{c['gauge']}" stroke="{c['stroke']}" stroke-width="2"/>
      <g clip-path="url(#g1)"><rect class="old" x="0" y="0" width="120" height="120" fill="url(#fill)" opacity="0.9"/></g>
      <line x1="-8" y1="22" x2="128" y2="22" stroke="{c['warn']}" stroke-width="3" stroke-dasharray="7 6"/>
    </g>
    <g transform="translate(176 25)">
      <rect width="120" height="120" rx="26" fill="{c['gauge']}" stroke="{c['stroke']}" stroke-width="2"/>
      <g clip-path="url(#g1)"><rect class="new" x="0" y="0" width="120" height="120" fill="url(#fill)" opacity="0.9"/></g>
      <rect width="120" height="120" rx="26" fill="none" stroke="url(#accent)" stroke-width="3"/>
    </g>
    <g class="card"><rect x="76" y="66" width="68" height="40" rx="9" fill="{c['bg1']}" stroke="url(#accent)" stroke-width="3"/><rect x="88" y="78" width="36" height="6" rx="3" fill="url(#accent)"/><rect x="88" y="90" width="24" height="6" rx="3" fill="url(#accent)"/></g>
  </g>
  <text x="{tx}" y="{ty}" class="mono" font-size="{fs}" font-weight="700" fill="{c['title']}" letter-spacing="-2">sweet<tspan fill="url(#accent)">-</tspan>spot</text>
  <text x="{tx+4}" y="{ty+52}" class="sans" font-size="{30 if not big else 34}" fill="{c['sub']}">Hands a long Claude Code session over to a fresh one</text>
  <text x="{tx+4}" y="{ty+96}" class="sans" font-size="{21 if not big else 24}" fill="{c['small']}">before the context gets too big · at a moment when it is safe</text>
</svg>
'''
if not SOCIAL:
    for th in T:
        open(os.path.join(OUT, f'banner-{th}.svg'), 'w', encoding='utf-8').write(svg(th, 1280, 320))
    sys.exit()

# social preview: stacked and centred, square corners, a still frame
s = svg('dark', 1280, 640, True)
s = s.replace('rx="24" fill="url(#bg)"', 'rx="0" fill="url(#bg)"').replace('rx="24" fill="url(#dots)"', 'rx="0" fill="url(#dots)"')
s = re.sub(r'translate\(150 [-\d.]+\) scale\(1.25\)', 'translate(425 90) scale(1.4)', s)
s = re.sub(r'<text x="560" y="[\d.]+" class="mono" font-size="92"', '<text x="640" y="400" text-anchor="middle" class="mono" font-size="96"', s)
s = re.sub(r'<text x="564" y="[\d.]+" class="sans" font-size="34"', '<text x="640" y="470" text-anchor="middle" class="sans" font-size="36"', s)
s = re.sub(r'<text x="564" y="[\d.]+" class="sans" font-size="24"', '<text x="640" y="525" text-anchor="middle" class="sans" font-size="26"', s)
s = s.replace('</style>', '.card,.old,.new{animation:none!important} .card{transform:translate(52px,0);opacity:1} .old{transform:scaleY(1)} .new{transform:scaleY(0.45)}</style>')
open(os.path.join(OUT, 'social-preview.svg'), 'w', encoding='utf-8').write(s)
