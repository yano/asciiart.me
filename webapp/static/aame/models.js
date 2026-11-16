// 学習済みモデルの前と後の処理（aame/models.py を移したもの）。モデルを動かす部分（runner）は外から渡す:
//   runner(name, input) → Promise<出力の配列>
//   name は "manga_line"・"teed"・"face"、input は {data: Float32Array, dims: [1, c, h, w]}。
//   出力は {data: Float32Array, dims} の並び（モデルの出力の順）。
// ブラウザでは onnxruntime-web（ort.js）が runner になる。試験では Python の出力を返す runner を使う。

import { grayCV, padEdge, resizeAreaCV, resizeCubicCV, resizePIL, rint } from "./img.js";

const f32 = Math.fround;

// comfyui_controlnet_aux の resize_image_with_pad と同じ: 短辺を resolution にして、右と下を端の画素で
// 64 の倍数まで伸ばす。{img, W, H（伸ばした大きさ）, wt, ht（伸ばす前の大きさ）} を返す
export function resizeWithPad(rgb, w, h, c, resolution) {
  const k = resolution / Math.min(h, w);
  const ht = rint(h * k), wt = rint(w * k);   // np.round（半分は偶数へ）
  const img = k > 1 ? resizeCubicCV(rgb, w, h, c, wt, ht) : resizeAreaCV(rgb, w, h, c, wt, ht);
  const H = Math.ceil(ht / 64) * 64, W = Math.ceil(wt / 64) * 64;
  return { img: padEdge(img, wt, ht, c, W, H), W, H, wt, ht };
}

// 大きな入力を、重なり（pad px）のあるタイルに分けて通す（1 チャンネルの出力 1 つのモデル用）。
// runner.maxSide（1 辺の上限。64 の倍数）が無ければ分けない。manga_line は、WebGPU で入力が大きすぎると
// 黙って壊れた値を返した（1280×1792 で。中間の 256 チャンネルの面が 2GB を越えるため。webapp_plan.md 21 章）
async function runTiled(runner, name, data, C, H, W, pad = 128) {
  const side = runner.maxSide;
  if (!side || (H <= side && W <= side)) return (await runner(name, { data, dims: [1, C, H, W] }))[0];
  const core = side - 2 * pad;
  const out = new Float32Array(H * W);
  for (let y0 = 0; y0 < H; y0 += core) {
    const y1 = Math.min(H, y0 + core), wy0 = Math.max(0, y0 - pad), wy1 = Math.min(H, y1 + pad), th = wy1 - wy0;
    for (let x0 = 0; x0 < W; x0 += core) {
      const x1 = Math.min(W, x0 + core), wx0 = Math.max(0, x0 - pad), wx1 = Math.min(W, x1 + pad), tw = wx1 - wx0;
      const tile = new Float32Array(C * th * tw);
      for (let c = 0; c < C; c++) {
        for (let y = 0; y < th; y++) tile.set(data.subarray(c * H * W + (wy0 + y) * W + wx0, c * H * W + (wy0 + y) * W + wx1), (c * th + y) * tw);
      }
      const [r] = await runner(name, { data: tile, dims: [1, C, th, tw] });
      for (let y = y0; y < y1; y++) {
        out.set(r.data.subarray((y - wy0) * tw + (x0 - wx0), (y - wy0) * tw + (x1 - wx0)), y * W + x0);
      }
    }
  }
  return { data: out, dims: [1, 1, H, W] };
}

// 線画化（manga_line）: RGB uint8 → 白線/黒地の uint8。{data, w, h}（大きさは検出した大きさ: 短辺を 256 の倍数に上げたもの）
export async function mangaLine(runner, rgb, w, h) {
  const res = 256 * Math.ceil(Math.min(h, w) / 256);
  const { img, W, H, wt, ht } = resizeWithPad(rgb, w, h, 3, res);
  const gray = grayCV(img, W * H);
  const out = await runTiled(runner, "manga_line", Float32Array.from(gray), 1, H, W);
  const line = new Uint8Array(wt * ht);
  for (let y = 0; y < ht; y++) {
    for (let x = 0; x < wt; x++) {
      const v = Math.min(Math.max(out.data[y * W + x], 0), 255);
      line[y * wt + x] = 255 - Math.trunc(v);
    }
  }
  return { data: line, w: wt, h: ht };
}

