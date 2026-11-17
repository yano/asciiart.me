// 使う文字の「文字を足す」「辞書を保存」「辞書を読み込む」を確かめる。GPU（WebGPU）を使う。
//   node aaeval/webapp_test/dict_test.mjs <出力フォルダ> <画像（絶対パス）> [--base URL] [--engine local|server] [--addfont saitamaar]
// 1. 文字を打って、足せる文字（形と幅）と足せない文字（辞書にある、MS Pゴシックに無い）の見本を確かめる
// 2. 足して、標準の文字を 1 つ外し、辞書を保存する（中身の文字数・並び・足した文字の形）
// 3. 「この文字で作り直す」→ 画像を入れて候補を作る（足した文字が AA に出るか）。読み込み直しても覚えているか
// 4. 辞書のファイルを読み込む（ファイルに無い文字は外し、無い文字は足す）、足した文字を消す
import { launch } from "./cdp.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const [out, image] = args;
const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const BASE = opt("--base", "http://127.0.0.1:8765/");
const ENGINE = opt("--engine", "local");
const ADDFONT = opt("--addfont", "");
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL0 = `${BASE}?engine=${ENGINE}&lang=ja${ADDFONT ? `&addfont=${ADDFONT}` : ""}`;

const b = await launch({ width: 1600, height: 1000, port: 9383, gpu: true,
  profile: resolve(dirname(resolve(out)), "edge_profile_local") });
