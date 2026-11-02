/* FOXify — interface, rotas, biblioteca e buscador de música livre. */
(function () {
  "use strict";

  const D = window.FOX_DADOS;
  const F = window.FOX_FONTES;
  const P = window.FOXPlayer;
  const CHAVE = "foxify.v1";
  const VERSAO = "1.6.9";

  const $ = (sel, raiz = document) => raiz.querySelector(sel);
  const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));

  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ico = (nome, classe = "") => `<svg class="icone ${classe}" aria-hidden="true"><use href="#i-${nome}"/></svg>`;
  const fmt = (s) => {
    if (!Number.isFinite(s) || s <= 0) return "--:--";
    const m = Math.floor(s / 60), r = Math.floor(s % 60);
    return m + ":" + String(r).padStart(2, "0");
  };
  const nMusicas = (n) => `${n} ${n === 1 ? "música" : "músicas"}`;
  const totalTempo = (lista) => (lista || []).reduce((a, t) => a + (Number(t.duracao) || 0), 0);
  const nomeFonte = (f) => (D.fontes[f] ? D.fontes[f].nome : "Fonte");
  const seloFonte = (f, extra = "") => {
    const info = D.fontes[f];
    if (!info) return "";
    return `<span class="selo selo--${f} ${extra}" title="${esc(info.desc)}">${esc(info.nome)}</span>`;
  };

  const CAPA_FALLBACK = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#0b1424"/><circle cx="80" cy="80" r="44" fill="none" stroke="#2b4a7a" stroke-width="2"/><path d="M92 52v52a12 12 0 1 1-6-10V62l26-6v38a12 12 0 1 1-6-10V48z" fill="#4f8dff"/></svg>');

  window.FOX_IMG_ERRO = function (img) {
    img.onerror = null;
    img.src = CAPA_FALLBACK;
  };

  /* --------------------------------------------------------------- estado */
  const modelo = {
    curtidas: [],
    playlists: [],
    historico: [],
    buscas: [],
    config: {
      volume: 0.8,
      acento: "azul",
      fontes: {
        youtube: true, deezer: false, itunes: false,
        audius: false, archive: false, jamendo: false
      },
      fontesVersao: 2,
      jamendoId: "",
      youtubeKey: "",
      servidor: "",
      instalacaoDispensada: false
    }
  };

  let estado = JSON.parse(JSON.stringify(modelo));
  let salvarTimer = null;
  let reconhecimentoVoz = null;
  let formOuvindo = null;
  let botaoOuvindo = null;

  function carregarEstado() {
    try {
      const bruto = JSON.parse(localStorage.getItem(CHAVE) || "null");
      if (bruto && typeof bruto === "object") {
        estado = {
          ...modelo, ...bruto,
          config: { ...modelo.config, ...(bruto.config || {}), fontes: { ...modelo.config.fontes, ...((bruto.config || {}).fontes || {}) } },
          curtidas: Array.isArray(bruto.curtidas) ? bruto.curtidas : [],
          playlists: Array.isArray(bruto.playlists) ? bruto.playlists : [],
          historico: Array.isArray(bruto.historico) ? bruto.historico : [],
          buscas: Array.isArray(bruto.buscas) ? bruto.buscas : []
        };
        // Migração: YouTube passa a ser o motor principal; Deezer/iTunes
        // ficam desligados por padrão para não disputarem a reprodução.
        if ((bruto.config || {}).fontesVersao !== 2) {
          estado.config.fontes = {
            ...estado.config.fontes,
            youtube: true, deezer: false, itunes: false
          };
          estado.config.fontesVersao = 2;
          setTimeout(() => salvar(), 0);
        }
      }
    } catch (e) { console.warn("Estado corrompido", e); }
  }

  function salvar() {
    clearTimeout(salvarTimer);
    salvarTimer = setTimeout(() => {
      try { localStorage.setItem(CHAVE, JSON.stringify(estado)); }
      catch (e) { console.warn("Não foi possível salvar", e); }
    }, 150);
  }

  const curtida = (chave) => estado.curtidas.some((t) => t.chave === chave);
  const coracao = (t, extra = "") => `
    <button class="btn-coracao ${curtida(t.chave) ? "ativo" : ""} ${extra}" data-acao="curtir"
      data-chave="${esc(t.chave)}" aria-pressed="${curtida(t.chave)}"
      aria-label="${curtida(t.chave) ? "Remover das favoritas" : "Curtir"}">${ico(curtida(t.chave) ? "coracao-cheio" : "coracao")}</button>`;

  const faixasPorChave = new Map();
  function guardarFaixa(t) {
    if (t && t.chave) faixasPorChave.set(t.chave, t);
    return t;
  }
  function obterFaixa(chave) {
    return faixasPorChave.get(chave) ||
      estado.curtidas.find((x) => x.chave === chave) ||
      (ultimoEstado.faixa && ultimoEstado.faixa.chave === chave ? ultimoEstado.faixa : null) ||
      null;
  }

  const REGISTRO = new Map();
  function registrarLista(ctx, lista, rotulo) {
    const arr = (lista || []).filter(Boolean).map(guardarFaixa);
    REGISTRO.set(ctx, { lista: arr, rotulo: rotulo || "" });
    return ctx;
  }

  /* --------------------------------------------------------------- avisos */
  function toast(msg, tipo = "info", ms = 3600) {
    const caixa = $("#toasts");
    if (!caixa) return;
    const div = document.createElement("div");
    div.className = "toast toast--" + tipo;
    const ic = tipo === "erro" ? "alerta" : tipo === "ok" ? "check" : "info";
    div.innerHTML = `${ico(ic)}<span>${esc(msg)}</span>`;
    caixa.appendChild(div);
    requestAnimationFrame(() => div.classList.add("visivel"));
    setTimeout(() => {
      div.classList.remove("visivel");
      setTimeout(() => div.remove(), 350);
    }, ms);
  }

  function abrirModal(html, classe = "") {
    const raiz = $("#modais");
    raiz.innerHTML = `<div class="modal-fundo" data-fechar-modal><div class="modal ${classe}" role="dialog" aria-modal="true">${html}</div></div>`;
    requestAnimationFrame(() => raiz.classList.add("aberto"));
    document.body.classList.add("sem-rolagem");
  }

  function fecharModal() {
    const raiz = $("#modais");
    raiz.classList.remove("aberto");
    if (!document.body.classList.contains("sheet-aberto")) document.body.classList.remove("sem-rolagem");
    setTimeout(() => { if (!raiz.classList.contains("aberto")) raiz.innerHTML = ""; }, 220);
  }

  /* ------------------------------------------------------------ miniaturas */
  const capaSegura = (t) => (t && t.capa) || "assets/img/capas/sua-musica.jpg";
  const imagem = (t, alt = "", classe = "") =>
    `<img class="${classe}" src="${esc(capaSegura(t))}" alt="${esc(alt)}" loading="lazy" onerror="FOX_IMG_ERRO(this)">`;

  const eq = `<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>`;

  function botaoPlayEstacao(est, st) {
    const ativa = st && st.faixa && st.contexto === est.nome && st.tocando;
    return `<button class="cartao__play ${ativa ? "ativo" : ""}" data-acao="tocar-estacao" data-id="${est.id}"
      aria-label="${ativa ? "Pausar" : "Tocar"} ${esc(est.nome)}">${ativa ? eq : ico("play")}</button>`;
  }

  function cartaoEstacao(est, st, destaque = false) {
    const ativa = st && st.faixa && st.contexto === est.nome && st.tocando;
    if (destaque) {
      return `<article class="cartao cartao--destaque ${ativa ? "tocando" : ""}" data-estacao="${est.id}"
        data-acao="abrir-playlist" data-id="${est.id}">
        ${imagem({ capa: est.capa }, est.nome, "cartao__fundo")}
        <span class="cartao__veu"></span>
        ${botaoPlayEstacao(est, st)}
        <div class="cartao__texto">
          <h3>${esc(est.nome)}</h3>
          <p>${esc(est.sub)}</p>
        </div>
        <span class="cartao__seta">${ico("seta-direita")}</span>
      </article>`;
    }
    return `<article class="cartao ${est.ref ? "cartao--ref" : ""} ${ativa ? "tocando" : ""}" data-estacao="${est.id}"
      data-acao="abrir-playlist" data-id="${est.id}">
      <div class="cartao__arte">
        ${imagem({ capa: est.capa }, est.nome)}
        ${botaoPlayEstacao(est, st)}
      </div>
      <div class="cartao__texto">
        <h3>${esc(est.nome)}</h3>
        <p>${esc(est.sub)}</p>
      </div>
    </article>`;
  }

  function cartaoFavoritas(st) {
    return `<article class="cartao cartao--ref" data-acao="abrir-rota" data-rota="#/playlist/favoritas">
      <div class="cartao__arte">
        ${imagem({ capa: "assets/img/capas/favoritas.jpg" }, "Favoritas")}
        <button class="cartao__play" data-acao="tocar-favoritas" aria-label="Tocar favoritas">${ico("play")}</button>
      </div>
      <div class="cartao__texto">
        <h3>Favoritas</h3>
        <p>Suas curtidas</p>
      </div>
    </article>`;
  }

  function linhaFaixa(t, i, ctx, st, opcoes = {}) {
    guardarFaixa(t);
    const ativa = st && st.faixa && st.faixa.chave === t.chave;
    return `<div class="faixa ${ativa ? "faixa--ativa" : ""} ${opcoes.remover ? "faixa--remover" : ""}" data-chave="${esc(t.chave)}" data-acao="tocar-linha"
      data-ctx="${esc(ctx)}" data-i="${i}" tabindex="0" role="button" aria-label="Tocar ${esc(t.titulo)}">
      <button class="faixa__play" aria-label="Tocar">${ativa && st.tocando ? eq : ico("play")}</button>
      ${imagem(t, "", "faixa__capa")}
      <div class="faixa__info">
        <strong>${esc(t.titulo)}</strong>
        <span>${esc(t.artista || "Artista desconhecido")}${t.genero ? " · " + esc(t.genero) : ""}${t.previa ? ` <em class="faixa__previa">prévia 30s</em>` : ""}</span>
      </div>
      ${seloFonte(t.fonte, "faixa__selo")}
      <span class="faixa__dur">${fmt(t.duracao)}</span>
      ${coracao(t, "faixa__acao")}
      <button class="btn-icone faixa__acao" data-acao="menu-faixa" data-chave="${esc(t.chave)}"
        aria-label="Mais opções">${ico("pontos")}</button>
      ${opcoes.remover ? `<button class="btn-icone faixa__acao" data-acao="remover-playlist" data-chave="${esc(t.chave)}"
        aria-label="Remover da playlist">${ico("lixeira")}</button>` : ""}
    </div>`;
  }

  /* ---------------------------------------------------------------- cromo */
  function estadoVazioPlayer() {
    return `<div class="tocando-vazio">${ico("disco")}<p>Escolha uma estação<br>para começar</p></div>`;
  }

  function controlesPlayer(st, compacto = false) {
    return `<div class="controles ${compacto ? "controles--compacto" : ""}">
      <button class="btn-icone ${st.aleatorio ? "ativo" : ""}" data-acao="aleatorio" aria-label="Aleatório" aria-pressed="${st.aleatorio}">${ico("aleatorio")}</button>
      <button class="btn-icone" data-acao="anterior" aria-label="Anterior">${ico("anterior")}</button>
      <button class="btn-play ${st.carregando ? "carregando" : ""}" data-acao="alternar" aria-label="${st.tocando ? "Pausar" : "Tocar"}">
        ${st.carregando ? `<span class="girando"></span>` : ico(st.tocando ? "pause" : "play")}
      </button>
      <button class="btn-icone" data-acao="proxima" aria-label="Próxima">${ico("proxima")}</button>
      <button class="btn-icone controle-parar" data-acao="parar" aria-label="Parar e fechar o player">${ico("parar")}</button>
      <button class="btn-icone ${st.repetir !== "off" ? "ativo" : ""}" data-acao="repetir" aria-label="Repetir" aria-pressed="${st.repetir !== "off"}">
        ${ico(st.repetir === "uma" ? "repetir-um" : "repetir")}
      </button>
    </div>`;
  }

  function barraProgresso(st, comTempos = true) {
    const dur = st.duracao || 0;
    const val = dur ? Math.min(1000, Math.round((st.tempo / dur) * 1000)) : 0;
    return `<div class="progresso ${comTempos ? "" : "progresso--simples"}">
      <button class="pulo" data-acao="voltar-30" aria-label="Voltar 30 segundos" title="Voltar 30s">${ico("voltar-30")}</button>
      ${comTempos ? `<span class="js-tempo">${fmt(st.tempo)}</span>` : ""}
      <input type="range" min="0" max="1000" step="1" value="${val}" data-range="tempo"
        aria-label="Progresso da música" ${dur ? "" : "disabled"}>
      ${comTempos ? `<span class="js-duracao">${fmt(dur)}</span>` : ""}
      <button class="pulo" data-acao="avancar-30" aria-label="Avançar 30 segundos" title="Avançar 30s">${ico("avancar-30")}</button>
    </div>`;
  }

  function filaItens(st, limite = 5) {
    if (!st.fila.length) return `<p class="mini-vazio">A fila está vazia.</p>`;
    let inicio = Math.max(0, st.indice + 1);
    let itens = st.fila.slice(inicio, inicio + limite);
    if (st.indice === st.fila.length - 1) itens = st.fila.slice(0, Math.min(limite, st.fila.length));
    return itens.map((t, k) => {
      const idx = st.fila.indexOf(t);
      return `<button class="fila-item ${idx === st.indice ? "atual" : ""}" data-acao="tocar-fila" data-i="${idx}">
        ${imagem(t, "", "fila-item__capa")}
        <span class="fila-item__info"><strong>${esc(t.titulo)}</strong><span>${esc(t.artista || "")}</span></span>
        <span class="fila-item__dur">${fmt(t.duracao)}</span>
      </button>`;
    }).join("");
  }

  function renderizarLateral(st) {
    const alvo = $("#lateral");
    if (!alvo) return;
    if (!st.faixa) {
      alvo.innerHTML = estadoVazioPlayer();
      return;
    }
    alvo.innerHTML = `
      <div class="tocando-arte">
        ${imagem(st.faixa, st.faixa.titulo)}
        <span class="audio-onda">${ico("onda")}</span>
      </div>
      <div class="tocando-cabeca">
        <div><h2>${esc(st.faixa.titulo)}</h2><p>${esc(st.faixa.artista || "")}</p></div>
        ${coracao(st.faixa)}
      </div>
      ${barraProgresso(st)}
      ${controlesPlayer(st)}
      <div class="fila-topo">
        <h3>Fila de reprodução</h3>
        <button class="link" data-acao="abrir-fila">Ver tudo</button>
      </div>
      <div class="fila-lista">${filaItens(st, 5)}</div>`;
  }

  function renderizarBarra(st) {
    const alvo = $("#barra");
    if (!alvo) return;
    if (!st.faixa) {
      alvo.classList.add("barra--oculta");
      alvo.innerHTML = "";
      return;
    }
    alvo.classList.remove("barra--oculta");
    alvo.innerHTML = `
      <div class="barra__faixa">
        ${imagem(st.faixa, "", "barra__capa")}
        <div class="barra__texto"><strong>${esc(st.faixa.titulo)}</strong><span>${esc(st.faixa.artista || "")}</span></div>
        ${coracao(st.faixa)}
      </div>
      <div class="barra__centro">
        ${controlesPlayer(st)}
        ${barraProgresso(st)}
      </div>
      <div class="barra__acoes">
        <button class="btn-icone" data-acao="mudo" aria-label="Mudo">${ico(st.mudo ? "volume-mudo" : "volume")}</button>
        <input type="range" min="0" max="100" value="${Math.round((st.mudo ? 0 : st.volume) * 100)}" data-range="volume" aria-label="Volume">
        <button class="btn-icone" data-acao="abrir-fila" aria-label="Fila">${ico("fila")}</button>
        <button class="btn-icone" data-acao="compartilhar" aria-label="Compartilhar">${ico("compartilhar")}</button>
      </div>`;
  }

  function renderizarMini(st) {
    const alvo = $("#mini");
    if (!alvo) return;
    if (!st.faixa) {
      alvo.classList.add("mini--oculta");
      alvo.innerHTML = "";
      alvo.removeAttribute("data-abrir");
      return;
    }
    alvo.classList.remove("mini--oculta");
    const pct = st.duracao ? Math.min(100, (st.tempo / st.duracao) * 100) : 0;
    alvo.innerHTML = `
      <div class="mini__progresso"><span style="width:${pct}%"></span></div>
      <button class="mini__faixa" data-acao="abrir-tocando" aria-label="Abrir player">
        ${imagem(st.faixa, "", "mini__capa")}
        <span class="mini__texto"><strong>${esc(st.faixa.titulo)}</strong><span>${esc(st.faixa.artista || "")}</span></span>
      </button>
      <div class="mini__botoes">
        ${coracao(st.faixa, "mini__coracao")}
        <button class="btn-icone" data-acao="alternar" aria-label="${st.tocando ? "Pausar" : "Tocar"}">
          ${st.carregando ? `<span class="girando"></span>` : ico(st.tocando ? "pause" : "play")}
        </button>
        <button class="btn-icone" data-acao="proxima" aria-label="Próxima">${ico("proxima")}</button>
        <button class="btn-icone controle-parar" data-acao="parar" aria-label="Parar e fechar">${ico("parar")}</button>
      </div>`;
  }

  function renderizarSheet(st) {
    const alvo = $("#sheet-conteudo");
    if (!alvo) return;
    if (!st.faixa) {
      alvo.innerHTML = `<div class="sheet__topo"><button class="btn-icone" data-acao="fechar-tocando" aria-label="Fechar">${ico("seta-baixo")}</button><span>Tocando agora</span><span></span></div>${estadoVazioPlayer()}`;
      return;
    }
    const fonte = st.faixa.permalink
      ? `<a class="link-fonte" href="${esc(st.faixa.permalink)}" target="_blank" rel="noopener">${seloFonte(st.faixa.fonte)} ${ico("externo")}</a>`
      : seloFonte(st.faixa.fonte);
    alvo.innerHTML = `
      <div class="sheet__topo">
        <button class="btn-icone" data-acao="fechar-tocando" aria-label="Fechar">${ico("seta-baixo")}</button>
        <span>${esc(st.contexto || "Tocando agora")}</span>
        <button class="btn-icone" data-acao="menu-faixa" data-chave="${esc(st.faixa.chave)}" aria-label="Mais">${ico("pontos")}</button>
      </div>
      <div class="sheet__arte">${imagem(st.faixa, st.faixa.titulo)}</div>
      <div class="sheet__cabeca">
        <div><h2>${esc(st.faixa.titulo)}</h2><p>${esc(st.faixa.artista || "")}</p></div>
        ${coracao(st.faixa)}
      </div>
      ${barraProgresso(st)}
      ${controlesPlayer(st)}
      <div class="sheet__fonte">${fonte}</div>
      <div class="sheet__fila">
        <div class="sheet__fila-topo"><h3>A seguir</h3><button class="link" data-acao="abrir-fila">Fila completa</button></div>
        <div class="fila-lista">${filaItens(st, 6)}</div>
      </div>`;
  }

  let ultimoEstado = P.estado();

  function sincronizarMidiaNativa(st) {
    try {
      if (!window.FOX_ANDROID) return;
      if (st && st.faixa) {
        window.FOX_ANDROID.atualizarMidia(
          st.faixa.titulo || "FOXify",
          st.faixa.artista || "",
          !!st.tocando
        );
      } else {
        window.FOX_ANDROID.pararMidia();
      }
    } catch (_) { /* fora do APK WebView */ }
  }

  function renderizarCromo(st) {
    ultimoEstado = st;
    renderizarLateral(st);
    renderizarBarra(st);
    renderizarMini(st);
    renderizarSheet(st);
    marcarAtivos(st);
    atualizarProgresso(st);
    sincronizarMidiaNativa(st);
    document.body.classList.toggle("tocando-agora", !!st.faixa && st.tocando);
  }

  function marcarAtivos(st) {
    $$("[data-chave]").forEach((el) => {
      const ativo = st.faixa && el.dataset.chave === st.faixa.chave;
      el.classList.toggle("faixa--ativa", !!ativo);
      const play = el.querySelector(".faixa__play, .btn-play");
      if (play && el.classList.contains("faixa")) {
        play.innerHTML = ativo && st.tocando ? eq : ico("play");
      }
    });
    $$("[data-estacao]").forEach((el) => {
      const ativo = st.faixa && st.contexto === (D.porId[el.dataset.estacao] || {}).nome;
      el.classList.toggle("tocando", !!ativo && st.tocando);
      const btn = el.querySelector(".cartao__play");
      if (btn) {
        btn.classList.toggle("ativo", !!ativo && st.tocando);
        btn.innerHTML = ativo && st.tocando ? eq : ico("play");
      }
    });
  }

  function atualizarProgresso(st) {
    const dur = st.duracao || 0;
    const pct = dur ? Math.min(100, (st.tempo / dur) * 100) : 0;
    $$('[data-range="tempo"]').forEach((input) => {
      if (document.activeElement !== input) input.value = dur ? Math.round((st.tempo / dur) * 1000) : 0;
      input.disabled = !dur;
      input.style.setProperty("--p", pct.toFixed(2) + "%");
    });
    $$('[data-range="volume"], [data-range="volume-config"]').forEach((input) => {
      input.style.setProperty("--p", Number(input.value) + "%");
    });
    $$(".js-tempo").forEach((el) => { el.textContent = fmt(st.tempo); });
    $$(".js-duracao").forEach((el) => { el.textContent = fmt(dur); });
    $$(".mini__progresso span").forEach((el) => {
      el.style.width = pct + "%";
    });
    if (document.body.classList.contains("sheet-aberto")) {
      // mantém o sheet sincronizado sem re-renderizar
      const el = $("#sheet-conteudo");
      if (el) el.classList.toggle("pausado", !st.tocando);
    }
  }

  function atualizarCoracoes() {
    $$('[data-acao="curtir"]').forEach((btn) => {
      const ativo = curtida(btn.dataset.chave);
      btn.classList.toggle("ativo", ativo);
      btn.setAttribute("aria-pressed", String(ativo));
      btn.innerHTML = ico(ativo ? "coracao-cheio" : "coracao");
    });
  }

  /* --------------------------------------------------------------- parser */
  function parametros() {
    const h = location.hash.replace(/^#/, "") || "/inicio";
    const [caminho, consulta] = h.split("?");
    const partes = caminho.split("/").filter(Boolean);
    return { caminho, partes, rota: partes[0] || "inicio", id: partes[1] || "", params: new URLSearchParams(consulta || "") };
  }

  let rotaAtual = "";

  function atualizarNav() {
    const { rota, id } = parametros();
    const chaveRota = rota + (rota === "playlist" ? "/" + id : "");
    $$("[data-rota]").forEach((el) => {
      const alvo = (el.getAttribute("data-rota") || "").replace(/^#\//, "");
      el.classList.toggle("ativo", alvo === chaveRota || (rota === "inicio" && alvo === "inicio"));
    });
    $$(".tabbar__item").forEach((el) => {
      const alvo = (el.getAttribute("data-rota") || "").replace(/^#\//, "").split("?")[0];
      const ativo = alvo === rota || (alvo === "playlists" && (rota === "playlist" && id.startsWith("u:")));
      el.classList.toggle("ativo", ativo);
    });
  }

  /* ---------------------------------------------------------------- home */
  function saudacao() {
    const h = new Date().getHours();
    return h < 12 ? "Bom dia," : h < 18 ? "Boa tarde," : "Boa noite,";
  }

  function avisoInstalacao() {
    if (!promptInstalar || estado.config.instalacaoDispensada) return "";
    return `<div class="aviso-instalar">
      <span class="aviso-instalar__icone">${ico("celular")}</span>
      <div><strong>Instale o FOXify no celular</strong><span>Abre em tela cheia e funciona offline.</span></div>
      <button class="btn btn--primario btn--pequeno" data-acao="instalar">Instalar</button>
      <button class="btn-icone" data-acao="dispensar-instalar" aria-label="Dispensar">${ico("fechar")}</button>
    </div>`;
  }

  function vistaInicio() {
    const st = ultimoEstado;
    const destaque = D.estacoes.find((e) => e.id === "top50-brasil");
    const secundarias = ["mood-chill", "rock-antigo", "hip-hop-2025"].map((id) => D.porId[id]).filter(Boolean);
    const mixes = ["indie-vibes", "eletronica-sem-limites", "mpb-essencial", "rock-nacional",
      "musicas-romanticas", "classicos-70-80-90", "rock-classico", "rap-nacional",
      "lofi-beats", "rock-alternativo", "sertanejo-top"]
      .map((id) => D.porId[id]).filter(Boolean);
    const fontes = FONTES_ORDEM.map((f) => ({ ...D.fontes[f], id: f }));

    const recentes = estado.historico.slice(0, 6);
    return `
      <header class="saudacao">
        <div>
          <h1>${saudacao()}</h1>
          <p>Que a música te acompanhe hoje!</p>
        </div>
        <a class="saudacao__perfil" href="#/config" aria-label="Ajustes">
          <img src="assets/img/avatar.jpg" alt="" onerror="FOX_IMG_ERRO(this)">
        </a>
      </header>

      <div class="busca-atalho-wrap">
        <button class="busca-atalho" data-rota="#/suamusica">
          ${ico("busca")}
          <span>Buscar em sites de música grátis…</span>
          <span class="busca-atalho__fonte">${ico("globo")}</span>
        </button>
        <button type="button" class="btn-voz btn-voz--atalho" data-acao="busca-voz-home" aria-label="Buscar por voz" title="Buscar por voz">${ico("microfone")}</button>
      </div>

      ${avisoInstalacao()}

      <section class="secao">
        <div class="secao__topo">
          <h2>${ico("onda")} Tocando agora</h2>
          <a class="link" href="#/suamusica">Ver mais ${ico("seta-direita")}</a>
        </div>
        <div class="grade-destaques">
          ${cartaoEstacao(destaque, st, true)}
          ${secundarias.map((e) => cartaoEstacao(e, st)).join("")}
        </div>
      </section>

      <section class="secao">
        <div class="secao__topo">
          <h2>${ico("faisca")} Feito para você</h2>
          <a class="link" href="#/biblioteca">Ver mais ${ico("seta-direita")}</a>
        </div>
        <div class="grade-mixes">
          ${mixes.map((e) => cartaoEstacao(e, st)).join("")}
          ${cartaoFavoritas(st)}
        </div>
      </section>

      <section class="secao">
        <div class="secao__topo">
          <h2>${ico("globo")} Sua música</h2>
          <a class="link" href="#/suamusica">Abrir buscador ${ico("seta-direita")}</a>
        </div>
        <div class="cartoes-fonte cartoes-fonte--home">
          ${fontes.map((f) => `<button class="fonte-card" data-acao="abrir-fonte" data-fonte="${f.id}">
            <span class="fonte-card__icone" style="--cor:${f.cor}">${iconeFonte(f.id)}</span>
            <span class="fonte-card__texto"><strong>${esc(f.nome)}</strong><small>${esc(f.desc)}</small></span>
            <span class="fonte-card__seta">${ico("seta-direita")}</span>
          </button>`).join("")}
        </div>
      </section>

      ${recentes.length ? `<section class="secao">
        <div class="secao__topo"><h2>${ico("relogio")} Continuar ouvindo</h2>
          <button class="link" data-acao="limpar-historico">Limpar</button></div>
        <div class="lista-faixas">${registrarLista("historico-inicio", recentes, "Tocadas recentemente") && recentes.map((t, i) => linhaFaixa(t, i, "historico-inicio", st)).join("")}</div>
      </section>` : ""}

      <section class="secao secao--playlists">
        <div class="secao__topo"><h2>${ico("lista")} Suas playlists</h2>
          <a class="link" href="#/playlists">Ver tudo ${ico("seta-direita")}</a></div>
        <div class="grade-playlists">
          ${D.playlistsBarra.map((p) => {
            const destino = p.rota || "#/playlist/" + p.id;
            return `<a class="mini-playlist" href="${destino}">
            <img src="${p.capa}" alt="" loading="lazy" onerror="FOX_IMG_ERRO(this)">
            <span><strong>${esc(p.nome)}</strong><small>${esc(p.sub)}</small></span>
          </a>`;
          }).join("")}
        </div>
      </section>`;
  }

  /* -------------------------------------------------------------- buscar */
  function fonteAtiva(f) { return estado.config.fontes[f] !== false; }
  const FONTES_ORDEM = ["youtube", "deezer", "itunes"];
  function fontesAtivas() { return FONTES_ORDEM.filter(fonteAtiva); }
  const iconeFonte = (f) => ico(f === "archive" ? "nuvem" : f === "jamendo" ? "globo" :
    f === "youtube" ? "play" : f === "deezer" ? "nota" : f === "itunes" ? "cast" : "onda");

  function chipsFontes(filtro, prefixo = "filtro") {
    const opcoes = [{ id: "tudo", nome: "Tudo" }].concat(
      FONTES_ORDEM.map((f) => ({ id: f, nome: D.fontes[f].nome })));
    return `<div class="chips" role="tablist">
      ${opcoes.map((o) => `<button class="chip ${filtro === o.id ? "ativo" : ""}" data-acao="${prefixo}"
        data-filtro="${o.id}" role="tab" aria-selected="${filtro === o.id}">${o.nome}</button>`).join("")}
    </div>`;
  }

  function sugestoesHtml() {
    return `<div class="chips chips--sugestoes">
      ${D.sugestoes.map((s) => `<button class="chip chip--sugestao" data-acao="sugestao" data-termo="${esc(s)}">${esc(s)}</button>`).join("")}
    </div>`;
  }

  function vistaBuscar() {
    const { params } = parametros();
    const q = params.get("q") || "";
    const buscando = buscaEstado.carregando;
    return `
      <header class="pagina-topo">
        <h1>Buscar</h1>
        <p>Músicas, artistas e playlists — no catálogo e nas fontes livres.</p>
      </header>
      <form class="busca busca--grande" data-form="busca-pagina" role="search">
        ${ico("busca")}
        <input type="search" name="q" id="busca-pagina-input" value="${esc(q)}"
          placeholder="Buscar músicas, artistas, álbuns e playlists..." autocomplete="off" enterkeyhint="search">
        <button type="button" class="btn-voz" data-acao="busca-voz" aria-label="Buscar por voz" title="Buscar por voz">${ico("microfone")}</button>
        <button type="submit" class="btn btn--primario btn--pequeno">Buscar</button>
      </form>
      ${buscaModosHtml()}
      ${buscaEstado.modo === "faixas" ? chipsFontes(buscaEstado.filtro) : ""}
      <div id="resultados-buscar" class="resultados">
        ${buscaEstado.view === "buscar" && buscaEstado.termo ? resultadosHtml() : `
          <section class="secao secao--compacta">
            <div class="secao__topo"><h2>${ico("faisca")} Sugestões</h2></div>
            ${sugestoesHtml()}
          </section>
          ${estado.buscas.length ? `<section class="secao secao--compacta">
            <div class="secao__topo"><h2>${ico("relogio")} Buscas recentes</h2>
              <button class="link" data-acao="limpar-buscas">Limpar</button></div>
            <div class="chips">${estado.buscas.map((b) => `<button class="chip" data-acao="sugestao" data-termo="${esc(b)}">${esc(b)}</button>`).join("")}</div>
          </section>` : ""}
          <section class="secao secao--compacta">
            <div class="secao__topo"><h2>${ico("globo")} Fontes de música grátis</h2></div>
            <div class="cartoes-fonte cartoes-fonte--home">
              ${FONTES_ORDEM.map((f) => `<button class="fonte-card" data-acao="abrir-fonte" data-fonte="${f}">
                <span class="fonte-card__icone" style="--cor:${D.fontes[f].cor}">${iconeFonte(f)}</span>
                <span class="fonte-card__texto"><strong>${esc(D.fontes[f].nome)}</strong><small>${esc(D.fontes[f].desc)}</small></span>
                <span class="fonte-card__seta">${ico("seta-direita")}</span>
              </button>`).join("")}
            </div>
          </section>`}
      </div>
      ${buscando ? "" : ""}`;
  }

  function vistaSuaMusica() {
    const buscando = buscaEstado.carregando;
    const compacta = buscaEstado.view === "suamusica" && !!buscaEstado.termo;
    return `
      <header class="pagina-topo pagina-topo--hero ${compacta ? "pagina-topo--compacta" : ""}">
        <span class="etiqueta">${ico("faisca")} Música grátis e legal</span>
        <h1>Sua música</h1>
        <p>Um buscador. Três sites grátis. Tudo toca aqui dentro, sem sair do app.</p>
      </header>

      <form class="busca busca--grande busca--livre" data-form="busca-livre" role="search">
        ${ico("globo")}
        <input type="search" name="q" id="busca-livre-input" value="${esc(buscaEstado.view === "suamusica" ? buscaEstado.termo : "")}"
          placeholder="Buscar em sites de música grátis..." autocomplete="off" enterkeyhint="search">
        <button type="button" class="btn-voz" data-acao="busca-voz" aria-label="Buscar por voz" title="Buscar por voz">${ico("microfone")}</button>
        <button type="submit" class="btn btn--primario">${ico("busca")} Buscar</button>
      </form>
      ${buscaModosHtml()}
      ${buscaEstado.modo === "faixas" ? `<p class="nota motor-nota">${ico("play")} Motor principal: <strong>YouTube</strong>. Deezer e iTunes são opcionais — ligue ou desligue nos chips abaixo.</p>` : ""}
      <div class="estado-fontes">
        ${FONTES_ORDEM.map((f) => {
          const ativa = fonteAtiva(f);
          return `<button class="fonte-chip ${ativa ? "ativa" : ""}"
            data-acao="alternar-fonte" data-fonte="${f}" title="${esc(D.fontes[f].desc)}">
            <span class="ponto" style="--cor:${D.fontes[f].cor}"></span>
            ${esc(D.fontes[f].nome)}
          </button>`;
        }).join("")}
        <span class="estado-rede ${navigator.onLine ? "" : "offline"}">${ico(navigator.onLine ? "wifi" : "wifi-off")} ${navigator.onLine ? "online" : "offline"}</span>
      </div>

      <div id="resultados-suamusica" class="resultados">
        ${buscaEstado.view === "suamusica" && buscaEstado.termo ? resultadosHtml() : `
          <section class="secao secao--compacta">
            <div class="secao__topo"><h2>${ico("faisca")} Comece por aqui</h2></div>
            ${sugestoesHtml()}
          </section>
          <section class="secao secao--compacta">
            <div class="secao__topo"><h2>${ico("globo")} Fontes conectadas</h2><span class="nota">3 catálogos</span></div>
            <div class="cartoes-fonte fontes-lista">
              ${FONTES_ORDEM.map((f) => `<div class="fonte-card fonte-card--estatica">
                <span class="fonte-card__icone" style="--cor:${D.fontes[f].cor}">${iconeFonte(f)}</span>
                <span class="fonte-card__texto"><strong>${esc(D.fontes[f].nome)}</strong>
                  <small>${esc(D.fontes[f].desc)}${D.fontes[f].requerProxy ? " · via servidor local" : ""}</small></span>
                <span class="fonte-card__estado">${fonteAtiva(f) ? "ativa" : "off"}</span>
              </div>`).join("")}
            </div>
          </section>
          <section class="como-funciona">
            <h2>${ico("info")} Como funciona</h2>
            <ol>
              <li><strong>Você busca</strong> uma música, artista ou estilo.</li>
              <li><strong>O FOXify consulta</strong> YouTube, Deezer e iTunes ao mesmo tempo.</li>
              <li><strong>O play é aqui:</strong> o áudio toca no player do app, com fila, favoritos e segundo plano.</li>
            </ol>
            <p>O app não hospeda músicas: ele apenas busca e reproduz o que esses sites oferecem, respeitando as licenças e os termos de cada um. Os três motores passam pelo servidor local do FOXify.</p>
          </section>
          ${estado.buscas.length ? `<section class="secao secao--compacta">
            <div class="secao__topo"><h2>${ico("relogio")} Suas buscas</h2><button class="link" data-acao="limpar-buscas">Limpar</button></div>
            <div class="chips">${estado.buscas.map((b) => `<button class="chip" data-acao="sugestao" data-termo="${esc(b)}">${esc(b)}</button>`).join("")}</div>
          </section>` : ""}
        `}
      </div>`;
  }

  /* ------------------------------------------------------------ busca/resultados */
  const buscaEstado = {
    termo: "", view: "", carregando: false, porFonte: [], filtro: "tudo", quando: 0, lista: [],
    modo: "faixas", albuns: [], albumAberto: null
  };

  function buscaModosHtml() {
    const m = buscaEstado.modo;
    return `<div class="busca-modos" role="tablist" aria-label="Tipo de busca">
      <button class="busca-modo ${m === "faixas" ? "ativo" : ""}" role="tab" aria-selected="${m === "faixas"}"
        data-acao="modo-busca" data-modo="faixas">${ico("nota")} Músicas</button>
      <button class="busca-modo ${m === "albuns" ? "ativo" : ""}" role="tab" aria-selected="${m === "albuns"}"
        data-acao="modo-busca" data-modo="albuns">${ico("lista")} Álbuns</button>
    </div>`;
  }

  function albumEscolhido(chave) {
    return buscaEstado.albuns.find((a) => a.chave === chave) || null;
  }

  function albumDetalheHtml() {
    const d = buscaEstado.albumAberto;
    if (!d) return "";
    const a = d.album;
    const capa = a.capa
      ? `<img src="${esc(a.capa)}" alt="${esc(a.titulo)}" onerror="FOX_IMG_ERRO(this)">`
      : `<span class="album-hero__vazio">${ico("nota")}</span>`;
    let corpo = "";
    if (d.carregando) {
      corpo = `<div class="esqueleto-linhas">${Array.from({ length: 6 }).map(() => `<div class="esqueleto"></div>`).join("")}</div>`;
    } else if (!d.faixas.length) {
      corpo = `<div class="vazio">${ico("nota")}<h3>Álbum sem faixas disponíveis</h3><p>Tente outro álbum ou outra fonte.</p></div>`;
    } else {
      registrarLista("album:" + a.chave, d.faixas, a.titulo);
      d.faixas.forEach(guardarFaixa);
      corpo = `<div class="lista-faixas">${d.faixas.map((t, i) =>
        linhaFaixa(t, i, "album:" + a.chave, ultimoEstado)).join("")}</div>`;
    }
    return `<div class="album-detalhe">
      <button class="link album-voltar" data-acao="voltar-albuns">${ico("seta-esquerda")} Voltar aos álbuns</button>
      <div class="album-hero">
        <div class="album-hero__arte">${capa}</div>
        <div class="album-hero__info">
          <span class="resultados__termo">Álbum · ${esc(nomeFonte(a.fonte))}</span>
          <h1>${esc(a.titulo)}</h1>
          <p>${esc(a.artista)}${a.ano ? " · " + esc(a.ano) : ""}${a.total ? " · " + a.total + " faixas" : ""}</p>
          <p class="nota">Faixas reproduzidas pelo motor do YouTube.</p>
          <div class="album-hero__acoes">
            <button class="btn btn--primario" data-acao="tocar-album" ${d.faixas.length ? "" : "disabled"}>${ico("play")} Tocar álbum</button>
            ${a.permalink ? `<a class="btn btn--fantasma" href="${esc(a.permalink)}" target="_blank" rel="noopener">${ico("externo")} Abrir na fonte</a>` : ""}
          </div>
        </div>
      </div>
      ${corpo}
    </div>`;
  }

  function resultadosAlbunsHtml() {
    if (buscaEstado.carregando) {
      return `<div class="secao secao--compacta">
        <div class="secao__topo"><h2>${ico("onda")} Buscando álbuns de “${esc(buscaEstado.termo)}”…</h2></div>
        <div class="grade-albuns">${Array.from({ length: 8 }).map(() => `<div class="album-card album-card--esqueleto"><div class="esqueleto"></div><div class="esqueleto esqueleto--curto"></div></div>`).join("")}</div>
      </div>`;
    }
    if (buscaEstado.albumAberto) return albumDetalheHtml();
    if (!buscaEstado.albuns.length) {
      return `<div class="vazio">${ico("lista")}
        <h3>Nenhum álbum encontrado para “${esc(buscaEstado.termo)}”</h3>
        <p>Tente o nome do cantor ou da banda. A busca de álbuns usa Deezer e iTunes.</p>
        <button class="btn btn--fantasma" data-acao="modo-busca" data-modo="faixas">${ico("nota")} Buscar músicas</button>
      </div>`;
    }
    return `<div class="resultados__topo">
        <div><span class="resultados__termo">Álbuns de “${esc(buscaEstado.termo)}”</span>
        <span class="resultados__total">${buscaEstado.albuns.length} ${buscaEstado.albuns.length === 1 ? "álbum" : "álbuns"}</span>
        <span class="nota">Catálogo: Deezer/iTunes · áudio pelo YouTube</span></div>
      </div>
      <div class="grade-albuns">${buscaEstado.albuns.map((a) => `<button class="album-card" data-acao="abrir-album" data-chave="${esc(a.chave)}">
        <span class="album-card__arte">${a.capa ? `<img src="${esc(a.capa)}" alt="${esc(a.titulo)}" loading="lazy" onerror="FOX_IMG_ERRO(this)">` : `<span class="album-card__vazio">${ico("nota")}</span>`}</span>
        <strong>${esc(a.titulo)}</strong>
        <small>${esc(a.artista)}${a.ano ? " · " + esc(a.ano) : ""}</small>
        <span class="album-card__fonte">${seloFonte(a.fonte)}</span>
      </button>`).join("")}</div>`;
  }

  async function abrirAlbum(chave) {
    const a = albumEscolhido(chave);
    if (!a) return;
    buscaEstado.albumAberto = { album: a, faixas: [], carregando: true, erro: false };
    renderizarResultados();
    try {
      const faixas = await F.faixasDoAlbum(a.fonte, a.idFonte);
      const atual = buscaEstado.albumAberto;
      if (!atual || atual.album.chave !== chave) return;
      atual.faixas = faixas;
      atual.carregando = false;
      atual.erro = false;
      renderizarResultados();
      if (!faixas.length) toast("Este álbum não tem faixas disponíveis.", "info");
    } catch (_) {
      const atual = buscaEstado.albumAberto;
      if (!atual || atual.album.chave !== chave) return;
      atual.carregando = false;
      atual.erro = true;
      renderizarResultados();
      toast("Não foi possível carregar as faixas deste álbum.", "erro");
    }
  }

  function tocarAlbumAberto(i = 0) {
    const d = buscaEstado.albumAberto;
    if (!d || !d.faixas.length) return;
    P.tocarLista(d.faixas.slice(), Math.max(0, Math.min(i, d.faixas.length - 1)), d.album.titulo);
    toast(`Tocando “${d.album.titulo}” · ${d.faixas.length} faixas`, "ok", 2200);
  }

  function resultadosHtml() {
    if (buscaEstado.modo === "albuns") return resultadosAlbunsHtml();    if (buscaEstado.carregando) {
      return `<div class="secao secao--compacta">
        <div class="secao__topo"><h2>${ico("onda")} Buscando “${esc(buscaEstado.termo)}”…</h2></div>
        <div class="esqueleto-linhas">${Array.from({ length: 6 }).map(() => `<div class="esqueleto"></div>`).join("")}</div>
      </div>`;
    }
    if (!buscaEstado.porFonte.length) return "";
    const total = buscaEstado.porFonte.reduce((a, r) => a + r.itens.length, 0);
    const comErro = buscaEstado.porFonte.filter((r) => r.erro);
    const visiveis = buscaEstado.filtro === "tudo" ? buscaEstado.porFonte : buscaEstado.porFonte.filter((r) => r.fonte === buscaEstado.filtro);
    const itensVisiveis = visiveis.reduce((a, r) => a + r.itens.length, 0);
    const listaPlana = [];
    visiveis.forEach((r) => r.itens.forEach((t) => listaPlana.push(t)));
    buscaEstado.lista = listaPlana;
    registrarLista("busca", listaPlana, "Resultados");
    listaPlana.forEach(guardarFaixa);

    let corpo = "";
    if (!itensVisiveis) {
      corpo = `<div class="vazio">
        ${ico("busca")}
        <h3>Nada encontrado para “${esc(buscaEstado.termo)}”</h3>
        <p>Tente outro termo, ative mais fontes ou ouça uma demonstração local.</p>
        <div class="vazio__acoes">
          <button class="btn btn--primario" data-acao="tocar-demos">${ico("play")} Tocar demonstração</button>
          <a class="btn btn--fantasma" href="#/inicio">Explorar estações</a>
        </div>
      </div>`;
    } else {
      let idx = 0;
      corpo = visiveis.map((r) => {
        if (buscaEstado.filtro !== "tudo" && !r.itens.length) return "";
        const linhas = r.itens.map((t) => {
          const i = listaPlana.indexOf(t);
          return linhaFaixa(t, i, "busca", ultimoEstado);
        }).join("");
        return `<section class="secao secao--compacta grupo-fonte" data-fonte="${r.fonte}">
          <div class="secao__topo">
            <h2>${seloFonte(r.fonte)} <span class="contagem">${r.itens.length}</span></h2>
            <span class="grupo-fonte__nota">${esc(D.fontes[r.fonte].selo)}</span>
          </div>
          <div class="lista-faixas">${linhas || `<p class="nota">Nenhum resultado nesta fonte.</p>`}</div>
        </section>`;
      }).join("");
    }

    const avisos = comErro.map((r) => {
      if (r.erro === "proxy") {
        return `<div class="aviso aviso--atencao">${ico("nuvem")} <span>A fonte <strong>${esc(D.fontes[r.fonte].nome)}</strong> precisa do servidor local do FOXify.</span>
          <a class="link" href="#/config">Como ativar</a></div>`;
      }
      if (r.erro === "sem-chave") {
        return `<div class="aviso aviso--atencao aviso--compacto">${ico("chave")} <span>Jamendo sem chave.</span>
          <a class="link" href="#/config">Configurar</a></div>`;
      }
      if (r.erro === "offline") return `<div class="aviso aviso--erro">${ico("wifi-off")} <span>Sem conexão: mostrando apenas o que já está salvo.</span></div>`;
      return `<div class="aviso aviso--atencao">${ico("alerta")} <span>Não foi possível consultar o <strong>${esc(D.fontes[r.fonte].nome)}</strong> agora.</span>
        <button class="link" data-acao="repetir-busca">Tentar de novo</button></div>`;
    }).join("");

    return `<div class="resultados__topo">
        <div><span class="resultados__termo">Resultados para “${esc(buscaEstado.termo)}”</span>
        <span class="resultados__total">${total} ${total === 1 ? "faixa" : "faixas"}</span></div>
        <button class="btn btn--fantasma btn--pequeno" data-acao="tocar-resultados">${ico("play")} Tocar tudo</button>
      </div>
      ${buscaEstado.view === "buscar" ? chipsFontes(buscaEstado.filtro) : ""}
      ${avisos}
      ${corpo}`;
  }

  function renderizarResultados() {
    const alvo = buscaEstado.view === "suamusica" ? $("#resultados-suamusica") : $("#resultados-buscar");
    if (!alvo) return;
    alvo.innerHTML = resultadosHtml();
    const btn = $("[data-acao='tocar-resultados']");
    if (btn) btn.style.display = buscaEstado.lista.length ? "" : "none";
  }

  function limparEstadoVoz(form) {
    if (form) {
      form.classList.remove("ouvindo");
      const botao = form.querySelector(".btn-voz");
      if (botao) botao.classList.remove("ativo");
      const input = form.querySelector('input[name="q"]');
      if (input && input.dataset.placeholderOriginal) {
        input.placeholder = input.dataset.placeholderOriginal;
        delete input.dataset.placeholderOriginal;
      }
      if (formOuvindo === form) formOuvindo = null;
    }
    if (botaoOuvindo) {
      botaoOuvindo.classList.remove("ativo");
      botaoOuvindo = null;
    }
    reconhecimentoVoz = null;
  }

  function pararVoz() {
    const atual = reconhecimentoVoz;
    const form = formOuvindo;
    reconhecimentoVoz = null;
    if (form) limparEstadoVoz(form);
    if (atual) { try { atual.stop(); } catch (_) {} }
  }

  function buscarPorVoz(form) {
    if (!form) return;
    if (reconhecimentoVoz) { pararVoz(); return; }
    const Recon = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recon) {
      toast("Busca por voz não é suportada neste navegador. No Android, use o Chrome.", "erro", 4600);
      return;
    }
    const input = form.querySelector('input[name="q"]');
    const botao = form.querySelector(".btn-voz");
    const view = form.dataset.form === "busca-livre" ? "suamusica" : "buscar";
    let recon;
    try { recon = new Recon(); } catch (_) {
      toast("Não foi possível iniciar o microfone.", "erro", 3500);
      return;
    }
    reconhecimentoVoz = recon;
    formOuvindo = form;
    recon.lang = "pt-BR";
    recon.interimResults = false;
    recon.maxAlternatives = 1;
    recon.continuous = false;
    form.classList.add("ouvindo");
    if (botao) botao.classList.add("ativo");
    if (input) {
      input.dataset.placeholderOriginal = input.placeholder;
      input.placeholder = "Ouvindo… fale o nome da música";
      input.focus();
    }
    recon.onresult = (evento) => {
      const texto = String(evento.results[0][0].transcript || "").trim();
      limparEstadoVoz(form);
      if (!texto) { toast("Não ouvi nada. Tente de novo.", "erro", 3000); return; }
      if (input) input.value = texto;
      executarBusca(texto, view);
    };
    recon.onerror = (evento) => {
      const motivo = evento.error || "";
      limparEstadoVoz(form);
      if (motivo === "not-allowed" || motivo === "service-not-allowed") {
        toast("Permita o microfone nas permissões do navegador.", "erro", 4200);
      } else if (motivo === "no-speech") {
        toast("Não ouvi nada. Tente de novo.", "erro", 3000);
      } else if (motivo === "audio-capture") {
        toast("Microfone não encontrado neste aparelho.", "erro", 3500);
      } else if (motivo === "network") {
        toast("A busca por voz precisa de internet.", "erro", 3500);
      } else {
        toast("Não consegui ouvir. Tente de novo.", "erro", 3500);
      }
    };
    recon.onend = () => limparEstadoVoz(form);
    try { recon.start(); } catch (_) {
      limparEstadoVoz(form);
      toast("Não foi possível iniciar o microfone.", "erro", 3500);
    }
  }

  function ouvirNaHome(botao) {
    if (reconhecimentoVoz) { pararVoz(); return; }
    const Recon = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recon) {
      toast("Busca por voz não é suportada neste navegador. No Android, use o Chrome.", "erro", 4600);
      return;
    }
    let recon;
    try { recon = new Recon(); } catch (_) {
      toast("Não foi possível iniciar o microfone.", "erro", 3500);
      return;
    }
    reconhecimentoVoz = recon;
    botaoOuvindo = botao;
    if (botao) botao.classList.add("ativo");
    recon.lang = "pt-BR";
    recon.interimResults = false;
    recon.maxAlternatives = 1;
    recon.continuous = false;
    recon.onresult = (evento) => {
      const texto = String(evento.results[0][0].transcript || "").trim();
      limparEstadoVoz(null);
      if (!texto) { toast("Não ouvi nada. Tente de novo.", "erro", 3000); return; }
      location.hash = "#/suamusica";
      setTimeout(() => {
        const input = $("#busca-livre-input");
        if (input) input.value = texto;
        executarBusca(texto, "suamusica");
      }, 320);
    };
    recon.onerror = (evento) => {
      const motivo = evento.error || "";
      limparEstadoVoz(null);
      if (motivo === "not-allowed" || motivo === "service-not-allowed") {
        toast("Permita o microfone nas permissões do navegador.", "erro", 4200);
      } else if (motivo === "no-speech") {
        toast("Não ouvi nada. Tente de novo.", "erro", 3000);
      } else {
        toast("Não consegui ouvir. Tente de novo.", "erro", 3500);
      }
    };
    recon.onend = () => limparEstadoVoz(null);
    try { recon.start(); } catch (_) {
      limparEstadoVoz(null);
      toast("Não foi possível iniciar o microfone.", "erro", 3500);
    }
  }

  async function executarBusca(termo, view) {
    termo = (termo || "").trim();
    if (!termo) return;
    if (buscaEstado.carregando && buscaEstado.termo === termo) return;
    buscaEstado.termo = termo;
    buscaEstado.view = view;
    buscaEstado.carregando = true;
    buscaEstado.porFonte = [];
    buscaEstado.filtro = "tudo";
    buscaEstado.albumAberto = null;
    salvarBusca(termo);
    const hero = $(".pagina-topo--hero");
    if (hero && view === "suamusica") hero.classList.add("pagina-topo--compacta");
    renderizarResultados();
    if (buscaEstado.modo === "albuns") {
      buscaEstado.albuns = [];
      renderizarResultados();
      try {
        const achados = await F.buscarAlbuns(termo, ["deezer", "itunes"], 24);
        if (buscaEstado.termo !== termo) return;
        buscaEstado.albuns = achados.itens || [];
        buscaEstado.carregando = false;
        buscaEstado.quando = Date.now();
        renderizarResultados();
        if (!buscaEstado.albuns.length) toast("Nenhum álbum encontrado. Tente o nome do cantor.", "info");
      } catch (_) {
        if (buscaEstado.termo !== termo) return;
        buscaEstado.albuns = [];
        buscaEstado.carregando = false;
        renderizarResultados();
        toast("Não foi possível buscar álbuns agora.", "erro");
      }
      return;
    }
    const ativas = fontesAtivas();
    if (!ativas.length) {
      buscaEstado.carregando = false;
      buscaEstado.porFonte = [];
      renderizarResultados();
      toast("Ative ao menos uma fonte em Ajustes.", "erro");
      return;
    }
    let res = await F.buscar(termo, ativas, 12);
    if (buscaEstado.termo !== termo) return;
    buscaEstado.porFonte = res;
    buscaEstado.carregando = false;
    buscaEstado.quando = Date.now();
    renderizarResultados();
    const total = res.reduce((a, r) => a + r.itens.length, 0);
    if (!total) {
      const falhou = res.every((r) => r.erro);
      toast(falhou ? "Fontes indisponíveis agora. Você pode ouvir a demonstração." : "Nenhum resultado encontrado.",
        falhou ? "erro" : "info");
    }
  }

  function salvarBusca(termo) {
    estado.buscas = [termo, ...estado.buscas.filter((b) => b.toLowerCase() !== termo.toLowerCase())].slice(0, 8);
    salvar();
  }

  /* ------------------------------------------------------------- playlists */
  async function obterEstacao(est, forcar = false) {
    const cache = cacheEstacoes.get(est.id);
    if (cache && !forcar && Date.now() - cache.quando < 6 * 60 * 1000) return cache.dados;
    const dados = { itens: [], demo: false, erro: false };
    try {
      const itens = await F.carregarEstacao(est);
      if (itens.length) {
        dados.itens = itens.map(guardarFaixa);
        dados.demo = false;
      } else {
        dados.itens = F.demoDaEstacao(est);
        dados.demo = true;
        dados.erro = true;
      }
    } catch (e) {
      dados.itens = F.demoDaEstacao(est);
      dados.demo = true;
      dados.erro = true;
    }
    if (dados.demo && !dados.itens.length) dados.itens = D.demo.slice(0, 4);
    cacheEstacoes.set(est.id, { quando: Date.now(), dados });
    return dados;
  }

  const cacheEstacoes = new Map();

  function marcarCarregandoEstacao(id, carregando) {
    $$(`[data-estacao="${id}"]`).forEach((el) => {
      el.classList.toggle("carregando", carregando);
      const b = el.querySelector(".cartao__play");
      if (b) b.innerHTML = carregando ? `<span class="girando"></span>` : ico("play");
    });
    const btn = $(`[data-acao="tocar-estacao"][data-id="${id}"]`);
    if (btn && !carregando && ultimoEstado.faixa && ultimoEstado.contexto === (D.porId[id] || {}).nome) {
      btn.innerHTML = ultimoEstado.tocando ? eq : ico("play");
    }
  }

  async function tocarEstacao(id) {
    const est = D.porId[id];
    if (!est) return;
    marcarCarregandoEstacao(id, true);
    toast(`Buscando “${est.nome}” em ${nomeFonte(est.fonte)}…`, "info", 2200);
    const { itens, demo, erro } = await obterEstacao(est);
    marcarCarregandoEstacao(id, false);
    if (!itens.length) { toast("Não encontrei faixas nesta estação.", "erro"); return; }
    P.tocarLista(itens, 0, est.nome);
    if (demo && erro) toast("Fonte indisponível — tocando faixas demo locais.", "info");
    else toast(`Tocando ${est.nome} · ${itens.length} faixas de ${nomeFonte(est.fonte)}`, "ok", 2600);
  }

  function tocarFavoritas() {
    if (!estado.curtidas.length) { toast("Você ainda não curtiu nenhuma música.", "info"); return; }
    P.tocarLista(estado.curtidas.slice(), 0, "Favoritas");
  }

  function tocarPlaylistUsuario(id) {
    const pl = estado.playlists.find((p) => p.id === id);
    if (!pl) return;
    if (!pl.faixas.length) { toast("Esta playlist está vazia.", "info"); return; }
    P.tocarLista(pl.faixas.slice(), 0, pl.nome);
  }

  function vistaPlaylists() {
    const minhas = estado.playlists;
    return `
      <header class="pagina-topo pagina-topo--linha">
        <div><h1>Sua Playlist</h1><p>Crie listas com o que você encontrar nas fontes livres.</p></div>
        <button class="btn btn--primario" data-acao="nova-playlist">${ico("mais")} Nova playlist</button>
      </header>
      <section class="secao secao--compacta">
        <div class="grade-playlists grade-playlists--biblioteca">
          <a class="cartao-playlist" href="#/playlist/favoritas">
            <div class="cartao-playlist__arte"><img src="assets/img/capas/favoritas.jpg" alt=""><span class="cartao-playlist__selo">${ico("coracao")} ${estado.curtidas.length}</span></div>
            <strong>Favoritas</strong><small>${nMusicas(estado.curtidas.length)}</small>
          </a>
          ${minhas.map((p) => `<a class="cartao-playlist" href="#/playlist/${p.id}">
            <div class="cartao-playlist__arte">
              ${p.faixas[0] ? imagem(p.faixas[0], "") : `<span class="cartao-playlist__vazio">${ico("nota")}</span>`}
              <span class="cartao-playlist__selo">${ico("nota")} ${p.faixas.length}</span>
            </div>
            <strong>${esc(p.nome)}</strong><small>${nMusicas(p.faixas.length)}</small>
          </a>`).join("")}
          <button class="cartao-playlist cartao-playlist--novo" data-acao="nova-playlist">
            <div class="cartao-playlist__arte"><span class="cartao-playlist__mais">${ico("mais")}</span></div>
            <strong>Criar playlist</strong><small>Do seu jeito</small>
          </button>
        </div>
      </section>
      <section class="secao secao--compacta">
        <div class="secao__topo"><h2>${ico("globo")} Playlists das fontes</h2><span class="nota">Prontas para tocar</span></div>
        <div class="grade-playlists grade-playlists--biblioteca">
          ${D.playlistsBarra.filter((p) => p.tipo === "estacao").map((p) => `<a class="cartao-playlist" href="#/playlist/${p.id}">
            <div class="cartao-playlist__arte"><img src="${p.capa}" alt="" loading="lazy" onerror="FOX_IMG_ERRO(this)"><span class="cartao-playlist__selo">${ico("onda")}</span></div>
            <strong>${esc(p.nome)}</strong><small>${esc(p.sub)}</small>
          </a>`).join("")}
        </div>
      </section>`;
  }

  function vistaBiblioteca() {
    const curtidas = estado.curtidas;
    const minhas = estado.playlists;
    const recentes = estado.historico.slice(0, 8);
    return `
      <header class="pagina-topo pagina-topo--linha">
        <div><h1>Sua biblioteca</h1><p>Tudo o que você curtiu, criou e ouviu.</p></div>
        <div class="pagina-topo__acoes">
          <button class="btn btn--primario" data-acao="tocar-favoritas" ${curtidas.length ? "" : "disabled"}>${ico("play")} Tocar favoritas</button>
          <button class="btn btn--fantasma" data-acao="nova-playlist">${ico("mais")} Playlist</button>
        </div>
      </header>

      <section class="secao">
        <div class="secao__topo"><h2>${ico("coracao")} Favoritas <span class="contagem">${curtidas.length}</span></h2>
          <a class="link" href="#/playlist/favoritas">Ver tudo ${ico("seta-direita")}</a></div>
        ${curtidas.length ? `<div class="grade-capas">${curtidas.slice(0, 6).map((t) => `<button class="capa-item" data-acao="tocar-favorita" data-chave="${esc(t.chave)}">
            ${imagem(t, t.titulo)}<span>${esc(t.titulo)}</span><small>${esc(t.artista || "")}</small></button>`).join("")}</div>`
        : `<div class="vazio vazio--linha">${ico("coracao")}<div><h3>Nenhuma favorita ainda</h3><p>Toque no coração de qualquer faixa para guardar aqui.</p></div>
           <a class="btn btn--fantasma" href="#/suamusica">Encontrar música</a></div>`}
      </section>

      <section class="secao">
        <div class="secao__topo"><h2>${ico("lista")} Suas playlists</h2>
          <a class="link" href="#/playlists">Gerenciar ${ico("seta-direita")}</a></div>
        ${minhas.length ? `<div class="grade-playlists grade-playlists--biblioteca">
          ${minhas.map((p) => `<a class="cartao-playlist" href="#/playlist/${p.id}">
            <div class="cartao-playlist__arte">${p.faixas[0] ? imagem(p.faixas[0], "") : `<span class="cartao-playlist__vazio">${ico("nota")}</span>`}<span class="cartao-playlist__selo">${p.faixas.length}</span></div>
            <strong>${esc(p.nome)}</strong><small>${nMusicas(p.faixas.length)}</small></a>`).join("")}
          <button class="cartao-playlist cartao-playlist--novo" data-acao="nova-playlist">
            <div class="cartao-playlist__arte"><span class="cartao-playlist__mais">${ico("mais")}</span></div><strong>Criar playlist</strong><small>Nova lista</small></button>
        </div>` : `<div class="vazio vazio--linha">${ico("lista")}<div><h3>Dê um nome à sua primeira playlist</h3><p>Junte faixas de fontes diferentes em uma lista só.</p></div>
          <button class="btn btn--primario" data-acao="nova-playlist">Criar agora</button></div>`}
      </section>

      <section class="secao">
        <div class="secao__topo"><h2>${ico("relogio")} Ouvidas recentemente</h2>
          ${recentes.length ? `<button class="link" data-acao="limpar-historico">Limpar</button>` : ""}</div>
        ${recentes.length ? `<div class="lista-faixas">${registrarLista("historico-biblioteca", recentes, "Tocadas recentemente") && recentes.map((t, i) => linhaFaixa(t, i, "historico-biblioteca", ultimoEstado)).join("")}</div>`
        : `<p class="nota">Nada por aqui ainda. Toque algo em Sua música.</p>`}
      </section>

      <section class="secao">
        <div class="secao__topo"><h2>${ico("globo")} Suas fontes</h2>
          <a class="link" href="#/config">Configurar ${ico("seta-direita")}</a></div>
        <div class="cartoes-fonte cartoes-fonte--home">
          ${FONTES_ORDEM.map((f) => `<div class="fonte-card fonte-card--estatica">
            <span class="fonte-card__icone" style="--cor:${D.fontes[f].cor}">${iconeFonte(f)}</span>
            <span class="fonte-card__texto"><strong>${esc(D.fontes[f].nome)}</strong><small>${fonteAtiva(f) ? "Ativa" : "Desativada"} · ${esc(D.fontes[f].selo)}</small></span>
            <button class="btn btn--fantasma btn--pequeno" data-acao="alternar-fonte" data-fonte="${f}">${fonteAtiva(f) ? "Desativar" : "Ativar"}</button>
          </div>`).join("")}
        </div>
      </section>`;
  }

  /* -------------------------------------------------------- detalhe playlist */
  let tokenRota = 0;

  async function vistaPlaylist(id) {
    tokenRota += 1;
    const meu = tokenRota;
    if (id === "favoritas") return playlistFavoritas();
    if (id.startsWith("u:")) return playlistUsuario(id);
    const est = D.porId[id];
    if (!est) return `<div class="vazio">${ico("alerta")}<h3>Playlist não encontrada</h3><a class="btn" href="#/inicio">Voltar ao início</a></div>`;
    return playlistEstacao(est, meu);
  }

  function cabecalhoPlaylist({ capa, tipo, titulo, descricao, total, duracao, acoes, carregando }) {
    return `<header class="playlist-hero">
      <div class="playlist-hero__arte">${imagem({ capa }, titulo)}</div>
      <div class="playlist-hero__info">
        <span class="etiqueta">${tipo}</span>
        <h1>${esc(titulo)}</h1>
        <p>${descricao}</p>
        <div class="playlist-hero__meta">${carregando ? "Carregando faixas…" : `${nMusicas(total)}${duracao ? ` · ${Math.round(duracao / 60)} min` : ""}`}</div>
        <div class="playlist-hero__acoes">${acoes}</div>
      </div>
    </header>`;
  }

  function playlistFavoritas() {
    const lista = estado.curtidas.slice();
    const ctx = registrarLista("playlist:favoritas", lista, "Favoritas");
    return `${cabecalhoPlaylist({
      capa: "assets/img/capas/favoritas.jpg", tipo: "Sua biblioteca", titulo: "Favoritas",
      descricao: "Tudo o que você curtiu, em um só lugar.", total: lista.length,
      duracao: totalTempo(lista),
      acoes: `<button class="btn btn--primario" data-acao="tocar-favoritas" ${lista.length ? "" : "disabled"}>${ico("play")} Tocar</button>
        <button class="btn btn--fantasma" data-acao="aleatorio-favoritas" ${lista.length ? "" : "disabled"}>${ico("aleatorio")} Aleatório</button>`
    })}
    ${lista.length ? `<div class="lista-faixas">${lista.map((t, i) => linhaFaixa(t, i, ctx, ultimoEstado)).join("")}</div>`
      : `<div class="vazio">${ico("coracao")}<h3>Nenhuma favorita ainda</h3><p>Encontre algo em Sua música e toque no coração.</p><a class="btn btn--primario" href="#/suamusica">Buscar música grátis</a></div>`}`;
  }

  function playlistUsuario(id) {
    const pl = estado.playlists.find((p) => p.id === id);
    if (!pl) return `<div class="vazio">${ico("alerta")}<h3>Playlist não encontrada</h3><a class="btn" href="#/playlists">Voltar</a></div>`;
    const ctx = registrarLista("playlist:" + id, pl.faixas, pl.nome);
    return `${cabecalhoPlaylist({
      capa: pl.faixas[0] ? capaSegura(pl.faixas[0]) : "assets/img/capas/sua-musica.jpg",
      tipo: "Sua playlist", titulo: pl.nome,
      descricao: pl.descricao || "Playlist criada por você.",
      total: pl.faixas.length, duracao: totalTempo(pl.faixas),
      acoes: `<button class="btn btn--primario" data-acao="tocar-playlist-usuario" data-id="${pl.id}" ${pl.faixas.length ? "" : "disabled"}>${ico("play")} Tocar</button>
        <button class="btn btn--fantasma" data-acao="renomear-playlist" data-id="${pl.id}">${ico("lapis")} Renomear</button>
        <button class="btn btn--fantasma btn--perigo" data-acao="excluir-playlist" data-id="${pl.id}">${ico("lixeira")} Excluir</button>`
    })}
    ${pl.faixas.length ? `<div class="lista-faixas">${pl.faixas.map((t, i) => linhaFaixa(t, i, ctx, ultimoEstado, { remover: true })).join("")}</div>`
      : `<div class="vazio">${ico("nota")}<h3>Playlist vazia</h3><p>Adicione faixas pelo menu ⋯ de qualquer música.</p><a class="btn btn--primario" href="#/suamusica">Descobrir músicas</a></div>`}`;
  }

  async function playlistEstacao(est, token) {
    const cache = cacheEstacoes.get(est.id);
    const carregada = !!cache;
    const dados = cache ? cache.dados : { itens: [], demo: false, erro: false };
    const lista = dados.itens;
    const ctx = registrarLista("playlist:" + est.id, lista, est.nome);

    let aviso = "";
    if (dados.demo && dados.erro) {
      aviso = `<div class="aviso aviso--atencao">${ico("wifi-off")} <span>A fonte <strong>${esc(nomeFonte(est.fonte))}</strong> não respondeu. Mostrando faixas demo locais.</span>
        <button class="link" data-acao="recarregar-estacao" data-id="${est.id}">Tentar de novo</button></div>`;
    }

    const conteudo = !carregada
      ? `<div class="esqueleto-linhas">${Array.from({ length: 8 }).map(() => `<div class="esqueleto"></div>`).join("")}</div>`
      : lista.length ? `<div class="lista-faixas">${lista.map((t, i) => linhaFaixa(t, i, ctx, ultimoEstado)).join("")}</div>`
        : `<div class="vazio">${ico("busca")}<h3>Nada encontrado</h3><p>Tente recarregar ou explorar outra estação.</p><button class="btn btn--primario" data-acao="recarregar-estacao" data-id="${est.id}">Recarregar</button></div>`;

    const html = `${cabecalhoPlaylist({
      capa: est.capa, tipo: "Estação · " + nomeFonte(est.fonte), titulo: est.nome,
      descricao: `${esc(est.sub)} — faixas buscadas em ${nomeFonte(est.fonte)} e tocadas aqui.`,
      total: carregada ? lista.length : 0, duracao: totalTempo(lista), carregando: !carregada,
      acoes: `<button class="btn btn--primario" data-acao="tocar-estacao" data-id="${est.id}" ${carregada ? "" : "disabled"}>${ico("play")} Tocar</button>
        <button class="btn btn--fantasma" data-acao="tocar-estacao-aleatorio" data-id="${est.id}">${ico("aleatorio")} Aleatório</button>
        <button class="btn btn--fantasma" data-acao="recarregar-estacao" data-id="${est.id}">${ico("atualizar")} Atualizar</button>`
    })}${aviso}<div id="conteudo-playlist">${conteudo}</div>`;

    if (!carregada) {
      obterEstacao(est).then((novo) => {
        if (token !== tokenRota) return;
        if (!novo.itens.length) return;
        // Preenche a lista sem refazer a rota inteira.
        const alvo = $("#conteudo-playlist");
        if (alvo) {
          const ctx2 = registrarLista("playlist:" + est.id, novo.itens, est.nome);
          alvo.innerHTML = (novo.demo && novo.erro ? `<div class="aviso aviso--atencao">${ico("wifi-off")} <span>A fonte não respondeu. Mostrando demonstração local.</span></div>` : "") +
            `<div class="lista-faixas">${novo.itens.map((t, i) => linhaFaixa(t, i, ctx2, ultimoEstado)).join("")}</div>`;
          const btn = $('[data-acao="tocar-estacao"]');
          if (btn) btn.disabled = false;
          const meta = $(".playlist-hero__meta");
          if (meta) {
            const dur = totalTempo(novo.itens);
            meta.textContent = nMusicas(novo.itens.length) + (dur ? ` · ${Math.round(dur / 60)} min` : "");
          }
          marcarAtivos(ultimoEstado);
        }
      });
    }
    return { html, id: est.id };
  }

  /* --------------------------------------------------------------- config */
  function vistaConfig() {
    const c = estado.config;
    return `
      <header class="pagina-topo">
        <h1>Ajustes</h1>
        <p>Fontes, aparência e seus dados — tudo fica salvo neste aparelho.</p>
      </header>

      <section class="secao secao--compacta">
        <div class="secao__topo"><h2>${ico("globo")} Fontes de música</h2><span class="nota">${fontesAtivas().length} ativas</span></div>
        <div class="config-lista">
          ${FONTES_ORDEM.map((f) => `<div class="config-item">
            <span class="fonte-card__icone" style="--cor:${D.fontes[f].cor}">${iconeFonte(f)}</span>
            <div class="config-item__txt"><strong>${esc(D.fontes[f].nome)}</strong>
              <small>${esc(D.fontes[f].desc)}${D.fontes[f].requerProxy ? " · via servidor local" : ""}</small></div>
            <button class="switch ${fonteAtiva(f) ? "on" : ""}" role="switch" aria-checked="${fonteAtiva(f)}"
              data-acao="alternar-fonte" data-fonte="${f}" aria-label="Ativar ${esc(D.fontes[f].nome)}"><span></span></button>
          </div>`).join("")}
        </div>
        <p class="nota">YouTube, Deezer e iTunes consultam pelo servidor local
          (<strong>FOXify.bat</strong>). Deezer/iTunes usam o catálogo da API e tocam o áudio completo pelo YouTube.</p>
        <div class="config-item config-item--bloco">
          <div class="config-item__txt"><strong>Servidor do FOXify (APK)</strong>
            <small>No APK, informe o endereço do PC que está rodando o FOXify.bat —
              por exemplo <code>http://192.168.0.15:8765</code>. Em APK que abre em HTTPS,
              use um endereço HTTPS (túnel), pois HTTP misto é bloqueado.</small></div>
          <input class="campo-chave" type="url" inputmode="url" data-config="servidor" autocomplete="off"
            value="${esc(c.servidor || "")}" placeholder="http://192.168.0.15:8765">
        </div>
        <div class="config-item config-item--bloco">
          <div class="config-item__txt"><strong>Chave da API do YouTube (opcional)</strong>
            <small>Com uma chave da YouTube Data API, a busca usa o filtro exato <code>videoCategoryId=10</code> (Música).
              Sem chave, o FOXify usa o catálogo do YouTube Music, que só devolve faixas e vídeos musicais.</small></div>
          <input class="campo-chave" type="password" data-config="youtubeKey" autocomplete="off"
            value="${esc(c.youtubeKey || "")}" placeholder="AIza...">
        </div>
        <div class="config-item config-item--bloco">
          <div class="config-item__txt"><strong>Servidor local</strong><small>Teste se o proxy das fontes está respondendo.</small></div>
          <button class="btn btn--fantasma btn--pequeno" data-acao="testar-servidor">${ico("nuvem")} Testar servidor</button>
        </div>
      </section>

      <section class="secao secao--compacta">
        <div class="secao__topo"><h2>${ico("faisca")} Aparência</h2></div>
        <div class="acentos">
          ${[["azul", "#3b82f6"], ["rosa", "#ff2e88"], ["verde", "#22c55e"], ["ambar", "#f59e0b"]].map(([nome, cor]) => `<button class="acento ${c.acento === nome ? "ativo" : ""}" data-acao="acento" data-acento="${nome}" aria-label="Tema ${nome}">
            <span style="--cor:${cor}"></span>${nome}</button>`).join("")}
        </div>
        <p class="nota">O tema escolhe a cor dos botões, do brilho e do player.</p>
        <button class="btn btn--fantasma btn--pequeno" data-acao="testar-fontes">${ico("onda")} Testar fontes agora</button>
      </section>

      <section class="secao secao--compacta">
        <div class="secao__topo"><h2>${ico("celular")} Aplicativo Android</h2></div>
        <div class="config-item config-item--bloco">
          <div class="config-item__txt"><strong>Instalar na tela inicial</strong>
            <small>Serve como app: tela cheia, ícone próprio e funcionamento offline das faixas demo.</small></div>
          <button class="btn btn--primario btn--pequeno" data-acao="instalar">${ico("instalar")} Instalar</button>
        </div>
        <p class="nota">No Chrome do Android: menu ⋮ → “Adicionar à tela inicial”. Para gerar um APK, veja o README (PWABuilder).</p>
      </section>

      <section class="secao secao--compacta">
        <div class="secao__topo"><h2>${ico("ajustes")} Reprodução</h2></div>
        <div class="config-item">
          <div class="config-item__txt"><strong>Volume do player</strong><small>Também pode ser ajustado na barra inferior.</small></div>
          <input type="range" min="0" max="100" value="${Math.round(c.volume * 100)}" data-range="volume-config" aria-label="Volume">
        </div>
      </section>

      <section class="secao secao--compacta">
        <div class="secao__topo"><h2>${ico("lixeira")} Seus dados</h2></div>
        <div class="config-item config-item--bloco">
          <div class="config-item__txt"><strong>Limpar dados do app</strong><small>Remove favoritas, playlists e histórico deste aparelho.</small></div>
          <button class="btn btn--fantasma btn--perigo btn--pequeno" data-acao="limpar-tudo">Limpar tudo</button>
        </div>
      </section>

      <section class="secao secao--compacta sobre">
        <div class="secao__topo"><h2>${ico("info")} Sobre</h2></div>
        <p><strong>FOXify ${VERSAO}</strong> — player e buscador de música livre, inspirado em uma interface de streaming.</p>
        <p>O app não hospeda músicas. Ele consulta
          <a href="https://www.youtube.com" target="_blank" rel="noopener">YouTube</a>,
          <a href="https://www.deezer.com" target="_blank" rel="noopener">Deezer</a> e
          <a href="https://music.apple.com" target="_blank" rel="noopener">iTunes/Apple Music</a>, e reproduz o áudio no próprio player,
          respeitando as licenças de cada obra. As faixas “Foxify Sessions” são demos sintetizadas localmente.</p>
        <p class="nota">Atalhos no computador: espaço (play/pause), ←/→ (avançar), ↑/↓ (volume), M (mudo), L (curtir), Q (fila).</p>
      </section>`;
  }

  /* ---------------------------------------------------------------- render */
  let promptInstalar = null;

  function renderizarVista() {
    const { rota, id, params } = parametros();
    const alvo = $("#vista");
    if (!alvo) return;
    let html = "";
    const chaveRota = rota + (rota === "playlist" ? "/" + id : "");
    if (chaveRota !== rotaAtual) {
      rotaAtual = chaveRota;
      alvo.classList.remove("entrando");
      void alvo.offsetWidth;
      alvo.classList.add("entrando");
    }
    switch (rota) {
      case "inicio": html = vistaInicio(); break;
      case "buscar": html = vistaBuscar(); break;
      case "suamusica": html = vistaSuaMusica(); break;
      case "biblioteca": html = vistaBiblioteca(); break;
      case "playlists": html = vistaPlaylists(); break;
      case "playlist": html = ""; break;
      case "config": html = vistaConfig(); break;
      default: html = vistaInicio();
    }
    if (rota === "playlist") {
      alvo.innerHTML = `<div class="carregando-rota"><span class="girando"></span></div>`;
      vistaPlaylist(id).then((res) => {
        if (typeof res === "string") { alvo.innerHTML = res; }
        else { alvo.innerHTML = res.html; }
        marcarAtivos(ultimoEstado);
      });
    } else {
      alvo.innerHTML = html;
    }
    alvo.scrollTop = 0;
    window.scrollTo(0, 0);
    atualizarNav();

    if (rota === "buscar") {
      const q = params.get("q");
      if (q && q !== buscaEstado.termo) executarBusca(q, "buscar");
      else if (q) { buscaEstado.view = "buscar"; renderizarResultados(); }
      const input = $("#busca-topo");
      if (input) input.value = q || "";
    }
    if (rota === "suamusica" && buscaEstado.termo && buscaEstado.view === "suamusica") {
      const alvoR = $("#resultados-suamusica");
      if (alvoR) alvoR.innerHTML = resultadosHtml();
    }
    atualizarCoracoes();
  }

  /* ---------------------------------------------------------------- ações */
  const acoes = {
    "ir-buscar": () => { location.hash = "#/buscar"; },
    "tocar-estacao": (el) => tocarEstacao(el.dataset.id),
    "abrir-playlist": (el) => { location.hash = "#/playlist/" + el.dataset.id; },
    "abrir-rota": (el) => { if (el.dataset.rota) location.hash = el.dataset.rota; },
    "abrir-estacao": (el) => { location.hash = "#/playlist/" + el.dataset.id; },
    "abrir-tocando": () => abrirTocando(),
    "fechar-tocando": () => fecharTocando(),
    "fechar-yt": () => P.fecharYoutube(),
    "iniciar-yt": () => P.iniciarYoutube(),
    "alternar": () => P.alternar(),
    "proxima": () => P.proxima(true),
    "anterior": () => P.anterior(),
    "parar": () => { fecharTocando(); P.parar(); },
    "voltar-30": () => P.buscarTempo(Math.max(0, P.estado().tempo - 30)),
    "avancar-30": () => P.buscarTempo(P.estado().tempo + 30),
    "aleatorio": () => { P.alternarAleatorio(); toast(P.estado().aleatorio ? "Modo aleatório ativado" : "Modo aleatório desativado", "info", 1800); },
    "repetir": () => {
      P.alternarRepetir();
      const r = P.estado().repetir;
      toast(r === "off" ? "Repetição desativada" : r === "todas" ? "Repetir fila" : "Repetir esta música", "info", 1800);
    },
    "mudo": () => P.alternarMudo(),
    "abrir-fila": () => abrirFila(),
    "tocar-fila": (el) => { P.irPara(Number(el.dataset.i)); fecharModal(); },
    "curtir": (el) => curtirPorChave(el.dataset.chave),
    "menu-faixa": (el) => menuFaixa(el.dataset.chave),
    "tocar-linha": (el) => tocarLinha(el.dataset.ctx, Number(el.dataset.i)),
    "tocar-playlist": (el) => { const p = D.playlistsBarra.find((x) => x.id === el.dataset.id); if (p && p.tipo === "estacao") tocarEstacao(p.id); },
    "tocar-favoritas": () => tocarFavoritas(),
    "tocar-favorita": (el) => {
      const i = estado.curtidas.findIndex((t) => t.chave === el.dataset.chave);
      if (i >= 0) P.tocarLista(estado.curtidas.slice(), i, "Favoritas");
    },
    "aleatorio-favoritas": () => {
      if (!estado.curtidas.length) return;
      P.tocarLista(estado.curtidas.slice().sort(() => Math.random() - 0.5), 0, "Favoritas");
    },
    "tocar-playlist-usuario": (el) => tocarPlaylistUsuario(el.dataset.id),
    "tocar-resultados": () => {
      if (!buscaEstado.lista.length) return;
      P.tocarLista(buscaEstado.lista.slice(), 0, "Resultados · " + buscaEstado.termo);
    },
    "tocar-demos": () => { P.tocarLista(D.demo.slice(), 0, "FOXify Sessions"); },
    "tocar-estacao-aleatorio": async (el) => {
      const id = el.dataset.id;
      const est = D.porId[id];
      const { itens } = await obterEstacao(est);
      if (itens.length) P.tocarLista(itens.slice().sort(() => Math.random() - 0.5), 0, est.nome);
    },
    "recarregar-estacao": async (el) => {
      const est = D.porId[el.dataset.id];
      if (!est) return;
      cacheEstacoes.delete(est.id);
      toast("Atualizando faixas…", "info", 2000);
      const { itens, demo } = await obterEstacao(est, true);
      if (!itens.length) { toast("Nada encontrado agora.", "erro"); return; }
      const ctx = registrarLista("playlist:" + est.id, itens, est.nome);
      const alvo = $("#conteudo-playlist") || $("#vista");
      alvo.innerHTML = `<div class="aviso ${demo ? "aviso--atencao" : "aviso--ok"}">${ico(demo ? "wifi-off" : "check")}
        <span>${demo ? "Fonte indisponível — demonstração local." : "Faixas atualizadas."}</span></div>
        <div class="lista-faixas">${itens.map((t, i) => linhaFaixa(t, i, ctx, ultimoEstado)).join("")}</div>`;
      marcarAtivos(ultimoEstado);
    },
    "abrir-fonte": (el) => {
      const f = el.dataset.fonte;
      if (!fonteAtiva(f)) { estado.config.fontes[f] = true; salvar(); }
      location.hash = "#/suamusica";
      setTimeout(() => {
        const campo = $("#busca-livre-input");
        if (campo) campo.focus();
      }, 350);
    },
    "alternar-fonte": (el) => {
      const f = el.dataset.fonte;
      estado.config.fontes[f] = !fonteAtiva(f);
      salvar();
      const agora = fonteAtiva(f);
      toast(`${D.fontes[f].nome} ${agora ? "ativada" : "desativada"}`, agora ? "ok" : "info", 1800);
      renderizarVista();
      renderizarCromo(ultimoEstado);
    },
    "testar-servidor": async () => {
      toast("Testando o servidor local…", "info", 2200);
      const ok = await F.detectarProxy();
      toast(ok ? "Servidor local respondendo. YouTube, Deezer e iTunes liberados."
        : "Servidor local não encontrado. Abra pelo FOXify.bat.",
        ok ? "ok" : "erro", 5200);
    },
    "sugestao": (el) => {
      const termo = el.dataset.termo;
      const view = parametros().rota === "suamusica" ? "suamusica" : "buscar";
      if (view === "buscar") location.hash = "#/buscar?q=" + encodeURIComponent(termo);
      else { const campo = $("#busca-livre-input"); if (campo) campo.value = termo; executarBusca(termo, "suamusica"); }
    },
    "filtro": (el) => {
      buscaEstado.filtro = el.dataset.filtro;
      const st = buscaEstado;
      if (!st.carregando && st.termo) {
        const alvo = st.view === "suamusica" ? $("#resultados-suamusica") : $("#resultados-buscar");
        if (alvo) alvo.innerHTML = resultadosHtml();
      } else renderizarResultados();
    },
    "repetir-busca": () => executarBusca(buscaEstado.termo, buscaEstado.view || "buscar"),
    "busca-voz": (el) => buscarPorVoz(el.closest("form")),
    "busca-voz-home": (el) => ouvirNaHome(el),
    "limpar-buscas": () => { estado.buscas = []; salvar(); renderizarVista(); toast("Buscas recentes limpas.", "ok", 1800); },
    "limpar-historico": () => { estado.historico = []; salvar(); renderizarVista(); toast("Histórico limpo.", "ok", 1800); },
    "modo-busca": (el) => {
      const modo = el.dataset.modo === "albuns" ? "albuns" : "faixas";
      if (buscaEstado.modo === modo) return;
      buscaEstado.modo = modo;
      buscaEstado.albumAberto = null;
      buscaEstado.albuns = [];
      renderizarVista();
      if (buscaEstado.termo) executarBusca(buscaEstado.termo, buscaEstado.view || "suamusica");
    },
    "abrir-album": (el) => abrirAlbum(el.dataset.chave),
    "voltar-albuns": () => {
      buscaEstado.albumAberto = null;
      renderizarResultados();
    },
    "tocar-album": () => tocarAlbumAberto(0),
    "tocar-album-faixa": (el) => tocarAlbumAberto(Number(el.dataset.i) || 0),
    "nova-playlist": () => modalNovaPlaylist(),
    "renomear-playlist": (el) => modalNovaPlaylist(el.dataset.id),
    "excluir-playlist": (el) => excluirPlaylist(el.dataset.id),
    "remover-playlist": (el) => removerDaPlaylist(parametros().id, el.dataset.chave),
    "acento": (el) => { estado.config.acento = el.dataset.acento; aplicarAcento(); salvar(); renderizarVista(); toast("Tema atualizado.", "ok", 1500); },
    "limpar-tudo": () => modalLimparTudo(),
    "instalar": () => instalar(),
    "dispensar-instalar": () => { estado.config.instalacaoDispensada = true; salvar(); renderizarVista(); },
    "compartilhar": () => compartilharAtual(),
    "testar-fontes": () => testarFontes(),
    "novidades": () => modalNovidades(),
    "minimizar": () => toast("O FOXify continua tocando em segundo plano.", "info"),
    "maximizar": async () => {
      try {
        if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
        else await document.exitFullscreen();
      } catch (_) { toast("Tela cheia indisponível neste navegador.", "info"); }
    },
    "fechar-app": () => modalFecharApp(),
    "confirmar-fechar": () => {
      fecharModal();
      P.pausar();
      toast("Sessão encerrada. Obrigado por ouvir!", "ok", 3000);
      setTimeout(() => { try { window.close(); } catch (_) { /* aba aberta pelo usuário */ } }, 400);
    }
  };

  function tocarLinha(ctx, i) {
    const reg = REGISTRO.get(ctx);
    if (!reg || !reg.lista.length) return;
    if (i < 0 || i >= reg.lista.length) return;
    if (i >= 0) {
      guardarFaixa(reg.lista[i]);
      P.tocarLista(reg.lista, i, reg.rotulo || "Tocando");
    }
  }

  function curtirPorChave(chave) {
    const t = faixasPorChave.get(chave) || estado.curtidas.find((x) => x.chave === chave) || (ultimoEstado.faixa && ultimoEstado.faixa.chave === chave ? ultimoEstado.faixa : null);
    if (!t) return;
    const i = estado.curtidas.findIndex((x) => x.chave === chave);
    if (i >= 0) {
      estado.curtidas.splice(i, 1);
      toast("Removida das favoritas.", "info", 1800);
    } else {
      estado.curtidas.unshift({ ...t, curtidaEm: Date.now() });
      toast("Adicionada às favoritas.", "ok", 1800);
    }
    salvar();
    atualizarCoracoes();
    renderizarCromo(ultimoEstado);
    const view = parametros().rota;
    if (view === "playlist" && parametros().id === "favoritas") renderizarVista();
  }

  function menuFaixa(chave) {
    const t = faixasPorChave.get(chave) || estado.curtidas.find((x) => x.chave === chave) || (ultimoEstado.faixa && ultimoEstado.faixa.chave === chave ? ultimoEstado.faixa : null);
    if (!t) return;
    const curt = curtida(t.chave);
    abrirModal(`
      <div class="modal__cabeca">
        ${imagem(t, "", "modal__capa")}
        <div><strong>${esc(t.titulo)}</strong><span>${esc(t.artista || "")}</span></div>
        <button class="btn-icone" data-fechar-modal aria-label="Fechar">${ico("fechar")}</button>
      </div>
      <div class="modal__lista">
        <button data-acao="menu-tocar" data-chave="${esc(t.chave)}">${ico("play")} Tocar agora</button>
        <button data-acao="menu-seguir" data-chave="${esc(t.chave)}">${ico("proxima")} Tocar em seguida</button>
        <button data-acao="menu-playlist" data-chave="${esc(t.chave)}">${ico("mais")} Adicionar à playlist</button>
        <button data-acao="curtir" data-chave="${esc(t.chave)}" data-fechar-depois>${ico(curt ? "coracao-cheio" : "coracao")} ${curt ? "Remover das favoritas" : "Curtir"}</button>
        ${t.permalink ? `<a href="${esc(t.permalink)}" target="_blank" rel="noopener">${ico("externo")} Abrir no ${esc(nomeFonte(t.fonte))}</a>` : ""}
        <button data-acao="compartilhar-faixa" data-chave="${esc(t.chave)}">${ico("compartilhar")} Compartilhar</button>
      </div>`);
  }

  async function compartilharAtual() {
    const f = ultimoEstado.faixa;
    if (!f) return toast("Nada tocando agora.", "info");
    const url = f.permalink || (f.fonte === "demo" ? "FOXify — demonstração local" : location.href);
    const dados = { title: f.titulo, text: `${f.titulo} — ${f.artista || "FOXify"}`, url };
    try {
      if (navigator.share) await navigator.share(dados);
      else { await navigator.clipboard.writeText(`${f.titulo} — ${f.artista}\n${url}`); toast("Link copiado.", "ok"); }
    } catch (_) { /* usuário cancelou */ }
  }

  /* ------------------------------------------------------------- modais */
  function modalNovaPlaylist(idEditar) {
    const pl = idEditar ? estado.playlists.find((p) => p.id === idEditar) : null;
    abrirModal(`
      <div class="modal__cabeca"><div><strong>${pl ? "Renomear playlist" : "Nova playlist"}</strong><span>${pl ? "Atualize o nome da sua lista." : "Dê um nome para a sua lista."}</span></div>
        <button class="btn-icone" data-fechar-modal aria-label="Fechar">${ico("fechar")}</button></div>
      <form class="modal__form" data-form="salvar-playlist" data-id="${pl ? pl.id : ""}">
        <input name="nome" maxlength="48" placeholder="Ex.: Noite de sábado" value="${pl ? esc(pl.nome) : ""}" required autocomplete="off">
        <button class="btn btn--primario" type="submit">${pl ? "Salvar" : "Criar"}</button>
      </form>`);
    setTimeout(() => { const i = $(".modal input"); if (i) i.focus(); }, 180);
  }

  function salvarPlaylist(nome, id) {
    nome = nome.trim().slice(0, 48);
    if (!nome) return;
    if (id) {
      const pl = estado.playlists.find((p) => p.id === id);
      if (pl) { pl.nome = nome; toast("Playlist renomeada.", "ok"); }
    } else {
      estado.playlists.unshift({ id: "u:" + Date.now().toString(36), nome, faixas: [], criadaEm: Date.now() });
      toast(`Playlist “${nome}” criada.`, "ok");
    }
    salvar();
    fecharModal();
    renderizarVista();
  }

  function modalAdicionarPlaylist(chave) {
    const t = obterFaixa(chave);
    if (!t) return;
    abrirModal(`
      <div class="modal__cabeca"><div><strong>Adicionar à playlist</strong><span>${esc(t.titulo)}</span></div>
        <button class="btn-icone" data-fechar-modal aria-label="Fechar">${ico("fechar")}</button></div>
      <div class="modal__lista">
        ${estado.playlists.length ? estado.playlists.map((p) => `<button data-acao="add-a-playlist" data-chave="${esc(chave)}" data-playlist="${p.id}">
          ${ico("nota")} <span class="modal__item-txt">${esc(p.nome)}<small>${nMusicas(p.faixas.length)}</small></span>${ico("mais")}</button>`).join("")
        : `<p class="nota">Você ainda não tem playlists. Crie a primeira:</p>`}
        <button data-acao="nova-playlist-com" data-chave="${esc(chave)}">${ico("mais")} Criar nova playlist</button>
      </div>`);
  }

  function adicionarNaPlaylist(chave, playlistId) {
    const t = obterFaixa(chave);
    const pl = estado.playlists.find((p) => p.id === playlistId);
    if (!t || !pl) return;
    if (pl.faixas.some((f) => f.chave === t.chave)) { toast("Essa faixa já está na playlist.", "info"); fecharModal(); return; }
    pl.faixas.push(guardarFaixa({ ...t }));
    salvar();
    fecharModal();
    toast(`Adicionada a “${pl.nome}”.`, "ok");
    renderizarVista();
  }

  function removerDaPlaylist(playlistId, chave) {
    const pl = estado.playlists.find((p) => p.id === playlistId);
    if (!pl) return;
    pl.faixas = pl.faixas.filter((t) => t.chave !== chave);
    salvar();
    renderizarVista();
    toast("Faixa removida.", "info", 1800);
  }

  function excluirPlaylist(id) {
    const pl = estado.playlists.find((p) => p.id === id);
    if (!pl) return;
    abrirModal(`
      <div class="modal__cabeca"><div><strong>Excluir “${esc(pl.nome)}”?</strong><span>Essa ação não pode ser desfeita.</span></div>
        <button class="btn-icone" data-fechar-modal aria-label="Fechar">${ico("fechar")}</button></div>
      <div class="modal__acoes">
        <button class="btn btn--fantasma" data-fechar-modal>Cancelar</button>
        <button class="btn btn--perigo" data-acao="confirmar-excluir" data-id="${pl.id}">Excluir</button>
      </div>`);
  }

  function modalNovidades() {
    abrirModal(`
      <div class="modal__cabeca"><div><strong>Novidades do FOXify</strong><span>Versão ${VERSAO} · música livre e legal</span></div>
        <button class="btn-icone" data-fechar-modal aria-label="Fechar">${ico("fechar")}</button></div>
      <div class="novidades">
        <div class="novidade">${ico("globo")}<div><strong>Buscador em 3 sites grátis</strong><span>YouTube, Deezer e iTunes consultados ao mesmo tempo — o play acontece aqui dentro.</span></div></div>
        <div class="novidade">${ico("onda")}<div><strong>Player completo</strong><span>Fila, aleatório, repetição, favoritas, volume e controles na tela de bloqueio.</span></div></div>
        <div class="novidade">${ico("celular")}<div><strong>Feito para o celular</strong><span>Instale na tela inicial e ouça em segundo plano, até com a tela apagada.</span></div></div>
        <div class="novidade">${ico("nuvem")}<div><strong>Sem conexão?</strong><span>As faixas “Foxify Sessions” ficam salvas no aparelho para você continuar ouvindo.</span></div></div>
      </div>
      <div class="modal__acoes"><button class="btn btn--primario" data-fechar-modal>Boa, vamos ouvir</button></div>`);
  }

  function modalFecharApp() {
    abrirModal(`
      <div class="modal__cabeca"><div><strong>Fechar o FOXify?</strong><span>Você pode continuar ouvindo ou encerrar a sessão.</span></div>
        <button class="btn-icone" data-fechar-modal aria-label="Fechar">${ico("fechar")}</button></div>
      <div class="modal__acoes">
        <button class="btn btn--primario" data-fechar-modal>${ico("play")} Continuar ouvindo</button>
        <button class="btn btn--fantasma" data-acao="confirmar-fechar">${ico("fechar")} Fechar</button>
      </div>`);
  }

  function modalLimparTudo() {
    abrirModal(`
      <div class="modal__cabeca"><div><strong>Limpar tudo?</strong><span>Favoritas, playlists e histórico serão apagados deste aparelho.</span></div>
        <button class="btn-icone" data-fechar-modal aria-label="Fechar">${ico("fechar")}</button></div>
      <div class="modal__acoes">
        <button class="btn btn--fantasma" data-fechar-modal>Cancelar</button>
        <button class="btn btn--perigo" data-acao="confirmar-limpar">Apagar tudo</button>
      </div>`);
  }

  function abrirFila() {
    const st = P.estado();
    abrirModal(`
      <div class="modal__cabeca"><div><strong>Fila de reprodução</strong><span>${st.fila.length} faixas · ${esc(st.contexto || "")}</span></div>
        <button class="btn-icone" data-fechar-modal aria-label="Fechar">${ico("fechar")}</button></div>
      <div class="fila-completa">
        ${st.fila.length ? st.fila.map((t, i) => `<div class="fila-item ${i === st.indice ? "atual" : ""}" data-acao="tocar-fila" data-i="${i}">
          ${imagem(t, "", "fila-item__capa")}
          <span class="fila-item__info"><strong>${esc(t.titulo)}</strong><span>${esc(t.artista || "")}</span></span>
          <span class="fila-item__dur">${fmt(t.duracao)}</span>
          <button class="btn-icone" data-acao="remover-fila" data-i="${i}" aria-label="Remover da fila">${ico("fechar")}</button>
        </div>`).join("") : `<p class="nota">A fila está vazia. Toque em uma estação para começar.</p>`}
      </div>
      <div class="modal__acoes"><button class="btn btn--fantasma" data-fechar-modal>Fechar</button></div>`);
  }

  /* -------------------------------------------------------------- player sheet */
  function abrirTocando() {
    const sheet = $("#sheet");
    if (!sheet) return;
    sheet.classList.add("aberto");
    document.body.classList.add("sheet-aberto", "sem-rolagem");
  }
  function fecharTocando() {
    const sheet = $("#sheet");
    if (!sheet) return;
    sheet.classList.remove("aberto");
    document.body.classList.remove("sheet-aberto");
    if (!$("#modais").classList.contains("aberto")) document.body.classList.remove("sem-rolagem");
  }

  function compartilharFaixa(chave) {
    const t = obterFaixa(chave);
    if (!t) return;
    const dados = { title: t.titulo, text: `${t.titulo} — ${t.artista || "FOXify"}`, url: t.permalink || location.href };
    if (navigator.share) navigator.share(dados).catch(() => {});
    else { navigator.clipboard.writeText(`${t.titulo} — ${t.artista}\n${dados.url}`).then(() => toast("Link copiado.", "ok")).catch(() => {}); }
  }

  /* ------------------------------------------------------------- instalação */
  async function instalar() {
    if (promptInstalar) {
      promptInstalar.prompt();
      const escolha = await promptInstalar.userChoice;
      if (escolha && escolha.outcome === "accepted") toast("Instalando o FOXify…", "ok");
      promptInstalar = null;
      renderizarVista();
    } else if (window.matchMedia("(display-mode: standalone)").matches) {
      toast("Você já está usando o app instalado.", "info");
    } else {
      toast("No Chrome do Android: menu ⋮ → “Adicionar à tela inicial”.", "info", 5200);
    }
  }

  async function testarFontes() {
    toast("Testando as fontes…", "info", 2200);
    const res = await F.buscar("lofi", fontesAtivas(), 3);
    const partes = res.map((r) => `${D.fontes[r.fonte].nome}: ${r.erro ? (r.erro === "sem-chave" ? "sem chave" : "falhou") : r.itens.length + " ok"}`);
    toast(partes.join(" · "), res.every((r) => !r.erro) ? "ok" : "erro", 6000);
  }

  /* ---------------------------------------------------------------- eventos */
  function aplicarAcento() {
    document.documentElement.dataset.acento = estado.config.acento || "azul";
  }

  function atualizarRede() {
    const el = $("#status-rede");
    if (!el) return;
    el.classList.toggle("offline", !navigator.onLine);
    el.innerHTML = ico(navigator.onLine ? "wifi" : "wifi-off");
    el.title = navigator.onLine ? "Online" : "Offline";
  }

  function ligarEventos() {
    document.addEventListener("click", (ev) => {
      const alvoFechar = ev.target.closest("[data-fechar-modal]");
      if (alvoFechar) {
        const ehFundo = alvoFechar.classList.contains("modal-fundo");
        // O fundo do modal também tem data-fechar-modal; cliques nos botões
        // internos não podem ser tratados como clique no fundo.
        if (!ehFundo || ev.target === alvoFechar) {
          fecharModal();
          return;
        }
      }
      const alvo = ev.target.closest("[data-acao]");
      if (alvo) {
        const acao = alvo.dataset.acao;
        if (acao === "tocar-linha") {
          ev.preventDefault();
          if (ev.target.closest("button") && !ev.target.closest(".faixa__play")) return;
        }
        if (acao === "menu-faixa") {
          ev.stopPropagation();
          menuFaixa(alvo.dataset.chave);
          return;
        }
        if (acoes[acao]) {
          ev.preventDefault();
          ev.stopPropagation();
          if (alvo.hasAttribute("data-fechar-depois")) fecharModal();
          try { acoes[acao](alvo, ev); } catch (e) { console.error(e); toast("Algo deu errado.", "erro"); }
          return;
        }
        const especiais = {
          "menu-tocar": () => { const f = obterFaixa(alvo.dataset.chave); if (f) P.tocarLista([f], 0, "Tocando agora"); fecharModal(); },
          "menu-seguir": () => { const f = obterFaixa(alvo.dataset.chave); if (f) { P.adicionarProxima(f); toast("Tocando em seguida.", "ok"); } fecharModal(); },
          "menu-playlist": () => modalAdicionarPlaylist(alvo.dataset.chave),
          "add-a-playlist": () => adicionarNaPlaylist(alvo.dataset.chave, alvo.dataset.playlist),
          "nova-playlist-com": () => modalNovaPlaylistCom(alvo.dataset.chave),
          "confirmar-excluir": () => {
            const id = alvo.dataset.id;
            estado.playlists = estado.playlists.filter((p) => p.id !== id);
            salvar();
            fecharModal();
            if (parametros().rota === "playlists") renderizarVista();
            else location.hash = "#/playlists";
            toast("Playlist excluída.", "ok");
          },
          "confirmar-limpar": () => {
            estado.curtidas = []; estado.playlists = []; estado.historico = []; estado.buscas = [];
            salvar(); fecharModal(); renderizarVista(); renderizarCromo(P.estado()); toast("Dados apagados.", "ok");
          },
          "remover-fila": () => { P.remover(Number(alvo.dataset.i)); fecharModal(); setTimeout(abrirFila, 220); },
          "compartilhar-faixa": () => compartilharFaixa(alvo.dataset.chave),
          "tocar-playlist-usuario": () => tocarPlaylistUsuario(alvo.dataset.id)
        };
        if (especiais[acao]) { ev.preventDefault(); ev.stopPropagation(); especiais[acao](); }
        return;
      }
      const rota = ev.target.closest("[data-rota]");
      if (rota) {
        ev.preventDefault();
        location.hash = rota.getAttribute("data-rota");
        return;
      }
      if (ev.target.classList.contains("modal-fundo")) fecharModal();
    });

    document.addEventListener("submit", (ev) => {
      const form = ev.target.closest("form");
      if (!form) return;
      const tipo = form.dataset.form;
      if (tipo === "busca-topo" || tipo === "busca-pagina") {
        ev.preventDefault();
        const q = (new FormData(form).get("q") || "").toString().trim();
        if (!q) return;
        location.hash = "#/buscar?q=" + encodeURIComponent(q);
        if (parametros().rota === "buscar") executarBusca(q, "buscar");
      } else if (tipo === "busca-livre") {
        ev.preventDefault();
        const q = (new FormData(form).get("q") || "").toString().trim();
        if (!q) { toast("Digite o que você quer ouvir.", "info"); return; }
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        executarBusca(q, "suamusica");
      } else if (tipo === "salvar-playlist") {
        ev.preventDefault();
        const nome = (new FormData(form).get("nome") || "").toString();
        salvarPlaylist(nome, form.dataset.id || "");
      }
    });

    document.addEventListener("input", (ev) => {
      const el = ev.target;
      if (el.dataset.range === "tempo") {
        const dur = P.estado().duracao;
        if (dur) P.buscarTempo((Number(el.value) / 1000) * dur);
      } else if (el.dataset.range === "volume") {
        el.style.setProperty("--p", el.value + "%");
        P.definirVolume(Number(el.value) / 100, true);
        estado.config.volume = Number(el.value) / 100;
        salvar();
      } else if (el.dataset.range === "volume-config") {
        el.style.setProperty("--p", el.value + "%");
        P.definirVolume(Number(el.value) / 100, true);
        estado.config.volume = Number(el.value) / 100;
        salvar();
      } else if (el.dataset.config === "youtubeKey") {
        estado.config.youtubeKey = el.value.trim();
        FOX_FONTES.configurar({ youtubeKey: estado.config.youtubeKey, servidor: estado.config.servidor });
        salvar();
      } else if (el.dataset.config === "servidor") {
        estado.config.servidor = el.value.trim();
        FOX_FONTES.configurar({ youtubeKey: estado.config.youtubeKey, servidor: estado.config.servidor });
        salvar();
      }
    });

    document.addEventListener("keydown", (ev) => {
      const digitando = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      if (ev.key === "Escape") { fecharModal(); fecharTocando(); return; }
      if (digitando) return;
      if (ev.code === "Space") { ev.preventDefault(); P.alternar(); }
      else if (ev.key === "ArrowRight") { ev.preventDefault(); P.buscarTempo(P.estado().tempo + 30); }
      else if (ev.key === "ArrowLeft") { ev.preventDefault(); P.buscarTempo(P.estado().tempo - 30); }
      else if (ev.key === "ArrowUp") { ev.preventDefault(); P.definirVolume(Math.min(1, P.estado().volume + 0.05)); }
      else if (ev.key === "ArrowDown") { ev.preventDefault(); P.definirVolume(Math.max(0, P.estado().volume - 0.05)); }
      else if (ev.key.toLowerCase() === "m") P.alternarMudo();
      else if (ev.key.toLowerCase() === "l") { const f = P.faixaAtual(); if (f) curtirPorChave(f.chave); }
      else if (ev.key.toLowerCase() === "q") abrirFila();
    });

    window.addEventListener("hashchange", rotear);
    let toqueSheet = null;
    document.addEventListener("touchstart", (ev) => {
      if (!ev.target.closest("#sheet .sheet__topo, #sheet .sheet__arte")) return;
      toqueSheet = ev.touches[0].clientY;
    }, { passive: true });
    document.addEventListener("touchend", (ev) => {
      if (toqueSheet == null) return;
      const delta = ev.changedTouches[0].clientY - toqueSheet;
      toqueSheet = null;
      if (delta > 90) fecharTocando();
    }, { passive: true });
    window.addEventListener("online", () => { atualizarRede(); toast("Conectado. As fontes voltaram.", "ok"); if (parametros().rota === "suamusica") renderizarVista(); });
    window.addEventListener("offline", () => { atualizarRede(); toast("Sem conexão. O que já está salvo continua tocando.", "erro", 4200); });
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      promptInstalar = e;
      if (parametros().rota === "inicio") renderizarVista();
    });
  }

  function modalNovaPlaylistCom(chave) {
    abrirModal(`
      <div class="modal__cabeca"><div><strong>Nova playlist</strong><span>Ela já começa com “${esc((obterFaixa(chave) || {}).titulo || "a faixa")}”.</span></div>
        <button class="btn-icone" data-fechar-modal aria-label="Fechar">${ico("fechar")}</button></div>
      <form class="modal__form" data-form="nova-com-faixa" data-chave="${esc(chave)}">
        <input name="nome" maxlength="48" placeholder="Nome da playlist" required autocomplete="off">
        <button class="btn btn--primario" type="submit">Criar</button>
      </form>`);
    setTimeout(() => { const i = $(".modal input"); if (i) i.focus(); }, 180);
  }

  /* ------------------------------------------------------------------ boot */
  function rotear() {
    const { rota, id } = parametros();
    if (!rota) { location.hash = "#/inicio"; return; }
    if (rota === "playlist" && !id) { location.hash = "#/playlists"; return; }
    renderizarVista();
    if (rota === "buscar") {
      const { params } = parametros();
      const q = params.get("q");
      const campo = $("#busca-pagina-input");
      if (campo) campo.value = q || buscaEstado.termo || "";
    }
    if (rota === "suamusica" && buscaEstado.view === "suamusica") {
      const alvo = $("#resultados-suamusica");
      if (alvo) alvo.innerHTML = resultadosHtml();
    }
    fecharTocando();
    document.body.classList.remove("menu-aberto");
  }

  function diagnosticoLayout() {
    if (!location.search.includes("debug")) return;
    const painel = document.createElement("div");
    painel.id = "painel-debug";
    painel.style.cssText = "position:fixed;z-index:99999;left:4px;top:4px;background:rgba(0,0,0,.82);color:#7dffa0;" +
      "font:10px/1.35 monospace;padding:6px;max-width:94vw;white-space:pre-wrap;border-radius:6px;pointer-events:none";
    document.body.appendChild(painel);
    const atualizar = () => {
      const larg = window.innerWidth;
      const estouram = Array.from(document.querySelectorAll("body *"))
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter((x) => x.r.right > larg + 2 && x.r.width > 0)
        .slice(0, 7)
        .map((x) => `${x.el.tagName.toLowerCase()}.${String(x.el.className).slice(0, 34)} → ${Math.round(x.r.right)}`);
      painel.textContent = `vw=${larg} docW=${document.documentElement.scrollWidth} bodyW=${document.body.scrollWidth} inner=${window.innerHeight} dpr=${window.devicePixelRatio}\n` +
        [".app", ".conteudo", ".vista", ".grade-destaques", ".grade-mixes", ".tabbar", ".mini", ".topo-mobile"]
          .map((sel) => { const el = $(sel); return el ? `${sel} ${Math.round(el.getBoundingClientRect().width)}/${el.scrollWidth}` : `${sel} -`; }).join("\n") +
        "\n" + estouram.join("\n");
    };
    setTimeout(atualizar, 1200);
    setInterval(atualizar, 2500);
  }

  let iniciado = false;
  function iniciar() {
    if (iniciado) return;
    iniciado = true;
    carregarEstado();
    FOX_FONTES.configurar({ youtubeKey: estado.config.youtubeKey, servidor: estado.config.servidor });
    aplicarAcento();
    P.definirVolume(estado.config.volume);
    ligarEventos();
    atualizarRede();

    $("#lista-playlists").innerHTML = D.playlistsBarra.map((p) => {
      const destino = p.rota || "#/playlist/" + p.id;
      return `<a class="playlist-item" data-rota="${destino}" href="${destino}">
      <img src="${p.capa}" alt="" loading="lazy" onerror="FOX_IMG_ERRO(this)">
      <span><strong>${esc(p.nome)}</strong><small>${esc(p.sub)}</small></span>
    </a>`;
    }).join("");

    let ultimaFalha = "";
    P.aoMudar((st) => {
      renderizarCromo(st);
      if (st.tocando && st.faixa) registrarHistorico(st.faixa);
      if (st.erro && st.faixa && ultimaFalha !== st.faixa.chave) {
        ultimaFalha = st.faixa.chave;
        toast(st.erro === "toque"
          ? "Toque no play para liberar o áudio."
          : `Não foi possível tocar “${st.faixa.titulo}”. Toque no play ou pule manualmente.`,
          "erro", 4200);
      }
      if (!st.erro) ultimaFalha = "";
    });
    P.aoProgresso(atualizarProgresso);

    P.definirFila(D.demo.slice(), 0, "Sua música");
    renderizarCromo(P.estado());

    rotear();
    atualizarCoracoes();
    diagnosticoLayout();

    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW:", e));
    }

    window.addEventListener("error", (e) => {
      const d = $("#diagnostico");
      if (d) d.textContent += `\n[erro] ${e.message} @ ${e.filename}:${e.lineno}`;
    });
    window.addEventListener("unhandledrejection", (e) => {
      const d = $("#diagnostico");
      if (d) d.textContent += `\n[promise] ${e.reason && (e.reason.stack || e.reason.message || e.reason)}`;
    });
  }

  let ultimaHistorico = "";
  function registrarHistorico(faixa) {
    if (!faixa || !faixa.chave || faixa.chave === ultimaHistorico) return;
    ultimaHistorico = faixa.chave;
    estado.historico = [faixa, ...estado.historico.filter((t) => t.chave !== faixa.chave)].slice(0, 40);
    salvar();
    if (parametros().rota === "biblioteca") { /* atualiza só na próxima visita */ }
  }

  // formulário criado dinamicamente (precisa estar no listener)
  document.addEventListener("submit", (ev) => {
    const form = ev.target.closest('form[data-form="nova-com-faixa"]');
    if (!form) return;
    ev.preventDefault();
    const nome = (new FormData(form).get("nome") || "").toString().trim();
    const chave = form.dataset.chave;
    if (!nome) return;
    const nova = { id: "u:" + Date.now().toString(36), nome, faixas: [], criadaEm: Date.now() };
    const t = obterFaixa(chave);
    if (t) nova.faixas.push(guardarFaixa({ ...t }));
    estado.playlists.unshift(nova);
    salvar();
    fecharModal();
    toast(`Playlist “${nome}” criada.`, "ok");
    location.hash = "#/playlist/" + nova.id;
  });

  document.addEventListener("DOMContentLoaded", iniciar);
  if (document.readyState !== "loading") iniciar();
})();
