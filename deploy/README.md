# FOXify na nuvem — rodar em qualquer rede

O APK não consegue baixar/extrair o áudio do YouTube sozinho. Para o FOXify funcionar
em qualquer internet — sem depender do seu PC — o backend precisa ficar **hospedado
online**. Este projeto já está pronto para isso: o `servidor.py` serve o app, a API,
o proxy e o áudio do YouTube, com CORS e `PORT` configurável.

Depois do deploy, o endereço público (`https://...)` vira o endereço do app. O APK
pode ser gerado a partir dele (TWA/PWA) ou configurado para usar esse servidor.

## Cookies do YouTube (quando o IP da nuvem é bloqueado)

O Render pode receber “confirme que você não é um robô” ao baixar áudio. Se você tem
cookies de uma conta YouTube, coloque-os no servidor como **segredo**:

1. No Render, abra o serviço → **Environment** → **Secret Files**.
2. Crie o arquivo **`cookies.txt`** com o conteúdo no formato Netscape.
3. Salve e faça **Manual Deploy**.
4. Abra `https://SEU-APP/api/health`; deve aparecer `"cookies": true`.

O `servidor.py` lê automaticamente `/etc/secrets/cookies.txt`. Também aceita a variável
`YT_COOKIES_B64` (conteúdo do arquivo em Base64) ou `YT_COOKIES_FILE` (caminho).

> **Nunca** comite `cookies.txt` no GitHub. Esses cookies dão acesso à conta; depois de
> testar, encerre as sessões dessa conta no YouTube/Google se quiser invalidá-los.


## Opção 1 — Render (mais simples)

1. Crie um repositório no GitHub e envie **o conteúdo desta pasta** para ele
   (não envie `_cache_yt`, `__pycache__` nem o ZIP).
2. Acesse [render.com](https://render.com), crie uma conta e escolha
   **New → Blueprint** (ou **New → Web Service**).
3. Conecte o repositório. O Render detecta o `Dockerfile`/`render.yaml`.
4. Plano **Free**; aguarde o build.
5. Abra a URL gerada e teste: `https://SEU-APP.onrender.com/api/health`
   deve responder `{"ok":true,...}`.
6. Abra a URL no Chrome do Android e use **Adicionar à tela inicial** — ou gere o
   APK no PWABuilder a partir dela.

> O plano free do Render hiberna após um tempo sem uso. O primeiro acesso pode
> demorar alguns segundos.

## Opção 2 — Railway

1. Envie o projeto para um repositório GitHub.
2. Em [railway.app](https://railway.app): **New Project → Deploy from GitHub**.
3. O Railway detecta o `Dockerfile`; ele injeta `PORT` automaticamente.
4. Gere o domínio público em **Settings → Networking → Generate Domain**.

## Opção 3 — Fly.io

```bash
fly launch --dockerfile Dockerfile
fly deploy
```

O `fly.toml` já está preparado (porta interna 8080).

## Opção 4 — VPS própria

```bash
docker build -t foxify .
docker run -d --name foxify -p 80:10000 -e PORT=10000 foxify
```

Coloque um proxy HTTPS (Caddy/Nginx/Cloudflare) na frente. HTTPS é obrigatório para
instalar o PWA/gerar o APK TWA.

## Gerar o APK

### APK TWA (recomendado)

1. Publique o app em HTTPS (passos acima).
2. Abra [pwabuilder.com](https://www.pwabuilder.com/), informe a URL pública.
3. Gere o pacote Android e assine.
4. O APK abre a URL publicada; como app e API estão na **mesma origem**, não precisa
   configurar nada.

### APK que empacota os arquivos (WebView)

Se o APK carrega os arquivos locais, ele continua sem backend. Nesse caso:

1. Gere o APK com a versão 1.6.3 ou mais nova.
2. No app: **Ajustes → Servidor do FOXify (APK)**.
3. Informe a URL pública do deploy, por exemplo `https://seu-app.onrender.com`.
4. Toque em **Testar servidor**.

A URL precisa ser **HTTPS**; um APK que abre em HTTPS não pode chamar HTTP por causa
do bloqueio de conteúdo misto do Android.

## Limitações importantes

- **YouTube em datacenter:** alguns provedores (Render/Railway/Fly) são bloqueados pelo
  YouTube e o `yt-dlp` pode receber “Sign in to confirm you're not a bot”. Se isso
  acontecer, use uma VPS com IP residencial/menos visado, cookies do YouTube ou outro
  provedor. Teste `https://SEU-APP/api/health` e depois uma faixa do YouTube.
- **Cache:** o cache de áudio do YouTube (`_cache_yt`) é temporário no plano free;
  cada reinício baixa de novo. Para cache persistente, monte um disco em `/app/_cache_yt`.
- **Custos/limites:** planos free têm hibernação, CPU e tráfego limitados. Para uso
  diário, um plano pequeno de VPS é mais estável.
- **Segurança:** o proxy é público. Se o servidor for usado por muita gente, coloque
  autenticação/rate limit na frente.

## O que não é possível

Não existe um APK 100% offline que toque músicas completas do YouTube/Deezer/iTunes
sem um backend ou sem embutir um extrator nativo (Python/yt-dlp/ffmpeg) no APK. As APIs
públicas do Deezer/iTunes só entregam prévias de 30 s; o áudio completo vem do YouTube.
Por isso o caminho correto para “qualquer rede” é **hospedar este servidor** e apontar
o APK para ele.
