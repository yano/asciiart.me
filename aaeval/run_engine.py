#coding:utf-8
"""新しいエンジン（aame）を実行して採点し、方式どうしを比べる。

使い方:
    python -m aaeval.run_engine miku.png --out out/engine

比べるもの:
    legacy           現行と同じ出力を、ブラウザで表示される通りに採点
    legacy_intended  現行の並びを、スペースの置き換えをせず最適化が想定した位置のまま採点
                     （表示はできない。当てはめそのものの良さを見るための参考値）
    v1               新しい並び（半角スペースを続けない条件つき）を、表示される通りに採点

出力（--out の中）: <名前>_<方式>.html、<名前>_<方式>_overlay.png など、<名前>_metrics.json
"""

import argparse
import json
import time
from pathlib import Path

from PIL import Image

from aaeval import metrics, render, score
from aame import convert

SHOWN = ["f@1", "f@2", "chamfer", "skel_f@2", "blur_ncc@2", "ink_ratio", "seconds"]


def run(path, out_dir, font):
    mask = convert.line_mask(Image.open(path))
    rows = mask.shape[0] // render.LINE_HEIGHT
    target = mask[:rows * render.LINE_HEIGHT]
    name = Path(path).stem
    out_dir.mkdir(parents=True, exist_ok=True)
    results = {}

    def keep(tag, drawn, seconds, html=None):
        results[tag] = dict(metrics.evaluate(target, drawn), seconds=seconds)
        score.save_images(out_dir, f"{name}_{tag}", target, drawn)
        if html is not None:
            (out_dir / f"{name}_{tag}.html").write_text(html, encoding="utf-8", newline="\n")

    t = time.time()
    raw = convert.to_lines(mask, "legacy")
    seconds = time.time() - t
    html = convert.to_html(raw, "legacy")
    _, drawn = score.score_html(target, html, font)
    keep("legacy", drawn, seconds, html)
    keep("legacy_intended",
         render.render_lines(raw, font=font, size=target.shape, as_browser=False), seconds)

    t = time.time()
    lines = convert.to_lines(mask, "v1")
    seconds = time.time() - t
    keep("v1", render.render_lines(lines, font=font, size=target.shape), seconds,
         convert.to_html(lines, "v1"))

    (out_dir / f"{name}_metrics.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("images", nargs="+")
    ap.add_argument("--out", default="out/engine")
    a = ap.parse_args()
    font = render.Font()
    for p in a.images:
        results = run(p, Path(a.out), font)
        print(f"== {p}")
        print(f"  {'':16s}" + "".join(f"{k:>12s}" for k in SHOWN))
        for tag, r in results.items():
            print(f"  {tag:16s}" + "".join(f"{r[k]:12.4f}" for k in SHOWN))


if __name__ == "__main__":
    main()
