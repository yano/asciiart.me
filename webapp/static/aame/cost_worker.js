// 当てはめの行の一部を求める Worker（pool.js が使う）。
// {glyphs: {key, chars, widths, bitmaps}} で辞書を受け取り、{id, key, ctx}（cost.js の band で切り出したもの）で
// その行のコストと並びを求めて {id, picked, totals} を返す。辞書が無ければ {id, need: key} を返す（送り直してもらう）。

import { GlyphSet } from "./glyphs.js";
import { rowCosts } from "./cost.js";
import { matchCost } from "./match.js";

const MAX_SETS = 4;
const sets = new Map();

onmessage = ({ data }) => {
  if (data.glyphs) {
    const g = data.glyphs;
    sets.set(g.key, new GlyphSet(g.chars, g.widths, g.bitmaps));
    while (sets.size > MAX_SETS) sets.delete(sets.keys().next().value);
    return;
  }
  const { id, key, ctx } = data;
  const glyphs = sets.get(key);
  if (!glyphs) {
    postMessage({ id, need: key });
    return;
  }
  try {
    const r = rowCosts(ctx, glyphs);
    const m = matchCost(r.c, r.term, r.rows, r.nx, glyphs);
    postMessage({ id, picked: m.picked, totals: m.totals });
  } catch (e) {
    postMessage({ id, error: e?.message || String(e) });
  }
};
