// AA にする前の画像の下ごしらえ（aame/prep.py を移したもの）: 切り抜き、AA の大きさ、線の太さを測る・変える。
// 画像は {rgb, w, h}（RGB uint8）。

import { blackhat, boxSum32, dilate, edt, ellipseKernel, erode, grayCV, percentile32, rectKernel,
  removeSmallObjects, resizePIL, rint, skeletonize } from "./img.js";

const f32 = Math.fround;

export const WORK = 2;
const MAX_LINE = 6.0;
const LOCAL = 4;
export const GOOD = [1.0, 3.5];
const TARGET = 2.2;

// Python の round(v, 2)（ちょうど半分は偶数へ）
function round2(v) {
  const s = v * 100;
  if (Math.abs(s % 1) === 0.5) return (2 * Math.round(s / 2)) / 100;
  return Math.round(s) / 100;
}

// box = [x0, y0, x1, y1]（0..1 の割合）で切り抜く。null なら切り抜かない
export function crop(image, box) {
  if (!box) return image;
  const { rgb, w, h } = image;
  const [x0, y0, x1, y1] = box;
  let l = rint(Math.min(x0, x1) * w), t = rint(Math.min(y0, y1) * h);
  let r = rint(Math.max(x0, x1) * w), b = rint(Math.max(y0, y1) * h);
  l = Math.max(0, Math.min(l, w - 1));
  t = Math.max(0, Math.min(t, h - 1));
  r = Math.max(l + 1, Math.min(r, w));
  b = Math.max(t + 1, Math.min(b, h));
  if (l === 0 && t === 0 && r === w && b === h) return image;
  const nw = r - l, nh = b - t;
  const out = new Uint8Array(nw * nh * 3);
  for (let y = 0; y < nh; y++) out.set(rgb.subarray(((y + t) * w + l) * 3, ((y + t) * w + r) * 3), y * nw * 3);
  return { rgb: out, w: nw, h: nh };
}

// 背景を白にする（alpha は前景の濃さ uint8。models.js の foreground）。aame/prep.py の remove_background と同じ混ぜ方
export function whiten(image, alpha) {
  const { rgb, w, h } = image;
  const out = new Uint8Array(rgb.length);
  for (let p = 0; p < w * h; p++) {
    const a = alpha[p];
    for (let c = 0; c < 3; c++) out[3 * p + c] = Math.floor((rgb[3 * p + c] * a + 255 * (255 - a) + 127) / 255);
  }
  return { rgb: out, w, h };
}

// 長辺を longSide px にした [幅, 高さ]（大きくもする）
export function targetSize(w, h, longSide) {
  const s = longSide / Math.max(w, h);
  return [Math.max(1, rint(w * s)), Math.max(1, rint(h * s))];
}

// AA の大きさ size の WORK 倍に直した RGB
function work(image, size) {
  const ww = size[0] * WORK, wh = size[1] * WORK;
  const rgb = ww === image.w && wh === image.h ? image.rgb : resizePIL(image.rgb, image.w, image.h, 3, ww, wh, "lanczos");
  return { rgb, w: ww, h: wh };
}

const kernel = (r) => ellipseKernel(2 * r + 1);

