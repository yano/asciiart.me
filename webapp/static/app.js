// 画面の動き。エンジンは engine.js だけを通して使う。
// 流れ: 画像を入れる → 0. 前処理（切り抜き、大きさ、線の太さ。飛ばせる）→ 1. 候補を選ぶ →
//       2. 大きさを選ぶ → 3. 仕上げ（調整、塗る、行を直す、線画を直す、書き出す）
// 使う文字（辞書から外す文字）は上の帯から選ぶ。候補・大きさ・仕上げのすべてに効く。

import * as engine from "./engine.js";
import { GlyphTable, Renderer, ROW_H, toText, toHtml } from "./aa.js";
import { Compare } from "./compare.js";

const $ = (id) => document.getElementById(id);

// 調整の初期値（候補の設定はこの上に重ねる）
const DEFAULTS = {
  lam: 2.0, color: null, fill: null, fill_gain: 0.5, face_gain: 2.0, mode: "v2", width: 3,
};
const SETTING_KEYS = Object.keys(DEFAULTS);
const RANGES = ["lam", "face_gain", "fill_gain"];
const MORE_COLOR = "#ff7a00";
const LESS_COLOR = "#2a6cff";
const LINEART_COLOR = "#d32f2f";
const UNDO_LIMIT = 30;
const PAINT_MAX = 4;        // 同じ所を塗り重ねられる回数（aame.regions.PAINT_MAX）
const PAINT_CODE = 30;      // サーバーに送る灰色の値 = 128 + 段階 × PAINT_CODE（aame.regions.PAINT_CODE）
const BRUSH_ROWS = 0.85;    // ブラシの直径（AA の 1 行の高さに対する割合）
const ERASER_ROWS = 0.5;    // 線を消すブラシの直径（同じく）
const ADD_COLOR = "#0a9a48";      // 描いた線
const ERASED_COLOR = "#9a9a9a";   // 消した線
const LINE_ADD = 1;         // 線画の直しの値（画素ごと）: 描いた線
const LINE_ERASE = 2;       //                             消した所
const EXCLUDE_KEY = "aame.exclude";   // 使わない文字を覚えておく（このブラウザだけ）
// 使う文字の種類（辞書の文字を Unicode の範囲で分ける。categoryOf）
const CATEGORIES = [
  ["symbol", "記号"], ["hankana", "半角カナ"], ["katakana", "カタカナ"], ["hiragana", "ひらがな"],
  ["alnum", "英数字"], ["kanji", "漢字"], ["greek", "ギリシャ・ロシア文字"],
];
const EMBED_FONT = "saitamaar";   // 表示フォントが MS Pゴシックのとき、.html に埋め込むフォント
const SCALES = [0.9, 0.95, 1, 1.05, 1.1];   // 2. で作る大きさの倍率
const SCALE_STEP = 0.05;
const SCALE_MIN = 0.5;
const SCALE_MAX = 1.6;
const KIND_TITLE = { other: "別の並び", scale: "横に伸び縮み（行の線の重心を中心に）", shift: "上下にずらす", mode: "設定を変える" };
const DEFAULT_FONT = "saitamaar";   // 表示フォントの既定（読めなければ MS Pゴシック）
const FONT_KEY = "aame.font";        // 選んだ表示フォントを覚えておく（このブラウザだけ）
const SKIP_KEY = "aame.skipPrep";    // 「次から前処理を飛ばす」
const PREP_WAIT = 350;               // 前処理の設定を変えてから作り直すまで（ms）

const S = {
  table: null,
  renderer: null,
  fonts: [],
  fontId: "mspgothic", // いま描いているフォント（DEFAULT_FONT は起動してから読む）
  presets: [],
  gen: 0,             // 画像を入れ直すたびに増やす（古い結果を捨てるため）
  orig: null,         // 送った画像 {id, name, file, width, height（画像の px）, size（前処理しないときの AA の大きさ）, analysis, img}
  prep: null,         // 前処理の設定と結果（freshPrep）
  image: null,        // AA にしている画像（前処理したもの）{id, name, width, height, rows, file, img}
  results: new Map(), // 候補と大きさごとの結果 → {lines, ms, scale, width, height, rows, canvas}
  base: -1,           // 選んだ候補（presets の番号）
  scales: [...SCALES],
  scale: 1,           // 仕上げている大きさ
  editKey: null,      // 仕上げを始めた候補と大きさ
  dims: null,         // 仕上げている AA の大きさ {width, height, rows}
  view: "welcome",
  settings: { ...DEFAULTS },
  lines: null,        // エンジンの結果
  fixed: new Map(),   // 手で直した行（行の番号 → 文字列）
  prev: null,         // 作り直す前の表示（見比べる用）
  ms: 0,
  under: "source",
  zoom: "1",
  tool: "none",
  underCache: new Map(),
  maxSide: 2048,      // 扱える長辺（px。サーバーが返す）
  level: null,        // 塗り重ねた段階（Float32Array。倍率 1 の AA の大きさ。増やすは +、減らすは −）
  hasPaint: false,
  paintURL: null,     // サーバーに送る塗りの画像（level が変わったら作り直す）
  stroke: null,       // 塗っている途中 {sign, box, last}
  undo: [],           // 1つ戻す / やり直す: {kind: "paint" | "fixed" | "all", before, after}
  redo: [],
  rowSel: null,       // 行を直しているとき {row, x, current, options, pick, hover}
  textSnap: null,
  lineStrokes: [],    // 線画の直し（倍率 1 の AA の座標）{tool: "erase" | "draw", pts: [[x, y], ...], r（消す半径）}
  lineVer: 0,         // lineStrokes を変えるたびに増やす
  lineRaster: null,   // いまの AA の大きさにした線画の直し {key, w, h, state}
  lineURL: null,      // サーバーに送る線画の直しの画像 {key, url}
  lineBase: new Map(),// 当てはめに使う線（直す前。"色の境界:倍率" → {w, h, mask}）
  exclude: "",        // 使わない文字（辞書の順）
  dictGen: 0,         // 使わない文字を変えるたびに増やす（古い候補を捨てるため）
};

const rkey = (i, scale) => `${i}@${scale.toFixed(2)}`;
const secs = (ms) => `${(ms / 1000).toFixed(1)} 秒`;

// ---------- 状態の表示 ----------

function setStatus(text, error = false) {
  const el = $("status");
  el.textContent = text || "";
  el.classList.toggle("error", error);
}

function showError(e) {
  console.error(e);
  setStatus("エラー: " + (e && e.message ? e.message : e), true);
}

function show(view) {
  S.view = view;
  $("welcome").hidden = view !== "welcome";
  $("prepView").hidden = view !== "prep";
  $("pickView").hidden = view !== "presets" && view !== "scales";
  $("edit").hidden = view !== "edit";
  for (const b of $("steps").querySelectorAll("button")) {
    const step = b.dataset.step;
    b.disabled = step === "prep" ? !S.orig : !S.image || (step === "scales" && S.base < 0) || (step === "edit" && !S.lines);
    b.classList.toggle("current", step === view);
  }
  if (view === "edit") layoutStage();
}

// ---------- 仕事の順番 ----------
// 仕上げの作り直し（edit）がいちばん先、次に行の候補（row）、候補を作る仕事（bg）は順に。
// edit と row は、いつも最新の設定で1回だけ行う。

const jobs = { edit: false, row: false, bg: [], running: false };
const pending = new Set();

function requestEdit() {
  if (!S.image || !S.lines) return;
  jobs.edit = true;
  $("busy").textContent = "作り直しています…";
  $("busy").hidden = false;
  pump();
}

async function pump() {
  if (jobs.running) return;
  let job = null;
  if (jobs.edit) {
    jobs.edit = false;
    job = runEdit;
  } else if (jobs.row) {
    jobs.row = false;
    job = runRow;
  } else {
    job = jobs.bg.shift();
  }
  if (!job) return;
  jobs.running = true;
  try {
    await job();
  } catch (e) {
    showError(e);
  }
  jobs.running = false;
  if (!jobs.edit) $("busy").hidden = true;
  pump();
}

function requestSettings() {
  const out = {};
  for (const k of SETTING_KEYS) out[k] = S.settings[k];
  out.exclude = S.exclude;
  return out;
}

