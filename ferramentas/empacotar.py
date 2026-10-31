# -*- coding: utf-8 -*-
"""Empacota o FOXify com caminhos compatíveis (barras normais) para Netlify/APK."""
import os
import zipfile

RAIZ = os.path.dirname(os.path.abspath(__file__))
PROJETO = os.path.dirname(RAIZ)
DESTINO = os.path.join(os.path.dirname(PROJETO), "FOXify.zip")

with zipfile.ZipFile(DESTINO, "w", zipfile.ZIP_DEFLATED) as z:
    for pasta, subpastas, arquivos in os.walk(PROJETO):
        subpastas[:] = [s for s in subpastas
                        if s not in ("__pycache__", ".git", "_pesquisa", "_teste", "FOXify",
                                     "node_modules", "_cache_yt")]
        for arquivo in arquivos:
            if arquivo in (".DS_Store",) or arquivo.endswith(".pyc"):
                continue
            caminho = os.path.join(pasta, arquivo)
            relativo = os.path.relpath(caminho, PROJETO)
            z.write(caminho, relativo.replace(os.sep, "/"))
print("OK", DESTINO, os.path.getsize(DESTINO))
