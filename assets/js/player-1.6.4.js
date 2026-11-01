/* FOXify — player: fila, áudio, YouTube (iframe oficial), Media Session. */
(function () {
  "use strict";

  let audio = new Audio();
  audio.preload = "metadata";
  audio.volume = 0.8;

  let fila = [];
  let indice = -1;
  let contexto = "";
  let aleatorio = false;
  let repetir = "off"; // off | todas | uma
  let carregando = false;
  let erro = null;
  let token = 0;
  let falhasSeguidas = 0;
  let urlAtual = null;
  let vigia = null;
  let motor = "audio"; // audio | youtube
  let yt = null;
  let ytApi = null;
  let ytTimer = null;
  let ytVideoId = null;
  const ouvintesMudanca = new Set();
  const ouvintesProgresso = new Set();
  let ultimoProgresso = 0;

  const estado = () => {
    const faixa = fila[indice] || null;
    let dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (faixa ? faixa.duracao || 0 : 0);
    let tempo = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    let tocando = !audio.paused && !audio.ended;
    let volume = audio.volume;
    let mudo = audio.muted;
    if (motor === "youtube" && yt && typeof yt.getDuration === "function") {
      try {
        const d = yt.getDuration();
        if (d > 0) dur = d;
        tempo = yt.getCurrentTime() || 0;
        const s = yt.getPlayerState();
        tocando = s === 1;
        volume = (yt.getVolume ? yt.getVolume() : 100) / 100;
        mudo = yt.isMuted ? yt.isMuted() : false;
      } catch (_) { /* player ainda montando */ }
    }
    return {
      fila, indice, faixa, contexto, motor,
      tocando, carregando, erro, tempo, duracao: dur, volume, mudo,
      aleatorio, repetir
    };
  };

  function emitir() {
    const st = estado();
    ouvintesMudanca.forEach((fn) => { try { fn(st); } catch (e) { console.error(e); } });
  }

  function emitirProgresso(forca) {
    const agora = performance.now();
    if (!forca && agora - ultimoProgresso < 120) return;
    ultimoProgresso = agora;
    const st = estado();
    ouvintesProgresso.forEach((fn) => { try { fn(st); } catch (e) { console.error(e); } });
  }

  function aoMudar(fn) { ouvintesMudanca.add(fn); return () => ouvintesMudanca.delete(fn); }
  function aoProgresso(fn) { ouvintesProgresso.add(fn); return () => ouvintesProgresso.delete(fn); }

  function midiaSessao(faixa) {
    if (!("mediaSession" in navigator)) return;
    if (!faixa) {
      navigator.mediaSession.metadata = null;
      return;
    }
    const arte = [];
    if (faixa.capa) {
      const url = new URL(faixa.capa, location.href).href;
      arte.push({ src: url, sizes: "512x512", type: "image/jpeg" });
    }
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: faixa.titulo,
        artist: faixa.artista || "FOXify",
        album: contexto || "FOXify",
        artwork: arte
      });
    } catch (_) { /* navegador sem MediaMetadata */ }
  }

  function atualizarPosicao() {
    if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
    const st = estado();
    if (!st.duracao || !Number.isFinite(st.duracao)) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: st.duracao,
        playbackRate: 1,
        position: Math.min(Math.max(0, st.tempo), st.duracao)
      });
    } catch (_) { /* ignora */ }
  }

  /* --------------------------------------------------------------- YouTube */
  function mostrarYt(visivel) {
    const el = document.getElementById("yt-palco");
    if (!el) return;
    el.classList.toggle("ativo", !!visivel);
    if (!visivel) el.classList.remove("pendente");
  }

  function carregarApiYt() {
    if (window.YT && window.YT.Player) return Promise.resolve();
    if (ytApi) return ytApi;
    ytApi = new Promise((resolve, reject) => {
      const anterior = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof anterior === "function") { try { anterior(); } catch (_) {} }
        resolve();
      };
      if (!document.querySelector("script[data-yt-api]")) {
        const s = document.createElement("script");
        s.src = "https://www.youtube.com/iframe_api";
        s.dataset.ytApi = "1";
        s.onerror = () => reject(new Error("Não foi possível carregar a API do YouTube"));
        document.head.appendChild(s);
      }
      setTimeout(() => reject(new Error("A API do YouTube demorou para responder")), 20000);
    }).catch((e) => { ytApi = null; throw e; });
    return ytApi;
  }

  function pararTimerYt() {
    if (ytTimer) { clearInterval(ytTimer); ytTimer = null; }
  }

  function iniciarTimerYt() {
    pararTimerYt();
    ytTimer = setInterval(() => {
      if (motor !== "youtube") return;
      emitirProgresso(true);
      atualizarPosicao();
    }, 700);
  }

  function pararYt() {
    pararTimerYt();
    try { if (yt && yt.stopVideo) yt.stopVideo(); } catch (_) { /* ignora */ }
    mostrarYt(false);
  }

  function armarVigiaYt(meuToken) {
    limparVigia();
    vigia = setTimeout(() => {
      vigia = null;
      if (meuToken !== token || motor !== "youtube") return;
      let s = -1;
      try { s = yt ? yt.getPlayerState() : -1; } catch (_) {}
      if (s !== 1 && carregando) falhar(new Error("O YouTube não iniciou o vídeo"), meuToken);
    }, 12000);
  }

  async function criarPlayerYt() {
    await carregarApiYt();
    if (yt) return yt;
    await new Promise((resolve, reject) => {
      const limite = setTimeout(() => reject(new Error("O player do YouTube não ficou pronto")), 15000);
      yt = new YT.Player("yt-player", {
        width: "100%",
        height: "100%",
        playerVars: { autoplay: 0, controls: 0, playsinline: 1, rel: 0, modestbranding: 1, mute: 1 },
        events: {
          onReady: () => { clearTimeout(limite); resolve(); },
          onStateChange: (ev) => {
            if (!window.YT) return;
            if (ev.data === YT.PlayerState.PLAYING) {
              carregando = false;
              erro = null;
              falhasSeguidas = 0;
              limparVigia();
              const palco = document.getElementById("yt-palco");
              if (palco) palco.classList.remove("pendente");
              atualizarMidia("playing");
              iniciarTimerYt();
              emitir();
            } else if (ev.data === YT.PlayerState.PAUSED) {
              atualizarMidia("paused");
              pararTimerYt();
              emitir();
            } else if (ev.data === YT.PlayerState.BUFFERING) {
              carregando = true;
              emitir();
            } else if (ev.data === YT.PlayerState.ENDED) {
              pararTimerYt();
              proxima(false);
            }
          },
          onError: () => falhar(new Error("Vídeo indisponível no YouTube"), token)
        }
      });
    });
    return yt;
  }

  function prepararYoutube() {
    if (yt) return Promise.resolve(yt);
    return criarPlayerYt().catch(() => null);
  }

  async function tocarYoutube(faixa, info, autoplay, meuToken) {
    motor = "youtube";
    carregando = true;
    erro = null;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    mostrarYt(true);
    emitir();
    try {
      await criarPlayerYt();
      if (meuToken !== token) return;
      if (ytVideoId !== info.videoId) {
        yt.loadVideoById(info.videoId);
        ytVideoId = info.videoId;
      }
      if (yt.setVolume) yt.setVolume(Math.round(audio.volume * 100));
      if (autoplay) {
        try { yt.playVideo(); } catch (_) { /* aguarda evento */ }
        const palco = document.getElementById("yt-palco");
        setTimeout(() => {
          let s = -1;
          try { s = yt ? yt.getPlayerState() : -1; } catch (_) {}
          if (palco && s !== 1 && motor === "youtube") palco.classList.add("pendente");
        }, 2800);
        armarVigiaYt(meuToken);
      } else {
        carregando = false;
        emitir();
      }
    } catch (e) {
      if (meuToken !== token) return;
      await falhar(e, meuToken);
    }
  }

  /* ---------------------------------------------------------------- áudio */
  async function carregar(i, autoplay) {
    const faixa = fila[i];
    if (!faixa) return;
    indice = i;
    carregando = true;
    erro = null;
    urlAtual = null;
    limparVigia();
    pararTimerYt();
    if (motor === "youtube") {
      try { if (yt && yt.stopVideo) yt.stopVideo(); } catch (_) {}
    }
    motor = "audio";
    mostrarYt(false);
    const meuToken = ++token;
    const antigo = audio;
    try {
      antigo.pause();
      antigo.removeAttribute("src");
      antigo.load();
    } catch (_) { /* ignora */ }
    emitir();
    midiaSessao(faixa);
    // Destrava o elemento de áudio dentro do gesto do usuário. Sem isso, o
    // Bandcamp/HearThis (que resolvem a URL depois) podem ficar com o play suspenso.
    let audioPronto = false;
    try {
      audio = prepararElemento(new Audio());
      audio.muted = antigo.muted;
      audioPronto = true;
      if (autoplay) {
        audio.src = "assets/audio/silencio.wav";
        audio.play().catch(() => {});
      }
    } catch (_) { audio = null; }
    try {
      const info = await FOX_FONTES.urlParaTocar(faixa);
      if (meuToken !== token) return;
      if (info.duracao && !faixa.duracao) faixa.duracao = info.duracao;
      if (info.engine === "youtube") {
        return tocarYoutube(faixa, info, autoplay, meuToken);
      }
      motor = "audio";
      urlAtual = info.url;
      // O elemento já foi criado/destravado no clique; só troca a fonte.
      if (!audioPronto || !audio) {
        audio = prepararElemento(new Audio());
        audio.muted = antigo.muted;
      }
      audio.src = info.url;
      audio.load();
      if (!autoplay) {
        carregando = false;
        emitir();
        emitirProgresso(true);
        return;
      }
      armarVigia(meuToken);
      try {
        await audio.play();
        if (meuToken !== token) return;
        carregando = false;
        emitir();
      } catch (e) {
        if (meuToken !== token) return;
        if (e && e.name === "AbortError") return;
        if (e && e.name === "NotAllowedError") {
          carregando = false;
          erro = "toque";
          emitir();
          return;
        }
        await falhar(e, meuToken);
      }
    } catch (e) {
      if (meuToken !== token) return;
      await falhar(e, meuToken);
    }
  }

  function limparVigia() {
    if (vigia) { clearTimeout(vigia); vigia = null; }
  }

  function armarVigia(meuToken) {
    limparVigia();
    const ehYoutube = /youtube-stream/.test(urlAtual || "");
    vigia = setTimeout(() => {
      vigia = null;
      if (meuToken !== token || motor !== "audio") return;
      if (audio.readyState >= 3 || audio.currentTime > 0.25) return;
      if (audio.paused && !carregando) return;
      if (ehYoutube) {
        // O download pode ter sido bloqueado pelo autoplay: pausa e pede um toque.
        try { audio.pause(); } catch (_) {}
        carregando = false;
        erro = "toque";
        emitir();
        return;
      }
      falhar(new Error("tempo esgotado ao carregar o áudio"), meuToken);
    }, ehYoutube ? 15000 : 20000);
  }

  async function falhar(e, paraToken) {
    if (paraToken !== undefined && paraToken !== token) return;
    console.warn("[FOXify] falha ao tocar:", e);
    limparVigia();
    pararTimerYt();
    try { if (yt && yt.stopVideo) yt.stopVideo(); } catch (_) {}
    motor = "audio";
    mostrarYt(false);
    if (!audio.paused) audio.pause();
    carregando = false;
    erro = "nao-tocou";
    emitir();
    falhasSeguidas += 1;
    const meuToken = token;
    if (falhasSeguidas <= 2 && fila.length > 1) {
      setTimeout(() => {
        if (meuToken === token && erro) proxima(true);
      }, 1200);
    }
  }

  function parar() {
    definirFila([], -1, "");
    if ("mediaSession" in navigator) {
      try { navigator.mediaSession.playbackState = "none"; } catch (_) {}
    }
  }

  function tocarLista(lista, i, ctx) {
    const valida = (lista || []).filter(Boolean);
    if (!valida.length) return;
    fila = valida;
    contexto = ctx || "";
    carregar(Math.max(0, Math.min(i || 0, fila.length - 1)), true);
  }

  function definirFila(lista, i, ctx) {
    fila = (lista || []).filter(Boolean);
    contexto = ctx || "";
    indice = fila.length ? Math.max(0, Math.min(i || 0, fila.length - 1)) : -1;
    const faixa = fila[indice];
    token++;
    limparVigia();
    pararYt();
    motor = "audio";
    audio.pause();
    audio.removeAttribute("src");
    urlAtual = null;
    carregando = false;
    erro = null;
    midiaSessao(faixa);
    emitir();
  }

  function tocar() {
    if (!fila.length) return;
    if (motor === "youtube") {
      if (!yt) return carregar(indice, true);
      mostrarYt(true);
      try { yt.playVideo(); } catch (_) { return carregar(indice, true); }
      emitir();
      return;
    }
    if (!audio.src || indice < 0) return carregar(indice, true);
    if (erro === "nao-tocou") return carregar(indice, true);
    audio.play().then(() => { carregando = false; emitir(); }).catch(async (e) => {
      if (e && e.name === "NotAllowedError") { erro = "toque"; emitir(); }
      else await falhar(e);
    });
  }

  function alternar() {
    if (motor === "youtube") {
      if (!yt) return carregar(indice, true);
      let s = -1;
      try { s = yt.getPlayerState(); } catch (_) {}
      if (s === 1) yt.pauseVideo();
      else { mostrarYt(true); yt.playVideo(); }
      return;
    }
    if (carregando) return;
    if (audio.paused) tocar();
    else { audio.pause(); emitir(); }
  }

  function pausar() {
    if (motor === "youtube") {
      try { if (yt) yt.pauseVideo(); } catch (_) {}
      emitir();
      return;
    }
    audio.pause();
    emitir();
  }

  function proxima(manual) {
    if (!fila.length) return;
    if (!manual && repetir === "uma") {
      if (motor === "youtube") {
        try { yt.seekTo(0, true); yt.playVideo(); } catch (_) {}
      } else {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      }
      emitirProgresso(true);
      return;
    }
    let novo;
    if (aleatorio && fila.length > 1) {
      do { novo = Math.floor(Math.random() * fila.length); } while (novo === indice);
    } else if (indice + 1 < fila.length) {
      novo = indice + 1;
    } else if (manual || repetir === "todas") {
      novo = 0;
    } else {
      if (motor === "youtube") {
        try { if (yt) { yt.pauseVideo(); yt.seekTo(0, true); } } catch (_) {}
        mostrarYt(false);
      } else {
        audio.pause();
        audio.currentTime = 0;
      }
      emitir();
      return;
    }
    carregar(novo, true);
  }

  function anterior() {
    if (!fila.length) return;
    if (estado().tempo > 3.2) {
      buscarTempo(0);
      return;
    }
    if (aleatorio && fila.length > 1) {
      let novo;
      do { novo = Math.floor(Math.random() * fila.length); } while (novo === indice);
      return carregar(novo, true);
    }
    const novo = indice > 0 ? indice - 1 : fila.length - 1;
    carregar(novo, true);
  }

  function irPara(i) {
    if (i < 0 || i >= fila.length) return;
    if (i === indice) return alternar();
    carregar(i, true);
  }

  function buscarTempo(t) {
    if (motor === "youtube") {
      try { if (yt) yt.seekTo(Math.max(0, t), true); } catch (_) {}
      emitirProgresso(true);
      return;
    }
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
    audio.currentTime = Math.max(0, Math.min(t, audio.duration - 0.05));
    emitirProgresso(true);
  }

  function definirVolume(v, silencioso = false) {
    const valor = Math.max(0, Math.min(1, v));
    audio.volume = valor;
    audio.muted = false;
    if (motor === "youtube" && yt && yt.setVolume) {
      try { yt.setVolume(Math.round(valor * 100)); yt.unMute(); } catch (_) {}
    }
    if (!silencioso) emitir();
  }

  function alternarMudo() {
    if (motor === "youtube" && yt && yt.isMuted) {
      try { yt.isMuted() ? yt.unMute() : yt.mute(); } catch (_) {}
      emitir();
      return;
    }
    audio.muted = !audio.muted;
    emitir();
  }

  function alternarAleatorio() { aleatorio = !aleatorio; emitir(); }

  function alternarRepetir() {
    repetir = repetir === "off" ? "todas" : repetir === "todas" ? "uma" : "off";
    emitir();
  }

  function adicionarProxima(faixa) {
    if (!faixa) return;
    if (!fila.length) return tocarLista([faixa], 0, "Fila");
    fila.splice(indice + 1, 0, faixa);
    emitir();
  }

  function remover(i) {
    if (i < 0 || i >= fila.length) return;
    const eraAtual = i === indice;
    const estavaTocando = estado().tocando;
    fila.splice(i, 1);
    if (!fila.length) { definirFila([], -1, ""); return; }
    if (eraAtual) {
      indice = Math.min(indice, fila.length - 1);
      carregar(indice, estavaTocando);
    } else if (i < indice) {
      indice -= 1;
    }
    emitir();
  }

  function prepararElemento(a) {
    a.preload = "auto";
    a.referrerPolicy = "no-referrer";
    a.volume = audio ? audio.volume : 0.8;
    a.addEventListener("play", () => { if (a !== audio || motor !== "audio") return; atualizarMidia("playing"); emitir(); });
    a.addEventListener("pause", () => { if (a !== audio || motor !== "audio") return; atualizarMidia("paused"); if (!carregando) limparVigia(); emitir(); });
    a.addEventListener("waiting", () => { if (a !== audio || motor !== "audio") return; carregando = true; emitir(); });
    a.addEventListener("playing", () => {
      if (a !== audio || motor !== "audio") return;
      carregando = false; erro = null; falhasSeguidas = 0; limparVigia(); emitir();
    });
    a.addEventListener("loadedmetadata", () => { if (a !== audio || motor !== "audio") return; carregando = false; emitir(); emitirProgresso(true); });
    a.addEventListener("canplay", () => { if (a !== audio || motor !== "audio") return; if (carregando) { carregando = false; emitir(); } });
    a.addEventListener("timeupdate", () => { if (a !== audio || motor !== "audio") return; emitirProgresso(false); atualizarPosicao(); });
    a.addEventListener("ended", () => { if (a !== audio || motor !== "audio") return; proxima(false); });
    a.addEventListener("error", () => {
      if (a !== audio || motor !== "audio" || !a.src) return;
      if (carregando || !a.paused) falhar(a.error || new Error("Erro de mídia"), token);
    });
    a.addEventListener("durationchange", () => { if (a === audio && motor === "audio") emitirProgresso(true); });
    return a;
  }
  prepararElemento(audio);

  function atualizarMidia(tipo) {
    if ("mediaSession" in navigator) {
      try { navigator.mediaSession.playbackState = tipo; } catch (_) { /* ignora */ }
    }
  }

  if ("mediaSession" in navigator) {
    const acoes = {
      play: () => tocar(),
      pause: () => pausar(),
      previoustrack: () => anterior(),
      nexttrack: () => proxima(true),
      stop: () => pausar(),
      seekbackward: (d) => buscarTempo(estado().tempo - (d.seekOffset || 10)),
      seekforward: (d) => buscarTempo(estado().tempo + (d.seekOffset || 10)),
      seekto: (d) => buscarTempo(d.seekTime)
    };
    Object.entries(acoes).forEach(([nome, fn]) => {
      try { navigator.mediaSession.setActionHandler(nome, fn); } catch (_) { /* ação não suportada */ }
    });
  }

  function fecharYoutube() {
    try { if (yt) yt.pauseVideo(); } catch (_) {}
    mostrarYt(false);
    emitir();
  }

  function iniciarYoutube() {
    mostrarYt(true);
    try { if (yt) yt.playVideo(); } catch (_) {}
    const palco = document.getElementById("yt-palco");
    if (palco) palco.classList.remove("pendente");
    emitir();
  }

  window.FOXPlayer = {
    aoMudar, aoProgresso, estado, tocarLista, definirFila, parar, tocar, pausar, alternar,
    proxima, anterior, irPara, buscarTempo, definirVolume, alternarMudo,
    alternarAleatorio, alternarRepetir, adicionarProxima, remover,
    fecharYoutube, iniciarYoutube, prepararYoutube, faixaAtual: () => fila[indice] || null,
    get audio() { return audio; },
    ytAtivo: () => motor === "youtube",
    ytEstado: () => { try { return yt ? { estado: yt.getPlayerState(), tempo: yt.getCurrentTime(), dur: yt.getDuration() } : null; } catch (e) { return { erro: String(e) }; } }
  };
})();
