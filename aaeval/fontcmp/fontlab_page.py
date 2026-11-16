"""フォントの比較のページを作る。python fontlab_page.py <fontlab> <出力フォルダ>"""
import html, json, shutil, sys
from pathlib import Path
import numpy as np
from PIL import Image

lab, out = Path(sys.argv[1]), Path(sys.argv[2])
(out / "img").mkdir(parents=True, exist_ok=True)
rows = json.loads((lab / "analysis.json").read_text(encoding="utf-8"))
m = json.loads((lab / "measure.json").read_text(encoding="utf-8"))

LICENSE = {
    "mspg": ("Windows 付属", "配布できない（Windows 以外には無い）"),
    "Saitamaar": ("keage 氏", "フォントにライセンスの記載なし。配布元で要確認"),
    "saitamaar_light": ("Saitamaar の軽量版", "同上。AA でよく使う文字だけ（辞書の 32 文字が無い）"),
    "SaitamaarShin": ("ぜりー氏（Codeberg）", "「public domain」とあるが、形は新しい MS Pゴシックから取ったもの"),
    "SaitamaarMini": ("ぜりー氏（Codeberg）", "同上。12px 用の形"),
    "AA-PGothic-16px": ("ぜりー氏（Codeberg）", "形は MS Pゴシック v5.32 から取ったと明記"),
    "monapo": ("2ch の有志", "Public Domain と記載（東雲・Kochi 代替が元）"),
    "aahub": ("aahub", "monapo が元。記載は monapo と同じ"),
    "aahub_light": ("aahub", "aahub の軽量版（辞書の 97 文字が無い）"),
    "aahub_light4": ("aahub", "RobotoJAA が元（Apache 2.0 など）。辞書の 32 文字が無い"),
    "ipamona": ("IPA フォントを改変", "IPA Font License v1.0"),
    "textar": ("textar-font（IPA Pゴシックを改変）", "IPA Font License v1.0"),
    "textar-min": ("textar の軽量版", "IPA Font License v1.0"),
    "ume-pgc4": ("梅フォント", "自由に利用・改変・再配布できる（商用も可）"),
    "RobotoJAA": ("Roboto などの合成", "Apache License 2.0（元のフォントのライセンスも同梱）"),
    "monaya": ("tuboroidkai", "フォントにライセンスの記載なし"),
    "giko2": ("MS Pゴシックを変換したもの", "MS Pゴシックの複製。配布は不可と考えるべき"),
}
LABEL = {"mspg": "MS Pゴシック"}


def crop(src, dst, box=None):
    im = Image.open(src).convert("RGB")
    a = np.asarray(im.convert("L")) < 250
    if box is None:
        ys, xs = np.nonzero(a)
        box = (0, 0, int(xs.max()) + 4, int(ys.max()) + 4) if len(xs) else (0, 0, 10, 10)
    im.crop(box).save(out / "img" / dst)
    return dst


FACE = {"luckystar01_color_all": (150, 160, 470, 420), "miku_standard": (130, 90, 450, 350),
        "luckystar01_standard": (150, 160, 470, 420), "miku_color_all": (130, 90, 450, 350)}

parts = []
parts.append("""<h2>1. 文字の幅と形</h2>
<p>辞書の 551 文字を各フォントで Edge に表示して測った。<b>幅が同じ</b>なら、MS Pゴシック用の AA が崩れずに表示できる。
「行のずれ」は、下の2つの AA で、行の幅が MS Pゴシックと最も違った所の px。「濃さ」はインクの量（MS Pゴシック = 1）。</p>
<table><tr><th>フォント</th><th>幅が同じ文字</th><th>無い文字</th><th>行のずれ</th><th>濃さ</th><th>出どころ</th><th>ライセンス（フォントの記載と配布元から）</th></tr>""")
for r in rows:
    who, lic = LICENSE.get(r["font"], ("", ""))
    ok = "good" if r["width_same"] == r["width_total"] else ("near" if r["width_same"] >= 540 else "bad")
    parts.append(f"<tr class='{ok}'><td>{html.escape(LABEL.get(r['font'], r['font']))}</td><td>{r['width_same']}/{r['width_total']}</td>"
                 f"<td>{r['missing'] or ''}</td><td>{r['max_line_drift_px']} px</td><td>{r['ink_ratio']}</td>"
                 f"<td>{html.escape(who)}</td><td>{html.escape(lic)}</td></tr>")
parts.append("</table>")

