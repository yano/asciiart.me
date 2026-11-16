// 線画の各行に文字を当てはめる。aame/match.py の v1 と v2 を JavaScript に移したもの（legacy は移さない）。
//
// 行ごとに、各 x から始まる各幅の文字のうち最も合うものを選んで「x から x + 幅 へ進む辺」とし、
// 半角スペースを続けない・行頭に置かない、という条件つきで、行の左端から右端までの
// 最もコストの小さい並びを求める。

import { MAX_W, MIN_W, N_WIDTHS, ROW_H } from "./glyphs.js";

const TOP = 2;          // v1: 各行の上 2px は比べない
const BAND_H = ROW_H - TOP;
const POW = 0.4 * Math.log(1.5) / Math.log(2.0) + 0.7;
// COST[n] = 食い違う画素が n 個のときのコスト（v1）
export const COST = Float64Array.from({ length: BAND_H * MAX_W + 1 }, (_, n) => Math.pow(65025.0 * n, POW));

function _cost(n) {
  return COST[Math.min(n, COST.length - 1)];
}

// 幅ごとに最も合う文字を選ぶ。c は (位置, 文字) の Float32Array か Float64Array。
// {count: Float64Array(位置 × N_WIDTHS), glyph: Int32Array(位置 × N_WIDTHS)} を返す（候補が無い所は -1）。
// 同点なら辞書で先にある文字。skip はその番号の文字を外す。onlyK を渡すとその幅の種類だけ求める。
export function bestPerWidth(c, nPos, glyphs, skip = -1, onlyK = -1) {
  const N = glyphs.size;
  const count = new Float64Array(nPos * N_WIDTHS).fill(Infinity);
  const glyph = new Int32Array(nPos * N_WIDTHS).fill(-1);
  for (let k = 0; k < N_WIDTHS; k++) {
    if (onlyK >= 0 && k !== onlyK) continue;
    const idx = glyphs.byWidth[k];
    for (let pos = 0; pos < nPos; pos++) {
      const row = pos * N;
      let best = Infinity, bi = -1;
      for (let j = 0; j < idx.length; j++) {
        const g = idx[j];
        if (g === skip) continue;
        const v = c[row + g];
        if (v < best) { best = v; bi = g; }
      }
      count[pos * N_WIDTHS + k] = best;
      glyph[pos * N_WIDTHS + k] = bi;
    }
  }
  return { count, glyph };
}

// 1行の並びを求める（aame/match.py の solve_rows と同じ。同点のときの選び方も同じ）。
// best, glyph は (x, 幅の種類)、altCost, altGlyph, term は (x)。文字の番号の列と、合計コストを返す。
export function solveRow(best, glyph, altCost, altGlyph, term, space, nx) {
  const width = nx - 1;
  const free = new Float64Array(nx + MAX_W).fill(Infinity);   // 直前が半角スペースでないとき
  const held = new Float64Array(nx + MAX_W).fill(Infinity);   // 直前が半角スペースのとき
  const freeK = new Int32Array(nx).fill(-1);
  const heldK = new Int32Array(nx).fill(-1);
  for (let x = width; x >= 0; x--) {
    let bf = Infinity, bfk = -1, bh = Infinity, bhk = -1;
    for (let k = N_WIDTHS - 1; k >= 0; k--) {      // 広い文字から見る（同点なら広いほう）
      const nxt = x + MIN_W + k;
      const g = glyph[x * N_WIDTHS + k];
      const sp = g === space;
      const vf = g < 0 ? Infinity : best[x * N_WIDTHS + k] + (sp ? held[nxt] : free[nxt]);
      const vh = sp ? (altGlyph[x] >= 0 ? altCost[x] + free[nxt] : Infinity) : vf;
      if (vf < bf) { bf = vf; bfk = k; }
      if (vh < bh) { bh = vh; bhk = k; }
    }
    if (bf < term[x]) { free[x] = bf; freeK[x] = bfk; } else { free[x] = term[x]; }
    if (bh < term[x]) { held[x] = bh; heldK[x] = bhk; } else { held[x] = term[x]; }
  }
  const out = [];
  let x = 0, isHeld = true;
  for (;;) {
    const k = (isHeld ? heldK : freeK)[x];
    if (k < 0) break;
    let g = glyph[x * N_WIDTHS + k];
    if (g === space && isHeld) {
      g = altGlyph[x];
      isHeld = false;
    } else {
      isHeld = g === space;
    }
    out.push(g);
    x += k + MIN_W;
  }
  return { picked: out, total: held[0] };
}

