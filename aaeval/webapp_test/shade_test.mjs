// 仕上げの「陰影」を画面で確かめる。GPU（WebGPU）を使う。
//   node aaeval/webapp_test/shade_test.mjs <出力フォルダ> <画像（絶対パス）> [--base URL] [--engine local|server]
// 1. 画像を入れて仕上げまで進み、「陰影」の「高密度」を選ぶ（空白に薄い赤の印。塗り方の初めは 1行塗り）
// 2. 1行塗り: マウスを置くとその行の並びだけが濃い赤 → 押すとその行だけが埋まる（shade.js で求めたものと同じ。
//    行の途中の幅は変わらない）。「1つ戻す」で戻る。押したまま下へなぞると、なぞった行がまとめて埋まる
// 3. バケツ塗り: マウスを置くとつながった範囲が濃い赤 → 押すとまとめて埋まる
// 4. 文字を「三」にして低密度で埋める（三は標準の辞書にある）。文字のボタンが陰影の文字と同じか、「_」の高密度。
//    読み込み直しても文字と塗り方を覚えている
// 5. 英語の画面で、道具の名前と説明が英語になるか
import { launch } from "./cdp.mjs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const S = await import(pathToFileURL(resolve(ROOT, "webapp/static/shade.js")));
const glyphs = JSON.parse(readFileSync(resolve(ROOT, "webapp/static/glyphs.json"), "utf8")).glyphs;
const W = new Map(glyphs.map((g) => [g[0], g[1]]));
const widthOf = (ch) => W.get(ch) ?? 16;
const lineWidth = (s) => [...s].reduce((w, c) => w + widthOf(c), 0);

const args = process.argv.slice(2);
const [out, image] = args;
const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const BASE = opt("--base", "http://127.0.0.1:8765/");
const ENGINE = opt("--engine", "local");
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL0 = `${BASE}?engine=${ENGINE}&lang=ja`;

const b = await launch({ width: 1600, height: 1000, port: 9384, gpu: true,
  profile: resolve(dirname(resolve(out)), "edge_profile_local") });
