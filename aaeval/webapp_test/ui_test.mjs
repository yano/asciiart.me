// 画面を実際に動かして、画面の写真を撮る。
// node ui_test.mjs <出力フォルダ> <画像>
import { launch } from "./cdp.mjs";
import { writeFileSync, appendFileSync } from "node:fs";

const [out, image] = process.argv.slice(2);
const URL = "http://127.0.0.1:8765/";
const b = await launch({ width: 1600, height: 1000 });
const log = [];
const step = (m) => { appendFileSync(`${out}/progress.txt`, `${new Date().toISOString()} ${m}
`); };
b.on((m) => {
  if (m.method === "Runtime.consoleAPICalled") log.push(`console.${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  if (m.method === "Runtime.exceptionThrown") log.push("exception: " + JSON.stringify(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
});
try {
  await b.goto(URL);
  await b.waitFor("document.querySelector('#status') !== null");
  await b.shot(`${out}/01_welcome.png`);
  let t0 = Date.now();
  await b.setFile("#file", image);
  await b.waitFor("!document.getElementById('choose').hidden");
  await b.shot(`${out}/02_choose_start.png`);
  await b.waitFor("document.querySelectorAll('.card .wait[hidden]').length === 6", 300000);
  log.push(`all candidates: ${(Date.now() - t0) / 1000}s`);
  log.push("status: " + await b.eval("document.getElementById('status').textContent"));
  await b.shot(`${out}/03_choose_done.png`);
  // 「全体に色の境界」を選ぶ
  await b.eval("document.querySelectorAll('button.card')[2].click()");
  await b.waitFor("!document.getElementById('edit').hidden");
  await new Promise((r) => setTimeout(r, 800));
  await b.shot(`${out}/04_edit.png`);
  step("edit shown");
  // 描き込みを上げる
  t0 = Date.now();
  await b.eval("(() => { const el = document.getElementById('lam'); el.value = 2.8; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); })()");
  await new Promise((r) => setTimeout(r, 300));
  await b.waitFor("document.getElementById('busy').hidden");
  log.push(`lam 2.8 rerender: ${(Date.now() - t0) / 1000}s; status: ` + await b.eval("document.getElementById('status').textContent"));
  step("lam done");
  await b.shot(`${out}/05_lam28.png`);
  // 線画の下絵
  await b.eval("document.querySelector('#under button[data-v=lineart]').click()");
  await new Promise((r) => setTimeout(r, 1000));
  await b.shot(`${out}/06_lineart_under.png`);
  await b.eval("document.querySelector('#under button[data-v=source]').click()");
  // 塗る: 増やすで顔のあたりを塗る
  await b.eval("document.querySelector('#tool button[data-v=more]').click()");
  const r = await b.eval("(() => { const r = document.getElementById('paintCanvas').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()");
  log.push("paint rect " + JSON.stringify(r));
  const [L, T, W, H] = r;
  const pts = [];
  for (let i = 0; i <= 30; i++) pts.push([L + W * (0.35 + 0.3 * i / 30), T + H * 0.22]);
  for (let i = 0; i <= 30; i++) pts.push([L + W * (0.65 - 0.3 * i / 30), T + H * 0.27]);
  t0 = Date.now();
  step("drag start");
  await b.drag(pts);
  step("drag end");
  await new Promise((r) => setTimeout(r, 300));
  await b.waitFor("document.getElementById('busy').hidden");
  log.push(`painted rerender: ${(Date.now() - t0) / 1000}s; status: ` + await b.eval("document.getElementById('status').textContent"));
  await b.shot(`${out}/07_painted.png`);
  // 書き出し
  await b.downloadsTo(out + "/downloads");
  for (const id of ["saveTxt", "saveHtml", "savePng"]) {
    await b.eval(`document.getElementById('${id}').click()`);
    await new Promise((r) => setTimeout(r, 700));
  }
  const lines = await b.eval("document.getElementById('text').value");
  writeFileSync(`${out}/editor_text.txt`, lines, "utf8");
  // 等倍表示
  await b.eval("document.querySelector('#tool button[data-v=none]').click()");
  await b.eval("document.querySelector('#zoom button[data-v=\"1\"]').click()");
  await new Promise((r) => setTimeout(r, 300));
  await b.shot(`${out}/08_zoom1.png`);
} catch (e) {
  log.push("ERROR " + e.message);
  await b.shot(`${out}/error.png`).catch(() => {});
} finally {
  writeFileSync(`${out}/log.txt`, log.join("\n"), "utf8");
  await b.close();
}
console.log(log.join("\n"));
