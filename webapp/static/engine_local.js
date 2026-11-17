// ブラウザの中で動くエンジン（段階3）。仕事は Worker（aame/worker.js）でする。画面は engine.js を通して使う。
// 関数の形はサーバーのエンジン（engine_server.js）と同じ。画像の URL を返す関数は Promise を返す。

import { t } from "./i18n.js";

export const kind = "local";

const worker = new Worker(new URL("./aame/worker.js", import.meta.url), { type: "module" });
// ?cpu=1 で、GPU があっても CPU で動かす（試験用）
worker.postMessage({ config: { cpu: new URLSearchParams(location.search).get("cpu") === "1" } });
const waiting = new Map();
let seq = 0;
let onProgress = null;

worker.onmessage = (ev) => {
  const m = ev.data;
  if (m.progress) {
    onProgress?.(m.progress);
    return;
  }
  const p = waiting.get(m.id);
  if (!p) return;
  waiting.delete(m.id);
  if (m.ok) p.resolve(m.result);
  else p.reject(new Error(m.error));
};
worker.onerror = (ev) => {
  const err = new Error(t("エンジンを動かせませんでした（{msg}）", { msg: ev.message || t("Worker のエラー") }));
  for (const p of waiting.values()) p.reject(err);
  waiting.clear();
};

function call(method, ...args) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    worker.postMessage({ id, method, args });
  });
}

// 途中経過を知らせる先。fn({kind: "download", name, received, total} | {kind: "init", name} | {kind: "device", device})
export function setProgressHandler(fn) {
  onProgress = fn;
}

export async function glyphs() {
  const res = await fetch("glyphs.json");
  if (!res.ok) throw new Error(t("文字の表を読めませんでした"));
  return res.json();
}

export const presets = () => call("presets");
export const open = (file) => call("open", file);
export const prepare = (id, prep) => call("prepare", id, prep);
export const render = (id, settings, paint = null, scale = 1, edit = null) => call("render", id, settings, paint, scale, edit);
export const rowOptions = (id, row, settings, paint = null, scale = 1, current = null, edit = null) =>
  call("rowOptions", id, row, settings, paint, scale, current, edit);

// .html に埋め込むフォント。いまはフォントを丸ごと返す（文字を抜き出すのはサーバーの fontTools。ブラウザ版はあとで）
export async function fontSubset(fontId) {
  const res = await fetch("fonts.json");
  const info = (await res.json()).fonts.find((f) => f.id === fontId && f.file);
  if (!info) throw new Error(t("そのフォントは埋め込めません"));
  const font = await fetch(info.file);
  if (!font.ok) throw new Error(t("フォント「{label}」のファイルがありません", { label: info.label }));
  return font.blob();
}

// 画像（PNG の Blob）の URL。同じものは覚えておき、古いものから捨てる
const urls = new Map();
async function blobURL(key, method, ...args) {
  let u = urls.get(key);
  if (!u) {
    u = URL.createObjectURL(await call(method, ...args));
    urls.set(key, u);
    while (urls.size > 24) {
      const [k, v] = urls.entries().next().value;
      URL.revokeObjectURL(v);
      urls.delete(k);
    }
  }
  return u;
}

export const lineartURL = (id, color, scale = 1) => blobURL(`l|${id}|${color}|${scale}`, "lineart", id, color, scale);
export const originalURL = (id) => blobURL(`o|${id}`, "original", id);
export const sourceURL = (id, scale = 1) => blobURL(`s|${id}|${scale}`, "source", id, scale);
