// 0 前処理（切り抜き・大きさ・線の太さ・線画で確かめる）→ 1 候補 → 2 大きさ → 3 仕上げ（行を直す: 横の伸び縮み）
// → 0 に戻って「前処理をしないで進む」。表示フォントの既定（Saitamaar）も見る。
// node ui_test4.mjs <出力フォルダ> <画像>
import { launch } from "./cdp.mjs";
import { writeFileSync } from "node:fs";

const [out, image] = process.argv.slice(2);
const URL = "http://127.0.0.1:8765/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await launch({ width: 1600, height: 1000, port: 9344 });
const log = [];
b.on((m) => {
  if (m.method === "Runtime.consoleAPICalled") log.push(`console.${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  if (m.method === "Runtime.exceptionThrown") log.push("exception: " + JSON.stringify(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
});
const text = (id) => b.eval(`document.getElementById(${JSON.stringify(id)}).textContent`);
const rect = (sel, i = 0) => b.eval(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; e.scrollIntoView({ block: "nearest" }); const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()`);
const move = async (x, y) => { await b.mouse("mouseMoved", x, y, 0); await sleep(80); };
const click = async (x, y) => { await b.mouse("mouseMoved", x, y, 0); await b.mouse("mousePressed", x, y); await b.mouse("mouseReleased", x, y, 0); await sleep(120); };
const prepReady = "document.getElementById('prepWait').hidden && !document.getElementById('prepState').textContent.includes('…')";
const setRange = (id, v) => b.eval(`(() => { const el = document.getElementById('${id}'); el.value = ${v}; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); })()`);
try {
  await b.goto(URL);
  await b.waitFor("document.querySelector('#font option') !== null");
  await sleep(1500);
  log.push("font at start: " + await b.eval("document.getElementById('font').value") + " / status: " + await text("status"));
  let t0 = Date.now();
  await b.setFile("#file", image);
  await b.waitFor("!document.getElementById('prepView').hidden", 60000);
  await b.waitFor(prepReady, 60000);
  log.push(`0. prep shown ${(Date.now() - t0) / 1000}s; stroke: ${await text("strokeInfo")} | size: ${await text("sizeInfo")} | crop: ${await text("cropInfo")}`);
  log.push("steps: " + await b.eval("[...document.querySelectorAll('#steps button')].map(x => x.textContent + (x.disabled ? '(off)' : '') + (x.classList.contains('current') ? '*' : '')).join(' ')"));
  await b.shot(`${out}/01_prep.png`);
  // 切り抜く: 画像の上の方（顔のあたり）をドラッグ
  let [L, T, W, H] = await rect("#cropCanvas");
  t0 = Date.now();
  await b.drag([[L + W * 0.12, T + H * 0.04], [L + W * 0.5, T + H * 0.3], [L + W * 0.88, T + H * 0.58]]);
  await sleep(500);
  await b.waitFor(prepReady, 60000);
  log.push(`crop ${(Date.now() - t0) / 1000}s: ${await text("cropInfo")} | ${await text("sizeInfo")} | ${await text("strokeInfo")}`);
  // 大きさを長辺 1000px に（拡大するので線が太くなる）
  t0 = Date.now();
  await setRange("prepLong", 1000);
  await sleep(500);
  await b.waitFor(prepReady, 60000);
  log.push(`long 1000 ${(Date.now() - t0) / 1000}s: ${await text("sizeInfo")} | ${await text("strokeInfo")} | auto: ${await text("deltaAuto")}`);
  await b.shot(`${out}/02_prep_crop_long.png`);
  // おすすめの太さにする
  t0 = Date.now();
  const autoOn = await b.eval("!document.getElementById('deltaAuto').disabled");
  if (autoOn) {
    await b.eval("document.getElementById('deltaAuto').click()");
    await sleep(300);
    await b.waitFor(prepReady, 60000);
  }
  log.push(`auto delta (${autoOn}) ${(Date.now() - t0) / 1000}s: delta ${await b.eval("document.getElementById('prepDelta').value")} | ${await text("strokeInfo")}`);
  // 線画で確かめる。左の画像の目のあたりにマウス
  t0 = Date.now();
  await b.eval("document.querySelector('#prepShow button[data-v=lineart]').click()");
  await sleep(300);
  await b.waitFor(prepReady, 120000);
  [L, T, W, H] = await rect("#cropCanvas");
  await move(L + W * 0.45, T + H * 0.3);
  log.push(`lineart ${(Date.now() - t0) / 1000}s: ${await text("prepState")}; cropView shown: ${await b.eval("!document.getElementById('cropView').hidden")}`);
  await b.shot(`${out}/03_prep_lineart.png`);
  await b.eval("document.querySelector('#prepShow button[data-v=image]').click()");
  await sleep(300);
  await b.shot(`${out}/04_prep_image.png`);
  // 1. 候補へ
  t0 = Date.now();
  await b.eval("document.getElementById('prepGo').click()");
  await b.waitFor("!document.getElementById('pickView').hidden", 60000);
  await b.waitFor("document.querySelectorAll('.ccard').length === 5");
  await b.waitFor("document.querySelectorAll('.ccard .cwait[hidden]').length === 5", 300000);
  log.push(`1. presets ${(Date.now() - t0) / 1000}s; src note: ` + await b.eval("document.querySelector('.ccard .cnote').textContent") + "; status: " + await text("status"));
  [L, T, W, H] = await rect(".ccard .cthumb", 2);
  await move(L + W * 0.5, T + H * 0.4);
  await b.shot(`${out}/05_presets.png`);
  // 標準 → 大きさ ×1.00 → 仕上げ
  await b.eval("document.querySelectorAll('.ccard .cgo')[2].click()");
  await b.waitFor("document.querySelectorAll('.ccard').length === 6");
  await b.waitFor("document.querySelectorAll('.ccard .cwait[hidden]').length === 6", 300000);
  log.push("2. scales: " + await b.eval("[...document.querySelectorAll('.ccard')].map(c => c.querySelector('.cname').textContent + ' ' + c.querySelector('.cnote').textContent).join(' | ')"));
  await b.eval("[...document.querySelectorAll('.ccard')].find(c => c.querySelector('.cname').textContent === '×1.00').querySelector('.cgo').click()");
  await b.waitFor("!document.getElementById('edit').hidden");
  await sleep(800);
  log.push("3. edit: " + await text("info"));
  // 行を直す
  await b.eval("document.querySelector('#tool button[data-v=row]').click()");
  [L, T, W, H] = await rect("#aaCanvas");
  const z = await b.eval("document.getElementById('aaCanvas').getBoundingClientRect().height / document.getElementById('aaCanvas').height");
  const y = T + (14 * 18 + 9) * z;
  t0 = Date.now();
  await click(L + W * 0.5, y);
  await b.waitFor("document.querySelectorAll('#rowList .ropt').length > 0", 60000);
  log.push(`row options ${(Date.now() - t0) / 1000}s; groups: ` + await b.eval("[...document.querySelectorAll('#rowList .rgroup')].map(e => e.textContent).join(' / ')")
    + "; labels: " + await b.eval("[...document.querySelectorAll('#rowList .rlabel')].map(e => e.textContent).join(', ')"));
  // 伸び縮みの候補にマウスを置くと、AA が変わるか
  const before = await b.eval("document.getElementById('aaCanvas').toDataURL()");
  const idx = await b.eval("[...document.querySelectorAll('#rowList .ropt')].findIndex(e => e.querySelector('.rlabel').textContent === '1% 広げる')");
  if (idx >= 0) {
    [L, T, W, H] = await rect("#rowList .ropt", idx);
    await move(L + W / 2, T + H / 2);
    log.push(`hover '1% 広げる' changes canvas: ${before !== await b.eval("document.getElementById('aaCanvas').toDataURL()")}`);
  }
  await b.shot(`${out}/06_row_scale.png`);
  await b.eval("document.getElementById('rowCancel').click()");
  // 0 に戻る（設定が残っているか）→ 前処理をしないで進む
  await b.eval("document.querySelector('#steps button[data-step=prep]').click()");
  await sleep(600);
  log.push("back to 0: " + await text("cropInfo") + " | " + await text("sizeInfo") + " | delta " + await b.eval("document.getElementById('prepDelta').value"));
  await b.shot(`${out}/07_back_prep.png`);
  t0 = Date.now();
  await b.eval("document.getElementById('prepSkip').click()");
  await b.waitFor("!document.getElementById('pickView').hidden", 30000);
  await b.waitFor("document.querySelectorAll('.ccard .cwait[hidden]').length === 5", 300000);
  log.push(`skip → presets ${(Date.now() - t0) / 1000}s; src note: ` + await b.eval("document.querySelector('.ccard .cnote').textContent")
    + "; edit step: " + await b.eval("document.querySelector('#steps button[data-step=edit]').disabled ? 'off' : 'on'"));
  const size = await b.eval("(() => { const c = document.querySelectorAll('.ccard canvas')[1]; return [c.width, c.height]; })()");
  log.push("thumb canvas: " + size.join("x"));
  await b.shot(`${out}/08_skip_presets.png`);
} catch (e) {
  log.push("ERROR " + e.stack);
  await b.shot(`${out}/error.png`).catch(() => {});
} finally {
  writeFileSync(`${out}/log.txt`, log.join("\n"), "utf-8");
  await b.close();
}
