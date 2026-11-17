// ブラウザの中のエンジン（Web Worker）。webapp/server.py の API と同じ仕事をする（段階3）。
// 画面側は engine_local.js。メッセージは {id, method, args} → {id, ok, result | error}、
// 途中経過（モデルの読み込みなど）は {progress: {...}}。
//
// 扱う大きさ: 画像は長辺 MAX_IMAGE px まで（大きい画像は入れたときに縮める）、AA は長辺 MAX_SIDE px まで。

import { parseDict } from "./glyphs.js";
import { grayPIL, resizePIL, rint } from "./img.js";
import * as lineart from "./lineart.js";
import * as prep from "./prep.js";
import { Session } from "./session.js";
import { foreground } from "./models.js";
import { createRunner, FILES, hasWebGPU, MODEL_BASE } from "./ort_runner.js";
import { Pool } from "./pool.js";

const MAX_IMAGES = 6;         // 覚えておく画像の数（前処理した画像も数える）
const MAX_SCALES = 6;         // 1 枚の画像につき覚えておく大きさの数
const MAX_IMAGE = 2048;       // 扱う画像の長辺
const MAX_SIDE = 1024;        // AA の長辺（持ち主の決定。デスクトップ版は 2048）
const MAX_GLYPH_SETS = 4;
const DICT_URL = new URL("../dict/chrDict_20261117_utf8.txt", import.meta.url);

// 画面に出す候補（aame/candidates.py の PRESETS と webapp/server.py の WEB_PRESETS）。描き込みの少ない順
const PRESETS = [
  { name: "sparse", title: "控えめ", note: "標準より控えめ（線だけ、文字少なめ）", settings: { lam: 1.5, color: null, fill: null, face_gain: 2.0 } },
  { name: "standard", title: "標準", note: "標準: 線だけ", settings: { lam: 2.0, color: null, fill: null, face_gain: 2.0 } },
  { name: "color_all", title: "色の境界", note: "全体に色の境界を足す（髪のハイライト、影）", settings: { lam: 2.0, color: "all", fill: null, face_gain: 2.0 } },
  { name: "color_all_fill", title: "色の境界 + 黒い面", note: "全体の色の境界 + 黒い面を埋める", settings: { lam: 2.0, color: "all", fill: "face", face_gain: 2.0 } },
];

const progress = (p) => postMessage({ progress: p });

let fullGlyphs = null;
async function glyphSet() {
  if (!fullGlyphs) {
    const res = await fetch(DICT_URL);
    if (!res.ok) throw new Error("文字の辞書を読めませんでした");
    fullGlyphs = parseDict(await res.text());
  }
  return fullGlyphs;
}

// 使う辞書: 標準の辞書に、足した文字（extra。辞書の形式の文字列）を足し、使わない文字（exclude）を外したもの。
// 同じ組なら同じ GlyphSet を返す（当てはめの Worker が辞書ごとに覚えるため）。
const glyphSets = new Map();
const MAX_EXTRA = 500;        // 足せる文字の数
function remembered(key, make) {
  let g = glyphSets.get(key);
  if (!g) {
    g = make();
    glyphSets.set(key, g);
    while (glyphSets.size > MAX_GLYPH_SETS) glyphSets.delete(glyphSets.keys().next().value);
  }
  glyphSets.delete(key);
  glyphSets.set(key, g);
  return g;
}

async function glyphsFor(exclude, extra) {
  let full = await glyphSet();
  if (extra) {
    full = remembered(`+${extra}`, () => {
      let added;
      try {
        added = parseDict(extra);
      } catch (e) {
        throw new Error("足した文字の辞書が読めませんでした");
      }
      if (added.size > MAX_EXTRA) throw new Error(`足せる文字は ${MAX_EXTRA} 文字までです`);
      return fullGlyphs.plus(added);
    });
  }
  const drop = Array.from(new Set(Array.from(exclude || ""))).filter((ch) => full.has(ch)).sort().join("");
  if (!drop) return full;
  return remembered(`-${drop}+${extra || ""}`, () => full.without(drop));
}

// 画面から渡される設定（engine_local.js）。cpu: GPU があっても CPU で動かす（試験用）
const config = { cpu: false };

