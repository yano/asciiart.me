#coding:utf-8
"""当てはめのコストを比べる: v1（線を太らせて渡す）と v2（細い線のまま。aame.cost）。

使い方:
    python -m aaeval.compare_cost miku.png other.png --out out/cost
    python -m aaeval.compare_cost miku.png --lineart lineart_anime --lams 1.5 2 3 --face-gains 2 3

採点の目標は、どれも 1px の線画。

出力（--out の中）:
    <画像>_<方式>.html        AA（方式は v1_w2、v2_lam2、v2_lam2_face2 など。
                              face2 は顔の中だけ描き込みを2倍にしたもの。
                              noshift は文字の上下のずらしを切ったもの）
    <画像>_sheet.png          目標と、各方式の AA を描いたものの一覧
    summary.json              すべての指標
"""

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

from aaeval import metrics, render
from aaeval.compare_lineart import _grid, _img, _label
from aame import convert, lineart, match, regions

SHOWN = ["precision@2", "recall@2", "f@2", "orient_precision@2", "orient_recall@2", "orient_f@2",
         "chamfer", "ink_ratio", "stray"]
FACE_LAM = 2.0      # 顔の描き込みを変えるときの、全体の lam


def run(path, out_dir, method, widths, lams, face_gains, font, glyphs, cols, color=None):
    name = Path(path).stem
    image = Image.open(path)
    s = lineart.strength(image, method, color)
    thin = lineart.binarize(s)
    target = thin[:thin.shape[0] // render.LINE_HEIGHT * render.LINE_HEIGHT]
    jobs = {f"v1_w{w}": (lineart.binarize(s, width=w), "v1", {}) for w in widths}
    jobs.update({f"v2_lam{v:g}": (thin, "v2", {"lam": v}) for v in lams})
    for g in face_gains:
        weight = regions.face_weight(image, (thin.shape[1], thin.shape[0]), gain=g)
        jobs[f"v2_lam{FACE_LAM:g}_face{g:g}"] = (thin, "v2", {"lam": FACE_LAM, "weight": weight})
        jobs[f"v2_lam{FACE_LAM:g}_face{g:g}_noshift"] = (
            thin, "v2", {"lam": FACE_LAM, "weight": weight, "shift": 0})
    shown = method + (f" + color edges ({color})" if color else "")
    results, tiles = {}, [_label(_img(target), f"target ({shown}, 1px)")]
    for tag, (mask, mode, options) in jobs.items():
        lines = convert.finish(match.match(mask, glyphs, mode, **options))
        drawn = render.render_lines(lines, font=font, size=target.shape)
        r = metrics.evaluate(target, drawn)
        inked = [c for ln in lines for c in render.browser_text(ln) if not c.isspace()]
        r["chars"] = len(inked)
        r["kanji"] = float(np.mean([0x4e00 <= ord(c) <= 0x9fff for c in inked])) if inked else 0.0
        results[tag] = r
        (out_dir / f"{name}_{tag}.html").write_text(convert.to_html(lines, "v1"),
                                                    encoding="utf-8", newline="\n")
        tiles.append(_label(_img(drawn), f"{tag}  orient_f@2 {r['orient_f@2']:.2f}  f@2 {r['f@2']:.2f}"))
    Image.fromarray(_grid(tiles, cols)).save(out_dir / f"{name}_sheet.png")
    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("images", nargs="+")
    ap.add_argument("--out", default="out/cost")
    ap.add_argument("--lineart", default="manga_line")
    ap.add_argument("--widths", nargs="*", type=int, default=[2, 3], help="v1 に渡す線の太さ")
    ap.add_argument("--lams", nargs="*", type=float, default=[1.5, 2.0, 3.0], help="v2 の lam")
    ap.add_argument("--face-gains", nargs="*", type=float, default=[2.0],
                    help="v2 で顔の中だけ描き込みを何倍にするか")
    ap.add_argument("--color-edges", choices=["face", "all"],
                    help="色の境界も線として足す（face は顔の中だけ、all は全体）")
    ap.add_argument("--cols", type=int, default=4)
    a = ap.parse_args()
    out_dir = Path(a.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    font, glyphs = render.Font(), convert.glyph_set()
    summary = {}
    for p in a.images:
        summary[Path(p).stem] = run(p, out_dir, a.lineart, a.widths, a.lams, a.face_gains, font, glyphs, a.cols,
                                     a.color_edges)
        print(f"done: {p}", flush=True)
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    keys = SHOWN + ["chars", "kanji"]
    print(f"\n{'':22s}" + "".join(f"{k:>20s}" for k in keys))
    for tag in next(iter(summary.values())):
        print(f"{tag:22s}" +"".join(f"{np.mean([summary[n][tag][k] for n in summary]):20.3f}"
                                     for k in keys))


if __name__ == "__main__":
    main()
