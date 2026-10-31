# -*- coding: utf-8 -*-
"""Sintetiza as faixas demo do FOXify (WAV mono 22.05 kHz) para o app tocar offline."""
import json
import math
import os
import wave

import numpy as np

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, "assets", "audio")
os.makedirs(SAIDA, exist_ok=True)
SR = 22050

NOTAS = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6,
         "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}
TIPOS = {"m": [0, 3, 7], "M": [0, 4, 7], "7": [0, 4, 7, 10], "m7": [0, 3, 7, 10],
         "maj7": [0, 4, 7, 11], "sus": [0, 5, 7], "dim": [0, 3, 6]}


def f(nome, oitava=4):
    midi = 12 * (oitava + 1) + NOTAS[nome]
    return 440.0 * 2 ** ((midi - 69) / 12)


def env(n, ataque, decaimento, potencia=2.0):
    a = max(1, int(ataque * SR))
    e = np.ones(n)
    e[:min(a, n)] = np.linspace(0, 1, min(a, n)) ** 0.6
    d = np.linspace(0, 1, n)
    return e * np.exp(-d * decaimento * potencia)


def pad(freqs, dur, brilho=0.35, detune=0.004):
    n = int(dur * SR)
    t = np.arange(n) / SR
    onda = np.zeros(n)
    for fr in freqs:
        for d in (-detune, 0, detune):
            onda += np.sin(2 * np.pi * fr * (1 + d) * t + np.random.rand() * 6.28)
            onda += 0.25 * brilho * np.sin(2 * np.pi * fr * 2 * (1 + d) * t)
    onda /= max(1, len(freqs) * 3)
    ataque = min(1.1, dur * 0.25)
    e = np.ones(n)
    a = int(ataque * SR)
    e[:a] = np.linspace(0, 1, a) ** 1.4
    r = int(min(dur * 0.4, 1.6) * SR)
    e[-r:] *= np.linspace(1, 0, r) ** 1.2
    return onda * e


