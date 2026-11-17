// 画面の言葉（日本語・英語）。日本語の文をそのままキーにして、英語は i18n_en.js の表から引く。
//
//   t(key, params)  画面の文。key は日本語の文で、{name} を params で埋める。英語の表に無ければ日本語のまま
//                   （{n|row|rows} は「数 + 単数形 / 複数形」。日本語の文では使わない）
//   tr(text)        エンジンやサーバーから来た文（候補の名前、行の候補の名前、エラー）。表か、決まった形（EN_PATTERNS）で訳す
//   list(parts)     「A と B」/「A and B」
//   translateDOM()  index.html に書いた日本語（文字と title などの属性）を、いまの言葉にする。
//                   同じ日本語で意味が違うときは、要素に data-i18n="キー" を付けて区別する
//
// 言葉は ?lang=ja|en → このブラウザで選んだもの → ブラウザの言語（ja なら日本語、ほかは英語）の順に決める。

import { EN, EN_ENGINE, EN_PATTERNS } from "./i18n_en.js";

const LANG_KEY = "aame.lang";
export const LANGS = ["ja", "en"];

function stored() {
  try { return localStorage.getItem(LANG_KEY); } catch (e) { return null; }
}

function detect() {
  if (typeof location === "undefined") return "ja";
  const q = new URLSearchParams(location.search).get("lang");
  if (LANGS.includes(q)) return q;
  const s = stored();
  if (LANGS.includes(s)) return s;
  const prefs = (typeof navigator !== "undefined" && (navigator.languages || [navigator.language])) || [];
  return prefs.some((l) => /^ja\b/i.test(l || "")) ? "ja" : "en";
}

export let lang = detect();

function fill(text, params) {
  if (!params) return text;
  return text
    .replace(/\{(\w+)\|([^|}]*)\|([^}]*)\}/g, (m, k, one, many) => `${params[k]} ${Number(params[k]) === 1 ? one : many}`)
    .replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}

export function t(key, params) {
  return fill(lang === "en" && key in EN ? EN[key] : key, params);
}

export function tr(text) {
  if (lang !== "en" || text == null) return text;
  const s = String(text);
  if (s in EN_ENGINE) return EN_ENGINE[s];
  if (s in EN) return EN[s];
  for (const [re, to] of EN_PATTERNS) if (re.test(s)) return s.replace(re, to);
  return s;
}

export function list(parts) {
  if (lang !== "en") return parts.join("と");
  return parts.length <= 2 ? parts.join(" and ") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// ---------- index.html の文 ----------

const ATTRS = ["title", "aria-label", "placeholder", "alt"];
const textJa = new WeakMap();   // 文字のノード → {key, lead, trail}（初めに見たときの日本語）
const attrJa = new WeakMap();   // 要素 → {属性: キー}

export function translateDOM(root = document.body) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement;
    if (!p || p.closest("script, style, textarea, pre")) continue;
    let ja = textJa.get(n);
    if (!ja) {
      const v = n.nodeValue;
      const core = v.trim();
      if (!core) continue;
      const key = p.dataset.i18n && p.childNodes.length === 1 ? p.dataset.i18n : core;
      if (!(key in EN)) continue;
      ja = { key, core, lead: v.slice(0, v.indexOf(core)), trail: v.slice(v.indexOf(core) + core.length) };
      textJa.set(n, ja);
    }
    n.nodeValue = ja.lead + (lang === "en" ? EN[ja.key] : ja.core) + ja.trail;
  }
  for (const el of root.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(","))) {
    let ja = attrJa.get(el);
    if (!ja) {
      ja = {};
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (v && v in EN) ja[a] = v;
      }
      attrJa.set(el, ja);
    }
    for (const [a, key] of Object.entries(ja)) el.setAttribute(a, lang === "en" ? EN[key] : key);
  }
  document.documentElement.lang = lang;
}

// 言葉を切り替える（このブラウザで覚え、URL の ?lang= は外す）
export function setLang(l) {
  if (!LANGS.includes(l)) return;
  lang = l;
  try { localStorage.setItem(LANG_KEY, l); } catch (e) { /* 覚えられなくても動く */ }
  const u = new URL(location.href);
  if (u.searchParams.has("lang")) {
    u.searchParams.delete("lang");
    history.replaceState(null, "", u);
  }
  translateDOM();
}

// index.html の文は、app.js（エンジンを選ぶのを待つ）より先に訳しておく。訳し終えたら見せる（index.html の i18n-wait）
if (typeof document !== "undefined") {
  if (lang !== "ja") translateDOM();
  document.documentElement.classList.remove("i18n-wait");
}
