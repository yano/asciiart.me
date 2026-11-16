// 各フォントで、文字の送り幅と形（画面の写真）、AA の表示を撮る。
// node fontlab_measure.mjs <fontlab フォルダ> [ケース名...]
import { launch } from "./cdp.mjs";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const lab = process.argv[2];
const extra = process.argv.slice(3);
const { fonts } = JSON.parse(readFileSync(`${lab}/fonts.json`, "utf8"));
const cases = Object.keys(JSON.parse(readFileSync(`${lab}/cases.json`, "utf8")));
mkdirSync(`${lab}/shots`, { recursive: true });
const b = await launch({ width: 1000, height: 1000, port: 9336 });
const result = { widths: {}, lineWidths: {} };
try {
  for (const f of fonts) {
    await b.goto(`http://127.0.0.1:8770/glyphs.html?f=${encodeURIComponent(f)}`);
    await b.waitFor("window.__ready === true", 60000);
    result.widths[f] = await b.eval("window.__widths");
    await b.send("Emulation.setDeviceMetricsOverride", { width: 720, height: 620, deviceScaleFactor: 1, mobile: false });
    await b.shot(`${lab}/shots/glyphs_${f}.png`);
    result.lineWidths[f] = {};
    for (const n of [...cases, ...extra]) {
      const isFile = n.endsWith(".json");
      const url = isFile ? `aa.html?f=${encodeURIComponent(f)}&lines=${encodeURIComponent(n)}` : `aa.html?f=${encodeURIComponent(f)}&n=${n}`;
      await b.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 1100, deviceScaleFactor: 1, mobile: false });
      await b.goto(`http://127.0.0.1:8770/${url}`);
      await b.waitFor("window.__ready === true", 60000);
      const key = isFile ? n.replace(/\.json$/, "") : n;
      result.lineWidths[f][key] = await b.eval("window.__widths");
      await b.shot(`${lab}/shots/aa_${key.replace(/[\\/]/g, "_")}_${f}.png`);
    }
    console.log("done", f);
  }
} catch (e) {
  console.log("ERROR", e.message);
} finally {
  writeFileSync(`${lab}/measure.json`, JSON.stringify(result), "utf8");
  await b.close();
}
process.exit(0);