def pluck(freq, dur, brilho=0.5, decaimento=4.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    onda = np.zeros(n)
    for k in range(1, 7):
        amp = (brilho ** (k - 1)) / k
        onda += amp * np.sin(2 * np.pi * freq * k * t)
    return onda * np.exp(-t * decaimento) / 1.7


def baixo(freq, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    onda = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(2 * np.pi * freq * 2 * t)
    onda += 0.12 * np.sin(2 * np.pi * freq * 3 * t)
    e = np.exp(-t * 3.2) * 0.9 + 0.1
    return onda * e * (1 - np.exp(-t * 90))


def kick(dur=0.42):
    n = int(dur * SR)
    t = np.arange(n) / SR
    fr = 128 * np.exp(-t * 28) + 44
    onda = np.sin(2 * np.pi * np.cumsum(fr) / SR)
    return onda * np.exp(-t * 9) + np.random.randn(n) * np.exp(-t * 260) * 0.25


def snare(dur=0.28):
    n = int(dur * SR)
    t = np.arange(n) / SR
    ruido = np.random.randn(n)
    ruido = highpass(ruido, 1400)
    tom = np.sin(2 * np.pi * 185 * t) * 0.35
    return (ruido * 0.7 + tom) * np.exp(-t * 17)


def hat(dur=0.09, aberto=False):
    n = int(dur * (3 if aberto else 1) * SR)
    t = np.arange(n) / SR
    ruido = highpass(np.random.randn(n), 6500)
    return ruido * np.exp(-t * (16 if not aberto else 6)) * 0.5


def shaker(dur=0.12):
    n = int(dur * SR)
    t = np.arange(n) / SR
    return highpass(np.random.randn(n), 4200) * np.exp(-t * 22) * 0.28


def sino(freq, dur, brilho=0.6):
    n = int(dur * SR)
    t = np.arange(n) / SR
    onda = np.sin(2 * np.pi * freq * t) + 0.4 * np.sin(2 * np.pi * freq * 2.01 * t)
    onda += 0.2 * np.sin(2 * np.pi * freq * 3.02 * t)
    return onda * np.exp(-t * 2.2) * brilho


def filtro(x, corte, tipo="low", ordem=4):
    n = len(x)
    X = np.fft.rfft(x)
    fr = np.fft.rfftfreq(n, 1 / SR)
    h = 1 / (1 + (fr / max(20, corte)) ** ordem)
    if tipo == "high":
        h = 1 - h
    return np.fft.irfft(X * h, n)


def highpass(x, corte):
    return filtro(x, corte, "high")


def reverb(x, molhado=0.28, cauda=1.7, seed=3):
    rng = np.random.default_rng(seed)
    n_ir = int(cauda * SR)
    t = np.arange(n_ir) / SR
    ir = rng.normal(0, 1, n_ir) * np.exp(-t * 4.2)
    ir = filtro(ir, 5200)
    ir[: int(0.02 * SR)] *= np.linspace(0, 1, int(0.02 * SR))
    ir /= np.max(np.abs(ir)) + 1e-9
    n = len(x) + n_ir - 1
    N = 1 << (n - 1).bit_length()
    X = np.fft.rfft(x, N) * np.fft.rfft(ir, N)
    y = np.fft.irfft(X, N)[: len(x)]
    y /= np.max(np.abs(y)) + 1e-9
    return x * (1 - molhado) + y * molhado * 1.4


def vinil(dur):
    n = int(dur * SR)
    chiado = filtro(np.random.normal(0, 1, n), 700) * 0.028
    estalos = np.zeros(n)
    for _ in range(int(dur * 9)):
        p = np.random.randint(0, n - 400)
        estalos[p:p + 60] += np.random.randn(60) * np.random.uniform(0.1, 0.5)
    return chiado + filtro(estalos, 3000) * 0.12


def chuva(dur):
    n = int(dur * SR)
    r = np.random.normal(0, 1, n)
    return filtro(r, 2600) * 0.05 + filtro(r, 900, "high") * 0.02


def acorde(nome, oitava, tipo):
    raiz = f(nome, oitava)
    return [raiz * 2 ** (i / 12) for i in TIPOS[tipo]]


def sintetizar(cfg):
    bpm = cfg["bpm"]
    compasso = 4 * 60 / bpm
    n_comp = max(4, round(34 / compasso))
    total = int(n_comp * compasso * SR)
    mix = np.zeros(total + int(3 * SR))
    rng = np.random.default_rng(cfg.get("seed", 1))
    progressao = cfg["prog"]
    estilo = cfg["estilo"]

    def pos(comp, batida=0.0):
        return int((comp * compasso + batida * 60 / bpm) * SR)

    # pads por compasso
    for c in range(n_comp):
        nome, tipo, oit = progressao[c % len(progressao)]
        fr = acorde(nome, oit, tipo)
        trecho = pad(fr, compasso * 1.02, brilho=cfg.get("brilho", 0.35))
        p = pos(c)
        fim = min(len(mix), p + len(trecho))
        mix[p:fim] += trecho[:fim - p] * cfg.get("vol_pad", 0.22)

    # baixo
    for c in range(n_comp):
        if c < 1 and cfg.get("intro", True):
            continue
        nome, tipo, oit = progressao[c % len(progressao)]
        raiz = f(nome, oit - 2)
        padrao = cfg.get("baixo_padrao", [(0, 2.0), (2, 1.0)])
        for batida, dur in padrao:
            p = pos(c, batida)
            trecho = baixo(raiz, dur * 60 / bpm)
            fim = min(len(mix), p + len(trecho))
            mix[p:fim] += trecho[:fim - p] * 0.24

    # arpejo
    if cfg.get("arp", True):
        div = cfg.get("arp_div", 0.5)
        for c in range(n_comp):
            nome, tipo, oit = progressao[c % len(progressao)]
            notas = acorde(nome, oit, tipo)
            passos = int(round(compasso / div))
            for s in range(passos):
                batida = s * div
                nota = notas[(s + c) % len(notas)] * (2 if s % 4 in (2, 3) else 1)
                p = pos(c, batida)
                trecho = pluck(nota, div * 2.4 * 60 / bpm, brilho=cfg.get("arp_brilho", 0.45),
                               decaimento=cfg.get("arp_decay", 3.6))
                fim = min(len(mix), p + len(trecho))
                mix[p:fim] += trecho[:fim - p] * cfg.get("vol_arp", 0.12)

    # melodia
    if cfg.get("melodia", True):
        escala = cfg.get("escala", [0, 2, 3, 5, 7, 8, 10])
        base = cfg.get("base_melodia", 5)
        for c in range(2, n_comp, 2):
            for k in range(2):
                grau = int(rng.integers(0, len(escala)))
                nota = f(cfg["tonica"], base) * 2 ** (escala[grau] / 12)
                p = pos(c, k * 2)
                trecho = sino(nota, 2.2, 0.16)
                fim = min(len(mix), p + len(trecho))
                mix[p:fim] += trecho[:fim - p] * cfg.get("vol_melodia", 0.16)

    # bateria
    if estilo in ("lofi", "house", "folk", "synth"):
        for c in range(n_comp):
            if c < 2 and cfg.get("intro", True):
                continue
            if estilo == "house":
                for b in range(4):
                    p = pos(c, b)
                    mix[p:p + len(kick())] += kick() * 0.44
                for b in (0.5, 1.5, 2.5, 3.5):
                    p = pos(c, b)
                    h = hat(aberto=(b == 3.5))
                    mix[p:p + len(h)] += h * 0.3
                p = pos(c, 2)
                s = snare()
                mix[p:p + len(s)] += s * 0.25
            elif estilo == "lofi":
                p = pos(c, 0)
                mix[p:p + len(kick())] += kick() * 0.34
                p = pos(c, 2)
                mix[p:p + len(kick())] += kick() * 0.24
                for b in (1, 3):
                    p = pos(c, b)
                    s = snare()
                    mix[p:p + len(s)] += s * 0.16
                for b in (0.5, 1.5, 2.5, 3.5):
                    p = pos(c, b)
                    h = hat()
                    mix[p:p + len(h)] += h * 0.11
            elif estilo == "synth":
                for b in (0, 2):
                    p = pos(c, b)
                    mix[p:p + len(kick())] += kick() * 0.5
                for b in (1, 3):
                    p = pos(c, b)
                    s = snare()
                    mix[p:p + len(s)] += s * 0.2
                for b in np.arange(0, 4, 0.5):
                    p = pos(c, b)
                    h = hat()
                    mix[p:p + len(h)] += h * 0.12
            elif estilo == "folk":
                for b in (0, 2):
                    p = pos(c, b)
                    mix[p:p + len(kick(0.2))] += kick(0.2) * 0.16
                for b in np.arange(0.5, 4, 1):
                    p = pos(c, b)
                    sh = shaker()
                    mix[p:p + len(sh)] += sh * 0.5

    dur = n_comp * compasso
    if cfg.get("vinil", False):
        mix[:total] += vinil(dur)[:total] * 0.9
    if cfg.get("chuva", False):
        mix[:total] += chuva(dur)[:total]
    mix = mix[:total]
    mix = reverb(mix, molhado=cfg.get("reverb", 0.3), cauda=2.0, seed=cfg.get("seed", 1))
    mix = mix + 0.45 * filtro(mix, 2800, 'high')
    # fade in/out
    fi = int(0.03 * SR)
    mix[:fi] *= np.linspace(0, 1, fi)
    fo = int(2.4 * SR)
    mix[-fo:] *= np.linspace(1, 0, fo) ** 1.3
    mix = np.tanh(mix * 1.15)
    mix = mix / (np.max(np.abs(mix)) + 1e-9) * 0.88
    return mix, dur


FAIXAS = [
    dict(arquivo="noite-azul.wav", titulo="Noite Azul", artista="Foxify Sessions", bpm=72,
         tonica="A", escala=[0, 2, 3, 5, 7, 8, 10], base_melodia=5,
         prog=[("A", "m7", 4), ("F", "maj7", 4), ("C", "M", 4), ("G", "M", 4)],
         estilo="lofi", vinil=True, reverb=0.34, arp_brilho=0.4, vol_pad=0.20),
    dict(arquivo="chuva-de-neon.wav", titulo="Chuva de Neon", artista="Foxify Sessions", bpm=100,
         tonica="F#", escala=[0, 2, 3, 5, 7, 8, 10], base_melodia=5,
         prog=[("F#", "m", 4), ("D", "M", 4), ("A", "M", 4), ("E", "M", 4)],
         estilo="synth", reverb=0.30, arp_brilho=0.6, arp_div=0.25, vol_arp=0.10, vol_pad=0.18),
    dict(arquivo="vento-solar.wav", titulo="Vento Solar", artista="Foxify Sessions", bpm=92,
         tonica="D", escala=[0, 2, 4, 5, 7, 9, 11], base_melodia=5,
         prog=[("D", "M", 4), ("A", "M", 4), ("B", "m", 4), ("G", "M", 4)],
         estilo="folk", reverb=0.26, arp_brilho=0.55, vol_arp=0.20, vol_pad=0.12,
         baixo_padrao=[(0, 1.5), (2, 1.5)]),
    dict(arquivo="madrugada-lofi.wav", titulo="Madrugada Lo-fi", artista="Foxify Sessions", bpm=68,
         tonica="C", escala=[0, 2, 4, 5, 7, 9, 11], base_melodia=5,
         prog=[("C", "maj7", 4), ("A", "m7", 4), ("F", "maj7", 4), ("G", "7", 4)],
         estilo="lofi", vinil=True, chuva=True, reverb=0.35, arp_brilho=0.35, vol_pad=0.22),
    dict(arquivo="pulso-eletrico.wav", titulo="Pulso ElÃ©trico", artista="Foxify Sessions", bpm=122,
         tonica="G", escala=[0, 2, 3, 5, 7, 8, 10], base_melodia=5,
         prog=[("G", "m", 4), ("D#", "M", 4), ("A#", "M", 4), ("F", "M", 4)],
         estilo="house", reverb=0.24, arp_brilho=0.5, arp_div=0.5, vol_arp=0.13, vol_pad=0.16),
    dict(arquivo="ceu-de-outubro.wav", titulo="CÃ©u de Outubro", artista="Foxify Sessions", bpm=60,
         tonica="E", escala=[0, 2, 4, 6, 7, 9, 11], base_melodia=5,
         prog=[("E", "M", 4), ("B", "M", 4), ("C#", "m", 4), ("A", "M", 4)],
         estilo="ambient", reverb=0.45, arp=False, vol_pad=0.26, vol_melodia=0.22),
]


def main():
    manifesto = []
    for cfg in FAIXAS:
        audio, dur = sintetizar(cfg)
        pcm = (np.clip(audio, -1, 1) * 32767).astype(np.int16)
        caminho = os.path.join(SAIDA, cfg["arquivo"])
        with wave.open(caminho, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(pcm.tobytes())
        manifesto.append(dict(arquivo=cfg["arquivo"], titulo=cfg["titulo"], artista=cfg["artista"],
                              duracao=round(dur, 2), bytes=os.path.getsize(caminho)))
        print(f"  {cfg['arquivo']}: {dur:.1f}s  {os.path.getsize(caminho)/1e6:.2f} MB")
    with open(os.path.join(RAIZ, "ferramentas", "manifesto_audio.json"), "w", encoding="utf-8") as fh:
        json.dump(manifesto, fh, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()

