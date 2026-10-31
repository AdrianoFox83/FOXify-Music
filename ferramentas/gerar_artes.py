# -*- coding: utf-8 -*-
"""Gera as capas, o avatar e o pacote visual do FOXify (arte 100% procedural)."""
import math
import os
import random

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, "assets", "img", "capas")
ICONES = os.path.join(RAIZ, "assets", "img", "icones")
os.makedirs(SAIDA, exist_ok=True)
os.makedirs(ICONES, exist_ok=True)

S = 2  # supersampling


def hx(c):
    c = c.lstrip("#")
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def gradiente(w, h, c1, c2, angle=90):
    c1, c2 = np.array(hx(c1), float), np.array(hx(c2), float)
    yy, xx = np.mgrid[0:h, 0:w]
    if angle == 90:
        t = yy / max(1, h - 1)
    elif angle == 0:
        t = xx / max(1, w - 1)
    else:
        a = math.radians(angle)
        t = (xx * math.cos(a) + yy * math.sin(a))
        t = (t - t.min()) / max(1e-6, t.max() - t.min())
    t = t[..., None] ** 1.05
    arr = c1 * (1 - t) + c2 * t
    return Image.fromarray(arr.astype(np.uint8), "RGB")


def brilho(img, cx, cy, raio, cor, alpha=0.55):
    w, h = img.size
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.sqrt((xx - cx * w) ** 2 + (yy - cy * h) ** 2) / (raio * max(w, h))
    m = np.clip(1 - d, 0, 1) ** 2.1 * alpha
    cor = np.array(hx(cor), float)
    arr = np.array(img, float)
    arr = arr * (1 - m[..., None]) + cor * m[..., None]
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")


def granulacao(img, forca=7.5, seed=1):
    rng = np.random.default_rng(seed)
    arr = np.array(img, float)
    ruido = rng.normal(0, forca, arr.shape[:2])[..., None]
    arr = arr + ruido
    # leve aberraÃƒÂ§ÃƒÂ£o cromÃƒÂ¡tica
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")


def vinheta(img, forca=0.55, suave=1.6):
    w, h = img.size
    yy, xx = np.mgrid[0:h, 0:w]
    dx = (xx - w / 2) / (w / 2)
    dy = (yy - h / 2) / (h / 2)
    d = np.sqrt(dx ** 2 + dy ** 2) / 1.414
    m = np.clip((d - 0.35) / 0.65, 0, 1) ** suave * forca
    arr = np.array(img, float) * (1 - m[..., None])
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")


def mascara(w, h, fn):
    m = Image.new("L", (w * S, h * S), 0)
    d = ImageDraw.Draw(m)
    fn(d, w * S, h * S)
    return m.resize((w, h), Image.LANCZOS)


def compor_silhueta(img, mask, cor="#060d1c", rim="#3f8dff", rim_forca=0.9, desfoque=16):
    w, h = img.size
    mask = mask.filter(ImageFilter.GaussianBlur(1.2))
    borda = ImageChops.subtract(mask, mask.filter(ImageFilter.MinFilter(11)))
    borda = borda.filter(ImageFilter.GaussianBlur(desfoque))
    if rim_forca > 0:
        camada = Image.new("RGBA", img.size, hx(rim) + (255,))
        camada.putalpha(borda.point(lambda v: int(v * rim_forca)))
        img = Image.alpha_composite(img.convert("RGBA"), camada).convert("RGB")
    preto = Image.new("RGBA", img.size, hx(cor) + (247,))
    preto.putalpha(mask)
    return Image.alpha_composite(img.convert("RGBA"), preto).convert("RGB")


def faixas_luz(img, cor="#9dc4ff", qtd=4, seed=3):
    rng = random.Random(seed)
    w, h = img.size
    camada = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(camada)
    for _ in range(qtd):
        x = rng.uniform(-0.1, 1.1) * w
        larg = rng.uniform(0.01, 0.09) * w
        incl = rng.uniform(0.25, 0.7)
        pts = [(x, -20), (x + larg, -20), (x + larg + incl * h, h + 20), (x + incl * h, h + 20)]
        a = rng.randint(10, 26)
        d.polygon(pts, fill=hx(cor) + (a,))
    camada = camada.filter(ImageFilter.GaussianBlur(w * 0.03))
    return Image.alpha_composite(img.convert("RGBA"), camada).convert("RGB")


