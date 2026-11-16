// 2026-11-15（3回目の感想）の画面: 上の帯（手元で処理する旨、GitHub）、下絵の濃さの初期値、
// 手直し（増やす・減らすを塗り重ねる → すぐ作り直す、1つ戻す・やり直す、手直しを全て取り消す）、
// 行の候補の並び、.html の書き出し（フォントなし・埋め込み）。
// node ui_test5.mjs <出力フォルダ> <画像>
import { launch } from "./cdp.mjs";
import { writeFileSync } from "node:fs";

const [out, image] = process.argv.slice(2);
const URL = "http://127.0.0.1:8765/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await launch({ width: 1600, height: 1000, port: 9351 });
const log = [];
b.on((m) => {
  if (m.method === "Runtime.consoleAPICalled") log.push(`console.${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  if (m.method === "Runtime.exceptionThrown") log.push("exception: " + JSON.stringify(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
});
const status = () => b.eval("document.getElementById('status').textContent");
const rect = (sel, i = 0) => b.eval(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; e.scrollIntoView({ block: "nearest" }); const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()`);
const click = async (x, y) => { await b.mouse("mouseMoved", x, y, 0); await b.mouse("mousePressed", x, y); await b.mouse("mouseReleased", x, y, 0); await sleep(120); };
const key = async (k, code, vk, mods = 0) => {
  const p = { key: k, code, windowsVirtualKeyCode: vk, modifiers: mods };
  await b.send("Input.dispatchKeyEvent", { type: "keyDown", ...p });
  await b.send("Input.dispatchKeyEvent", { type: "keyUp", ...p });
  await sleep(150);
};
// 作り直しが終わるのを待つ（busy が出てから消えるまで）
const settle = async () => {
  await sleep(300);
  await b.waitFor("document.getElementById('busy').hidden", 120000);
};
// 塗りの表示の不透明度（0..255）を画面の座標で読む
const paintAlpha = (x, y) => b.eval(`(() => { const c = document.getElementById('paintCanvas'); const r = c.getBoundingClientRect();
  const px = Math.floor((${x} - r.left) * c.width / r.width), py = Math.floor((${y} - r.top) * c.height / r.height);
  const d = c.getContext('2d').getImageData(px, py, 1, 1).data; return d[3] + (d[2] > d[0] ? ' blue' : d[3] ? ' orange' : ''); })()`);
// 最後に送った render の塗り（灰色の値）を、画面の座標で読む
const sentLevel = (x, y) => b.eval(`(async () => { const s = window.__last && window.__last.paint; if (!s) return 'none';
  const img = new Image(); img.src = s; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0); const p = document.getElementById('paintCanvas').getBoundingClientRect();
  const px = Math.floor((${x} - p.left) * c.width / p.width), py = Math.floor((${y} - p.top) * c.height / p.height);
  const v = ctx.getImageData(px, py, 1, 1).data[0]; return ((v - 128) / 30).toFixed(2); })()`);
const buttons = () => b.eval("['undo', 'redo', 'clearAll'].map(id => id + (document.getElementById(id).disabled ? '(off)' : '')).join(' ')");
const marks = () => b.eval("document.querySelectorAll('#marks .mark').length");
const aaText = () => b.eval("document.getElementById('text').value");

try {
  await b.goto(URL);
  await b.waitFor("document.querySelector('#font option') !== null");
  await sleep(500);
  log.push("localnote: " + await b.eval("document.querySelector('.localnote').innerText.replace(/\\n/g, ' / ')"));
  log.push("github: " + await b.eval("(() => { const a = document.querySelector('a.github'); return a.href + ' svg=' + !!a.querySelector('svg path') + ' text=\"' + a.textContent.trim() + '\"'; })()"));
  log.push("welcome: " + await b.eval("[...document.querySelectorAll('#drop .small')].map(p => p.textContent).join(' | ')"));
  log.push("prepLong max: " + await b.eval("document.getElementById('prepLong').max"));
  await b.shot(`${out}/01_welcome.png`);
  await b.shot(`${out}/01b_header.png`, { x: 0, y: 0, width: 1600, height: 60 });
  // 送ったリクエストを覚える（render の paint を確かめる）
  await b.eval(`(() => { const f = window.fetch; window.__renders = 0; window.fetch = (url, opt) => {
    if (String(url).includes('/render') && opt && opt.body) { window.__last = JSON.parse(opt.body); window.__renders++; }
    return f(url, opt); }; })()`);
  await b.setFile("#file", image);
  await b.waitFor("!document.getElementById('prepView').hidden", 60000);
  await b.eval("document.getElementById('prepSkip').click()");
  await b.waitFor("document.querySelectorAll('.ccard .cwait[hidden]').length === 5", 300000);
  // 標準 → ×1.00
  await b.eval("document.querySelectorAll('.ccard .cgo')[2].click()");
  await b.waitFor("document.getElementById('pickTitle').textContent.startsWith('2.')");
  await b.waitFor("document.querySelectorAll('.ccard .cwait[hidden]').length === 6", 300000);
  await b.eval("[...document.querySelectorAll('.ccard')].find(c => c.querySelector('.cname').textContent === '×1.00').querySelector('.cgo').click()");
  await b.waitFor("!document.getElementById('edit').hidden");
  await sleep(600);
  log.push("underOpacity: " + await b.eval("document.getElementById('underOpacity').value + ' / canvas ' + document.getElementById('underCanvas').style.opacity"));
  log.push("panel: " + await b.eval("[...document.querySelectorAll('#edit .panel section')[1].querySelectorAll('button, input')].filter(e => e.offsetParent).map(e => e.textContent || e.id).join(', ')"));
  log.push("buttons: " + await buttons());
  await b.shot(`${out}/02_edit.png`);

  // 増やす: 顔のあたりを横に塗る
  await b.eval("document.querySelector('#tool button[data-v=more]').click()");
  log.push("paintPanel: " + await b.eval("document.getElementById('paintPanel').hidden ? 'hidden' : document.getElementById('paintPanel').textContent"));
  let [L, T, W, H] = await rect("#aaCanvas");
  const y = T + H * 0.22, xa = L + W * 0.40, xb = L + W * 0.60, xm = L + W * 0.5;
  const line = (x0, x1, yy) => Array.from({ length: 11 }, (_, i) => [x0 + ((x1 - x0) * i) / 10, yy]);
  const brushW = await b.eval("(async () => { const e = new PointerEvent('pointermove', { clientX: " + xm + ", clientY: " + y + ", bubbles: true }); document.getElementById('paintCanvas').dispatchEvent(e); return document.getElementById('brush').style.width; })()");
  log.push(`brush ${brushW} (AA の 1 行 = 18px × 表示の倍率)`);
  const text0 = await aaText();
  let renders = await b.eval("window.__renders");
  await b.drag(line(xa, xb, y));
  log.push(`after more #1: alpha ${await paintAlpha(xm, y)}; edge ${await paintAlpha(xa - 30, y)}; render requested ${await b.eval("window.__renders") > renders}; ${await buttons()}`);
  await settle();
  log.push(`  sent level ${await sentLevel(xm, y)}; status ${await status()}`);
  const text1 = await aaText();
  await b.shot(`${out}/03_more1.png`);
  // 同じ所をもう一度（段階 2）
  await b.drag(line(xa, xb, y));
  await settle();
  const text2 = await aaText();
  log.push(`after more #2: alpha ${await paintAlpha(xm, y)}; sent level ${await sentLevel(xm, y)}`);
  const changed = (a, c) => a.split("\n").filter((s, i) => s !== c.split("\n")[i]).length;
  log.push(`  rows changed: #1 ${changed(text0, text1)}, #2 ${changed(text1, text2)}`);
  // 5 回まで塗る（4 回で止まる）
  for (let k = 0; k < 3; k++) { await b.drag(line(xa, xb, y)); await sleep(200); }
  await settle();
  log.push(`after more x5: alpha ${await paintAlpha(xm, y)}; sent level ${await sentLevel(xm, y)}; status ${await status()}`);
  await b.shot(`${out}/04_more_max.png`);
  // 減らす: 左半分に重ねる
  await b.eval("document.querySelector('#tool button[data-v=less]').click()");
  log.push("paintPanel(less): " + await b.eval("document.getElementById('paintWhat').textContent"));
  const yl = T + H * 0.45;
  await b.drag(line(xa, xb, yl));
  await settle();
  log.push(`after less: alpha ${await paintAlpha(xm, yl)}; sent level ${await sentLevel(xm, yl)}; ${await buttons()}`);
  await b.shot(`${out}/05_less.png`);
  // 1つ戻す・やり直す（ボタンとキー）
  await b.eval("document.getElementById('undo').click()");
  await settle();
  log.push(`undo: less alpha ${await paintAlpha(xm, yl)}; ${await buttons()}; ${await status()}`);
  await b.eval("document.getElementById('redo').click()");
  await settle();
  log.push(`redo: less alpha ${await paintAlpha(xm, yl)}; ${await buttons()}; ${await status()}`);
  await b.eval("document.activeElement && document.activeElement.blur()");
  await key("z", "KeyZ", 90, 2);
  await settle();
  log.push(`Ctrl+Z: less alpha ${await paintAlpha(xm, yl)}; ${await buttons()}`);
  await key("y", "KeyY", 89, 2);
  await settle();
  log.push(`Ctrl+Y: less alpha ${await paintAlpha(xm, yl)}; ${await buttons()}`);

  // 行を直す: 候補の並び
  await b.eval("document.querySelector('#tool button[data-v=row]').click()");
  [L, T, W, H] = await rect("#aaCanvas");
  const z = await b.eval("document.getElementById('aaCanvas').getBoundingClientRect().height / document.getElementById('aaCanvas').height");
  const ry = T + (11 * 18 + 9) * z;
  await click(L + W * 0.5, ry);
  await b.waitFor("document.querySelectorAll('#rowList .ropt').length > 0", 60000);
  log.push("row groups: " + await b.eval("[...document.querySelectorAll('#rowList .rgroup')].map(e => e.textContent).join(' → ')"));
  log.push("row options: " + await b.eval("document.querySelectorAll('#rowList .ropt').length"));
  await b.shot(`${out}/06_row_options.png`);
  // 選んだ行の帯は枠なし、マウスを置いた行は枠つき。選んだ行の上では枠を出さない（2026-11-15、4回目の感想）
  const band = (id) => b.eval(`(() => { const e = document.getElementById('${id}'); return e.hidden ? 'hidden' : getComputedStyle(e).boxShadow; })()`);
  log.push(`bands after pick: pick ${await band("rowPick")}; hover ${await band("rowHover")}`);
  await b.mouse("mouseMoved", L + W * 0.5, ry + 3 * 18 * z, 0);
  await sleep(150);
  log.push(`hover on another row: pick ${await band("rowPick")}; hover ${await band("rowHover")}`);
  await b.shot(`${out}/06b_row_bands.png`, { x: L, y: T + 8 * 18 * z, width: W, height: 8 * 18 * z });
  await b.mouse("mouseMoved", L + W * 0.5, ry, 0);
  await sleep(150);
  log.push(`hover on the picked row: hover ${await band("rowHover")}`);
  [L, T, W, H] = await rect("#rowList .ropt", 2);
  await click(L + W / 2, T + H / 2);
  await key("Enter", "Enter", 13);
  log.push(`row applied: marks ${await marks()}; ${await buttons()}`);

  // 手直しを全て取り消す（確認の文を覚えて「はい」）
  await b.eval("window.__confirm = []; window.confirm = (m) => { window.__confirm.push(m); return true; }");
  await b.eval("document.getElementById('clearAll').click()");
  await settle();
  log.push(`clearAll: confirm "${await b.eval("window.__confirm.join(' | ')")}"; marks ${await marks()}; more alpha ${await paintAlpha(xm, y)}; sent ${await sentLevel(xm, y)}; ${await buttons()}; ${await status()}`);
  await b.shot(`${out}/07_cleared.png`);
  await b.eval("document.getElementById('undo').click()");
  await settle();
  log.push(`undo clearAll: marks ${await marks()}; more alpha ${await paintAlpha(xm, y)}; sent ${await sentLevel(xm, y)}; ${await buttons()}`);
  // 「いいえ」なら何もしない
  await b.eval("window.confirm = (m) => false");
  await b.eval("document.getElementById('clearAll').click()");
  await sleep(300);
  log.push(`clearAll cancelled: marks ${await marks()}; more alpha ${await paintAlpha(xm, y)}`);

  // 書き出す
  log.push("export labels: " + await b.eval("['saveHtml', 'saveHtmlFont'].map(id => document.getElementById(id).textContent).join(' / ') + ' / ' + document.getElementById('htmlNote').textContent"));
  await b.shot(`${out}/08_export_panel.png`);
  await b.eval(`(() => { window.__saved = {}; HTMLAnchorElement.prototype.click = function () { const name = this.download; fetch(this.href).then(r => r.text()).then(t => { window.__saved[name] = t; }); }; })()`);
  await b.eval("document.getElementById('saveHtml').click()");
  const t0 = Date.now();
  await b.eval("document.getElementById('saveHtmlFont').click()");
  await b.waitFor("Object.keys(window.__saved).length === 2", 60000);
  log.push(`font export ${(Date.now() - t0) / 1000}s; status ${await status()}`);
  const saved = JSON.parse(await b.eval("JSON.stringify(window.__saved)"));
  for (const [name, t] of Object.entries(saved)) {
    writeFileSync(`${out}/${name}`, t, "utf-8");
    log.push(`saved ${name}: ${t.length} chars; font-face ${t.includes("@font-face")}; woff2 ${t.includes("data:font/woff2;base64,")}; head ${JSON.stringify(t.slice(0, 160))}`);
  }
} catch (e) {
  log.push("ERROR " + e.stack);
  await b.shot(`${out}/error.png`).catch(() => {});
} finally {
  writeFileSync(`${out}/log.txt`, log.join("\n"), "utf-8");
  await b.close();
}
