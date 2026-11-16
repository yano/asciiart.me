// ずれに寛容で、線の向きも見る当てはめコスト（v2）。aame/cost.py を JavaScript に移したもの。
//
// 文字を置いたときのコストは「余計な線（文字のインクが目標の線から外れている量）」と
// 「取りこぼし（目標の線が文字のインクから外れている量）× lam」の和。考え方は aame/cost.py を参照。
//
// Python は「窓 × 文字」の行列の積で全位置・全文字ぶんを求める。どちらの項も片方がまばら
// （文字のインクは特徴の 1% 弱、目標の線は 0.3% ほど）なので、ここでは 0 でない所だけを足す:
//   余計な線  文字の形ごとに、そのインクの画素の「外れ」を、全位置について足す
//   取りこぼし 目標の線の画素ごとに、それが入る 16 の位置について、全部の形の「取りこぼし」を足す
// 値は Python と浮動小数の誤差まで同じ（足す順が違うので、まれに同点に近い所で選ぶ文字が変わる）。

import { CELL, MAX_W, ROW_H } from "./glyphs.js";
import { bins } from "./orient.js";
import { edt32, edtSquared } from "./img.js";

export const N_BINS = 8;
export const TAU = 3.0;
export const MU = 1.0;
export const NU = 2.0;
export const FAR = 6.0;
export const SHORT = 6;
const N_CH = N_BINS + 1;
const _FAR = 1.0e3;
const f32 = Math.fround;

// 相手側の画素から見た「外れ」を 0..1 で返す。Float32Array(N_CH × h × w)。aame/cost.py の _penalty。
// ofText が true なら mask は文字（相手は目標の線）、false なら mask は目標の線（相手は文字）。
export function penalty(mask, b, h, w, ofText) {
  const n = h * w;
  const sel = new Uint8Array(n);
  const dist = (pred) => {
    for (let p = 0; p < n; p++) sel[p] = pred(p) ? 1 : 0;
    return edt32(sel, h, w, _FAR);
  };
  const byBin = [];
  for (let j = 0; j < N_BINS; j++) byBin.push(dist((p) => b[p] === j));
  const plain = dist((p) => b[p] === -1);
  const anyone = dist((p) => mask[p] !== 0);
  const out = new Float32Array(N_CH * n);
  const nu = f32(NU);
  for (let k = 0; k < N_BINS; k++) {
    const apart = [];
    for (let j = 0; j < N_BINS; j++) apart.push(MU * Math.min((j - k + N_BINS) % N_BINS, (k - j + N_BINS) % N_BINS));
    const o = out.subarray(k * n, (k + 1) * n);
    for (let p = 0; p < n; p++) {
      let best = ofText ? f32(plain[p] + nu) : plain[p];
      for (let j = 0; j < N_BINS; j++) {
        const v = f32(byBin[j][p] + apart[j]);
        if (v < best) best = v;
      }
      o[p] = f32(Math.min(best, TAU) / TAU);
    }
  }
  const o = out.subarray(N_BINS * n);
  for (let p = 0; p < n; p++) {
    const v = ofText ? anyone[p] : Math.min(plain[p], f32(anyone[p] + nu));
    o[p] = f32(Math.min(v, TAU) / TAU);
  }
  return out;
}

// 黒い面を埋める役に使う文字か（英数字・ギリシャ文字・キリル文字・ひらがな・全角カタカナ〈ミを除く〉は使わない）
export function fills(ch) {
  const o = ch.codePointAt(0);
  const letter = (o < 0x80 && /[0-9A-Za-z]/.test(ch)) || (o >= 0xff10 && o <= 0xff19) || (o >= 0xff21 && o <= 0xff3a)
    || (o >= 0xff41 && o <= 0xff5a) || (o >= 0x0370 && o <= 0x03ff) || (o >= 0x0400 && o <= 0x04ff)
    || (o >= 0x3041 && o <= 0x3096) || (o >= 0x30a1 && o <= 0x30fa && ch !== "ミ");
  return !letter;
}