def particulas(img, cor="#9dc4ff", qtd=60, seed=7):
    rng = random.Random(seed)
    w, h = img.size
    camada = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(camada)
    for _ in range(qtd):
        x, y = rng.uniform(0, w), rng.uniform(0, h * 0.9)
        r = rng.uniform(0.6, 2.4)
        a = rng.randint(30, 150)
        d.ellipse((x - r, y - r, x + r, y + r), fill=hx(cor) + (a,))
    camada = camada.filter(ImageFilter.GaussianBlur(0.6))
    return Image.alpha_composite(img.convert("RGBA"), camada).convert("RGB")


# --------------------------------------------------------------------------- motivos

def frente_retrato(img, accent, cap=False, longo=False, fones=False, seed=2):
    w, h = img.size

    def desenho(d, W, H):
        # ombros
        d.ellipse((W * 0.00, H * 0.70, W * 1.00, H * 1.42), fill=255)
        # pescoÃƒÂ§o
        d.rounded_rectangle((W * 0.455, H * 0.56, W * 0.545, H * 0.78), radius=W * 0.03, fill=255)
        # cabeÃƒÂ§a
        d.ellipse((W * 0.355, H * 0.13, W * 0.645, H * 0.65), fill=255)
        # queixo
        d.ellipse((W * 0.395, H * 0.45, W * 0.605, H * 0.64), fill=255)
        if longo:
            d.ellipse((W * 0.27, H * 0.16, W * 0.43, H * 0.78), fill=255)
            d.ellipse((W * 0.57, H * 0.16, W * 0.73, H * 0.78), fill=255)
            d.ellipse((W * 0.24, H * 0.08, W * 0.76, H * 0.40), fill=255)
        if cap:
            d.rounded_rectangle((W * 0.315, H * 0.075, W * 0.685, H * 0.27), radius=W * 0.07, fill=255)
            d.ellipse((W * 0.29, H * 0.215, W * 0.90, H * 0.305), fill=255)  # aba
        if fones:
            d.arc((W * 0.28, H * 0.07, W * 0.72, H * 0.54), 180, 360, fill=255, width=int(W * 0.032))
            d.rounded_rectangle((W * 0.245, H * 0.31, W * 0.325, H * 0.49), radius=W * 0.018, fill=255)
            d.rounded_rectangle((W * 0.675, H * 0.31, W * 0.755, H * 0.49), radius=W * 0.018, fill=255)

    m = mascara(w, h, desenho)
    img = compor_silhueta(img, m, rim=accent, rim_forca=1.0, desfoque=18)
    # luz lateral colorida sobre a silhueta
    grad = Image.linear_gradient("L").rotate(90, expand=True).resize((w, h))
    if seed % 2 == 0:
        grad = ImageChops.invert(grad)
    luz = Image.new("RGBA", img.size, hx(accent) + (255,))
    luz.putalpha(ImageChops.multiply(grad, m).point(lambda v: int(v * 0.17)))
    img = Image.alpha_composite(img.convert("RGBA"), luz).convert("RGB")
    img = faixas_luz(img, accent, qtd=3, seed=seed)
    img = particulas(img, accent, qtd=45, seed=seed)
    return img


