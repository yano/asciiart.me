// 背景を消す前処理を、ブラウザの中のエンジンとサーバーのエンジンで行い、結果の画像（AA の大きさ）を保存する。
// 画面の「背景: 消す」も押して、等倍の表示を写真に撮る。比べるのは aaeval/webapp_test/bg_compare_out.py。
// node bg_test.mjs <出力フォルダ> <画像（絶対パス）>
import { launch } from "./cdp.mjs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const [out, image] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const data = readFileSync(image).toString("base64");
const CASES = [{ name: "full", body: { crop: null, long: null, delta: 0, bg: true } },
  { name: "crop", body: { crop: [0.1, 0.05, 0.9, 0.7], long: 600, delta: 0, bg: true } }];

for (const engine of ["local", "server"]) {
  const b = await launch({ port: engine === "local" ? 9401 : 9402, gpu: true,
    profile: resolve(dirname(resolve(out)), `edge_profile_${engine}`) });
  await b.goto(`http://127.0.0.1:8765/?engine=${engine}`);
  await b.waitFor("document.querySelector('#font option') !== null", 60000);
  const r = await b.eval(`(async () => {
    const engine = await import("./engine.js");
    const bin = Uint8Array.from(atob(${JSON.stringify(data)}), (c) => c.charCodeAt(0));
    const info = await engine.open(new File([bin], "image.png", { type: "image/png" }));
    const out = {};
    for (const c of ${JSON.stringify(CASES)}) {
      const t = performance.now();
      const p = await engine.prepare(info.id, c.body);
      const ms = Math.round(performance.now() - t);
      const png = new Uint8Array(await (await fetch(await engine.sourceURL(p.id, 1))).arrayBuffer());
      let s = ""; for (const x of png) s += String.fromCharCode(x);
      out[c.name] = { ms, width: p.width, height: p.height, before: p.before, png: btoa(s) };
    }
    return out;
  })()`);
  for (const [name, v] of Object.entries(r)) {
    writeFileSync(join(out, `${engine}_${name}.png`), Buffer.from(v.png, "base64"));
    console.log(engine, name, `${v.ms} ms`, `${v.width}x${v.height}`, "線の太さ", v.before?.width);
  }
  // 画面で「背景: 消す」を押す
  await b.goto(`http://127.0.0.1:8765/?engine=${engine}`);
  await b.waitFor("document.querySelector('#font option') !== null", 60000);
  await b.setFile("#file", image);
  await b.waitFor("!document.getElementById('prepView').hidden", 120000);
  await b.eval("document.querySelector('#prepBg button[data-v=remove]').click()");
  await b.waitFor("/px/.test(document.getElementById('prepState').textContent)", 300000);
  await new Promise((r) => setTimeout(r, 500));
  await b.shot(join(out, `${engine}_ui.png`));
  await b.close();
}
