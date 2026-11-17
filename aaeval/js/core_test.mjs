// JavaScript の当てはめ（webapp/static/aame/）が Python と同じ AA を出すかを確かめる。
//   PYTHONPATH=. python aaeval/js/dump_core.py     （先に入力と答えを書き出す）
//   node aaeval/js/core_test.mjs [--out out/js_core] [--only miku_standard]
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { parseDict } from "../../webapp/static/aame/glyphs.js";
import { costs, glyphCost, N_BINS } from "../../webapp/static/aame/cost.js";
import { bins } from "../../webapp/static/aame/orient.js";
import { COST, finish, matchCost, v1Costs } from "../../webapp/static/aame/match.js";
import { loadNpy } from "./npy.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const OUT = opt("--out", "out/js_core");
const ONLY = opt("--only", null);

const glyphs = parseDict(readFileSync("chrDict_20261117_utf8.txt", "utf8"));
const index = JSON.parse(readFileSync(join(OUT, "index.json"), "utf8"));
const load = (name) => loadNpy(join(OUT, name));

function maxDiff(a, b) {
  let m = 0, at = -1;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > m || (Number.isNaN(d) && !(a[i] === b[i]))) { m = d; at = i; }
  }
  return [m, at];
}

// 文字側の量
let t = performance.now();
const gc = glyphCost(glyphs, 4);
console.log(`文字側の量: ${gc.F} の形、${(performance.now() - t).toFixed(0)} ms`);
{
  const miss = load("gc_miss.npy"), ink = load("gc_ink.npy"), moved = load("gc_moved.npy");
  const F = gc.F, D = miss.shape[1];
  if (miss.shape[0] !== F) console.log(`  形の数が違う: Python ${miss.shape[0]}`);
  let missDiff = 0, inkDiff = 0;
  for (let f = 0; f < F; f++) {
    const row = new Float32Array(D);
    for (let e = gc.inkStart[f]; e < gc.inkStart[f + 1]; e++) row[gc.ink[e]] = 1;
    for (let d = 0; d < D; d++) {
      missDiff = Math.max(missDiff, Math.abs(gc.missT[d * F + f] - miss.data[f * D + d]));
      inkDiff = Math.max(inkDiff, Math.abs(row[d] - ink.data[f * D + d]));
    }
  }
  console.log(`  取りこぼしの差 ${missDiff}、インクの差 ${inkDiff}、ずらしの差 ${maxDiff(gc.movedInk, moved.data)[0]}`);
}

let totalRows = 0, totalDiff = 0;
for (const item of index) {
  if (ONLY && item.key !== ONLY) continue;
  const { h, w } = item;
  const mask = load(`${item.key}_mask.npy`).data;
  let lines;
  t = performance.now();
  if (item.mode === "v1") {
    const r = v1Costs(mask, h, w, glyphs);
    lines = finish(matchCost(r.c, r.term, r.rows, r.nx, glyphs).lines, glyphs);
  } else {
    const weight = item.weight ? load(`${item.key}_weight.npy`).data : null;
    const fill = item.fill ? load(`${item.key}_fill.npy`).data : null;
    const o = { lam: item.lam, phantom: item.phantom, weight, shift: item.shift, slide: item.slide, fill, fillGain: item.fill_gain };
    const r = costs(mask, h, w, glyphs, o);
    const t1 = performance.now();
    lines = finish(matchCost(r.c, r.term, r.rows, r.nx, glyphs).lines, glyphs);
    item.costMs = t1 - t;
    if (item.probe !== undefined) {
      const H = Math.floor(h / 18) * 18;
      const b = bins(mask.subarray(0, H * w), H, w, N_BINS);
      const pb = load(`${item.key}_bins.npy`).data;
      let nb = 0;
      for (let i = 0; i < b.length; i++) if (b[i] !== pb[i]) nb++;
      const one = costs(mask, h, w, glyphs, { ...o, only: [item.probe] });
      const [cd, cat] = maxDiff(one.c, load(`${item.key}_c${item.probe}.npy`).data);
      const [td] = maxDiff(one.term.map((v) => (v === Infinity ? 1e30 : v)),
        load(`${item.key}_term${item.probe}.npy`).data.map((v) => (v === Infinity ? 1e30 : v)));
      console.log(`  ${item.key}: 向きの違う画素 ${nb}、${item.probe} 行目の c の差 最大 ${cd.toExponential(2)}（${cat}）、term の差 ${td}`);
    }
  }
  const ms = performance.now() - t;
  let diff = 0;
  lines.forEach((s, i) => { if (s !== item.lines[i]) diff++; });
  if (lines.length !== item.lines.length) diff += Math.abs(lines.length - item.lines.length);
  totalRows += item.lines.length;
  totalDiff += diff;
  const costPart = item.costMs !== undefined ? `（コスト ${item.costMs.toFixed(0)} ms）` : "";
  console.log(`${item.key.padEnd(28)} ${String(diff).padStart(3)} / ${item.lines.length} 行が違う  JS ${ms.toFixed(0)} ms${costPart}  Python ${item.ms} ms`);
}
console.log(`合計: ${totalDiff} / ${totalRows} 行が違う`);
if (existsSync(join(OUT, "cost_table.json"))) {
  const py = JSON.parse(readFileSync(join(OUT, "cost_table.json"), "utf8"));
  console.log(`v1 のコストの表の差: ${maxDiff(COST, py)[0]}`);
}
