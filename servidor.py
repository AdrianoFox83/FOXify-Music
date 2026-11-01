#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""FOXify — servidor local (arquivos + proxy para as APIs de música).

Uso:
    python servidor.py                 # porta 8765 em todas as interfaces
    python servidor.py --porta 9000
    python servidor.py --sem-proxy     # desliga o proxy /api/proxy

O proxy existe só para contornar CORS quando o navegador bloqueia as APIs.
Nenhum dado é gravado: as requisições passam direto para Audius/Archive/Jamendo.
"""
from __future__ import annotations

import argparse
import base64
import http.client
import ipaddress
import json
import os
import re
import socket
import ssl
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

RAIZ = os.path.dirname(os.path.abspath(__file__))
VENDOR = os.path.join(RAIZ, "_vendor")
if os.path.isdir(VENDOR) and VENDOR not in sys.path:
    sys.path.insert(0, VENDOR)
CACHE_YT = os.path.join(RAIZ, "_cache_yt")
YT_LOCKS = {}
YT_LOCK_MAPA = threading.Lock()
PORTA_PADRAO = 8765
CABECALHOS_PROXY = ("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges",
                    "Last-Modified", "ETag")
RE_FAIXA = re.compile(r"bytes=(\d*)-(\d*)")
UA_NAVEGADOR = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")


def cookies_youtube():
    """Aceita cookies do YouTube por arquivo secreto ou variável de ambiente."""
    caminho = os.environ.get("YT_COOKIES_FILE") or "/etc/secrets/cookies.txt"
    if os.path.isfile(caminho) and os.path.getsize(caminho) > 20:
        return caminho
    bruto = os.environ.get("YT_COOKIES_B64") or os.environ.get("YT_COOKIES")
    if not bruto:
        return None
    try:
        if os.environ.get("YT_COOKIES_B64"):
            bruto = base64.b64decode(bruto).decode("utf-8", "replace")
        destino = os.path.join(RAIZ, "_cache_cookies.txt")
        with open(destino, "w", encoding="utf-8") as arquivo:
            arquivo.write(bruto if bruto.endswith("\n") else bruto + "\n")
        try:
            os.chmod(destino, 0o600)
        except Exception:
            pass
        return destino
    except Exception:
        return None
def cookies_header():
    """Monta o cabeçalho Cookie a partir do arquivo Netscape do YouTube."""
    caminho = cookies_youtube()
    if not caminho:
        return ""
    pares = []
    try:
        with open(caminho, "r", encoding="utf-8", errors="ignore") as arquivo:
            for linha in arquivo:
                linha = linha.rstrip("\n")
                if not linha or (linha.startswith("#") and not linha.startswith("#HttpOnly_")):
                    continue
                if linha.startswith("#HttpOnly_"):
                    linha = linha[len("#HttpOnly_"):]
                campos = linha.split("\t")
                if len(campos) < 7:
                    continue
                nome, valor = campos[5].strip(), campos[6].strip()
                if nome:
                    pares.append(nome + "=" + valor)
    except Exception:
        return ""
    return "; ".join(pares)


def cabecalho_cookie():
    bruto = cookies_header()
    return bruto if len(bruto) < 12000 else ""


CABECALHOS_BASE = {
    "User-Agent": UA_NAVEGADOR,
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
    "Accept-Encoding": "identity",
}
# O site do Jamendo exige este cabeçalho no formato "$<hex>*<random>~".
JAM_CALL = "$" + "0" * 40 + "*0.5~"
JAM_VERSION = "4rkl5f"
# Cache das URLs de áudio do YouTube e da chave interna (evita nova consulta a cada play).
YT_CFG = {"chave": "", "quando": 0.0}
YT_AUDIO = {}
# Alguns clientes do player liberam áudio em IPs de datacenter; tentamos mais de um.
YT_CLIENTES = {
    "android": {
        "nome": "ANDROID", "versao": "20.10.38", "sdk": 30, "xclient": "3",
        "ua": "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip",
    },
    "android_vr": {
        "nome": "ANDROID_VR", "versao": "1.60.19", "sdk": 32, "xclient": "28",
        "ua": "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12; en_US; Quest 3 Build/SQ3A.220605.009.A1) gzip",
    },
    "web_embedded": {
        "nome": "WEB_EMBEDDED_PLAYER", "versao": "1.20250310.01.00", "sdk": 0, "xclient": "56",
        "ua": UA_NAVEGADOR,
    },
    "tv_embedded": {
        "nome": "TVHTML5_SIMPLY_EMBEDDED_PLAYER", "versao": "2.0", "sdk": 0, "xclient": "85",
        "ua": UA_NAVEGADOR,
    },
}


def ip_local() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        try:
            return socket.gethostbyname(socket.gethostname())
        except Exception:
            return "127.0.0.1"


class Servidor(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    proxy_ativo = True

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=RAIZ, **kwargs)

    # ------------------------------------------------------------ utilidades
    def log_message(self, formato, *args):
        if self.path.startswith("/api/"):
            return
        sys.stderr.write("  %s - %s\n" % (self.address_string(), formato % args))

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Range, Content-Type")
        self.send_header("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def guess_type(self, caminho):
        if caminho.endswith(".webmanifest"):
            return "application/manifest+json"
        if caminho.endswith(".js"):
            return "text/javascript; charset=utf-8"
        if caminho.endswith(".svg"):
            return "image/svg+xml"
        if caminho.endswith(".wav"):
            return "audio/wav"
        return super().guess_type(caminho)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    # ------------------------------------------------------------------ GET
    def do_GET(self):
        rota = urlparse(self.path).path
        if rota == "/api/health":
            return self.json({"ok": True, "app": "FOXify", "proxy": self.proxy_ativo,
                              "cookies": bool(cookies_youtube()), "versao": "1.6.2"})
        if rota == "/api/proxy":
            if not self.proxy_ativo:
                return self.json({"erro": "proxy desativado"}, 403)
            return self.proxy()
        if rota == "/api/youtube-audio":
            return self.youtube_audio()
        if rota == "/api/youtube-stream":
            return self.youtube_stream()
        return super().do_GET()

    def do_POST(self):
        rota = urlparse(self.path).path
        if rota != "/api/proxy":
            self.send_error(404, "Rota não encontrada")
            return
        if not self.proxy_ativo:
            return self.json({"erro": "proxy desativado"}, 403)
        try:
            tamanho = int(self.headers.get("Content-Length", "0") or 0)
            corpo = self.rfile.read(tamanho) if tamanho else b"{}"
            dados = json.loads(corpo or b"{}")
        except Exception:
            return self.json({"erro": "JSON inválido"}, 400)
        return self.proxy(dados)

    def do_HEAD(self):
        rota = urlparse(self.path).path
        if rota == "/api/health":
            return self.json({"ok": True}, somente_cabecalho=True)
        return super().do_HEAD()

    def json(self, dados, codigo=200, somente_cabecalho=False):
        corpo = json.dumps(dados, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if not somente_cabecalho:
            self.wfile.write(corpo)

    # ------------------------------------------------------ YouTube (só áudio)
    def yt_chave(self) -> str:
        if YT_CFG["chave"] and time.time() - YT_CFG["quando"] < 3600:
            return YT_CFG["chave"]
        pedido = urllib.request.Request("https://www.youtube.com/", headers=dict(CABECALHOS_BASE))
        with urllib.request.urlopen(pedido, timeout=25) as resposta:
            html = resposta.read().decode("utf-8", "ignore")
        achado = re.search(r'"INNERTUBE_API_KEY":"([^"]+)"', html)
        if not achado:
            raise RuntimeError("não encontrei a chave interna do YouTube")
        YT_CFG["chave"] = achado.group(1)
        YT_CFG["quando"] = time.time()
        return YT_CFG["chave"]

    def yt_info(self, vid, cliente="android"):
        """Consulta o player do YouTube e devolve a URL de áudio + metadados."""
        chave = self.yt_chave()
        cfg = YT_CLIENTES.get(cliente) or YT_CLIENTES["android"]
        ctx = {
            "clientName": cfg["nome"], "clientVersion": cfg["versao"],
            "hl": "pt", "gl": "BR",
        }
        if cfg["sdk"]:
            ctx["androidSdkVersion"] = cfg["sdk"]
        corpo = {
            "context": {
                "client": ctx,
                "thirdParty": {"embedUrl": "https://www.youtube.com/"},
            },
            "videoId": vid, "contentCheckOk": True, "racyCheckOk": True,
        }
        cabecalhos = {
            "Content-Type": "application/json",
            "User-Agent": cfg["ua"],
            "X-Youtube-Client-Name": cfg["xclient"],
            "X-Youtube-Client-Version": cfg["versao"],
            "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
            "Origin": "https://www.youtube.com",
            "Referer": "https://www.youtube.com/",
        }
        cookie = cabecalho_cookie()
        if cookie:
            cabecalhos["Cookie"] = cookie
        dados_json = json.dumps(corpo).encode("utf-8")
        # Importante: a URL de áudio fica assinada com o IP de origem.
        # Forçamos IPv4 para o IP não mudar entre o player e o CDN.
        conexao = http.client.HTTPSConnection(
            "www.youtube.com", timeout=30,
            context=ssl.create_default_context(), source_address=("0.0.0.0", 0))
        try:
            conexao.request("POST", "/youtubei/v1/player?key=" + chave,
                            body=dados_json, headers=cabecalhos)
            resposta = conexao.getresponse()
            dados = json.loads(resposta.read())
        finally:
            conexao.close()
        estado = (dados.get("playabilityStatus") or {}).get("status")
        if estado not in ("OK", "LIVE_STREAM_OFFLINE"):
            raise RuntimeError((dados.get("playabilityStatus") or {}).get("reason") or "vídeo indisponível")
        sd = dados.get("streamingData") or {}
        candidatos = []
        for formato in (sd.get("adaptiveFormats") or []) + (sd.get("formats") or []):
            mime = str(formato.get("mimeType") or "")
            if not mime.startswith("audio/") or not formato.get("url"):
                continue
            candidatos.append(formato)
        if not candidatos:
            raise RuntimeError("o YouTube não liberou uma faixa de áudio")

        def nota(formato):
            mime = str(formato.get("mimeType") or "")
            mp4 = 0 if "mp4" in mime else 1
            bitrate = abs(int(formato.get("bitrate") or 0) - 128000)
            return (mp4, bitrate)

        candidatos.sort(key=nota)
        escolhido = candidatos[0]
        detalhes = dados.get("videoDetails") or {}
        parametros = parse_qs(urlparse(escolhido["url"]).query)
        try:
            tamanho = int((parametros.get("clen") or ["0"])[0])
        except Exception:
            tamanho = 0
        return {
            "videoId": vid,
            "url": escolhido["url"],
            "mimeType": escolhido.get("mimeType") or "audio/mp4",
            "bitrate": escolhido.get("bitrate") or 0,
            "titulo": detalhes.get("title") or "",
            "artista": detalhes.get("author") or "",
            "duracao": int(detalhes.get("lengthSeconds") or 0),
            "tamanho": tamanho,
            "cliente": cliente,
        }

    def youtube_audio(self):
        """Devolve a URL de áudio (sem vídeo) de um vídeo do YouTube."""
        consulta = parse_qs(urlparse(self.path).query)
        vid = (consulta.get("videoId") or [""])[0].strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]{11}", vid):
            return self.json({"erro": "videoId inválido"}, 400)
        pedido = (consulta.get("client") or [""])[0].strip()
        ordem = []
        if pedido in YT_CLIENTES:
            ordem.append(pedido)
        for nome in ("android", "android_vr", "web_embedded", "tv_embedded"):
            if nome not in ordem:
                ordem.append(nome)
        agora = time.time()
        ultimo_erro = None
        for cliente in ordem:
            chave_cache = vid + ":" + cliente
            salvo = YT_AUDIO.get(chave_cache)
            if salvo and agora - salvo[0] < 15 * 60:
                return self.json(salvo[1])
            try:
                resposta = self.yt_info(vid, cliente)
                YT_AUDIO[chave_cache] = (agora, resposta)
                return self.json(resposta)
            except Exception as erro:
                ultimo_erro = erro
        return self.json({"erro": "YouTube: " + str(ultimo_erro or "falha")}, 502)

    def yt_baixar(self, vid):
        """Baixa só o áudio do vídeo (yt-dlp) e devolve o arquivo em cache."""
        os.makedirs(CACHE_YT, exist_ok=True)
        for extensao in (".m4a", ".webm", ".opus", ".mp4"):
            caminho = os.path.join(CACHE_YT, vid + extensao)
            if os.path.isfile(caminho) and os.path.getsize(caminho) > 1000:
                return caminho
        with YT_LOCK_MAPA:
            trava = YT_LOCKS.setdefault(vid, threading.Lock())
        with trava:
            for extensao in (".m4a", ".webm", ".opus", ".mp4"):
                caminho = os.path.join(CACHE_YT, vid + extensao)
                if os.path.isfile(caminho) and os.path.getsize(caminho) > 1000:
                    return caminho
            try:
                ambiente = dict(os.environ)
                ambiente["PYTHONPATH"] = VENDOR + os.pathsep + ambiente.get("PYTHONPATH", "")
                cookies = cookies_youtube()
                comando = [
                    sys.executable, "-m", "yt_dlp",
                    "-f", "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best",
                    "--no-playlist", "--quiet", "--no-warnings", "--no-progress",
                    "-o", os.path.join(CACHE_YT, vid + ".%(ext)s"),
                ]
                if cookies:
                    comando += ["--cookies", cookies]
                comando.append("https://www.youtube.com/watch?v=" + vid)
                opcoes = {}
                if os.name == "nt":
                    opcoes["creationflags"] = 0x08000000  # sem janela de console
                subprocess.run(comando, timeout=75, capture_output=True,
                               env=ambiente, cwd=RAIZ, check=False, **opcoes)
            except Exception:
                return None
            for extensao in (".m4a", ".webm", ".opus", ".mp4"):
                caminho = os.path.join(CACHE_YT, vid + extensao)
                if os.path.isfile(caminho) and os.path.getsize(caminho) > 1000:
                    self.limpar_cache_yt()
                    return caminho
            return None

    def limpar_cache_yt(self):
        try:
            agora = time.time()
            arquivos = [os.path.join(CACHE_YT, a) for a in os.listdir(CACHE_YT)]
            for caminho in arquivos:
                if agora - os.path.getmtime(caminho) > 2 * 3600:
                    os.remove(caminho)
            arquivos = [a for a in arquivos if os.path.isfile(a)]
            if len(arquivos) > 40:
                arquivos.sort(key=os.path.getmtime)
                for caminho in arquivos[:len(arquivos) - 40]:
                    os.remove(caminho)
        except Exception:
            pass

    def youtube_stream(self):
        """Entrega o áudio já baixado (sem vídeo) com suporte a Range."""
        consulta = parse_qs(urlparse(self.path).query)
        vid = (consulta.get("videoId") or [""])[0].strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]{11}", vid):
            return self.json({"erro": "videoId inválido"}, 400)
        caminho = self.yt_baixar(vid)
        if not caminho:
            mensagem = json.dumps({"erro": "não foi possível baixar o áudio do YouTube"}).encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(mensagem)))
            self.end_headers()
            self.wfile.write(mensagem)
            return
        return self.servir(caminho)

    def servir_inteiro(self, caminho):
        """Entrega o arquivo inteiro como 200; evita o Range problemático do CDN."""
        tamanho = os.path.getsize(caminho)
        tipo = self.guess_type(caminho)
        if caminho.endswith(".webm"):
            tipo = "audio/webm"
        elif caminho.endswith(".m4a"):
            tipo = "audio/mp4"
        elif caminho.endswith(".opus"):
            tipo = "audio/ogg"
        self.send_response(200)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(tamanho))
        self.send_header("Accept-Ranges", "none")
        self.send_header("Cache-Control", "public, max-age=86400")
        self.end_headers()
        if self.command == "HEAD":
            return
        try:
            with open(caminho, "rb") as arquivo:
                while True:
                    bloco = arquivo.read(65536)
                    if not bloco:
                        break
                    self.wfile.write(bloco)
        except (BrokenPipeError, ConnectionResetError):
            pass

    # ------------------------------------------------------------ arquivos
    def send_head(self):
        caminho = self.translate_path(self.path)
        if os.path.isdir(caminho):
            if not self.path.endswith("/"):
                self.send_response(301)
                self.send_header("Location", self.path + "/")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return None
            caminho = os.path.join(caminho, "index.html")
        if not os.path.isfile(caminho):
            self.send_error(404, "Arquivo não encontrado")
            return None
        return self.servir(caminho)

    def servir(self, caminho):
        tamanho = os.path.getsize(caminho)
        tipo = self.guess_type(caminho)
        if caminho.endswith(".webm"):
            tipo = "audio/webm"
        elif caminho.endswith(".m4a"):
            tipo = "audio/mp4"
        elif caminho.endswith(".opus"):
            tipo = "audio/ogg"
        faixa = self.headers.get("Range")
        inicio, fim = 0, tamanho - 1
        parcial = False
        if faixa:
            casamento = RE_FAIXA.match(faixa.strip())
            if casamento:
                if casamento.group(1):
                    inicio = int(casamento.group(1))
                if casamento.group(2):
                    fim = int(casamento.group(2))
                fim = min(fim, tamanho - 1)
                if inicio > fim or inicio >= tamanho:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{tamanho}")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return None
                parcial = True

        self.send_response(206 if parcial else 200)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(fim - inicio + 1))
        self.send_header("Accept-Ranges", "bytes")
        if parcial:
            self.send_header("Content-Range", f"bytes {inicio}-{fim}/{tamanho}")
        if caminho.endswith((".html", ".js", ".css", ".webmanifest")) or caminho.endswith("sw.js"):
            self.send_header("Cache-Control", "no-cache")
        else:
            self.send_header("Cache-Control", "public, max-age=86400")
        self.end_headers()
        if self.command == "HEAD":
            return None
        try:
            with open(caminho, "rb") as arquivo:
                arquivo.seek(inicio)
                restante = fim - inicio + 1
                while restante > 0:
                    bloco = arquivo.read(min(65536, restante))
                    if not bloco:
                        break
                    self.wfile.write(bloco)
                    restante -= len(bloco)
        except (BrokenPipeError, ConnectionResetError):
            pass
        return None

    def copyfile(self, origem, destino):  # usado apenas em HEAD
        return

    # -------------------------------------------------------------- proxy
    def proxy(self, dados=None):
        metodo = "GET"
        corpo = None
        tipo_conteudo = None
        if dados:
            alvo = str(dados.get("url") or "").strip()
            metodo = str(dados.get("method") or "POST").upper()
            corpo = dados.get("body")
            tipo_conteudo = dados.get("contentType") or "application/x-www-form-urlencoded"
        else:
            consulta = parse_qs(urlparse(self.path).query)
            alvo = (consulta.get("url") or [""])[0]
        if not alvo:
            return self.json({"erro": "parâmetro url ausente"}, 400)
        partes = urlparse(alvo)
        if partes.scheme != "https" or not partes.hostname:
            return self.json({"erro": "apenas URLs https são permitidas"}, 400)
        host = partes.hostname.lower()
        if host in ("localhost", "127.0.0.1", "0.0.0.0", "::1") or host.endswith(".local"):
            return self.json({"erro": "host bloqueado"}, 403)
        try:
            if ipaddress.ip_address(host).is_private:
                return self.json({"erro": "endereço privado bloqueado"}, 403)
        except ValueError:
            pass

        cabecalhos = dict(CABECALHOS_BASE)
        cabecalhos["Accept"] = self.headers.get("Accept") or "*/*"
        if host.endswith("jamendo.com") and partes.path.startswith("/api/"):
            cabecalhos.update({
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "X-Jam-Call": JAM_CALL,
                "X-Jam-Version": JAM_VERSION,
                "X-Requested-With": "XMLHttpRequest",
                "Referer": "https://www.jamendo.com/",
            })
        elif host.endswith("dzcdn.net"):
            cabecalhos.update({
                "Referer": "https://www.deezer.com/",
                "Origin": "https://www.deezer.com",
            })
        elif host == "itunes.apple.com":
            # A API de busca recusa Referer/Origin e devolve 429.
            cabecalhos.update({"Accept": "application/json"})
        elif host.endswith("audio-ssl.itunes.apple.com") or host.endswith("mzstatic.com"):
            cabecalhos.update({
                "Referer": "https://music.apple.com/",
                "Origin": "https://music.apple.com",
            })
        elif host == "music.youtube.com":
            cabecalhos.update({
                "Referer": "https://music.youtube.com/",
                "Origin": "https://music.youtube.com",
                "X-YouTube-Client-Name": "67",
                "X-YouTube-Client-Version": "1.20261027.10.00",
                "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
            })
        elif host.endswith("googlevideo.com"):
            # A URL já vem assinada; Origin/Referer extras fazem o CDN devolver 403.
            cabecalhos.update({"Accept": "*/*"})
        elif host.endswith("youtube.com") or host.endswith("youtu.be"):
            cabecalhos.update({
                "Referer": "https://www.youtube.com/",
                "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
            })

        faixa = self.headers.get("Range")
        if host.endswith("googlevideo.com"):
            return self.proxy_googlevideo(partes, metodo, cabecalhos, faixa)

        if corpo is not None:
            corpo_bytes = corpo.encode("utf-8") if isinstance(corpo, str) else bytes(corpo)
            pedido = urllib.request.Request(alvo, data=corpo_bytes, method=metodo)
            pedido.add_header("Content-Type", tipo_conteudo)
        else:
            pedido = urllib.request.Request(alvo, method=metodo)
        for nome, valor in cabecalhos.items():
            if valor:
                pedido.add_header(nome, valor)
        faixa = self.headers.get("Range")
        if faixa and metodo == "GET":
            pedido.add_header("Range", faixa)
        try:
            with urllib.request.urlopen(pedido, timeout=35) as resposta:
                tipo = resposta.headers.get("Content-Type", "")
                eh_midia = tipo.startswith(("audio/", "video/")) or bool(self.headers.get("Range"))
                if self.command == "HEAD":
                    self.send_response(resposta.status)
                    for nome in CABECALHOS_PROXY:
                        valor = resposta.headers.get(nome)
                        if valor:
                            self.send_header(nome, valor)
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    return
                if eh_midia:
                    # Áudio/vídeo: mantém streaming e fecha a conexão no fim.
                    self.send_response(resposta.status)
                    for nome in CABECALHOS_PROXY:
                        valor = resposta.headers.get(nome)
                        if valor:
                            self.send_header(nome, valor)
                    self.send_header("Cache-Control", "no-store")
                    self.send_header("Connection", "close")
                    self.close_connection = True
                    self.end_headers()
                    try:
                        while True:
                            bloco = resposta.read(65536)
                            if not bloco:
                                break
                            self.wfile.write(bloco)
                    except (BrokenPipeError, ConnectionResetError):
                        pass
                else:
                    # JSON/HTML: lê tudo e informa Content-Length (evita travar no browser).
                    dados = resposta.read()
                    self.send_response(resposta.status)
                    for nome in CABECALHOS_PROXY:
                        if nome == "Content-Length":
                            continue
                        valor = resposta.headers.get(nome)
                        if valor:
                            self.send_header(nome, valor)
                    self.send_header("Content-Length", str(len(dados)))
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    try:
                        self.wfile.write(dados)
                    except (BrokenPipeError, ConnectionResetError):
                        pass
        except urllib.error.HTTPError as erro:
            try:
                corpo = erro.read()[:2000]
            except Exception:
                corpo = b""
            self.send_response(erro.code)
            self.send_header("Content-Type", erro.headers.get("Content-Type", "application/json"))
            self.send_header("Content-Length", str(len(corpo)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(corpo)
        except Exception as erro:
            mensagem = json.dumps({"erro": f"falha no proxy: {erro}"}).encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(mensagem)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(mensagem)


    def proxy_googlevideo(self, partes, metodo, cabecalhos, faixa):
        """Stream do áudio do YouTube forçando IPv4 (a URL é assinada pelo IP)."""
        contexto = ssl.create_default_context()
        conexao = http.client.HTTPSConnection(
            partes.hostname, timeout=35, context=contexto, source_address=("0.0.0.0", 0))
        caminho = partes.path + (("?" + partes.query) if partes.query else "")
        headers = dict(cabecalhos)
        headers["Accept"] = "*/*"
        # O CDN do YouTube recusa Range aberto ("bytes=0-") e o arquivo inteiro.
        # Pedimos blocos fechados de 1 MB; o navegador pede o restante sozinho.
        parametros = parse_qs(partes.query)
        try:
            tamanho = int((parametros.get("clen") or ["0"])[0])
        except Exception:
            tamanho = 0
        inicio, fim = 0, None
        achado = re.match(r"bytes=(\d*)-(\d*)", faixa or "")
        if achado:
            if achado.group(1):
                inicio = int(achado.group(1))
            if achado.group(2):
                fim = int(achado.group(2))
        bloco = 1024 * 1024
        if tamanho > 0:
            inicio = min(inicio, tamanho - 1)
            limite = min(inicio + bloco - 1, tamanho - 1)
            fim = limite if fim is None else min(fim, limite)
        elif fim is None:
            fim = inicio + bloco - 1
        headers["Range"] = "bytes=%d-%d" % (inicio, fim)
        try:
            conexao.request(metodo, caminho, headers=headers)
            resposta = conexao.getresponse()
            if resposta.status not in (200, 206):
                corpo = resposta.read()[:2000]
                self.send_response(resposta.status)
                self.send_header("Content-Type", resposta.getheader("Content-Type") or "text/plain")
                self.send_header("Content-Length", str(len(corpo)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(corpo)
                return
            self.send_response(206)
            for nome in CABECALHOS_PROXY:
                valor = resposta.getheader(nome)
                if valor:
                    self.send_header(nome, valor)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.close_connection = True
            self.end_headers()
            if self.command == "HEAD":
                return
            try:
                while True:
                    bloco = resposta.read(65536)
                    if not bloco:
                        break
                    self.wfile.write(bloco)
            except (BrokenPipeError, ConnectionResetError):
                pass
        except Exception as erro:
            mensagem = json.dumps({"erro": "falha no áudio do YouTube: " + str(erro)}).encode("utf-8")
            try:
                self.send_response(502)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(mensagem)))
                self.end_headers()
                self.wfile.write(mensagem)
            except Exception:
                pass
        finally:
            conexao.close()


def main():
    parser = argparse.ArgumentParser(description="Servidor local do FOXify")
    parser.add_argument("--porta", type=int, default=int(os.environ.get("PORT", PORTA_PADRAO)))
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--sem-proxy", action="store_true")
    args = parser.parse_args()

    Servidor.proxy_ativo = not args.sem_proxy
    try:
        servidor = ThreadingHTTPServer((args.host, args.porta), Servidor)
    except OSError as erro:
        print(f"\nNão consegui abrir a porta {args.porta}: {erro}")
        print("Talvez o FOXify já esteja aberto. Teste http://127.0.0.1:%d/" % args.porta)
        return 1

    servidor.daemon_threads = True
    ip = ip_local()
    print("\n" + "=" * 62)
    print("  FOXify 1.6.2 — player de música livre")
    print("=" * 62)
    print(f"  Neste computador : http://127.0.0.1:{args.porta}/")
    print(f"  No celular (Wi-Fi): http://{ip}:{args.porta}/")
    print("  Proxy de APIs     :", "ativo" if Servidor.proxy_ativo else "desativado")
    print("=" * 62)
    print("  Deixe esta janela aberta enquanto usa o app. Ctrl+C encerra.\n")
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor encerrado. Até a próxima!")
    finally:
        servidor.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