def frente_multidao(img, accent, seed=11):
    w, h = img.size
    rng = random.Random(seed)
    # holofotes
    camada = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(camada)
    for x, cor in ((0.28, accent), (0.62, "#7fb6ff"), (0.85, "#ffb46b")):
        pts = [(w * x, -h * 0.1), (w * x + w * 0.05, -h * 0.1), (w * x + w * 0.26, h * 0.85), (w * x - w * 0.12, h * 0.85)]
        d.polygon(pts, fill=hx(cor) + (34,))
    img = Image.alpha_composite(img.convert("RGBA"), camada.filter(ImageFilter.GaussianBlur(w * 0.05))).convert("RGB")
    # bokeh
    camada = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(camada)
    for _ in range(70):
        x, y = rng.uniform(0, w), rng.uniform(0, h * 0.75)
        r = rng.uniform(w * 0.004, w * 0.022)
        cor = rng.choice([accent, "#cfe4ff", "#ffd9a8", "#8fc0ff"])
        d.ellipse((x - r, y - r, x + r, y + r), fill=hx(cor) + (rng.randint(40, 130),))
    img = Image.alpha_composite(img.convert("RGBA"), camada.filter(ImageFilter.GaussianBlur(w * 0.006))).convert("RGB")
    # plateia
    m = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(m)
    for i in range(26):
        x = (i / 25) * w * 1.1 - w * 0.05
        base = h * rng.uniform(0.80, 1.02)
        r = w * rng.uniform(0.028, 0.05)
        d.ellipse((x - r, base - r * 2.4, x + r, base - r * 0.4), fill=255)
        d.ellipse((x - r * 2.2, base - r * 0.6, x + r * 2.2, h * 1.1), fill=255)
        if rng.random() < 0.45:
            bx = x + rng.choice([-1, 1]) * r * 1.6
            d.line((x, base - r * 2.2, bx, base - r * 6.5), fill=255, width=int(w * 0.014))
    m = m.filter(ImageFilter.GaussianBlur(1))
    preto = Image.new("RGBA", img.size, (2, 4, 10, 255))
    preto.putalpha(m)
    return Image.alpha_composite(img.convert("RGBA"), preto).convert("RGB")


def frente_palmeiras(img, accent, seed=5):
    w, h = img.size
    # sol
    img = brilho(img, 0.66, 0.52, 0.34, "#ffb26b", 0.55)
    camada = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(camada)
    r = w * 0.10
    d.ellipse((w * 0.66 - r, h * 0.52 - r, w * 0.66 + r, h * 0.52 + r), fill=hx("#ffe2a8") + (235,))
    # mar
    d.rectangle((0, h * 0.62, w, h), fill=hx("#1a0f2e") + (170,))
    for i in range(16):
        y = h * (0.64 + i * 0.022)
        a = 90 - i * 4
        d.line((w * 0.55 - i * w * 0.02, y, w * 0.66 + i * w * 0.02, y), fill=hx("#ffd9a8") + (max(20, a),), width=2)
    camada = camada.filter(ImageFilter.GaussianBlur(1.2))
    img = Image.alpha_composite(img.convert("RGBA"), camada).convert("RGB")

    def palmeira(d, x0, base_y, altura, lado):
        # tronco curvo
        for i in range(26):
            t = i / 25
            y = base_y - t * altura
            x = x0 + math.sin(t * 2.2) * lado * altura * 0.12
            rr = altura * 0.018 * (1 - t * 0.55)
            d.ellipse((x - rr, y - rr, x + rr, y + rr), fill=255)
        topo_x = x0 + math.sin(2.2) * lado * altura * 0.12
        topo_y = base_y - altura
        for ang in (-160, -120, -80, -40, -15, 165, 140, 200, 225):
            a = math.radians(ang + (0 if lado > 0 else 180))
            comp = altura * 0.46
            pts = []
            for t in np.linspace(0, 1, 14):
                px = topo_x + math.cos(a) * comp * t
                py = topo_y + math.sin(a) * comp * t + (t ** 2) * altura * 0.20
                pts.append((px, py))
            for t, (px, py) in zip(np.linspace(0, 1, 14), pts):
                rr = altura * 0.022 * (1 - t) + 1
                d.ellipse((px - rr, py - rr, px + rr, py + rr), fill=255)

    m = Image.new("L", (w * S, h * S), 0)
    d = ImageDraw.Draw(m)
    palmeira(d, w * S * 0.14, h * S * 1.02, h * S * 0.72, 1)
    palmeira(d, w * S * 0.88, h * S * 1.05, h * S * 0.82, -1)
    m = m.resize((w, h), Image.LANCZOS)
    preto = Image.new("RGBA", img.size, (4, 3, 12, 255))
    preto.putalpha(m)
    return Image.alpha_composite(img.convert("RGBA"), preto).convert("RGB")


