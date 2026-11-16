// 段階3: ブラウザの中のエンジン（?engine=local）で、画像を入れて候補 → 大きさ → 仕上げ → 行の候補まで進み、
// サーバーのエンジン（?engine=server）と同じ手順の AA を比べる。GPU（WebGPU）を使う。
// node ui_local.mjs <出力フォルダ> <画像（絶対パス）> [--only local|server] [--base http://127.0.0.1:8000/]
// ブラウザのプロフィールは <出力フォルダ>/../edge_profile_local に残す（2 回目からはモデルを読み込まない）。
import { launch } from "./cdp.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const [out, image] = args;
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const query = args.includes("--query") ? `&${args[args.indexOf("--query") + 1]}` : "";   // 例: --query cpu=1
mkdirSync(out, { recursive: true });
const BASE = args.includes("--base") ? args[args.indexOf("--base") + 1] : "http://127.0.0.1:8765/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(engine) {
  const b = await launch({ width: 1600, height: 1000, port: engine === "local" ? 9371 : 9372, gpu: true,
    profile: resolve(dirname(resolve(out)), `edge_profile_${engine}`) });
  const log = [];
  const t0 = Date.now();
  const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  b.on((m) => {
    if (m.method === "Runtime.consoleAPICalled") log.push(`${stamp()} console.${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(" ")}`);
    if (m.method === "Runtime.exceptionThrown") log.push(`${stamp()} exception: ` + JSON.stringify(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
  });
  const status = () => b.eval("document.getElementById('status').textContent");
  let lastStatus = "";
  const watch = setInterval(async () => {
    try {
      const s = await status();
      if (s !== lastStatus) { lastStatus = s; log.push(`${stamp()} status: ${s}`); }
    } catch (e) { /* 移動中 */ }
  }, 500);
  const times = {};
  const mark = (name, since) => { times[name] = ((Date.now() - since) / 1000).toFixed(1); };
  try {
    await b.goto(`${BASE}?engine=${engine}${query}`);
    await b.waitFor("document.querySelector('#font option') !== null", 60000);
    log.push(`${stamp()} gpu: ${await b.eval("navigator.gpu ? 'yes' : 'no'")}, crossOriginIsolated: ${await b.eval("crossOriginIsolated")}`);
    let t = Date.now();
    await b.setFile("#file", image);
    await b.waitFor("!document.getElementById('prepView').hidden", 120000);
    mark("open", t);
    t = Date.now();
    await b.eval("document.getElementById('prepSkip').click()");
    await b.waitFor("document.querySelectorAll('.ccard .cwait[hidden]').length === 5", 900000);
    mark("candidates", t);
    await b.shot(join(out, `${engine}_1_candidates.png`));
    t = Date.now();
    await b.eval("document.querySelectorAll('.ccard .cgo')[1].click()");
    await b.waitFor("document.getElementById('pickTitle').textContent.startsWith('2.')");
    await b.waitFor("document.querySelectorAll('.ccard .cwait[hidden]').length === 6", 900000);
    mark("scales", t);
    await b.eval("[...document.querySelectorAll('.ccard')].find(c => c.querySelector('.cname').textContent === '×1.00').querySelector('.cgo').click()");
    await b.waitFor("!document.getElementById('edit').hidden");
    await sleep(500);
    await b.waitFor("document.getElementById('busy').hidden", 300000);
    const text = await b.eval("document.getElementById('text').value");
    await b.shot(join(out, `${engine}_2_edit.png`));
    // 行の候補
    t = Date.now();
    await b.eval("document.querySelector('#tool button[data-v=row]').click()");
    const [L, T, W] = await b.eval("(() => { const r = document.getElementById('aaCanvas').getBoundingClientRect(); return [r.left, r.top, r.width]; })()");
    const z = await b.eval("(() => { const c = document.getElementById('aaCanvas'); return c.getBoundingClientRect().width / c.width; })()");
    await b.mouse("mouseMoved", L + W * 0.5, T + 18 * 12.5 * z, 0);
    await b.mouse("mousePressed", L + W * 0.5, T + 18 * 12.5 * z);
    await b.mouse("mouseReleased", L + W * 0.5, T + 18 * 12.5 * z, 0);
    await b.waitFor("document.querySelectorAll('#rowList .ropt').length > 0", 300000);
    mark("rowOptions", t);
    const options = await b.eval("[...document.querySelectorAll('#rowList .ropt')].length");
    log.push(`${stamp()} device: ${await b.eval("document.getElementById('device').textContent")}`);
    await b.shot(join(out, `${engine}_3_row.png`));
    return { text, times, options, log };
  } catch (e) {
    log.push(`${stamp()} FAILED: ${e.message}`);
    try { await b.shot(join(out, `${engine}_failed.png`)); } catch (e2) { /* */ }
    return { text: null, times, log };
  } finally {
    clearInterval(watch);
    await b.close();
  }
}

const results = {};
for (const engine of ["local", "server"]) {
  if (only && engine !== only) continue;
  results[engine] = await run(engine);
  writeFileSync(join(out, `${engine}_log.txt`), results[engine].log.join("\n"), "utf8");
  if (results[engine].text) writeFileSync(join(out, `${engine}_aa.txt`), results[engine].text, "utf8");
  console.log(engine, JSON.stringify(results[engine].times), "row options:", results[engine].options);
}
if (results.local?.text && results.server?.text) {
  const a = results.local.text.split("\n"), s = results.server.text.split("\n");
  const diff = a.filter((l, i) => l !== s[i]).length;
  console.log(`AA（標準、×1.00）: ${diff} / ${s.length} 行が違う`);
}
