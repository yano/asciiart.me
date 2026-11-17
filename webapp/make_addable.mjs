// 「使う文字」で足せる文字の表（webapp/static/addable.json）を作る。Windows 専用（MS Pゴシックと Edge を使う）。
//   node webapp/make_addable.mjs
//
// 足す文字の形は、使う人の PC のフォントで描く（MS Pゴシックがあればそれで。辞書と同じ形になる。無ければ Saitamaar で）。
// この表は、どの文字を足してよいかと、その幅（MS Pゴシック 16px の送り幅。ブラウザで測ったもの）を持つ:
//   - MS Pゴシックにある文字で、幅が辞書の範囲（3〜16px）のもの
//   - そのうち Saitamaar にもあり、幅が同じもの（MS Pゴシックの無い PC では、これだけを足せる）
// 字形は持たない（幅だけ）。Saitamaar（webapp/static/fonts/saitamaar/。python -m webapp.get_fonts）と、
// Python の fontTools（requirements-webapp.txt）が要る。
//
// 形式: {"font": ..., "size": 16, "runs": [間, 数, 幅, Saitamaar, 間, 数, 幅, Saitamaar, ...]}
//   続いた符号位置で、幅と Saitamaar の可否（描けるなら 1）が同じものを 1 つのまとまりにする。
//   まとまりの最初の符号位置 = 前のまとまりの最後 + 1 + 間（最初のまとまりは 0 + 間）、数はまとまりの文字の数。
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "../aaeval/webapp_test/cdp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "static", "addable.json");
const SAITAMAAR = join(HERE, "static", "fonts", "saitamaar", "Saitamaar-Regular.woff2");
const MIN_W = 3, MAX_W = 16;

// MS Pゴシックの文字の一覧と、Saitamaar の文字ごとの 16px の送り幅（Saitamaar は 1 画素が 80 単位なので整数になる）
const py = `
import json, sys
from fontTools.ttLib import TTCollection, TTFont
m = TTCollection("C:/Windows/Fonts/msgothic.ttc").fonts[2].getBestCmap()
s = TTFont(sys.argv[1])
upem = s["head"].unitsPerEm
hm = s["hmtx"]
print(json.dumps({"mspgothic": sorted(m), "saitamaar": {cp: hm[g][0] * 16 / upem for cp, g in s.getBestCmap().items()}}))
`;
const { mspgothic, saitamaar } = JSON.parse(execFileSync("python", ["-c", py, SAITAMAAR], { maxBuffer: 1 << 26 }).toString());

// MS Pゴシックの幅はブラウザで測る（辞書の 551 文字の幅と一致する。Pillow の幅は 15 文字で違う）
const b = await launch({ port: 9382 });
let widths;
try {
  widths = await b.eval(`(() => {
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = '16px "ＭＳ Ｐゴシック"';
    return ${JSON.stringify(mspgothic)}.map((cp) => ctx.measureText(String.fromCodePoint(cp)).width);
  })()`);
} finally {
  await b.close();
}

const runs = [];
let n = 0, ns = 0;
mspgothic.forEach((cp, i) => {
  const w = widths[i];
  if (!(Number.isInteger(w) && w >= MIN_W && w <= MAX_W)) return;
  const s = saitamaar[cp] === w ? 1 : 0;
  n++;
  ns += s;
  const last = runs[runs.length - 1];
  if (last && last[1] === cp - 1 && last[2] === w && last[3] === s) last[1] = cp;
  else runs.push([cp, cp, w, s]);
});
const flat = [];
let next = 0;
for (const [a, z, w, s] of runs) {
  flat.push(a - next, z - a + 1, w, s);
  next = z + 1;
}
writeFileSync(OUT, JSON.stringify({
  note: "足せる文字と MS Pゴシック 16px の幅（webapp/make_addable.mjs）。runs: [間, 数, 幅, Saitamaar で描けるなら 1, ...]",
  font: "MS PGothic", size: 16, runs: flat,
}));
console.log(`${OUT}: ${n} 文字（Saitamaar でも描ける ${ns} 文字）、${runs.length} のまとまり`);
