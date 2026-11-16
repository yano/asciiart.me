// 画像を線画にする（aame/lineart.py の、Web アプリが使う部分を移したもの）。
// 線の強さ 0..1（1 = 線）を AA の大きさで求め、binarize で 1px の線にする。
// 学習済みの検出器は AA の大きさの2倍で通してから縮める（manga_line は等倍でも通して強いほうを取る）。

import { dilate, edt, hysteresis, label, rectKernel, removeSmallObjects, resizeAreaCV, resizePIL, rint,
  skeletonize } from "./img.js";
import * as models from "./models.js";

const f32 = Math.fround;

export const MAX_SIZE = 800;        // AA の大きさの長辺（前処理しないとき）
export const COLOR_METHOD = "teed";
const COLOR_NEAR = 3.0;
const COLOR_FEATHER = 2.0;
const DETECT_SCALES = { manga_line: [2, 1], teed: [2] };
const DETECTORS = { manga_line: models.mangaLine, teed: models.teed };

// AA にする大きさ [幅, 高さ]。長辺が maxSize を超えるときだけ縮める。scale を渡すと、さらにその倍率にする
export function canvasSize(w, h, maxSize = MAX_SIZE, scale = 1.0) {
  const s = Math.min(1.0, maxSize / Math.max(w, h));
  let cw = w, ch = h;
  if (s < 1.0) { cw = Math.trunc(w * s); ch = Math.trunc(h * s); }
  if (scale !== 1.0) { cw = Math.max(1, rint(cw * scale)); ch = Math.max(1, rint(ch * scale)); }
  return [cw, ch];
}

// 検出器の出力（白線/黒地 か 黒線/白地 の uint8）を「線の強さ」にそろえる
function asStrength(u8) {
  const a = new Float32Array(u8.length);
  let sum = 0;
  for (let i = 0; i < u8.length; i++) { a[i] = u8[i] / 255.0; sum += a[i]; }
  if (sum / u8.length > 0.5) for (let i = 0; i < a.length; i++) a[i] = 1.0 - a[i];
  return a;
}

// 画像（{rgb, w, h}）を線の強さ（Float32Array、size = [幅, 高さ]）にする。runner はモデルを動かすもの（models.js）
export async function strength(image, method, size, runner) {
  const [cw, ch] = size;
  const { rgb, w, h } = image;
  const small = cw === w && ch === h ? rgb : resizePIL(rgb, w, h, 3, cw, ch, "lanczos");
  const out = new Float32Array(cw * ch);
  for (const k of DETECT_SCALES[method]) {
    const bw = cw * k, bh = ch * k;
    const big = k === 1 ? small : resizePIL(rgb, w, h, 3, bw, bh, "lanczos");
    const found = await DETECTORS[method](runner, big, bw, bh);
    let s = asStrength(found.data);
    if (found.w !== cw || found.h !== ch) s = resizeAreaCV(s, found.w, found.h, 1, cw, ch);
    for (let i = 0; i < out.length; i++) if (s[i] > out[i]) out[i] = s[i];
  }
  for (let i = 0; i < out.length; i++) out[i] = Math.min(Math.max(out[i], 0), 1);
  return out;
}

// 線の強さ s に、色の境界 edge（COLOR_METHOD の線の強さ）を足す。すでに線がある所から離れた境界だけを足す。
// region（0..1 の地図か null）を渡すと、その値を掛けてから足す
export function mergeColorEdges(s, edge, w, h, region = null) {
  const blob = hysteresis(s, w, h, 0.15, 0.4);
  const out = new Float32Array(w * h);
  let any = false;
  for (let p = 0; p < w * h; p++) if (blob[p]) { any = true; break; }
  const away = any ? edt(blob, h, w) : null;
  for (let p = 0; p < w * h; p++) {
    let e = edge[p];
    if (away) {
      // Python では float64 になる
      e *= Math.min(Math.max((away[p] - COLOR_NEAR) / COLOR_FEATHER, 0.0), 1.0);
      if (region) e *= region[p];
    } else if (region) {
      e = f32(e * region[p]);
    }
    out[p] = Math.max(s[p], e);
  }
  return out;
}

// 線の強さを2値の線にする（Uint8Array、1 が線）。high 以上の所とそこにつながる low 以上の所を線とし、
// 1px に細線化して小さなかけら（minSize 画素未満）を除く。細線化で消える点（鼻や口）は、元の面積が
// dotArea 画素以上なら 2x2 の点として残す。width が 2 以上なら、その太さに太らせる
export function binarize(s, w, h, { low = 0.15, high = 0.4, width = 1, minSize = 6, dotArea = 6 } = {}) {
  const blob = hysteresis(s, w, h, low, high);
  const m = removeSmallObjects(skeletonize(blob, w, h), w, h, minSize, true);
  if (dotArea) {
    const { labels, n } = label(blob, w, h, true);
    if (n) {
      const area = new Int32Array(n + 1), kept = new Int32Array(n + 1);
      const sy = new Float64Array(n + 1), sx = new Float64Array(n + 1);
      for (let p = 0; p < w * h; p++) {
        const l = labels[p];
        if (!l) continue;
        area[l]++;
        if (m[p]) kept[l]++;
        sy[l] += Math.floor(p / w);
        sx[l] += p % w;
      }
      for (let l = 1; l <= n; l++) {
        if (area[l] < dotArea || kept[l] !== 0) continue;
        const y = Math.min(Math.trunc(sy[l] / area[l]), h - 2), x = Math.min(Math.trunc(sx[l] / area[l]), w - 2);
        m[y * w + x] = m[y * w + x + 1] = m[(y + 1) * w + x] = m[(y + 1) * w + x + 1] = 1;
      }
    }
  }
  return width > 1 ? dilate(m, w, h, 1, rectKernel(width)) : m;
}

// 画面で直した線画（RGBA。赤が描いた線、緑が消した所）を [描いた線, 消した所] にする（大きさが違えば最も近い画素で合わせる）
export function editMasks(rgba, ew, eh, size) {
  const [w, h] = size;
  const src = ew === w && eh === h ? rgba : resizePIL(rgba, ew, eh, 4, w, h, "nearest");
  const add = new Uint8Array(w * h), erase = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    add[p] = src[4 * p] > 127 ? 1 : 0;
    erase[p] = src[4 * p + 1] > 127 ? 1 : 0;
  }
  return [add, erase];
}

// 1px の線 mask に直しを当てる（消した所の線を除き、描いた線を足す）。width が 2 以上なら太らせる
export function applyEdit(mask, add, erase, w, h, width = 1) {
  const m = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) m[p] = (mask[p] && !erase[p]) || add[p] ? 1 : 0;
  return width > 1 ? dilate(m, w, h, 1, rectKernel(width)) : m;
}
