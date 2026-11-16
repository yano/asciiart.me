// 場所ごとに描き込みの量を変えるための「重みの地図」と、黒い面（aame/regions.py を移したもの）。

import { convexHull, dilate, ellipseKernel, fillConvexPoly, gaussianBlur32, grayPIL, label, opening, percentileU8,
  rectKernel, resizeAreaCV, resizeNearestCV, resizePIL, rint } from "./img.js";
import * as models from "./models.js";

const f32 = Math.fround;

export const BACKGROUND = 0, HAIR = 1, EYE = 2, MOUTH = 3, FACE = 4, SKIN = 5, CLOTHES = 6;
const DETECT_SHORT = 512;
export const PAINT_MAX = 4;
const PAINT_STEPS = [[-4, 0.0], [-3, 0.2], [-2, 0.4], [-1, 0.65], [0, 1.0], [1, 1.5], [2, 2.25], [3, 3.4], [4, 5.0]];
export const PAINT_CODE = 30;

// 各画素の部位の番号（size = [幅, 高さ]）。image は {rgb, w, h}
export async function faceParts(image, size, runner) {
  const [sw, sh] = size;
  const rgb = sw === image.w && sh === image.h ? image.rgb : resizePIL(image.rgb, image.w, image.h, 3, sw, sh, "lanczos");
  const k = DETECT_SHORT / Math.min(sw, sh);
  const dw = Math.max(64, rint(sw * k / 64) * 64), dh = Math.max(64, rint(sh * k / 64) * 64);
  const small = resizeAreaCV(rgb, sw, sh, 3, dw, dh);
  const parts = await models.faceParts(runner, small, dw, dh);
  return resizeNearestCV(parts, dw, dh, 1, sw, sh);
}

// 顔の領域（1 が顔）。目・口・顔の肌のかたまりのうち、肌と目の両方を含むものを、外形（凸包）で埋める
export function findFaces(parts, w, h, minArea = 0.003) {
  let blob = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) blob[p] = parts[p] === EYE || parts[p] === MOUTH || parts[p] === FACE ? 1 : 0;
  blob = opening(blob, w, h, 1, rectKernel(5));
  const { labels, n } = label(blob, w, h, true);
  const area = new Int32Array(n + 1), eye = new Int32Array(n + 1);
  for (let p = 0; p < w * h; p++) {
    const l = labels[p];
    if (!l) continue;
    area[l]++;
    if (parts[p] === EYE) eye[l]++;
  }
  const out = new Uint8Array(w * h);
  const points = new Map();
  for (let l = 1; l <= n; l++) {
    if (area[l] < minArea * w * h || !(0.03 * area[l] <= eye[l] && eye[l] <= 0.5 * area[l])) continue;
    points.set(l, []);
  }
  if (!points.size) return out;
  for (let p = 0; p < w * h; p++) {
    const list = points.get(labels[p]);
    if (list) list.push([p % w, Math.floor(p / w)]);
  }
  for (const list of points.values()) fillConvexPoly(out, w, h, convexHull(list));
  return out;
}

// 境目を feather px かけてなだらかにする（float32）
function soften(inside, w, h, feather) {
  const a = Float32Array.from(inside);
  return feather <= 0 ? a : gaussianBlur32(a, w, h, feather / 2.0);
}

// 顔の中が gain、外が 1 の重みの地図（Float32Array）。grow は顔を外へ広げる画素数
export function faceWeight(faces, w, h, gain = 2.0, grow = 6, feather = 8) {
  const inside = grow > 0 ? dilate(faces, w, h, 1, rectKernel(2 * grow + 1)) : faces;
  const soft = soften(inside, w, h, feather);
  const g = f32(gain - 1.0);
  const out = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) out[p] = 1.0 + f32(g * soft[p]);
  return out;
}

// 黒い面（1 が面）。暗い画素のうち差し渡しが thick px 以上の所。where が "face" なら顔の中だけ
export function darkAreas(image, size, where = "all", faces = null, { level = 0.4, thick = 5, minArea = 20 } = {}) {
  const [w, h] = size;
  const gray = grayPIL(image.rgb, image.w * image.h);
  const g = w === image.w && h === image.h ? gray : resizePIL(gray, image.w, image.h, 1, w, h, "lanczos");
  const lo = percentileU8(g, 1), hi = percentileU8(g, 70);
  const thr = f32(lo + f32(f32(level) * f32(hi - lo)));
  let dark = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) dark[p] = g[p] < thr ? 1 : 0;
  dark = opening(dark, w, h, 1, ellipseKernel(thick));
  const { labels, n } = label(dark, w, h, true);
  const area = new Int32Array(n + 1);
  for (let p = 0; p < w * h; p++) area[labels[p]]++;
  const out = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) out[p] = labels[p] && area[labels[p]] >= minArea ? 1 : 0;
  if (where === "face") {
    const near = dilate(faces, w, h, 1, rectKernel(13));
    for (let p = 0; p < w * h; p++) out[p] &= near[p];
  }
  return out;
}

// np.interp
function interp(x, xs, ys) {
  if (x <= xs[0]) return ys[0];
  const n = xs.length;
  if (x >= xs[n - 1]) return ys[n - 1];
  let j = 0;
  while (!(xs[j] <= x && x < xs[j + 1])) j++;
  if (xs[j] === x) return ys[j];
  return ((ys[j + 1] - ys[j]) / (xs[j + 1] - xs[j])) * (x - xs[j]) + ys[j];
}

// 画面で塗り重ねた段階の画像（灰色 L、値 = 128 + 段階 × PAINT_CODE。pw × ph）から、描き込みの倍率の地図を作る
export function paintWeight(paintL, pw, ph, size, feather = 4) {
  const [w, h] = size;
  const m = pw === w && ph === h ? paintL : resizePIL(paintL, pw, ph, 1, w, h, "bilinear");
  const level = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) level[p] = f32(f32(m[p] - 128.0) / PAINT_CODE);
  const soft = feather > 0 ? gaussianBlur32(level, w, h, feather / 2.0) : level;
  const xs = PAINT_STEPS.map((s) => s[0]), ys = PAINT_STEPS.map((s) => s[1]);
  const out = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) out[p] = interp(Math.min(Math.max(soft[p], -PAINT_MAX), PAINT_MAX), xs, ys);
  return out;
}
