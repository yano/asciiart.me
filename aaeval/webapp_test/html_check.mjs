import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const dir = process.argv[2];
const { toHtml, toText } = await import(pathToFileURL(process.argv[3]).href);
const cases = JSON.parse(readFileSync(dir + "/lines.json", "utf8"));
let ok = true;
for (const [name, lines] of Object.entries(cases)) {
  const py = readFileSync(`${dir}/py_${name}.html`, "utf8");
  const js = toHtml(lines);
  const same = py === js;
  ok &&= same;
  console.log(name, same ? "same" : "DIFF", js.length);
}
process.exit(ok ? 0 : 1);
