// 仕上げの「陰影」: AA の空白（半角・全角のスペース）を、陰影の文字と空白で埋め直す。
//
// - 空白の並び（1 行の中で続いた空白）を単位にする。押した行の並びだけを埋める（1 行塗り）か、上下の行の並びと
//   横に MIN_OVERLAP px 以上重なればつながっているとみなして、つながった並びをすべて埋める（バケツ塗り）。
// - 行の幅は変えない（並びと同じ幅で埋める）。行の終わりの空白だけは、AA の右端にそろえる。
// - 掲示板で崩れないよう、半角スペースを続けない・行頭に置かない（エンジンの v1 と同じ決まり）。
// - 文字は、AA 全体で共通の升目（pattern の pitch。低密度は 1 行おきに半分ずらす）に乗るように置く。
//   並びの左端・幅はばらばらで、空白は 5px と 11px しかないので、升目から少しずれるのは許し（tol px まで）、
//   幅の広い文字では余りを細い文字（FILLER）でも埋めて、ずれを小さくする（動的計画法）。

export const HALF = " ";
export const FULL = "　";
export const isBlank = (ch) => ch === HALF || ch === FULL;

export const SHADE_CHARS = [":", ";", "i", "/", "ﾆ", "三", "_"];   // 陰影に使う文字（どれも標準の辞書にある）
export const FILLER = ".";       // 幅の広い文字の余りを埋める細い文字（幅 3）

export const MIN_OVERLAP = 5;   // 上下の空白がこれだけ重なれば、つながっているとみなす（px。半角スペースの幅）
const HALF_W = 5;
const FULL_W = 11;
const END_SLACK = 6;            // 行の終わりの空白を AA の右端にそろえるとき、はみ出してよい幅（px）
const END_WEIGHT = 0.3;         // 右端からのずれ 1px の重さ（文字 1 つの得は 1）
const NEAR_INK = 16;            // 線からこれより近い所では、升目から大きくずれた文字の損を小さくする（px）
const HOLE_WEIGHT = 0.0005;     // 穴の、線からの距離 1px の重さ（同じ数の文字を置けるときに、穴の場所を選ぶだけ）
const FILLER_COST = 0.1;        // 線の近くの細い文字 1 つの重さ（升目とのずれ 1px より軽い）
const FILLER_FAR = 0.5;         // 線から離れた所の細い文字 1 つの重さ（何もない所の点は目立つので、ずれが続くときだけ使う）

// 模様。高密度は文字を続けて（:::）、低密度は半角スペースを挟んで（: : :）並べる。
// pitch: 文字を置く間隔（px）、stagger: 奇数の行で升目をずらす量、tol: 升目からずれてよい幅（px）、
// align: ずれ 1px の重さ、filler: 余りを細い文字で埋めるか（幅の広い文字だけ）
export function makePattern(ch, density, widthOf) {
  const w = widthOf(ch);
  const pitch = density === "sparse" ? w + HALF_W : w;
  return {
    ch, w, pitch,
    stagger: density === "sparse" ? Math.round(pitch / 2) : 0,
    tol: Math.min(3, Math.max(1, Math.floor((w - 1) / 2))),   // 隣の文字と升目の点を取り合わない幅
    align: w <= 3 ? 0 : 0.12,         // 幅 3 の文字の 1px のずれは目立たないので、細い文字で直さない
    filler: ch !== FILLER ? FILLER : null,
  };
}

// 模様の見本（ボタンに出す）
export function sample(ch, density) {
  return density === "sparse" ? `${ch} ${ch} ${ch}` : ch.repeat(3);
}

// 行ごとの空白の並び。{row, i0, i1（文字の番号。i1 は含まない）, a, b（px。b は含まない）, first（行頭）, last（行の終わり）}
export function blankRuns(lines, widthOf) {
  return lines.map((line, row) => {
    const chars = [...line];
    const runs = [];
    let x = 0;
    for (let i = 0; i < chars.length;) {
      if (!isBlank(chars[i])) {
        x += widthOf(chars[i]);
        i++;
        continue;
      }
      const i0 = i, a = x;
      while (i < chars.length && isBlank(chars[i])) x += widthOf(chars[i++]);
      runs.push({ row, i0, i1: i, a, b: x, first: i0 === 0, last: i === chars.length });
    }
    return runs;
  });
}

// 押した所 (row, x) の空白の並び（無ければ null）
export function runAt(runs, row, x) {
  const list = runs[row];
  if (!list) return null;
  // 行の終わりの空白は、AA の右端の先まで続いているとみなす
  return list.find((r) => x >= r.a && (x < r.b || r.last)) ?? null;
}

const overlap = (p, q) => Math.min(p.last ? Infinity : p.b, q.last ? Infinity : q.b) - Math.max(p.a, q.a);

// start からつながった空白の並び（上下の行へ、横に MIN_OVERLAP px 以上重なるもの）
export function regionOf(runs, start, minOverlap = MIN_OVERLAP) {
  const seen = new Set([start]);
  const todo = [start];
  while (todo.length) {
    const p = todo.pop();
    for (const r of [p.row - 1, p.row + 1]) {
      for (const q of runs[r] ?? []) {
        if (!seen.has(q) && overlap(p, q) >= minOverlap) {
          seen.add(q);
          todo.push(q);
        }
      }
    }
  }
  return [...seen];
}

