#coding:utf-8
"""線画の直し（edit）と、文字を外した辞書（GlyphSet.without）の確かめ（開発用。2026-11-15）。

    PYTHONPATH=. python aaeval/engine_test6.py [画像]

確かめること:
  - 何も直していない edit は、edit なしと同じ AA になる（v2・v1）
  - edit を渡した row_line が、edit を渡した render のその行と同じ
  - 線を消すと、その所の文字が減る。線を描くと、その所に文字が出る
  - 文字を外した辞書では、外した文字が AA にも行の候補にも出ない（2重線の置き換えでも出ない）
"""

import sys
import time

import numpy as np
from PIL import Image, ImageDraw

from aame import convert
from aame.glyphs import ROW_H
from aame.session import Session


def ink_in(lines, glyphs, y0, y1, x0, x1):
    """行 y0..y1、x0..x1 px にあるインクのある文字の数。"""
    n = 0
    for r in range(y0, y1):
        x = 0
        for ch in lines[r]:
            i = glyphs.index(ch) if ch in glyphs else None
            w = int(glyphs.widths[i]) if i is not None else 16
            if i is not None and glyphs.bitmaps[i].any() and x0 <= x + w / 2 < x1:
                n += 1
            x += w
    return n


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "miku.png"
    s = Session(Image.open(path))
    g = convert.glyph_set()
    w, h = s.size
    log = []

    # 直していない edit
    blank = Image.new("RGB", s.size, (0, 0, 0))
    for mode in ("v2", "v1"):
        a = s.render(mode=mode, width=3)
        b = s.render(mode=mode, width=3, edit=blank)
        log.append(f"blank edit {mode}: same={a == b}")

    # 線を消す（上半分の右側）、線を描く（下の方に横線と点）
    edit = Image.new("RGB", s.size, (0, 0, 0))
    d = ImageDraw.Draw(edit)
    ex0, ex1, ey0, ey1 = w // 2, w, 0, (s.rows // 2) * ROW_H
    d.rectangle((ex0, ey0, ex1 - 1, ey1 - 1), fill=(0, 255, 0))
    ly = (s.rows - 3) * ROW_H + 9
    d.line((w // 4, ly, w // 4 + 120, ly), fill=(255, 0, 0), width=1)
    d.rectangle((w // 4 + 160, ly, w // 4 + 161, ly + 1), fill=(255, 0, 0))
    t = time.perf_counter()
    base = s.render()
    edited = s.render(edit=edit)
    log.append(f"render with edit {time.perf_counter() - t:.2f}s (2 renders)")
    r0, r1 = ey0 // ROW_H, ey1 // ROW_H
    log.append(f"erase: ink chars in erased box {ink_in(base, g, r0, r1, ex0, ex1)} -> {ink_in(edited, g, r0, r1, ex0, ex1)}")
    lr = ly // ROW_H
    log.append(f"draw: row {lr} before {base[lr]!r}")
    log.append(f"draw: row {lr} after  {edited[lr]!r}")
    same = sum(edited[r] == s.row_line(r, edit=edit) for r in range(s.rows))
    log.append(f"row_line(edit) == render(edit)[row]: {same}/{s.rows}")
    a = s.render(mode="v1", width=3, edit=edit)
    same = sum(a[r] == s.row_line(r, mode="v1", width=3, edit=edit) for r in range(s.rows))
    log.append(f"v1 row_line(edit) == render(edit)[row]: {same}/{s.rows}")
    t = time.perf_counter()
    opts = s.row_options(lr, dict(edit=edit))
    log.append(f"row_options with edit: {len(opts)} options {time.perf_counter() - t:.2f}s")

    # 文字を外した辞書
    drop = "escｅｓｃ|"
    sub = g.without(drop + " 　")
    log.append(f"without: {len(g)} -> {len(sub)} chars; blanks kept: {' ' in sub and '　' in sub}")
    t = time.perf_counter()
    lines = s.render(glyphs=sub)
    log.append(f"render without {drop!r}: {time.perf_counter() - t:.2f}s; excluded chars used: "
               f"{sorted({ch for ln in lines for ch in ln if ch in drop})}; full dict uses them: "
               f"{sorted({ch for ln in base for ch in ln if ch in drop})}")
    v1 = s.render(mode="v1", width=3, glyphs=sub)
    log.append(f"v1 without: excluded chars used {sorted({ch for ln in v1 for ch in ln if ch in drop})}")
    bad = set()
    for r in range(0, s.rows, 6):
        for o in s.row_options(r, dict(glyphs=sub)):
            bad |= {ch for ch in o["line"] if ch in drop}
    log.append(f"row_options without: excluded chars used {sorted(bad)}")
    same = sum(lines[r] == s.row_line(r, glyphs=sub) for r in range(s.rows))
    log.append(f"row_line(glyphs) == render(glyphs)[row]: {same}/{s.rows}")
    log.append(f"fix_double_lines: full {convert.fix_double_lines('al!b')!r}, without '|' "
               f"{convert.fix_double_lines('al!b', sub)!r}")
    print("\n".join(log))


if __name__ == "__main__":
    main()
