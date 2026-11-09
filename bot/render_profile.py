#!/usr/bin/env python3
"""Renders a profile card onto assets/profile-template.webp with Pillow.
Reads JSON from stdin, writes PNG to stdout."""
import sys, json, base64, io, os, re
from PIL import Image, ImageDraw, ImageFont, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
A = os.path.join(HERE, "assets")
WHITE, SOFT = (240, 238, 244), (190, 184, 200)
SS = 4  # supersampling for smooth shapes

def font(size, bold=True):
    return ImageFont.truetype(os.path.join(A, "Inter-SemiBold.otf" if bold else "Inter-Medium.otf"), size)

def clean(s, limit):
    # Inter has no emoji/CJK glyphs: keep Latin, Cyrillic, digits and common punctuation
    s = re.sub(r"[^0-9A-Za-zÀ-ɏЀ-ӿ _.\-!?&+()\[\]'’]", "", str(s)).strip()
    return (s or "user")[:limit]

def fit(draw, text, max_w, start, bold=True, min_size=18):
    size = start
    while size > min_size:
        f = font(size, bold)
        if draw.textlength(text, font=f) <= max_w:
            return f
        size -= 2
    return font(min_size, bold)

def rounded_mask(size, radius):
    w, h = size
    m = Image.new("L", (w * SS, h * SS), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, w * SS - 1, h * SS - 1), radius * SS, fill=255)
    return m.resize((w, h), Image.LANCZOS)

def circle_mask(d):
    m = Image.new("L", (d * SS, d * SS), 0)
    ImageDraw.Draw(m).ellipse((0, 0, d * SS - 1, d * SS - 1), fill=255)
    return m.resize((d, d), Image.LANCZOS)

def fmt_int(n): return f"{int(n):,}".replace(",", " ")
def fmt_voice(sec):
    h, m = divmod(int(sec) // 60, 60)
    return f"{h} ч {m} м" if h else f"{m} м"
def plural(n, one, few, many):
    n = abs(int(n)); 
    if 11 <= n % 100 <= 14: return many
    return one if n % 10 == 1 else few if 2 <= n % 10 <= 4 else many

def main():
    d = json.load(sys.stdin)
    img = Image.open(os.path.join(A, "profile-template.webp")).convert("RGBA")
    dr = ImageDraw.Draw(img)

    # avatar: inner dark circle, centre (320, 290), diameter 256
    av = Image.open(io.BytesIO(base64.b64decode(d["avatar"]))).convert("RGBA")
    av = ImageOps.fit(av, (256, 256), Image.LANCZOS)
    img.paste(av, (192, 162), circle_mask(256))

    # name plate: x 152..488, y 590..672
    name = clean(d["name"], 24)
    f = fit(dr, name, 300, 38)
    dr.text((320, 631), name, font=f, fill=WHITE, anchor="mm")

    # banner: x 641..1418, y 110..518
    bp = d.get("banner")
    if bp and os.path.exists(bp):
        try:
            b = Image.open(bp).convert("RGBA")
            b = ImageOps.fit(b, (777, 408), Image.LANCZOS)
            img.paste(b, (641, 110), rounded_mask((777, 408), 30))
        except Exception:
            pass

    # coins / crystals: right aligned at x=530
    dr.text((530, 833), fmt_int(d["coins"]), font=fit(dr, fmt_int(d["coins"]), 330, 48), fill=WHITE, anchor="rm")
    dr.text((530, 983), fmt_int(d["crystals"]), font=fit(dr, fmt_int(d["crystals"]), 330, 48), fill=WHITE, anchor="rm")

    # pair / clan: left aligned at x=1522 (icon occupies x>1705)
    pair = d.get("pair")
    if pair:
        pn = clean(pair["name"], 18)
        dr.text((1522, 168), pn, font=fit(dr, pn, 175, 30), fill=WHITE, anchor="lm")
        days = int(pair["days"])
        dr.text((1522, 212), f"{days} {plural(days, 'день', 'дня', 'дней')}", font=font(22, False), fill=SOFT, anchor="lm")
    else:
        dr.text((1522, 180), "Нет пары", font=font(26, False), fill=SOFT, anchor="lm")
    clan = d.get("clan")
    if clan:
        cn = clean(clan["name"], 20)
        dr.text((1522, 401), cn, font=fit(dr, cn, 175, 30), fill=WHITE, anchor="lm")
        mc = int(clan["members"])
        dr.text((1522, 445), f"{mc} {plural(mc, 'участник', 'участника', 'участников')}", font=font(22, False), fill=SOFT, anchor="lm")
    else:
        dr.text((1522, 413), "Без клана", font=font(26, False), fill=SOFT, anchor="lm")

    # voice / messages: big value above the label, right aligned
    v = fmt_voice(d["voice"])
    dr.text((1192, 830), v, font=fit(dr, v, 340, 76), fill=WHITE, anchor="rs")
    m = fmt_int(d["messages"])
    dr.text((1800, 830), m, font=fit(dr, m, 480, 76), fill=WHITE, anchor="rs")

    out = io.BytesIO()
    img.convert("RGB").save(out, "PNG", optimize=True)
    sys.stdout.buffer.write(out.getvalue())

main()