// 空白の並び run を、陰影の文字と空白（と細い文字）で埋めた文字列。right: 行の終わりの並びをそろえる右端（px）
export function fillRun(run, pattern, widthOf, right) {
  const { ch, w: chW, pitch, tol, align, filler } = pattern;
  const fW = filler ? widthOf(filler) : 0;
  const phase = (run.row % 2) * pattern.stagger;
  const target = run.last ? Math.max(run.b, right) : run.b;
  const n = target - run.a + (run.last ? END_SLACK : 0);
  // best[x * 2 + h]: 並びの左端から x px までを埋めたときの重さの最小（h = 1: 最後が半角スペース）
  const best = new Float64Array((n + 1) * 2).fill(Infinity);
  const back = new Int8Array((n + 1) * 2);       // 0: 陰影の文字、1: 全角スペース、2: 半角スペース、3: 細い文字
  best[run.first ? 1 : 0] = 0;
  const near = (x, w) => Math.min(run.first ? Infinity : x, run.last ? Infinity : n - (x + w));
  // 文字を x に置く重さ: 升目の点から tol px 以内なら得（-1。ずれた分だけ減らす）、それより離れると損
  // （升目の点ごとに得は 1 つだけ。位置を合わせるために文字を詰めて並べないように）
  // ただし線（インクのある文字）のすぐ近くは損を小さくする（升目とのずれは、目立たない線の近くで直す）
  const cost = (x) => {
    let d = (((run.a + x - phase) % pitch) + pitch) % pitch;
    d = Math.min(d, pitch - d);
    if (d <= tol) return -1 + align * d;
    return near(x, chW) < NEAR_INK ? 0.3 : d;
  };
  // 模様の間より広い空白（穴）は、線の近くに寄せる（行頭や右端の側には寄せない）
  const gap = pitch - chW;
  const hole = (x, w) => {
    if (w <= gap) return 0;
    const d = near(x, w);
    return d === Infinity ? 0 : HOLE_WEIGHT * Math.max(0, d);
  };
  // 細い文字: 線の近くなら軽い。離れた所では、幅の広い文字の升目合わせにだけ使う（幅 3 の文字は線の近くだけ）
  const narrow = chW <= fW;
  const fillerCost = (x) => {
    const d = near(x, fW);
    if (d < NEAR_INK) return FILLER_COST;
    return narrow ? Infinity : FILLER_FAR;
  };
  const relax = (from, to, h, c, how) => {
    const k = to * 2 + h;
    if (to <= n && from + c < best[k]) {
      best[k] = from + c;
      back[k] = how;
    }
  };
  for (let x = 0; x < n; x++) {
    for (let h = 0; h < 2; h++) {
      const v = best[x * 2 + h];
      if (v === Infinity) continue;
      relax(v, x + chW, 0, cost(x), 0);
      relax(v, x + FULL_W, 0, hole(x, FULL_W), 1);
      if (!h) relax(v, x + HALF_W, 1, hole(x, HALF_W), 2);
      if (filler) relax(v, x + fW, 0, fillerCost(x), 3);
    }
  }
  // 終わり: ふつうは並びの幅ちょうど。行の終わりは右端に近い所
  let end = -1, endH = 0, endV = Infinity;
  const lo = run.last ? 0 : n;
  for (let x = lo; x <= n; x++) {
    for (let h = 0; h < 2; h++) {
      const v = best[x * 2 + h] + (run.last ? END_WEIGHT * Math.abs(run.a + x - target) : 0);
      if (v < endV) {
        endV = v;
        end = x;
        endH = h;
      }
    }
  }
  if (end < 0) return null;
  const chars = [ch, FULL, HALF, filler];
  const widths = [chW, FULL_W, HALF_W, fW];
  const out = [];
  for (let x = end, h = endH; x > 0;) {
    const how = back[x * 2 + h];
    out.push(chars[how]);
    x -= widths[how];
    // 前の状態: 半角スペースの前は半角スペースでない。ほかは、どちらだったかを重さで選ぶ
    h = how === 2 ? 0 : best[x * 2] <= best[x * 2 + 1] ? 0 : 1;
  }
  return out.reverse().join("");
}

// region（空白の並びの配列）を埋めた行。{row → 新しい行}
export function shadeLines(lines, region, pattern, widthOf, right) {
  const byRow = new Map();
  for (const run of region) {
    if (!byRow.has(run.row)) byRow.set(run.row, []);
    byRow.get(run.row).push(run);
  }
  const out = new Map();
  for (const [row, runs] of byRow) {
    const chars = [...lines[row]];
    runs.sort((p, q) => q.i0 - p.i0);       // 右から埋める（文字の番号がずれないように）
    for (const run of runs) {
      const fill = fillRun(run, pattern, widthOf, right);
      if (fill === null) continue;
      chars.splice(run.i0, run.i1 - run.i0, ...fill);
    }
    const line = chars.join("");
    if (line !== lines[row]) out.set(row, line);
  }
  return out;
}