// サーバーに送る塗り（灰色の PNG の data URL。塗っていなければ null）
function currentPaint() {
  if (S.settings.mode !== "v2" || !S.hasPaint) return null;
  if (!S.paintURL) {
    const w = S.image.width, h = S.image.height;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(w, h);
    const d = img.data;
    const L = S.level;
    for (let i = 0; i < L.length; i++) {
      const v = Math.max(0, Math.min(255, Math.round(128 + L[i] * PAINT_CODE)));
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
      d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    S.paintURL = c.toDataURL("image/png");
  }
  return S.paintURL;
}

async function runEdit() {
  const gen = S.gen;
  const scale = S.scale;
  const r = await engine.render(S.image.id, requestSettings(), currentPaint(), scale, currentEdit());
  if (gen !== S.gen || scale !== S.scale) return;
  S.prev = shown();
  S.lines = r.lines;
  S.ms = r.ms;
  cancelRow();
  drawEditor();
  setStatus(`作り直しました（${secs(r.ms)}）`);
}

// 候補 i を大きさ scale で作る仕事を足す（front なら先頭に）
function queueResult(i, scale, front = false) {
  const key = rkey(i, scale);
  if (S.results.has(key) || pending.has(key)) return;
  pending.add(key);
  const gen = S.gen;
  const dg = S.dictGen;
  const job = async () => {
    try {
      if (gen !== S.gen || dg !== S.dictGen) return;
      const r = await engine.render(S.image.id, { ...DEFAULTS, ...S.presets[i].settings, exclude: S.exclude }, null, scale);
      if (gen !== S.gen || dg !== S.dictGen) return;
      S.results.set(key, r);
      onResult(i, scale, r);
    } finally {
      pending.delete(key);
    }
  };
  if (front) jobs.bg.unshift(job);
  else jobs.bg.push(job);
  pump();
}

function resultCanvas(r) {
  if (!r.canvas) r.canvas = S.renderer.draw(r.lines, { minWidth: r.width });
  return r.canvas;
}

function onResult(i, scale, r) {
  if (S.view === "presets" && scale === 1) {
    compare.update(`p${i}`, { canvas: resultCanvas(r), time: secs(r.ms) });
  } else if (S.view === "scales" && i === S.base && S.scales.includes(scale)) {
    compare.update(`s${scale}`, { canvas: resultCanvas(r), time: secs(r.ms), note: sizeNote(r), width: r.width, height: r.height });
  }
  progress();
}

// 初めての線画化の待ち時間の案内（ブラウザの中のエンジンは、モデルを読み込み終えたら出さない）
const loaded = { models: false, device: null };

function firstLoadNote() {
  if (engine.kind === "server") return "（初めはモデルの読み込みで 20 秒ほどかかります）";
  return loaded.models ? "" : "（初めはモデル〈約 93MB〉を読み込みます。2 回目からはブラウザに残したものを使います）";
}

const MODEL_LABEL = { manga_line: "線画化のモデル", teed: "色の境界のモデル", face: "顔のモデル", bg: "背景を消すモデル" };

// 背景を消すモデルの読み込みの案内（ブラウザの中のエンジンで、まだ読んでいないとき）
function bgLoadNote() {
  return engine.kind === "server" || loaded.bg ? "" : "（初めはモデル〈約 88MB〉を読み込みます）";
}

// ブラウザの中のエンジンの途中経過（モデルの読み込み）
function onEngineProgress(p) {
  if (p.kind === "cached") {
    if (p.cached) loaded.models = true;
    if (p.bg) loaded.bg = true;
  } else if (p.kind === "download") {
    const mb = (v) => (v / 1e6).toFixed(0);
    setStatus(`${MODEL_LABEL[p.name] || p.name}を読み込んでいます… ${mb(p.received)} / ${mb(p.total)} MB`);
  } else if (p.kind === "init") {
    setStatus(`${MODEL_LABEL[p.name] || p.name}を準備しています…`);
    if (p.name === "manga_line") loaded.models = true;
    if (p.name === "bg") loaded.bg = true;
  } else if (p.kind === "device") {
    const badge = $("device");
    badge.hidden = false;
    badge.classList.toggle("cpu", p.device !== "webgpu");
    badge.textContent = p.device === "webgpu" ? "GPU で処理" : `CPU で処理（遅い${p.threads > 1 ? `、${p.threads} スレッド` : ""}）`;
    badge.title = p.device === "webgpu"
      ? "画像の処理に、この PC の GPU を使っています（WebGPU）"
      : "このブラウザでは GPU（WebGPU）が使えないので、CPU で処理しています。線画化に時間がかかります。"
        + "Chrome か Edge の新しい版をおすすめします（Linux の Chrome は chrome://flags の「Unsafe WebGPU Support」を有効にすると GPU を使えることがあります）";
    if (loaded.device === p.device) return;
    loaded.device = p.device;
    if (p.device !== "webgpu") {
      setStatus("このブラウザでは GPU（WebGPU）が使えないので、CPU で動かします。線画化に数分かかります"
        + "（Chrome か Edge の新しい版をおすすめします）", true);
    }
  }
}

// モデルの読み込みの表示が残っていれば消す（仕事が終わったあと）
function clearModelStatus() {
  if (/のモデルを(読み込んで|準備して)います/.test($("status").textContent)) setStatus("");
}

function progress() {
  if (S.view === "presets") {
    const done = S.presets.filter((p, i) => S.results.has(rkey(i, 1))).length;
    const first = done === 0 ? firstLoadNote() : "";
    setStatus(done < S.presets.length ? `候補を作っています… ${done}/${S.presets.length}${first}` : "候補ができました。気に入ったものの「これにする」を押してください");
  } else if (S.view === "scales") {
    const done = S.scales.filter((sc) => S.results.has(rkey(S.base, sc))).length;
    setStatus(done < S.scales.length ? `大きさを変えて作っています… ${done}/${S.scales.length}` : "できました。気に入った大きさの「これにする」を押してください");
  }
}

// ---------- 画像を入れる ----------

function stem(name) {
  const base = (name || "image").replace(/^.*[\\/]/, "");
  const i = base.lastIndexOf(".");
  return (i > 0 ? base.slice(0, i) : base) || "image";
}

async function loadImage(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

function stopJobs() {
  jobs.bg = [];
  jobs.edit = false;
  jobs.row = false;
  pending.clear();
}

async function openFile(file) {
  if (!file) return;
  if (file.type && !file.type.startsWith("image/")) {
    setStatus("画像のファイルを入れてください", true);
    return;
  }
  const gen = ++S.gen;
  stopJobs();
  Object.assign(S, {
    orig: null, prep: null, image: null, results: new Map(), base: -1, scales: [...SCALES], scale: 1,
    editKey: null, dims: null, lines: null, prev: null, fixed: new Map(), undo: [], redo: [], rowSel: null,
    level: null, hasPaint: false, paintURL: null, stroke: null,
  });
  S.underCache.clear();
  resetLines();
  setStatus("画像を読んでいます…");
  let info;
  try {
    info = await engine.open(file);
  } catch (e) {
    if (gen === S.gen) showError(e);
    return;
  }
  if (gen !== S.gen) return;
  S.presets = info.presets;
  if (info.max_side) S.maxSide = info.max_side;
  S.maxImage = info.max_image || S.maxSide;
  S.orig = {
    id: info.id, name: stem(file.name), file: file.name, width: info.image_width, height: info.image_height,
    size: { width: info.width, height: info.height, rows: info.rows }, analysis: info.analysis, img: null,
    shrunk: info.shrunk,   // 大きすぎて縮めたときの、縮める前の大きさ [幅, 高さ]
  };
  S.prep = freshPrep();
  const skip = load(SKIP_KEY) === "1";
  $("prepSkipNext").checked = skip;
  if (skip) startImage(origInfo());
  else showPrep();
  try {
    const img = await loadImage(await engine.originalURL(info.id));
    if (!S.orig || S.orig.id !== info.id) return;
    S.orig.img = img;
    if (S.view === "prep") drawCrop();
  } catch (e) {
    if (S.orig && S.orig.id === info.id) showError(new Error("元の画像が読めませんでした"));
  }
}

// 前処理しないときの画像（送った画像そのもの）
function origInfo() {
  const o = S.orig;
  return { id: o.id, scale: 1, width: o.size.width, height: o.size.height, rows: o.size.rows, presets: S.presets };
}

// AA にする画像を決めて、1. 候補を作り始める（info は engine.open か engine.prepare の結果）
function startImage(info) {
  const gen = ++S.gen;
  stopJobs();
  Object.assign(S, {
    image: { id: info.id, width: info.width, height: info.height, rows: info.rows, name: S.orig.name, file: S.orig.file, img: null },
    results: new Map(), base: -1, scales: [...SCALES], scale: 1, editKey: null, dims: null,
    lines: null, prev: null, fixed: new Map(), undo: [], redo: [], rowSel: null,
  });
  if (info.presets) S.presets = info.presets;
  S.underCache.clear();
  resetPaint();
  resetLines();
  updateBaseOptions();
  showPresets();
  S.presets.forEach((p, i) => queueResult(i, 1));
  Promise.resolve(engine.sourceURL(info.id, 1)).then(loadImage).then((img) => {
    if (gen !== S.gen) return;
    S.image.img = img;
    S.image.srcCanvas = null;
    if (S.view === "presets" || S.view === "scales") compare.update("src", { canvas: sourceCanvas() });
    if (S.view === "edit") drawUnder();
  }).catch(() => { if (gen === S.gen) showError(new Error("元の画像が読めませんでした")); });
}

// 仕上げの途中なら、手直し（直した行と塗り）が消えることを確かめる
function confirmRestart() {
  const what = editsText();
  return !what || confirm(`手直し（${what}）を外して、候補を作り直します。よろしいですか？`);
}

// いまの手直しの中身（無ければ ""）
function editsText() {
  const parts = [];
  if (S.fixed.size) parts.push(`手で直した行 ${S.fixed.size} 行`);
  if (S.hasPaint) parts.push("塗った所");
  if (S.lineStrokes.length) parts.push("線画の直し");
  return parts.join("と");
}

// ---------- 0. 前処理 ----------
// 左: 送った画像（ドラッグで切り抜く範囲を決める）、中: 前処理した画像か線画を AA の大きさで等倍表示、
// 右: 大きさと線の太さ。設定を変えると、少し待ってからサーバーで前処理し直す（engine.prepare）。

function freshPrep() {
  return {
    crop: null, long: null, delta: 0,       // 設定（long が null なら長辺 800px まで縮める）
    bg: false,                              // 背景を消す（白くする）
    result: null, key: null,                // 最後に作った前処理の結果と、そのときの設定
    seq: 0, timer: 0,
    show: "image", zoom: "1", u: 0.5, v: 0.4,
    cache: new Map(),                       // 前処理した画像の id → {image, lineart}（canvas）
    drag: null, fit: null,
  };
}

function load(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

function store(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch (e) { /* 覚えられなくても動く */ }
}

function prepBody() {
  const p = S.prep;
  return { crop: p.crop, long: p.long, delta: p.delta, bg: p.bg };
}

function prepKey() {
  return JSON.stringify(prepBody());
}

// 切り抜いたあとの画像の大きさ（元の画像の px。aame.prep.crop と同じく端ごとに丸める）
function cropPx() {
  const c = S.prep.crop || [0, 0, 1, 1];
  const W = S.orig.width, H = S.orig.height;
  return { w: Math.max(1, Math.round(c[2] * W) - Math.round(c[0] * W)), h: Math.max(1, Math.round(c[3] * H) - Math.round(c[1] * H)) };
}

// AA の大きさ（サーバーと同じ計算。結果が来ればそちらを使う）
function prepSize() {
  const p = S.prep;
  if (p.result && p.key === prepKey()) return { width: p.result.width, height: p.result.height };
  const { w, h } = cropPx();
  if (p.long == null) {
    const s = Math.min(1, 800 / Math.max(w, h));
    return s < 1 ? { width: Math.trunc(w * s), height: Math.trunc(h * s) } : { width: w, height: h };
  }
  const s = p.long / Math.max(w, h);
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

function showPrep() {
  if (!S.orig) return;
  show("prep");
  drawCrop();
  fitPrepLoupe();
  updatePrepPanel();
  if (S.prep.key !== prepKey() || !S.prep.result) schedulePrepare(0);
  else loadPrepPreview();
  const sh = S.orig.shrunk;
  setStatus((sh ? `画像が大きいので、長辺 ${S.maxImage}px に縮めました（元は ${sh[0]}×${sh[1]} px）。` : "")
    + "切り抜きと大きさを決めて「この設定で候補を作る」を押してください。前処理しないで進むこともできます");
}

// 送った画像を左の枠に収めて描く
function drawCrop() {
  const img = S.orig && S.orig.img;
  const wrap = $("cropWrap");
  const c = $("cropCanvas");
  if (!img) {
    c.width = c.height = 1;
    S.prep.fit = null;
    return;
  }
  const W = wrap.clientWidth - 32, H = wrap.clientHeight - 32;
  if (W <= 0 || H <= 0) return;
  const z = Math.min(W / img.naturalWidth, H / img.naturalHeight, 4);
  const w = Math.max(1, Math.floor(img.naturalWidth * z)), h = Math.max(1, Math.floor(img.naturalHeight * z));
  const dpr = window.devicePixelRatio || 1;
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, c.width, c.height);
  S.prep.fit = { w, h };
  placeCropBox();
  drawPrepLoupe();
}

function placeCropBox() {
  const fit = S.prep.fit;
  if (!fit) return;
  const c = S.prep.crop || [0, 0, 1, 1];
  const [l, t, r, b] = [c[0] * fit.w, c[1] * fit.h, c[2] * fit.w, c[3] * fit.h];
  Object.assign($("cropBox").style, { left: `${l}px`, top: `${t}px`, width: `${r - l}px`, height: `${b - t}px` });
  // 切り抜く範囲の外を暗くする（上・下・左・右の4枚）
  const shades = $("cropStage").querySelectorAll(".cropshade");
  const parts = [[0, 0, fit.w, t], [0, b, fit.w, fit.h - b], [0, t, l, b - t], [r, t, fit.w - r, b - t]];
  parts.forEach(([x, y, w, h], i) => Object.assign(shades[i].style, { left: `${x}px`, top: `${y}px`, width: `${Math.max(0, w)}px`, height: `${Math.max(0, h)}px` }));
  $("cropStage").classList.toggle("full", !S.prep.crop);
  const { w, h } = cropPx();
  $("cropLabel").textContent = `${w}×${h}`;
  const sh = S.orig.shrunk;
  $("cropInfo").textContent = (S.prep.crop ? `${w}×${h} px を切り抜きます（元は ${S.orig.width}×${S.orig.height}）`
    : `元の画像のまま（${S.orig.width}×${S.orig.height} px）`)
    + (sh ? `。送った画像（${sh[0]}×${sh[1]} px）は長辺 ${S.maxImage}px に縮めてあります` : "");
}

function setupCrop() {
  const stage = $("cropStage");
  const at = (e) => {
    const r = $("cropCanvas").getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !S.prep || !S.prep.fit) return;
    e.preventDefault();
    const p = at(e);
    const c = S.prep.crop;
    const inside = c && p[0] > c[0] && p[0] < c[2] && p[1] > c[1] && p[1] < c[3];
    S.prep.drag = { mode: inside ? "move" : "draw", start: p, before: c ? c.slice() : null, moved: false };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener("pointermove", (e) => {
    if (!S.prep || !S.prep.fit) return;
    const p = at(e);
    const d = S.prep.drag;
    if (!d) {
      // マウスの所を右に等倍で表示する（切り抜く範囲の中での位置）
      const c = S.prep.crop || [0, 0, 1, 1];
      S.prep.u = Math.min(1, Math.max(0, (p[0] - c[0]) / (c[2] - c[0])));
      S.prep.v = Math.min(1, Math.max(0, (p[1] - c[1]) / (c[3] - c[1])));
      drawPrepLoupe();
      return;
    }
    const dx = p[0] - d.start[0], dy = p[1] - d.start[1];
    if (Math.abs(dx) + Math.abs(dy) > 0.004) d.moved = true;
    if (!d.moved) return;
    if (d.mode === "move") {
      const b = d.before;
      const ox = Math.min(Math.max(dx, -b[0]), 1 - b[2]), oy = Math.min(Math.max(dy, -b[1]), 1 - b[3]);
      S.prep.crop = [b[0] + ox, b[1] + oy, b[2] + ox, b[3] + oy];
    } else {
      S.prep.crop = [Math.min(d.start[0], p[0]), Math.min(d.start[1], p[1]), Math.max(d.start[0], p[0]), Math.max(d.start[1], p[1])];
    }
    placeCropBox();
    updatePrepPanel();
  });
  const end = () => {
    const d = S.prep && S.prep.drag;
    if (!d) return;
    S.prep.drag = null;
    if (!d.moved) return;
    const c = S.prep.crop;
    if (d.mode === "draw" && c && (c[2] - c[0] < 0.03 || c[3] - c[1] < 0.03)) S.prep.crop = d.before;   // 小さすぎる範囲は取り消す
    else if (c && c[0] <= 0.001 && c[1] <= 0.001 && c[2] >= 0.999 && c[3] >= 0.999) S.prep.crop = null;
    placeCropBox();
    updatePrepPanel();
    schedulePrepare();
  };
  stage.addEventListener("pointerup", end);
  stage.addEventListener("pointercancel", end);
  stage.addEventListener("dblclick", resetCrop);
}

function resetCrop() {
  if (!S.prep || !S.prep.crop) return;
  S.prep.crop = null;
  placeCropBox();
  updatePrepPanel();
  schedulePrepare();
}

function verdictText(a) {
  return { good: "ちょうどよい", thick: "太い", thin: "細い", none: "線が見つかりません" }[a.verdict] || "";
}

function updatePrepPanel() {
  const p = S.prep;
  if (!p) return;
  // 大きさ
  const { w, h } = cropPx();
  const size = prepSize();
  const long = p.long ?? Math.max(size.width, size.height);
  $("prepLong").max = S.maxSide;
  $("prepLong").value = long;
  $("prepLong").nextElementSibling.textContent = `${long}px`;
  const k = Math.max(size.width, size.height) / Math.max(w, h);
  $("sizeInfo").textContent = `AA: ${size.width}×${size.height} px、${Math.floor(size.height / ROW_H)} 行。1 行は全角で約 ${Math.round(size.width / 16)} 文字ぶん。`
    + (Math.abs(k - 1) < 0.005 ? "画像の大きさのまま。" : `画像を ×${k.toFixed(2)} に${k < 1 ? "縮め" : "拡大し"}ます。`);
  $("longAuto").disabled = p.long == null;
  // 線の太さ（設定を変えたばかりのときは、前に測った値を「測り直しています」と出す）
  const fresh = !!p.result && p.key === prepKey();
  const before = p.result ? p.result.before : S.orig.analysis;
  const info = $("strokeInfo");
  info.textContent = "";
  const changed = fresh && p.result.after && p.delta;
  if (before) {
    const head = document.createElement("div");
    head.append(p.delta ? "元の線の太さ: " : "線の太さ: ");
    if (before.width != null) {
      const b = document.createElement("b");
      b.textContent = `約 ${before.width.toFixed(1)}px`;
      head.append(b);
    }
    const badge = document.createElement("span");
    badge.className = `badge ${before.verdict}`;
    badge.textContent = verdictText(before);
    head.append(badge);
    if (!fresh && p.result) head.append(" （測り直しています…）");
    info.append(head);
    const range = document.createElement("div");
    range.className = "muted";
    range.textContent = `目安 ${before.good[0]}〜${before.good[1]}px（AA の大きさで）`;
    info.append(range);
    const msg = before.verdict === "thick" ? "線が太めです。AA で線が二重になる所が出るかもしれません。細くしてみてください。"
      : before.verdict === "thin" ? "線が細めです。線を拾えない所が出るかもしれません。太くするか、AA を小さくしてみてください。"
      : before.verdict === "none" ? "線がほとんど見つかりませんでした。写真や、線の無い絵かもしれません。" : "";
    if (msg && !changed) {
      const warn = document.createElement("p");
      warn.className = "warn";
      warn.textContent = msg;
      info.append(warn);
    }
    if (changed) {
      const a = p.result.after;
      const after = document.createElement("div");
      after.append("変えたあと: ");
      const b = document.createElement("b");
      b.textContent = a.width == null ? "?" : `約 ${a.width.toFixed(1)}px`;
      const badge2 = document.createElement("span");
      badge2.className = `badge ${a.verdict}`;
      badge2.textContent = verdictText(a);
      after.append(b, badge2);
      info.append(after);
    }
  }
  const rec = before ? before.recommended : 0;
  const auto = $("deltaAuto");
  auto.disabled = !rec || rec === p.delta;
  auto.textContent = rec ? `おすすめにする（${rec > 0 ? "+" : "−"}${Math.abs(rec).toFixed(1)}px）` : "おすすめ: 変えなくてよい";
  $("deltaZero").disabled = !p.delta;
  $("prepDelta").value = p.delta;
  $("prepDelta").nextElementSibling.textContent = `${p.delta > 0 ? "+" : p.delta < 0 ? "−" : "±"}${Math.abs(p.delta).toFixed(1)}`;
  setSeg("prepShow", p.show);
  setSeg("prepZoom", p.zoom);
  setSeg("prepBg", p.bg ? "remove" : "keep");
}

// 前処理しているときの表示
function prepBusyText() {
  return S.prep && S.prep.bg ? `背景を消して前処理しています…${bgLoadNote()}` : "前処理しています…";
}

function schedulePrepare(wait = PREP_WAIT) {
  const p = S.prep;
  clearTimeout(p.timer);
  $("prepState").textContent = prepBusyText();
  p.timer = setTimeout(() => runPrepare().catch(showError), wait);
}

// いまの設定で前処理する（結果は S.prep.result。古くなった呼び出しは null）
async function runPrepare() {
  const p = S.prep;
  clearTimeout(p.timer);
  const key = prepKey();
  if (p.result && p.key === key) return p.result;
  const seq = ++p.seq;
  const orig = S.orig;
  $("prepState").textContent = prepBusyText();
  const keep = S.image && S.image.id !== orig.id ? S.image.id : null;
  const r = await engine.prepare(orig.id, { ...prepBody(), keep });
  if (S.orig !== orig || seq !== p.seq) return null;
  clearModelStatus();
  p.result = r;
  p.key = key;
  updatePrepPanel();
  if (S.view === "prep") loadPrepPreview();
  return r;
}

// 前処理した画像（と線画）を読んで、等倍の表示に出す
async function loadPrepPreview() {
  const p = S.prep;
  const r = p.result;
  if (!r) return;
  const id = r.id;
  let c = p.cache.get(id);
  if (!c) {
    c = {};
    p.cache.set(id, c);
    for (const k of [...p.cache.keys()]) if (p.cache.size > 4 && k !== id) p.cache.delete(k);
  }
  const want = p.show;
  try {
    if (!c.image) {
      $("prepState").textContent = "前処理した画像を読んでいます…";
      c.image = toCanvas(await loadImage(await engine.sourceURL(id, 1)), r.width, r.height);
    }
    if (want === "lineart" && !c.lineart) {
      $("prepState").textContent = `線画を作っています…${firstLoadNote()}`;
      drawPrepLoupe();
      c.lineart = toCanvas(await loadImage(await engine.lineartURL(id, null, 1)), r.width, r.height);
    }
  } catch (e) {
    showError(new Error("前処理した画像が読めませんでした"));
  }
  if (p.result !== r || p.show !== want) return;
  $("prepState").textContent = `${r.width}×${r.height} px` + (want === "lineart" ? "（当てはめに使う線）" : "");
  drawPrepLoupe();
}

// 白地の canvas に描く（線画は透明な地なので）
function toCanvas(img, w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return c;
}

function fitPrepLoupe() {
  const wrap = $("prepWrap");
  const c = $("prepCanvas");
  const dpr = window.devicePixelRatio || 1;
  const w = wrap.clientWidth, h = wrap.clientHeight;
  if (!w || !h) return;
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  drawPrepLoupe();
}

function drawPrepLoupe() {
  const p = S.prep;
  if (!p) return;
  const c = $("prepCanvas");
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  const view = $("cropView");
  const r = p.result;
  const cached = r && p.cache.get(r.id);
  const src = cached && (p.show === "lineart" ? cached.lineart : cached.image);
  $("prepWait").hidden = !!src;
  $("prepWait").textContent = $("prepState").textContent || "前処理しています…";
  if (!src) { view.hidden = true; return; }
  const k = Math.max(1, Math.round(window.devicePixelRatio || 1)) * (p.zoom === "2" ? 2 : 1);
  const vw = c.width / k, vh = c.height / k;
  const place = (center, size, v) => (size <= v ? (size - v) / 2 : Math.min(Math.max(center - v / 2, 0), size - v));
  const sx = Math.round(place(p.u * src.width, src.width, vw));
  const sy = Math.round(place(p.v * src.height, src.height, vh));
  ctx.imageSmoothingEnabled = false;
  const x0 = Math.max(0, sx), y0 = Math.max(0, sy);
  const x1 = Math.min(src.width, sx + vw), y1 = Math.min(src.height, sy + vh);
  if (x1 > x0 && y1 > y0) ctx.drawImage(src, x0, y0, x1 - x0, y1 - y0, (x0 - sx) * k, (y0 - sy) * k, (x1 - x0) * k, (y1 - y0) * k);
  // 左の画像に、表示している所の枠を出す
  const fit = p.fit;
  if (!fit) { view.hidden = true; return; }
  const cr = p.crop || [0, 0, 1, 1];
  const fx = (x) => cr[0] + (Math.min(Math.max(x, 0), src.width) / src.width) * (cr[2] - cr[0]);
  const fy = (y) => cr[1] + (Math.min(Math.max(y, 0), src.height) / src.height) * (cr[3] - cr[1]);
  const l = fx(sx), t = fy(sy), rr = fx(sx + vw), b = fy(sy + vh);
  view.hidden = false;
  Object.assign(view.style, { left: `${l * fit.w}px`, top: `${t * fit.h}px`, width: `${(rr - l) * fit.w}px`, height: `${(b - t) * fit.h}px` });
}

// 「この設定で候補を作る」
async function prepGo() {
  if (!S.orig) return;
  let r;
  try {
    r = await runPrepare();
  } catch (e) {
    return showError(e);
  }
  if (!r) return;
  if (S.image && S.image.id === r.id) return showPresets();
  if (!confirmRestart()) return;
  startImage(r);
}

// 「前処理をしないで進む」
function prepSkip() {
  if (!S.orig) return;
  if (S.image && S.image.id === S.orig.id) return showPresets();
  if (!confirmRestart()) return;
  startImage(origInfo());
}

function setupPrep() {
  setupCrop();
  $("cropReset").addEventListener("click", resetCrop);
  const long = $("prepLong");
  long.addEventListener("input", () => {
    S.prep.long = Number(long.value);
    updatePrepPanel();
  });
  long.addEventListener("change", () => schedulePrepare());
  $("longAuto").addEventListener("click", () => {
    S.prep.long = null;
    updatePrepPanel();
    schedulePrepare(0);
  });
  const delta = $("prepDelta");
  delta.addEventListener("input", () => {
    S.prep.delta = Number(delta.value);
    updatePrepPanel();
  });
  delta.addEventListener("change", () => schedulePrepare());
  $("deltaAuto").addEventListener("click", () => {
    const p = S.prep;
    const before = p.result ? p.result.before : S.orig.analysis;
    if (!before || !before.recommended) return;
    p.delta = before.recommended;
    updatePrepPanel();
    schedulePrepare(0);
  });
  $("deltaZero").addEventListener("click", () => {
    S.prep.delta = 0;
    updatePrepPanel();
    schedulePrepare(0);
  });
  onSeg("prepShow", (v) => {
    S.prep.show = v;
    setSeg("prepShow", v);
    if (S.prep.result) loadPrepPreview();
    else drawPrepLoupe();
  });
  onSeg("prepZoom", (v) => { S.prep.zoom = v; setSeg("prepZoom", v); drawPrepLoupe(); });
  onSeg("prepBg", (v) => {
    S.prep.bg = v === "remove";
    updatePrepPanel();
    schedulePrepare(0);
  });
  $("prepGo").addEventListener("click", prepGo);
  $("prepSkip").addEventListener("click", prepSkip);
  $("prepSkipNext").addEventListener("change", () => store(SKIP_KEY, $("prepSkipNext").checked ? "1" : null));
  new ResizeObserver(() => { if (S.view === "prep") fitPrepLoupe(); }).observe($("prepWrap"));
  new ResizeObserver(() => { if (S.view === "prep") drawCrop(); }).observe($("cropWrap"));
}

// 元の画像（AA の大きさ。倍率 1）
function sourceCanvas() {
  if (!S.image.img) return null;
  if (!S.image.srcCanvas) {
    const c = document.createElement("canvas");
    c.width = S.image.width;
    c.height = S.image.height;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(S.image.img, 0, 0, c.width, c.height);
    S.image.srcCanvas = c;
  }
  return S.image.srcCanvas;
}

function sourceItem() {
  return { key: "src", title: "元の画像", note: S.image.file || "", width: S.image.width, height: S.image.height,
           chooseable: false, canvas: sourceCanvas() };
}

// ---------- 1. 候補を選ぶ ----------

function showPresets() {
  if (!S.image) return;
  show("presets");
  $("pickTitle").textContent = "1. 候補を選ぶ";
  $("pickLead").textContent = "描き込みの少ない順に並んでいます。";
  $("scaleButtons").hidden = true;
  const items = [sourceItem()];
  S.presets.forEach((p, i) => {
    const r = S.results.get(rkey(i, 1));
    items.push({ key: `p${i}`, title: p.title, note: p.note, width: S.image.width, height: S.image.height,
                 chooseable: true, canvas: r ? resultCanvas(r) : null, time: r ? secs(r.ms) : "" });
  });
  compare.setItems(items, S.base >= 0 ? `p${S.base}` : null);
  S.presets.forEach((p, i) => queueResult(i, 1));
  progress();
}

function choosePreset(i) {
  if (S.base !== i) {
    S.base = i;
    S.scales = SCALES.filter(fits);
  }
  showScales();
}

// 倍率 sc の AA が、扱える長辺（S.maxSide）に収まるか
function fits(sc) {
  return Math.round(Math.max(S.image.width, S.image.height) * sc) <= S.maxSide;
}

// ---------- 2. 大きさを選ぶ ----------

function sizeNote(r) {
  return `${r.width}×${r.height} px、${r.rows} 行`;
}

function showScales() {
  if (S.base < 0) return;
  show("scales");
  const preset = S.presets[S.base];
  $("pickTitle").textContent = "2. 大きさを選ぶ";
  $("pickLead").textContent = `「${preset.title}」を、大きさを少しずつ変えて作ります。大きさが変わると文字の並びも変わります。`;
  $("scaleButtons").hidden = false;
  S.scales.sort((a, b) => a - b);
  const items = [sourceItem()];
  for (const sc of S.scales) {
    const r = S.results.get(rkey(S.base, sc));
    const w = r ? r.width : Math.round(S.image.width * sc);
    const h = r ? r.height : Math.round(S.image.height * sc);
    items.push({ key: `s${sc}`, title: `×${sc.toFixed(2)}`, note: r ? sizeNote(r) : `${w}×${h} px`,
                 width: w, height: h, chooseable: true, canvas: r ? resultCanvas(r) : null, time: r ? secs(r.ms) : "" });
  }
  const active = S.editKey && S.editKey.base === S.base ? `s${S.scale}` : "s1";
  compare.setItems(items, active);
  // 1 に近い大きさから作る（先に作る仕事ほど先頭に）
  const order = [...S.scales].sort((a, b) => Math.abs(b - 1) - Math.abs(a - 1));
  for (const sc of order) queueResult(S.base, sc, true);
  progress();
}

function addScale(d) {
  const ends = d < 0 ? Math.min(...S.scales) : Math.max(...S.scales);
  const sc = Math.round((ends + d * SCALE_STEP) * 100) / 100;
  if (sc < SCALE_MIN || sc > SCALE_MAX || S.scales.includes(sc)) return;
  if (!fits(sc)) {
    setStatus(`AA の長辺は ${S.maxSide}px までです。これより大きくはできません`, true);
    return;
  }
  S.scales.push(sc);
  showScales();
}

function chooseScale(sc) {
  const r = S.results.get(rkey(S.base, sc));
  if (!r) return;
  const same = S.editKey && S.editKey.base === S.base && S.editKey.scale === sc;
  if (!same) {
    if (S.fixed.size && !confirm(`手で直した行（${S.fixed.size} 行）を外して、この候補で仕上げを始めます。よろしいですか？（塗った所と線画の直しは残ります）`)) return;
    S.scale = sc;
    S.editKey = { base: S.base, scale: sc };
    S.dims = { width: r.width, height: r.height, rows: r.rows };
    S.settings = { ...DEFAULTS, ...S.presets[S.base].settings };
    S.lines = r.lines;
    S.ms = r.ms;
    S.prev = null;
    S.fixed = new Map();
    // 直した行の「1つ戻す」は別の AA には使えないので捨てる（塗りと線画の直しは倍率 1 の大きさで持つので残す）
    S.undo = S.undo.filter((e) => e.kind === "paint" || e.kind === "line");
    S.redo = S.redo.filter((e) => e.kind === "paint" || e.kind === "line");
    S.underCache.clear();
    cancelRow();
    $("base").value = String(S.base);
    syncControls();
  }
  show("edit");
  drawEditor();
  setStatus("仕上げの画面です。調整、行を直す、塗って描き込みを増やす・減らす、線画を直す、が使えます");
  if (!same && (S.hasPaint || S.lineStrokes.length)) requestEdit();
}

// ---------- 3. 仕上げ: 調整 ----------

function updateBaseOptions() {
  const sel = $("base");
  sel.textContent = "";
  S.presets.forEach((p, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = p.title;
    sel.append(o);
  });
  sel.value = String(S.base);
}

function selectBase(i) {
  S.base = i;
  S.editKey = { base: i, scale: S.scale };
  S.settings = { ...DEFAULTS, ...S.presets[i].settings };
  syncControls();
  const r = S.results.get(rkey(i, S.scale));
  if (r && !S.hasPaint && !S.lineStrokes.length) {
    S.prev = shown();
    S.lines = r.lines;
    S.ms = r.ms;
    cancelRow();
    drawEditor();
  } else {
    requestEdit();
  }
}

function syncControls() {
  const st = S.settings;
  for (const id of ["mode", "color", "fill"]) setSeg(id, st[id] ?? "");
  for (const id of RANGES) {
    const el = $(id);
    el.value = st[id];
    el.nextElementSibling.textContent = Number(st[id]).toFixed(2).replace(/0$/, "");
  }
  const v2 = st.mode === "v2";
  document.querySelectorAll(".v2only").forEach((el) => { el.hidden = !v2; });
  document.querySelectorAll(".fillonly").forEach((el) => { el.hidden = !v2 || !st.fill; });
  document.querySelectorAll(".v2tool").forEach((el) => { el.disabled = !v2; });
  if (!v2 && painting()) setTool("none");
  $("modeNote").hidden = v2;
  setSeg("under", S.under);
  setSeg("zoom", S.zoom);
  setSeg("tool", S.tool);
}

function setSeg(id, value) {
  for (const b of $(id).querySelectorAll("button")) {
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(b.dataset.v === String(value)));
  }
}

function onSeg(id, fn) {
  $(id).addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b && !b.disabled) fn(b.dataset.v);
  });
}

