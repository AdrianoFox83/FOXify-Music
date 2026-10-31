# -*- coding: utf-8 -*-
"""Verificações rápidas de integridade do FOXify."""
import glob
import os
import re
import sys


def main():
    raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(raiz)
    html = open("index.html", encoding="utf-8").read()
    js = "".join(open(f, encoding="utf-8").read() + "\n" for f in glob.glob("assets/js/*.js"))
    css = "".join(open(f, encoding="utf-8").read() + "\n" for f in glob.glob("assets/css/*.css"))

    simbolos = set(re.findall(r'<symbol id="i-([a-z0-9-]+)"', html))
    usados = set(re.findall(r'ico\("([a-z0-9-]+)"', js))
    print("ICONES faltando:", sorted(usados - simbolos))
    print("ICONES nao usados:", sorted(simbolos - usados))

    refs = set(re.findall(r'assets/[A-Za-z0-9_./-]+', html + js + css))
    faltando = sorted(r for r in refs if not os.path.exists(r))
    print("ARQUIVOS faltando:", faltando)

    acoes = sorted(set(re.findall(r'data-acao="([a-z0-9-]+)"', html + js)))
    print("ACOES (%d): %s" % (len(acoes), ", ".join(acoes)))

    # Ações declaradas no objeto acoes e nos handlers especiais
    declaradas = set(re.findall(r'"([a-z0-9-]+)": \(', js))
    especiais = set(re.findall(r'"([a-z0-9-]+)": \(\) =>', js))
    print("Sem handler aparente:", sorted(set(acoes) - declaradas - especiais))

    ids = re.findall(r'id="([a-z0-9-]+)"', html)
    duplicados = sorted({i for i in ids if ids.count(i) > 1})
    print("IDs duplicados no HTML:", duplicados)

    return 1 if faltando or (usados - simbolos) else 0


if __name__ == "__main__":
    sys.exit(main())
