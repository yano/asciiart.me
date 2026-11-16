#coding:utf-8
"""当てはめ用の辞書を、いまの MS Pゴシックで描き直す。Windows 専用。

もとの辞書（chrDict_20170327_utf8.txt）は 2017 年当時のフォントから作られていて、
いまの MS Pゴシック（v5.32）とは 34 文字・91 画素違う（「－」「＜」「＞」「→」「～」など）。
同じ文字・同じ順番・同じ幅のまま、形だけを描き直した辞書を DICT_FILE に書く。

文字の形は、ブラウザ（Edge）が MS Pゴシック 16px で表示するものと同じになる
（埋め込みビットマップをそのまま使う。webapp/make_glyphs.py と同じ描き方）。
送り幅の外にはみ出すインクは、辞書の形式では持てないので落とす。

使い方:
    python -m aame.make_dict              # 辞書を書き、もとの辞書との違いを表示する

形式はもとの辞書と同じ（1行目が文字数。文字ごとに、文字、幅、18 行の 0/1）。
"""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from aame.glyphs import DICT_FILE, LEGACY_DICT_FILE, ROW_H, load

FONT_PATH = "C:/Windows/Fonts/msgothic.ttc"
FONT_INDEX = 2          # 0: MS Gothic, 1: MS UI Gothic, 2: MS PGothic
FONT_SIZE = 16
Y_OFFSET = 2            # 行の上端から文字の描画原点まで（もとの辞書の 517 文字がこれで一致する）
PAD = 8


def draw(font, ch, width):
    """文字の形（True がインク）を (ROW_H, width) で返す。"""
    im = Image.new("L", (width + 2 * PAD, ROW_H + 2 * PAD), 255)
    dr = ImageDraw.Draw(im)
    dr.fontmode = "1"       # アンチエイリアスなし（埋め込みビットマップをそのまま使う）
    dr.text((PAD, PAD + Y_OFFSET), ch, font=font, fill=0)
    return (np.asarray(im) < 128)[PAD:PAD + ROW_H, PAD:PAD + width]


def build(source=LEGACY_DICT_FILE):
    """もとの辞書の文字・順番・幅で、形をいまのフォントから描いた GlyphSet を返す。"""
    old = load(source)
    font = ImageFont.truetype(FONT_PATH, FONT_SIZE, index=FONT_INDEX)
    bitmaps = np.zeros_like(old.bitmaps)
    for i, (ch, w) in enumerate(zip(old.chars, old.widths.tolist())):
        bitmaps[i, :, :w] = draw(font, ch, w)
    return old, type(old)(old.chars, old.widths, bitmaps)


def write(glyphs, path):
    """辞書の形式で書く（改行は CRLF。もとの辞書と同じ）。"""
    out = [str(len(glyphs))]
    for ch, w, bm in zip(glyphs.chars, glyphs.widths.tolist(), glyphs.bitmaps):
        out.append(ch)
        out.append(str(w))
        out.extend("".join("1" if v else "0" for v in row[:w]) for row in bm)
    Path(path).write_text("\r\n".join(out) + "\r\n", encoding="utf-8", newline="")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--output", default=str(DICT_FILE))
    ap.add_argument("--diff", help="形が変わった文字の一覧を書くファイル（UTF-8）")
    a = ap.parse_args()
    old, new = build()
    write(new, a.output)
    diff = (old.bitmaps != new.bitmaps).reshape(len(old), -1).sum(1)
    changed = [(old.chars[i], int(diff[i])) for i in np.nonzero(diff)[0]]
    print(a.output)
    print(f"{len(old)} 文字のうち {len(changed)} 文字、{int(diff.sum())} 画素を描き直した")
    if a.diff:
        Path(a.diff).write_text("".join(f"{ch}\tU+{ord(ch):04X}\t{n}\n" for ch, n in changed),
                                encoding="utf-8")


if __name__ == "__main__":
    main()
