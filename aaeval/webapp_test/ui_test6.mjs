// 2026-11-15（手順6の残り）の画面: 線画の手直し（線を消す・線を描き足す・点）と、使う文字（辞書から外す文字）。
// node ui_test6.mjs <出力フォルダ> <画像（絶対パス）>
import { launch } from "./cdp.mjs";
import { writeFileSync } from "node:fs";

const [out, image] = process.argv.slice(2);
const URL = "http://127.0.0.1:8765/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await launch({ width: 1600, height: 1000, port: 9361 });
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
const settle = async () => {
  await sleep(300);
  await b.waitFor("document.getElementById('busy').hidden", 120000);
};
const buttons = () => b.eval("['undo', 'redo', 'clearAll'].map(id => id + (document.getElementById(id).disabled ? '(off)' : '')).join(' ')");
const aaText = () => b.eval("document.getElementById('text').value");
// 画面の座標の箱 → AA の canvas の画素の箱
const toAA = (box) => b.eval(`(() => { const c = document.getElementById('aaCanvas'); const r = c.getBoundingClientRect();
  const k = c.width / r.width; const [x0, y0, x1, y1] = ${JSON.stringify(box)};
  return [Math.floor((x0 - r.left) * k), Math.floor((y0 - r.top) * k), Math.ceil((x1 - r.left) * k), Math.ceil((y1 - r.top) * k)]; })()`);
// canvas の箱の中で、条件に合う画素の数
const countIn = (id, box, cond) => b.eval(`(() => { const c = document.getElementById('${id}'); const [x0, y0, x1, y1] = ${JSON.stringify(box)};
  const w = x1 - x0, h = y1 - y0; if (c.hidden || w <= 0 || h <= 0) return 'hidden'; const d = c.getContext('2d').getImageData(x0, y0, w, h).data; let n = 0;
  for (let i = 0; i < d.length; i += 4) { const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3]; if (${cond}) n++; } return n; })()`);
const RED = "a > 200 && r > 150 && g < 100";
const GREEN = "a > 200 && g > 120 && r < 60";
const GRAY = "a > 0 && a < 200";
const INK = "a > 0";
// 最後に送った線画の直し（赤 = 描いた線、緑 = 消した所）の画素の数と大きさ
const sentEdit = (which = "__last") => b.eval(`(async () => { const s = window.${which} && window.${which}.edit; if (!s) return 'none';
  const img = new Image(); img.src = s; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0); const d = ctx.getImageData(0, 0, c.width, c.height).data; let add = 0, erase = 0;
  for (let i = 0; i < d.length; i += 4) { if (d[i] > 127) add++; if (d[i + 1] > 127) erase++; }
  return c.width + 'x' + c.height + ' add ' + add + ' erase ' + erase; })()`);
const used = (text, chars) => [...new Set([...text].filter((ch) => chars.includes(ch)))].join("");

