#coding:utf-8
"""現行の変換（asciiartme.py と同じ処理）を実行して採点する。

使い方:
    python -m aaeval.run_baseline miku.png --out out/baseline

出力（--out の中、入力のファイル名ごと）:
    <名前>.html          AA
    <名前>_target.png    目標の線画（前処理の結果）
    <名前>_render.png    AA を実フォントで描いたもの
    <名前>_overlay.png   重ね合わせ（黒 = 一致、赤 = 目標だけ、青 = AA だけ）
    <名前>_metrics.json  指標

ここでの目標は「変換が入力として受け取った線画」なので、測っているのは
文字の当てはめの良さで、線画化（前処理）の良さは含まない。
"""

import argparse
import json
import time
from pathlib import Path

from PIL import Image

from aaeval import render, score


def run(path, out_dir):
    import asciiartme as aa     # 辞書の読み込みに少し時間がかかるので、使うときに読む

    image = aa.resize_to_max(Image.open(path).convert("RGB"))
    t0 = time.time()
    line_img = aa.impro.edgeDetect(image)
    t1 = time.time()
    html = aa.chrtool.getAA(line_img)
    t2 = time.time()

    rows = line_img.shape[0] // render.LINE_HEIGHT     # AA にできるのは 18px の倍数の行まで
    target = (line_img < 128)[:rows * render.LINE_HEIGHT]
    result, drawn = score.score_html(target, html)
    result["seconds_preprocess"] = t1 - t0
    result["seconds_match"] = t2 - t1

    name = Path(path).stem
    score.save_images(out_dir, name, target, drawn)
    (out_dir / f"{name}.html").write_text(html, encoding="utf-8", newline="\n")
    (out_dir / f"{name}_metrics.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("images", nargs="+")
    ap.add_argument("--out", default="out/baseline")
    a = ap.parse_args()
    for p in a.images:
        score.print_result(p, run(p, Path(a.out)))


if __name__ == "__main__":
    main()
