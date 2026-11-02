/* FOXify — motor de busca de música.
   Motores: YouTube, Deezer e iTunes Search. Os adaptadores antigos continuam
   internos apenas para as estações do início; eles não aparecem no buscador. */
(function () {
  "use strict";

  const APP = "FOXify";
  const TTL = 10 * 60 * 1000;
  const TIMEOUT = 22000;
  const cache = new Map();
  let proxyDisponivel = null;
  let config = { youtubeKey: "", servidor: "" };

  function normalizarServidor(valor) {
    let s = String(valor || "").trim();
    if (!s) return "";
    if (!/^https?:\/\//i.test(s)) s = "http://" + s;
    try {
      const u = new URL(s);
      if (!/^https?:$/.test(u.protocol)) return "";
      return u.origin + (u.pathname && u.pathname !== "/" ? u.pathname.replace(/\/+$/, "") : "");
    } catch (_) {
      return "";
    }
  }

  function apiUrl(caminho) {
    const base = config.servidor ? String(config.servidor).replace(/\/+$/, "") : "";
    const p = String(caminho || "").replace(/^\/+/, "");
    return base ? base + "/" + p : p;
  }

  function configurar(c) {
    const novo = { youtubeKey: "", servidor: "", ...(c || {}) };
    novo.servidor = normalizarServidor(novo.servidor);
    if (novo.servidor !== config.servidor) proxyDisponivel = null;
    config = novo;
  }

  async function detectarProxy() {
    if (proxyDisponivel !== null) return proxyDisponivel;
    if (!/^https?:$/.test(location.protocol) && !config.servidor) return (proxyDisponivel = false);
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 2500);
      const r = await fetch(apiUrl("api/health"), { signal: ctl.signal, cache: "no-store" });
      clearTimeout(t);
      proxyDisponivel = r.ok && (await r.json()).ok === true;
    } catch (_) {
      proxyDisponivel = false;
    }
    return proxyDisponivel;
  }

  const erroProxy = () => {
    const e = new Error("Esta fonte precisa do servidor do FOXify. No APK, configure o endereço em Ajustes → Servidor.");
    e.codigo = "PROXY";
    return e;
  };

  async function textoDireto(url, timeout = TIMEOUT) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(url, {
        signal: ctl.signal,
        cache: "no-store",
        credentials: "omit",
        headers: { "Accept": "text/html,application/json,*/*" }
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.text();
    } finally {
      clearTimeout(t);
    }
  }

  async function pegarTexto(url, timeout = TIMEOUT) {
    try {
      return await textoDireto(url, timeout);
    } catch (erro) {
      if (!(await detectarProxy())) throw erroProxy();
      try {
        return await textoDireto(apiUrl("api/proxy?url=" + encodeURIComponent(url)), timeout + 8000);
      } catch (_) {
        throw erro;
      }
    }
  }

  async function pegarJson(url, timeout = TIMEOUT) {
    const texto = await pegarTexto(url, timeout);
    try {
      return JSON.parse(texto);
    } catch (_) {
      throw new Error("Resposta inválida de " + new URL(url, location.href).host);
    }
  }

  // Para hosts que sabidamente bloqueiam CORS (YouTube Music, Bandcamp):
  // vai direto no proxy e evita um erro de CORS no console a cada busca.
  async function textoProxy(url, timeout = TIMEOUT) {
    if (!(await detectarProxy())) throw erroProxy();
    return textoDireto(apiUrl("api/proxy?url=" + encodeURIComponent(url)), timeout + 8000);
  }

  async function jsonProxy(url, timeout = TIMEOUT) {
    const txt = await textoProxy(url, timeout);
    try { return JSON.parse(txt); }
    catch (_) { throw new Error("Resposta inválida de " + new URL(url, location.href).host); }
  }

  async function postProxyTexto(url, corpo, contentType) {
    if (!(await detectarProxy())) throw erroProxy();
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 30000);
    try {
      const r = await fetch(apiUrl("api/proxy"), {
        method: "POST",
        signal: ctl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, method: "POST", body: corpo, contentType })
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.text();
    } finally {
      clearTimeout(t);
    }
  }

  function doCache(chave, produtor) {
    const agora = Date.now();
    const item = cache.get(chave);
    if (item && agora - item.quando < TTL) return item.promessa;
    const promessa = produtor().catch((e) => { cache.delete(chave); throw e; });
    cache.set(chave, { quando: agora, promessa });
    return promessa;
  }

  const texto = (v) => (Array.isArray(v) ? v.join(", ") : (v || "")).toString().trim();
  const semAcento = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const seg = (v) => {
    if (typeof v === "number") return v;
    if (!v) return 0;
    if (/^\d+(\.\d+)?$/.test(v)) return parseFloat(v);
    const p = String(v).split(":").map(Number);
    if (p.length === 2) return p[0] * 60 + p[1];
    if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
    return 0;
  };
  const humanizar = (s) => decodeURIComponent(s || "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase());

  /* ------------------------------------------------------------------ Audius */
  function normalizarAudius(t) {
    const capa = (t.artwork && (t.artwork["480x480"] || t.artwork["150x150"])) || "";
    return {
      chave: "audius:" + t.id, id: "audius:" + t.id, fonte: "audius",
      idFonte: String(t.id), titulo: texto(t.title) || "Sem título",
      artista: texto(t.user && (t.user.name || t.user.handle)) || "Audius",
      capa, duracao: Number(t.duration) || 0, genero: t.genre || "",
      licenca: t.license || "",
      permalink: t.permalink ? "https://audius.co" + t.permalink : "",
      url: null, engine: "audio"
    };
  }

  async function audiusBuscar(termo, limite) {
    const url = `https://api.audius.co/v1/tracks/search?query=${encodeURIComponent(termo)}` +
      `&limit=${limite}&app_name=${APP}`;
    const dados = await pegarJson(url);
    return (dados.data || [])
      .filter((t) => t && t.is_streamable !== false && t.is_available !== false && !t.is_stream_gated &&
        Number(t.duration) >= 30 && Number(t.duration) <= 15 * 60)
      .map(normalizarAudius);
  }

  async function audiusGenero(genero, limite) {
    const url = `https://api.audius.co/v1/tracks/trending?genre=${encodeURIComponent(genero)}` +
      `&limit=${limite}&app_name=${APP}`;
    const dados = await pegarJson(url);
    return (dados.data || [])
      .filter((t) => t && t.is_streamable !== false && t.is_available !== false && !t.is_stream_gated)
      .map(normalizarAudius);
  }

  function urlAudius(t) {
    return `https://api.audius.co/v1/tracks/${encodeURIComponent(t.idFonte)}/stream?app_name=${APP}`;
  }

  /* --------------------------------------------------------- Internet Archive */
  let usaColecaoMusical = true;

  function normalizarArchive(doc) {
    return {
      chave: "archive:" + doc.identifier, id: "archive:" + doc.identifier,
      fonte: "archive", idFonte: doc.identifier,
      titulo: texto(doc.title) || doc.identifier,
      artista: texto(doc.creator) || "Internet Archive",
      capa: `https://archive.org/services/img/${encodeURIComponent(doc.identifier)}`,
      duracao: 0, genero: texto(doc.subject) || "Áudio",
      licenca: texto(doc.licenseurl) || "",
      permalink: "https://archive.org/details/" + encodeURIComponent(doc.identifier),
      url: null, engine: "audio", ano: texto(doc.year)
    };
  }

  async function archiveBuscar(termo, limite) {
    const limpo = termo.replace(/["\\]/g, " ").trim();
    const filtroMusical = usaColecaoMusical
      ? " AND (collection:(netlabels) OR collection:(audio_music))"
      : "";
    // Só itens de áudio: o filtro vai na consulta E é conferido no resultado.
    const q = `(${limpo}) AND mediatype:audio${filtroMusical}`;
    const url = "https://archive.org/advancedsearch.php?q=" + encodeURIComponent(q) +
      "&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator&fl%5B%5D=year&fl%5B%5D=subject" +
      "&fl%5B%5D=licenseurl&fl%5B%5D=downloads&fl%5B%5D=mediatype&sort%5B%5D=downloads+desc" +
      `&rows=${Math.min(100, Math.max(limite * 2, 24))}&page=1&output=json`;
    const dados = await pegarJson(url);
    const docs = ((dados.response && dados.response.docs) || []).filter((d) =>
      String(d.mediatype || "").toLowerCase() === "audio");
    if (!docs.length && usaColecaoMusical) {
      usaColecaoMusical = false;
      return archiveBuscar(termo, limite);
    }
    return docs.slice(0, limite).map(normalizarArchive);
  }

  const cacheResolucao = new Map();

  async function archiveResolver(id) {
    if (cacheResolucao.has(id)) return cacheResolucao.get(id);
    const p = (async () => {
      const meta = await pegarJson(`https://archive.org/metadata/${encodeURIComponent(id)}`, 20000);
      const arquivos = (meta.files || []).filter((f) =>
        /\.(mp3|ogg|m4a|flac)$/i.test(f.name) && !/__ia_thumb|_thumb\./i.test(f.name));
      const preferencia = ["VBR MP3", "128Kbps MP3", "64Kbps MP3", "MP3", "Ogg Vorbis", "Flac", "M4A"];
      arquivos.sort((a, b) => {
        const pa = preferencia.indexOf(a.format), pb = preferencia.indexOf(b.format);
        return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb);
      });
      const arq = arquivos[0];
      if (!arq) throw new Error("Item sem arquivo de áudio");
      const caminho = arq.name.split("/").map(encodeURIComponent).join("/");
      const info = meta.metadata || {};
      return {
        url: `https://archive.org/download/${encodeURIComponent(id)}/${caminho}`,
        duracao: seg(arq.length),
        titulo: texto(info.title) || undefined,
        artista: texto(info.creator) || undefined,
        capa: `https://archive.org/services/img/${encodeURIComponent(id)}`
      };
    })();
    cacheResolucao.set(id, p);
    p.catch(() => cacheResolucao.delete(id));
    return p;
  }

  /* ------------------------------------------------------------ Jamendo Music */
  function normalizarJamendo(t) {
    return {
      chave: "jamendo:" + t.id, id: "jamendo:" + t.id, fonte: "jamendo",
      idFonte: String(t.id),
      titulo: texto(t.name) || "Sem título",
      artista: texto(t.artist && t.artist.name) || "Jamendo Music",
      capa: (t.cover && ((t.cover.big && t.cover.big.size600) || (t.cover.small && t.cover.small.size300))) || "",
      duracao: Number(t.duration) || 0,
      genero: "",
      licenca: "Jamendo Music",
      permalink: "https://www.jamendo.com/track/" + t.id,
      url: (t.stream && t.stream.mp3) || null,
      engine: "audio"
    };
  }

  function popularidadeJamendo(t) {
    const s = t.stats || {};
    return Number(s.playcount || s.play_count || s.downloads || s.rate || 0) || 0;
  }

  function parseJamendoJina(markdown) {
    const itens = [];
    const vistos = new Set();
    const re = /\[([^\]]+)\]\((https:\/\/www\.jamendo\.com\/track\/(\d+)\/[^)]+)\)/g;
    let m;
    while ((m = re.exec(markdown))) {
      const id = m[3];
      if (vistos.has(id)) continue;
      const rotulo = m[1].replace(/\s+/g, " ").trim();
      const partes = rotulo.split(/\s+by\s+/i);
      const titulo = partes[0].trim() || "Jamendo";
      const artista = (partes[1] || "Jamendo Music").trim();
      vistos.add(id);
      itens.push({
        chave: "jamendo:" + id, id: "jamendo:" + id, fonte: "jamendo",
        idFonte: id, titulo, artista,
        capa: "assets/img/capas/sua-musica.jpg",
        duracao: 0, genero: "", licenca: "Jamendo Music",
        permalink: "https://www.jamendo.com/track/" + id,
        url: "https://prod-1.storage.jamendo.com/?trackid=" + encodeURIComponent(id) + "&format=mp31",
        engine: "audio"
      });
    }
    return itens;
  }

  async function jamendoJina(termo, limite) {
    const alvo = "https://www.jamendo.com/search?q=" + encodeURIComponent(termo);
    const markdown = await pegarTexto("https://r.jina.ai/" + alvo, 35000);
    const itens = parseJamendoJina(markdown);
    if (!itens.length) throw new Error("Jamendo não retornou resultados");
    return itens.slice(0, limite);
  }

  async function jamendoBuscar(termo, limite) {
    // O site só aceita limit=100; pedimos os mais populares e mostramos os primeiros.
    const base = "https://www.jamendo.com/api/search?query=" + encodeURIComponent(termo) +
      "&type=track&limit=100&identities=www";
    try {
      let dados;
      try {
        dados = await pegarJson(base + "&order=popularity_total", 30000);
      } catch (_) {
        dados = await pegarJson(base, 30000);
      }
      if (!Array.isArray(dados)) throw new Error("Jamendo retornou um formato inesperado");
      const faixas = dados.filter((t) => t && t.type === "track" && t.stream && t.stream.mp3 &&
        (!t.status || t.status.available !== false));
      faixas.sort((a, b) => popularidadeJamendo(b) - popularidadeJamendo(a));
      return faixas.slice(0, limite).map(normalizarJamendo);
    } catch (e) {
      // A API do site anda bloqueando alguns IPs (403). A busca pública via
      // Jina Reader continua funcionando e o stream aceita o ID direto.
      return jamendoJina(termo, limite);
    }
  }

  /* ------------------------------------------------------------------ YouTube */
  // O YouTube Music é o catálogo musical do YouTube: o filtro "Songs" abaixo
  // devolve apenas faixas/videoclipes oficiais (equivale à categoria Música 10).
  const YT_MUSIC_PARAMS = "EgWKAQIIAWoKEAkQBRAKEAMQBA==";
  let ytMusicCfg = null;

  async function configYoutubeMusic() {
    if (ytMusicCfg && Date.now() - ytMusicCfg.quando < 60 * 60 * 1000) return ytMusicCfg;
    const html = await textoProxy("https://music.youtube.com/", 30000);
    const chave = (html.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1];
    const versao = (html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) || [])[1];
    if (!chave) throw new Error("YouTube Music não expôs a configuração da API");
    ytMusicCfg = { chave, versao: versao || "1.20261027.10.00", quando: Date.now() };
    return ytMusicCfg;
  }

  function ytTextoColuna(r, i) {
    const col = (r.flexColumns || [])[i];
    const txt = col && col.musicResponsiveListItemFlexColumnRenderer && col.musicResponsiveListItemFlexColumnRenderer.text;
    if (!txt) return "";
    return (txt.runs || []).map((x) => x.text || "").join("") || txt.simpleText || "";
  }

  function ytVideoId(r) {
    try {
      return r.overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer
        .playNavigationEndpoint.watchEndpoint.videoId;
    } catch (_) { /* tenta outras formas */ }
    return (r.playlistItemData && r.playlistItemData.videoId) ||
      (r.navigationEndpoint && r.navigationEndpoint.watchEndpoint && r.navigationEndpoint.watchEndpoint.videoId) || null;
  }

  function ytTipo(r) {
    try {
      return r.overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer
        .playNavigationEndpoint.watchEndpoint.watchEndpointMusicSupportedConfigs
        .watchEndpointMusicConfig.musicVideoType;
    } catch (_) {
      return null;
    }
  }

  function ytViews(txt) {
    const m = String(txt || "").match(/([\d.,]+)\s*(mil|mi|bi|milh(?:ão|ões)|bilh(?:ão|ões))?/i);
    if (!m) return 0;
    let n = Number(m[1].replace(/\./g, "").replace(",", "."));
    if (!isFinite(n)) return 0;
    const u = String(m[2] || "").toLowerCase();
    if (u === "bi" || u.startsWith("bilh")) n *= 1e9;
    else if (u === "mi" || u.startsWith("milh")) n *= 1e6;
    else if (u === "mil") n *= 1e3;
    return Math.round(n);
  }

  function normalizarYoutubeMusic(r) {
    const videoId = ytVideoId(r);
    if (!videoId) return null;
    const tipo = ytTipo(r);
    // ATV = faixa de catálogo (official audio); OMV = videoclipe oficial.
    if (tipo && tipo !== "MUSIC_VIDEO_TYPE_ATV" && tipo !== "MUSIC_VIDEO_TYPE_OMV") return null;
    const titulo = ytTextoColuna(r, 0);
    if (!titulo) return null;
    const linha = ytTextoColuna(r, 1);
    const partes = linha.split("•").map((s) => s.trim()).filter(Boolean);
    const artista = partes[0] || "YouTube Music";
    let duracao = 0;
    for (const p of partes) {
      if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(p)) duracao = seg(p);
    }
    const vistas = ytViews(ytTextoColuna(r, 2) || linha);
    let capa = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    try {
      const thumbs = r.thumbnail.musicThumbnailRenderer.thumbnail.thumbnails;
      capa = thumbs[thumbs.length - 1].url || capa;
    } catch (_) { /* mantém ytimg */ }
    return {
      chave: "youtube:" + videoId, id: "youtube:" + videoId, fonte: "youtube",
      idFonte: videoId, titulo, artista, capa, duracao,
      genero: "", licenca: "YouTube Music", vistas,
      permalink: "https://youtu.be/" + videoId, url: null, engine: "youtube"
    };
  }

  function parseYoutube(html) {
    let m = html.match(/var ytInitialData\s*=\s*(\{[\s\S]*?\});<\/script>/);
    if (!m) m = html.match(/ytInitialData"?\s*[:=]\s*(\{[\s\S]*?\});/);
    if (!m) throw new Error("YouTube não devolveu resultados (consentimento/bloqueio?)");
    let dados;
    try { dados = JSON.parse(m[1]); } catch (_) { throw new Error("Falha ao ler o YouTube"); }
    const videos = [];
    const visitar = (o) => {
      if (!o || typeof o !== "object") return;
      if (o.videoRenderer) videos.push(o.videoRenderer);
      if (o.compactVideoRenderer) videos.push(o.compactVideoRenderer);
      for (const k in o) visitar(o[k]);
    };
    visitar(dados);
    return videos;
  }

  function normalizarYoutube(v) {
    const titulo = (v.title && v.title.runs ? v.title.runs.map((r) => r.text).join("") : "") ||
      (v.title && v.title.simpleText) || "YouTube";
    const dono = (v.ownerText && v.ownerText.runs ? v.ownerText.runs[0].text : "") ||
      (v.longBylineText && v.longBylineText.runs ? v.longBylineText.runs[0].text : "") || "YouTube";
    const durTxt = (v.lengthText && v.lengthText.simpleText) || "";
    const duracao = seg(durTxt);
    const miniatura = v.thumbnail && v.thumbnail.thumbnails && v.thumbnail.thumbnails.length
      ? v.thumbnail.thumbnails[v.thumbnail.thumbnails.length - 1].url
      : `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;
    return {
      chave: "youtube:" + v.videoId, id: "youtube:" + v.videoId, fonte: "youtube",
      idFonte: v.videoId, titulo, artista: dono, capa: miniatura, duracao,
      genero: "", licenca: "YouTube", vistas: 0,
      permalink: "https://youtu.be/" + v.videoId,
      url: null, engine: "youtube"
    };
  }

  function isoDuracao(iso) {
    const m = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || "");
    if (!m) return 0;
    return (Number(m[1]) || 0) * 86400 + (Number(m[2]) || 0) * 3600 +
      (Number(m[3]) || 0) * 60 + (Number(m[4]) || 0);
  }

  function limparEntidades(s) {
    return String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  }

  async function youtubeDataBuscar(termo, limite) {
    const chave = String(config.youtubeKey || "").trim();
    if (!chave) throw new Error("Sem chave da API do YouTube");
    // Caminho oficial e estrito: videoCategoryId=10 (Música) + "official".
    const consulta = termo + " official";
    const base = "https://www.googleapis.com/youtube/v3/";
    const busca = base + "search?part=snippet&type=video&videoCategoryId=10&order=relevance" +
      "&maxResults=" + Math.min(50, Math.max(12, limite)) +
      "&q=" + encodeURIComponent(consulta) + "&key=" + encodeURIComponent(chave);
    const dados = await pegarJson(busca, 30000);
    const itens = (dados.items || []).filter((i) => i && i.id && i.id.videoId);
    if (!itens.length) throw new Error("YouTube Data API não retornou vídeos");
    const ids = itens.map((i) => i.id.videoId);
    const duracoes = {};
    try {
      const vids = await pegarJson(base + "videos?part=contentDetails&id=" + ids.join(",") +
        "&key=" + encodeURIComponent(chave), 30000);
      for (const v of vids.items || []) duracoes[v.id] = isoDuracao(v.contentDetails && v.contentDetails.duration);
    } catch (_) { /* segue sem duração; o player descobre */ }
    return itens.map((i) => {
      const s = i.snippet || {};
      const id = i.id.videoId;
      const capa = (s.thumbnails && ((s.thumbnails.high && s.thumbnails.high.url) ||
        (s.thumbnails.medium && s.thumbnails.medium.url))) ||
        `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
      return {
        chave: "youtube:" + id, id: "youtube:" + id, fonte: "youtube",
        idFonte: id, titulo: limparEntidades(s.title) || "YouTube",
        artista: limparEntidades(s.channelTitle) || "YouTube",
        capa, duracao: duracoes[id] || 0, genero: "", licenca: "YouTube", vistas: 0,
        permalink: "https://youtu.be/" + id, url: null, engine: "youtube"
      };
    }).filter((t) => !t.duracao || (t.duracao >= 30 && t.duracao <= 15 * 60)).slice(0, limite);
  }

  async function youtubeMusicBuscar(termo, limite) {
    // Sempre busca "official" e usa o catálogo de música do YouTube Music.
    const consulta = termo + " official";
    const cfg = await configYoutubeMusic();
    const corpo = JSON.stringify({
      context: { client: { clientName: "WEB_REMIX", clientVersion: cfg.versao, hl: "pt", gl: "BR" } },
      query: consulta,
      params: YT_MUSIC_PARAMS
    });
    const alvo = "https://music.youtube.com/youtubei/v1/search?key=" + encodeURIComponent(cfg.chave);
    const textoApi = await postProxyTexto(alvo, corpo, "application/json");
    let dados;
    try { dados = JSON.parse(textoApi); } catch (_) { throw new Error("YouTube Music devolveu uma resposta inválida"); }
    const brutos = [];
    const visitar = (o) => {
      if (!o || typeof o !== "object") return;
      if (o.musicResponsiveListItemRenderer) brutos.push(o.musicResponsiveListItemRenderer);
      for (const k in o) visitar(o[k]);
    };
    visitar(dados);
    const vistos = new Set();
    const itens = [];
    for (const r of brutos) {
      const t = normalizarYoutubeMusic(r);
      if (!t || vistos.has(t.idFonte)) continue;
      if (t.duracao < 30 || t.duracao > 15 * 60) continue;
      vistos.add(t.idFonte);
      itens.push(t);
    }
    if (!itens.length) throw new Error("YouTube Music não retornou faixas");
    // Mantém a ordem de relevância do YouTube Music; ela já prioriza o termo
    // buscado. Ordenar por views trazia hits populares fora do tema.
    return itens.slice(0, limite);
  }

  async function youtubeHtmlBuscar(termo, limite) {
    const consulta = termo + " official";
    const bases = [
      "https://www.youtube.com/results?search_query=" + encodeURIComponent(consulta) +
        "&hl=pt&gl=BR&sp=EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D",
      "https://www.youtube.com/results?search_query=" + encodeURIComponent(consulta) +
        "&hl=pt&gl=BR&sp=EgIQAQ%3D%3D"
    ];
    for (const url of bases) {
      try {
        const html = await pegarTexto(url, 30000);
        const vistos = new Set();
        const vids = parseYoutube(html).filter((v) => {
          if (!v.videoId || vistos.has(v.videoId) || v.upcomingEventData) return false;
          vistos.add(v.videoId);
          const d = seg((v.lengthText && v.lengthText.simpleText) || "");
          return d >= 30 && d <= 15 * 60;
        });
        if (vids.length) return vids.slice(0, limite).map(normalizarYoutube);
      } catch (_) { /* tenta o próximo filtro */ }
    }
    throw new Error("YouTube não retornou resultados");
  }

  async function youtubeBuscar(termo, limite) {
    const limpo = String(termo || "").replace(/\s+/g, " ").trim();
    if (String(config.youtubeKey || "").trim()) {
      try {
        return await youtubeDataBuscar(limpo, limite);
      } catch (_) { /* chave inválida/sem cota: cai no YouTube Music */ }
    }
    try {
      return await youtubeMusicBuscar(limpo, limite);
    } catch (e) {
      if (e && e.codigo === "PROXY") throw e;
      return youtubeHtmlBuscar(limpo, limite);
    }
  }

  /* ------------------------------------------------------------------ Bandcamp */
  function parseBandcamp(markdown) {
    const itens = [];
    const blocos = markdown.split(/\n\s*\*\s+(?=\[!\[)/).slice(1);
    for (const bloco of blocos) {
      const m = bloco.match(/\[!\[[^\]]*\]\(([^)]+)\)\]\((https?:\/\/[^)\s]+)\)([\s\S]*)/);
      if (!m) continue;
      const capa = m[1];
      const link = m[2];
      const resto = m[3] || "";
      const idM = link.match(/search_item_id=(\d+)/);
      const tipoM = link.match(/search_item_type=([ta])/);
      if (!idM) continue;
      const tipo = tipoM ? tipoM[1] : "t";
      if (tipo !== "t") continue;
      const slugM = link.match(/\/track\/([^?]+)/);
      const artistaM = resto.match(/\nby\s+([^\n*]+)/) || resto.match(/from\s+[^\n]*\s+by\s+([^\n*]+)/);
      const rankM = link.match(/search_rank=(\d+)/);
      itens.push({
        chave: "bandcamp:" + idM[1], id: "bandcamp:" + idM[1], fonte: "bandcamp",
        idFonte: idM[1],
        titulo: slugM ? humanizar(slugM[1]) : "Bandcamp",
        artista: artistaM ? artistaM[1].trim() : "Bandcamp",
        capa: capa.replace(/\/img\/(a\d+)_\d+\.jpg/, "/img/$1_16.jpg"),
        duracao: 0, genero: "", licenca: "Bandcamp",
        permalink: link.split("?")[0],
        ordem: rankM ? Number(rankM[1]) : 999,
        url: null, engine: "audio"
      });
    }
    return itens;
  }

  let cacheBandcampTop = { quando: 0, ids: new Set() };

  async function bandcampPopulares() {
    if (Date.now() - cacheBandcampTop.quando < 30 * 60 * 1000) return cacheBandcampTop.ids;
    try {
      const dados = await jsonProxy("https://bandcamp.com/api/discover/3/get_web?g=all&s=top&p=0&n=100", 20000);
      const ids = new Set();
      for (const item of dados.items || []) {
        if (item.id) ids.add(String(item.id));
        if (item.featured_track && item.featured_track.id) ids.add(String(item.featured_track.id));
      }
      cacheBandcampTop = { quando: Date.now(), ids };
    } catch (_) { /* se o Top falhar, usa a ordem de busca do Bandcamp */ }
    return cacheBandcampTop.ids;
  }

  async function bandcampBuscar(termo, limite) {
    const alvo = "https://bandcamp.com/search?q=" + encodeURIComponent(termo) + "&item_type=t";
    const popularesPromessa = bandcampPopulares();
    let itens = [];
    for (let tentativa = 0; tentativa < 2 && !itens.length; tentativa++) {
      const markdown = await pegarTexto("https://r.jina.ai/" + alvo +
        "&_=" + Date.now() + "-" + tentativa, 30000);
      itens = parseBandcamp(markdown);
      if (!itens.length) await new Promise((r) => setTimeout(r, 800));
    }
    const populares = await popularesPromessa;
    if (!itens.length) throw new Error("Bandcamp não retornou resultados");
    // O Bandcamp não publica contagem de plays por faixa. Priorizamos o que
    // está no Top Discover (mais ouvido/comprado) e, depois, o ranking da busca.
    itens.sort((a, b) => {
      const pa = populares.has(String(a.idFonte)) ? 0 : 1;
      const pb = populares.has(String(b.idFonte)) ? 0 : 1;
      return pa - pb || (a.ordem || 999) - (b.ordem || 999);
    });
    return itens.slice(0, limite);
  }

  async function bandcampResolver(faixa) {
    const url = "https://bandcamp.com/EmbeddedPlayer/track=" + encodeURIComponent(faixa.idFonte) +
      "/size=large/bgcol=333333/linkcol=0f91ff/artwork=small/transparent=true/";
    const html = await pegarTexto(url, 20000);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const el = doc.querySelector("[data-player-data]");
    if (!el) throw new Error("Bandcamp não expôs o player");
    const dados = JSON.parse(el.getAttribute("data-player-data"));
    const tr = (dados.tracks || []).find((t) => String(t.id) === String(faixa.idFonte)) || (dados.tracks || [])[0];
    if (!tr || !tr.file || !tr.file["mp3-128"]) throw new Error("Bandcamp sem stream público");
    faixa.url = tr.file["mp3-128"];
    faixa.titulo = tr.title || faixa.titulo;
    faixa.artista = tr.artist || dados.artist || faixa.artista;
    faixa.duracao = Number(tr.duration) || faixa.duracao;
    faixa.capa = tr.art_lg || tr.art || faixa.capa;
    faixa.genero = dados.album_title || "";
    return { url: faixa.url, duracao: faixa.duracao };
  }

  /* ---------------------------------------------------------------- HearThis */
  function normalizarHearthis(li) {
    const d = li.dataset;
    const id = d.trackid || d.id;
    const detalhe = d.detail || "";
    const html = li.innerHTML || "";
    const streamM = html.match(/https:\/\/hearthis\.app\/[^"'\s<>]+stream\.mp3[^"'\s<>]*/);
    const url = streamM ? streamM[0].replace(/&amp;/g, "&") : null;
    const titulo = d.playlistTitle || humanizar((detalhe.split("/").filter(Boolean).pop()) || "HearThis");
    const textoLi = " " + String(li.textContent || "").replace(/\s+/g, " ");
    // O HearThis mostra o total de reproduções antes do aviso de erro,
    // em português ("Mais70Não foi possível...") ou inglês ("More83This sound...").
    const mPlays = textoLi.match(/([\d.,]+)\s*(?:Não foi possível reproduzir|This sound could not be played)/i);
    const plays = mPlays ? Number(mPlays[1].replace(/[.,]/g, "")) || 0 : 0;
    return {
      chave: "hearthis:" + id, id: "hearthis:" + id, fonte: "hearthis",
      idFonte: id, detalhe,
      titulo, artista: d.playlistAuthor || "HearThis.at",
      capa: d.playlistImage || "",
      duracao: Number(d.length || d.duration) || 0,
      genero: "", licenca: "HearThis.at",
      kind: d.kind || "audio", plays, texto: textoLi.trim(),
      permalink: detalhe ? "https://hearthis.at" + detalhe : "",
      url, engine: "audio"
    };
  }

  const lixoHearthis = /\b(podcast|radio\s*show|episode|dj\s*set|live\s*set|essential\s*mix|ranking\s+of\s+the\s+week)\b/i;

  async function hearthisBuscar(termo, limite) {
    const corpo = new URLSearchParams({
      searchtext: termo,
      "show-search-category": "",
      "show-search-length": "5",
      "show-search-start": "",
      "show-search-end": "",
      min: "0",
      max: "30"
    }).toString();
    const html = await postProxyTexto("https://hearthis.at/index_ajax_search_more.php", corpo,
      "application/x-www-form-urlencoded; charset=UTF-8");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const lis = Array.from(doc.querySelectorAll("li[data-trackid]")).slice(0, 40);
    if (!lis.length) throw new Error("HearThis não retornou resultados");
    const todos = lis.map(normalizarHearthis).filter((t) => t.idFonte);
    // Faixas curtas (até 6 min); sets, podcasts e rankings ficam de fora.
    const faixas = todos.filter((t) =>
      (!t.kind || t.kind === "audio") &&
      t.duracao >= 30 && t.duracao <= 6 * 60 &&
      !lixoHearthis.test(t.titulo) && !lixoHearthis.test(t.artista));
    const base = faixas.length ? faixas : todos.filter((t) => (!t.kind || t.kind === "audio") && t.duracao <= 6 * 60);
    base.sort((a, b) => (b.plays || 0) - (a.plays || 0));
    return base.slice(0, limite);
  }

  async function hearthisResolver(faixa) {
    if (!faixa.detalhe) throw new Error("HearThis sem endereço da faixa");
    const html = await pegarTexto("https://hearthis.at" + faixa.detalhe, 20000);
    const m = html.match(/https:\/\/hearthis\.app\/[^"'\s<>]+stream\.mp3[^"'\s<>]*/);
    if (!m) throw new Error("HearThis sem stream público");
    faixa.url = m[0].replace(/&amp;/g, "&");
    return { url: faixa.url, duracao: faixa.duracao };
  }

  /* --------------------------------------------------------------- Deezer */
  async function deezerBuscar(termo, limite) {
    const alvo = "https://api.deezer.com/search?q=" + encodeURIComponent(termo) +
      "&limit=" + Math.min(50, Math.max(limite, 14));
    const dados = await jsonProxy(alvo, 20000);
    if (!dados || !Array.isArray(dados.data)) throw new Error("Deezer não retornou resultados");
    const itens = dados.data
      .filter((t) => t && t.preview && t.title)
      .map((t, i) => ({
        chave: "deezer:" + t.id, id: "deezer:" + t.id, fonte: "deezer",
        idFonte: String(t.id), titulo: t.title,
        artista: (t.artist && t.artist.name) || "Deezer",
        capa: (t.album && (t.album.cover_xl || t.album.cover_big || t.album.cover_medium)) || "",
        duracao: t.duration || 30, genero: "", licenca: "Deezer", vistas: 0,
        previa: false, duracaoOriginal: t.duration || 0, url: null,
        preview: String(t.preview).replace(/^http:/, "https:"),
        permalink: t.link || "", ordem: i, popularidade: t.rank || 0
      }));
    itens.sort((a, b) => b.popularidade - a.popularidade);
    return itens.slice(0, limite);
  }

  /* ---------------------------------------------------------------- iTunes */
  async function itunesBuscar(termo, limite) {
    const alvo = "https://itunes.apple.com/search?term=" + encodeURIComponent(termo) +
      "&media=music&entity=song&limit=" + Math.min(50, Math.max(limite, 14)) + "&country=BR";
    let dados = null;
    let ultimoErro = null;
    // O iTunes Search limita requisições por IP; tenta mais uma vez antes de desistir.
    for (let tentativa = 0; tentativa < 2 && !dados; tentativa++) {
      try {
        dados = await jsonProxy(alvo, 20000);
      } catch (e) {
        ultimoErro = e;
        if (tentativa === 0) await new Promise((r) => setTimeout(r, 1200));
      }
    }
    if (!dados) throw ultimoErro || new Error("iTunes não respondeu");
    if (!Array.isArray(dados.results)) throw new Error("iTunes não retornou resultados");
    const itens = dados.results
      .filter((t) => t && t.previewUrl && t.trackName)
      .map((t, i) => ({
        chave: "itunes:" + t.trackId, id: "itunes:" + t.trackId, fonte: "itunes",
        idFonte: String(t.trackId || ""), titulo: t.trackName,
        artista: t.artistName || "Apple Music",
        album: t.collectionName || "",
        capa: String(t.artworkUrl100 || "")
          .replace("100x100bb", "600x600bb").replace("100x100", "600x600"),
        duracao: Math.round((t.trackTimeMillis || 0) / 1000) || 30,
        genero: t.primaryGenreName || "",
        licenca: "Apple Music", vistas: 0,
        previa: false, duracaoOriginal: Math.round((t.trackTimeMillis || 0) / 1000),
        url: null, preview: t.previewUrl, permalink: t.trackViewUrl || "",
        ordem: i, popularidade: 0
      }));
    return itens.slice(0, limite);
  }

  /* ---------------------------------------------------------------- álbuns */
  function albumDeezer(a, nomeArtista) {
    return {
      tipo: "album", chave: "deezer-album:" + a.id, id: "deezer-album:" + a.id,
      fonte: "deezer", idFonte: String(a.id), titulo: a.title || "Álbum",
      artista: (a.artist && a.artist.name) || nomeArtista || "Deezer",
      capa: a.cover_xl || a.cover_big || a.cover_medium || "",
      ano: String(a.release_date || "").slice(0, 4),
      total: a.nb_tracks || 0, permalink: a.link || ""
    };
  }

  async function deezerAlbuns(termo, limite) {
    let artista = null;
    try {
      const achados = await jsonProxy(
        "https://api.deezer.com/search/artist?q=" + encodeURIComponent(termo) + "&limit=1", 20000);
      artista = achados && achados.data && achados.data[0];
    } catch (_) { /* tenta a busca direta de álbuns */ }
    let dados = null;
    if (artista && artista.id) {
      dados = await jsonProxy(
        "https://api.deezer.com/artist/" + encodeURIComponent(artista.id) + "/albums?limit=" +
        Math.min(50, Math.max(limite, 12)), 20000);
    }
    if (!dados || !Array.isArray(dados.data) || !dados.data.length) {
      dados = await jsonProxy(
        "https://api.deezer.com/search/album?q=" + encodeURIComponent(termo) + "&limit=" +
        Math.min(50, Math.max(limite, 12)), 20000);
    }
    if (!dados || !Array.isArray(dados.data)) throw new Error("Deezer não retornou álbuns");
    const vistos = new Set();
    return dados.data
      .filter((a) => a && a.id && a.title && !vistos.has(a.id) && vistos.add(a.id))
      .map((a) => albumDeezer(a, artista && artista.name))
      .slice(0, limite);
  }

  function albumItunes(a) {
    return {
      tipo: "album", chave: "itunes-album:" + a.collectionId, id: "itunes-album:" + a.collectionId,
      fonte: "itunes", idFonte: String(a.collectionId), titulo: a.collectionName || "Álbum",
      artista: a.artistName || "Apple Music",
      capa: String(a.artworkUrl100 || "")
        .replace("100x100bb", "600x600bb").replace("100x100", "600x600"),
      ano: String(a.releaseDate || "").slice(0, 4),
      total: a.trackCount || 0, permalink: a.collectionViewUrl || ""
    };
  }

  async function itunesAlbuns(termo, limite) {
    const alvo = "https://itunes.apple.com/search?term=" + encodeURIComponent(termo) +
      "&media=music&entity=album&limit=" + Math.min(50, Math.max(limite, 12)) + "&country=BR";
    const dados = await jsonProxy(alvo, 20000);
    if (!dados || !Array.isArray(dados.results)) throw new Error("iTunes não retornou álbuns");
    const vistos = new Set();
    return dados.results
      .filter((a) => a && a.collectionId && a.collectionName &&
        (a.collectionType === "Album" || a.wrapperType === "collection") &&
        !vistos.has(a.collectionId) && vistos.add(a.collectionId))
      .map(albumItunes)
      .slice(0, limite);
  }

  async function buscarAlbuns(termo, fontesAtivas, limite = 24) {
    const ativas = (fontesAtivas && fontesAtivas.length ? fontesAtivas : ["deezer", "itunes"])
      .filter((f) => f === "deezer" || f === "itunes");
    const tarefas = ativas.map(async (fonte) => {
      try {
        const itens = fonte === "deezer"
          ? await deezerAlbuns(termo, limite)
          : await itunesAlbuns(termo, limite);
        return { fonte, itens, erro: null };
      } catch (e) {
        return { fonte, itens: [], erro: e && e.name === "AbortError" ? "tempo" : "falha" };
      }
    });
    const grupos = await Promise.all(tarefas);
    const saida = [];
    const max = Math.max(0, ...grupos.map((g) => g.itens.length));
    for (let i = 0; i < max && saida.length < limite; i++) {
      for (const g of grupos) if (g.itens[i]) saida.push(g.itens[i]);
    }
    return { itens: saida.slice(0, limite), grupos };
  }

  async function deezerFaixasAlbum(id) {
    const dados = await jsonProxy(
      "https://api.deezer.com/album/" + encodeURIComponent(id), 20000);
    if (!dados || !dados.tracks || !Array.isArray(dados.tracks.data)) {
      throw new Error("Deezer não retornou as faixas do álbum");
    }
    return dados.tracks.data.filter((t) => t && t.title).map((t, i) => ({
      chave: "deezer:" + t.id, id: "deezer:" + t.id, fonte: "deezer",
      idFonte: String(t.id), titulo: t.title,
      artista: (t.artist && t.artist.name) || (dados.artist && dados.artist.name) || "Deezer",
      album: dados.title || "",
      capa: (dados.cover_xl || dados.cover_big || dados.cover_medium || ""),
      duracao: t.duration || 30, genero: "", licenca: "Deezer", vistas: 0,
      previa: false, duracaoOriginal: t.duration || 0, url: null,
      preview: String(t.preview || "").replace(/^http:/, "https:"),
      permalink: t.link || dados.link || "", ordem: i, popularidade: t.rank || 0
    }));
  }

  async function itunesFaixasAlbum(id) {
    const alvo = "https://itunes.apple.com/lookup?id=" + encodeURIComponent(id) +
      "&entity=song&limit=200&country=BR";
    const dados = await jsonProxy(alvo, 20000);
    if (!dados || !Array.isArray(dados.results)) {
      throw new Error("iTunes não retornou as faixas do álbum");
    }
    return dados.results
      .filter((t) => t && t.wrapperType === "track" && t.trackName)
      .map((t, i) => ({
        chave: "itunes:" + t.trackId, id: "itunes:" + t.trackId, fonte: "itunes",
        idFonte: String(t.trackId || ""), titulo: t.trackName,
        artista: t.artistName || "Apple Music",
        album: t.collectionName || "",
        capa: String(t.artworkUrl100 || "")
          .replace("100x100bb", "600x600bb").replace("100x100", "600x600"),
        duracao: Math.round((t.trackTimeMillis || 0) / 1000) || 30,
        genero: t.primaryGenreName || "", licenca: "Apple Music", vistas: 0,
        previa: false, duracaoOriginal: Math.round((t.trackTimeMillis || 0) / 1000),
        url: null, preview: t.previewUrl || "", permalink: t.trackViewUrl || "",
        ordem: i, popularidade: 0
      }));
  }

  async function faixasDoAlbum(fonte, id) {
    if (fonte === "deezer") return deezerFaixasAlbum(id);
    if (fonte === "itunes") return itunesFaixasAlbum(id);
    throw new Error("Fonte de álbum desconhecida");
  }

  /* ------------------------------------------------------------------ motor */
  const buscadores = {
    audius: (termo, limite) => doCache("audius:" + termo + ":" + limite, () => audiusBuscar(termo, limite)),
    archive: (termo, limite) => doCache("archive:" + termo + ":" + limite, () => archiveBuscar(termo, limite)),
    jamendo: (termo, limite) => doCache("jamendo:" + termo + ":" + limite, () => jamendoBuscar(termo, limite)),
    youtube: (termo, limite) => doCache("youtube:" + termo + ":" + limite, () => youtubeBuscar(termo, limite)),
    deezer: (termo, limite) => doCache("deezer:" + termo + ":" + limite, () => deezerBuscar(termo, limite)),
    itunes: (termo, limite) => doCache("itunes:" + termo + ":" + limite, () => itunesBuscar(termo, limite))
  };

  async function buscarEm(fonte, termo, limite = 14) {
    if (!buscadores[fonte]) return [];
    return buscadores[fonte](termo, limite);
  }

  async function buscar(termo, fontesAtivas, limite = 14) {
    const ativas = (fontesAtivas || []).filter((f) => buscadores[f]);
    const tarefas = ativas.map(async (fonte) => {
      try {
        const itens = await buscarEm(fonte, termo, limite);
        return { fonte, itens, erro: null };
      } catch (e) {
        let erro = "falha";
        if (e && e.codigo === "PROXY") erro = "proxy";
        else if (e && e.name === "AbortError") erro = "tempo";
        else if (typeof navigator !== "undefined" && navigator.onLine === false) erro = "offline";
        return { fonte, itens: [], erro };
      }
    });
    return Promise.all(tarefas);
  }

  const chaveCuradoria = (s) => semAcento(String(s || "")).toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

  async function curadoriaBuscar(est, limite) {
    const sementes = (est.seeds || []).filter(Boolean);
    const listas = [];
    // Consulta os artistas-semente em blocos para não estourar a API do Deezer.
    for (let i = 0; i < sementes.length; i += 4) {
      const bloco = sementes.slice(i, i + 4);
      const respostas = await Promise.all(bloco.map(async (s) => ({
        semente: s,
        itens: await deezerBuscar(s, 3).catch(() => [])
      })));
      listas.push(...respostas);
      if (listas.reduce((n, r) => n + r.itens.length, 0) >= limite) break;
    }
    const itens = [];
    const vistos = new Set();
    for (const { semente, itens: lista } of listas) {
      const alvo = chaveCuradoria(semente);
      const filtrados = lista.filter((t) => {
        const artista = chaveCuradoria(t.artista);
        return artista.includes(alvo) || alvo.includes(artista);
      });
      for (const t of filtrados) {
        const chave = chaveCuradoria(t.titulo + " " + t.artista);
        if (!chave || vistos.has(chave)) continue;
        vistos.add(chave);
        itens.push(t);
        if (itens.length >= limite) break;
      }
      if (itens.length >= limite) break;
    }
    if (itens.length < limite && est.consulta) {
      try {
        const extra = await deezerBuscar(est.consulta, limite - itens.length);
        for (const t of extra) {
          const chave = chaveCuradoria(t.titulo + " " + t.artista);
          if (!chave || vistos.has(chave)) continue;
          vistos.add(chave);
          itens.push(t);
          if (itens.length >= limite) break;
        }
      } catch (_) { /* mantém o que já foi encontrado */ }
    }
    if (!itens.length && est.consulta) {
      try { itens.push(...(await itunesBuscar(est.consulta, limite))); } catch (_) {}
    }
    return itens.slice(0, limite);
  }

  async function carregarEstacao(est) {
    if (!est) return [];
    const limite = 30;
    let itens = [];
    if (est.modo === "curadoria") {
      itens = await doCache("curadoria:" + est.id + ":" + limite, () => curadoriaBuscar(est, limite));
    } else if (est.modo === "genero") itens = await audiusGenero(est.genero, limite);
    else itens = await buscarEm(est.fonte, est.consulta, limite);
    return itens;
  }

  function demoDaEstacao(est) {
    const ids = (est && est.demo) || [];
    return ids.map((id) => FOX_DADOS.porIdDemo[id]).filter(Boolean);
  }

  async function youtubeAudio(faixa) {
    if (!(await detectarProxy())) throw erroProxy();
    return {
      url: apiUrl("api/youtube-stream?videoId=" + encodeURIComponent(faixa.idFonte) +
        "&t=" + Date.now()),
      duracao: faixa.duracao,
      engine: "audio",
      videoId: faixa.idFonte,
      fallbackVideoId: faixa.idFonte,
      titulo: faixa.titulo,
      artista: faixa.artista
    };
  }

  // Na nuvem, o endpoint /api/youtube-audio resolve uma URL direta do CDN.
  // O áudio passa pelo proxy (com Range) e toca no elemento <audio>, o que
  // permite continuar em segundo plano e mostrar os controles na notificação.
  async function audioNuvemVideo(videoId, faixa) {
    if (!videoId) throw new Error("videoId ausente");
    if (!(await detectarProxy())) throw erroProxy();
    const r = await fetch(apiUrl("api/youtube-audio?videoId=" + encodeURIComponent(videoId)), {
      cache: "no-store"
    });
    if (!r.ok) throw new Error("resolver YouTube HTTP " + r.status);
    const info = await r.json();
    if (!info || !info.url) throw new Error("resolver YouTube sem URL");
    const url = info.direto
      ? info.url
      : apiUrl("api/proxy?url=" + encodeURIComponent(info.url));
    if (info.titulo && !faixa.titulo) faixa.titulo = info.titulo;
    if (info.artista && !faixa.artista) faixa.artista = info.artista;
    if (info.duracao && !faixa.duracao) faixa.duracao = info.duracao;
    faixa.viaYoutube = true;
    faixa.previa = false;
    return {
      url,
      duracao: info.duracao || faixa.duracao,
      engine: "audio",
      videoId,
      fallbackVideoId: videoId,
      titulo: faixa.titulo,
      artista: faixa.artista
    };
  }

  function escolherYoutube(resultados, faixa) {
    const lista = (resultados || []).filter((r) => r && r.idFonte);
    if (!lista.length) return null;
    const alvo = Number(faixa && faixa.duracao) || 0;
    const nota = (r) => {
      const d = Number(r.duracao) || 0;
      let valor = alvo && d ? Math.abs(d - alvo) : 999;
      if (d && d < 45) valor += 500;
      return valor;
    };
    return lista.slice().sort((a, b) => nota(a) - nota(b))[0];
  }

  async function audioNuvemFaixa(faixa) {
    try {
      const consulta = `${faixa.titulo || ""} ${faixa.artista || ""} ${faixa.album || ""} official`.trim();
      const achados = await youtubeBuscar(consulta, 5);
      const alvo = escolherYoutube(achados, faixa);
      if (!alvo) return null;
      return await audioNuvemVideo(alvo.idFonte, faixa);
    } catch (_) {
      return null;
    }
  }

  function naNuvem() {
    let host = location.hostname;
    if (config.servidor) {
      try { host = new URL(config.servidor).hostname; } catch (_) {}
    }
    if (!host || host === "localhost" || host === "127.0.0.1" || host === "::1") return false;
    if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    return true;
  }

  async function tentarYoutubeCompleto(faixa) {
    try {
      const consulta = `${faixa.titulo || ""} ${faixa.artista || ""} ${faixa.album || ""} official`.trim();
      const resultados = await youtubeBuscar(consulta, 5);
      const alvo = escolherYoutube(resultados, faixa);
      if (!alvo) return null;
      const info = await youtubeAudio(alvo);
      if (!info || !info.url) return null;
      if (alvo.duracao) faixa.duracao = alvo.duracao;
      faixa.viaYoutube = true;
      faixa.previa = false;
      return { url: info.url, duracao: faixa.duracao || alvo.duracao, engine: "audio", videoId: alvo.idFonte, fallbackVideoId: alvo.idFonte };
    } catch (_) {
      return null;
    }
  }

  async function urlParaTocar(faixa) {
    if (!faixa) throw new Error("Faixa inválida");
    if (faixa.fonte === "demo") return { url: faixa.url, duracao: faixa.duracao, engine: "audio" };
    if (faixa.fonte === "audius") {
      return { url: faixa.url || urlAudius(faixa), duracao: faixa.duracao, engine: "audio" };
    }
    if (faixa.fonte === "jamendo") {
      if (!faixa.url) {
        faixa.url = "https://prod-1.storage.jamendo.com/?trackid=" +
          encodeURIComponent(faixa.idFonte) + "&format=mp31";
      }
      return { url: faixa.url, duracao: faixa.duracao, engine: "audio" };
    }
    if (faixa.fonte === "deezer" || faixa.fonte === "itunes") {
      // Na nuvem o IP do servidor pode ser bloqueado pelo YouTube. Nesse caso
      // o player incorporado roda no aparelho do usuário e toca o áudio completo.
      if (naNuvem()) {
        try {
          const achados = await youtubeBuscar(
            `${faixa.titulo || ""} ${faixa.artista || ""} official`.trim(), 5);
          const alvo = escolherYoutube(achados, faixa);
          if (alvo) {
            faixa.viaYoutube = true;
            faixa.previa = false;
            if (alvo.duracao) faixa.duracao = alvo.duracao;
            const audio = await audioNuvemVideo(alvo.idFonte, faixa).catch(() => null);
            if (audio) return audio;
            return {
              url: null, duracao: faixa.duracao, engine: "youtube",
              videoId: alvo.idFonte
            };
          }
        } catch (_) { /* cai na prévia */ }
      }
      // No PC/servidor local o áudio completo é baixado normalmente.
      const completo = await tentarYoutubeCompleto(faixa);
      if (completo) return completo;
      // Último recurso: a prévia oficial de 30 s da API.
      let url = faixa.url || faixa.preview;
      if (!url) throw new Error("Prévia de 30 s indisponível");
      faixa.previa = true;
      faixa.duracao = 30;
      if (await detectarProxy()) url = apiUrl("api/proxy?url=" + encodeURIComponent(url));
      return { url, duracao: 30, engine: "audio" };
    }
    if (faixa.fonte === "archive") {
      if (faixa.url) return { url: faixa.url, duracao: faixa.duracao, engine: "audio" };
      const info = await archiveResolver(faixa.idFonte);
      faixa.url = info.url;
      if (info.duracao && !faixa.duracao) faixa.duracao = info.duracao;
      if (info.titulo) faixa.titulo = info.titulo;
      if (info.artista) faixa.artista = info.artista;
      if (info.capa) faixa.capa = info.capa;
      return { url: info.url, duracao: faixa.duracao, engine: "audio" };
    }
    if (faixa.fonte === "youtube") {
      if (naNuvem()) {
        const audio = await audioNuvemVideo(faixa.idFonte, faixa).catch(() => null);
        if (audio) return audio;
        return { url: null, duracao: faixa.duracao, engine: "youtube", videoId: faixa.idFonte };
      }
      try {
        const info = await youtubeAudio(faixa);
        if (info.titulo) faixa.titulo = info.titulo;
        if (info.artista) faixa.artista = info.artista;
        if (info.duracao && !faixa.duracao) faixa.duracao = info.duracao;
        return info;
      } catch (_) {
        // Último recurso: o player oficial incorporado (oculto).
        return { url: null, duracao: faixa.duracao, engine: "youtube", videoId: faixa.idFonte };
      }
    }
    throw new Error("Fonte desconhecida");
  }

  async function resolverDetalhes(faixa) {
    if (faixa.fonte === "archive") {
      const info = await archiveResolver(faixa.idFonte);
      return { ...faixa, ...info };
    }
    return faixa;
  }

  window.FOX_FONTES = {
    configurar, buscar, buscarEm, buscarAlbuns, faixasDoAlbum, carregarEstacao, demoDaEstacao, urlParaTocar,
    resolverDetalhes, detectarProxy, normalizarAudius, normalizarArchive, normalizarJamendo,
    normalizarYoutube, parseYoutube, parseBandcamp, semAcento
  };
})();
