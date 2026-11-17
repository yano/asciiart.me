// 仕上げの「陰影」（webapp/static/shade.js）を確かめる。
//   node aaeval/js/shade_check.mjs [AA のテキスト ...]
// 標準の辞書の文字で作った行（乱数）と、渡した AA のテキストのすべての空白の並びを、陰影の文字（SHADE_CHARS）× 高密度・低密度で埋めて、
//   - 空白でない文字は変わらない（順も同じ）
//   - 行の途中の空白の並びは、幅が変わらない（行の幅が変わらない）。行の終わりの並びは AA の右端の近く
//   - 半角スペースを続けない・行頭に置かない
//   - 入るのは陰影の文字と、余りを埋める細い文字（.）と空白だけ（陰影の文字が入らなかった並びは数えて出す）
// を確かめる。つながりの見つけ方（regionOf）は、押した並びを含み、上下の行だけをたどることを見る。
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const S = await import(pathToFileURL(resolve(ROOT, "webapp/static/shade.js")));
const glyphs = JSON.parse(readFileSync(resolve(ROOT, "webapp/static/glyphs.json"), "utf8")).glyphs;
const W = new Map(glyphs.map((g) => [g[0], g[1]]));
const widthOf = (ch) => W.get(ch) ?? 16;
const lineWidth = (s) => [...s].reduce((w, c) => w + widthOf(c), 0);
const ink = glyphs.map((g) => g[0]).filter((c) => !S.isBlank(c));
// 陰影の文字 × 高密度・低密度
const patterns = S.SHADE_CHARS.flatMap((ch) => ["dense", "sparse"].map((d) => [`${ch} ${d}`, S.makePattern(ch, d, widthOf)]));

// 乱数の行（エンジンと同じ決まりの空白: 半角を続けない・行頭に置かない）
let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
function randomLine(width) {
  let s = "", w = 0, half = true;
  while (w < width) {
    const r = rand();
    let ch;
    if (r < 0.45) ch = S.FULL;
    else if (r < 0.75 && !half) ch = S.HALF;
    else ch = ink[Math.floor(rand() * ink.length)];
    half = ch === S.HALF;
    s += ch;
    w += widthOf(ch);
  }
  return s;
}

const problems = [];
let runsDone = 0, unfilled = 0;
function check(name, lines, right) {
  const runs = S.blankRuns(lines, widthOf);
  for (const [k, pattern] of patterns) {
    // 並びを 1 つずつ埋める（つながりはたどらない）
    for (const run of runs.flat()) {
      const out = S.shadeLines(lines, [run], pattern, widthOf, right);
      const after = out.get(run.row) ?? lines[run.row];
      const before = lines[run.row];
      const where = `${name} ${k} 行 ${run.row + 1} の ${run.a}px`;
      if (after.includes(S.HALF + S.HALF)) problems.push(`${where}: 半角スペースが続く`);
      if (after.startsWith(S.HALF)) problems.push(`${where}: 行頭が半角スペース`);
      // 並びの前と後ろは元のまま。並びの所（fill）だけが変わる
      const chars = [...after], orig = [...before];
      const tail = orig.length - run.i1;
      const fill = chars.slice(run.i0, chars.length - tail).join("");
      if (chars.slice(0, run.i0).join("") !== orig.slice(0, run.i0).join("") || chars.slice(chars.length - tail).join("") !== orig.slice(run.i1).join(""))
        problems.push(`${where}: 並びの外が変わった`);
      const fw = lineWidth(fill);
      if (!run.last && fw !== run.b - run.a) problems.push(`${where}: 幅が ${run.b - run.a} → ${fw}`);
      if (run.last) {
        const end = run.a + fw, target = Math.max(run.b, right);
        if (Math.abs(end - target) > 6) problems.push(`${where}: 行の終わりが ${end}（右端 ${target}）`);
      }
      if ([...fill].some((c) => !S.isBlank(c) && c !== pattern.ch && c !== pattern.filler)) problems.push(`${where}: 陰影でない文字が入った`);
      runsDone++;
      if (!fill.includes(pattern.ch) && run.b - run.a >= 16) unfilled++;
    }
  }
  // つながり: 押した並びを含み、すべて上下にたどれる
  for (const start of runs.flat().slice(0, 40)) {
    const region = S.regionOf(runs, start);
    if (!region.includes(start)) problems.push(`${name}: つながりに押した並びが無い`);
    const rows = new Set(region.map((r) => r.row));
    for (const r of rows) if (r !== start.row && !rows.has(r - 1) && !rows.has(r + 1)) problems.push(`${name}: 行 ${r + 1} が離れている`);
  }
}

const random = Array.from({ length: 40 }, () => randomLine(400 + Math.floor(rand() * 200)));
check("乱数", random, 600);
for (const file of process.argv.slice(2)) {
  const lines = readFileSync(file, "utf8").replace(/\r/g, "").split("\n").filter((l, i, a) => i < a.length - 1 || l);
  check(file, lines, Math.max(...lines.map(lineWidth)));
}
console.log(`空白の並び ${runsDone} 個を埋めた（幅 16px 以上で陰影の文字が入らなかったもの ${unfilled}）`);
console.log(problems.length ? problems.slice(0, 20).join("\n") + (problems.length > 20 ? `\n…ほか ${problems.length - 20}` : "") : "ok");
process.exit(problems.length ? 1 : 0);