// 色の境界（TEED）: RGB uint8 → 輪郭の強さ uint8（白線/黒地）。{data, w, h}
export async function teed(runner, rgb, w, h, safeSteps = 2) {
  const { img, W, H, wt, ht } = resizeWithPad(rgb, w, h, 3, Math.min(h, w));
  const n = W * H;
  const data = new Float32Array(3 * n);
  for (let p = 0; p < n; p++) for (let c = 0; c < 3; c++) data[c * n + p] = img[p * 3 + c];
  const outs = await runner("teed", { data, dims: [1, 3, H, W] });
  const edge = new Uint8Array(wt * ht);
  for (let y = 0; y < ht; y++) {
    for (let x = 0; x < wt; x++) {
      const p = y * W + x;
      // np.mean(np.stack(..., axis=2), axis=2)（float32）→ float64 の sigmoid
      let s = 0;
      for (const o of outs) s = f32(s + o.data[p]);
      const m = f32(s / outs.length);
      let e = 1 / (1 + Math.exp(-m));
      if (safeSteps) e = f32(Math.trunc(f32(f32(e) * (safeSteps + 1))) / safeSteps);
      edge[y * wt + x] = Math.trunc(Math.min(Math.max(f32(e * 255.0), 0), 255));
    }
  }
  return { data: edge, w: wt, h: ht };
}

// 顔の部位: RGB uint8（w と h は 64 の倍数）→ 部位の番号（w × h）
export async function faceParts(runner, rgb, w, h) {
  const n = w * h;
  const data = new Float32Array(3 * n);
  for (let p = 0; p < n; p++) for (let c = 0; c < 3; c++) data[c * n + p] = f32(rgb[p * 3 + c] / 255);
  const [out] = await runner("face", { data, dims: [1, 3, h, w] });
  const k = out.dims[1];
  const parts = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    let best = -Infinity, bi = 0;
    for (let c = 0; c < k; c++) {
      const v = out.data[c * n + p];
      if (v > best) { best = v; bi = c; }
    }
    parts[p] = bi;
  }
  return parts;
}

const BG_SIZE = 1024;
const BG_MEAN = [0.485, 0.456, 0.406];

// 背景を消す: RGB uint8 → 前景の濃さ uint8（w × h、255 が前景）。rembg の isnet-anime と同じ前と後の処理（aame/models.py の foreground）
export async function foreground(runner, rgb, w, h) {
  const S = BG_SIZE, n = S * S;
  const im = resizePIL(rgb, w, h, 3, S, S, "lanczos");
  let mx = 0;
  for (let i = 0; i < im.length; i++) if (im[i] > mx) mx = im[i];
  const den = Math.max(mx, 1e-6);
  const data = new Float32Array(3 * n);
  for (let p = 0; p < n; p++) for (let c = 0; c < 3; c++) data[c * n + p] = im[3 * p + c] / den - BG_MEAN[c];
  const [out] = await runner("bg", { data, dims: [1, 3, S, S] });
  let mi = Infinity, ma = -Infinity;
  for (let p = 0; p < n; p++) { const v = out.data[p]; if (v < mi) mi = v; if (v > ma) ma = v; }
  if (ma - mi < 1e-6) return new Uint8Array(w * h).fill(255);
  const range = f32(ma - mi), m = new Uint8Array(n);
  for (let p = 0; p < n; p++) m[p] = Math.trunc(f32(f32(f32(out.data[p] - mi) / range) * 255));
  return resizePIL(m, S, S, 1, w, h, "lanczos");
}
