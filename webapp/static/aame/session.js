// 画像1枚ぶんの途中結果を持ち、設定を変えた AA を何度でも作り直す（aame/session.py を移したもの）。
// 線の強さ、顔の領域、色の境界、黒い面は、画像ごとに1度だけ求めて使い回す。
//
// 設定（settings）は Python と同じ名前: lam, color, fill, fill_gain, face_gain, mode, width, phantom, shift, slide,
// paint（塗り重ねた段階の灰色 {data: Uint8Array（L）, w, h} か null）, edit（線画の直し {data: RGBA, w, h} か
// [描いた線, 消した所] か null）。glyphs は使う文字の辞書（GlyphSet）。

import { ROW_H } from "./glyphs.js";
import { costs, prepare, rowCosts } from "./cost.js";
import { finish, matchCost, v1Costs } from "./match.js";
import { rint } from "./img.js";
import * as lineart from "./lineart.js";
import * as regions from "./regions.js";

const f32 = Math.fround;

export const DEFAULT_METHOD = "manga_line";
const ROW_SHIFTS = [[0, -1, "上に 1px"], [0, 1, "下に 1px"], [0, -2, "上に 2px"], [0, 2, "下に 2px"]];
const ROW_SCALES = [[0.995, "0.5% 縮める"], [1.005, "0.5% 広げる"], [0.99, "1% 縮める"],
  [1.01, "1% 広げる"], [0.98, "2% 縮める"], [1.02, "2% 広げる"]];
const SCALE_MARGIN = 2;
const ROW_OTHERS = 2;
const OTHER_PENALTY = 2.0;
const round3 = (v) => { const s = v * 1000; return (Math.abs(s % 1) === 0.5 ? 2 * Math.round(s / 2) : Math.round(s)) / 1000; };
const ROW_MODES = [
  ["標準（線だけ）", (st) => ({ ...st, mode: "v2", color: null, fill: null })],
  ["色の境界", (st) => ({ ...st, mode: "v2", color: "all", fill: null })],
  ["色の境界 + 黒い面", (st) => ({ ...st, mode: "v2", color: "all", fill: "face" })],
  ["控えめ", (st) => ({ ...st, mode: "v2", lam: round3((st.lam ?? 2.0) * 0.75) })],
  ["多め", (st) => ({ ...st, mode: "v2", lam: round3((st.lam ?? 2.0) * 1.33) })],
  ["高密度", (st) => ({ ...st, mode: "v1", width: 3 })],
];

export class Session {
  // image: {rgb, w, h}。runner: モデルを動かすもの（models.js）。scale: AA の大きさの倍率。
  // base: 倍率 1 のときの AA の大きさ [幅, 高さ]（省くと長辺 800px まで）。
  // pool: 当てはめの行を分けて求める Worker の組（pool.js。省くとこのスレッドで求める）。init() を待ってから使う
  constructor(image, runner, { method = DEFAULT_METHOD, scale = 1.0, base = null, pool = null } = {}) {
    this.image = image;
    this.runner = runner;
    this.pool = pool;
    this.method = method;
    this.scale = scale;
    const [bw, bh] = base || lineart.canvasSize(image.w, image.h);
    this.size = scale === 1.0 ? [bw, bh] : [Math.max(1, rint(bw * scale)), Math.max(1, rint(bh * scale))];
    this.w = this.size[0];
    this.h = this.size[1];
    this._strength = new Map();
    this._masks = new Map();
    this._faces = null;
    this._faceWeights = new Map();
    this._edges = null;
    this._dark = new Map();
    this.timing = {};       // 段階ごとにかかった時間（ms。調べる用）
  }

  // fn にかかった時間を timing[name] に足す
  async _time(name, fn) {
    const t = performance.now();
    try {
      return await fn();
    } finally {
      this.timing[name] = (this.timing[name] || 0) + performance.now() - t;
    }
  }

  async init() {
    if (!this._strength.has(null)) {
      this._strength.set(null, await this._time("lineart", () => lineart.strength(this.image, this.method, this.size, this.runner)));
    }
    return this;
  }

  get rows() { return Math.floor(this.h / ROW_H); }

  async faces() {
    if (!this._faces) {
      const parts = await this._time("face_model", () => regions.faceParts(this.image, this.size, this.runner));
      this._faces = await this._time("faces", () => regions.findFaces(parts, this.w, this.h));
    }
    return this._faces;
  }