const problems = [];
const log = [];
b.on((m) => {
  if (m.method === "Runtime.exceptionThrown") problems.push("exception: " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
});
const expect = (ok, what) => { log.push(`${ok ? "ok" : "NG"}: ${what}`); if (!ok) problems.push(what); };
const HOOKS = `(() => {
  window.__saved = [];
  HTMLAnchorElement.prototype.click = function () {
    const a = this;
    fetch(a.href).then((r) => r.text()).then((text) => window.__saved.push({ name: a.download, text }));
  };
})()`;
const typeAdd = (text) => b.eval(`(() => { const i = document.getElementById("dictAddText"); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event("input")); })()`);
const preview = () => b.eval(`[...document.querySelectorAll("#dictAddPreview .addprev")].map((e) => (e.classList.contains("ng") ? "NG " : "") + e.textContent)`);
const sections = () => b.eval(`[...document.querySelectorAll("#dictBody .dictsec")].map((s) => s.querySelector("b").textContent + " " + s.querySelectorAll(".gcell").length)`);
const parse = (text) => {
  const L = text.split("\r\n");
  const n = Number(L[0]);
  const g = [];
  for (let i = 0, at = 1; i < n; i++, at += 20) g.push({ ch: L[at], w: Number(L[at + 1]), rows: L.slice(at + 2, at + 20) });
  return g;
};
// 縦線の代わりになりそうな、標準の辞書に無い文字（足して、AA に出るかを見る）と、足せない文字
const ADD = "丨亅乚∀冂";
const NG = "T한";

try {
  // 前の試験で覚えた使う文字を消してから始める
  await b.goto(URL0);
  await b.waitFor("document.querySelector('#font option') !== null", 60000);
  await b.eval("localStorage.removeItem('aame.extra'); localStorage.removeItem('aame.exclude')");
  await b.goto(URL0);
  await b.waitFor("document.querySelector('#font option') !== null", 60000);
  await b.eval(HOOKS);
  await b.eval("document.getElementById('dictBtn').click()");
  const ink0 = Number((await b.eval("document.getElementById('dictCount').textContent")).match(/^(\d+)/)[1]);
  log.push(`インクのある標準の文字: ${ink0}`);
  await b.waitFor("/形を描きます/.test(document.getElementById('dictAddMode').textContent) || /足せません/.test(document.getElementById('dictAddMode').textContent)", 60000);
  log.push(`描くフォント: ${await b.eval("document.getElementById('dictAddMode').textContent")}`);
  await typeAdd(ADD + NG);
  const pv = await preview();
  log.push(`見本: ${pv.join(" / ")}`);
  // 足せる文字（MS Pゴシックで描くときは ADD のすべて。Saitamaar で描くときは Saitamaar に無い「乚」を除く）
  const ADDED = [...(ADD + NG)].filter((ch, i) => !pv[i].startsWith("NG")).join("");
  log.push(`足せる文字: ${ADDED}`);
  expect(ADDED === (ADDFONT === "saitamaar" ? ADD.replace("乚", "") : ADD), "足せる文字");
  expect(pv.some((s) => s.includes("辞書にあります")) && pv.some((s) => s.includes("MS Pゴシックに無い")), "足せない文字のわけ");
  await b.shot(join(out, "1_preview.png"));
  await b.eval("document.getElementById('dictAddBtn').click()");
  const sec = await sections();
  log.push(`欄: ${sec.join(" / ")}`);
  expect(sec.includes(`足した文字 ${[...ADDED].length}`), "足した文字の欄");
  // 標準の文字を 1 つ外す（記号の最初のインクのある文字）
  const off = await b.eval(`(() => { const s = [...document.querySelectorAll("#dictBody .dictsec")].find((x) => x.querySelector("b").textContent === "記号"); const c = s.querySelector(".gcell"); c.click(); return c.title[0]; })()`);
  log.push(`外した文字: ${off}`);
  await b.eval("document.getElementById('dictSave').click()");
  await b.waitFor("window.__saved.length === 1", 30000);
  const saved = await b.eval("window.__saved[0]");
  const g = parse(saved.text);
  writeFileSync(join(out, saved.name), saved.text, "utf8");
  log.push(`保存: ${saved.name} ${g.length} 文字、最後の 5 文字 ${g.slice(-5).map((x) => `${x.ch}(${x.w})`).join(" ")}`);
  expect(g.length === 551 - 1 + [...ADDED].length, "保存した文字数 = 551 − 1 + 足した文字");
  expect(g.slice(-[...ADDED].length).map((x) => x.ch).join("") === ADDED, "足した文字が最後に並ぶ");
  expect(!g.some((x) => x.ch === off), "外した文字は書かない");
  await b.shot(join(out, "2_dialog.png"));
  await b.eval("document.getElementById('dictOk').click()");
  await sleep(300);
  const label = await b.eval("document.getElementById('dictBtn').textContent");
  log.push(`ボタン: ${label}`);
  expect(label === `使う文字（+${[...ADDED].length} −1）`, "ボタンの表示");

  // 画像を入れて候補を作る（足した文字が出るか）
  await b.setFile("#file", image);
  await b.waitFor("!document.getElementById('prepView').hidden", 120000);
  await b.eval("document.getElementById('prepSkip').click()");
  await b.waitFor("document.querySelectorAll('.ccard .cwait[hidden]').length === 5", 900000);
  await b.eval("document.querySelectorAll('.ccard .cgo')[2].click()");
  await b.waitFor("document.getElementById('pickTitle').textContent.startsWith('2.')");
  await b.waitFor("document.querySelectorAll('.ccard .cwait[hidden]').length === 6", 900000);
  await b.eval("[...document.querySelectorAll('.ccard')].find(c => c.querySelector('.cname').textContent === '×1.00').querySelector('.cgo').click()");
  await b.waitFor("!document.getElementById('edit').hidden");
  await b.waitFor("document.getElementById('busy').hidden", 300000);
  const text = await b.eval("document.getElementById('text').value");
  writeFileSync(join(out, "aa.txt"), text, "utf8");
  const used = [...ADDED].map((ch) => `${ch}:${[...text].filter((c) => c === ch).length}`);
  log.push(`AA に出た足した文字: ${used.join(" ")}、外した文字 ${off}: ${[...text].filter((c) => c === off).length}`);
  expect([...ADDED].some((ch) => text.includes(ch)), "足した文字が AA に出る");
  expect(!text.includes(off), "外した文字は AA に出ない");
  await b.shot(join(out, "3_edit.png"));

  // 読み込み直しても覚えているか
  await b.goto(URL0);
  await b.waitFor("document.querySelector('#font option') !== null", 60000);
  await b.eval(HOOKS);
  expect((await b.eval("document.getElementById('dictBtn').textContent")) === label, "読み込み直しても覚えている");
  await b.eval("document.getElementById('dictBtn').click()");
  await sleep(300);
  expect((await sections()).includes(`足した文字 ${[...ADDED].length}`), "読み込み直したあとの足した文字の欄");

  // 足した文字を 1 つ消す
  await b.eval(`document.querySelector("#dictBody .gdel").click()`);
  expect((await sections()).includes(`足した文字 ${[...ADDED].length - 1}`), "× で消せる");

  // 辞書のファイルを読み込む: 保存したファイルから 2 文字目の足した文字を除き、「卍」を足し、「|」を外したもの
  const keep = g.filter((x) => x.ch !== [...ADDED][1] && x.ch !== "|");
  const extra = { ch: "卍", w: 16, rows: Array.from({ length: 18 }, (_, y) => (y === 9 ? "1".repeat(16) : "0".repeat(16))) };
  const file = [String(keep.length + 1), ...keep.concat([extra]).flatMap((x) => [x.ch, String(x.w), ...x.rows])].join("\r\n") + "\r\n";
  const path = resolve(out, "upload_dict.txt");
  writeFileSync(path, file, "utf8");
  await b.setFile("#dictFile", path);
  await b.waitFor("/読みました/.test(document.getElementById('dictMsg').textContent)", 30000);
  log.push(`読み込み: ${await b.eval("document.getElementById('dictMsg').textContent")}`);
  const sec2 = await sections();
  log.push(`欄: ${sec2.join(" / ")}`);
  expect(sec2.includes(`足した文字 ${[...ADDED].length}`), "読み込んだ足した文字（4 + 卍）");
  const count = await b.eval("document.getElementById('dictCount').textContent");
  log.push(`文字数: ${count}`);
  expect(count.startsWith(`${ink0 + [...ADDED].length} 文字のうち ${ink0 + [...ADDED].length - 2} 文字を使う`), "外した文字（ファイルに無い 2 文字）");
  await b.shot(join(out, "4_loaded.png"));
  // 壊れたファイル
  writeFileSync(resolve(out, "broken.txt"), "3\r\nあ\r\n", "utf8");
  await b.setFile("#dictFile", resolve(out, "broken.txt"));
  await b.waitFor("/読めませんでした/.test(document.getElementById('dictMsg').textContent)", 30000);
  expect(true, "壊れたファイルは読めないと出る");
} catch (e) {
  problems.push(`FAILED: ${e.message}`);
  try { await b.shot(join(out, "failed.png")); } catch (e2) { /* */ }
} finally {
  await b.close();
}
writeFileSync(join(out, "log.txt"), [...log, "", ...problems].join("\n"), "utf8");
console.log(log.join("\n"));
console.log(problems.length ? problems.join("\n") : "ok");
process.exit(problems.length ? 1 : 0);