def frente_montanhas(img, accent, seed=8):
    w, h = img.size
    img = brilho(img, 0.5, 0.52, 0.30, "#ffd08a", 0.6)
    camada = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(camada)
    r = w * 0.075
    d.ellipse((w * 0.5 - r, h * 0.5 - r, w * 0.5 + r, h * 0.5 + r), fill=hx("#fff1cf") + (240,))
    img = Image.alpha_composite(img.convert("RGBA"), camada).convert("RGB")

    rng = random.Random(seed)
    for camada_i, (base, cor, alpha) in enumerate(
        [(0.60, "#241a3d", 255), (0.68, "#171128", 255), (0.78, "#0b0a18", 255)]
    ):
        pts = [(0, h)]
        x = 0
        y = h * base
        while x < w:
            passo = rng.uniform(w * 0.06, w * 0.16)
            x += passo
            pico = h * rng.uniform(0.02, 0.16) * (1 + camada_i * 0.15)
            pts.append((x, y - pico * rng.uniform(0.35, 1)))
        pts.append((w, h))
        m = Image.new("L", (w * S, h * S), 0)
        ImageDraw.Draw(m).polygon([(p[0] * S, p[1] * S) for p in pts], fill=255)
        m = m.resize((w, h), Image.LANCZOS)
        preto = Image.new("RGBA", img.size, hx(cor) + (alpha,))
        preto.putalpha(m)
        img = Image.alpha_composite(img.convert("RGBA"), preto).convert("RGB")
        img = brilho(img, 0.5, base - 0.01, 0.35, "#ffcf9a", 0.06)
    # nÃƒÂ©voa
    camada = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(camada)
    for i in range(3):
        d.rectangle((0, h * (0.63 + i * 0.05), w, h * (0.67 + i * 0.05)), fill=(210, 225, 255, 22))
    img = Image.alpha_composite(img.convert("RGBA"), camada.filter(ImageFilter.GaussianBlur(w * 0.02))).convert("RGB")
    return particulas(img, "#ffd9b0", 35, seed)


def frente_geometrico(img, accent, accent2="#ff2e63", seed=4):
    w, h = img.size
    rng = random.Random(seed)
    camada = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(camada)
    cx, cy = w * 0.5, h * 0.46
    for i in range(7):
        r = w * (0.10 + i * 0.065)
        cor = accent if i % 2 == 0 else accent2
        larg = max(2, int(w * 0.006))
        d.ellipse((cx - r, cy - r * 0.75, cx + r, cy + r * 0.75), outline=hx(cor) + (150 - i * 14,), width=larg)
    # grade em perspectiva
    for i in range(-8, 9):
        d.line((w * 0.5 + i * w * 0.06, h * 0.62, w * 0.5 + i * w * 0.28, h * 1.05), fill=hx(accent) + (60,), width=1)
    for i in range(7):
        y = h * (0.64 + (i / 6) ** 2 * 0.45)
        d.line((0, y, w, y), fill=hx(accent) + (45,), width=1)
    # triÃƒÂ¢ngulos
    for _ in range(5):
        x, y = rng.uniform(0.15, 0.85) * w, rng.uniform(0.2, 0.8) * h
        s = rng.uniform(0.02, 0.07) * w
        d.polygon([(x, y - s), (x + s, y + s * 0.8), (x - s, y + s * 0.8)], outline=hx("#ffffff") + (90,), width=2)
    img = Image.alpha_composite(img.convert("RGBA"), camada.filter(ImageFilter.GaussianBlur(1.5))).convert("RGB")
    # linha de brilho
    img = brilho(img, 0.5, 0.42, 0.22, accent, 0.35)
    return particulas(img, accent, 55, seed)


