// 候補 → 大きさ → 仕上げ（表示フォント、行を直す、テキストで直す、1つ戻す）を動かして、画面の写真を撮る。
// node ui_test3.mjs <出力フォルダ> <画像>
import { launch } from "./cdp.mjs";
import { writeFileSync } from "node:fs";

const [out, image] = process.argv.slice(2);
const URL = "http://127.0.0.1:8765/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await launch({ width: 1600, height: 1000, port: 9341 });
const log = [];
b.on((m) => {
  if (m.method === "Runtime.consoleAPICalled") log.push(`console.${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  if (m.method === "Runtime.exceptionThrown") log.push("exception: " + JSON.stringify(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
});
const status = () => b.eval("document.getElementById('status').textContent");
const rect = (sel, i = 0) => b.eval(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; e.scrollIntoView({ block: "nearest" }); const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()`);
const move = async (x, y) => { await b.mouse("mouseMoved", x, y, 0); await sleep(80); };
const click = async (x, y) => { await b.mouse("mouseMoved", x, y, 0); await b.mouse("mousePressed", x, y); await b.mouse("mouseReleased", x, y, 0); await sleep(120); };
const CODES = { ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight", Enter: "Enter", z: "KeyZ" };
const key = async (k, vk) => {
  const p = { key: k, code: CODES[k] || k, windowsVirtualKeyCode: vk };
  await b.send("Input.dispatchKeyEvent", { type: "keyDown", ...p, ...(k === "Enter" ? { text: String.fromCharCode(13) } : {}) });
  await b.send("Input.dispatchKeyEvent", { type: "keyUp", ...p });
  await sleep(150);
};
try {
  await b.goto(URL);
  await b.waitFor("document.querySelector('#font option') !== null");
  log.push("fonts: " + await b.eval("[...document.querySelectorAll('#font option')].map(o => o.textContent).join(', ')"));
  let t0 = Date.now();
  await b.setFile("#file", image);
  // 0 前処理は飛ばす（前処理の画面は ui_test4.mjs で試す）
  await b.waitFor("!document.getElementById('prepView').hidden", 60000);
  await b.eval("document.getElementById('prepSkip').click()");
  await b.waitFor("document.querySelectorAll('.ccard').length === 5", 120000);
  await b.waitFor("document.querySelectorAll('.ccard .cwait[hidden]').length === 5", 300000);
  log.push(`1. presets ready: ${(Date.now() - t0) / 1000}s; names: ` + await b.eval("[...document.querySelectorAll('.ccard .cname')].map(e => e.textContent).join(' / ')"));
  log.push("status: " + await status());
  // 2枚目の候補（標準）の図の顔のあたりにマウスを置く
  let [L, T, W, H] = await rect(".ccard .cthumb", 2);
  await move(L + W * 0.5, T + H * 0.3);
  log.push("loupe name after hover card2: " + await b.eval("document.querySelector('.lname').textContent"));
  await b.shot(`${out}/01_presets_hover.png`);
  // 押して位置を止め、4枚目（色の境界 + 黒い面）に移る
  await click(L + W * 0.5, T + H * 0.3);
  log.push("pinned: " + await b.eval("!document.querySelector('.lpin').hidden"));
  const v1 = await b.eval("document.querySelectorAll('.cview')[2].style.cssText");
  [L, T, W, H] = await rect(".ccard .cthumb", 4);
  await move(L + W * 0.1, T + H * 0.6);
  const v2 = await b.eval("document.querySelectorAll('.cview')[4].style.cssText");
  log.push(`view rect kept while pinned: ${v1 === v2} (${v1})`);
  log.push("loupe name after hover card4: " + await b.eval("document.querySelector('.lname').textContent"));
  await b.shot(`${out}/02_presets_pinned_card4.png`);
  await key("ArrowLeft", 37);
  log.push("after ArrowLeft: " + await b.eval("document.querySelector('.lname').textContent"));
  // 「色の境界」（3枚目 = p2）を選ぶ
  t0 = Date.now();
  await b.eval("document.querySelectorAll('.ccard .cgo')[3].click()");
  await b.waitFor("document.getElementById('pickTitle').textContent.startsWith('2.')");
  await b.waitFor("document.querySelectorAll('.ccard').length === 6");
  await b.shot(`${out}/03_scales_start.png`);
  await b.waitFor("document.querySelectorAll('.ccard .cwait[hidden]').length === 6", 300000);
  log.push(`2. scales ready: ${(Date.now() - t0) / 1000}s; ` + await b.eval("[...document.querySelectorAll('.ccard')].map(c => c.querySelector('.cname').textContent + ' ' + c.querySelector('.cnote').textContent).join(' | ')"));
  [L, T, W, H] = await rect(".ccard .cthumb", 4);
  await click(L + W * 0.45, T + H * 0.25);
  await b.shot(`${out}/04_scales_pinned.png`);
  t0 = Date.now();
  await b.eval("document.getElementById('larger').click()");
  await b.waitFor("document.querySelectorAll('.ccard').length === 7");
  await b.waitFor("document.querySelectorAll('.ccard .cwait[hidden]').length === 7", 300000);
  log.push(`larger: ${(Date.now() - t0) / 1000}s; last: ` + await b.eval("document.querySelectorAll('.ccard .cname')[6].textContent"));
  // ×1.05 を選ぶ
  await b.eval("[...document.querySelectorAll('.ccard')].find(c => c.querySelector('.cname').textContent === '×1.05').querySelector('.cgo').click()");
  await b.waitFor("!document.getElementById('edit').hidden");
  await sleep(800);
  log.push("3. edit: " + await b.eval("document.getElementById('info').textContent + ' / ' + document.getElementById('scaleInfo').textContent"));
  await b.shot(`${out}/05_edit.png`);
  // 表示フォント
  for (const id of ["saitamaar", "textar", "monapo"]) {
    await b.eval(`(() => { const s = document.getElementById('font'); s.value = '${id}'; s.dispatchEvent(new Event('change')); })()`);
    await b.waitFor(`document.getElementById('status').textContent.includes('表示フォント')`, 30000);
    await sleep(400);
    log.push(`font ${id}: ` + await status());
    await b.shot(`${out}/06_font_${id}.png`);
    await b.eval("document.getElementById('status').textContent = ''");
  }
  await b.eval("(() => { const s = document.getElementById('font'); s.value = 'mspgothic'; s.dispatchEvent(new Event('change')); })()");
  await sleep(500);
  // 行を直す: 12 行目あたりを押す
  await b.eval("document.querySelector('#tool button[data-v=row]').click()");
  [L, T, W, H] = await rect("#aaCanvas");
  const z = await b.eval("document.getElementById('aaCanvas').getBoundingClientRect().height / document.getElementById('aaCanvas').height");
  const y = T + (11 * 18 + 9) * z;
  await move(L + W * 0.5, y);
  t0 = Date.now();
  await click(L + W * 0.5, y);
  await b.waitFor("document.querySelectorAll('#rowList .ropt').length > 0", 60000);
  log.push(`row options: ${(Date.now() - t0) / 1000}s; ` + await b.eval("document.getElementById('rowTitle').textContent + ': ' + [...document.querySelectorAll('#rowList .rlabel')].map(e => e.textContent).join(', ')"));
  await b.shot(`${out}/07_row_options.png`);
  // 候補にマウスを置くと差し替えて見せる
  const before = await b.eval("document.getElementById('aaCanvas').toDataURL()");
  [L, T, W, H] = await rect("#rowList .ropt", 3);
  await move(L + W / 2, T + H / 2);
  const during = await b.eval("document.getElementById('aaCanvas').toDataURL()");
  log.push(`hover preview changes canvas: ${before !== during}`);
  await b.shot(`${out}/08_row_hover.png`);
  await click(L + W / 2, T + H / 2);
  await key("Enter", 13);
  log.push("after Enter: fixed marks " + await b.eval("document.querySelectorAll('#marks .mark').length") + "; " + await status());
  await b.shot(`${out}/09_row_applied.png`);
  // テキストで直す: 1 行目に文字を足す
  await b.eval("document.getElementById('textBox').open = true");
  await b.eval(`(() => { const t = document.getElementById('text'); t.focus(); const lines = t.value.split('\\n'); lines[0] = lines[0] + '（´・ω・｀）'; t.value = lines.join('\\n'); t.setSelectionRange(lines[0].length, lines[0].length); t.dispatchEvent(new Event('input')); })()`);
  await sleep(500);
  log.push("text info: " + await b.eval("document.getElementById('textInfo').textContent"));
  await b.eval("document.getElementById('text').blur()");
  await sleep(300);
  log.push("after text edit: fixed marks " + await b.eval("document.querySelectorAll('#marks .mark').length"));
  await b.shot(`${out}/10_text_edit.png`);
  // 設定を変えて作り直しても、直した行は残る
  t0 = Date.now();
  await b.eval("(() => { const el = document.getElementById('lam'); el.value = 2.6; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); })()");
  await sleep(300);
  await b.waitFor("document.getElementById('busy').hidden", 60000);
  log.push(`rerender ${(Date.now() - t0) / 1000}s; fixed marks ` + await b.eval("document.querySelectorAll('#marks .mark').length") + "; " + await status());
  // 1つ戻す（テキストの直し → 行の直し）
  await key("z", 90).catch(() => {});
  await b.eval("document.getElementById('undo').click()");
  log.push("after undo: fixed marks " + await b.eval("document.querySelectorAll('#marks .mark').length"));
  await b.eval("document.getElementById('undo').click()");
  log.push("after undo2: fixed marks " + await b.eval("document.querySelectorAll('#marks .mark').length"));
  await b.shot(`${out}/11_after_undo.png`);
  // テキストで1行直して書き出す（.html と .txt に直した行が入るか）
  await b.eval(`(() => { const t = document.getElementById('text'); t.focus(); const lines = t.value.split('\\n'); lines[2] = 'テスト（´・ω・｀）'; t.value = lines.join('\\n'); t.dispatchEvent(new Event('input')); t.blur(); })()`);
  await sleep(400);
  await b.eval(`(() => { window.__saved = {}; HTMLAnchorElement.prototype.click = function () { const name = this.download; fetch(this.href).then(r => r.text()).then(t => { window.__saved[name] = t; }); }; })()`);
  await b.eval("document.getElementById('saveHtml').click()");
  await b.eval("document.getElementById('saveTxt').click()");
  await sleep(800);
  const saved = await b.eval("JSON.stringify(Object.fromEntries(Object.entries(window.__saved).map(([k, v]) => [k, [v.length, v.includes('テスト（´・ω・｀）<br>'), v.split('\\n')[2]]])))");
  log.push("export: " + saved);
  // 手順の帯で 1. に戻る
  await b.eval("document.querySelector('#steps button[data-step=presets]').click()");
  await sleep(500);
  await b.shot(`${out}/12_back_presets.png`);
  log.push("steps: " + await b.eval("[...document.querySelectorAll('#steps button')].map(x => x.textContent + (x.disabled ? '(off)' : '') + (x.classList.contains('current') ? '*' : '')).join(' ')"));
} catch (e) {
  log.push("ERROR " + e.stack);
  await b.shot(`${out}/error.png`).catch(() => {});
} finally {
  writeFileSync(`${out}/log.txt`, log.join("\n"), "utf-8");
  await b.close();
}
