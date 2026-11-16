// 書き出し、減らす塗り、高密度、黒い面、前の結果を確かめる。
// node ui_test2.mjs <出力フォルダ> <画像>
import { launch } from "./cdp.mjs";
import { writeFileSync, mkdirSync } from "node:fs";

const [out, image] = process.argv.slice(2);
mkdirSync(out + "/exports", { recursive: true });
const b = await launch({ width: 1500, height: 1000, port: 9335 });
const log = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
b.on((m) => {
  if (m.method === "Runtime.consoleAPICalled") log.push(`console.${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  if (m.method === "Runtime.exceptionThrown") log.push("exception: " + JSON.stringify(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
});
const idle = async () => { await sleep(300); await b.waitFor("document.getElementById('busy').hidden"); };
const click = (sel) => b.eval(`document.querySelector(${JSON.stringify(sel)}).click()`);
const status = () => b.eval("document.getElementById('status').textContent");
try {
  await b.goto("http://127.0.0.1:8765/");
  await b.setFile("#file", image);
  await b.waitFor("document.querySelectorAll('.card .wait[hidden]').length === 6", 300000);
  await b.eval("document.querySelectorAll('button.card')[0].click()");
  await b.waitFor("!document.getElementById('edit').hidden");
  await sleep(500);
  await b.shot(`${out}/10_edit_default_zoom.png`);

  // 書き出し: a.click を横取りして中身を取る
  await b.eval(`(() => {
    window.__dl = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) window.__dl.push({ name: this.download, href: this.href }); else orig.call(this);
    };
  })()`);
  for (const id of ["#saveTxt", "#saveHtml", "#savePng"]) { await click(id); await sleep(400); }
  const files = await b.eval(`Promise.all(window.__dl.map(async (d) => {
    const blob = await (await fetch(d.href)).blob();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ""; for (const x of buf) s += String.fromCharCode(x);
    return { name: d.name, type: blob.type, b64: btoa(s) };
  }))`);
  for (const f of files) {
    writeFileSync(`${out}/exports/${f.name}`, Buffer.from(f.b64, "base64"));
    log.push(`export ${f.name} ${f.type} ${Buffer.from(f.b64, "base64").length} bytes`);
  }
  writeFileSync(`${out}/exports/editor_lines.json`, JSON.stringify(await b.eval("document.getElementById('text').value.split('\\n')")), "utf8");

  // 減らす: 下半分を塗る
  await click("#tool button[data-v=less]");
  await b.eval("(() => { const el = document.getElementById('brushSize'); el.value = 120; el.dispatchEvent(new Event('input')); })()");
  const [L, T, W, H] = await b.eval("(() => { const r = document.getElementById('paintCanvas').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()");
  const vis = Math.min(H, 1000 - T - 20);
  const pts = [];
  for (let row = 0; row < 4; row++) for (let i = 0; i <= 20; i++) {
    const x = row % 2 ? L + W * (1 - i / 20) : L + W * (i / 20);
    pts.push([x, T + vis * (0.6 + 0.1 * row)]);
  }
  const before = await b.eval("document.getElementById('text').value.replace(/[ 　\\n]/g, '').length");
  await b.drag(pts);
  await idle();
  const after = await b.eval("document.getElementById('text').value.replace(/[ 　\\n]/g, '').length");
  log.push(`less paint: glyphs ${before} -> ${after}; ${await status()}`);
  await b.shot(`${out}/11_less.png`);
  // 前の結果を押している間
  const prevDisabled = await b.eval("document.getElementById('prev').disabled");
  const box = await b.eval("(() => { const r = document.getElementById('prev').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()");
  await b.mouse("mouseMoved", box[0], box[1], 0);
  await b.mouse("mousePressed", box[0], box[1]);
  await sleep(200);
  await b.shot(`${out}/12_prev_held.png`);
  await b.mouse("mouseReleased", box[0], box[1], 0);
  log.push(`prev button disabled=${prevDisabled}`);
  // 塗りを1つ戻す
  await click("#undoPaint");
  await idle();
  const undone = await b.eval("document.getElementById('text').value.replace(/[ 　\\n]/g, '').length");
  log.push(`undo paint: glyphs ${undone} (before painting ${before})`);
  await click("#tool button[data-v=none]");
  // 黒い面
  await click("#fill button[data-v=all]");
  await idle();
  log.push(`fill all: ${await status()} fill_gain visible=${await b.eval("!document.querySelector('.fillonly').hidden")}`);
  await b.shot(`${out}/13_fill_all.png`);
  // 高密度
  await click("#mode button[data-v=v1]");
  await idle();
  log.push(`v1: ${await status()} paint section hidden=${await b.eval("document.querySelectorAll('.v2only')[3].hidden")}`);
  await b.shot(`${out}/14_v1.png`);
  // 候補の設定に戻す
  await click("#reset");
  await idle();
  log.push(`reset: mode=${await b.eval("document.querySelector('#mode [aria-checked=true]').dataset.v")} fill=${await b.eval("document.querySelector('#fill [aria-checked=true]').dataset.v")}`);
  // 候補の一覧に戻って別の候補
  await click("#back");
  await b.eval("document.querySelectorAll('button.card')[5].click()");
  await sleep(300);
  log.push(`base select = ${await b.eval("document.getElementById('base').value")}`);
  await click("#zoom button[data-v=fit]");
  await sleep(300);
  await b.shot(`${out}/15_fit.png`);
} catch (e) {
  log.push("ERROR " + e.message);
  await b.shot(`${out}/error.png`).catch(() => {});
} finally {
  writeFileSync(`${out}/log.txt`, log.join("\n"), "utf8");
  await b.close();
}
console.log(log.join("\n"));
process.exit(0);
