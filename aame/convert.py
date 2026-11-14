#coding:utf-8
"""画像を AA にする（新しいエンジンの入口）。

使い方:
    python -m aame.convert miku.png                  # miku.html を出力
    python -m aame.convert miku.png -o out.html --mode legacy
    python -m aame.convert miku.png --lineart manga_line --width 2
    python -m aame.convert miku.png --mode v2 --lineart manga_line --lam 2
    python -m aame.convert miku.png --mode v2 --lineart manga_line --face-gain 2
    python -m aame.convert miku.png --mode v2 --lineart manga_line --mask painted.png --mask-gain 3
    python -m aame.convert anime.jpg --mode v2 --lineart manga_line --color-edges face --face-gain 2

mode:
    v1      既定。半角スペースの置き換えによる横ずれが無い
    legacy  現行の asciiartme.py と1文字も違わない出力（照合用）
    v2      ずれに寛容で線の向きも見るコスト（aame.cost）。線画は 1px の細い線にして渡す
            （--width は使わない）。描き込みの量は --lam で変える（大きいほど文字が増える）。
            場所ごとに変えるには --face-gain（顔を自動で見つける）か --mask（塗った画像）を使う。
            背の低い文字（_ - . など）は上下に --shift px までずらして当てる（0 でずらさない）。
            --fill で、黒い面（瞳など）を画数の多い文字で埋める
"""

import argparse
import html
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image

from aame import match
from aame.glyphs import GlyphSet

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

_STATE = {}


def _tools():
    """現行のモジュール（辞書の読み込み、前処理、HTML の前後）を1度だけ用意する。"""
    if not _STATE:
        from AA_ChrTool import ChrTool
        from AA_ImPro import ImPro
        tool = ChrTool()
        _STATE.update(tool=tool, impro=ImPro(), glyphs=GlyphSet.from_chr_list(tool.chrDict))
    return _STATE


def glyph_set():
    return _tools()["glyphs"]


def line_mask(image, method=None, width=2, color=None):
    """画像を線画にする。線が True の配列を返す。

    method を省くと現行の前処理（2値化して輪郭を取る。線は 2〜3px）をそのまま使う。
    method に aame.lineart の方法の名前を渡すと、その方法の線を 1px に細線化してから
    width の太さにする。color に "face" か "all" を渡すと、色の境界（瞳の形など、線では
    描かれていない塗り分けの境目）も線として足す。
    """
    if method is None:
        from asciiartme import resize_to_max
        return _tools()["impro"].edgeDetect(resize_to_max(image.convert("RGB"))) < 128
    from aame import lineart
    return lineart.binarize(lineart.strength(image, method, color), width=width)


def weight_map(image, shape, face_gain=1.0, mask_image=None, mask_gain=2.0):
    """場所ごとの描き込みの量（v2 の weight）。何も指定が無ければ None。

    顔（自動）と塗ったマスクの両方があるときは、大きいほうを取る。
    """
    from aame import regions
    size = (shape[1], shape[0])
    maps = []
    if face_gain != 1.0:
        maps.append(regions.face_weight(image, size, gain=face_gain))
    if mask_image is not None:
        maps.append(regions.mask_weight(mask_image, size, gain=mask_gain))
    if not maps:
        return None
    return maps[0] if len(maps) == 1 else np.maximum(*maps)


def fix_double_lines(text):
    """太い線が2重線（l!）になったものを直す（現行と同じ置き換え。幅は変わらない）。"""
    return text.replace(u"l!", u"|.").replace(u"j!", u"｝")


def finish(lines):
    """当てはめた並びを仕上げる（v1 用）。"""
    return [fix_double_lines(s) for s in lines]


def to_lines(mask, mode="v1", **options):
    """線画から AA の各行を作る。legacy では置き換え前の並びを返す（to_html で仕上げる）。

    options は v2 のコストの設定（lam など）。
    """
    lines = match.match(mask, glyph_set(), mode, **options)
    return lines if mode == "legacy" else finish(lines)


def to_html(lines, mode="v1"):
    tool = _tools()["tool"]
    if mode == "legacy":
        # 現行と同じ: 行頭に全角スペースを入れ、全体をつないでから置き換える
        body = u"".join(u"　" + s + u"<br>\r\n" for s in lines)
        body = fix_double_lines(body.replace(u"  ", u"　"))
    else:
        body = u"".join(html.escape(s, quote=False) + u"<br>\r\n" for s in lines)
    return tool.header1 + tool.header2 + body + tool.footer1 + tool.footer2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("-o", "--output")
    ap.add_argument("--mode", choices=["v1", "v2", "legacy"], default="v1")
    ap.add_argument("--lineart", help="線画にする方法（aame.lineart.METHODS の名前。省くと現行の前処理）")
    ap.add_argument("--width", type=int, default=2, help="--lineart を使うときの線の太さ（px）")
    ap.add_argument("--color-edges", choices=["face", "all"],
                    help="--lineart を使うとき、色の境界（瞳の形など）も線として足す。"
                         "face は顔の中だけ、all は絵の全体")
    ap.add_argument("--lam", type=float, default=2.0,
                    help="v2 の描き込みの量（線の取りこぼしの重み。1.5 で控えめ、3 で多め）")
    ap.add_argument("--phantom", type=float, default=1.5,
                    help="v2 で、何も無い所に描き足される線の重み（取りこぼしの何倍か）")
    ap.add_argument("--shift", type=int, default=4,
                    help="v2 で、背の低い文字を上下に何 px までずらして当てるか（0 でずらさない）")
    ap.add_argument("--slide", type=float, default=0.4,
                    help="v2 で、文字をずらすコスト（小さいほど気軽にずらす）")
    ap.add_argument("--fill", choices=["face", "all"],
                    help="v2 で、黒い面（瞳など暗く塗られた所）を画数の多い文字で埋める。"
                         "face は顔の中だけ、all は絵の全体")
    ap.add_argument("--fill-gain", type=float, default=0.5, help="--fill の濃さ（大きいほど濃く埋める）")
    ap.add_argument("--face-gain", type=float, default=1.0,
                    help="v2 で、顔の中の描き込みを何倍にするか（顔は自動で見つける）")
    ap.add_argument("--mask", help="v2 で、描き込みを増やしたい所を白く塗った画像")
    ap.add_argument("--mask-gain", type=float, default=2.0, help="--mask の白い所を何倍にするか")
    a = ap.parse_args()
    out = a.output or os.path.splitext(a.image)[0] + ".html"
    if a.mode == "v2":
        # v2 には細い線を渡す。--lineart を省いたときは、現行の輪郭を細線化して使う
        image = Image.open(a.image)
        mask = line_mask(image, a.lineart or "legacy", 1, a.color_edges)
        weight = weight_map(image, mask.shape, a.face_gain,
                            Image.open(a.mask) if a.mask else None, a.mask_gain)
        fill = None
        if a.fill:
            from aame import regions
            fill = regions.dark_areas(image, (mask.shape[1], mask.shape[0]), a.fill)
        lines = to_lines(mask, "v2", lam=a.lam, phantom=a.phantom, weight=weight,
                         shift=a.shift, slide=a.slide, fill=fill, fill_gain=a.fill_gain)
    else:
        lines = to_lines(line_mask(Image.open(a.image), a.lineart, a.width,
                                   a.color_edges if a.lineart else None), a.mode)
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write(to_html(lines, a.mode))
    print(out)


if __name__ == "__main__":
    main()