// ---------- 3. 仕上げ: 表示 ----------

// 表示する行（エンジンの結果に、手で直した行を重ねたもの）
function shown(lines = S.lines) {
  if (!lines) return null;
  if (!S.fixed.size) return lines;
  const n = Math.max(lines.length, ...[...S.fixed.keys()].map((k) => k + 1));
  const out = [];
  for (let r = 0; r < n; r++) out.push(S.fixed.has(r) ? S.fixed.get(r) : (lines[r] ?? ""));
  return out;
}

// 行を直している途中なら、選んでいる候補で差し替えて見せる
function displayed() {
  const lines = shown();
  const sel = S.rowSel;
  if (!lines || !sel || !sel.options) return lines;
  const i = sel.hover >= 0 ? sel.hover : sel.pick;
  if (i < 0) return lines;
  const out = lines.slice();
  out[sel.row] = sel.options[i].line;
  return out;
}

function zoomFactor() {
  const dpr = window.devicePixelRatio || 1;
  const k = Math.max(1, Math.round(dpr));
  if (S.zoom === "1") return k / dpr;
  if (S.zoom === "2") return (2 * k) / dpr;
  const wrap = $("stageWrap");
  const z = Math.min((wrap.clientWidth - 36) / S.dims.width, (wrap.clientHeight - 36) / S.dims.height);
  return z >= 1 ? Math.floor(z * dpr) / dpr : Math.max(z, 0.1);
}

