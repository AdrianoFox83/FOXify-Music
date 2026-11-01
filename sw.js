/* FOXify — service worker (app shell offline + faixas demo em cache). */
const VERSAO = "foxify-v1.7.9";
const ESSENCIAIS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/css/estilos-1.6.8.css",
  "./assets/js/dados-1.6.8.js",
  "./assets/js/fontes-1.6.8.js",
  "./assets/js/player-1.6.8.js",
  "./assets/js/app-1.6.8.js",
  "./assets/img/avatar.jpg",
  "./assets/audio/silencio.wav",
  "./assets/img/icones/favicon.png",
  "./assets/img/icones/icon-180.png",
  "./assets/img/icones/icon-192.png",
  "./assets/img/icones/icon-512.png",
  "./assets/img/icones/maskable-512.png",
  "./assets/img/icones/logo-fox.png",
  "./assets/img/icones/logo-foxify.png",
  "./assets/img/capas/top50-brasil-novo.jpg",
  "./assets/img/capas/mood-chill-novo.jpg",
  "./assets/img/capas/rock-antigo-novo.jpg",
  "./assets/img/capas/hip-hop-2025-novo.jpg",
  "./assets/img/capas/rock-nacional.jpg",
  "./assets/img/capas/indie-vibes.jpg",
  "./assets/img/capas/eletronica-sem-limites.jpg",
  "./assets/img/capas/mpb-essencial.jpg",
  "./assets/img/capas/romanticas.jpg",
  "./assets/img/capas/classicos-70-80-90.jpg",
  "./assets/img/capas/favoritas.jpg",
  "./assets/img/capas/sua-musica.jpg",
  "./assets/img/capas/sertanejo-universitario.jpg",
  "./assets/img/capas/rap-nacional.jpg",
  "./assets/img/capas/lofi-beats.jpg",
  "./assets/img/capas/rock-classico.jpg",
  "./assets/img/capas/rock-alternativo.jpg",
  "./assets/img/capas/noite-azul.jpg",
  "./assets/img/capas/chuva-de-neon.jpg",
  "./assets/img/capas/vento-solar.jpg",
  "./assets/img/capas/madrugada-lofi.jpg",
  "./assets/img/capas/pulso-eletrico.jpg",
  "./assets/img/capas/ceu-de-outubro.jpg",
  "./assets/audio/noite-azul.wav",
  "./assets/audio/chuva-de-neon.wav",
  "./assets/audio/vento-solar.wav",
  "./assets/audio/madrugada-lofi.wav",
  "./assets/audio/pulso-eletrico.wav",
  "./assets/audio/ceu-de-outubro.wav"
];

self.addEventListener("install", (evento) => {
  evento.waitUntil((async () => {
    const cache = await caches.open(VERSAO);
    await Promise.all(ESSENCIAIS.map((url) => cache.add(url).catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil((async () => {
    const chaves = await caches.keys();
    await Promise.all(chaves.filter((k) => k !== VERSAO).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (evento) => {
  const req = evento.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/api/")) return;

  if (req.mode === "navigate") {
    evento.respondWith((async () => {
      try {
        const resposta = await fetch(req);
        const cache = await caches.open(VERSAO);
        cache.put("./index.html", resposta.clone());
        return resposta;
      } catch (_) {
        return (await caches.match("./index.html")) || (await caches.match("./")) ||
          new Response("<h1>FOXify offline</h1><p>Abra o app com internet uma vez para baixar a interface.</p>",
            { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
    })());
    return;
  }

  // Áudio: responde Range a partir do cache (necessário para buscar/seek offline).
  if (/\.(wav|mp3|ogg|m4a)$/i.test(url.pathname)) {
    evento.respondWith((async () => {
      let resposta = await caches.match(req, { ignoreSearch: true });
      if (!resposta) {
        try {
          resposta = await fetch(req);
          if (resposta.ok && !req.headers.has("range")) {
            const cache = await caches.open(VERSAO);
            cache.put(req, resposta.clone());
          }
        } catch (_) {
          return new Response("", { status: 504 });
        }
      }
      const pedidoFaixa = req.headers.get("range");
      if (!pedidoFaixa) return resposta;
      const total = (await resposta.clone().arrayBuffer()).byteLength;
      const casamento = /bytes=(\d*)-(\d*)/.exec(pedidoFaixa);
      const inicio = casamento && casamento[1] ? parseInt(casamento[1], 10) : 0;
      const fimOriginal = casamento && casamento[2] ? parseInt(casamento[2], 10) : total - 1;
      const fim = Math.min(fimOriginal, total - 1);
      const corpo = (await resposta.arrayBuffer()).slice(inicio, fim + 1);
      return new Response(corpo, {
        status: 206,
        headers: {
          "Content-Type": resposta.headers.get("Content-Type") || "audio/wav",
          "Content-Range": `bytes ${inicio}-${fim}/${total}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(corpo.byteLength)
        }
      });
    })());
    return;
  }

  if (/\.(css|js|webmanifest|jpg|jpeg|png|svg|ico)$/i.test(url.pathname)) {
    evento.respondWith((async () => {
      // Rede primeiro: capas e código novos entram na hora; o cache fica para offline.
      try {
        const resposta = await fetch(req);
        if (resposta.ok) {
          const cache = await caches.open(VERSAO);
          cache.put(req, resposta.clone());
        }
        return resposta;
      } catch (_) {
        return (await caches.match(req, { ignoreSearch: true })) ||
          new Response("", { status: 504 });
      }
    })());
  }
});