// コスト c[行, x, 文字] と、行を終えるコスト term[行, x] から、最もコストの小さい並びを求める。
// 行ごとの文字の番号の列 picked と、文字列 lines、合計コスト totals を返す。
export function matchCost(c, term, rows, nx, glyphs) {
  const N = glyphs.size;
  const space = glyphs.index(" ");
  const kSpace = glyphs.widths[space] - MIN_W;
  const picked = [], lines = [], totals = [];
  for (let r = 0; r < rows; r++) {
    const cr = c.subarray(r * nx * N, (r + 1) * nx * N);
    const { count, glyph } = bestPerWidth(cr, nx, glyphs);
    const alt = bestPerWidth(cr, nx, glyphs, space, kSpace);
    const altCost = new Float64Array(nx), altGlyph = new Int32Array(nx);
    for (let x = 0; x < nx; x++) {
      altCost[x] = alt.count[x * N_WIDTHS + kSpace];
      altGlyph[x] = alt.glyph[x * N_WIDTHS + kSpace];
    }
    const s = solveRow(count, glyph, altCost, altGlyph, term.subarray(r * nx, (r + 1) * nx), space, nx);
    picked.push(s.picked);
    lines.push(s.picked.map((g) => glyphs.chars[g]).join(""));
    totals.push(s.total);
  }
  return { picked, lines, totals };
}

// v1 のコスト c[行, x, 文字]（食い違う画素の数のコスト。Float64Array）と、行を終えるコスト term[行, x]。
// mask は線画（Uint8Array h × w）。only は求める行の番号の配列（省くと全部）。
export function v1Costs(mask, h, w, glyphs, only = null) {
  const rows = Math.floor(h / ROW_H), N = glyphs.size, NX = w + 1;
  const pick = only || Array.from({ length: rows }, (_, r) => r);
  const c = new Float64Array(pick.length * NX * N);
  const term = new Float64Array(pick.length * NX);
  // 文字のインク（上の TOP 行を除く）
  const inkPix = [], inkStart = [0], inkSum = new Int32Array(N);
  for (let g = 0; g < N; g++) {
    const bm = glyphs.bitmap(g);
    for (let y = TOP; y < ROW_H; y++) for (let x = 0; x < MAX_W; x++) {
      if (bm[y * MAX_W + x]) { inkPix.push(y * MAX_W + x); inkSum[g]++; }
    }
    inkStart.push(inkPix.length);
  }
  const PW = w + MAX_W;
  const band = new Uint8Array(ROW_H * PW);
  const pre = new Int32Array(PW + 1);
  const overlap = new Int32Array(NX);
  pick.forEach((r, i) => {
    band.fill(0);
    for (let y = 0; y < ROW_H; y++) band.set(mask.subarray((r * ROW_H + y) * w, (r * ROW_H + y + 1) * w), y * PW);
    // 列ごとの線の画素数（上の TOP 行を除く）の累積
    for (let x = 0; x < PW; x++) {
      let s = 0;
      for (let y = TOP; y < ROW_H; y++) s += band[y * PW + x];
      pre[x + 1] = pre[x] + s;
    }
    const c0 = i * NX * N;
    for (let g = 0; g < N; g++) {
      overlap.fill(0);
      for (let e = inkStart[g]; e < inkStart[g + 1]; e++) {
        const p = inkPix[e];
        const off = Math.floor(p / MAX_W) * PW + (p % MAX_W);
        for (let x = 0; x < NX; x++) overlap[x] += band[off + x];
      }
      const wd = glyphs.widths[g];
      for (let x = 0; x < NX; x++) {
        const inWindow = pre[x + wd] - pre[x];
        c[c0 + x * N + g] = _cost(inWindow + inkSum[g] - 2 * overlap[x]);
      }
    }
    const t0 = i * NX;
    for (let x = 0; x <= w; x++) term[t0 + x] = _cost(pre[w] - pre[x]);
    for (let x = 0; x < Math.max(w - MAX_W + 1, 0); x++) term[t0 + x] = Infinity;
  });
  return { c, term, rows: pick.length, nx: NX };
}

// 太い線が2重線（l!）になったものの置き換え（幅は変わらない）。置き換えた先の文字が辞書に無いものはしない
const DOUBLE_LINES = [["l!", "|."], ["j!", "｝"]];

export function fixDoubleLines(text, glyphs = null) {
  for (const [a, b] of DOUBLE_LINES) {
    if (glyphs === null || Array.from(b).every((ch) => glyphs.has(ch))) text = text.split(a).join(b);
  }
  return text;
}

export function finish(lines, glyphs = null) {
  return lines.map((s) => fixDoubleLines(s, glyphs));
}
