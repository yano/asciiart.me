import { launch } from "./cdp.mjs";
import { readdirSync, mkdirSync } from "node:fs";
const lab = process.argv[2];
mkdirSync(`${lab}/shots2`, { recursive: true });
const b = await launch({ width: 900, height: 1100, port: 9337 });
try {
  for (const f of readdirSync(`${lab}/rematch`)) {
    const m = f.match(/^(.*)_(standard|color_all)_(.*)\.json$/);
    if (!m || m[3] === "dict") continue;
    await b.goto(`http://127.0.0.1:8770/aa.html?f=${encodeURIComponent(m[3])}&lines=${encodeURIComponent("rematch/" + f)}`);
    await b.waitFor("window.__ready === true", 60000);
    await b.shot(`${lab}/shots2/${f.replace(/\.json$/, "")}.png`);
  }
} catch (e) { console.log("ERROR", e.message); }
await b.close();
process.exit(0);
