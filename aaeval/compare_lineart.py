#coding:utf-8
"""線画にする方法を比べる。

使い方:
    python -m aaeval.compare_lineart miku.png other.png --out out/lineart
    python -m aaeval.compare_lineart miku.png --methods lineart_anime teed --widths 1 2

各方法について: 線の強さ → 2値化して 1px に細線化 → 文字を当てはめる → 採点。
当てはめに渡す線の太さ（--widths）も変えて試す。採点の目標は、太さによらず 1px の線画にする。

注意: ここの点数は「その線画に AA がどれだけ合ったか」で、線画そのものの良さではない。
線の少ない線画ほど合わせやすく点が高く出るので、線画の良さは一覧の画像を見て判断する。

出力（--out の中）:
    <画像>_<方法>_line.png        1px の線画
    <画像>_<方法>_w<太さ>.html    AA
    <画像>_lines.png              線画の一覧
    <画像>_aa_w<太さ>.png         AA を描いたものの一覧
    summary.json                  すべての指標
"""

import argparse
import json
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from aaeval import metrics, render
from aame import convert, lineart, match

SHOWN = ["f@1", "f@2", "chamfer", "blur_ncc@2"]


def _label(img, text, h=22):
    bar = np.full((h, img.shape[1]), 255, np.uint8)
    cv2.putText(bar, text, (4, h - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.5, 0, 1, cv2.LINE_AA)
    return np.vstack([bar, img])


def _grid(tiles, cols, pad=4):
    h, w = tiles[0].shape
    tiles = tiles + [np.full((h, w), 255, np.uint8)] * (-len(tiles) % cols)
    rows = [np.hstack([np.pad(t, pad, constant_values=160) for t in tiles[r:r + cols]])
            for r in range(0, len(tiles), cols)]
    return np.vstack(rows)


def _img(mask):
    return np.where(mask, 0, 255).astype(np.uint8)


def run(path, out_dir, methods, widths, font, glyphs, cols):
    image = Image.open(path)
    name = Path(path).stem
    results, line_tiles = {}, []
    aa_tiles = {w: [] for w in widths}
    source = np.asarray(image.convert("L").resize(lineart.canvas_size(image), Image.LANCZOS))
    line_tiles.append(_label(source, "source"))
    for m in methods:
        t = time.time()
        s = lineart.strength(image, m)
        seconds = time.time() - t
        rows = s.shape[0] // render.LINE_HEIGHT
        thin = lineart.binarize(s)
        target = thin[:rows * render.LINE_HEIGHT]
        Image.fromarray(_img(thin)).save(out_dir / f"{name}_{m}_line.png")
        line_tiles.append(_label(_img(thin), f"{m}  ink {thin.mean() * 100:.1f}%"))
        results[m] = {"seconds_lineart": seconds, "ink": float(thin.mean())}
        for w in widths:
            lines = convert.finish(match.match(lineart.binarize(s, width=w), glyphs, "v1"))
            drawn = render.render_lines(lines, font=font, size=target.shape)
            r = metrics.evaluate(target, drawn)
            results[m][f"w{w}"] = r
            (out_dir / f"{name}_{m}_w{w}.html").write_text(convert.to_html(lines, "v1"),
                                                           encoding="utf-8", newline="\n")
            tile = np.full(thin.shape, 255, np.uint8)
            tile[:drawn.shape[0]] = _img(drawn)
            aa_tiles[w].append(_label(tile, f"{m} w{w}  f@2 {r['f@2']:.2f}"))
    Image.fromarray(_grid(line_tiles, cols)).save(out_dir / f"{name}_lines.png")
    for w in widths:
        Image.fromarray(_grid(aa_tiles[w], cols)).save(out_dir / f"{name}_aa_w{w}.png")
    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("images", nargs="+")
    ap.add_argument("--out", default="out/lineart")
    ap.add_argument("--methods", nargs="+", default=list(lineart.METHODS))
    ap.add_argument("--widths", nargs="+", type=int, default=[1, 2, 3])
    ap.add_argument("--cols", type=int, default=5)
    a = ap.parse_args()
    out_dir = Path(a.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    font, glyphs = render.Font(), convert.glyph_set()
    summary = {}
    for p in a.images:
        summary[Path(p).stem] = run(p, out_dir, a.methods, a.widths, font, glyphs, a.cols)
        print(f"done: {p}", flush=True)
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    # 画像について平均した表
    print(f"\n{'method':16s}{'ink%':>7s}" + "".join(f"{f'{k} w{w}':>15s}" for w in a.widths for k in SHOWN))
    for m in a.methods:
        per = [summary[n][m] for n in summary]
        row = f"{m:16s}{np.mean([r['ink'] for r in per]) * 100:7.2f}"
        for w in a.widths:
            for k in SHOWN:
                row += f"{np.mean([r[f'w{w}'][k] for r in per]):15.3f}"
        print(row)


if __name__ == "__main__":
    main()