  async faceWeight(gain) {
    if (!this._faceWeights.has(gain)) {
      this._faceWeights.set(gain, regions.faceWeight(await this.faces(), this.w, this.h, gain));
    }
    return this._faceWeights.get(gain);
  }

  // 線の強さ。color に "face" か "all" を渡すと色の境界を足したもの
  async strength(color = null) {
    if (!this._strength.has(color)) {
      let region = null;
      if (color === "face") region = Float32Array.from(await this.faceWeight(2.0), (v) => f32(v - 1.0));
      else if (color !== "all") throw new Error(`unknown region: ${color}`);
      if (!this._edges) this._edges = await this._time("teed", () => lineart.strength(this.image, lineart.COLOR_METHOD, this.size, this.runner));
      this._strength.set(color, lineart.mergeColorEdges(this._strength.get(null), this._edges, this.w, this.h, region));
    }
    return this._strength.get(color);
  }

  // 線画の直しを [描いた線, 消した所] にする
  edits(edit) {
    if (!edit || Array.isArray(edit)) return edit || null;
    return lineart.editMasks(edit.data, edit.w, edit.h, this.size);
  }

  // 2値の線（1 が線）。edit を渡すと 1px の線に当ててから width の太さにする
  async lineMask(color = null, width = 1, edit = null) {
    edit = this.edits(edit);
    if (edit) return lineart.applyEdit(await this.lineMask(color, 1), edit[0], edit[1], this.w, this.h, width);
    const key = `${color}|${width}`;
    if (!this._masks.has(key)) {
      const st = await this.strength(color);
      this._masks.set(key, await this._time("binarize", () => lineart.binarize(st, this.w, this.h, { width })));
    }
    return this._masks.get(key);
  }

  async dark(where) {
    if (!this._dark.has(where)) {
      const faces = where === "face" ? await this.faces() : null;
      this._dark.set(where, regions.darkAreas(this.image, this.size, where, faces));
    }
    return this._dark.get(where);
  }

  // 場所ごとの描き込みの量（v2 の weight）。何も無ければ null
  async weight(faceGain = 1.0, paint = null) {
    let w = faceGain !== 1.0 ? await this.faceWeight(faceGain) : null;
    if (paint) {
      // 同じ塗り（同じ配列）なら覚えた地図を使う（行の候補は 1 行で 20 回ほど求めるため）
      if (this._paint?.data !== paint.data) {
        this._paint = { data: paint.data, weight: regions.paintWeight(paint.data, paint.w, paint.h, this.size) };
      }
      const p = this._paint.weight;
      if (w) {
        const out = new Float32Array(w.length);
        for (let i = 0; i < w.length; i++) out[i] = w[i] * p[i];
        w = out;
      } else {
        w = p;
      }
    }
    return w;
  }

  // 設定に合わせて AA を作り、行のリストを返す
  async render(st, glyphs) {
    const { lam = 2.0, color = null, fill = null, fill_gain = 0.5, face_gain = 2.0, paint = null, mode = "v2",
      width = 2, phantom = 1.5, shift = 4, slide = 0.4, edit = null } = st;
    if (mode !== "v2") {
      const r = v1Costs(await this.lineMask(color, width, edit), this.h, this.w, glyphs);
      return finish(matchCost(r.c, r.term, r.rows, r.nx, glyphs).lines, glyphs);
    }
    const weight = await this.weight(face_gain, paint);
    const mask = await this.lineMask(color, 1, edit);
    const dark = fill ? await this._time("dark", () => this.dark(fill)) : null;
    const ctx = await this._time("prepare", () => prepare(mask, this.h, this.w, {
      lam, phantom, weight, shift, slide, fill: dark, fillGain: fill_gain,
    }));
    return this._time("match", async () => {
      if (this.pool) return finish((await this.pool.match(ctx, glyphs)).lines, glyphs);
      const r = rowCosts(ctx, glyphs);
      return finish(matchCost(r.c, r.term, r.rows, r.nx, glyphs).lines, glyphs);
    });
  }

  // ---------- 行ごとの候補（画面の「行を直す」） ----------

