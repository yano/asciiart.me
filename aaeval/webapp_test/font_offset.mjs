// 表示フォントで canvas に描いた AA と、同じ AA をブラウザが文字として表示したものを撮る（縦位置の確認用）。
// node font_offset.mjs <出力フォルダ>
import { launch } from "./cdp.mjs";
import { writeFileSync } from "node:fs";
const [out] = process.argv.slice(2);
const b = await launch({ width: 1400, height: 900, port: 9343 });
const log = [];
try {
  await b.goto("http://127.0.0.1:8765/");
  await b.waitFor("document.querySelector('#font option') !== null");
  for (const id of ["saitamaar", "textar", "ume", "robotojaa", "monapo"]) {
    const r = await b.eval(`(async () => {
      const { Renderer, GlyphTable } = await import("./aa.js");
      const fonts = (await (await fetch("fonts.json")).json()).fonts;
      const table = new GlyphTable(await (await fetch("glyphs.json")).json());
      const rd = new Renderer(table);
      await rd.setFont(fonts.find((f) => f.id === "${id}"));
      document.body.innerHTML = "";
      document.body.style.margin = "0";
      document.body.style.background = "#fff";
      const lines = ["　 ,ｨ´￣｀ヽ、|ﾞ　／￣＼", "　{　　　 　 } 　 lヽ　＿ﾉ", "（´・ω・｀）　Ｌ＿＿」|||"];
      const div = document.createElement("div");
      div.style.cssText = 'position:absolute;left:10px;top:10px;font:16px "AA_${id}";line-height:18px;white-space:pre;color:#000';
      div.textContent = lines.join(String.fromCharCode(10));
      document.body.append(div);
      const c = rd.draw(lines);
      c.style.cssText = "position:absolute;left:10px;top:100px";
      document.body.append(c);
      return rd.baseline;
    })()`);
    await new Promise((r) => setTimeout(r, 300));
    await b.shot(`${out}/fo_${id}.png`, { x: 0, y: 0, width: 600, height: 170 });
    log.push(`${id} baseline ${r}`);
  }
} catch (e) { log.push("ERROR " + e.stack); }
finally { writeFileSync(`${out}/fo_log.txt`, log.join("\n")); await b.close(); }
