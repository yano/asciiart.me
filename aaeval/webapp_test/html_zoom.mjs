// 書き出した .html（MS Pゴシック）を、ブラウザの拡大率を変えて開き、文字の位置が辞書の幅どおりかを測る。
// node html_zoom.mjs <出力フォルダ> <AA の html> [拡大率...]
import { launch } from "./cdp.mjs";
import { writeFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const [out, html, ...zs] = process.argv.slice(2);
const zooms = zs.length ? zs.map(Number) : [1, 1.1, 1.25, 1.5];
const glyphs = JSON.parse(readFileSync(new URL("../../webapp/static/glyphs.json", import.meta.url), "utf8"));
const W = new Map(glyphs.glyphs.map(([ch, w]) => [ch, w]));
const log = [];
let port = 9351;
for (const z of zooms) {
  const b = await launch({ width: 1400, height: 1000, scale: z, port: port++ });
  try {
    await b.goto(pathToFileURL(resolve(html)).href);
    const r = await b.eval(`(() => {
      const div = document.querySelector("div");
      const nobr = div.querySelector("nobr");
      const rows = [];
      let row = [];
      const range = document.createRange();
      for (const n of nobr.childNodes) {
        if (n.nodeName === "BR") { rows.push(row); row = []; continue; }
        if (n.nodeType !== 3) continue;
        let k0 = 0; while (k0 < n.data.length && (n.data.charCodeAt(k0) === 10 || n.data.charCodeAt(k0) === 13)) k0++;
        const s = n.data.slice(k0);
        const off = n.data.length - s.length;
        let i = 0;
        for (const ch of s) {
          const L = ch.length;
          range.setStart(n, off + i); range.setEnd(n, off + i + L);
          const b = range.getBoundingClientRect();
          row.push([ch, b.left, b.width, b.top]);
          i += L;
        }
      }
      const x0 = div.getBoundingClientRect().left;
      return { rows, x0, top: div.getBoundingClientRect().top };
    })()`);
    // 行の右端が、辞書の幅を足した位置にあるか（文字ごとの位置は、半角の濁点などで Range の値が
    // 前の文字とまとまることがあるので、行の端だけで比べる）
    const ends = [];
    for (const row of r.rows) {
      if (!row.length) continue;
      let x = 0;
      for (const [ch] of row) x += W.get(ch) ?? 0;
      const [, left, w] = row[row.length - 1];
      ends.push(+(left + w - r.x0 - x).toFixed(2));
    }
    const off = ends.filter((d) => Math.abs(d) >= 0.5);
    const worst = Math.max(0, ...ends.map(Math.abs));
    log.push(`zoom ${z}: rows ${ends.length}, rows whose end is off by >=0.5 CSS px: ${off.length}, worst ${worst.toFixed(2)} CSS px; first 12: ${ends.slice(0, 12).join(" ")}`);
    await b.shot(`${out}/html_zoom_${z}.png`);
  } catch (e) { log.push(`zoom ${z}: ERROR ${e.stack}`); }
  finally { await b.close(); }
}
writeFileSync(`${out}/html_zoom_log.txt`, log.join("\n"), "utf-8");
console.log(log.join("\n"));