  // 配列 a（AA の大きさ）から、row 行目とその上下1行ずつ（3行）を切り出す。中身を右に dx、下に dy ずらす
  _window(a, row, dx, dy, fillValue) {
    const used = this.rows * ROW_H, w = this.w, h = 3 * ROW_H;
    const out = new a.constructor(h * w).fill(fillValue);
    const y0 = (row - 1) * ROW_H - dy;
    const ys = Math.max(0, -y0), ye = Math.min(h, used - y0);
    const xs = Math.max(0, dx), xe = Math.min(w, w + dx);
    if (ys < ye && xs < xe) {
      for (let y = ys; y < ye; y++) out.set(a.subarray((y0 + y) * w + xs - dx, (y0 + y) * w + xe - dx), y * w + xs);
    }
    return out;
  }

  // row 行目の線の横の重心。線が無ければ null
  async _center(row, color, width, edit = null) {
    const m = await this.lineMask(color, width, edit);
    let s = 0, n = 0;
    for (let y = row * ROW_H; y < (row + 1) * ROW_H; y++) {
      for (let x = 0; x < this.w; x++) if (m[y * this.w + x]) { s += x; n++; }
    }
    return n ? s / n : null;
  }

  // 線の強さを x = cx を中心に横へ sx 倍してから2値にした線画（row の上下 1 + SCALE_MARGIN 行だけ）
  async _scaledMask(row, sx, cx, color, width, edit = null) {
    const used = this.rows * ROW_H, w = this.w;
    const y0 = Math.max(0, (row - 1 - SCALE_MARGIN) * ROW_H);
    const y1 = Math.min(used, (row + 2 + SCALE_MARGIN) * ROW_H);
    const out = new Uint8Array(this.w * this.h);
    if (y0 < y1) {
      const bh = y1 - y0;
      const band = hscale((await this.strength(color)).subarray(y0 * w, y1 * w), w, bh, sx, cx, 0.0, "linear");
      let m;
      if (!edit) {
        m = lineart.binarize(band, w, bh, { width });
      } else {
        const [add, erase] = edit.map((a) => hscale(a.subarray(y0 * w, y1 * w), w, bh, sx, cx, 0, "nearest"));
        m = lineart.applyEdit(lineart.binarize(band, w, bh, { width: 1 }), add, erase, w, bh, width);
      }
      out.set(m, y0 * w);
    }
    return out;
  }

  // row 行目だけのコスト（render と同じ設定）。dx, dy で線画などをずらし、sx で横へ伸び縮みする
  async _rowCost(row, st, glyphs, { dx = 0, dy = 0, sx = 1.0 } = {}) {
    const { lam = 2.0, color = null, fill = null, fill_gain = 0.5, face_gain = 2.0, paint = null, mode = "v2",
      width = 2, phantom = 1.5, shift = 4, slide = 0.4 } = st;
    const edit = this.edits(st.edit);
    const lw = mode !== "v2" ? width : 1;
    const cx = sx !== 1.0 ? await this._center(row, color, lw, edit) : null;
    const scaled = cx !== null;
    const lines = async () => (scaled ? this._scaledMask(row, sx, cx, color, lw, edit) : this.lineMask(color, lw, edit));
    const stretch = (a, fillValue, interp) => (scaled ? hscale(a, this.w, this.h, sx, cx, fillValue, interp) : a);
    const H = 3 * ROW_H;
    if (mode !== "v2") {
      const m = this._window(await lines(), row, dx, dy, 0);
      const r = v1Costs(m, H, this.w, glyphs, [1]);
      return r;
    }
    const weight = await this.weight(face_gain, paint);
    const m = this._window(await lines(), row, dx, dy, 0);
    const w = weight ? this._window(stretch(weight, 1.0, "linear"), row, dx, dy, 1.0) : null;
    const f = fill ? this._window(stretch(await this.dark(fill), 0, "nearest"), row, dx, dy, 0) : null;
    return costs(m, H, this.w, glyphs, { lam, phantom, weight: w, shift, slide, fill: f, fillGain: fill_gain, only: [1] });
  }

  async rowLine(row, st, glyphs, move = {}) {
    const r = await this._rowCost(row, st, glyphs, move);
    return finish(matchCost(r.c, r.term, 1, r.nx, glyphs).lines, glyphs)[0];
  }