function layoutStage() {
  if (!S.dims || S.view !== "edit") return;
  const z = zoomFactor();
  const dpr = window.devicePixelRatio || 1;
  const stage = $("stage");
  const aa = $("aaCanvas");
  const w = Math.max(S.dims.width, aa.width);
  const h = Math.max(S.dims.height, aa.height);
  stage.style.width = `${w * z}px`;
  stage.style.height = `${h * z}px`;
  for (const c of [aa, $("underCanvas"), $("lineCanvas")]) {
    c.style.width = `${c.width * z}px`;
    c.style.height = `${c.height * z}px`;
  }
  // 塗りは倍率 1 の大きさで持っているので、いまの AA の大きさに合わせて表示する
  for (const p of [$("paintCanvas"), $("strokeCanvas")]) {
    p.style.width = `${S.dims.width * z}px`;
    p.style.height = `${S.dims.height * z}px`;
  }
  stage.classList.toggle("pixelated", Math.abs(z * dpr - Math.round(z * dpr)) < 1e-6 && z * dpr >= 1);
  S.z = z;
  placeRowMarks();
}

function placeBand(el, row) {
  if (row == null || row < 0) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.style.top = `${row * ROW_H * S.z}px`;
  el.style.height = `${ROW_H * S.z}px`;
}

// 手で直した行の印と、選んでいる行の帯
function placeRowMarks() {
  const marks = $("marks");
  marks.textContent = "";
  for (const r of S.fixed.keys()) {
    const m = document.createElement("div");
    m.className = "mark";
    m.style.top = `${r * ROW_H * S.z}px`;
    m.style.height = `${ROW_H * S.z}px`;
    marks.append(m);
  }
  placeBand($("rowPick"), S.rowSel ? S.rowSel.row : null);
}

function drawAACanvas(lines) {
  S.renderer.draw(lines, { canvas: $("aaCanvas"), minWidth: S.dims.width, bg: [255, 255, 255, 0] });
}

