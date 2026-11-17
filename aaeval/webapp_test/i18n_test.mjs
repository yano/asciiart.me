// 画面の英語（?lang=en）: 画像を入れて、前処理 → 候補 → 大きさ → 仕上げ → 行の候補 → 塗る・線画 → 使う文字まで進め、
// どの画面にも日本語が残っていないかを確かめる（AA と、言葉を切り替えるボタンの「日本語」は除く）。
// 仕上げの画面で日本語に切り替え、もう一度英語に戻したときも確かめる。GPU（WebGPU）を使う。
// node aaeval/webapp_test/i18n_test.mjs <出力フォルダ> <画像（絶対パス）> [--base http://127.0.0.1:8765/]
import { launch } from "./cdp.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const [out, image] = args;
const BASE = args.includes("--base") ? args[args.indexOf("--base") + 1] : "http://127.0.0.1:8765/";
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 見えている文字と、title などの属性に残っている日本語
const LEFTOVER = `(() => {
  const JP = /[\\u3040-\\u30ff\\u4e00-\\u9fff]/;
  const out = new Set();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const el = n.parentElement;
    if (!JP.test(n.nodeValue) || el.closest("textarea, #langBtn") || !el.getClientRects().length) continue;
    out.add((el.id ? "#" + el.id + " " : "") + n.nodeValue.trim());
  }
  for (const el of document.querySelectorAll("[title], [aria-label]")) {
    if (el.closest(".gcell")) continue;   // 使う文字の升目の title は、その文字
    for (const a of ["title", "aria-label"]) {
      const v = el.getAttribute(a);
      if (v && JP.test(v) && el.id !== "langBtn" && el.id !== "dictBtn") out.add((el.id ? "#" + el.id + " " : "") + a + ": " + v);
    }
  }
  return [...out];
})()`;

const b = await launch({ width: 1600, height: 1000, port: 9375, gpu: true,
  profile: resolve(dirname(resolve(out)), "edge_profile_local") });
const log = [];
const problems = [];
b.on((m) => {
  if (m.method === "Runtime.exceptionThrown") problems.push("exception: " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") problems.push("console.error: " + m.params.args.map((a) => a.value ?? a.description).join(" "));
});

async function check(name) {
  await sleep(300);
  await b.shot(join(out, `${name}.png`));
  const left = await b.eval(LEFTOVER);
  const status = await b.eval("document.getElementById('status').textContent");
  log.push(`${name}: status「${status}」`);
  for (const s of left) problems.push(`${name}: ${s}`);
}

try {
  // 前の試験で覚えた使う文字を消す（使う文字のボタンの title は文字そのものを並べるので、上の確かめから外してある）
  await b.goto(`${BASE}?engine=local&lang=en`);
  await b.waitFor("document.querySelector('#font option') !== null", 60000);
  await b.eval("localStorage.removeItem('aame.extra'); localStorage.removeItem('aame.exclude')");
  await b.goto(`${BASE}?engine=local&lang=en`);
  await b.waitFor("document.querySelector('#font option') !== null", 60000);
  log.push(`lang: ${await b.eval("document.documentElement.lang")}`);
  await check("en_0_welcome");

  await b.setFile("#file", image);
  await b.waitFor("!document.getElementById('prepView').hidden", 120000);
  await b.waitFor("document.getElementById('prepWait').hidden", 300000);
  await check("en_1_prep");
  await b.eval("document.querySelector('#prepShow button[data-v=lineart]').click()");
  await b.waitFor("document.getElementById('prepWait').hidden && /lines/.test(document.getElementById('prepState').textContent)", 300000);
  await check("en_1_prep_lineart");

  await b.eval("document.getElementById('prepGo').click()");
  await b.waitFor("document.querySelectorAll('.ccard .cwait[hidden]').length === 5", 900000);
  await check("en_2_candidates");

  await b.eval("document.querySelectorAll('.ccard .cgo')[1].click()");
  await b.waitFor("document.getElementById('pickTitle').textContent.startsWith('2.')");
  await b.waitFor("document.querySelectorAll('.ccard .cwait[hidden]').length === 6", 900000);
  await check("en_3_scales");

  await b.eval("[...document.querySelectorAll('.ccard')].find(c => c.querySelector('.cname').textContent === '×1.00').querySelector('.cgo').click()");
  await b.waitFor("!document.getElementById('edit').hidden");
  await b.eval("document.getElementById('textBox').open = true");
  await check("en_4_edit");

  await b.eval("document.querySelector('#tool button[data-v=row]').click()");
  const [L, T, W] = await b.eval("(() => { const r = document.getElementById('aaCanvas').getBoundingClientRect(); return [r.left, r.top, r.width]; })()");
  const z = await b.eval("(() => { const c = document.getElementById('aaCanvas'); return c.getBoundingClientRect().width / c.width; })()");
  const y = T + 18 * 12.5 * z;
  await b.mouse("mouseMoved", L + W * 0.5, y, 0);
  await b.mouse("mousePressed", L + W * 0.5, y);
  await b.mouse("mouseReleased", L + W * 0.5, y, 0);
  await b.waitFor("document.querySelectorAll('#rowList .ropt').length > 0", 300000);
  await b.waitFor("document.getElementById('busy').hidden", 300000);
  await check("en_5_row");
  log.push("row options: " + JSON.stringify(await b.eval("[...document.querySelectorAll('#rowList .rlabel, #rowList .rgroup')].map(e => e.textContent)")));

  await b.eval("document.querySelector('#tool button[data-v=more]').click()");
  await check("en_6_paint");
  await b.eval("document.querySelector('#tool button[data-v=draw]').click()");
  await check("en_7_draw");
  await b.eval("document.querySelector('#tool button[data-v=none]').click()");

  await b.eval("document.getElementById('dictBtn').click()");
  await check("en_8_dict");
  await b.eval("document.getElementById('dictDialog').close()");

  // 日本語に切り替えて、また英語に戻す
  await b.eval("document.getElementById('langBtn').click()");
  await sleep(300);
  await b.shot(join(out, "ja_4_edit.png"));
  log.push(`ja: lang=${await b.eval("document.documentElement.lang")}, button=${await b.eval("document.getElementById('langBtn').textContent")}, `
    + `info=${await b.eval("document.getElementById('info').textContent")}, copy=${await b.eval("document.getElementById('copy').textContent")}`);
  await b.eval("document.getElementById('langBtn').click()");
  await check("en_9_edit_again");
  await b.eval("document.querySelector('#steps button[data-step=presets]').click()");
  await check("en_10_candidates_again");
  await b.eval("document.querySelector('#steps button[data-step=prep]').click()");
  await b.waitFor("document.getElementById('prepWait').hidden", 300000);
  await check("en_11_prep_again");
} catch (e) {
  problems.push(`FAILED: ${e.message}`);
  try { await b.shot(join(out, "failed.png")); } catch (e2) { /* */ }
} finally {
  await b.close();
}
writeFileSync(join(out, "log.txt"), [...log, "", ...problems].join("\n"), "utf8");
console.log(log.join("\n"));
console.log(problems.length ? problems.join("\n") : "日本語の残り: なし");
process.exit(problems.length ? 1 : 0);