for case, title in [("luckystar01_color_all", "luckystar01（全体に色の境界）"), ("miku_standard", "miku（標準）")]:
    parts.append(f"<h2>2. 同じ AA をフォントだけ変えて表示: {html.escape(title)}</h2>"
                 "<p>MS Pゴシック用に作った AA そのもの。顔のあたりを等倍で切り出した。押すと全体。</p><div class='grid'>")
    for r in rows:
        f = r["font"]
        full = crop(lab / "shots" / f"aa_{case}_{f}.png", f"full_{case}_{f}.png")
        face = crop(lab / "shots" / f"aa_{case}_{f}.png", f"face_{case}_{f}.png", FACE[case])
        base = np.array(m["lineWidths"]["mspg"][case]); lw = np.array(m["lineWidths"][f][case])
        drift = float(np.max(np.abs(lw - base)))
        parts.append(f"<a class='card' href='img/{full}'><div class='name'>{html.escape(LABEL.get(f, f))}</div>"
                     f"<div class='note'>行のずれ {drift:.1f} px</div><img src='img/{face}'></a>")
    parts.append("</div>")

COLS = [("dict", "MS Pゴシック（いまの辞書）"), ("mspg", "MS Pゴシック（いまのフォントで辞書を作り直し）"),
        ("Saitamaar", "Saitamaar"), ("AA-PGothic-16px", "AA-PGothic-16px"), ("textar", "textar"), ("monapo", "monapo")]
for case, title in [("luckystar01_color_all", "luckystar01（全体に色の境界）"), ("miku_standard", "miku（標準）")]:
    parts.append(f"<h2>3. そのフォントの形で辞書を作り直して当てはめ: {html.escape(title)}</h2>"
                 "<p>各フォントで Edge が描いた形を2値にして辞書にし（なめらかな所は濃さ 0.4 で切る）、同じ設定で当てはめ直した。"
                 "表示もそのフォント。押すと全体。</p><div class='grid'>")
    for key, label in COLS:
        src = lab / "shots" / f"aa_{case}_mspg.png" if key == "dict" else lab / "shots2" / f"{case}_{key}.png"
        full = crop(src, f"re_full_{case}_{key}.png")
        face = crop(src, f"re_face_{case}_{key}.png", FACE[case])
        parts.append(f"<a class='card' href='img/{full}'><div class='name'>{html.escape(label)}</div>"
                     f"<img src='img/{face}'></a>")
    parts.append("</div>")

parts.append("<h2>4. 文字の形（先頭の 150 文字、等倍）</h2><div class='glyphs'>")
for r in rows:
    f = r["font"]
    g = crop(lab / "shots" / f"glyphs_{f}.png", f"glyphs_{f}.png", (0, 0, 700, 156))
    parts.append(f"<div class='name'>{html.escape(LABEL.get(f, f))}</div><img src='img/{g}'>")
parts.append("</div>")

page = f"""<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><title>AA 用フォントの比較</title>
<style>
body {{ margin: 16px; background: #f4f4f4; font-family: sans-serif; font-size: 14px; color: #222; }}
h1 {{ font-size: 18px; }} h2 {{ font-size: 16px; margin-top: 28px; }}
table {{ border-collapse: collapse; background: #fff; }}
th, td {{ border: 1px solid #ccc; padding: 3px 8px; text-align: left; font-size: 13px; }}
tr.good td:nth-child(2) {{ background: #dff3df; }} tr.near td:nth-child(2) {{ background: #fff4d6; }}
tr.bad td:nth-child(2) {{ background: #fbe0e0; }}
.grid {{ display: flex; flex-wrap: wrap; gap: 12px; }}
.card {{ background: #fff; border: 1px solid #ccc; padding: 8px; color: #000; text-decoration: none; }}
.card:hover {{ border-color: #06c; }}
.name {{ font-weight: bold; font-size: 13px; }} .note {{ font-size: 12px; color: #555; }}
.card img, .glyphs img {{ display: block; image-rendering: pixelated; }}
.glyphs {{ background: #fff; padding: 8px; border: 1px solid #ccc; display: inline-block; }}
.glyphs .name {{ margin-top: 8px; }}
</style></head><body>
<h1>AA 用フォントの比較（fonts.aahub.org の 17 フォント + MS Pゴシック）</h1>
{''.join(parts)}
</body></html>"""
(out / "index.html").write_text(page, encoding="utf-8")
print(out / "index.html")