function drawEditor() {
  if (!S.dims || !S.lines) return;
  const lines = displayed();
  drawAACanvas(lines);
  $("prev").disabled = !S.prev;
  const text = $("text");
  if (document.activeElement !== text) text.value = shown().join("\n");
  const chars = lines.reduce((n, s) => n + [...s].length, 0);
  $("info").textContent = `${S.dims.width}×${lines.length * ROW_H} px、${lines.length} 行、${chars} 文字`
    + (S.ms ? `、作成 ${secs(S.ms)}` : "");
  $("scaleInfo").textContent = `大きさ ×${S.scale.toFixed(2)}`;
  updateUndoButtons();
  $("fixedNote").textContent = S.fixed.size
    ? `手で直した行が ${S.fixed.size} 行あります（左の印）。設定を変えて作り直しても、その行はそのままです。` : "";
  drawUnder();
  drawLines();
  layoutStage();
  updateTextInfo();
}

async function drawUnder() {
  const c = $("underCanvas");
  if (c.width !== S.dims.width || c.height !== S.dims.height) {
    c.width = S.dims.width;
    c.height = S.dims.height;
    c.dataset.key = "";
  }
  c.style.opacity = $("underOpacity").value;
  const ctx = c.getContext("2d");
  // 線画の下絵は、線画の直しも当てて表示する（want に直しの版を入れる）
  const underKey = () => (S.under === "source" ? "source" : S.under === "lineart" ? `lineart:${S.settings.color || ""}:${S.scale}` : "none");
  const imgKey = underKey();
  const want = imgKey.startsWith("lineart") ? `${imgKey}:${S.lineVer}` : imgKey;
  if (c.dataset.key === want) return;
  ctx.clearRect(0, 0, c.width, c.height);
  c.dataset.key = "";
  if (want === "none") {
    c.dataset.key = want;
    return;
  }
  let img = want === "source" ? S.image.img : S.underCache.get(imgKey);
  if (!img && want === "source") return;
  if (!img) {
    const id = S.image.id;
    try {
      img = await loadImage(await engine.lineartURL(id, S.settings.color, S.scale));
    } catch (e) {
      return showError(new Error("下絵が読めませんでした"));
    }
    if (!S.image || S.image.id !== id) return;
    S.underCache.set(imgKey, img);
  }
  if (underKey() !== imgKey || (want !== "source" && want !== `${imgKey}:${S.lineVer}`)) return;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  if (want !== "source") {
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = LINEART_COLOR;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.globalCompositeOperation = "source-over";
    if (S.lineStrokes.length) {
      // 消した所を除き、描いた線を足す
      const { state } = lineRaster();
      const im = ctx.getImageData(0, 0, c.width, c.height);
      const d = im.data;
      const red = rgbOf(LINEART_COLOR);
      for (let i = 0; i < state.length; i++) {
        if (state[i] === LINE_ERASE) d[i * 4 + 3] = 0;
        else if (state[i] === LINE_ADD) {
          d[i * 4] = red[0]; d[i * 4 + 1] = red[1]; d[i * 4 + 2] = red[2]; d[i * 4 + 3] = 255;
        }
      }
      ctx.putImageData(im, 0, 0);
    }
  }
  c.dataset.key = want;
}

// ---------- 3. 仕上げ: 1つ戻す・やり直す ----------
// 手直し（行の直し、テキストの直し、塗り）を1つずつ戻す。どれも {kind, before, after} で持ち、
// 戻すときは before、やり直すときは after にする。
//   paint: 塗った範囲 box = [x, y, 幅, 高さ] の段階（Float32Array）
//   fixed: 手で直した行（Map）
//   line:  線画の直し（lineStrokes の配列。中の線は変えないので、配列ごと持つ）
//   all:   「手直しを全て取り消す」の前と後 {fixed, level, lines}（level が null なら塗りなし）

function pushUndo(entry) {
  S.undo.push(entry);
  if (S.undo.length > UNDO_LIMIT) S.undo.shift();
  S.redo = [];
  updateUndoButtons();
}

function updateUndoButtons() {
  $("undo").disabled = !S.undo.length;
  $("redo").disabled = !S.redo.length;
  $("clearAll").disabled = !S.fixed.size && !S.hasPaint && !S.lineStrokes.length;
}

function restore(entry, side) {
  if (entry.kind === "paint") {
    writeBox(entry.box, entry[side]);
    paintChanged();
    requestEdit();
    return;
  }
  if (entry.kind === "line") {
    S.lineStrokes = entry[side];
    lineChanged();
    requestEdit();
    return;
  }
  const st = entry[side];
  S.fixed = new Map(entry.kind === "all" ? st.fixed : st);
  if (entry.kind === "all") {
    if (st.level) S.level.set(st.level);
    else S.level.fill(0);
    paintChanged();
    S.lineStrokes = st.lines;
    lineChanged();
    if (entry.paint || entry.lines) requestEdit();
  }
  cancelRow();
  drawEditor();
}

function undo() {
  const e = S.undo.pop();
  if (!e) return;
  restore(e, "before");
  S.redo.push(e);
  updateUndoButtons();
  setStatus("1つ戻しました（Ctrl+Y でやり直せます）");
}

function redo() {
  const e = S.redo.pop();
  if (!e) return;
  restore(e, "after");
  S.undo.push(e);
  updateUndoButtons();
  setStatus("やり直しました");
}

// 「手直しを全て取り消す」（これも「1つ戻す」で戻せる）
function clearAll() {
  const what = editsText();
  if (!what) return;
  if (!confirm(`手直し（${what}）を全て取り消して、エンジンの結果に戻します。よろしいですか？`)) return;
  const entry = {
    kind: "all", paint: S.hasPaint, lines: S.lineStrokes.length > 0,
    before: { fixed: new Map(S.fixed), level: S.hasPaint ? S.level.slice() : null, lines: S.lineStrokes },
    after: { fixed: new Map(), level: null, lines: [] },
  };
  pushUndo(entry);
  restore(entry, "after");
  setStatus("手直しを全て取り消しました（「1つ戻す」で元に戻せます）");
}

// ---------- 3. 仕上げ: 塗る ----------
// 「増やす」「減らす」で塗るたびに、その所の段階を +1 / −1 する（±PAINT_MAX まで。1回の塗りの中で
// 重なった所は1回と数える）。段階は倍率 1 の AA の大きさで持ち、塗り終えるとすぐに作り直す。
// 段階ごとの描き込みの倍率はサーバー側（aame.regions.PAINT_STEPS）で決める。

function resetPaint() {
  const w = S.image.width, h = S.image.height;
  S.level = new Float32Array(w * h);
  S.hasPaint = false;
  S.paintURL = null;
  S.stroke = null;
  for (const id of ["paintCanvas", "strokeCanvas"]) {
    $(id).width = w;
    $(id).height = h;
  }
  redrawPaint();
}

function painting() {
  return S.tool === "more" || S.tool === "less";
}

function paintChanged() {
  S.paintURL = null;
  S.hasPaint = S.level.some((v) => v !== 0);
  redrawPaint();
  updateUndoButtons();
}

function writeBox([x0, y0, w, h], values) {
  const W = S.image.width;
  for (let y = 0; y < h; y++) S.level.set(values.subarray(y * w, (y + 1) * w), (y0 + y) * W + x0);
}

function rgbOf(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// 表示用の塗り（増やすは橙、減らすは青。塗り重ねるほど濃い）
function redrawPaint() {
  const c = $("paintCanvas");
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(c.width, c.height);
  if (S.hasPaint) {
    const d = img.data;
    const L = S.level;
    const more = rgbOf(MORE_COLOR), less = rgbOf(LESS_COLOR);
    for (let i = 0; i < L.length; i++) {
      const v = L[i];
      if (v === 0) continue;
      const a = Math.abs(v);
      const col = v > 0 ? more : less;
      d[i * 4] = col[0];
      d[i * 4 + 1] = col[1];
      d[i * 4 + 2] = col[2];
      d[i * 4 + 3] = Math.round(255 * (a >= 1 ? 0.2 + 0.12 * (a - 1) : 0.2 * a));
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ブラシの直径（塗りの canvas の px。AA の 1 行の BRUSH_ROWS 倍）
function brushSize() {
  return (BRUSH_ROWS * ROW_H * S.image.width) / S.dims.width;
}

// 線を消すブラシの直径（同じく ERASER_ROWS 倍）
function eraserSize() {
  return (ERASER_ROWS * ROW_H * S.image.width) / S.dims.width;
}

// 塗っている途中の線を、半透明の canvas に描く（重なっても濃くならない）
function strokeTo(from, to) {
  const st = S.stroke;
  const ctx = $("strokeCanvas").getContext("2d");
  const r = brushSize() / 2;
  ctx.fillStyle = ctx.strokeStyle = st.sign > 0 ? MORE_COLOR : LESS_COLOR;
  ctx.lineWidth = 2 * r;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (from.x === to.x && from.y === to.y) {
    ctx.arc(to.x, to.y, r, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
  const b = st.box;
  b[0] = Math.min(b[0], from.x - r, to.x - r);
  b[1] = Math.min(b[1], from.y - r, to.y - r);
  b[2] = Math.max(b[2], from.x + r, to.x + r);
  b[3] = Math.max(b[3], from.y + r, to.y + r);
}

// 塗り終えた: 塗った所の段階を1つ上げ（下げ）て、作り直す
function finishStroke() {
  const st = S.stroke;
  S.stroke = null;
  const c = $("strokeCanvas");
  const ctx = c.getContext("2d");
  const x0 = Math.max(0, Math.floor(st.box[0]) - 1), y0 = Math.max(0, Math.floor(st.box[1]) - 1);
  const x1 = Math.min(c.width, Math.ceil(st.box[2]) + 1), y1 = Math.min(c.height, Math.ceil(st.box[3]) + 1);
  if (x1 <= x0 || y1 <= y0) {
    ctx.clearRect(0, 0, c.width, c.height);
    return;
  }
  const w = x1 - x0, h = y1 - y0;
  const alpha = ctx.getImageData(x0, y0, w, h).data;
  ctx.clearRect(0, 0, c.width, c.height);
  const W = S.image.width;
  const before = new Float32Array(w * h), after = new Float32Array(w * h);
  let changed = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x, i = (y0 + y) * W + x0 + x;
      const v = S.level[i];
      const a = alpha[k * 4 + 3] / 255;
      const nv = a ? Math.max(-PAINT_MAX, Math.min(PAINT_MAX, v + st.sign * a)) : v;
      before[k] = v;
      after[k] = nv;
      if (nv !== v) {
        S.level[i] = nv;
        changed = true;
      }
    }
  }
  if (!changed) {
    setStatus(`ここは、これ以上${st.sign > 0 ? "増やせ" : "減らせ"}ません（${PAINT_MAX} 回まで）`);
    return;
  }
  pushUndo({ kind: "paint", box: [x0, y0, w, h], before, after });
  paintChanged();
  requestEdit();
}

function setupPainting() {
  const p = $("paintCanvas");
  const brush = $("brush");
  const at = (e) => {
    const r = p.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * p.width) / r.width, y: ((e.clientY - r.top) * p.height) / r.height };
  };
  const moveBrush = (e) => {
    if (!painting() && S.tool !== "erase") return;
    const r = p.getBoundingClientRect();
    const sr = $("stage").getBoundingClientRect();
    const d = (S.tool === "erase" ? eraserSize() : brushSize()) * (r.width / p.width);
    brush.style.width = brush.style.height = `${d}px`;
    brush.style.left = `${e.clientX - sr.left - d / 2}px`;
    brush.style.top = `${e.clientY - sr.top - d / 2}px`;
    brush.hidden = false;
  };
  p.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (S.tool === "row") {
      const { row, x } = rowAt(e);
      selectRow(row, x);
      return;
    }
    if (lining()) {
      e.preventDefault();
      p.setPointerCapture(e.pointerId);
      const now = at(e);
      S.stroke = { line: S.tool, pts: [[now.x, now.y]], r: eraserSize() / 2, last: now };
      lineStrokeTo(now, now);
      return;
    }
    if (!painting() || !S.level) return;
    e.preventDefault();
    p.setPointerCapture(e.pointerId);
    const now = at(e);
    S.stroke = { sign: S.tool === "more" ? 1 : -1, box: [Infinity, Infinity, -Infinity, -Infinity], last: now };
    strokeTo(now, now);
  });
  p.addEventListener("pointermove", (e) => {
    if (S.tool === "row") {
      // 選んでいる行には枠を重ねない（直した結果が見えにくくなる）
      const row = rowAt(e).row;
      placeBand($("rowHover"), S.rowSel && S.rowSel.row === row ? null : row);
      return;
    }
    moveBrush(e);
    if (!S.stroke) return;
    const now = at(e);
    if (S.stroke.line) {
      const [lx, ly] = S.stroke.pts[S.stroke.pts.length - 1];
      if (Math.hypot(now.x - lx, now.y - ly) < 0.3) return;
      S.stroke.pts.push([now.x, now.y]);
      lineStrokeTo(S.stroke.last, now);
    } else {
      strokeTo(S.stroke.last, now);
    }
    S.stroke.last = now;
  });
  const end = (e) => {
    const r = p.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) brush.hidden = true;
    if (S.stroke) {
      if (S.stroke.line) finishLineStroke();
      else finishStroke();
    }
  };
  p.addEventListener("pointerup", end);
  p.addEventListener("pointercancel", end);
  p.addEventListener("pointerleave", () => {
    brush.hidden = true;
    $("rowHover").hidden = true;
  });
}