// 線の芯と、芯の各点での線の太さ（WORK 倍の大きさで px）。aame/prep.py の _lines
function lines(rgb, w, h) {
  const n = w * h;
  const g = Float32Array.from(grayCV(rgb, n));
  const big = Math.ceil(MAX_LINE * WORK) + 2;
  const bh = blackhat(g, w, h, kernel(big));
  const peak = dilate(bh, w, h, 1, kernel(Math.ceil(WORK * 1.5)));
  const strong = new Uint8Array(n);
  const ink = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    strong[p] = bh[p] > 28.0 ? 1 : 0;
    ink[p] = peak[p] > 28.0 ? Math.min(Math.max(f32(bh[p] / Math.max(peak[p], 1.0)), 0.0), 1.0) : 0.0;
  }
  const strongNear = dilate(strong, w, h, 1, kernel(1));
  let mask = new Uint8Array(n);
  for (let p = 0; p < n; p++) mask[p] = ink[p] >= 0.5 && strongNear[p] ? 1 : 0;
  // 広い面を除く
  const bg = new Uint8Array(n);
  for (let p = 0; p < n; p++) bg[p] = mask[p] ? 0 : 1;
  const dt = edt(bg, h, w);
  const core = new Uint8Array(n);
  let anyCore = false;
  for (let p = 0; p < n; p++) if (dt[p] > (MAX_LINE * WORK) / 2.0) { core[p] = 1; anyCore = true; }
  if (anyCore) {
    const area = dilate(core, w, h, 1, kernel(Math.ceil((MAX_LINE * WORK) / 2.0) + 1));
    for (let p = 0; p < n; p++) if (area[p]) mask[p] = 0;
  }
  mask = removeSmallObjects(mask, w, h, 4 * WORK * WORK, true);
  const skel = skeletonize(mask, w, h);
  const r = LOCAL * WORK;
  const near = dilate(mask, w, h, 1, kernel(WORK));
  const inkNear = new Float32Array(n), skelF = new Float32Array(n);
  for (let p = 0; p < n; p++) { inkNear[p] = ink[p] * near[p]; skelF[p] = skel[p]; }
  const areaSum = boxSum32(inkNear, w, h, r), lenSum = boxSum32(skelF, w, h, r);
  const width = new Float32Array(n);
  for (let p = 0; p < n; p++) if (skel[p]) width[p] = f32(areaSum[p] / Math.max(lenSum[p], 1.0));
  return { skel, width };
}

// AA の大きさ size にしたときの線の太さ（px）を測る。aame/prep.py の measure と同じ形を返す
export function measure(image, size) {
  const { rgb, w, h } = work(image, size);
  const { skel, width } = lines(rgb, w, h);
  const ws = [];
  let len = 0;
  for (let p = 0; p < w * h; p++) if (skel[p]) { ws.push(f32(width[p] / WORK)); len++; }
  const out = { good: GOOD.slice(), lines: Math.trunc(len / WORK) };
  if (ws.length < 20 * WORK) return { ...out, width: null, p25: null, p75: null, verdict: "none" };
  const [p25, med, p75] = [25, 50, 75].map((q) => percentile32(ws, q));
  const verdict = med < GOOD[0] ? "thin" : med > GOOD[1] ? "thick" : "good";
  return { ...out, width: round2(med), p25: round2(p25), p75: round2(p75), verdict };
}

// measure の結果から、太さを変える量（0.5 刻み）のおすすめ。目安の中なら 0
export function recommended(info) {
  const w = info.width;
  if (w === null || w === undefined || info.verdict === "good") return 0.0;
  return rint((TARGET - w) * 2.0) / 2.0;
}

// 線の太さを delta px（AA の大きさで）だけ変えた画像（AA の大きさの WORK 倍の {rgb, w, h}）を返す
export function adjust(image, size, delta) {
  const base = work(image, size);
  if (!delta) return base;
  const { rgb, w, h } = base;
  const r = (Math.abs(delta) * WORK) / 2.0;
  const lo = Math.floor(r), frac = r - Math.floor(r);
  const op = delta > 0 ? erode : dilate;
  const morph = (k) => (k === 0 ? rgb : op(rgb, w, h, 3, kernel(k)));
  const a = morph(lo);
  let out;
  if (frac > 1e-6) {
    // Python では frac が numpy の float64 なので、ここから float64 になる
    const b = morph(lo + 1);
    out = new Float64Array(rgb.length);
    for (let i = 0; i < rgb.length; i++) out[i] = a[i] * (1.0 - frac) + b[i] * frac;
  } else {
    out = Float32Array.from(a);
  }
  if (delta < 0) {
    const { skel } = lines(rgb, w, h);
    const keep = dilate(skel, w, h, 1, rectKernel(WORK));
    for (let p = 0; p < w * h; p++) {
      if (!keep[p]) continue;
      for (let c = 0; c < 3; c++) out[3 * p + c] = Math.min(out[3 * p + c], rgb[3 * p + c]);
    }
  }
  const res = new Uint8Array(rgb.length);
  for (let i = 0; i < rgb.length; i++) res[i] = Math.trunc(Math.min(Math.max(out[i] + 0.5, 0), 255));
  return { rgb: res, w, h };
}
