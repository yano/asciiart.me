// 「使う文字」で文字を足すとき、その文字の形と幅を、この PC のフォントで描いて作る。
//
// MS Pゴシックがあれば（Windows）それで描く。canvas に 16px で描いた形は、辞書（chrDict_20261115）の 551 文字と
// 画素まで同じになる（2026-11-17 に確かめた。ベースラインは行の上端から 16px）。
// 無ければ Saitamaar（MS Pゴシックと幅を合わせた AA 用のフォント。OFL）で描く。形は少し違う（551 文字のうち 19 文字）ので、
// MS Pゴシックと幅が同じ文字だけを足せる。どの文字を足せるかと幅は addable.json（webapp/make_addable.mjs）。
// フォントのファイルは配らない（描くのは使う人の PC のフォント）。
//
// 文字の形は {ch, w, rows}（rows は 18 行の "0"/"1" の文字列。長さ w。1 がインク）。辞書のファイルと同じ形。

import { MAX_W, ROW_H } from "./aame/glyphs.js";
import { t } from "./i18n.js";

const MSPG = '16px "ＭＳ Ｐゴシック"';
const SAITAMAAR = "aame-add-saitamaar";
const BASELINE = 16;
const PAD = 8;

let table = null;     // 符号位置 → [幅, Saitamaar で描けるか]
async function addable() {
  if (!table) {
    const res = await fetch("addable.json");
    if (!res.ok) throw new Error(t("足せる文字の表が読めませんでした"));
    const { runs } = await res.json();
    table = new Map();
    let cp = 0;
    for (let i = 0; i < runs.length; i += 4) {
      cp += runs[i];
      for (let k = 0; k < runs[i + 1]; k++) table.set(cp++, [runs[i + 2], runs[i + 3] === 1]);
    }
  }
  return table;
}

let ctx = null;
function draw(ch, font, w) {
  if (!ctx) {
    const c = document.createElement("canvas");
    c.width = MAX_W + 2 * PAD;
    c.height = ROW_H + 2 * PAD;
    ctx = c.getContext("2d", { willReadFrequently: true });
  }
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = "#000";
  ctx.font = font;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(ch, PAD, PAD + BASELINE);
  const d = ctx.getImageData(PAD, PAD, w, ROW_H).data;
  const rows = [];
  for (let y = 0; y < ROW_H; y++) {
    let s = "";
    for (let x = 0; x < w; x++) s += d[(y * w + x) * 4] < 128 ? "1" : "0";
    rows.push(s);
  }
  return rows;
}

// base（標準の辞書の GlyphSet）の形と、MS Pゴシックで描いた形が合うか（合えばこの PC に MS Pゴシックがある）
function hasMSPGothic(base) {
  let same = 0;
  for (let i = 0; i < base.size; i++) {
    const w = base.widths[i];
    const rows = draw(base.chars[i], MSPG, w);
    const bm = base.bitmap(i);
    let ok = true;
    for (let y = 0; y < ROW_H && ok; y++) for (let x = 0; x < w; x++) if ((rows[y][x] === "1") !== !!bm[y * MAX_W + x]) { ok = false; break; }
    if (ok) same++;
  }
  return same >= base.size * 0.98;
}

// 文字を描くもの。mode は "mspgothic" か "saitamaar"（どちらも使えなければ例外）
// base: 標準の辞書（GlyphSet）、saitamaarURL: Saitamaar のファイル（fonts.json の file）
export async function glyphMaker(base, saitamaarURL) {
  const t = await addable();
  let mode = "mspgothic", font = MSPG;
  // ?addfont=saitamaar で、MS Pゴシックがあっても Saitamaar で描く（試験用）
  const force = new URLSearchParams(location.search).get("addfont") === "saitamaar";
  if (force || !hasMSPGothic(base)) {
    if (!saitamaarURL) throw new Error(t("文字を描くフォントがありません"));
    const face = new FontFace(SAITAMAAR, `url(${saitamaarURL})`);
    await face.load();
    document.fonts.add(face);
    mode = "saitamaar";
    font = `16px "${SAITAMAAR}"`;
  }
  return {
    mode,
    // 文字の形 {ch, w, rows}。足せない文字は {ch, reason}（"missing": MS Pゴシックに無いか幅が範囲の外、
    // "saitamaar": この PC では描けない〈Saitamaar に無いか、幅が MS Pゴシックと違う〉）
    make(ch) {
      const e = t.get(ch.codePointAt(0));
      if (!e) return { ch, reason: "missing" };
      if (mode === "saitamaar" && !e[1]) return { ch, reason: "saitamaar" };
      return { ch, w: e[0], rows: draw(ch, font, e[0]) };
    },
  };
}

// 文字の形の並びを、辞書のファイルの形式にする（改行は CRLF。標準の辞書と同じ）
export function dictText(glyphs) {
  const out = [String(glyphs.length)];
  for (const g of glyphs) out.push(g.ch, String(g.w), ...g.rows);
  return out.join("\r\n") + "\r\n";
}

// GlyphSet の i 番目の文字を {ch, w, rows} にする
export function glyphOf(set, i) {
  const w = set.widths[i], bm = set.bitmap(i);
  const rows = [];
  for (let y = 0; y < ROW_H; y++) {
    let s = "";
    for (let x = 0; x < w; x++) s += bm[y * MAX_W + x] ? "1" : "0";
    rows.push(s);
  }
  return { ch: set.chars[i], w, rows };
}