function setTool(v) {
  S.tool = v;
  setSeg("tool", v);
  const active = v !== "none";
  const stage = $("stage");
  stage.classList.toggle("painting", painting() || v === "erase");
  stage.classList.toggle("drawing", v === "draw");
  stage.classList.toggle("rowtool", v === "row");
  $("paintCanvas").style.pointerEvents = active ? "auto" : "none";
  $("rowPanel").hidden = v !== "row";
  $("paintPanel").hidden = !painting();
  $("paintWhat").textContent = v === "less" ? "減り" : "増え";
  $("linePanel").hidden = !lining();
  $("lineWhat").textContent = v === "draw"
    ? "なぞった所に線を描き（緑）、すぐに作り直します。押すだけなら点になります（鼻や口の点に）。細かく描くときは「等倍」「2倍」で。"
    : "なぞった所の線を消して（灰色）、すぐに作り直します。背景の線など、AA にしたくない線を消すのに使います。";
  if (v !== "row") {
    cancelRow();
    $("rowHover").hidden = true;
  }
  if (!painting() && v !== "erase") $("brush").hidden = true;
  if (S.dims) drawLines();
}

// ---------- 3. 仕上げ: 線画を直す ----------
// 「線を消す」「線を描き足す」でなぞった線を、倍率 1 の AA の座標で lineStrokes に順に持つ。いまの AA の
// 大きさに直して画素ごとの値（LINE_ADD / LINE_ERASE。後の線が勝つ）にし、PNG にしてサーバーに送る
// （赤が描いた線、緑が消した所。aame.lineart.edit_masks）。エンジンは当てはめに使う 1px の線に当てる。
// 線を描き足すのは 1px の線、押すだけなら 2x2 の点（線画にする処理が鼻や口の点を残すのと同じ形）。

function lining() {
  return S.tool === "erase" || S.tool === "draw";
}

function resetLines() {
  S.lineStrokes = [];
  S.lineVer++;
  S.lineRaster = null;
  S.lineURL = null;
  S.lineBase.clear();
}

function lineChanged() {
  S.lineVer++;
  if (S.dims) {
    drawLines();
    if (S.under === "lineart") drawUnder();
  }
  updateUndoButtons();
}

function plot(state, w, h, x, y, v) {
  if (x >= 0 && y >= 0 && x < w && y < h) state[y * w + x] = v;
}

// 1px の線（8 近傍でつながる。ブレゼンハム）
function pencil(state, w, h, pts) {
  const P = pts.map(([x, y]) => [Math.floor(x), Math.floor(y)]);
  if (P.length === 1) {
    const [x, y] = P[0];
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) plot(state, w, h, x + dx, y + dy, LINE_ADD);
    return;
  }
  for (let i = 1; i < P.length; i++) {
    let [x0, y0] = P[i - 1];
    const [x1, y1] = P[i];
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      plot(state, w, h, x0, y0, LINE_ADD);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
}

// 半径 r の丸いブラシでなぞった所（画素の中心が線分から r 以内）
function eraser(state, w, h, pts, r) {
  const r2 = r * r;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[i];
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) - r)), x1 = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0]) + r));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) - r)), y1 = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1]) + r));
    const ux = b[0] - a[0], uy = b[1] - a[1], L2 = ux * ux + uy * uy;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const t = L2 ? Math.max(0, Math.min(1, ((px - a[0]) * ux + (py - a[1]) * uy) / L2)) : 0;
        const qx = a[0] + t * ux - px, qy = a[1] + t * uy - py;
        if (qx * qx + qy * qy <= r2) state[y * w + x] = LINE_ERASE;
      }
    }
  }
}

// 線画の直しを、いまの AA の大きさの画素ごとの値にする
function lineRaster() {
  const w = S.dims.width, h = S.dims.height;
  const key = `${S.lineVer}:${w}x${h}`;
  if (S.lineRaster && S.lineRaster.key === key) return S.lineRaster;
  const state = new Uint8Array(w * h);
  const kx = w / S.image.width, ky = h / S.image.height;
  for (const st of S.lineStrokes) {
    const pts = st.pts.map(([x, y]) => [x * kx, y * ky]);
    if (st.tool === "draw") pencil(state, w, h, pts);
    else eraser(state, w, h, pts, st.r * kx);
  }
  S.lineRaster = { key, w, h, state };
  return S.lineRaster;
}

// サーバーに送る線画の直し（PNG の data URL。直していなければ null）
function currentEdit() {
  if (!S.lineStrokes.length || !S.dims) return null;
  const { key, w, h, state } = lineRaster();
  if (S.lineURL && S.lineURL.key === key) return S.lineURL.url;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let i = 0; i < state.length; i++) {
    d[i * 4] = state[i] === LINE_ADD ? 255 : 0;
    d[i * 4 + 1] = state[i] === LINE_ERASE ? 255 : 0;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  S.lineURL = { key, url: c.toDataURL("image/png") };
  return S.lineURL.url;
}

// 当てはめに使う線（直す前。いまの色の境界と大きさ）→ {w, h, mask}。読めなければ null
async function lineBase() {
  const key = `${S.settings.color || ""}:${S.scale}`;
  let b = S.lineBase.get(key);
  if (b) return b;
  const id = S.image.id, w = S.dims.width, h = S.dims.height;
  let img;
  try {
    img = await loadImage(await engine.lineartURL(id, S.settings.color, S.scale));
  } catch (e) {
    showError(new Error("線画が読めませんでした"));
    return null;
  }
  if (!S.image || S.image.id !== id) return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  const a = ctx.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = a[i * 4 + 3] > 127 ? 1 : 0;
  b = { w, h, mask };
  S.lineBase.set(key, b);
  return b;
}

// 線画を直す道具のときに、当てはめに使う線を AA の下に出す（赤。消した線は灰色、描いた線は緑）
let linesSeq = 0;
async function drawLines() {
  const c = $("lineCanvas");
  const on = S.view === "edit" && lining() && !!S.dims && !!S.image;
  if (!on) {
    c.hidden = true;
    return;
  }
  const seq = ++linesSeq;
  const base = await lineBase();
  if (seq !== linesSeq || !lining() || !base || base.w !== S.dims.width || base.h !== S.dims.height) return;
  const { key, w, h, state } = lineRaster();
  const want = `${key}:${S.settings.color || ""}:${S.scale}`;
  if (c.dataset.key !== want) {
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(w, h);
    const d = img.data;
    const red = rgbOf(LINEART_COLOR), add = rgbOf(ADD_COLOR), gone = rgbOf(ERASED_COLOR);
    for (let i = 0; i < state.length; i++) {
      const v = state[i];
      const col = v === LINE_ADD ? add : v === LINE_ERASE ? (base.mask[i] ? gone : null) : base.mask[i] ? red : null;
      if (!col) continue;
      d[i * 4] = col[0];
      d[i * 4 + 1] = col[1];
      d[i * 4 + 2] = col[2];
      d[i * 4 + 3] = v === LINE_ERASE ? 110 : 255;
    }
    ctx.putImageData(img, 0, 0);
    c.dataset.key = want;
  }
  c.hidden = false;
  layoutStage();
}