def frente_violao(img, accent, seed=6):
    w, h = img.size
    img = brilho(img, 0.62, 0.35, 0.4, "#ffcf8f", 0.6)
    # sol / flare
    camada = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(camada)
    cx, cy = w * 0.66, h * 0.30
    for r, a in ((w * 0.16, 40), (w * 0.09, 70), (w * 0.04, 160)):
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=hx("#ffe6b8") + (a,))
    img = Image.alpha_composite(img.convert("RGBA"), camada.filter(ImageFilter.GaussianBlur(w * 0.02))).convert("RGB")

    # violÃƒÂ£o em camada prÃƒÂ³pria
    tam = int(w * 1.5)
    layer = Image.new("L", (tam, tam), 0)
    d = ImageDraw.Draw(layer)
    cxv, cyv = tam * 0.50, tam * 0.52
    d.ellipse((cxv - tam * 0.20, cyv - tam * 0.07, cxv + tam * 0.20, cyv + tam * 0.26), fill=255)
    d.ellipse((cxv - tam * 0.155, cyv - tam * 0.24, cxv + tam * 0.155, cyv + tam * 0.10), fill=255)
    d.rounded_rectangle((cxv - tam * 0.028, cyv - tam * 0.52, cxv + tam * 0.028, cyv - tam * 0.10), radius=tam * 0.01, fill=255)
    d.rounded_rectangle((cxv - tam * 0.045, cyv - tam * 0.60, cxv + tam * 0.045, cyv - tam * 0.50), radius=tam * 0.012, fill=255)
    # braÃƒÂ§o
    d.polygon([(cxv - tam * 0.05, cyv - tam * 0.55), (cxv + tam * 0.05, cyv - tam * 0.55),
               (cxv + tam * 0.36, tam * 0.02), (cxv + tam * 0.27, tam * 0.06)], fill=255)
    layer = layer.resize((w, h), Image.LANCZOS)
    # buraco e cordas em cor de destaque
    img = compor_silhueta(img, layer, cor="#0a0710", rim="#ffb066", rim_forca=0.55, desfoque=10)
    camada = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(camada)
    d.ellipse((w * 0.46, h * 0.52, w * 0.56, h * 0.62), fill=hx("#160b06") + (255,))
    for i in range(5):
        off = i * w * 0.004
        d.line((w * 0.50 + off, h * 0.58, w * 0.68 + off, h * 0.06), fill=hx("#ffd9a3") + (110,), width=1)
    img = Image.alpha_composite(img.convert("RGBA"), camada).convert("RGB")
    return particulas(img, "#ffd9a3", 40, seed)


def frente_coracao(img, accent, seed=9):
    w, h = img.size
    img = brilho(img, 0.5, 0.45, 0.4, accent, 0.55)
    pts = []
    for t in np.linspace(0, 2 * math.pi, 240):
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((w * 0.5 + x * w * 0.017, h * 0.46 - y * h * 0.017))
    m = Image.new("L", (w, h), 0)
    ImageDraw.Draw(m).polygon(pts, fill=255)
    m = m.filter(ImageFilter.GaussianBlur(1))
    # halo
    halo = m.filter(ImageFilter.GaussianBlur(w * 0.05)).point(lambda v: int(v * 0.75))
    camada = Image.new("RGBA", img.size, hx(accent) + (255,))
    camada.putalpha(halo)
    img = Image.alpha_composite(img.convert("RGBA"), camada).convert("RGB")
    img = compor_silhueta(img, m, cor="#1a0410", rim="#ff9db4", rim_forca=1.0, desfoque=14)
    return particulas(img, "#ffb3c4", 70, seed)