try {
  await b.goto(URL);
  await b.waitFor("document.querySelector('#font option') !== null");
  await sleep(500);
  await b.eval("localStorage.removeItem('aame.exclude')");
  await b.goto(URL);
  await b.waitFor("document.querySelector('#font option') !== null");
  await sleep(500);
  log.push("dictBtn: " + await b.eval("document.getElementById('dictBtn').textContent"));
  // 送ったリクエストを覚える
  await b.eval(`(() => { const f = window.fetch; window.__renders = []; window.fetch = (url, opt) => {
    if (opt && opt.body && typeof opt.body === 'string') {
      const body = JSON.parse(opt.body);
      if (String(url).includes('/render')) { window.__last = body; window.__renders.push(body); }
      if (String(url).includes('/rows/')) window.__lastRow = body;
    }
    return f(url, opt); }; })()`);
  await b.setFile("#file", image);
  await b.waitFor("!document.getElementById('prepView').hidden", 60000);
  await b.eval("document.getElementById('prepSkip').click()");
  await b.waitFor("document.querySelectorAll('.ccard .cwait[hidden]').length === 5", 300000);
  await b.eval("document.querySelectorAll('.ccard .cgo')[2].click()");
  await b.waitFor("document.getElementById('pickTitle').textContent.startsWith('2.')");
  await b.waitFor("document.querySelectorAll('.ccard .cwait[hidden]').length === 6", 300000);
  await b.eval("[...document.querySelectorAll('.ccard')].find(c => c.querySelector('.cname').textContent === '×1.00').querySelector('.cgo').click()");
  await b.waitFor("!document.getElementById('edit').hidden");
  await sleep(600);
  log.push("tools: " + await b.eval("[...document.querySelectorAll('#tool .toolrow')].map(r => r.innerText.replace(/\\s+/g, ' ').trim()).join(' | ')"));
  await b.shot(`${out}/01_edit.png`);
  const [px, py, pw] = await rect("#edit .panel");
  await b.shot(`${out}/01b_panel.png`, { x: px, y: py, width: pw, height: 560 });

  // ---------- 線を消す ----------
  await b.eval("document.querySelector('#tool button[data-v=erase]').click()");
  await b.waitFor("!document.getElementById('lineCanvas').hidden", 30000);
  log.push("linePanel(erase): " + await b.eval("document.getElementById('linePanel').textContent"));
  let [L, T, W, H] = await rect("#aaCanvas");
  const z = await b.eval("document.getElementById('aaCanvas').getBoundingClientRect().width / document.getElementById('aaCanvas').width");
  const brushW = await b.eval("(() => { const e = new PointerEvent('pointermove', { clientX: " + (L + W / 2) + ", clientY: " + (T + H / 2) + ", bubbles: true }); document.getElementById('paintCanvas').dispatchEvent(e); return document.getElementById('brush').style.width; })()");
  log.push(`eraser ${brushW} (AA の 1 行の半分 × 表示の倍率 ${z.toFixed(3)})`);
  // 2 行ぶんの箱を、横に何度もなぞって消す
  const ex0 = L + W * 0.35, ex1 = L + W * 0.65, ey0 = T + H * 0.40;
  const eraseBox = [ex0, ey0, ex1, ey0 + 36 * z];
  const boxAA = await toAA(eraseBox);
  const inner = [boxAA[0] + 6, boxAA[1] + 5, boxAA[2] - 6, boxAA[3] - 5];   // 端はブラシの丸みで残るので内側で数える
  const lineRed0 = await countIn("lineCanvas", inner, RED);
  const ink0 = await countIn("aaCanvas", inner, INK);
  const text0 = await aaText();
  const passes = [];
  for (let yy = ey0 + 2 * z; yy <= ey0 + 36 * z; yy += 3 * z) passes.push([ex0, yy], [ex1, yy]);
  const zig = [];
  for (let i = 0; i < passes.length; i += 2) {
    const [a, c] = (i / 2) % 2 ? [passes[i + 1], passes[i]] : [passes[i], passes[i + 1]];
    for (let k = 0; k <= 8; k++) zig.push([a[0] + ((c[0] - a[0]) * k) / 8, a[1]]);
  }
  let n0 = await b.eval("window.__renders.length");
  await b.drag(zig);
  log.push(`erase: render requested ${await b.eval("window.__renders.length") > n0}; ${await buttons()}`);
  await settle();
  const text1 = await aaText();
  const changed = (a, c) => a.split("\n").filter((s, i) => s !== c.split("\n")[i]).length;
  log.push(`  sent edit ${await sentEdit()}; status ${await status()}`);
  log.push(`  lineCanvas red in box ${lineRed0} -> ${await countIn("lineCanvas", inner, RED)}, gray ${await countIn("lineCanvas", inner, GRAY)}`);
  log.push(`  AA ink px in box ${ink0} -> ${await countIn("aaCanvas", inner, INK)}; rows changed ${changed(text0, text1)}`);
  await b.shot(`${out}/02_erased.png`);

  // ---------- 線を描き足す（線と点）----------
  await b.eval("document.querySelector('#tool button[data-v=draw]').click()");
  log.push("linePanel(draw): " + await b.eval("document.getElementById('lineWhat').textContent"));
  log.push("cursor: " + await b.eval("getComputedStyle(document.getElementById('paintCanvas')).cursor") + "; brush hidden " + await b.eval("document.getElementById('brush').hidden"));
  const dx0 = L + W * 0.08, dx1 = L + W * 0.30, dy0 = T + H * 0.93, dy1 = T + H * 0.80;
  const drawBox = await toAA([dx0 - 4, dy1 - 4, dx1 + 4, dy0 + 4]);
  const inkD0 = await countIn("aaCanvas", drawBox, INK);
  const pts = Array.from({ length: 21 }, (_, i) => [dx0 + ((dx1 - dx0) * i) / 20, dy0 + ((dy1 - dy0) * i) / 20]);
  await b.drag(pts);
  await settle();
  log.push(`draw: sent edit ${await sentEdit()}; green in lineCanvas ${await countIn("lineCanvas", drawBox, GREEN)}; AA ink px ${inkD0} -> ${await countIn("aaCanvas", drawBox, INK)}`);
  const text2 = await aaText();
  // 点（押すだけ）
  await click(L + W * 0.5, T + H * 0.86);
  await settle();
  log.push(`dot: sent edit ${await sentEdit()}; rows changed ${changed(text2, await aaText())}; ${await buttons()}`);
  await b.eval("document.querySelector('#zoom button[data-v=\"1\"]').click()");
  await sleep(300);
  await b.eval("(() => { const w = document.getElementById('stageWrap'); w.scrollTop = w.scrollHeight; })()");
  await sleep(200);
  await b.shot(`${out}/03_drawn_1x.png`);
  await b.eval("document.querySelector('#zoom button[data-v=fit]').click()");
  await sleep(300);

  // ---------- 1つ戻す・やり直す ----------
  await b.eval("document.activeElement && document.activeElement.blur()");
  await key("z", "KeyZ", 90, 2);
  await settle();
  log.push(`Ctrl+Z: sent edit ${await sentEdit()}; ${await buttons()}`);
  await key("y", "KeyY", 89, 2);
  await settle();
  log.push(`Ctrl+Y: sent edit ${await sentEdit()}; ${await buttons()}`);

  // ---------- 下絵の線画にも直しが出る ----------
  await b.eval("document.querySelector('#under button[data-v=lineart]').click()");
  await sleep(1500);
  log.push(`under lineart: ink in erased box ${await countIn("underCanvas", inner, INK)}; ink on drawn line ${await countIn("underCanvas", drawBox, INK)}`);
  await b.eval("document.querySelector('#under button[data-v=source]').click()");

  // ---------- 行の候補にも直しを渡す ----------
  await b.eval("document.querySelector('#tool button[data-v=row]').click()");
  log.push("lineCanvas hidden with row tool: " + await b.eval("document.getElementById('lineCanvas').hidden"));
  await click(L + W * 0.5, ey0 + 9 * z);
  await b.waitFor("document.querySelectorAll('#rowList .ropt').length > 0", 60000);
  log.push(`row options: ${await b.eval("document.querySelectorAll('#rowList .ropt').length")}; sent edit ${await sentEdit("__lastRow")}`);
  await b.eval("document.getElementById('rowCancel').click()");

  // ---------- 手直しを全て取り消す ----------
  await b.eval("window.__confirm = []; window.confirm = (m) => { window.__confirm.push(m); return true; }");
  await b.eval("document.getElementById('clearAll').click()");
  await settle();
  log.push(`clearAll: confirm "${await b.eval("window.__confirm.join(' | ')")}"; sent edit ${await sentEdit()}; ${await buttons()}`);
  await b.eval("document.getElementById('undo').click()");
  await settle();
  log.push(`undo clearAll: sent edit ${await sentEdit()}; ${await buttons()}`);

  // ---------- 別の大きさにしても、線画の直しは残る ----------
  await b.eval("document.querySelector('#steps button[data-step=scales]').click()");
  await b.waitFor("document.querySelectorAll('.ccard .cwait[hidden]').length === 6", 300000);
  await b.eval("[...document.querySelectorAll('.ccard')].find(c => c.querySelector('.cname').textContent === '×1.10').querySelector('.cgo').click()");
  await b.waitFor("!document.getElementById('edit').hidden");
  await settle();
  log.push(`scale x1.10: sent scale ${await b.eval("window.__last.scale")}; sent edit ${await sentEdit()}; AA ${await b.eval("document.getElementById('aaCanvas').width + 'x' + document.getElementById('aaCanvas').height")}`);

  // ---------- 使う文字 ----------
  const before = await aaText();
  await b.eval("document.getElementById('dictBtn').click()");
  await b.waitFor("document.getElementById('dictDialog').open");
  await sleep(300);
  log.push("dict sections: " + await b.eval("[...document.querySelectorAll('#dictBody .dicthead2')].map(h => h.innerText.replace(/\\s+/g, ' ').trim()).join(' | ')"));
  log.push("dict count: " + await b.eval("document.getElementById('dictCount').textContent") + "; ok disabled " + await b.eval("document.getElementById('dictOk').disabled"));
  await b.shot(`${out}/04_dict.png`);
  // 英数字をすべて外し、この AA でいちばん多く使っている（インクのある）文字も外す
  await b.eval("(() => { const sec = [...document.querySelectorAll('#dictBody .dictsec')].find(s => s.querySelector('b').textContent === '英数字'); sec.querySelector('.dicthead2 button').click(); })()");
  const top = await b.eval("document.querySelector('#dictBody .dictsec .gcell').title.slice(0, 1)");
  await b.eval("document.querySelector('#dictBody .dictsec .gcell').click()");
  log.push(`dict after toggles: ${await b.eval("document.getElementById('dictCount').textContent")}; top char ${top}; off cells ${await b.eval("document.querySelectorAll('#dictBody .gcell.off').length")}`);
  await b.shot(`${out}/05_dict_off.png`);
  n0 = await b.eval("window.__renders.length");
  await b.eval("document.getElementById('dictOk').click()");
  await sleep(300);
  await settle();
  const sent = await b.eval("window.__last.exclude");
  const after = await aaText();
  log.push(`dict applied: btn "${await b.eval("document.getElementById('dictBtn').textContent")}"; sent exclude ${[...sent].length} chars (has top ${sent.includes(top)}); stored ${await b.eval("(localStorage.getItem('aame.exclude') || '').length")}`);
  log.push(`  excluded chars in AA: before "${used(before, sent)}" -> after "${used(after, sent)}"; rows changed ${changed(before, after)}; status ${await status()}`);
  await b.shot(`${out}/06_dict_applied.png`);
  // 行の候補にも効く
  await click(L + W * 0.5, T + H * 0.3);
  await b.waitFor("document.querySelectorAll('#rowList .ropt').length > 0", 60000);
  const optLines = await b.eval("JSON.stringify([...document.querySelectorAll('#rowList .ropt')].length)");
  log.push(`row options with exclude: ${optLines}; sent exclude ${[...(await b.eval("window.__lastRow.exclude"))].length} chars`);
  await b.eval("document.getElementById('rowCancel').click()");
  // 1 の候補は作り直す（外した文字で）
  await b.eval("document.querySelector('#steps button[data-step=presets]').click()");
  await sleep(500);
  log.push("presets after dict change: " + await b.eval("document.querySelectorAll('.ccard .cwait[hidden]').length") + " ready (src included)");
  await b.waitFor("document.querySelectorAll('.ccard .cwait[hidden]').length === 5", 300000);
  const presetSent = await b.eval("window.__renders.slice(-4).map(r => [...(r.exclude || '')].length).join(',')");
  log.push(`presets rebuilt: last 4 renders exclude lengths ${presetSent}; status ${await status()}`);
  // 読み込み直しても覚えている
  await b.goto(URL);
  await b.waitFor("document.querySelector('#font option') !== null");
  await sleep(500);
  log.push("after reload: " + await b.eval("document.getElementById('dictBtn').textContent"));
  await b.eval("localStorage.removeItem('aame.exclude')");
} catch (e) {
  log.push("ERROR " + e.stack);
  await b.shot(`${out}/error.png`).catch(() => {});
} finally {
  writeFileSync(`${out}/log.txt`, log.join("\n"), "utf-8");
  await b.close();
}
