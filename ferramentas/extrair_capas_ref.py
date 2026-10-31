# -*- coding: utf-8 -*-
"""Extrai as capas da imagem de referÃªncia do usuÃ¡rio e gera a capa 70/80/90."""
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, "assets", "img", "capas")
REF = os.path.join(RAIZ, "_tmp", "ref.png")

COLS = [40, 407, 774, 1140, 1507]
ROWS = [38, 438]
NOMES = [
    ["indie-vibes", "eletronica-sem-limites", "mpb-essencial", "funk-2025", "romanticas"],
    ["rock-classico", "rap-nacional", "lofi-beats", "rock-alternativo", "sertanejo-universitario"],
]


def extrair():
    img = Image.open(REF).convert("RGB")
    print("referÃªncia", img.size)
    for r, y in enumerate(ROWS):
        for c, x in enumerate(COLS):
            # arte acima do tÃ­tulo; inclui o botÃ£o de play que serÃ¡ coberto pelo app
            caixa = (x + 2, y + 2, x + 328, y + 282)
            arte = img.crop(caixa).resize((660, 568), Image.LANCZOS)
            destino = os.path.join(SAIDA, NOMES[r][c] + ".jpg")
            arte.save(destino, "JPEG", quality=91, optimize=True, progressive=True)
            print("  ", NOMES[r][c], arte.size)
    # folha de contato
    folha = Image.new("RGB", (5 * 220, 2 * 190), (5, 8, 16))
    for r in range(2):
        for c in range(5):
            arte = Image.open(os.path.join(SAIDA, NOMES[r][c] + ".jpg")).resize((212, 182), Image.LANCZOS)
            folha.paste(arte, (c * 220 + 4, r * 190 + 4))
    folha.save(os.path.join(RAIZ, "_tmp", "contato.jpg"), quality=88)


def gerar_classicos():
    """Capa retrÃ´ 70/80/90 com vinil e tipografia."""
    t = 800
    img = Image.new("RGB", (t, t), "#120724")
    # gradiente vertical
    topo, base = (26, 8, 52), (255, 94, 58)
    pix = img.load()
    for y in range(t):
        f = y / (t - 1)
        cor = tuple(int(topo[i] * (1 - f) + base[i] * f) for i in range(3))
        for x in range(t):
            pix[x, y] = cor
    # brilhos
    brilho = Image.new("RGBA", (t, t), (0, 0, 0, 0))
    d = ImageDraw.Draw(brilho)
    for cx, cy, r, cor in ((150, 160, 280, (120, 40, 255)), (650, 620, 300, (255, 170, 70))):
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=cor + (70,))
    brilho = brilho.filter(ImageFilter.GaussianBlur(90))
    img = Image.alpha_composite(img.convert("RGBA"), brilho).convert("RGB")

    # vinil
    camada = Image.new("RGBA", (t, t), (0, 0, 0, 0))
    d = ImageDraw.Draw(camada)
    cx, cy, r = 400, 400, 250
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(6, 6, 12, 235))
    for i in range(26):
        rr = r * (0.98 - i * 0.032)
        d.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), outline=(70, 80, 110, 150), width=2)
    d.ellipse((cx - 92, cy - 92, cx + 92, cy + 92), fill=(255, 46, 99, 255))
    d.ellipse((cx - 7, cy - 7, cx + 7, cy + 7), fill=(7, 7, 12, 255))
    img = Image.alpha_composite(img.convert("RGBA"), camada).convert("RGB")

    # texto
    texto = Image.new("RGBA", (t, t), (0, 0, 0, 0))
    d = ImageDraw.Draw(texto)
    fonte = ImageFont.truetype(r"C:\Windows\Fonts\segoeuib.ttf", 150)
    pequena = ImageFont.truetype(r"C:\Windows\Fonts\segoeuib.ttf", 30)
    texto_txt = "70 80 90"
    caixa = d.textbbox((0, 0), texto_txt, font=fonte)
    largura = caixa[2] - caixa[0]
    x = (t - largura) / 2
    y = 300
    # sombra/brilho
    for dx in range(-4, 5, 4):
        for dy in range(-4, 5, 4):
            d.text((x + dx, y + dy), texto_txt, font=fonte, fill=(255, 40, 110, 110))
    d.text((x, y), texto_txt, font=fonte, fill=(255, 244, 225, 255))
    sub = "C L Ã S S I C O S"
    cb = d.textbbox((0, 0), sub, font=pequena)
    d.text(((t - (cb[2] - cb[0])) / 2, 520), sub, font=pequena, fill=(255, 220, 190, 255))
    texto = texto.filter(ImageFilter.GaussianBlur(0.4))
    img = Image.alpha_composite(img.convert("RGBA"), texto).convert("RGB")

    # vinheta + grÃ£o leve
    vin = Image.new("L", (t, t), 0)
    dv = ImageDraw.Draw(vin)
    dv.ellipse((-180, -180, t + 180, t + 180), fill=255)
    vin = vin.filter(ImageFilter.GaussianBlur(150))
    escuro = Image.new("RGB", (t, t), (4, 4, 10))
    img = Image.composite(img, escuro, vin)
    img.save(os.path.join(SAIDA, "classicos-70-80-90.jpg"), "JPEG", quality=91, optimize=True, progressive=True)
    print("classicos-70-80-90.jpg", img.size)


if __name__ == "__main__":
    extrair()
    gerar_classicos()