def frente_globo(img, accent, seed=10):
    w, h = img.size
    img = brilho(img, 0.5, 0.5, 0.45, accent, 0.45)
    camada = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(camada)
    cx, cy, r = w * 0.5, h * 0.48, w * 0.28
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=hx("#0a1730") + (170,), outline=hx(accent) + (200,), width=3)
    for i in range(1, 5):
        rr = r * (0.95 - i * 0.17)
        d.arc((cx - r, cy - rr, cx + r, cy + rr), 0, 360, fill=hx(accent) + (90,), width=2)
    for i in range(1, 4):
        off = r * i / 4
        d.arc((cx - off, cy - r, cx + off, cy + r), 0, 360, fill=hx(accent) + (70,), width=2)
    # barras de ÃƒÂ¡udio
    rng = random.Random(seed)
    for i in range(15):
        x = cx - r * 0.75 + i * (r * 1.5 / 14)
        alt = r * rng.uniform(0.15, 0.9)
        d.rounded_rectangle((x - 2, cy - alt / 2, x + 2, cy + alt / 2), radius=2,
                            fill=hx("#9cd0ff") + (215,))
    img = Image.alpha_composite(img.convert("RGBA"), camada.filter(ImageFilter.GaussianBlur(1.2))).convert("RGB")
    return particulas(img, "#a8d4ff", 80, seed)


def frente_vinil(img, accent, seed=12):
    w, h = img.size
    cx, cy, r = w * 0.5, h * 0.5, w * 0.33
    camada = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(camada)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=hx("#07080e") + (255,))
    for i in range(28):
        rr = r * (0.98 - i * 0.03)
        d.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), outline=hx("#2c3852") + (150,), width=1)
    d.ellipse((cx - r * 0.34, cy - r * 0.34, cx + r * 0.34, cy + r * 0.34), fill=hx(accent) + (255,))
    d.ellipse((cx - r * 0.03, cy - r * 0.03, cx + r * 0.03, cy + r * 0.03), fill=hx("#05070d") + (255,))
    img = Image.alpha_composite(img.convert("RGBA"), camada).convert("RGB")
    # reflexo
    refl = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(refl)
    d.polygon([(cx - r, cy - r), (cx - r * 0.1, cy - r), (cx + r * 0.4, cy + r), (cx - r * 0.4, cy + r)],
              fill=(180, 210, 255, 26))
    img = Image.alpha_composite(img.convert("RGBA"), refl.filter(ImageFilter.GaussianBlur(w * 0.03))).convert("RGB")
    return particulas(img, accent, 40, seed)


def frente_ondas(img, accent, seed=13):
    w, h = img.size
    img = brilho(img, 0.5, 0.55, 0.3, accent, 0.35)
    camada = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(camada)
    for k in range(9):
        pts = []
        for x in np.linspace(-10, w + 10, 220):
            t = x / w
            y = h * (0.52 + 0.06 * math.sin(t * 7 + k * 0.8) + 0.035 * math.sin(t * 17 + k) + k * 0.012)
            pts.append((x, y))
        cor = accent if k % 2 == 0 else "#bcd9ff"
        d.line(pts, fill=hx(cor) + (185 - k * 6,), width=max(2, int(w * 0.005)), joint="curve")
    img = Image.alpha_composite(img.convert("RGBA"), camada).convert("RGB")
    # segunda camada desfocada (bloom)
    img = Image.alpha_composite(img.convert("RGBA"), camada.filter(ImageFilter.GaussianBlur(w * 0.02))).convert("RGB")
    return particulas(img, accent, 70, seed)


# --------------------------------------------------------------------------- catÃƒÂ¡logo

