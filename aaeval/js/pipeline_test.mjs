// JavaScript のエンジン（webapp/static/aame/）を、画像から AA まで Python と比べる。
//   PYTHONPATH=. python aaeval/js/dump_pipeline.py     （先に Python の途中結果を書き出す）
//   node aaeval/js/pipeline_test.mjs [--out out/js_pipe]
// モデルは動かさず、Python が記録したモデルの出力を返す（入力が同じかも確かめる）。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { parseDict } from "../../webapp/static/aame/glyphs.js";
import { costs } from "../../webapp/static/aame/cost.js";
import { finish, matchCost, v1Costs } from "../../webapp/static/aame/match.js";
import * as lineart from "../../webapp/static/aame/lineart.js";
import * as regions from "../../webapp/static/aame/regions.js";
import * as prep from "../../webapp/static/aame/prep.js";
import { loadNpy } from "./npy.mjs";

const args = process.argv.slice(2);
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : "out/js_pipe";
const glyphs = parseDict(readFileSync("chrDict_20261117_utf8.txt", "utf8"));
const index = JSON.parse(readFileSync(join(OUT, "index.json"), "utf8"));

function compare(label, a, b, tol = 1e-6) {
  let maxD = 0, n = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > tol) n++;
    if (d > maxD) maxD = d;
  }
  const len = a.length === b.length ? "" : `（長さが違う ${a.length} / ${b.length}）`;
  console.log(`  ${label.padEnd(22)} 違う値 ${String(n).padStart(6)} / ${a.length}  最大の差 ${maxD.toPrecision(3)}${len}`);
  return n;
}

function render(mask, w, h, st, weight, fill) {
  const r = costs(mask, h, w, glyphs, { lam: st.lam, weight, fill, fillGain: 0.5 });
  return finish(matchCost(r.c, r.term, r.rows, r.nx, glyphs).lines, glyphs);
}

function rowDiff(label, a, b) {
  let d = 0;
  a.forEach((s, i) => { if (s !== b[i]) d++; });
  console.log(`  ${label.padEnd(22)} ${d} / ${b.length} 行が違う`);
}

for (const item of index) {
  const { stem, w, h } = item;
  const L = (name) => loadNpy(join(OUT, `${stem}_${name}.npy`)).data;
  console.log(`== ${stem}（${item.iw}×${item.ih} → ${w}×${h}）`);
  const image = { rgb: L("rgb"), w: item.iw, h: item.ih };
  // モデルの代わり: 記録した順に出力を返す。入力も比べる
  let call = 0;
  const runner = async (name, input) => {
    const i = call++;
    if (item.calls[i] !== name) throw new Error(`call ${i}: ${name} を呼んだが Python は ${item.calls[i]}`);
    compare(`model ${i} ${name} 入力`, input.data, L(`call${i}_in`), 0.5);
    const outs = [];
    for (let j = 0; ; j++) {
      try {
        const o = loadNpy(join(OUT, `${stem}_call${i}_out${j}.npy`));
        outs.push({ data: o.data, dims: o.shape });
      } catch (e) { break; }
    }
    return outs;
  };
  const size = [w, h];
  let t = performance.now();
  const s = await lineart.strength(image, "manga_line", size, runner);
  console.log(`  （線の強さ ${(performance.now() - t).toFixed(0)} ms）`);
  compare("線の強さ", s, L("strength"));
  const edges = await lineart.strength(image, "teed", size, runner);
  compare("色の境界", edges, L("edges"));
  const sAll = lineart.mergeColorEdges(L("strength"), L("edges"), w, h, null);
  compare("線 + 色の境界（all）", sAll, L("strength_all"));
  t = performance.now();
  const parts = await regions.faceParts(image, size, runner);
  const faces = regions.findFaces(parts, w, h);
  compare("顔", faces, L("faces"), 0);
  const fw = regions.faceWeight(L("faces"), w, h, 2.0);
  compare("顔の重み", fw, L("face_weight"));
  const region = Float32Array.from(L("face_weight"), (v) => Math.fround(v - 1.0));
  compare("線 + 色の境界（face）", lineart.mergeColorEdges(L("strength"), L("edges"), w, h, region), L("strength_face"));
  t = performance.now();
  const m1 = lineart.binarize(L("strength"), w, h);
  console.log(`  （2値化 ${(performance.now() - t).toFixed(0)} ms）`);
  compare("線画（1px）", m1, L("mask_None_1"), 0);
  compare("線画（2px）", lineart.binarize(L("strength"), w, h, { width: 2 }), L("mask_None_2"), 0);
  compare("線画（3px）", lineart.binarize(L("strength"), w, h, { width: 3 }), L("mask_None_3"), 0);
  compare("線画（all）", lineart.binarize(L("strength_all"), w, h), L("mask_all_1"), 0);
  compare("線画（face）", lineart.binarize(L("strength_face"), w, h), L("mask_face_1"), 0);
  compare("黒い面（face）", regions.darkAreas(image, size, "face", L("faces")), L("dark_face"), 0);
  compare("黒い面（all）", regions.darkAreas(image, size, "all"), L("dark_all"), 0);
  const paint = loadNpy(join(OUT, `${stem}_paint.npy`));
  compare("塗りの重み", regions.paintWeight(paint.data, paint.shape[1], paint.shape[0], size), L("paint_weight"));
  // 前処理
  const size2 = item.prep.size;
  const ts = prep.targetSize(item.iw, item.ih, 600);
  if (ts[0] !== size2[0] || ts[1] !== size2[1]) console.log(`  大きさが違う: ${ts} / ${size2}`);
  t = performance.now();
  const info = prep.measure(image, size2);
  console.log(`  線の太さ: JS ${JSON.stringify(info)}（${(performance.now() - t).toFixed(0)} ms）`);
  console.log(`            Py ${JSON.stringify(item.prep.measure)}`);
  compare("太くした画像", prep.adjust(image, size2, 1.0).rgb, L("adjust_plus"), 0);
  compare("細くした画像", prep.adjust(image, size2, -0.5).rgb, L("adjust_minus"), 0);
  const c = prep.crop(image, [0.1, 0.05, 0.85, 0.9]);
  if (c.w !== item.prep.crop[0] || c.h !== item.prep.crop[1]) console.log(`  切り抜きの大きさが違う: ${c.w}x${c.h}`);
  // AA（JS で作った線画・重み・黒い面から）
  const fwJS = regions.faceWeight(faces, w, h, 2.0);
  rowDiff("AA 標準", render(lineart.binarize(s, w, h), w, h, { lam: 2.0 }, fwJS, null), item.lines.standard);
  const regionJS = Float32Array.from(fwJS, (v) => Math.fround(v - 1.0));
  const all = lineart.binarize(lineart.mergeColorEdges(s, edges, w, h, null), w, h);
  rowDiff("AA 色の境界 + 黒い面", render(all, w, h, { lam: 2.0 }, fwJS, regions.darkAreas(image, size, "face", faces)),
    item.lines.color_all_fill);
  const dense = lineart.binarize(s, w, h, { width: 3 });
  const v1 = v1Costs(dense, h, w, glyphs);
  rowDiff("AA 高密度", finish(matchCost(v1.c, v1.term, v1.rows, v1.nx, glyphs).lines, glyphs), item.lines.dense);
  void regionJS;
}
