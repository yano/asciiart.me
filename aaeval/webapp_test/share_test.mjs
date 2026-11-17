// 共有（仕上げの「共有」）: 共有用の画像（AA だけ / 元の絵も並べる）、「X に投稿」でクリップボードに入る画像と開く URL、
// 英語の画面での投稿の文を確かめる。共有用の画像は出力フォルダに保存する。GPU（WebGPU）を使う。
// node aaeval/webapp_test/share_test.mjs <出力フォルダ> <画像（絶対パス）> [--base http://127.0.0.1:8765/]
import { launch } from "./cdp.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const [out, image] = args;
const BASE = args.includes("--base") ? args[args.indexOf("--base") + 1] : "http://127.0.0.1:8765/";
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await launch({ width: 1600, height: 1000, port: 9379, gpu: true,
  profile: resolve(dirname(resolve(out)), "edge_profile_local") });
const problems = [];
const log = [];
b.on((m) => {
  if (m.method === "Runtime.exceptionThrown") problems.push("exception: " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
});
const expect = (ok, what) => { log.push(`${ok ? "ok" : "NG"}: ${what}`); if (!ok) problems.push(what); };

// ダウンロード（a.click）と window.open を横取りする
const HOOKS = `(() => {
  window.__saved = [];
  HTMLAnchorElement.prototype.click = function () {
    const a = this;
    fetch(a.href).then((r) => r.blob()).then((blob) => new Promise((ok) => {
      const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(blob);
    })).then((data) => window.__saved.push({ name: a.download, data }));
  };
  window.__opened = [];
  window.open = (url) => { window.__opened.push(url); return null; };
})()`;
const pngSize = (dataURL) => {
  const buf = Buffer.from(dataURL.split(",")[1], "base64");
  return { buf, w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
};

async function toEdit(lang) {
  await b.goto(`${BASE}?engine=local&lang=${lang}`);
  await b.waitFor("document.querySelector('#font option') !== null", 60000);
  await b.eval(HOOKS);
  await b.setFile("#file", image);
  await b.waitFor("!document.getElementById('prepView').hidden", 120000);
  await b.eval("document.getElementById('prepSkip').click()");
  await b.waitFor("document.querySelectorAll('.ccard .cwait[hidden]').length === 5", 900000);
  await b.eval("document.querySelectorAll('.ccard .cgo')[1].click()");
  await b.waitFor("document.getElementById('pickTitle').textContent.startsWith('2.')");
  await b.waitFor("document.querySelectorAll('.ccard .cwait[hidden]').length === 6", 900000);
  await b.eval("[...document.querySelectorAll('.ccard')].find(c => c.querySelector('.cname').textContent === '×1.00').querySelector('.cgo').click()");
  await b.waitFor("!document.getElementById('edit').hidden");
  await b.waitFor("document.getElementById('busy').hidden", 300000);
}

async function saved(n) {
  await b.waitFor(`window.__saved.length >= ${n}`, 30000);
  return b.eval(`window.__saved[${n - 1}]`);
}

try {
  await b.send("Browser.grantPermissions", { permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"], origin: new URL(BASE).origin });
  await b.send("Emulation.setFocusEmulationEnabled", { enabled: true });

  await toEdit("ja");
  const dims = await b.eval("(() => { const c = document.getElementById('aaCanvas'); return [c.width, c.height]; })()");
  log.push(`AA の canvas: ${dims.join("×")}`);
  log.push(`共有ボタン（端末の共有）: ${await b.eval("document.getElementById('share').hidden ? '出さない' : '出す'")}`);
  log.push(`投稿の文: ${await b.eval("document.getElementById('shareNote').textContent")}`);
  expect((await b.eval("document.getElementById('shareNote').textContent")) === "投稿の文: 画像からAA（アスキーアート）を作りました。ブラウザだけで作れます → https://panzersoft.com/asciiartme/ #asciiartme #ASCIIArt #アスキーアート", "日本語の投稿の文");

  // AA だけ
  await b.eval("document.getElementById('shareSave').click()");
  const a = await saved(1);
  const pa = pngSize(a.data);
  writeFileSync(join(out, "share_aa.png"), pa.buf);
  log.push(`共有用の画像（AA だけ）: ${a.name} ${pa.w}×${pa.h}`);
  expect(a.name.endsWith("_aa_share.png"), "ファイル名");
  expect(pa.w === dims[0] + 32, "幅 = AA + 余白");

  // 元の絵も並べる
  await b.eval("document.getElementById('shareOrig').click()");
  await b.eval("document.getElementById('shareSave').click()");
  const o = await saved(2);
  const po = pngSize(o.data);
  writeFileSync(join(out, "share_with_original.png"), po.buf);
  log.push(`共有用の画像（元の絵も）: ${po.w}×${po.h}`);
  expect(po.w > pa.w + dims[0] - 4, "元の絵の分だけ広い");

  // X に投稿: クリップボードの画像と、開く URL
  await b.eval("document.getElementById('shareX').click()");
  await b.waitFor("window.__opened.length === 1", 30000);
  const url = await b.eval("window.__opened[0]");
  log.push(`開く URL: ${url}`);
  expect(url === "https://x.com/intent/post?text=" + encodeURIComponent("画像からAA（アスキーアート）を作りました。ブラウザだけで作れます → https://panzersoft.com/asciiartme/ #asciiartme #ASCIIArt #アスキーアート"), "X の URL");
  const clip = await b.eval(`(async () => {
    const items = await navigator.clipboard.read();
    const blob = await items[0].getType("image/png");
    const bmp = await createImageBitmap(blob);
    return [items[0].types.join(","), bmp.width, bmp.height];
  })()`);
  log.push(`クリップボード: ${clip.join(" ")}`);
  expect(clip[1] === po.w && clip[2] === po.h, "クリップボードの画像 = 共有用の画像");
  log.push(`状態: ${await b.eval("document.getElementById('status').textContent")}`);
  await b.shot(join(out, "ja_edit.png"));

  // 英語の画面
  await b.eval("document.getElementById('langBtn').click()");
  await sleep(300);
  const en = await b.eval("document.getElementById('shareNote').textContent");
  log.push(`英語の投稿の文: ${en}`);
  expect(en === "Message: I made ASCII art (AA) from a picture. You can make one right in your browser → https://panzersoft.com/asciiartme/ #asciiartme #ASCIIArt", "英語の投稿の文");
  await b.eval("document.getElementById('shareX').click()");
  await b.waitFor("window.__opened.length === 2", 30000);
  expect((await b.eval("window.__opened[1]")).includes(encodeURIComponent("I made ASCII art (AA)")), "英語の X の URL");
  await b.shot(join(out, "en_edit.png"));
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
