#coding:utf-8
"""目標の線画に対して AA（HTML）を採点する。

使い方:
    python -m aaeval.score --target out/baseline/miku_target.png --html out/baseline/miku.html

目標の線画は「白地に黒い線」の画像。AA の1文字目の左上が、線画の左上に対応するものとする。
"""

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

from aaeval import metrics, render

LEAD = u"　"    # 現行の出力が各行の先頭に入れる全角スペース


def load_target(path):
    return np.asarray(Image.open(path).convert("L")) < 128


def score_html(target, html, font=None):
    """target（線が True）に対して HTML の AA を採点する。(指標, 描いた画像) を返す。"""
    lines = [s[1:] if s.startswith(LEAD) else s for s in render.html_to_lines(html)]
    drawn = render.render_lines(lines, font=font, size=target.shape)
    return metrics.evaluate(target, drawn), drawn


def save_images(out_dir, name, target, drawn):
    out_dir.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.where(target, 0, 255).astype(np.uint8)).save(out_dir / f"{name}_target.png")
    Image.fromarray(np.where(drawn, 0, 255).astype(np.uint8)).save(out_dir / f"{name}_render.png")
    Image.fromarray(metrics.overlay(target, drawn)).save(out_dir / f"{name}_overlay.png")


def print_result(title, result):
    print(f"== {title}")
    for k, v in result.items():
        print(f"  {k:24s} {v:.4f}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", required=True)
    ap.add_argument("--html", required=True)
    ap.add_argument("--out", help="指標（JSON）と見くらべ用の画像を書き出すフォルダ")
    a = ap.parse_args()
    target = load_target(a.target)
    result, drawn = score_html(target, Path(a.html).read_text(encoding="utf-8"))
    print_result(a.html, result)
    if a.out:
        name = Path(a.html).stem
        save_images(Path(a.out), name, target, drawn)
        (Path(a.out) / f"{name}_metrics.json").write_text(json.dumps(result, indent=2),
                                                          encoding="utf-8")


if __name__ == "__main__":
    main()
