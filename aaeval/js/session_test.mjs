// JavaScript の Session（webapp/static/aame/session.js）を Python と比べる: 行の候補、塗りと線画の直しを使った AA、行の伸び縮み。
//   PYTHONPATH=. python aaeval/js/dump_session.py
//   node aaeval/js/session_test.mjs [--out out/js_session]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { parseDict } from "../../webapp/static/aame/glyphs.js";
import { grayPIL } from "../../webapp/static/aame/img.js";
import { hscale, look, Session } from "../../webapp/static/aame/session.js";
import { loadNpy } from "./npy.mjs";

const args = process.argv.slice(2);
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : "out/js_session";
const glyphs = parseDict(readFileSync("chrDict_20261117_utf8.txt", "utf8"));
const index = JSON.parse(readFileSync(join(OUT, "index.json"), "utf8"));
const L = (name) => loadNpy(join(OUT, `${name}.npy`));
const { w, h } = index;

// 行の伸び縮み（cv2.remap）
const band = L("remap_src").data, mask = L("remap_mask").data;
index.remap.forEach(([sx, cx], i) => {
  const lin = hscale(band, w, 54, sx, cx, 0.0, "linear"), ref = L(`remap_lin${i}`).data;
  let n = 0, maxD = 0;
  for (let k = 0; k < lin.length; k++) { const d = Math.abs(lin[k] - ref[k]); if (d > 0) n++; maxD = Math.max(maxD, d); }
  const near = hscale(mask, w, 54, sx, cx, 0, "nearest"), refN = L(`remap_near${i}`).data;
  let nn = 0;
  for (let k = 0; k < near.length; k++) if (near[k] !== refN[k]) nn++;
  console.log(`remap ${sx} ${cx.toFixed(2)}: 線形 違う値 ${n}（最大 ${maxD.toExponential(2)}）、最も近い画素 違う値 ${nn}`);
});

// モデルの代わり: 名前ごとに、Python が呼んだ順に出力を返す
const queues = {};
index.calls.forEach((name, i) => {
  const outs = [];
  for (let j = 0; ; j++) {
    try { const o = L(`call${i}_out${j}`); outs.push({ data: o.data, dims: o.shape }); } catch (e) { break; }
  }
  (queues[name] ||= []).push(outs);
});
const runner = async (name) => queues[name].shift();

const rgb = L("rgb");
const image = { rgb: rgb.data, w: rgb.shape[1], h: rgb.shape[0] };
let t = performance.now();
const s = await new Session(image, runner).init();
console.log(`Session ${s.w}×${s.h}（${(performance.now() - t).toFixed(0)} ms）`);
const paint = L("paint"), edit = L("edit");
const extra = {
  standard: {},
  color_all_fill_paint: { paint: { data: paint.data, w: paint.shape[1], h: paint.shape[0] } },
  edit: { edit: { data: edit.data, w: edit.shape[1], h: edit.shape[0] } },
  dense: {},
};
const SETTINGS = {
  standard: { lam: 2.0, color: null, fill: null, face_gain: 2.0 },
  color_all_fill_paint: { lam: 2.0, color: "all", fill: "face", face_gain: 2.0 },
  edit: { lam: 2.0, color: null, fill: null, face_gain: 2.0 },
  dense: { mode: "v1", width: 3 },
};
void grayPIL;
for (const [key, res] of Object.entries(index.result)) {
  const st = { ...SETTINGS[key], ...extra[key] };
  t = performance.now();
  const lines = await s.render(st, glyphs);
  const tr = performance.now() - t;
  let d = 0;
  lines.forEach((l, i) => { if (l !== res.lines[i]) d++; });
  let total = 0, same = 0, sameLook = 0, tOpt = 0;
  for (const row of index.rows) {
    t = performance.now();
    const opts = await s.rowOptions(row, st, glyphs, null);
    tOpt += performance.now() - t;
    const py = res.options[row];
    total += py.length;
    const mine = new Map(opts.map((o) => [`${o.kind}|${o.label}`, o.line]));
    for (const o of py) {
      const m = mine.get(`${o.kind}|${o.label}`);
      if (m === o.line) same++;
      if (m !== undefined && look(m, glyphs) === look(o.line, glyphs)) sameLook++;
    }
    if (opts.length !== py.length) console.log(`  ${key} 行 ${row}: 候補の数 JS ${opts.length} / Python ${py.length}`);
  }
  console.log(`${key.padEnd(22)} AA ${d} / ${res.lines.length} 行が違う（${tr.toFixed(0)} ms）  行の候補 ${same} / ${total} が同じ（見た目 ${sameLook}）  候補 1 行 ${(tOpt / index.rows.length).toFixed(0)} ms`);
}