// GPU（WebGPU）と CPU のどちらで動かすか、と CPU のスレッドの数（画面の上の帯に出す）
async function deviceInfo() {
  const gpu = !config.cpu && (await hasWebGPU());
  const threads = gpu ? 0 : globalThis.crossOriginIsolated ? Math.min(8, navigator.hardwareConcurrency || 4) : 1;
  return { kind: "device", device: gpu ? "webgpu" : "wasm", threads };
}

let runnerPromise = null;
function runner() {
  if (!runnerPromise) {
    runnerPromise = createRunner(progress, { forceCPU: config.cpu }).then((r) => {
      progress({ kind: "device", device: r.device, threads: r.threads });
      return r;
    });
    runnerPromise.catch(() => { runnerPromise = null; });
  }
  return runnerPromise;
}

// 当てはめの行を分けて求める Worker の組（作れなければこのスレッドで求める）
let thePool;
function pool() {
  if (thePool === undefined) {
    try {
      thePool = typeof Worker === "undefined" ? null : new Pool(Pool.size());
    } catch (e) {
      thePool = null;
    }
  }
  return thePool;
}

// モデルがブラウザに残っているか（初めての読み込みの案内を出すかどうか）
async function modelsCached(name = "manga_line") {
  try {
    return !!(await (await caches.open("aame-models-v1")).match(MODEL_BASE + FILES[name][0]));
  } catch (e) {
    return false;
  }
}

// ---------- 画像 ----------

class Entry {
  // image: {rgb, w, h}。base は倍率 1 の AA の大きさ。parent は前処理した画像のときの元の画像の id
  constructor(image, base = null, parent = null) {
    this.image = image;
    this.base = base || lineart.canvasSize(image.w, image.h);
    this.parent = parent;
    this.children = [];
    this.measured = new Map();
    this.alphas = new Map();    // 切り抜き → 前景の濃さ（背景を消すとき用）
    this.sessions = new Map();
  }

  size(scale = 1.0) {
    const [w, h] = this.base;
    return scale === 1.0 ? [w, h] : [Math.max(1, rint(w * scale)), Math.max(1, rint(h * scale))];
  }

  async session(scale) {
    const key = Math.round(scale * 1e4) / 1e4;
    let s = this.sessions.get(key);
    if (!s) {
      const r = await runner();
      s = new Session(this.image, r, { scale: key, base: this.base, pool: pool() }).init();
      this.sessions.set(key, s);
      s.catch(() => this.sessions.delete(key));
      while (this.sessions.size > MAX_SCALES) this.sessions.delete(this.sessions.keys().next().value);
    }
    this.sessions.delete(key);
    this.sessions.set(key, s);
    return s;
  }
}

const images = new Map();

function remember(e) {
  const id = crypto.randomUUID().replace(/-/g, "");
  images.set(id, e);
  while (images.size > MAX_IMAGES) images.delete(images.keys().next().value);
  return id;
}

function entry(id) {
  const e = images.get(id);
  if (!e) throw new Error("画像が見つかりません（もう一度画像を入れてください）");
  images.delete(id);
  images.set(id, e);
  return e;
}

function sized(e, scale) {
  if (!(scale >= 0.5 && scale <= 1.6)) throw new Error("大きさの倍率が範囲の外です");
  if (Math.max(...e.size(Math.round(scale * 1e4) / 1e4)) > MAX_SIDE) throw new Error(`AA の長辺は ${MAX_SIDE}px までです`);
  return e;
}

const entrySize = (e) => ({ scale: 1.0, width: e.base[0], height: e.base[1], rows: Math.floor(e.base[1] / 18) });
const sizeOf = (s) => ({ scale: s.scale, width: s.w, height: s.h, rows: s.rows });

function analysis(image, size) {
  const info = prep.measure(image, size);
  info.recommended = prep.recommended(info);
  return info;
}

// Pillow の thumbnail と同じ大きさ（縦横比を保って max × max に収める）
function thumbSize(w, h, max) {
  const aspect = w / h;
  if (max / max >= aspect) {
    const cands = [Math.floor(max * aspect), Math.ceil(max * aspect)];
    const x = Math.max(cands.reduce((a, b) => (Math.abs(aspect - b / max) < Math.abs(aspect - a / max) ? b : a)), 1);
    return [x, max];
  }
  const cands = [Math.floor(max / aspect), Math.ceil(max / aspect)];
  const y = Math.max(cands.reduce((a, b) => (Math.abs(aspect - max / b) < Math.abs(aspect - max / a) ? b : a)), 1);
  return [max, y];
}