ARTES = [
    # estaÃƒÂ§ÃƒÂµes / tocando agora
    dict(arq="top50-brasil.jpg", top="#07142f", bot="#020610", accent="#ff2f63", tipo="retrato-cap",
         glows=[(0.12, 0.35, "#1d64ff", 0.55), (0.9, 0.6, "#ff1f4f", 0.45)]),
    dict(arq="mood-chill.jpg", top="#2b1146", bot="#070513", accent="#c46bff", tipo="palmeiras",
         glows=[(0.66, 0.5, "#ff9a5b", 0.5), (0.2, 0.2, "#6b3bff", 0.35)]),
    dict(arq="rock-antigo.jpg", top="#0b0d13", bot="#020306", accent="#8fb6ff", tipo="multidao",
         glows=[(0.5, 0.1, "#5f86c9", 0.25)]),
    dict(arq="hip-hop-2025.jpg", top="#041a33", bot="#020610", accent="#2f8dff", tipo="retrato-cap-fones",
         glows=[(0.15, 0.4, "#1b5cff", 0.55), (0.95, 0.4, "#00c2ff", 0.35)]),
    # mixes
    dict(arq="indie-vibes.jpg", top="#081a35", bot="#03060f", accent="#4c8dff", tipo="retrato-longo",
         glows=[(0.2, 0.3, "#1d5fff", 0.45), (0.85, 0.7, "#8a3bff", 0.35)]),
    dict(arq="eletronica-sem-limites.jpg", top="#031c2c", bot="#02060f", accent="#25d9ff", tipo="geometrico",
         glows=[(0.5, 0.45, "#0f7dff", 0.35)]),
    dict(arq="mpb-essencial.jpg", top="#3a1a07", bot="#0a0503", accent="#ffb062", tipo="violao",
         glows=[(0.7, 0.3, "#ff9c4a", 0.55)]),
    dict(arq="funk-2025.jpg", top="#2a0524", bot="#06020a", accent="#ff2e88", tipo="retrato-cap",
         glows=[(0.2, 0.4, "#c200ff", 0.45), (0.9, 0.5, "#ff2e63", 0.5)]),
    dict(arq="sons-do-amanhecer.jpg", top="#10233f", bot="#04070f", accent="#ffc07a", tipo="montanhas",
         glows=[(0.5, 0.5, "#ffb46b", 0.45)]),
    # playlists
    dict(arq="favoritas.jpg", top="#2a0510", bot="#0a0206", accent="#ff2e63", tipo="coracao",
         glows=[(0.5, 0.5, "#ff2e63", 0.45)]),
    dict(arq="sua-musica.jpg", top="#061a33", bot="#04060f", accent="#3f8dff", tipo="globo",
         glows=[(0.5, 0.45, "#2f7bff", 0.4)]),
    dict(arq="sertanejo-top.jpg", top="#301305", bot="#0a0503", accent="#ffa257", tipo="violao",
         glows=[(0.35, 0.6, "#ff7a3c", 0.4)]),
    dict(arq="rap-nacional.jpg", top="#0b0b12", bot="#020205", accent="#a9b7ff", tipo="retrato-cap",
         glows=[(0.2, 0.3, "#5b6cff", 0.35), (0.8, 0.7, "#ff2e63", 0.2)]),
    dict(arq="lofi-beats.jpg", top="#0a1526", bot="#050810", accent="#7fb2ff", tipo="vinil",
         glows=[(0.5, 0.5, "#2f5cff", 0.3)]),
    dict(arq="rock-classico.jpg", top="#1a0b06", bot="#050305", accent="#ff7a45", tipo="vinil",
         glows=[(0.7, 0.4, "#ff5a2a", 0.35)]),
    # faixas demo
    dict(arq="noite-azul.jpg", top="#08172e", bot="#03050e", accent="#3f8dff", tipo="ondas",
         glows=[(0.25, 0.3, "#1e56ff", 0.45)]),
    dict(arq="chuva-de-neon.jpg", top="#1c0630", bot="#04030c", accent="#ff2e9a", tipo="geometrico",
         glows=[(0.7, 0.35, "#ff2e88", 0.4), (0.2, 0.7, "#2f7bff", 0.3)]),
    dict(arq="vento-solar.jpg", top="#3a2008", bot="#0a0603", accent="#ffc073", tipo="violao",
         glows=[(0.6, 0.35, "#ffab4d", 0.45)]),
    dict(arq="madrugada-lofi.jpg", top="#0a1322", bot="#04060c", accent="#88b6ff", tipo="vinil",
         glows=[(0.6, 0.4, "#2f5cff", 0.25)]),
    dict(arq="pulso-eletrico.jpg", top="#001c26", bot="#02060d", accent="#25f0d0", tipo="geometrico",
         glows=[(0.5, 0.4, "#0fd9ff", 0.4)]),
    dict(arq="ceu-de-outubro.jpg", top="#1b1533", bot="#050510", accent="#c9a8ff", tipo="montanhas",
         glows=[(0.5, 0.45, "#9d6bff", 0.4)]),
]


