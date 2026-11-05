"""GreekOS original background scene: Thessaloniki waterfront at golden hour.

Deterministic SVG generator (seeded) — fully original vector art authored for GreekOS, no
third-party imagery. Run: python3 scripts/scene/generate_scene.py > public/scene/thessaloniki.svg
"""
import math
import random

W, H = 2400, 1500
HORIZON = 905
rnd = random.Random(1912)  # fixed seed → identical output on every machine
out = []
p = out.append


def f(x):
    return f"{x:.1f}"


p(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">')
p('''<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#e9ddd0"/><stop offset=".38" stop-color="#f1d9c0"/>
  <stop offset=".72" stop-color="#f6c9a2"/><stop offset="1" stop-color="#f8bf92"/>
</linearGradient>
<radialGradient id="sun" cx="1560" cy="842" r="760" gradientUnits="userSpaceOnUse">
  <stop offset="0" stop-color="#fff3dc" stop-opacity="1"/><stop offset=".12" stop-color="#ffe2b8" stop-opacity=".95"/>
  <stop offset=".45" stop-color="#ffcf9c" stop-opacity=".35"/><stop offset="1" stop-color="#ffc58f" stop-opacity="0"/>
</radialGradient>
<linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#b7c3be"/><stop offset=".35" stop-color="#a9b9b6"/>
  <stop offset=".75" stop-color="#9fb0ad"/><stop offset="1" stop-color="#8fa2a2"/>
</linearGradient>
<linearGradient id="mount1" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#b6aebb"/><stop offset="1" stop-color="#cbbdb9"/>
</linearGradient>
<linearGradient id="mount2" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#c7b9b9"/><stop offset="1" stop-color="#d9c5b8"/>
</linearGradient>
<linearGradient id="tower" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#e9ddcf"/><stop offset=".35" stop-color="#fbf3e8"/>
  <stop offset=".7" stop-color="#ead9c6"/><stop offset="1" stop-color="#c9b29c"/>
</linearGradient>
<linearGradient id="glint" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#fff1d6" stop-opacity=".95"/><stop offset="1" stop-color="#ffd9a8" stop-opacity="0"/>
</linearGradient>
<linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#d9a37f"/><stop offset="1" stop-color="#b9774f"/>
</linearGradient>
<linearGradient id="vign" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#3b2a1f" stop-opacity=".10"/><stop offset=".3" stop-color="#3b2a1f" stop-opacity="0"/>
  <stop offset=".8" stop-color="#3b2a1f" stop-opacity="0"/><stop offset="1" stop-color="#3b2a1f" stop-opacity=".16"/>
</linearGradient>
<filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6"/></filter>
<filter id="haze" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.2"/></filter>
<filter id="grain" x="0" y="0" width="100%" height="100%">
  <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7" result="n"/>
  <feColorMatrix type="saturate" values="0"/>
  <feComponentTransfer><feFuncR type="linear" slope="0" intercept=".25"/><feFuncG type="linear" slope="0" intercept=".2"/><feFuncB type="linear" slope="0" intercept=".16"/><feFuncA type="table" tableValues="0 .07"/></feComponentTransfer>
</filter>
</defs>''')

# Sky and sun
p(f'<rect width="{W}" height="{HORIZON + 5}" fill="url(#sky)"/>')
p(f'<rect width="{W}" height="{H}" fill="url(#sun)"/>')
p('<circle cx="1560" cy="842" r="86" fill="#fff4de" opacity=".92" filter="url(#soft)"/>')

# Soft clouds
for cx, cy, rx, ry, o in [(420, 260, 360, 34, .35), (760, 330, 260, 22, .28), (1880, 300, 420, 30, .3), (2160, 420, 300, 22, .22), (1240, 520, 520, 18, .2)]:
    p(f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="#fff6ec" opacity="{o}" filter="url(#soft)"/>')

# Olympus range across the Thermaic Gulf (far left), two ridges
def ridge(points, fill, opacity):
    d = f"M0,{HORIZON} " + " ".join(f"L{f(x)},{f(y)}" for x, y in points) + f" L{points[-1][0]},{HORIZON} Z"
    p(f'<path d="{d}" fill="{fill}" opacity="{opacity}" filter="url(#haze)"/>')

far = [(0, 792), (90, 770), (170, 748), (240, 730), (300, 716), (345, 694), (380, 702), (420, 676), (452, 660), (478, 648), (500, 656), (522, 646), (548, 664), (580, 678), (612, 670), (650, 690), (700, 712), (760, 734), (830, 752), (910, 778), (1010, 806), (1130, 838), (1260, 868), (1390, 890), (1500, 905)]
ridge(far, "url(#mount1)", .82)
# snow caps on the highest peaks
p('<path d="M452,660 L478,648 L500,656 L522,646 L548,664 L530,670 L512,662 L496,670 L478,660 L462,672 Z" fill="#f4ece6" opacity=".7" filter="url(#haze)"/>')
near = [(0, 838), (160, 822), (320, 832), (470, 812), (610, 828), (760, 846), (930, 862), (1110, 880), (1260, 897), (1330, 905)]
ridge(near, "url(#mount2)", .9)

# Sea
p(f'<rect y="{HORIZON}" width="{W}" height="{H - HORIZON}" fill="url(#sea)"/>')
# sun glitter path under the sun
for i in range(240):
    y = HORIZON + 6 + (i ** 1.35) * 0.9
    if y > 1240:
        break
    spread = 30 + (y - HORIZON) * 0.55
    x = 1560 + rnd.uniform(-spread, spread)
    w = rnd.uniform(18, 70) * (0.6 + (y - HORIZON) / 500)
    o = max(0.12, 0.85 - (y - HORIZON) / 420)
    p(f'<rect x="{f(x - w / 2)}" y="{f(y)}" width="{f(w)}" height="{f(rnd.uniform(1.6, 3.4))}" rx="1.5" fill="#fff0d2" opacity="{o:.2f}"/>')
# gentle swell lines across the gulf
for i in range(70):
    y = HORIZON + 10 + i * 5.2 + rnd.uniform(-2, 2)
    x = rnd.uniform(-200, W)
    w = rnd.uniform(120, 520)
    p(f'<rect x="{f(x)}" y="{f(y)}" width="{f(w)}" height="1.4" fill="#e9eee9" opacity="{rnd.uniform(.08, .22):.2f}"/>')

# Sailboats
for bx, by, s in [(980, 958, 1.0), (1230, 935, .62), (700, 990, 1.25)]:
    p(f'<g transform="translate({bx},{by}) scale({s})" opacity=".85">'
      '<path d="M0,0 L46,0 L38,10 L8,10 Z" fill="#6f6a66"/>'
      '<path d="M22,-2 L22,-74 L48,-6 Z" fill="#fbf5ec"/><path d="M20,-6 L20,-58 L2,-8 Z" fill="#efe4d6"/></g>')

# City skyline along the waterfront (right): polykatoikies with balconies
base = HORIZON + 40
x = 1610
blocks = []
while x < W + 40:
    w = rnd.uniform(70, 150)
    h = rnd.uniform(70, 230) * (0.75 + (x - 1610) / 2400)
    blocks.append((x, w, h))
    x += w + rnd.uniform(-6, 10)
palette = ["#efe2d1", "#e8d5bf", "#f3e9dc", "#e2c9ad", "#ead8c5", "#dcc2a8", "#f0dfca"]
for (bx, bw, bh) in blocks:
    col = rnd.choice(palette)
    p(f'<rect x="{f(bx)}" y="{f(base - bh)}" width="{f(bw)}" height="{f(bh)}" fill="{col}"/>')
    p(f'<rect x="{f(bx + bw * .72)}" y="{f(base - bh)}" width="{f(bw * .28)}" height="{f(bh)}" fill="#7d5b45" opacity=".12"/>')
    # balcony bands
    floors = int(bh // 22)
    for k in range(floors):
        fy = base - bh + 10 + k * 22
        p(f'<rect x="{f(bx + 4)}" y="{f(fy + 12)}" width="{f(bw - 8)}" height="2.2" fill="#a9876f" opacity=".35"/>')
        for wx in range(int(bw // 18)):
            if rnd.random() < .75:
                p(f'<rect x="{f(bx + 8 + wx * 18)}" y="{f(fy)}" width="8" height="10" fill="#8a6b58" opacity="{rnd.uniform(.18, .38):.2f}"/>')
    if rnd.random() < .5:
        p(f'<rect x="{f(bx + bw * .2)}" y="{f(base - bh - 7)}" width="{f(bw * .5)}" height="7" fill="#c98f6a" opacity=".55"/>')

# Promenade (Nea Paralia): quay, trees, lamps
p(f'<rect x="1540" y="{base}" width="{W - 1540}" height="16" fill="#e6d7c4"/>')
p(f'<rect x="1540" y="{base + 16}" width="{W - 1540}" height="5" fill="#9c8a7a" opacity=".5"/>')
for i in range(22):
    tx = 1560 + i * 40 + rnd.uniform(-8, 8)
    r = rnd.uniform(14, 22)
    p(f'<rect x="{f(tx - 1.5)}" y="{f(base - 18)}" width="3" height="20" fill="#5d4a3b" opacity=".7"/>')
    p(f'<circle cx="{f(tx)}" cy="{f(base - 24 - r * .4)}" r="{f(r)}" fill="#6f7d5d" opacity=".85"/>')
    p(f'<circle cx="{f(tx - r * .35)}" cy="{f(base - 28 - r * .5)}" r="{f(r * .55)}" fill="#869570" opacity=".7"/>')

# The White Tower (Lefkos Pyrgos)
tx, tw, th = 1905, 150, 330
ty = base + 8
p(f'<ellipse cx="{tx}" cy="{ty + 6}" rx="{tw * .62}" ry="10" fill="#7a6656" opacity=".22"/>')
p(f'<rect x="{tx - tw / 2}" y="{ty - th}" width="{tw}" height="{th}" fill="url(#tower)"/>')
# masonry rings
for k in range(1, 9):
    yy = ty - th + k * (th / 9)
    p(f'<rect x="{tx - tw / 2}" y="{f(yy)}" width="{tw}" height="1.2" fill="#b8a08a" opacity=".35"/>')
# crenellations
cy0 = ty - th
p(f'<rect x="{tx - tw / 2 - 6}" y="{cy0 - 10}" width="{tw + 12}" height="12" fill="#f3e8da"/>')
for k in range(9):
    cx = tx - tw / 2 - 6 + k * ((tw + 12) / 9)
    p(f'<rect x="{f(cx + 2)}" y="{cy0 - 26}" width="{f((tw + 12) / 9 - 6)}" height="17" fill="#f6ecdf"/>')
# top turret
p(f'<rect x="{tx - 32}" y="{cy0 - 92}" width="64" height="70" fill="url(#tower)"/>')
p(f'<rect x="{tx - 36}" y="{cy0 - 100}" width="72" height="10" fill="#efe2d3"/>')
for k in range(5):
    p(f'<rect x="{tx - 36 + k * 15 + 2}" y="{cy0 - 112}" width="10" height="12" fill="#f4e9dc"/>')
# windows (arrow slits)
for (wx, wy) in [(tx - 40, ty - 250), (tx + 18, ty - 250), (tx - 10, ty - 175), (tx - 45, ty - 105), (tx + 25, ty - 105), (tx - 6, cy0 - 70)]:
    p(f'<rect x="{wx}" y="{wy}" width="9" height="24" rx="4" fill="#6b5446" opacity=".55"/>')
p(f'<rect x="{tx - 14}" y="{ty - 46}" width="28" height="46" rx="14" fill="#5f4a3d" opacity=".6"/>')
# flag pole
p(f'<rect x="{tx - 1}" y="{cy0 - 160}" width="2" height="50" fill="#6b5a4c"/>')
p(f'<path d="M{tx + 1},{cy0 - 158} q16,-4 30,3 t30,0 v18 q-15,-6 -30,-2 t-30,-1 z" fill="#f7f3ee" opacity=".9"/>')

# Haze over the distant city
p(f'<rect x="1500" y="{HORIZON - 260}" width="{W - 1500}" height="300" fill="#fbe2c7" opacity=".16"/>')

# Foreground terrace: tiled floor and wrought-iron railing
p(f'<path d="M0,1310 L{W},1290 L{W},{H} L0,{H} Z" fill="url(#floor)"/>')
for k in range(-14, 30):
    x0 = 1200 + k * 120
    p(f'<path d="M{1200 + k * 34},1302 L{x0 * 1.0},{H}" stroke="#8f5636" stroke-width="2" opacity=".28"/>')
for k, yy in enumerate([1330, 1365, 1410, 1470]):
    p(f'<path d="M0,{yy + 20 - k * 2} L{W},{yy}" stroke="#8f5636" stroke-width="2" opacity=".25"/>')
# railing
rail_y = 1150
p(f'<rect x="0" y="{rail_y}" width="{W}" height="12" rx="6" fill="#3d332d" opacity=".88"/>')
p(f'<rect x="0" y="{rail_y + 120}" width="{W}" height="6" fill="#3d332d" opacity=".75"/>')
for k in range(0, W, 44):
    p(f'<rect x="{k + 10}" y="{rail_y + 10}" width="4" height="150" fill="#3d332d" opacity=".78"/>')
    if (k // 44) % 2 == 0:
        p(f'<circle cx="{k + 12}" cy="{rail_y + 66}" r="11" fill="none" stroke="#3d332d" stroke-width="3" opacity=".6"/>')
p(f'<rect x="0" y="{rail_y + 160}" width="{W}" height="10" fill="#3d332d" opacity=".55"/>')

# Café table (left foreground) with a frappé glass and a book
p('<ellipse cx="420" cy="1268" rx="250" ry="40" fill="#f3ece3"/>')
p('<ellipse cx="420" cy="1262" rx="250" ry="38" fill="#fbf6ef"/>')
p('<rect x="408" y="1300" width="24" height="200" fill="#4a3d35"/>')
p('<ellipse cx="420" cy="1305" rx="70" ry="10" fill="#4a3d35" opacity=".35"/>')
p('<path d="M330,1252 L346,1150 L398,1150 L410,1252 Z" fill="#e9d2b7" opacity=".9"/>')
p('<path d="M336,1215 L404,1215 L410,1252 L330,1252 Z" fill="#b98a5e" opacity=".75"/>')
p('<rect x="370" y="1090" width="5" height="78" rx="2" fill="#2f6f73" transform="rotate(12 372 1130)"/>')
p('<rect x="452" y="1232" width="150" height="22" rx="3" fill="#2f5d62" transform="rotate(-6 527 1243)"/>')
p('<rect x="456" y="1226" width="142" height="9" rx="2" fill="#f7efe3" transform="rotate(-6 527 1230)"/>')

# Terracotta pot with lemon tree (right foreground)
p('<path d="M2030,1500 L2010,1330 L2230,1330 L2210,1500 Z" fill="#c4683f"/>')
p('<rect x="1996" y="1312" width="248" height="30" rx="8" fill="#d47a4f"/>')
p('<rect x="2116" y="1120" width="10" height="200" fill="#6a4f3c"/>')
for i in range(70):
    a = rnd.uniform(0, math.tau)
    r = rnd.uniform(10, 150)
    lx = 2120 + math.cos(a) * r * 1.2
    ly = 1060 + math.sin(a) * r * .75
    rot = rnd.uniform(0, 180)
    p(f'<ellipse cx="{f(lx)}" cy="{f(ly)}" rx="22" ry="9" fill="{rnd.choice(["#5f7a4c", "#6f8c58", "#7f9a63", "#557045"])}" transform="rotate({rot:.0f} {f(lx)} {f(ly)})" opacity=".92"/>')
for i in range(9):
    a = rnd.uniform(0, math.tau)
    r = rnd.uniform(20, 120)
    p(f'<circle cx="{f(2120 + math.cos(a) * r)}" cy="{f(1060 + math.sin(a) * r * .7)}" r="13" fill="#f2c84b"/>')

# Bougainvillea cascading from the top-left corner
def vine(x0, y0, x1, y1, bend):
    p(f'<path d="M{x0},{y0} Q{(x0 + x1) / 2 + bend},{(y0 + y1) / 2} {x1},{y1}" stroke="#6b4b3a" stroke-width="5" fill="none" opacity=".7"/>')

for (x0, y0, x1, y1, bend) in [(-20, 40, 520, 160, 80), (40, -20, 260, 420, -60), (-30, 220, 380, 330, 40), (200, -10, 760, 90, 30)]:
    vine(x0, y0, x1, y1, bend)
for i in range(520):
    # density concentrated near the corner
    t = rnd.random() ** 1.6
    a = rnd.uniform(-0.15, 1.55)
    r = 40 + t * 720
    x = math.cos(a) * r * 1.05 + rnd.uniform(-40, 40)
    y = math.sin(a) * r * 0.62 + rnd.uniform(-30, 30)
    if x < -20 or y < -20:
        continue
    if rnd.random() < .34:
        rot = rnd.uniform(0, 180)
        p(f'<ellipse cx="{f(x)}" cy="{f(y)}" rx="{f(rnd.uniform(14, 24))}" ry="{f(rnd.uniform(6, 10))}" fill="{rnd.choice(["#5d7448", "#6a8352", "#4f6640"])}" transform="rotate({rot:.0f} {f(x)} {f(y)})" opacity=".9"/>')
    else:
        s = rnd.uniform(7, 14)
        col = rnd.choice(["#c2366f", "#d4477e", "#e0609a", "#b62d63", "#e57aa8", "#cf3f78"])
        p(f'<g transform="translate({f(x)},{f(y)}) rotate({rnd.uniform(0, 120):.0f})" opacity=".95">'
          f'<path d="M0,0 L{f(s)},{f(-s * .5)} L{f(s * .5)},{f(s)} Z" fill="{col}"/>'
          f'<path d="M0,0 L{f(-s)},{f(-s * .4)} L{f(-s * .3)},{f(s)} Z" fill="{col}" opacity=".85"/>'
          f'<path d="M0,0 L{f(s * .2)},{f(-s)} L{f(-s * .6)},{f(-s * .7)} Z" fill="{col}" opacity=".8"/>'
          '<circle r="1.8" fill="#f6efe2"/></g>')

# Olive branch (top right)
p('<path d="M2440,60 C2260,90 2120,170 1980,300" stroke="#7a6a55" stroke-width="5" fill="none" opacity=".75"/>')
p('<path d="M2300,110 C2250,190 2230,240 2210,320" stroke="#7a6a55" stroke-width="3" fill="none" opacity=".6"/>')
for i in range(46):
    t = rnd.random()
    bx = 2440 - t * 460
    by = 60 + t * 240 + rnd.uniform(-20, 20)
    ang = rnd.uniform(-70, 70) + (30 if i % 2 else -150)
    p(f'<ellipse cx="{f(bx)}" cy="{f(by)}" rx="34" ry="7" fill="{rnd.choice(["#8e9a7c", "#a3ad8f", "#7f8c6c", "#b2baa0"])}" transform="rotate({ang:.0f} {f(bx)} {f(by)})" opacity=".92"/>')
for (ox, oy) in [(2190, 228), (2108, 262), (2262, 182)]:
    p(f'<ellipse cx="{ox}" cy="{oy}" rx="11" ry="15" fill="#4c4a35" opacity=".85"/>')

# Light, vignette and grain
p(f'<rect width="{W}" height="{H}" fill="#ffd9b0" opacity=".08"/>')
p(f'<rect width="{W}" height="{H}" fill="url(#vign)"/>')
p(f'<rect width="{W}" height="{H}" fill="#000" filter="url(#grain)"/>')
p('</svg>')
print("\n".join(out))
