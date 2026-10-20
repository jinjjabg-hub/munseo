#!/usr/bin/env python3
"""앱 아이콘/시작 화면을 그린다 (파란 바탕 + 접힌 모서리가 있는 흰 문서). 사용: python3 tools/make-icons.py"""
import os
from PIL import Image, ImageDraw

RES = os.path.join(os.path.dirname(__file__), '..', 'android', 'app', 'src', 'main', 'res')
BLUE = (37, 99, 235, 255)

def glyph(size, pad):
    """투명 바탕에 흰 문서 그림. pad = 가장자리 여백 비율"""
    S = size * 4
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    w = S * (1 - 2 * pad)
    pw, ph = w * 0.62, w * 0.78
    x0 = (S - pw) / 2
    y0 = (S - ph) / 2
    fold = pw * 0.30
    pts = [(x0, y0), (x0 + pw - fold, y0), (x0 + pw, y0 + fold), (x0 + pw, y0 + ph), (x0, y0 + ph)]
    d.polygon(pts, fill=(255, 255, 255, 255))
    d.polygon([(x0 + pw - fold, y0), (x0 + pw, y0 + fold), (x0 + pw - fold, y0 + fold)], fill=(190, 205, 240, 255))
    lh = ph * 0.045
    for i, frac in enumerate((0.42, 0.55, 0.68)):
        y = y0 + ph * frac
        right = x0 + pw * (0.80 if i < 2 else 0.55)
        d.rounded_rectangle([x0 + pw * 0.16, y, right, y + lh], radius=lh / 2, fill=BLUE)
    return im.resize((size, size), Image.LANCZOS)

def save(img, rel):
    p = os.path.join(RES, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    img.save(p)

DENS = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
for name, k in DENS.items():
    # 어댑티브 아이콘 앞면: 108dp, 가운데 66%만 보이므로 여백을 넉넉히
    save(glyph(int(108 * k), 0.22), f'mipmap-{name}/ic_launcher_foreground.png')
    s = int(48 * k)
    base = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    sq = Image.new('RGBA', (s * 4, s * 4), (0, 0, 0, 0))
    dd = ImageDraw.Draw(sq)
    dd.rounded_rectangle([0, 0, s * 4 - 1, s * 4 - 1], radius=s * 4 * 0.22, fill=BLUE)
    sq = sq.resize((s, s), Image.LANCZOS)
    g = glyph(s, 0.14)
    sq.alpha_composite(g)
    save(sq, f'mipmap-{name}/ic_launcher.png')
    rd = Image.new('RGBA', (s * 4, s * 4), (0, 0, 0, 0))
    ImageDraw.Draw(rd).ellipse([0, 0, s * 4 - 1, s * 4 - 1], fill=BLUE)
    rd = rd.resize((s, s), Image.LANCZOS)
    rd.alpha_composite(glyph(s, 0.20))
    save(rd, f'mipmap-{name}/ic_launcher_round.png')

with open(os.path.join(RES, 'values', 'ic_launcher_background.xml'), 'w') as f:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#2563EB</color>\n</resources>\n')

# 시작 화면: 단색 (기본 Capacitor 그림 제거)
import shutil, glob
for d in glob.glob(os.path.join(RES, 'drawable-*')):
    for f in glob.glob(os.path.join(d, 'splash.png')):
        os.remove(f)
    if os.path.isdir(d) and not os.listdir(d): os.rmdir(d)
for f in glob.glob(os.path.join(RES, 'drawable', 'splash.png')): os.remove(f)
with open(os.path.join(RES, 'drawable', 'splash.xml'), 'w') as f:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">\n    <solid android:color="#F4F5F7" />\n</shape>\n')
print('icons done')
