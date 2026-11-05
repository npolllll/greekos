import json, sys, re, glob
from PIL import Image
d = sys.argv[1]
def lum(c):
    def ch(v):
        v /= 255
        return v/12.92 if v <= 0.03928 else ((v+0.055)/1.055)**2.4
    return 0.2126*ch(c[0]) + 0.7152*ch(c[1]) + 0.0722*ch(c[2])
def ratio(a, b):
    la, lb = sorted([lum(a), lum(b)], reverse=True)
    return (la+0.05)/(lb+0.05)
bad = []
total = 0
for f in sorted(glob.glob(f'{d}/els_*.json')):
    k = f.split('_')[-1].split('.')[0]
    meta = json.load(open(f))
    im = Image.open(f'{d}/bg_{k}.png').convert('RGB')
    W, H = im.size
    for e in meta['els']:
        if e['disabled']: continue
        m = re.match(r'rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)', e['color'])
        if not m: continue
        r, g, b = (float(m.group(i)) for i in (1, 2, 3)); a = float(m.group(4) or 1) * e['opacity']
        x, y, w, h = e['box']
        x0, y0, x1, y1 = max(0, int(x)), max(0, int(y)), min(W, int(x + w)), min(H, int(y + h))
        if x1 - x0 < 2 or y1 - y0 < 2: continue
        px = list(im.crop((x0, y0, x1, y1)).getdata())  # 10th-percentile contrast over the box (ignores anti-aliased edges)
        # Worst case over the box: the background pixel giving the lowest contrast with the composited text colour.
        total += 1
        worst = None
        step = max(1, len(px) // 400)
        for p in px[::step]:
            tc = (r*a + p[0]*(1-a), g*a + p[1]*(1-a), b*a + p[2]*(1-a))
            cr = ratio(tc, p)
            if worst is None or cr < worst: worst = cr
        # use 10th percentile instead of absolute worst to ignore a few anti-aliased edge pixels
        crs = sorted(ratio((r*a + p[0]*(1-a), g*a + p[1]*(1-a), b*a + p[2]*(1-a)), p) for p in px[::step])
        p10 = crs[len(crs)//10]
        large = e['size'] >= 24 or (e['size'] >= 18.66 and e['weight'] >= 700)
        need = 3.0 if large else 4.5
        if p10 < need: bad.append((meta['page'], meta['y'], round(p10, 2), need, e['text'], e['color'], e['size']))
print('text runs checked:', total, 'below AA:', len(bad))
for b in bad[:60]: print(b)
