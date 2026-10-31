/* FOXify — catálogo, estações e faixas demo.
   As "estações" são consultas prontas em fontes de música livre; quando a rede
   não responde, o app usa as faixas demo sintetizadas localmente. */
(function () {
  "use strict";

  const capa = (nome) => `assets/img/capas/${nome}.jpg?v=1.6.0`;
  const audio = (nome) => `assets/audio/${nome}.wav`;

  const demo = [
    { id: "demo:noite-azul", chave: "demo:noite-azul", fonte: "demo", idFonte: "noite-azul",
      titulo: "Noite Azul", artista: "Foxify Sessions", capa: capa("noite-azul"),
      url: audio("noite-azul"), duracao: 33.3, genero: "Lo-fi", licenca: "Demonstração local" },
    { id: "demo:chuva-de-neon", chave: "demo:chuva-de-neon", fonte: "demo", idFonte: "chuva-de-neon",
      titulo: "Chuva de Neon", artista: "Foxify Sessions", capa: capa("chuva-de-neon"),
      url: audio("chuva-de-neon"), duracao: 33.6, genero: "Synthwave", licenca: "Demonstração local" },
    { id: "demo:vento-solar", chave: "demo:vento-solar", fonte: "demo", idFonte: "vento-solar",
      titulo: "Vento Solar", artista: "Foxify Sessions", capa: capa("vento-solar"),
      url: audio("vento-solar"), duracao: 33.9, genero: "Folk", licenca: "Demonstração local" },
    { id: "demo:madrugada-lofi", chave: "demo:madrugada-lofi", fonte: "demo", idFonte: "madrugada-lofi",
      titulo: "Madrugada Lo-fi", artista: "Foxify Sessions", capa: capa("madrugada-lofi"),
      url: audio("madrugada-lofi"), duracao: 35.3, genero: "Lo-fi", licenca: "Demonstração local" },
    { id: "demo:pulso-eletrico", chave: "demo:pulso-eletrico", fonte: "demo", idFonte: "pulso-eletrico",
      titulo: "Pulso Elétrico", artista: "Foxify Sessions", capa: capa("pulso-eletrico"),
      url: audio("pulso-eletrico"), duracao: 33.4, genero: "House", licenca: "Demonstração local" },
    { id: "demo:ceu-de-outubro", chave: "demo:ceu-de-outubro", fonte: "demo", idFonte: "ceu-de-outubro",
      titulo: "Céu de Outubro", artista: "Foxify Sessions", capa: capa("ceu-de-outubro"),
      url: audio("ceu-de-outubro"), duracao: 32.0, genero: "Ambient", licenca: "Demonstração local" }
  ];

  const porIdDemo = Object.fromEntries(demo.map((t) => [t.idFonte, t]));

  /* Estações exibidas em "Tocando agora" e nas playlists da barra lateral. */
  const estacoes = [
    { id: "top50-brasil", nome: "Top 50 Brasil", sub: "As 50 mais tocadas em fontes livres",
      capa: capa("top50-brasil-novo"), fonte: "deezer", modo: "curadoria", consulta: "Brazil hits",
      seeds: ["Anitta", "Ludmilla", "Jão", "Luan Santana", "Jorge & Mateus",
        "Henrique & Juliano", "Zé Neto & Cristiano", "Marília Mendonça", "Pabllo Vittar", "Gusttavo Lima"],
      demo: ["noite-azul", "pulso-eletrico", "chuva-de-neon", "madrugada-lofi"], destaque: true },
    { id: "mood-chill", nome: "Mood Chill", sub: "Para relaxar e curtir",
      capa: capa("mood-chill-novo"), fonte: "deezer", modo: "curadoria", consulta: "chill",
      seeds: ["Billie Eilish", "Coldplay", "Sade", "Norah Jones", "Bon Iver",
        "Cigarettes After Sex", "Frank Ocean", "Lorde", "The xx", "Mac DeMarco"],
      demo: ["madrugada-lofi", "noite-azul", "ceu-de-outubro"] },
    { id: "rock-antigo", nome: "Rock Antigo", sub: "Clássicos que nunca saem de moda",
      capa: capa("rock-antigo-novo"), fonte: "deezer", modo: "curadoria", consulta: "classic rock",
      seeds: ["Queen", "Led Zeppelin", "Pink Floyd", "The Beatles", "The Rolling Stones",
        "AC/DC", "Guns N' Roses", "Bon Jovi", "Deep Purple", "The Doors"],
      demo: ["vento-solar", "pulso-eletrico", "chuva-de-neon"] },
    { id: "hip-hop-2025", nome: "Hip Hop 2025", sub: "O melhor do rap atual",
      capa: capa("hip-hop-2025-novo"), fonte: "deezer", modo: "curadoria", consulta: "hip hop",
      seeds: ["Kendrick Lamar", "Drake", "Travis Scott", "J. Cole", "Future",
        "Metro Boomin", "21 Savage", "Tyler, The Creator", "Doja Cat", "Central Cee"],
      demo: ["pulso-eletrico", "chuva-de-neon", "madrugada-lofi"] },

    { id: "indie-vibes", nome: "Indie Vibes", sub: "As melhores músicas independentes", ref: true,
      capa: capa("indie-vibes"), fonte: "deezer", modo: "curadoria", consulta: "indie",
      seeds: ["Tame Impala", "Arctic Monkeys", "The 1975", "Mac DeMarco", "Cigarettes After Sex",
        "Beach House", "MGMT", "Foster the People", "Vampire Weekend", "Phoenix"],
      demo: ["vento-solar", "noite-azul", "madrugada-lofi", "ceu-de-outubro"] },
    { id: "eletronica-sem-limites", nome: "Eletrônica Sem Limites", sub: "Beats que te levam mais longe", ref: true,
      capa: capa("eletronica-sem-limites"), fonte: "deezer", modo: "curadoria", consulta: "electronic",
      seeds: ["David Guetta", "Calvin Harris", "Martin Garrix", "Alok", "Vintage Culture",
        "Tiësto", "Avicii", "Zedd", "Kygo", "Marshmello"],
      demo: ["pulso-eletrico", "chuva-de-neon", "noite-azul"] },
    { id: "mpb-essencial", nome: "MPB Essencial", sub: "O melhor da nossa música", ref: true,
      capa: capa("mpb-essencial"), fonte: "deezer", modo: "curadoria", consulta: "MPB",
      seeds: ["Caetano Veloso", "Gilberto Gil", "Chico Buarque", "Gal Costa", "Maria Bethânia",
        "Djavan", "Milton Nascimento", "Elis Regina", "Ivan Lins", "Tom Jobim"],
      demo: ["vento-solar", "ceu-de-outubro", "noite-azul"] },
    { id: "rock-nacional", nome: "Rock Nacional", sub: "O melhor do rock brasileiro", ref: true,
      capa: capa("rock-nacional"), fonte: "deezer", modo: "curadoria", consulta: "rock nacional",
      seeds: ["Legião Urbana", "Titãs", "Cazuza", "Barão Vermelho", "Os Paralamas do Sucesso",
        "Engenheiros do Hawaii", "Skank", "CPM 22", "Charlie Brown Jr.", "Capital Inicial"],
      demo: ["vento-solar", "pulso-eletrico", "chuva-de-neon"] },
    { id: "musicas-romanticas", nome: "Músicas Românticas", sub: "Para amar e relaxar", ref: true,
      capa: capa("romanticas"), fonte: "deezer", modo: "curadoria", consulta: "romantic love",
      seeds: ["Ed Sheeran", "Adele", "Bruno Mars", "Maroon 5", "John Legend",
        "Roberto Carlos", "Ana Carolina", "Vanessa da Mata", "Sam Smith", "Coldplay"],
      demo: ["noite-azul", "madrugada-lofi", "ceu-de-outubro"] },
    { id: "classicos-70-80-90", nome: "70, 80, 90", sub: "Clássicos de três décadas", ref: true,
      capa: capa("classicos-70-80-90"), fonte: "deezer", modo: "curadoria", consulta: "80s music",
      seeds: ["Queen", "Michael Jackson", "Madonna", "Bon Jovi", "A-ha",
        "Legião Urbana", "Titãs", "U2", "ABBA", "Tina Turner"],
      demo: ["chuva-de-neon", "pulso-eletrico", "vento-solar"] },

    { id: "sertanejo-top", nome: "Sertanejo Universitário", sub: "O sertanejo que você ama", ref: true,
      capa: capa("sertanejo-universitario"), fonte: "deezer", modo: "curadoria", consulta: "sertanejo",
      seeds: ["Jorge & Mateus", "Henrique & Juliano", "Zé Neto & Cristiano", "Marília Mendonça", "Maiara & Maraisa",
        "Luan Santana", "Gusttavo Lima", "Michel Teló", "Simone & Simaria", "Wesley Safadão"],
      demo: ["vento-solar", "ceu-de-outubro"] },
    { id: "rap-nacional", nome: "Rap Nacional", sub: "Rimas que contam histórias", ref: true,
      capa: capa("rap-nacional"), fonte: "deezer", modo: "curadoria", consulta: "rap nacional",
      seeds: ["Racionais MC's", "Criolo", "Emicida", "Djonga", "BK'",
        "Filipe Ret", "L7NNON", "Xamã", "Orochi", "MC Cabelinho"],
      demo: ["pulso-eletrico", "chuva-de-neon"] },
    { id: "lofi-beats", nome: "Lo-fi Beats", sub: "Relax e foco no seu dia", ref: true,
      capa: capa("lofi-beats"), fonte: "deezer", modo: "curadoria", consulta: "lofi",
      seeds: ["Chillhop Music", "Idealism", "Jinsang", "Nujabes", "Lofi Girl",
        "Kupla", "Sleepy Fish", "Philanthrope", "Tomppabeats", "Saib"],
      demo: ["madrugada-lofi", "noite-azul", "ceu-de-outubro"] },
    { id: "rock-classico", nome: "Rock Clássico", sub: "Os grandes do rock em um só lugar", ref: true,
      capa: capa("rock-classico"), fonte: "deezer", modo: "curadoria", consulta: "classic rock",
      seeds: ["Queen", "Bon Jovi", "Aerosmith", "Guns N' Roses", "Nirvana",
        "Metallica", "Red Hot Chili Peppers", "U2", "The Police", "Dire Straits"],
      demo: ["vento-solar", "pulso-eletrico"] },
    { id: "rock-alternativo", nome: "Rock Alternativo", sub: "Novos sons, mesma energia", ref: true,
      capa: capa("rock-alternativo"), fonte: "deezer", modo: "curadoria", consulta: "alternative rock",
      seeds: ["Nirvana", "Foo Fighters", "Red Hot Chili Peppers", "Linkin Park", "Arctic Monkeys",
        "The 1975", "Tame Impala", "Radiohead", "Coldplay", "Green Day"],
      demo: ["vento-solar", "pulso-eletrico", "chuva-de-neon"] }
  ];

  const porId = Object.fromEntries(estacoes.map((e) => [e.id, e]));

  /* Listas fixas que aparecem na barra lateral. */
  const playlistsBarra = [
    { id: "favoritas", nome: "Favoritas", sub: "Suas curtidas", capa: capa("favoritas"), tipo: "favoritas" },
    { id: "suamusica", nome: "Sua Música", sub: "Buscador livre", capa: capa("sua-musica"), tipo: "rota", rota: "#/suamusica" },
    ...estacoes.filter((e) => ["sertanejo-top", "rap-nacional", "lofi-beats", "rock-classico", "classicos-70-80-90"].includes(e.id))
      .map((e) => ({ id: e.id, nome: e.nome, sub: e.sub, capa: e.capa, tipo: "estacao" }))
  ];

  const fontes = {
    audius: { nome: "Audius", desc: "Catálogo aberto de artistas independentes", cor: "#8b5cf6",
      site: "https://audius.co", selo: "Streaming livre", requerProxy: false },
    archive: { nome: "Internet Archive", desc: "Netlabels, domínio público e Creative Commons", cor: "#38bdf8",
      site: "https://archive.org", selo: "Domínio público", requerProxy: false },
    jamendo: { nome: "Jamendo Music", desc: "Catálogo independente, direto do site", cor: "#14b8a6",
      site: "https://www.jamendo.com", selo: "Música independente", requerProxy: true },
    youtube: { nome: "YouTube", desc: "O maior catálogo de música do mundo", cor: "#ff3b3b",
      site: "https://music.youtube.com", selo: "YouTube", requerProxy: true },
    deezer: { nome: "Deezer", desc: "Catálogo Deezer · áudio completo via YouTube", cor: "#a855f7",
      site: "https://www.deezer.com", selo: "Deezer", requerProxy: true },
    itunes: { nome: "iTunes", desc: "Apple Music · áudio completo via YouTube", cor: "#ff2d55",
      site: "https://music.apple.com", selo: "Apple Music", requerProxy: true },
    demo: { nome: "FOXify Sessions", desc: "Faixas demo geradas pelo app", cor: "#f59e0b",
      site: "#/config", selo: "Offline", requerProxy: false }
  };

  const sugestoes = ["lofi", "rock", "jazz", "eletrônica", "hip hop", "piano", "ambient", "samba",
    "MPB", "rock nacional", "indie", "clássica", "trilha sonora", "chill", "deezer", "dj set"];

  window.FOX_DADOS = { demo, porIdDemo, estacoes, porId, playlistsBarra, fontes, sugestoes,
    capa, audio };
})();
