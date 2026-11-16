#coding:utf-8
"""画面で AA を描くための文字の表（webapp/static/glyphs.json）を作る。Windows 専用。

ブラウザは AA を MS Pゴシック 16px で表示する。MS Pゴシックは Windows にしか無いので、
画面ではフォントを使わず、この表の形を canvas に並べて描く（どの OS でも同じ見た目になる）。

形は実際のフォントから描く。当てはめ用の辞書（aame.make_dict が同じフォントから作る
chrDict_20261115_utf8.txt）と、文字の送り幅の中では同じ形になる。辞書と違って、ブラウザの表示に
合わせるため、送り幅の外にはみ出すインク（f の右端など）も持つ。

使い方:
    python -m webapp.make_glyphs

表の形式（JSON）:
    {"font": ..., "size": 16, "row_h": 18,
     "glyphs": [[文字, 送り幅, x0, y0, [行0のビット, 行1のビット, ...]], ...]}
    x0, y0 はインクの範囲の左上（行の左上、文字の描き始めの位置から測る）。
    行のビット k は x0 + k の画素。インクの無い文字（空白）は行の配列が空。
"""

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from aame import convert
from aame.glyphs import ROW_H

FONT_PATH = "C:/Windows/Fonts/msgothic.ttc"
FONT_INDEX = 2          # 0: MS Gothic, 1: MS UI Gothic, 2: MS PGothic
FONT_SIZE = 16
Y_OFFSET = 2            # 行の上端から文字の描画原点まで（aaeval.render と同じ）
PAD = 8                 # はみ出しを拾うための余白
OUT = Path(__file__).resolve().parent / "static" / "glyphs.json"


def glyph_ink(font, ch, width):
    """文字のインク（True がインク）と、その左上の位置 (x0, y0) を返す。無ければ None。"""
    im = Image.new("L", (width + 2 * PAD, ROW_H + 2 * PAD), 255)
    dr = ImageDraw.Draw(im)
    dr.fontmode = "1"       # アンチエイリアスなし（埋め込みビットマップをそのまま使う）
    dr.text((PAD, PAD + Y_OFFSET), ch, font=font, fill=0)
    ink = np.asarray(im) < 128
    if not ink.any():
        return None
    ys, xs = np.nonzero(ink)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    assert 0 < y0 and y1 < ink.shape[0] and 0 < x0 and x1 < ink.shape[1], ch
    return ink[y0:y1, x0:x1], (int(x0) - PAD, int(y0) - PAD)


def build():
    font = ImageFont.truetype(FONT_PATH, FONT_SIZE, index=FONT_INDEX)
    glyphs = convert.glyph_set()
    table = []
    for ch, w in zip(glyphs.chars, glyphs.widths.tolist()):
        found = glyph_ink(font, ch, w)
        if found is None:
            table.append([ch, w, 0, 0, []])
            continue
        ink, (x0, y0) = found
        assert ink.shape[1] <= 31, ch       # JavaScript のビット演算（32 ビット）に収める
        rows = [int(sum(1 << k for k in np.nonzero(r)[0])) for r in ink]
        table.append([ch, w, x0, y0, rows])
    return {"font": "MS PGothic", "size": FONT_SIZE, "row_h": ROW_H, "glyphs": table}


def main():
    data = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(OUT, len(data["glyphs"]), "文字")


if __name__ == "__main__":
    main()