// 文字側の量（辞書と shift ごとに1度だけ求める）。aame/cost.py の GlyphCost。
// 背の低い文字（インクの高さが SHORT 以下）は、上下に shift px までずらした形も持つ（「形」）。
// 形は元の文字ごとにまとめ、ずらさない形を先頭にする。
class GlyphCost {
  constructor(glyphs, shift) {
    const forms = [];   // [ビットマップ, 元の文字, ずらし量]
    for (let i = 0; i < glyphs.size; i++) {
      const bm = glyphs.bitmap(i);
      forms.push([bm, i, 0]);
      let y0 = -1, y1 = -1;
      for (let y = 0; y < ROW_H; y++) {
        for (let x = 0; x < MAX_W; x++) if (bm[y * MAX_W + x]) { if (y0 < 0) y0 = y; y1 = y; break; }
      }
      if (y0 < 0 || y1 - y0 + 1 > SHORT) continue;
      for (let dy = -shift; dy <= shift; dy++) {
        if (dy === 0 || y0 + dy < 0 || y1 + dy >= ROW_H) continue;
        const moved = new Uint8Array(CELL);
        moved.set(bm.subarray(0, (ROW_H - Math.max(dy, 0)) * MAX_W).subarray(Math.max(-dy, 0) * MAX_W), Math.max(dy, 0) * MAX_W);
        forms.push([moved, i, dy]);
      }
    }
    const F = forms.length;
    this.F = F;
    this.owner = Int32Array.from(forms.map((f) => f[1]));
    this.starts = new Int32Array(glyphs.size + 1);
    for (let f = F - 1; f >= 0; f--) this.starts[this.owner[f]] = f;
    this.starts[glyphs.size] = F;
    // ink: 形ごとのインクの画素（特徴の番号 = (向き × ROW_H + y) × MAX_W + x）。inkStart[f]..inkStart[f+1]
    // tone: 黒い面を埋める役の文字のインクの画素（y × MAX_W + x）
    // missT[特徴 × F + 形] = そこに向き k の目標の線があったときの取りこぼし（文字の幅の外は 0）
    const ink = [], inkStart = [0], tone = [], toneStart = [0];
    this.missT = new Float32Array(N_CH * CELL * F);
    this.movedInk = new Float32Array(F);
    forms.forEach(([bm, owner, dy], f) => {
      const b = bins(bm, ROW_H, MAX_W, N_BINS);
      const usable = fills(glyphs.chars[owner]);
      let count = 0;
      for (let p = 0; p < CELL; p++) {
        if (!bm[p]) continue;
        const ch = b[p] === -1 ? N_BINS : b[p];
        ink.push(ch * CELL + p);
        if (usable) tone.push(p);
        count++;
      }
      inkStart.push(ink.length);
      toneStart.push(tone.length);
      this.movedInk[f] = Math.abs(dy) * count;
      const miss = penalty(bm, b, ROW_H, MAX_W, true);
      const wd = glyphs.widths[owner];
      for (let ch = 0; ch < N_CH; ch++) {
        for (let y = 0; y < ROW_H; y++) {
          for (let x = 0; x < wd; x++) {
            const feat = ch * CELL + y * MAX_W + x;
            this.missT[feat * F + f] = miss[feat];
          }
        }
      }
    });
    this.ink = Int32Array.from(ink);
    this.inkStart = Int32Array.from(inkStart);
    this.tone = Int32Array.from(tone);
    this.toneStart = Int32Array.from(toneStart);
    this._lamMiss = new Map();
  }

  // lam × 取りこぼし（float32。Python の lam * gc.miss と同じ丸め）
  lamMiss(lam) {
    let t = this._lamMiss.get(lam);
    if (!t) {
      const l = f32(lam);
      t = new Float32Array(this.missT.length);
      for (let i = 0; i < t.length; i++) t[i] = l * this.missT[i];
      this._lamMiss.clear();
      this._lamMiss.set(lam, t);
    }
    return t;
  }
}

const _CACHE = new WeakMap();

export function glyphCost(glyphs, shift = 0) {
  let byShift = _CACHE.get(glyphs);
  if (!byShift) _CACHE.set(glyphs, (byShift = new Map()));
  let gc = byShift.get(shift);
  if (!gc) byShift.set(shift, (gc = new GlyphCost(glyphs, shift)));
  return gc;
}