// ファイル（Blob）を {rgb, w, h} にする。写真の向きを直し、透明な所は白にする
async function decode(blob) {
  let bmp;
  try {
    bmp = await createImageBitmap(blob, { imageOrientation: "from-image", colorSpaceConversion: "none", premultiplyAlpha: "none" });
  } catch (e) {
    throw new Error("画像として読めませんでした");
  }
  const w = bmp.width, h = bmp.height;
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const d = ctx.getImageData(0, 0, w, h).data;
  const rgb = new Uint8Array(w * h * 3);
  for (let p = 0; p < w * h; p++) {
    rgb[3 * p] = d[4 * p];
    rgb[3 * p + 1] = d[4 * p + 1];
    rgb[3 * p + 2] = d[4 * p + 2];
  }
  return { rgb, w, h };
}

// data URL（PNG）を RGBA にする。同じ URL は覚えておく
const decoded = new Map();
async function decodeURL(url) {
  if (!url) return null;
  let r = decoded.get(url);
  if (!r) {
    const bmp = await createImageBitmap(await (await fetch(url)).blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    r = { data: ctx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height };
    bmp.close();
    decoded.set(url, r);
    while (decoded.size > 4) decoded.delete(decoded.keys().next().value);
  }
  return r;
}

const SETTING_RANGES = { lam: [0.5, 6.0], fill_gain: [0.0, 3.0], face_gain: [1.0, 8.0], width: [1, 4] };

// 画面の設定を Session.render の設定にする（塗りと線画の直しの data URL は画素にする）
async function options(settings, paintURL, editURL) {
  const st = {};
  for (const k of ["lam", "color", "fill", "fill_gain", "face_gain", "mode", "width"]) if (settings[k] !== undefined) st[k] = settings[k];
  for (const [k, [lo, hi]] of Object.entries(SETTING_RANGES)) {
    if (st[k] !== undefined && !(st[k] >= lo && st[k] <= hi)) throw new Error(`設定 ${k} が範囲の外です`);
  }
  const paint = await decodeURL(paintURL);
  if (paint) {
    // Pillow の convert("L") と同じ式（灰色の塗りなら R の値そのもの）
    const n = paint.w * paint.h, rgb = new Uint8Array(n * 3);
    for (let p = 0; p < n; p++) for (let c = 0; c < 3; c++) rgb[3 * p + c] = paint.data[4 * p + c];
    st.paint = { data: grayPIL(rgb, n), w: paint.w, h: paint.h };
  }
  const edit = await decodeURL(editURL);
  if (edit) st.edit = edit;
  return st;
}

async function pngBlob(rgba, w, h) {
  const c = new OffscreenCanvas(w, h);
  c.getContext("2d").putImageData(new ImageData(rgba, w, h), 0, 0);
  return c.convertToBlob({ type: "image/png" });
}

function rgbToRGBA(rgb, n) {
  const out = new Uint8ClampedArray(n * 4);
  for (let p = 0; p < n; p++) {
    out[4 * p] = rgb[3 * p];
    out[4 * p + 1] = rgb[3 * p + 1];
    out[4 * p + 2] = rgb[3 * p + 2];
    out[4 * p + 3] = 255;
  }
  return out;
}

// ---------- API（webapp/server.py と同じ形の答え） ----------

const api = {
  presets: async () => PRESETS,

  async open(file) {
    const t = performance.now();
    let image = await decode(file);
    let shrunk = null;
    if (Math.max(image.w, image.h) > MAX_IMAGE) {
      shrunk = [image.w, image.h];
      const [nw, nh] = thumbSize(image.w, image.h, MAX_IMAGE);
      image = { rgb: resizePIL(image.rgb, image.w, image.h, 3, nw, nh, "lanczos"), w: nw, h: nh };
    }
    const e = new Entry(image);
    if (!runnerPromise) {
      progress(await deviceInfo());
      progress({ kind: "cached", cached: await modelsCached(), bg: await modelsCached("bg") });
    }
    pool();
    const found = analysis(e.image, e.base);
    const id = remember(e);
    return { id, ...entrySize(e), image_width: image.w, image_height: image.h, shrunk, max_side: MAX_SIDE,
      max_image: MAX_IMAGE, analysis: found, presets: PRESETS, ms: Math.round(performance.now() - t) };
  },

  async prepare(id, req) {
    const e = entry(id);
    if (e.parent) throw new Error("前処理した画像には、もう一度前処理できません");
    const t = performance.now();
    let box = null;
    if (req.crop) {
      box = req.crop.map((v) => Math.min(1, Math.max(0, v)));
      if (Math.abs(box[2] - box[0]) < 0.02 || Math.abs(box[3] - box[1]) < 0.02) throw new Error("切り抜く範囲が小さすぎます");
    }
    if (req.long && !(req.long >= 200 && req.long <= MAX_SIDE)) throw new Error(`AA の長辺は 200〜${MAX_SIDE}px です`);
    let image = prep.crop(e.image, box);
    if (req.bg) {
      const k = JSON.stringify(box);
      let alpha = e.alphas.get(k);
      if (!alpha) {
        alpha = await foreground(await runner(), image.rgb, image.w, image.h);
        e.alphas.set(k, alpha);
        while (e.alphas.size > 4) e.alphas.delete(e.alphas.keys().next().value);
      }
      image = prep.whiten(image, alpha);
    }
    const size = req.long ? prep.targetSize(image.w, image.h, req.long) : lineart.canvasSize(image.w, image.h);
    const key = JSON.stringify([box, size, !!req.bg]);
    let before = e.measured.get(key);
    if (!before) {
      before = analysis(image, size);
      e.measured.set(key, before);
      while (e.measured.size > 16) e.measured.delete(e.measured.keys().next().value);
    }
    let after = null;
    const delta = req.delta || 0;
    if (delta) {
      image = prep.adjust(image, size, delta);
      after = analysis(image, size);
    }
    const child = new Entry(image, size, id);
    const childId = remember(child);
    for (const old of e.children) if (old !== req.keep) images.delete(old);
    e.children = e.children.filter((i) => i === req.keep && images.has(i)).concat([childId]);
    return { id: childId, ...entrySize(child), before, after, presets: PRESETS, ms: Math.round(performance.now() - t) };
  },

  async render(id, settings, paint, scale, edit) {
    const e = sized(entry(id), scale);
    const st = await options(settings, paint, edit);
    const glyphs = await glyphsFor(settings.exclude, settings.extra);
    const t = performance.now();
    const s = await e.session(scale);
    const lines = await s.render(st, glyphs);
    const timing = Object.fromEntries(Object.entries(s.timing).map(([k, v]) => [k, Math.round(v)]));
    s.timing = {};
    return { lines, ...sizeOf(s), ms: Math.round(performance.now() - t), timing };
  },

  async rowOptions(id, row, settings, paint, scale, current, edit) {
    const e = sized(entry(id), scale);
    const st = await options(settings, paint, edit);
    const glyphs = await glyphsFor(settings.exclude, settings.extra);
    const t = performance.now();
    const s = await e.session(scale);
    if (!(row >= 0 && row < s.rows)) throw new Error("行の番号が範囲の外です");
    const found = await s.rowOptions(row, st, glyphs, current ?? null);
    return { row, options: found, ms: Math.round(performance.now() - t) };
  },

  async lineart(id, color, scale) {
    const e = sized(entry(id), scale);
    const s = await e.session(scale);
    return pngBlob(await s.lineartRGBA(color || null), s.w, s.h);
  },

  async original(id) {
    const { rgb, w, h } = entry(id).image;
    return pngBlob(rgbToRGBA(rgb, w * h), w, h);
  },

  async source(id, scale) {
    const e = sized(entry(id), scale);
    const [w, h] = e.size(Math.round(scale * 1e4) / 1e4);
    const { image } = e;
    const rgb = w === image.w && h === image.h ? image.rgb : resizePIL(image.rgb, image.w, image.h, 3, w, h, "lanczos");
    return pngBlob(rgbToRGBA(rgb, w * h), w, h);
  },
};

// エンジンの仕事は 1 つずつ順に行う（モデルの実行は並べられない。当てはめも CPU を使い切る）
let chain = Promise.resolve();

onmessage = (ev) => {
  if (ev.data.config) {
    Object.assign(config, ev.data.config);
    return;
  }
  const { id, method, args } = ev.data;
  const job = chain.then(async () => {
    try {
      if (!api[method]) throw new Error(`unknown method: ${method}`);
      postMessage({ id, ok: true, result: await api[method](...args) });
    } catch (e) {
      postMessage({ id, ok: false, error: e?.message || String(e) });
    }
  });
  chain = job;
};