const problems = [];
const log = [];
b.on((m) => {
  if (m.method === "Runtime.exceptionThrown") problems.push("exception: " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
});
const expect = (ok, what) => { log.push(`${ok ? "ok" : "NG"}: ${what}`); if (!ok) problems.push(what); };
const text = async () => (await b.eval("document.getElementById('text').value")).split("\n");
// AA の (行, x px) の、画面の上の位置
const at = async (row, x) => {
  const r = await b.eval(`(() => { const c = document.getElementById("aaCanvas"); const r = c.getBoundingClientRect(); return { left: r.left, top: r.top, z: r.width / c.width }; })()`);
  return [r.left + x * r.z, r.top + (row + 0.5) * 18 * r.z];
};
// 陰影の印の濃さ（shadeCanvas の画素の不透明度）
const alpha = (row, x) => b.eval(`(() => { const c = document.getElementById("shadeCanvas"); return c.getContext("2d").getImageData(${x}, ${row * 18 + 9}, 1, 1).data[3]; })()`);
const click = async (row, x) => {
  const [px, py] = await at(row, x);
  await b.mouse("mouseMoved", px, py, 0);
  await b.mouse("mousePressed", px, py);
  await b.mouse("mouseReleased", px, py, 0);
  await sleep(300);
};
const pick = (seg, v) => b.eval(`document.querySelector('#${seg} button[data-v="${v}"]').click()`);
const changedRows = (a, c) => new Map(c.map((l, r) => [r, l]).filter(([r, l]) => l !== a[r]));
const same = (got, want) => got.size === want.size && [...want].every(([r, l]) => got.get(r) === l);
const undo = async () => { await b.eval("document.getElementById('undo').click()"); await sleep(300); };

try {
  await b.goto(URL0);
  await b.waitFor("document.querySelector('#font option') !== null", 60000);
  await b.eval("for (const k of ['aame.extra', 'aame.exclude', 'aame.shade']) localStorage.removeItem(k)");
  await b.goto(URL0);
  await b.waitFor("document.querySelector('#font option') !== null", 60000);
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
  await b.eval("document.getElementById('zoom').querySelector('button[data-v=\"1\"]')?.click()");
  await sleep(300);

  const lines0 = await text();
  const right = Number((await b.eval("document.getElementById('info').textContent")).match(/^(\d+)×/)[1]);
  const runs = S.blankRuns(lines0, widthOf);
  // 押す所: 真ん中あたりの行の、行頭の空白（左の背景）
  const mid = Math.floor(lines0.length / 2);
  const start = runs.slice(mid).flat().find((r) => r.first && !r.last && r.b - r.a >= 40) ?? runs.flat().find((r) => !r.last && r.b - r.a >= 40);
  const region = S.regionOf(runs, start);
  const other = runs[start.row].find((r) => r !== start && r.b - r.a >= 11);    // 同じ行のほかの並び
  const X = start.a + 4;
  log.push(`押す所: ${start.row + 1} 行目の ${start.a}〜${start.b}px。つながった並び ${region.length}、${new Set(region.map((r) => r.row)).size} 行`);

  // 1. 高密度を選ぶ
  await pick("tool", "dense");
  await sleep(200);
  expect(await b.eval("!document.getElementById('shadePanel').hidden && !document.getElementById('shadeCanvas').hidden"), "陰影の欄と印が出る");
  const fill0 = await b.eval("document.querySelector('#shadeFill button[aria-checked=true]').dataset.v");
  const ch0 = await b.eval("document.querySelector('#shadeChar button[aria-checked=true]').dataset.v");
  expect(fill0 === "row" && ch0 === ":", `初めは 1行塗り・「:」（${fill0}・${ch0}）`);
  const a0 = await alpha(start.row, start.a + 2), aInk = await alpha(start.row, start.b + 1);
  log.push(`印の濃さ: 空白 ${a0}、線 ${aInk}`);
  expect(a0 > 20 && a0 < 70 && aInk === 0, "空白にだけ薄い赤");
  const rects = await b.eval(`["shadeCanvas", "aaCanvas"].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round).join(","); })`);
  expect(rects[0] === rects[1], "印の層が AA と同じ位置・大きさ");

  // 2. 1行塗り
  const [px, py] = await at(start.row, X);
  await b.mouse("mouseMoved", px, py, 0);
  await sleep(200);
  const hov = await alpha(start.row, start.a + 2), hovNext = await alpha(start.row + 1, start.a + 2);
  log.push(`1行塗りでマウスを置いたとき: その行 ${hov}、下の行 ${hovNext}`);
  expect(hov > 80 && hovNext < 70, "1行塗り: その行の並びだけが濃い赤");
  await click(start.row, X);
  const dense = S.makePattern(":", "dense", widthOf);
  const got1 = changedRows(lines0, await text());
  const want1 = S.shadeLines(lines0, [start], dense, widthOf, right);
  log.push(`1行塗り: ${[...got1.keys()].map((r) => r + 1).join(",")} 行目が変わった: ${(got1.get(start.row) ?? "").slice(0, 24)}`);
  expect(got1.size === 1 && same(got1, want1), "1行塗り: その行だけが shade.js と同じに埋まる");
  expect(lineWidth(got1.get(start.row) ?? "") === lineWidth(lines0[start.row]), "行の幅は変わらない");
  await undo();
  expect((await text()).join("\n") === lines0.join("\n"), "1つ戻すで元に戻る");
  // なぞる（下へ 4 行）
  const pts = [];
  for (let k = 0; k <= 4; k++) pts.push(await at(start.row + k, X));
  await b.drag(pts);
  await sleep(300);
  const dragRuns = [...new Set([0, 1, 2, 3, 4].map((k) => S.runAt(runs, start.row + k, X)).filter(Boolean))];
  const got2 = changedRows(lines0, await text());
  const want2 = S.shadeLines(lines0, dragRuns, dense, widthOf, right);
  log.push(`なぞった: ${[...got2.keys()].map((r) => r + 1).join(",")} 行目（並び ${dragRuns.length}）`);
  expect(got2.size >= 2 && same(got2, want2), "1行塗り: なぞった行がまとめて埋まる");
  expect(await b.eval("!document.getElementById('undo').disabled"), "1つ戻すが使える");
  await b.shot(join(out, "1_row.png"));
  await undo();
  expect((await text()).join("\n") === lines0.join("\n"), "なぞった分も 1 回で戻る");

  // 3. バケツ塗り
  await pick("shadeFill", "bucket");
  await sleep(200);
  await b.mouse("mouseMoved", px, py, 0);
  await sleep(200);
  const bHov = await alpha(start.row, start.a + 2);
  const below = region.find((r) => r.row !== start.row);
  const bHovOther = below ? await alpha(below.row, below.a + 2) : -1;
  log.push(`バケツ塗りでマウスを置いたとき: 押す所 ${bHov}、つながった別の行 ${bHovOther}`);
  expect(bHov > 80 && (!below || bHovOther > 80), "バケツ塗り: つながった範囲が濃い赤");
  await b.shot(join(out, "2_bucket_hover.png"));
  await click(start.row, X);
  const got3 = changedRows(lines0, await text());
  const want3 = S.shadeLines(lines0, region, dense, widthOf, right);
  log.push(`バケツ塗り: ${got3.size} 行（shade.js で求めたもの ${want3.size}）`);
  expect(same(got3, want3), "バケツ塗り: つながった並びが shade.js と同じに埋まる");
  expect([...got3].every(([r, l]) => region.some((q) => q.row === r && q.last) || lineWidth(l) === lineWidth(lines0[r])), "行の途中の幅は変わらない");
  expect([...got3.values()].every((l) => !l.includes("  ") && !l.startsWith(" ")), "半角スペースを続けない・行頭に置かない");
  expect((await b.eval("document.querySelectorAll('#marks .mark').length")) === got3.size, "手で直した行の印");
  await b.mouse("mouseMoved", 5, 5, 0);
  await sleep(200);
  await b.shot(join(out, "3_bucket.png"));
  await undo();

  // 4. 三・低密度（1行塗りに戻す）
  await pick("shadeFill", "row");
  await pick("shadeChar", "三");
  await pick("tool", "sparse");
  await sleep(200);
  const label = await b.eval("document.querySelector('#tool button[data-v=sparse]').textContent");
  log.push(`低密度のボタン: ${label}`);
  expect(label.startsWith("三 三 三"), "ボタンの見本が選んだ文字になる");
  await click(start.row, X);
  const got4 = changedRows(lines0, await text());
  const want4 = S.shadeLines(lines0, [start], S.makePattern("三", "sparse", widthOf), widthOf, right);
  log.push(`三の低密度: ${(got4.get(start.row) ?? "").slice(0, 16)}`);
  expect(same(got4, want4) && (got4.get(start.row) ?? "").includes("三"), "三で埋まる（低密度）");
  expect(await b.eval("fetch('glyphs.json').then((r) => r.json()).then((d) => d.glyphs.some((g) => g[0] === '三'))"), "三は表示の表（標準の辞書）にある");
  await b.shot(join(out, "4_san.png"));
  await undo();
  // 文字のボタンは陰影の文字（SHADE_CHARS）と同じ。「_」（横線でいちばん細い）も選べる
  const chars = await b.eval("[...document.querySelectorAll('#shadeChar button')].map((e) => e.dataset.v)");
  expect(chars.join("") === S.SHADE_CHARS.join(""), `文字のボタン（${chars.join(" ")}）`);
  await pick("shadeChar", "_");
  await pick("tool", "dense");
  await sleep(200);
  await click(start.row, X);
  const got5 = changedRows(lines0, await text());
  const want5 = S.shadeLines(lines0, [start], S.makePattern("_", "dense", widthOf), widthOf, right);
  log.push(`_ の高密度: ${(got5.get(start.row) ?? "").slice(0, 16)}`);
  expect(same(got5, want5) && (got5.get(start.row) ?? "").includes("_"), "_ で埋まる（高密度）");
  await undo();
  await pick("shadeChar", "三");
  await pick("tool", "sparse");
  // 読み込み直しても覚えている
  await b.goto(URL0);
  await b.waitFor("document.querySelector('#font option') !== null", 60000);
  const kept = await b.eval("[document.querySelector('#shadeChar button[aria-checked=true]').dataset.v, document.querySelector('#shadeFill button[aria-checked=true]').dataset.v]");
  expect(kept[0] === "三" && kept[1] === "row", `読み込み直しても文字と塗り方を覚えている（${kept.join("・")}）`);

  // 5. 英語
  await b.goto(`${BASE}?engine=${ENGINE}&lang=en`);
  await b.waitFor("document.querySelector('#font option') !== null", 60000);
  await b.eval("document.getElementById('shadePanel').hidden = false");
  const en = await b.eval(`[...document.querySelectorAll('#tool button[data-v=dense], #tool button[data-v=sparse], #tool .tlabel, #shadePanel .label, #shadeFill button, #shadeNote')].map((e) => e.textContent)`);
  log.push(`英語: ${en.join(" | ")}`);
  expect(!en.some((s) => /[ぁ-んァ-ン一-龯]/.test(s.replaceAll("三", ""))), "英語の画面で道具の名前と説明が英語");
  await b.eval("localStorage.removeItem('aame.shade')");
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