// 行によらない準備（線の向き、「外れ」の面、幻の線、黒い面）。aame/cost.py の costs の前半。
// mask は目標の線（Uint8Array h × w、1px の細い線）。opt: lam, phantom, weight（Float32Array h × w か null）,
// shift, slide, fill（Uint8Array h × w か null）, fillGain。返り値（ctx）は rowCosts に渡す。
// ctx の配列はどれも「行 × ROW_H」の高さで、band で一部の行だけを切り出せる（Worker に分けて渡すため）
export function prepare(mask, h, w, opt = {}) {
  const { lam = 2.0, phantom = 1.5, weight = null, shift = 4, slide = 0.4, fill = null, fillGain = 0.5 } = opt;
  const rows = Math.floor(h / ROW_H), H = rows * ROW_H, W = w, n = H * W;
  const m = mask.subarray(0, n);
  const b = bins(m, H, W, N_BINS);
  const pen = penalty(m, b, H, W, false);
  const lam32 = f32(lam);
  // 幻の線: 目標のどの線からも離れた所のインクを重くする
  const sq = edtSquared(m, H, W);
  if (sq !== null) {
    const ph32 = f32(phantom);
    const flat = Math.max(phantom * lam - 1.0, 0.0);
    for (let p = 0; p < n; p++) {
      const away = Math.min(Math.max((Math.sqrt(sq[p]) - TAU) / (FAR - TAU), 0.0), 1.0);
      const extra = weight ? Math.max(f32(f32(ph32 * f32(lam32 * weight[p])) - 1.0), 0.0) * away : flat * away;
      if (extra === 0) continue;
      for (let ch = 0; ch < N_CH; ch++) pen[ch * n + p] = pen[ch * n + p] + extra;
    }
  }
  if (fill) {
    for (let p = 0; p < n; p++) if (fill[p]) for (let ch = 0; ch < N_CH; ch++) pen[ch * n + p] = 0;
  }
  return { rows, W, m, b, pen, weight: weight ? weight.subarray(0, n) : null, fill: fill ? fill.subarray(0, n) : null,
    lam, shift, slide, fillGain };
}

// ctx の行 [r0, r1) だけを切り出した ctx（配列は新しく作る。Worker に移せる）
export function band(ctx, r0, r1) {
  const { W } = ctx, n = ctx.rows * ROW_H * W, a = r0 * ROW_H * W, e = r1 * ROW_H * W, k = e - a;
  const pen = new Float32Array(N_CH * k);
  for (let ch = 0; ch < N_CH; ch++) pen.set(ctx.pen.subarray(ch * n + a, ch * n + e), ch * k);
  return { ...ctx, rows: r1 - r0, m: ctx.m.slice(a, e), b: ctx.b.slice(a, e), pen,
    weight: ctx.weight ? ctx.weight.slice(a, e) : null, fill: ctx.fill ? ctx.fill.slice(a, e) : null };
}

// c[行, x, 文字] = その行の x に文字を置いたときのコスト（x は 0..w）と、行を終えるコスト term[行, x]。
// aame/cost.py の costs と同じ。opt は prepare と同じものと、only（求める行の番号の配列。省くと全部）。
// 返り値: {c: Float32Array(行 × (w+1) × 文字), term: Float64Array(行 × (w+1)), rows（求めた行の数）, nx: w + 1}
export function costs(mask, h, w, glyphs, opt = {}) {
  return rowCosts(prepare(mask, h, w, opt), glyphs, opt.only || null);
}

