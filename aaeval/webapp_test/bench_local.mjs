// ブラウザの中のエンジン（engine_local.js）を直接呼んで、段階ごとの時間を測る（GPU を使う）。
// node bench_local.mjs <画像（絶対パス）> [プロフィールのフォルダ]
import { launch } from "./cdp.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const [image, profile = resolve("../../out/ui_local/edge_profile_local")] = process.argv.slice(2);
const b = await launch({ port: 9381, gpu: true, profile });
b.on((m) => {
  if (m.method === "Runtime.exceptionThrown") console.log("exception:", m.params.exceptionDetails.exception?.description);
});
await b.goto("http://127.0.0.1:8765/?engine=local");
await b.waitFor("document.querySelector('#font option') !== null", 60000);
const data = readFileSync(image).toString("base64");
const result = await b.eval(`(async () => {
  const engine = await import("./engine_local.js");
  const bin = Uint8Array.from(atob(${JSON.stringify(data)}), (c) => c.charCodeAt(0));
  const file = new File([bin], "image.png", { type: "image/png" });
  const out = [];
  let t = performance.now();
  const info = await engine.open(file);
  out.push({ step: "open", ms: Math.round(performance.now() - t) });
  for (const p of info.presets) {
    t = performance.now();
    const r = await engine.render(info.id, { ...p.settings, mode: "v2", width: 2, fill_gain: 0.5 }, null, 1);
    out.push({ step: p.name, ms: Math.round(performance.now() - t), timing: r.timing });
  }
  for (const sc of [0.9, 1.1]) {
    t = performance.now();
    const r = await engine.render(info.id, { ...info.presets[1].settings, mode: "v2", width: 2, fill_gain: 0.5 }, null, sc);
    out.push({ step: "scale " + sc, ms: Math.round(performance.now() - t), timing: r.timing });
  }
  t = performance.now();
  const ro = await engine.rowOptions(info.id, 12, { ...info.presets[1].settings, mode: "v2", width: 2, fill_gain: 0.5 }, null, 1, null, null);
  out.push({ step: "rowOptions", ms: Math.round(performance.now() - t), n: ro.options.length });
  return out;
})()`);
for (const r of result) console.log(r.step.padEnd(16), String(r.ms).padStart(6), "ms", r.timing ? JSON.stringify(r.timing) : r.n ?? "");
await b.close();