  // row 行目の別の候補 [{kind, label, line}]。current（いま表示している行）と見た目が同じものと、
  // 候補どうしで見た目が同じものは除く
  async rowOptions(row, settings, glyphs, current = null) {
    const st = { ...settings, edit: this.edits(settings.edit) };
    const seen = new Set();
    if (current !== null) seen.add(look(current, glyphs));
    const out = [];
    const add = (kind, label, line) => {
      const key = look(line, glyphs);
      if (!seen.has(key)) { seen.add(key); out.push({ kind, label, line }); }
    };
    // 同じ設定のまま、別の並び
    const r = await this._rowCost(row, st, glyphs);
    let m = matchCost(r.c, r.term, 1, r.nx, glyphs);
    let raw = m.lines[0], picked = m.picked[0];
    const base = finish([raw], glyphs)[0];
    if (current === null || look(base, glyphs) !== look(current, glyphs)) add("other", "いまの設定のいちばん", base);
    else seen.add(look(base, glyphs));
    const c = r.c.slice(), N = glyphs.size;
    for (let k = 0; k < ROW_OTHERS; k++) {
      let x = 0;
      for (const g of picked) {
        if (glyphs.inked[g]) c[x * N + g] = c[x * N + g] + OTHER_PENALTY;
        x += glyphs.widths[g];
      }
      m = matchCost(c, r.term, 1, r.nx, glyphs);
      raw = m.lines[0];
      picked = m.picked[0];
      add("other", `${k + 2}番目`, finish([raw], glyphs)[0]);
    }
    for (const [dx, dy, label] of ROW_SHIFTS) add("shift", label, await this.rowLine(row, st, glyphs, { dx, dy }));
    const lw = (st.mode ?? "v2") !== "v2" ? (st.width ?? 2) : 1;
    if ((await this._center(row, st.color ?? null, lw, st.edit)) !== null) {
      for (const [sx, label] of ROW_SCALES) add("scale", label, await this.rowLine(row, st, glyphs, { sx }));
    }
    for (const [label, change] of ROW_MODES) add("mode", label, await this.rowLine(row, change({ ...st }), glyphs));
    return out;
  }

  // 当てはめに使う 1px の線（RGBA。黒い線・透明な地）
  async lineartRGBA(color = null, edit = null) {
    const m = await this.lineMask(color, 1, edit);
    const out = new Uint8ClampedArray(this.w * this.h * 4);
    for (let p = 0; p < m.length; p++) if (m[p]) out[4 * p + 3] = 255;
    return out;
  }
}

// 配列 a（w × h）を x = cx を中心に横へ sx 倍する（大きさは変えない。外は fillValue）。cv2.remap と同じく
// 座標を 1/32 px に丸めて線形補間する（interp が "nearest" なら最も近い画素）
export function hscale(a, w, h, sx, cx, fillValue, interp) {
  const out = new a.constructor(a.length);
  const cx32 = f32(cx), sx32 = f32(sx);
  for (let x = 0; x < w; x++) {
    const mx = f32(cx32 + f32(f32(x - cx32) / sx32));
    if (interp === "nearest") {
      const X = rint(mx);
      for (let y = 0; y < h; y++) out[y * w + x] = X >= 0 && X < w ? a[y * w + X] : fillValue;
    } else {
      const X = rint(f32(mx * 32));
      const x0 = X >> 5, t = (X & 31) / 32;
      const w0 = f32(1 - t), w1 = f32(t);
      for (let y = 0; y < h; y++) {
        const s0 = x0 >= 0 && x0 < w ? a[y * w + x0] : fillValue;
        const s1 = x0 + 1 >= 0 && x0 + 1 < w ? a[y * w + x0 + 1] : fillValue;
        out[y * w + x] = f32(f32(s0 * w0) + f32(s1 * w1));
      }
    }
  }
  return out;
}

// 行の見た目（インクのある文字の位置と形）。空白の並べ方だけが違う行や、形が同じ別の文字は同じになる
const _shapes = new WeakMap();

function shapeKeys(glyphs) {
  let keys = _shapes.get(glyphs);
  if (!keys) {
    keys = glyphs.chars.map((_, i) => glyphs.bitmap(i).join(""));
    _shapes.set(glyphs, keys);
  }
  return keys;
}

export function look(line, glyphs) {
  const keys = shapeKeys(glyphs);
  const out = [];
  let x = 0;
  for (const ch of line) {
    const i = glyphs.index(ch);
    if (i < 0) {
      out.push(`${x}:${ch}`);
      x += 16;
      continue;
    }
    if (glyphs.inked[i]) out.push(`${x}#${keys[i]}`);
    x += glyphs.widths[i];
  }
  return out.join(",");
}