// prepare の ctx から、行ごとのコストを求める（pick は行の番号の配列。省くと全部）
export function rowCosts(ctx, glyphs, pick = null) {
  const { rows, W, m, b, pen, weight, fill, lam, slide, fillGain } = ctx;
  const n = rows * ROW_H * W;
  const gc = glyphCost(glyphs, ctx.shift);
  const F = gc.F, N = glyphs.size, NX = W + 1, PW = W + MAX_W;
  const lam32 = f32(lam);
  const fillValue = f32(-fillGain);
  const lamMiss = gc.lamMiss(lam);
  const moved = new Float32Array(F);
  const slide32 = f32(slide);
  for (let f = 0; f < F; f++) moved[f] = slide32 * gc.movedInk[f];

  pick = pick || Array.from({ length: rows }, (_, r) => r);
  const c = new Float32Array(pick.length * NX * N);
  const term = new Float64Array(pick.length * NX);
  const A = new Float64Array(F * NX);     // 余計な線（と黒い面）。形ごとに x を並べる
  const B = new Float64Array(NX * F);     // 取りこぼし。x ごとに形を並べる
  const P = new Float32Array(N_CH * ROW_H * PW);
  const PF = fill ? new Float32Array(ROW_H * PW) : null;
  const inkOff = new Int32Array(gc.ink.length);
  for (let e = 0; e < gc.ink.length; e++) {
    const feat = gc.ink[e];
    inkOff[e] = Math.floor(feat / MAX_W) * PW + (feat % MAX_W);
  }

  pick.forEach((r, i) => {
    // この行の「外れ」の帯（右にはみ出す所は 1）
    for (let ch = 0; ch < N_CH; ch++) {
      for (let y = 0; y < ROW_H; y++) {
        const dst = (ch * ROW_H + y) * PW, src = ch * n + (r * ROW_H + y) * W;
        P.set(pen.subarray(src, src + W), dst);
        P.fill(1.0, dst + W, dst + PW);
      }
    }
    A.fill(0);
    B.fill(0);
    for (let f = 0; f < F; f++) {
      const a0 = f * NX;
      for (let e = gc.inkStart[f]; e < gc.inkStart[f + 1]; e++) {
        const off = inkOff[e];
        for (let x = 0; x < NX; x++) A[a0 + x] += P[off + x];
      }
    }
    if (PF) {
      PF.fill(0);
      for (let y = 0; y < ROW_H; y++) {
        const src = (r * ROW_H + y) * W;
        for (let x = 0; x < W; x++) if (fill[src + x]) PF[y * PW + x] = fillValue;
      }
      for (let f = 0; f < F; f++) {
        const a0 = f * NX;
        for (let e = gc.toneStart[f]; e < gc.toneStart[f + 1]; e++) {
          const p = gc.tone[e];
          const off = Math.floor(p / MAX_W) * PW + (p % MAX_W);
          for (let x = 0; x < NX; x++) A[a0 + x] += PF[off + x];
        }
      }
    }
    // 取りこぼしと、行を終えるコスト（x より右の目標の線をすべて取りこぼす）
    const col = new Float32Array(W);
    for (let y = 0; y < ROW_H; y++) {
      const src = (r * ROW_H + y) * W;
      for (let X = 0; X < W; X++) {
        const p = src + X;
        if (!m[p]) continue;
        const t = weight ? weight[p] : 1.0;
        col[X] = col[X] + t;
        const ch = b[p] === -1 ? N_BINS : b[p];
        const feat0 = ch * CELL + y * MAX_W;
        for (let dx = 0; dx < MAX_W && dx <= X; dx++) {
          const base = (feat0 + dx) * F, xb = (X - dx) * F;
          for (let f = 0; f < F; f++) B[xb + f] += t * lamMiss[base + f];
        }
      }
    }
    const t0 = i * NX;
    let cum = 0;
    for (let X = W - 1; X >= 0; X--) {
      cum = f32(cum + col[X]);
      term[t0 + X] = f32(lam32 * cum);
    }
    term[t0 + W] = 0;
    for (let X = 0; X < Math.max(W - MAX_W + 1, 0); X++) term[t0 + X] = Infinity;
    // 文字ごとに、ずらした形のうち最も合うものを取る
    const c0 = i * NX * N;
    for (let ci = 0; ci < N; ci++) {
      const fs = gc.starts[ci], fe = gc.starts[ci + 1];
      for (let x = 0; x < NX; x++) {
        let best = Infinity;
        for (let f = fs; f < fe; f++) {
          const v = f32(f32(A[f * NX + x] + B[x * F + f]) + moved[f]);
          if (v < best) best = v;
        }
        c[c0 + x * N + ci] = best;
      }
    }
  });
  return { c, term, rows: pick.length, nx: NX };
}
