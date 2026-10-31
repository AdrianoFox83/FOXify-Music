// Observa requisições de rede de uma página (Edge headless + CDP).
// Uso: node observar_rede.mjs --url "https://..." --espera 12000
import { spawn } from "node:child_process";
import path from "node:path";

const args = process.argv.slice(2);
const arg = (nome, padrao) => {
  const i = args.indexOf("--" + nome);
  return i >= 0 ? args[i + 1] : padrao;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const url = arg("url", "https://example.com");
const espera = Number(arg("espera", "12000"));
const porta = Number(arg("porta", "9400"));
const EDGE = String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`;
const perfil = path.join(process.env.TEMP || ".", "foxify-net-" + Date.now());

const processo = spawn(EDGE, [
  `--remote-debugging-port=${porta}`, "--headless=new", "--no-sandbox", "--disable-gpu",
  "--no-first-run", "--disable-features=Translate", `--user-data-dir=${perfil}`, "about:blank"
], { stdio: "ignore" });

async function alvo() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${porta}/json/list`);
      const lista = await r.json();
      const p = lista.find((t) => t.type === "page");
      if (p) return p.webSocketDebuggerUrl;
    } catch (_) { /* espera */ }
    await sleep(200);
  }
  throw new Error("sem depurador");
}

try {
  const ws = new WebSocket(await alvo());
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pend = new Map();
  const pedidos = new Map();
  const respostas = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) {
      const { res, rej } = pend.get(m.id); pend.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    } else if (m.method === "Network.requestWillBeSent") {
      pedidos.set(m.params.requestId, { url: m.params.request.url, metodo: m.params.request.method, tipo: m.params.type });
      if (m.params.request.url.includes("/api/search")) {
        console.log("HEADERS " + JSON.stringify(m.params.request.headers));
      }
      if (m.params.request.url.includes("index_ajax_search_more")) {
        console.log("POSTDATA " + JSON.stringify(m.params.request.postData) + " HEADERS " + JSON.stringify(m.params.request.headers));
      }
    } else if (m.method === "Network.responseReceived") {
      respostas.set(m.params.requestId, { status: m.params.response.status, mime: m.params.response.mimeType });
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await send("Network.enable");
  await send("Page.enable");
  await send("Page.navigate", { url });
  await sleep(espera);

  const linhas = [];
  for (const [rid, p] of pedidos) {
    const r = respostas.get(rid) || {};
    if (p.tipo === "XHR" || p.tipo === "Fetch" || /api|graphql|search|json/i.test(p.url)) {
      linhas.push(`${p.metodo} ${r.status || "?"} ${r.mime || ""} ${p.url}`);
    }
  }
  console.log([...new Set(linhas)].join("\n"));
  try { await send("Browser.close"); } catch (_) {}
} catch (e) {
  console.error("FALHA", e.message);
  process.exitCode = 1;
} finally {
  setTimeout(() => { try { processo.kill(); } catch (_) {} process.exit(); }, 500);
}
