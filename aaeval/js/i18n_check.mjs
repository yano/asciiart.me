// 画面の英語（webapp/static/i18n_en.js）に、足りない文と使っていない文が無いかを確かめる。
//   node aaeval/js/i18n_check.mjs
//
// 画面の文（index.html、app.js などの日本語の文字列）は、どれも EN のキーでなければならない（t() で訳すので）。
// エンジンの文（aame/*.js の日本語の文字列と、webapp/server.py の HTTPException）は、tr() で訳せなければならない
// （EN_ENGINE か EN のキーか、EN_PATTERNS のどれかに合う。${...} は 1 にして確かめる）。
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { EN, EN_ENGINE, EN_PATTERNS } from "../../webapp/static/i18n_en.js";

const STATIC = "webapp/static";
const UI_FILES = ["app.js", "compare.js", "aa.js", "engine.js", "engine_local.js", "engine_server.js"];
const ENGINE_FILES = readdirSync(join(STATIC, "aame")).filter((f) => f.endsWith(".js")).map((f) => `aame/${f}`);
// 訳さない日本語（フォントの名前、文字の幅を測る字など）
const KEEP = new Set(["ＭＳ Ｐゴシック", "あ", "ミ", "日本語", "Language / 言語"]);
const JP = /[぀-ヿ一-鿿]/;

const read = (f) => readFileSync(join(STATIC, f), "utf8");

// コメントを除いた JS の文字列（"..."、'...'、`...`。${...} は 1 にする）
function literals(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); if (i < 0) break; continue; }
    if (c === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i) + 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      let s = "";
      let j = i + 1;
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\") { s += src[j + 1] === "n" ? "\n" : src[j + 1]; j += 2; continue; }
        if (c === "`" && src[j] === "$" && src[j + 1] === "{") {
          let depth = 1;
          j += 2;
          while (depth && j < src.length) { if (src[j] === "{") depth++; else if (src[j] === "}") depth--; j++; }
          s += "1";
          continue;
        }
        s += src[j++];
      }
      out.push({ s, template: c === "`" });
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}

// HTML の文字と属性（index.html と compare.js の部品の HTML）
function htmlTexts(html) {
  const out = [];
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, "");
  for (const m of body.matchAll(/>([^<]+)</g)) {
    const s = m[1].trim();
    if (s && JP.test(s)) out.push(s);
  }
  for (const m of body.matchAll(/\s(?:title|aria-label|placeholder|alt|data-i18n)="([^"]*)"/g)) if (JP.test(m[1])) out.push(m[1]);
  return out;
}

const translatable = (s) => s in EN_ENGINE || s in EN || EN_PATTERNS.some(([re]) => re.test(s));
const problems = [];
const used = new Set();

for (const s of htmlTexts(read("index.html"))) {
  used.add(s);
  if (!(s in EN) && !KEEP.has(s)) problems.push(`index.html: 英語がありません: ${s}`);
}
for (const f of UI_FILES) {
  const src = read(f);
  const html = src.match(/innerHTML = `([\s\S]*?)`;/);
  if (html) for (const s of htmlTexts(html[1])) { used.add(s); if (!(s in EN)) problems.push(`${f}: 英語がありません: ${s}`); }
  for (const { s, template } of literals(src)) {
    if (!JP.test(s) || KEEP.has(s) || s.includes("<") || s.includes("ＭＳ Ｐゴシック")) continue;
    used.add(s);
    if (template) problems.push(`${f}: 訳さない文（\`...\`）: ${s}`);
    else if (!(s in EN) && !(s in EN_ENGINE)) problems.push(`${f}: 英語がありません: ${s}`);
  }
}
for (const f of ENGINE_FILES) {
  for (const { s } of literals(read(f))) {
    if (!JP.test(s) || KEEP.has(s)) continue;
    used.add(s);
    if (!translatable(s)) problems.push(`${f}: tr() で訳せません: ${s}`);
  }
}
const server = readFileSync("webapp/server.py", "utf8");
for (const m of server.matchAll(/HTTPException\(\d+, f?"([^"]*)"(?:\s*"([^"]*)")?/g)) {
  const s = (m[1] + (m[2] || "")).replace(/\{[^}]*\}/g, "1");
  if (!translatable(s)) problems.push(`webapp/server.py: tr() で訳せません: ${s}`);
}
for (const k of Object.keys(EN)) if (!used.has(k)) problems.push(`i18n_en.js: 使っていない文: ${k}`);

console.log(`EN ${Object.keys(EN).length}、EN_ENGINE ${Object.keys(EN_ENGINE).length}、EN_PATTERNS ${EN_PATTERNS.length}`);
if (problems.length) {
  console.log(problems.join("\n"));
  process.exit(1);
}
console.log("ok");
