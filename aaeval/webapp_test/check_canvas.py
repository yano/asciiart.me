"""aa.js の canvas 描画が、Edge の MS Pゴシック表示と画素単位で一致するか確かめる。"""
import json, subprocess, sys, tempfile
from pathlib import Path
import numpy as np
from PIL import Image
sys.path.insert(0, ".")
from aame import convert
from aaeval import render

EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
ROOT = Path(".").resolve()
OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)

def shot(html_path, w, h):
    png = OUT / (html_path.stem + ".png")
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run([EDGE, "--headless", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
                        f"--window-size={w},{h}", f"--user-data-dir={Path(tmp)/'p'}", "--virtual-time-budget=3000",
                        f"--screenshot={png}", html_path.resolve().as_uri()], check=True, capture_output=True, timeout=120)
    return np.asarray(Image.open(png).convert("L")) < 128

def all_glyph_lines():
    g = convert.glyph_set()
    lines, cur, w = [], "", 0
    for ch, cw in zip(g.chars, g.widths.tolist()):
        if ch == " ":
            continue
        if w + cw > 760:
            lines.append(cur); cur, w = "", 0
        cur += ch; w += cw
        if len(cur) % 7 == 3 and w + 5 < 760:   # 半角スペースもときどき挟む
            cur += " "; w += 5
    lines.append(cur)
    return lines

aajs = (ROOT / "webapp/static/aa.js").read_text(encoding="utf-8").replace("export ", "")
glyphs = (ROOT / "webapp/static/glyphs.json").read_text(encoding="utf-8")
cases = {"allglyphs": all_glyph_lines()}
for name in sys.argv[2:]:
    cases[Path(name).stem] = render.html_to_lines(Path(name).read_text(encoding="utf-8"))
ok = True
for name, lines in cases.items():
    html_path = OUT / f"{name}_font.html"
    html_path.write_text(convert.to_html(lines, "v2").replace("<body>", "<body style=\"margin:0\">"), encoding="utf-8", newline="\n")
    canvas_path = OUT / f"{name}_canvas.html"
    canvas_path.write_text(f"""<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0"><canvas id="c" style="display:block"></canvas><script>
{aajs}
const t = new GlyphTable({glyphs});
paint(document.getElementById("c"), drawAA(t, {json.dumps(lines, ensure_ascii=False)}));
</script></body></html>""", encoding="utf-8", newline="\n")
    mine = render.render_lines(lines)
    h, w = mine.shape
    A = shot(html_path, w + 40, h + 40)
    B = shot(canvas_path, w + 40, h + 40)
    # 全体の位置のずれ（どちらの向きも）を探して、最もよく合う所で比べる
    best = None
    for oy in range(-4, 5):
        for ox in range(-4, 5):
            a = A[max(oy, 0):max(oy, 0) + h, max(ox, 0):max(ox, 0) + w]
            b = B[max(-oy, 0):max(-oy, 0) + h, max(-ox, 0):max(-ox, 0) + w]
            n = int((a != b).sum())
            if best is None or n < best[0]:
                best = (n, oy, ox)
    n, oy, ox = best
    print(f"{name}: {len(lines)} rows, ink {int(B.sum())} px, Edge vs canvas diff {n} px (font page offset y={-oy:+d} x={-ox:+d})")
    ok &= n == 0
sys.exit(0 if ok else 1)
