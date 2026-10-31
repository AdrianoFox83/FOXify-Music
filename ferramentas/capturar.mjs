// Captura telas do FOXify via Chrome DevTools Protocol (Edge headless).
// Uso: node capturar.mjs --url http://127.0.0.1:8765/#/inicio --out _teste/tela.png --w 390 --h 844 --mobile 1
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const arg = (nome, padrao) => {
  const i = args.indexOf("--" + nome);
  return i >= 0 ? args[i + 1] : padrao;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const url = arg("url", "http://127.0.0.1:8765/#/inicio");
const saida = arg("out", "_teste/tela.png");
const largura = Number(arg("w", "390"));
const altura = Number(arg("h", "844"));
const mobile = arg("mobile", "1") === "1";
const espera = Number(arg("espera", "3500"));
const porta = Number(arg("porta", "9333"));
const executar = arg("js", "");
const offline = arg("offline", "0") === "1";
const clique = arg("click", "");
const clique2 = arg("click2", "");
const seletorClique = arg("click-selector", "");
const EDGE = String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`;
const perfil = arg("perfil", path.join(process.env.TEMP || ".", "foxify-cdp-" + Date.now()));

const processo = spawn(EDGE, [
  `--remote-debugging-port=${porta}`,
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--no-first-run",
  "--disable-features=Translate",
  "--hide-scrollbars",
  `--user-data-dir=${perfil}`,
  "about:blank"
], { stdio: "ignore" });

let cdp = null;
const erros = [];

async function esperarDepurador() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${porta}/json/list`);
      if (r.ok) {
        const alvos = await r.json();
        const pagina = alvos.find((t) => t.type === "page");
        if (pagina) return pagina.webSocketDebuggerUrl;
      }
    } catch (_) { /* ainda subindo */ }
    await sleep(200);
  }
  throw new Error("Depurador do Edge nÃ£o respondeu");
}

function conectar(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pendentes = new Map();
  let id = 0;
  const eventos = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pendentes.has(msg.id)) {
      const { resolve, reject } = pendentes.get(msg.id);
      pendentes.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) {
      if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        erros.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
      }
      if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
        erros.push(msg.params.entry.text + " @ " + (msg.params.entry.url || ""));
      }
      const lista = eventos.get(msg.method) || [];
      lista.forEach((fn) => fn(msg.params));
      eventos.delete(msg.method);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id;
    pendentes.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  return { ws, send, eventos };
}

try {
  const wsUrl = await esperarDepurador();
  cdp = conectar(wsUrl);
  await new Promise((resolve, reject) => { cdp.ws.onopen = resolve; cdp.ws.onerror = reject; });

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Network.enable");
  if (offline) {
    await cdp.send("Network.emulateNetworkConditions", {
      offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0
    });
  }
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: largura, height: altura, deviceScaleFactor: 1, mobile,
    screenWidth: largura, screenHeight: altura
  });
  if (mobile) {
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.send("Emulation.setUserAgentOverride", {
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
      platform: "Linux armv8l"
    });
  }
  await cdp.send("Page.navigate", { url });
  await sleep(espera);

  if (clique) {
    const [x, y] = clique.split(",").map(Number);
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    await sleep(1600);
  }

  if (executar) {
    const resultado = await cdp.send("Runtime.evaluate", { expression: executar, awaitPromise: true, returnByValue: true, userGesture: true });
    console.log("JS: " + JSON.stringify(resultado.result && resultado.result.value));
    await sleep(1200);
  }

  if (seletorClique) {
    const alvo = await cdp.send("Runtime.evaluate", {
      expression: `(() => { const e = document.querySelector(${JSON.stringify(seletorClique)}); if (!e) return null; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
      returnByValue: true
    });
    const p = alvo.result && alvo.result.value;
    if (p) {
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
      await sleep(12000);
      const r2 = await cdp.send("Runtime.evaluate", {
        expression: "JSON.stringify({tocando: FOXPlayer.estado().tocando, tempo: FOXPlayer.estado().tempo, faixa: FOXPlayer.estado().faixa && FOXPlayer.estado().faixa.titulo, fonte: FOXPlayer.estado().faixa && FOXPlayer.estado().faixa.fonte, motor: FOXPlayer.estado().motor, ready: FOXPlayer.audio.readyState, erro: FOXPlayer.estado().erro, yt: FOXPlayer.ytEstado(), classe: document.querySelector('#yt-palco').className, src: FOXPlayer.audio.currentSrc.slice(0,120), net: FOXPlayer.audio.networkState, preload: FOXPlayer.audio.preload, mediaErr: FOXPlayer.audio.error && FOXPlayer.audio.error.code, body: document.body.className, sheet: document.querySelector('#sheet').className, barra: document.querySelector('#barra').className, mini: document.querySelector('#mini').className})",
        returnByValue: true
      });
      console.log("JS2: " + (r2.result && r2.result.value));
    } else {
      console.log("JS2: seletor nÃ£o encontrado");
    }
  }

  if (clique2) {
    const [x, y] = clique2.split(",").map(Number);
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    await sleep(5000);
    const r2 = await cdp.send("Runtime.evaluate", {
      expression: "JSON.stringify({tocando: FOXPlayer.estado().tocando, tempo: FOXPlayer.estado().tempo, motor: FOXPlayer.estado().motor, erro: FOXPlayer.estado().erro, yt: FOXPlayer.ytEstado(), classe: document.querySelector('#yt-palco').className, src: FOXPlayer.audio.currentSrc.slice(0,120), net: FOXPlayer.audio.networkState, preload: FOXPlayer.audio.preload, mediaErr: FOXPlayer.audio.error && FOXPlayer.audio.error.code, body: document.body.className, sheet: document.querySelector('#sheet').className, barra: document.querySelector('#barra').className, mini: document.querySelector('#mini').className})",
      returnByValue: true
    });
    console.log("JS2: " + (r2.result && r2.result.value));
  }

  const medidas = await cdp.send("Runtime.evaluate", {
    expression: `JSON.stringify({
      titulo: document.title,
      vw: innerWidth, vh: innerHeight,
      docW: document.documentElement.scrollWidth,
      docH: document.documentElement.scrollHeight,
      app: (() => { const e = document.querySelector('.app'); return e ? Math.round(e.getBoundingClientRect().width) : 0; })(),
      itens: document.querySelectorAll('#vista *').length,
      diagnostico: (document.querySelector('#diagnostico') || {}).textContent || '',
      faixas: document.querySelectorAll('.faixa').length,
      erroTela: (document.querySelector('.toast--erro') || {}).textContent || ''
    })`,
    returnByValue: true
  });

  const captura = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  await fs.mkdir(path.dirname(saida), { recursive: true });
  await fs.writeFile(saida, Buffer.from(captura.data, "base64"));

  console.log("OK " + saida);
  console.log(medidas.result.value);
  if (erros.length) console.log("ERROS:\n" + erros.slice(0, 8).join("\n"));
  else console.log("ERROS: nenhum");

  try { await cdp.send("Browser.close"); } catch (_) { /* ignora */ }
} catch (erro) {
  console.error("FALHA:", erro.message);
  if (erros.length) console.error(erros.slice(0, 8).join("\n"));
  process.exitCode = 1;
} finally {
  setTimeout(() => { try { processo.kill(); } catch (_) {} process.exit(); }, 600);
}



