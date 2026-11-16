#coding:utf-8
"""1枚の画像から、設定を変えた AA の候補をいくつか作り、見比べて選べるページを出す。

どの設定が合うかは絵によって違う（線で描かれた絵は「標準」、アニメの画面のように色の
塗り分けで描かれた絵は「色の境界」を足したほうがよい、など）ので、候補を並べて人が選ぶ。

使い方:
    python -m aame.candidates luckystar01.jpg --out out/pick
    python -m aame.candidates miku.png --out out/pick --only standard color_all

出力（--out の中）:
    <画像>_<候補>.html     それぞれの AA
    <画像>_index.html      候補を並べたページ（ブラウザで開く。枠を押すとその AA を開く）
    <画像>_source.jpg      元の画像（ページに載せる用）
"""

import argparse
import html
from pathlib import Path

from PIL import Image

from aame import convert
from aame.glyphs import ROW_H
from aame.session import Session

LINEART = "manga_line"
# 候補: (名前, 説明, 色の境界, 黒い面, 全体の lam)。顔の中の描き込みは、どれも FACE_GAIN 倍。
PRESETS = [
    ("standard", "標準: 線だけ", None, None, 2.0),
    ("color_face", "顔の中だけ色の境界を足す（瞳の形）", "face", None, 2.0),
    ("color_all", "全体に色の境界を足す（髪のハイライト、影）", "all", None, 2.0),
    ("fill_face", "顔の色の境界 + 黒い面を埋める（瞳を濃く）", "face", "face", 2.0),
    ("color_all_fill", "全体の色の境界 + 黒い面を埋める", "all", "face", 2.0),
    ("sparse", "標準より控えめ（線だけ、文字少なめ）", None, None, 1.5),
]
FACE_GAIN = 2.0
CARD_W = 400        # ページに並べるときの1枠の幅（px）

PAGE = u"""<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>{title}</title>
<style>
body {{ margin: 16px; background: #f4f4f4; font-family: sans-serif; }}
h1 {{ font-size: 18px; }}
.grid {{ display: flex; flex-wrap: wrap; gap: 16px; }}
.card {{ background: #fff; border: 1px solid #ccc; padding: 8px; color: #000; text-decoration: none; }}
.card:hover {{ border-color: #06c; }}
.name {{ font-size: 14px; font-weight: bold; }}
.note {{ font-size: 12px; color: #555; margin-bottom: 6px; }}
.box {{ overflow: hidden; }}
.aa {{ font-family: 'ＭＳ Ｐゴシック', 'MS PGothic'; font-size: 16px; line-height: 18px;
       white-space: nowrap; transform-origin: 0 0; }}
img {{ display: block; }}
</style>
</head>
<body>
<h1>{title}</h1>
<div class="grid">
{cards}
</div>
</body>
</html>
"""

CARD = u"""<a class="card" href="{href}">
<div class="name">{name}</div><div class="note">{note}</div>
<div class="box" style="width:{w}px;height:{h}px">{body}</div>
</a>"""


def settings(preset):
    """候補（PRESETS の1つ）を Session.render に渡す設定にする。"""
    name, note, color, fill, lam = preset
    return dict(lam=lam, color=color, fill=fill, face_gain=FACE_GAIN)


def make(image, only=None, session=None):
    """候補を作る。[(名前, 説明, 行のリスト)] と、線画の大きさ (高さ, 幅) を返す。

    途中結果（線の強さ、顔など）は session（aame.session.Session）に持たせて使い回す。
    """
    s = session or Session(image, LINEART)
    out = []
    for preset in PRESETS:
        name, note = preset[:2]
        if only and name not in only:
            continue
        out.append((name, note, s.render(**settings(preset))))
    return out, s.shape


def write(image_path, out_dir, only=None):
    """候補の AA と、並べたページを書き出す。ページのパスを返す。"""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = Path(image_path).stem
    image = Image.open(image_path)
    found, (height, width) = make(image, only)
    height = height // ROW_H * ROW_H
    scale = CARD_W / width
    box_h = int(height * scale) + 1

    source = out_dir / f"{stem}_source.jpg"
    image.convert("RGB").resize((CARD_W, box_h), Image.LANCZOS).save(source, quality=90)
    cards = [CARD.format(href=source.name, name="元の画像", note=html.escape(Path(image_path).name),
                         w=CARD_W, h=box_h, body=f'<img src="{source.name}" width="{CARD_W}" height="{box_h}">')]
    for name, note, lines in found:
        path = out_dir / f"{stem}_{name}.html"
        path.write_text(convert.to_html(lines, "v2"), encoding="utf-8", newline="\n")
        text = u"<br>".join(html.escape(s, quote=False) for s in lines)
        body = f'<div class="aa" style="transform:scale({scale:.4f});width:{width}px">{text}</div>'
        cards.append(CARD.format(href=path.name, name=name, note=html.escape(note),
                                 w=CARD_W, h=box_h, body=body))
    index = out_dir / f"{stem}_index.html"
    index.write_text(PAGE.format(title=html.escape(f"{stem}: AA の候補"), cards="\n".join(cards)),
                     encoding="utf-8", newline="\n")
    return index


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("images", nargs="+")
    ap.add_argument("--out", default="out/pick")
    ap.add_argument("--only", nargs="*", choices=[p[0] for p in PRESETS], help="作る候補を絞る")
    a = ap.parse_args()
    for p in a.images:
        print(write(p, a.out, a.only))


if __name__ == "__main__":
    main()
