"""フォント比較用のページを作る。python fontlab_make.py <フォントのフォルダ> <出力フォルダ> <AA の html>..."""
import html, json, shutil, sys
from pathlib import Path
sys.path.insert(0, ".")
from fontTools.ttLib import TTFont
from aame import convert
from aaeval import render

FONTS = [  # (id, ファイル)  id "mspg" はシステムの MS Pゴシック
    ("mspg", None), ("Saitamaar", "Saitamaar.ttf"), ("saitamaar_light", "saitamaar_light.ttf"),
    ("SaitamaarShin", "SaitamaarShin.ttf"), ("SaitamaarMini", "SaitamaarMini.ttf"),
    ("AA-PGothic-16px", "AA-PGothic-16px.ttf"), ("monapo", "monapo.ttf"), ("aahub", "aahub.ttf"),
    ("aahub_light", "aahub_light.ttf"), ("aahub_light4", "aahub_light4.ttf"), ("ipamona", "ipamona.ttf"),
    ("textar", "textar.ttf"), ("textar-min", "textar-min.ttf"), ("ume-pgc4", "ume-pgc4.ttf"),
    ("RobotoJAA", "RobotoJAA-Regular.ttf"), ("monaya", "monaya.ttf"), ("giko2", "giko2.ttf"),
]

src, out = Path(sys.argv[1]), Path(sys.argv[2])
(out / "f").mkdir(parents=True, exist_ok=True)
chars = convert.glyph_set().chars
missing = {}
faces = []
for fid, fn in FONTS:
    if fn is None:
        continue
    shutil.copy(src / fn, out / "f" / fn)
    cmap = TTFont(src / fn, lazy=True).getBestCmap()
    missing[fid] = [c for c in chars if ord(c) not in cmap and c not in " "]
    faces.append(f'@font-face {{ font-family: "F_{fid}"; src: url("f/{fn}"); }}')
family = {fid: ('"MS PGothic"' if fn is None else f'"F_{fid}"') for fid, fn in FONTS}
css = "\n".join(faces)
(out / "fonts.json").write_text(json.dumps({"fonts": [f for f, _ in FONTS], "family": family, "missing": missing},
                                           ensure_ascii=False), encoding="utf-8")

COLS, CW, CH, OX, OY = 25, 28, 26, 6, 4
(out / "glyphs.html").write_text(f"""<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
{css}
body {{ margin: 0; background: #fff; }}
.g {{ position: absolute; font-size: 16px; line-height: 18px; white-space: pre; color: #000; }}
</style></head><body><script>
const FAMILY = {json.dumps(family)};
const CHARS = {json.dumps(chars, ensure_ascii=False)};
const fid = new URLSearchParams(location.search).get("f");
const fam = FAMILY[fid];
(async () => {{
  if (fid !== "mspg") await document.fonts.load(`16px ${{fam}}`, CHARS.join(""));
  const widths = [];
  CHARS.forEach((ch, i) => {{
    const d = document.createElement("div");
    d.className = "g";
    d.style.fontFamily = fam;
    d.style.left = ((i % {COLS}) * {CW} + {OX}) + "px";
    d.style.top = (Math.floor(i / {COLS}) * {CH} + {OY}) + "px";
    d.textContent = ch;
    document.body.append(d);
    widths.push(d.getBoundingClientRect().width);
  }});
  window.__widths = widths;
  window.__ready = true;
}})();
</script></body></html>""", encoding="utf-8")

cases = {}
for p in sys.argv[3:]:
    cases[Path(p).stem] = render.html_to_lines(Path(p).read_text(encoding="utf-8"))
(out / "cases.json").write_text(json.dumps(cases, ensure_ascii=False), encoding="utf-8")
(out / "aa.html").write_text(f"""<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
{css}
body {{ margin: 0; background: #fff; }}
.aa {{ font-size: 16px; line-height: 18px; white-space: nowrap; color: #000; }}
</style></head><body><div class="aa" id="aa"></div><script>
const FAMILY = {json.dumps(family)};
const q = new URLSearchParams(location.search);
const fam = FAMILY[q.get("f")];
(async () => {{
  const cases = await (await fetch("cases.json")).json();
  const lines = q.get("lines") ? JSON.parse(await (await fetch(q.get("lines"))).text()) : cases[q.get("n")];
  const el = document.getElementById("aa");
  el.style.fontFamily = fam;
  if (q.get("f") !== "mspg") await document.fonts.load(`16px ${{fam}}`, lines.join(""));
  const widths = [];
  for (const s of lines) {{
    const span = document.createElement("span");
    span.textContent = s;
    el.append(span, document.createElement("br"));
    widths.push(span.getBoundingClientRect().width);
  }}
  window.__widths = widths;
  window.__ready = true;
}})();
</script></body></html>""", encoding="utf-8")
print("ok", {k: len(v) for k, v in missing.items() if v})