// なぞっている途中の線を描く（描く線は 1px ぶんの細い線、消すブラシは灰色の太い線）
function lineStrokeTo(from, to) {
  const st = S.stroke;
  const c = $("strokeCanvas");
  const ctx = c.getContext("2d");
  const draw = st.line === "draw";
  c.style.opacity = draw ? "1" : "";
  const r = draw ? S.image.width / S.dims.width / 2 : st.r;
  ctx.fillStyle = ctx.strokeStyle = draw ? ADD_COLOR : "#555";
  ctx.lineWidth = 2 * r;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (from.x === to.x && from.y === to.y) {
    ctx.arc(to.x, to.y, draw ? 2 * r : r, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
}

// なぞり終えた: 線画の直しに足して、作り直す
function finishLineStroke() {
  const st = S.stroke;
  S.stroke = null;
  const c = $("strokeCanvas");
  c.getContext("2d").clearRect(0, 0, c.width, c.height);
  c.style.opacity = "";
  const stroke = { tool: st.line, pts: st.pts, r: st.r };
  const before = S.lineStrokes;
  S.lineStrokes = before.concat([stroke]);
  pushUndo({ kind: "line", before, after: S.lineStrokes });
  lineChanged();
  requestEdit();
  setStatus(st.line === "draw" ? "線を描き足しました（Ctrl+Z で戻せます）" : "線を消しました（Ctrl+Z で戻せます）");
}

// ---------- 3. 仕上げ: 行を直す ----------

function rowAt(e) {
  const r = $("stage").getBoundingClientRect();
  const row = Math.floor((e.clientY - r.top) / S.z / ROW_H);
  return { row: row >= 0 && row < S.dims.rows ? row : -1, x: (e.clientX - r.left) / S.z };
}

function selectRow(row, x) {
  if (row < 0 || !S.lines) return;
  const current = shown()[row];
  S.rowSel = { row, x, current, options: null, pick: -1, hover: -1 };
  $("rowHover").hidden = true;
  jobs.row = true;
  $("busy").textContent = "行の候補を作っています…";
  $("busy").hidden = false;
  drawRowPanel();
  drawEditor();
  pump();
}

async function runRow() {
  const sel = S.rowSel;
  if (!sel || sel.options) return;
  const gen = S.gen;
  const r = await engine.rowOptions(S.image.id, sel.row, requestSettings(), currentPaint(), S.scale, sel.current, currentEdit());
  if (gen !== S.gen || S.rowSel !== sel) return;
  const options = [{ kind: "now", label: S.fixed.has(sel.row) ? "いまの行（手で直した行）" : "いまの行", line: sel.current }];
  const engineLine = S.lines[sel.row];
  if (S.fixed.has(sel.row) && engineLine !== sel.current) {
    options.push({ kind: "now", label: "直す前（エンジンの結果）", line: engineLine });
  }
  const have = new Set(options.map((o) => o.line));
  sel.options = options.concat(r.options.filter((o) => !have.has(o.line)));
  sel.ms = r.ms;
  drawRowPanel();
  setStatus(`${sel.row + 1} 行目の候補を ${r.options.length} 個作りました（${secs(r.ms)}）`);
}

function cancelRow() {
  if (!S.rowSel) return;
  S.rowSel = null;
  drawRowPanel();
  if (S.dims) drawEditor();
}

function pickRow(i, { preview = true } = {}) {
  const sel = S.rowSel;
  if (!sel || !sel.options) return;
  sel.pick = Math.max(0, Math.min(sel.options.length - 1, i));
  for (const [k, el] of [...$("rowList").querySelectorAll(".ropt")].entries()) {
    el.classList.toggle("picked", k === sel.pick);
    if (k === sel.pick && preview) el.scrollIntoView({ block: "nearest" });
  }
  $("rowApply").disabled = sel.options[sel.pick].kind === "now" && sel.pick === 0;
  drawEditor();
}

function applyRow() {
  const sel = S.rowSel;
  if (!sel || !sel.options || sel.pick < 0) return;
  const line = sel.options[sel.pick].line;
  if (line !== sel.current) {
    const before = new Map(S.fixed);
    setFixed(sel.row, line);
    pushUndo({ kind: "fixed", before, after: new Map(S.fixed) });
    setStatus(`${sel.row + 1} 行目を差し替えました（Ctrl+Z で戻せます）`);
  }
  S.rowSel = null;
  drawRowPanel();
  drawEditor();
}

function setFixed(row, line) {
  if (S.lines && S.lines[row] === line) S.fixed.delete(row);
  else S.fixed.set(row, line);
}

// 候補の行を、押した所のまわりだけ等倍で描く
function rowStrip(line, x, cssW) {
  const dpr = window.devicePixelRatio || 1;
  const k = Math.max(1, Math.round(dpr));
  const full = S.renderer.draw([line], { minWidth: S.dims.width });
  const c = document.createElement("canvas");
  c.width = Math.round(cssW * dpr);
  c.height = ROW_H * k;
  c.style.width = `${c.width / dpr}px`;
  c.style.height = `${c.height / dpr}px`;
  const vw = c.width / k;
  const sx = Math.round(Math.min(Math.max(x - vw / 2, 0), Math.max(0, full.width - vw)));
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = false;
  const w = Math.min(vw, full.width - sx);
  if (w > 0) ctx.drawImage(full, sx, 0, w, ROW_H, 0, 0, w * k, ROW_H * k);
  return c;
}

function drawRowPanel() {
  const sel = S.rowSel;
  const list = $("rowList");
  list.textContent = "";
  $("rowHead").hidden = !sel;
  $("rowHint").hidden = !!sel;
  if (!sel) return;
  $("rowTitle").textContent = `${sel.row + 1} 行目`;
  $("rowApply").disabled = true;
  if (!sel.options) {
    const p = document.createElement("p");
    p.className = "note";
    p.textContent = "候補を作っています…";
    list.append(p);
    return;
  }
  const cssW = Math.max(160, list.clientWidth - 2);
  let kind = null;
  sel.options.forEach((o, i) => {
    if (o.kind !== kind) {
      kind = o.kind;
      if (kind !== "now") {
        const h = document.createElement("div");
        h.className = "rgroup";
        h.textContent = KIND_TITLE[kind] || kind;
        list.append(h);
      }
    }
    const b = document.createElement("button");
    b.className = "ropt";
    const label = document.createElement("span");
    label.className = "rlabel";
    label.textContent = o.label;
    b.append(label, rowStrip(o.line, sel.x, cssW));
    b.addEventListener("pointerenter", () => { sel.hover = i; drawEditor(); });
    b.addEventListener("pointerleave", () => { sel.hover = -1; drawEditor(); });
    b.addEventListener("click", () => pickRow(i, { preview: false }));
    b.addEventListener("dblclick", () => { pickRow(i, { preview: false }); applyRow(); });
    list.append(b);
  });
  if (sel.options.length <= 1) {
    const p = document.createElement("p");
    p.className = "note";
    p.textContent = "この行には、見た目の違う候補がありませんでした。";
    list.append(p);
  }
}

// ---------- 3. 仕上げ: テキストを直接直す ----------

let textTimer = 0;

function applyText() {
  if (!S.lines) return;
  let rows = $("text").value.replace(/\r/g, "").split("\n");
  if (rows.length > 1 && rows[rows.length - 1] === "") rows = rows.slice(0, -1);
  const n = Math.max(rows.length, S.lines.length);
  const fixed = new Map();
  for (let r = 0; r < n; r++) {
    const t = rows[r] ?? "";
    if (t !== (S.lines[r] ?? "")) fixed.set(r, t);
  }
  S.fixed = fixed;
  cancelRow();
  drawEditor();
}

function updateTextInfo() {
  const text = $("text");
  if (!S.dims) return;
  const before = text.value.slice(0, text.selectionStart);
  const r = before.split("\n").length - 1;
  const line = text.value.split("\n")[r] ?? "";
  const w = S.table.lineWidth(line);
  const unknown = S.table.unknown([line]);
  $("textInfo").textContent = `${r + 1} 行目: 幅 ${w} px（AA の幅 ${S.dims.width} px、MS Pゴシックで）`
    + (unknown.length ? `。辞書に無い文字: ${unknown.join(" ")}` : "");
}

function setupText() {
  const text = $("text");
  text.addEventListener("focus", () => { S.textSnap = new Map(S.fixed); });
  text.addEventListener("input", () => {
    clearTimeout(textTimer);
    textTimer = setTimeout(applyText, 200);
    updateTextInfo();
  });
  text.addEventListener("blur", () => {
    clearTimeout(textTimer);
    applyText();
    if (S.textSnap && !sameMap(S.textSnap, S.fixed)) pushUndo({ kind: "fixed", before: S.textSnap, after: new Map(S.fixed) });
    S.textSnap = null;
  });
  for (const ev of ["keyup", "click", "select"]) text.addEventListener(ev, updateTextInfo);
}

function sameMap(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

// ---------- 書き出す ----------

function download(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function outName(ext) {
  return `${S.image ? S.image.name : "aa"}_aa.${ext}`;
}

// .html に埋め込むフォント（表示フォント。MS Pゴシックのときは同じ幅の EMBED_FONT）
function embedFont() {
  return S.fonts.find((f) => f.id === S.fontId && !f.builtin) || S.fonts.find((f) => f.id === EMBED_FONT) || null;
}

function updateExportLabels() {
  const f = embedFont();
  const b = $("saveHtmlFont");
  b.disabled = !f;
  b.textContent = f ? `.html（${f.label} 埋め込み）` : ".html（フォント埋め込み）";
  b.title = f ? `AA に使う文字だけを ${f.label} から抜き出して埋め込みます（${f.license}）。どの環境・ズームでも同じ見た目になります`
    : "埋め込めるフォントがありません（python -m webapp.get_fonts で取ってきてください）";
  $("htmlNote").textContent = ".html は MS Pゴシックで表示します（ブラウザのズームが 100% のときに位置が合います）。"
    + (f ? `埋め込みのほうは ${f.label} で、どの環境・ズームでも同じ見た目です。` : "");
}

function dataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// フォントを埋め込んだ .html（AA に使う文字だけを抜き出す）
async function saveHtmlFont() {
  const lines = shown();
  const f = embedFont();
  if (!lines || !f) return;
  const b = $("saveHtmlFont");
  b.disabled = true;
  setStatus(`${f.label} から AA に使う文字を抜き出しています…`);
  try {
    const font = await engine.fontSubset(f.id, lines.join(""));
    const url = (await dataURL(font)).replace(/^data:[^;,]*/, "data:font/woff2");
    const html = toHtml(lines, { family: `aame-${f.id}`, label: f.label, license: f.license, source: f.source, url });
    download(new Blob([html], { type: "text/html;charset=utf-8" }), `${S.image ? S.image.name : "aa"}_aa_${f.id}.html`);
    setStatus(`${f.label} を埋め込んだ .html を書き出しました（フォント ${Math.max(1, Math.round(font.size / 1024))} KB）`);
  } catch (e) {
    showError(e);
  } finally {
    b.disabled = false;
  }
}

function setupExport() {
  $("copy").addEventListener("click", async () => {
    const lines = shown();
    if (!lines) return;
    try {
      await navigator.clipboard.writeText(toText(lines));
      setStatus("テキストをコピーしました");
    } catch (e) {
      $("textBox").open = true;
      $("text").select();
      setStatus("コピーできなかったので、下のテキストを選んであります。Ctrl+C でコピーしてください", true);
    }
  });
  $("saveTxt").addEventListener("click", () => {
    const lines = shown();
    if (lines) download(new Blob([toText(lines)], { type: "text/plain;charset=utf-8" }), outName("txt"));
  });
  $("saveHtml").addEventListener("click", () => {
    const lines = shown();
    if (lines) download(new Blob([toHtml(lines)], { type: "text/html;charset=utf-8" }), outName("html"));
  });
  $("saveHtmlFont").addEventListener("click", saveHtmlFont);
  $("savePng").addEventListener("click", () => {
    const lines = shown();
    if (!lines) return;
    const c = S.renderer.draw(lines, { minWidth: S.dims.width });
    c.toBlob((blob) => download(blob, outName("png")), "image/png");
  });
}

// ---------- 使う文字（辞書から外す文字） ----------
// 外した文字は、候補・大きさ・仕上げ・行の候補のどれにも使わない（サーバーの辞書から外す）。
// 空白（インクの無い文字）は外せない。選んだ文字はこのブラウザで覚える（EXCLUDE_KEY）。

function categoryOf(ch) {
  const c = ch.codePointAt(0);
  const within = (a, b) => c >= a && c <= b;
  if (within(0x30, 0x39) || within(0x41, 0x5a) || within(0x61, 0x7a)
    || within(0xff10, 0xff19) || within(0xff21, 0xff3a) || within(0xff41, 0xff5a)) return "alnum";
  if (within(0xff65, 0xff9f)) return "hankana";
  if (within(0x3040, 0x309f)) return "hiragana";
  if (within(0x30a0, 0x30ff)) return "katakana";
  if (within(0x3400, 0x9fff) || within(0x3005, 0x3007)) return "kanji";
  if (within(0x370, 0x3ff) || within(0x400, 0x4ff)) return "greek";
  return "symbol";
}

// 外せる文字（インクのある文字。辞書の順）
function inkChars() {
  if (!S.table) return [];
  return [...S.table.map.entries()].filter(([, g]) => g.rows.some(Boolean)).map(([ch]) => ch);
}

// 辞書の順に並べ、外せない文字・辞書に無い文字を除いたもの
function normalizeExclude(chars) {
  const set = new Set(chars);
  return inkChars().filter((ch) => set.has(ch)).join("");
}

function updateDictButton() {
  const n = [...S.exclude].length;
  const b = $("dictBtn");
  b.textContent = n ? `使う文字（−${n}）` : "使う文字";
  b.classList.toggle("on", n > 0);
  b.title = n ? `当てはめに使わない文字が ${n} 文字あります: ${S.exclude}` : "当てはめに使う文字を選びます（いまは辞書の文字をすべて使います）";
}

// 使わない文字を変えて、いまの画面の AA を作り直す
function applyExclude(text) {
  text = normalizeExclude(text);
  if (text === S.exclude) return false;
  S.exclude = text;
  store(EXCLUDE_KEY, text || null);
  updateDictButton();
  S.dictGen++;
  // 候補と大きさの結果は、前の文字で作ったものなので作り直す
  jobs.bg = [];
  pending.clear();
  S.results = new Map();
  const n = [...text].length;
  setStatus(n ? `${n} 文字を使わずに作り直します` : "辞書の文字をすべて使って作り直します");
  if (S.view === "presets") showPresets();
  else if (S.view === "scales") showScales();
  else if (S.view === "edit") {
    cancelRow();
    requestEdit();
  }
  return true;
}

// 文字の形を描いた canvas（表示フォントで。2 倍の大きさで表示する）
function glyphCanvas(ch) {
  const c = S.renderer.draw([ch], { minWidth: S.table.width(ch) });
  c.className = "gimg";
  c.style.width = `${c.width * 2}px`;
  c.style.height = `${c.height * 2}px`;
  return c;
}

const dict = { draft: null, cells: new Map(), heads: [] };

function openDict() {
  if (!S.table || !S.renderer) return;
  dict.draft = new Set(S.exclude);
  dict.cells = new Map();
  dict.heads = [];
  const body = $("dictBody");
  body.textContent = "";
  const cell = (ch, count = null) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "gcell";
    b.title = `${ch}（U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}、幅 ${S.table.width(ch)}px）`;
    b.append(glyphCanvas(ch));
    if (count != null) {
      const k = document.createElement("span");
      k.className = "gcount";
      k.textContent = String(count);
      b.append(k);
    }
    b.addEventListener("click", () => toggleChars([ch], !dict.draft.has(ch)));
    if (!dict.cells.has(ch)) dict.cells.set(ch, []);
    dict.cells.get(ch).push(b);
    return b;
  };
  const section = (title, chars, counts = null, toggle = true) => {
    const sec = document.createElement("section");
    sec.className = "dictsec";
    const head = document.createElement("div");
    head.className = "dicthead2";
    const h = document.createElement("b");
    h.textContent = title;
    head.append(h);
    if (toggle) {
      const t = document.createElement("button");
      t.type = "button";
      t.className = "ghost small";
      t.addEventListener("click", () => toggleChars(chars, chars.some((ch) => !dict.draft.has(ch))));
      const info = document.createElement("span");
      info.className = "muted";
      head.append(info, t);
      dict.heads.push({ chars, info, button: t });
    }
    const grid = document.createElement("div");
    grid.className = "ggrid";
    for (const ch of chars) grid.append(cell(ch, counts ? counts.get(ch) : null));
    sec.append(head, grid);
    body.append(sec);
  };
  // いまの AA で使っている文字（多い順）
  const lines = S.view === "edit" ? shown() : null;
  if (lines) {
    const counts = new Map();
    const ink = new Set(inkChars());
    for (const line of lines) for (const ch of line) if (ink.has(ch)) counts.set(ch, (counts.get(ch) || 0) + 1);
    const used = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));
    if (used.length) section(`この AA で使っている文字（${used.length} 種類、多い順。数字は使っている数）`, used, counts, false);
  }
  const all = inkChars();
  for (const [id, label] of CATEGORIES) {
    const chars = all.filter((ch) => categoryOf(ch) === id);
    if (chars.length) section(label, chars);
  }
  refreshDict();
  $("dictDialog").showModal();
}

function toggleChars(chars, exclude) {
  for (const ch of chars) {
    if (exclude) dict.draft.add(ch);
    else dict.draft.delete(ch);
  }
  refreshDict();
}

function refreshDict() {
  for (const [ch, cells] of dict.cells) for (const b of cells) b.classList.toggle("off", dict.draft.has(ch));
  for (const { chars, info, button } of dict.heads) {
    const on = chars.filter((ch) => !dict.draft.has(ch)).length;
    info.textContent = `${on} / ${chars.length} 文字を使う`;
    button.textContent = on < chars.length ? "すべて使う" : "すべて外す";
  }
  const total = inkChars().length;
  const off = [...dict.draft].length;
  $("dictCount").textContent = `${total} 文字のうち ${total - off} 文字を使う（空白はいつも使います）`;
  const changed = normalizeExclude([...dict.draft]) !== S.exclude;
  $("dictOk").disabled = !changed;
}

function setupDict() {
  $("dictBtn").addEventListener("click", openDict);
  $("dictAll").addEventListener("click", () => toggleChars(inkChars(), false));
  $("dictDialog").addEventListener("close", () => {
    if ($("dictDialog").returnValue === "ok" && dict.draft) applyExclude([...dict.draft].join(""));
    dict.draft = null;
  });
}

// ---------- 表示フォント ----------

async function setupFonts() {
  let list = [{ id: "mspgothic", label: "MS Pゴシック", builtin: true }];
  try {
    list = (await (await fetch("fonts.json")).json()).fonts;
  } catch (e) { /* 一覧が無ければ MS Pゴシックだけ */ }
  S.fonts = list;
  const sel = $("font");
  for (const f of list) {
    const o = document.createElement("option");
    o.value = f.id;
    o.textContent = f.label;
    o.title = [f.note, f.license].filter(Boolean).join(" / ");
    sel.append(o);
  }
  sel.value = S.fontId;
  sel.addEventListener("change", () => setFont(sel.value));
  updateExportLabels();
  // 前に選んだフォント（無ければ DEFAULT_FONT）にする。読めなければ MS Pゴシックのまま
  const want = load(FONT_KEY) || DEFAULT_FONT;
  if (want !== S.fontId && list.some((f) => f.id === want)) await setFont(want, { quiet: true });
}

// quiet: 起動したときの切り替え（うまくいったときは何も出さない）
async function setFont(id, { quiet = false } = {}) {
  const info = S.fonts.find((f) => f.id === id);
  try {
    await S.renderer.setFont(info);
  } catch (e) {
    console.error(e);
    $("font").value = S.fontId;
    setStatus(`フォント「${info.label}」が読めなかったので、${S.fonts.find((f) => f.id === S.fontId)?.label || "MS Pゴシック"}で表示します（python -m webapp.get_fonts で取ってきてください）`, !quiet);
    return;
  }
  S.fontId = id;
  $("font").value = id;
  updateExportLabels();
  if (!quiet) store(FONT_KEY, id);
  for (const r of S.results.values()) if (r) r.canvas = null;
  if (S.view === "presets") showPresets();
  else if (S.view === "scales") showScales();
  else if (S.view === "edit") {
    drawEditor();
    drawRowPanel();
  }
  if (!quiet) setStatus(`表示フォント: ${info.label}${info.builtin ? "" : `（${info.license}）`}`);
}

// ---------- 始める ----------

const compare = new Compare($("compare"), {
  onChoose: (key) => {
    if (key.startsWith("p")) choosePreset(Number(key.slice(1)));
    else if (key.startsWith("s")) chooseScale(Number(key.slice(1)));
  },
});

function setupInput() {
  const file = $("file");
  for (const id of ["pick", "pick2"]) $(id).addEventListener("click", () => file.click());
  $("drop").addEventListener("click", (e) => { if (e.target === $("drop")) file.click(); });
  file.addEventListener("change", () => {
    openFile(file.files[0]);
    file.value = "";
  });
  let depth = 0;
  window.addEventListener("dragenter", (e) => {
    e.preventDefault();
    depth++;
    document.body.classList.add("dragging");
  });
  window.addEventListener("dragleave", () => {
    if (--depth <= 0) { depth = 0; document.body.classList.remove("dragging"); }
  });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    document.body.classList.remove("dragging");
    const f = [...(e.dataTransfer.files || [])].find((x) => x.type.startsWith("image/"));
    if (f) openFile(f);
    else setStatus("画像のファイルをドロップしてください", true);
  });
  window.addEventListener("paste", (e) => {
    if (document.activeElement === $("text")) return;
    const item = [...(e.clipboardData.items || [])].find((x) => x.type.startsWith("image/"));
    if (!item) return;
    e.preventDefault();
    const f = item.getAsFile();
    openFile(new File([f], f.name && f.name !== "image.png" ? f.name : "pasted.png", { type: f.type }));
  });
}