def gerar_capa(cfg, tamanho=800, seed=0):
    img = gradiente(tamanho, tamanho, cfg["top"], cfg["bot"], 105)
    for cx, cy, cor, a in cfg.get("glows", []):
        img = brilho(img, cx, cy, 0.55, cor, a)
    tipo = cfg["tipo"]
    accent = cfg["accent"]
    if tipo == "retrato":
        img = frente_retrato(img, accent, seed=seed)
    elif tipo == "retrato-cap":
        img = frente_retrato(img, accent, cap=True, seed=seed)
    elif tipo == "retrato-fones":
        img = frente_retrato(img, accent, fones=True, seed=seed)
    elif tipo == "retrato-cap-fones":
        img = frente_retrato(img, accent, cap=True, fones=True, seed=seed)
    elif tipo == "retrato-longo":
        img = frente_retrato(img, accent, longo=True, seed=seed)
    elif tipo == "multidao":
        img = frente_multidao(img, accent, seed=seed)
    elif tipo == "palmeiras":
        img = frente_palmeiras(img, accent, seed=seed)
    elif tipo == "montanhas":
        img = frente_montanhas(img, accent, seed=seed)
    elif tipo == "geometrico":
        img = frente_geometrico(img, accent, seed=seed)
    elif tipo == "violao":
        img = frente_violao(img, accent, seed=seed)
    elif tipo == "coracao":
        img = frente_coracao(img, accent, seed=seed)
    elif tipo == "globo":
        img = frente_globo(img, accent, seed=seed)
    elif tipo == "vinil":
        img = frente_vinil(img, accent, seed=seed)
    elif tipo == "ondas":
        img = frente_ondas(img, accent, seed=seed)
    img = vinheta(img, 0.45)
    img = granulacao(img, 6.0, seed + 3)
    img = ImageEnhance.Brightness(img).enhance(1.17)
    img = ImageEnhance.Color(img).enhance(1.08)
    return img


PROTEGIDAS = {
    "indie-vibes.jpg", "eletronica-sem-limites.jpg", "mpb-essencial.jpg", "funk-2025.jpg",
    "romanticas.jpg", "rock-classico.jpg", "rap-nacional.jpg", "lofi-beats.jpg",
    "rock-alternativo.jpg", "sertanejo-universitario.jpg", "sons-do-amanhecer.jpg",
    "sertanejo-top.jpg",
}


def gerar_tudo():
    for i, cfg in enumerate(ARTES):
        if cfg["arq"] in PROTEGIDAS:
            continue  # capas extraídas da referência do usuário
        img = gerar_capa(cfg, 800, seed=i * 7 + 1)
        img.save(os.path.join(SAIDA, cfg["arq"]), "JPEG", quality=86, optimize=True, progressive=True)
    # avatar
    av = gerar_capa(dict(top="#0a1a33", bot="#05070f", accent="#4f9dff", tipo="retrato-cap",
                         glows=[(0.2, 0.3, "#1d5fff", 0.5)]), 480, seed=99)
    av.save(os.path.join(RAIZ, "assets", "img", "avatar.jpg"), "JPEG", quality=88)
    # contato
    cols, cell = 6, 210
    linhas = math.ceil(len(ARTES) / cols)
    folha = Image.new("RGB", (cols * cell, linhas * cell), (5, 8, 16))
    for i, cfg in enumerate(ARTES):
        im = Image.open(os.path.join(SAIDA, cfg["arq"])).resize((cell - 8, cell - 8), Image.LANCZOS)
        folha.paste(im, ((i % cols) * cell + 4, (i // cols) * cell + 4))
    folha.save(os.path.join(RAIZ, "_teste", "contato-artes.jpg"), quality=85)
    print(f"{len(ARTES)} capas + avatar geradas.")


if __name__ == "__main__":
    gerar_tudo()