function typing() {
  const t = document.activeElement && document.activeElement.tagName;
  return t === "TEXTAREA" || t === "INPUT" || t === "SELECT";
}

function setupControls() {
  for (const id of RANGES) {
    const el = $(id);
    el.addEventListener("input", () => {
      S.settings[id] = Number(el.value);
      el.nextElementSibling.textContent = Number(el.value).toFixed(2).replace(/0$/, "");
    });
    el.addEventListener("change", requestEdit);
  }
  onSeg("mode", (v) => { S.settings.mode = v; syncControls(); requestEdit(); });
  onSeg("color", (v) => {
    S.settings.color = v || null;
    syncControls();
    if (S.under === "lineart") drawUnder();
    drawLines();
    requestEdit();
  });
  onSeg("fill", (v) => { S.settings.fill = v || null; syncControls(); requestEdit(); });
  onSeg("under", (v) => { S.under = v; setSeg("under", v); drawUnder(); });
  onSeg("zoom", (v) => { S.zoom = v; setSeg("zoom", v); layoutStage(); });
  onSeg("tool", setTool);
  $("underOpacity").addEventListener("input", () => { $("underCanvas").style.opacity = $("underOpacity").value; });
  $("reset").addEventListener("click", () => {
    if (S.base >= 0) {
      S.settings = { ...DEFAULTS, ...S.presets[S.base].settings };
      syncControls();
      requestEdit();
    }
  });
  for (const b of $("steps").querySelectorAll("button")) {
    b.addEventListener("click", () => {
      if (b.dataset.step === "prep") showPrep();
      else if (b.dataset.step === "presets") showPresets();
      else if (b.dataset.step === "scales") showScales();
      else if (S.lines) { show("edit"); drawEditor(); }
    });
  }
  $("smaller").addEventListener("click", () => addScale(-1));
  $("larger").addEventListener("click", () => addScale(1));
  const prev = $("prev");
  const showPrev = (on) => {
    if (!S.dims || !S.lines) return;
    drawAACanvas(on && S.prev ? S.prev : displayed());
    prev.classList.toggle("held", on && !!S.prev);
  };
  prev.addEventListener("pointerdown", () => showPrev(true));
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) prev.addEventListener(ev, () => showPrev(false));
  $("base").addEventListener("change", () => selectBase(Number($("base").value)));
  $("undo").addEventListener("click", undo);
  $("redo").addEventListener("click", redo);
  $("clearAll").addEventListener("click", clearAll);
  $("rowApply").addEventListener("click", applyRow);
  $("rowCancel").addEventListener("click", cancelRow);
  $("rowList").addEventListener("pointerleave", () => {
    if (S.rowSel) { S.rowSel.hover = -1; drawEditor(); }
  });
  window.addEventListener("keydown", (e) => {
    if (S.view === "prep") {
      if (!typing() && e.key === "Enter") { prepGo(); e.preventDefault(); }
      return;
    }
    if (S.view === "presets" || S.view === "scales") {
      if (typing()) return;
      if (e.key === "ArrowRight") { compare.step(1); e.preventDefault(); }
      if (e.key === "ArrowLeft") { compare.step(-1); e.preventDefault(); }
      if (e.key === "Enter") { compare.chooseActive(); e.preventDefault(); }
      if (e.key === "Escape") compare.setPinned(false);
      return;
    }
    if (S.view !== "edit" || typing()) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "z" || k === "y") {
        e.preventDefault();
        if (k === "y" || e.shiftKey) redo();
        else undo();
        return;
      }
    }
    const sel = S.rowSel;
    if (!sel || !sel.options) {
      if (e.key === "Escape") cancelRow();
      return;
    }
    if (e.key === "ArrowDown") { pickRow(sel.pick + 1); e.preventDefault(); }
    if (e.key === "ArrowUp") { pickRow(sel.pick - 1); e.preventDefault(); }
    if (e.key === "Enter") { applyRow(); e.preventDefault(); }
    if (e.key === "Escape") cancelRow();
  });
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    if (S.zoom === "fit") layoutStage();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (S.view === "presets" || S.view === "scales") compare.refresh();
      if (S.rowSel) drawRowPanel();
    }, 150);
  });
}

async function main() {
  setupInput();
  setupPrep();
  setupControls();
  setupPainting();
  setupText();
  setupExport();
  setupDict();
  setTool("none");
  syncControls();
  try {
    engine.setProgressHandler(onEngineProgress);
    if (engine.kind === "local") {
      document.querySelector(".localnote").title = "画像は、このブラウザの中だけで処理します。インターネットには送りません"
        + "（読み込むのはプログラムとモデルだけです）。";
    }
    const [glyphs, presets] = await Promise.all([engine.glyphs(), engine.presets()]);
    S.table = new GlyphTable(glyphs);
    S.renderer = new Renderer(S.table);
    S.presets = presets;
    S.exclude = normalizeExclude(load(EXCLUDE_KEY) || "");
  } catch (e) {
    showError(e);
  }
  updateDictButton();
  await setupFonts();
}

main();
