#coding:utf-8
"""レンダラの描いた画像が、ブラウザ（Edge）の実際の表示と画素単位で一致するか確かめる。

使い方:
    python -m aaeval.check_render miku.html

Edge をヘッドレスで起動して HTML のスクリーンショットを撮り、render.py の結果と比べる。
フォントや辞書を変えたときは、まずこれで評価の土台が正しいことを確かめる。
"""

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

from aaeval import render

EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"


def screenshot(html_path, size, browser=EDGE):
    """HTML をブラウザで開いた画面（インクが True）を返す。size は (高さ, 幅)。"""
    with tempfile.TemporaryDirectory() as tmp:
        png = Path(tmp) / "shot.png"
        subprocess.run([browser, "--headless", "--disable-gpu", "--hide-scrollbars",
                        "--force-device-scale-factor=1", f"--window-size={size[1]},{size[0]}",
                        f"--user-data-dir={Path(tmp) / 'profile'}", f"--screenshot={png}",
                        Path(html_path).resolve().as_uri()],
                       check=True, capture_output=True, timeout=120)
        return np.asarray(Image.open(png).convert("L")) < 128


def compare(html_path, browser=EDGE, margin=40):
    lines = render.html_to_lines(Path(html_path).read_text(encoding="utf-8"))
    mine = render.render_lines(lines)
    shot = screenshot(html_path, (mine.shape[0] + margin, mine.shape[1] + margin), browser)
    # ブラウザ側には body の余白があるので、最もよく合う位置を探す
    best = None
    for oy in range(margin):
        for ox in range(margin):
            n = int((mine != shot[oy:oy + mine.shape[0], ox:ox + mine.shape[1]]).sum())
            if best is None or n < best[0]:
                best = (n, oy, ox)
    n, oy, ox = best
    part = shot[oy:oy + mine.shape[0], ox:ox + mine.shape[1]]
    bad = [i for i in range(len(lines))
           if (mine[i * render.LINE_HEIGHT:(i + 1) * render.LINE_HEIGHT]
               != part[i * render.LINE_HEIGHT:(i + 1) * render.LINE_HEIGHT]).any()]
    return {"lines": len(lines), "ink_pixels": int(mine.sum()), "diff_pixels": n,
            "offset": (oy, ox), "lines_with_diff": bad}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("html", nargs="+")
    ap.add_argument("--browser", default=EDGE)
    a = ap.parse_args()
    ok = True
    for p in a.html:
        r = compare(p, a.browser)
        ok = ok and r["diff_pixels"] == 0
        print(f"{p}: {r['lines']} 行、インク {r['ink_pixels']} px、食い違い {r['diff_pixels']} px"
              f"（位置合わせ {r['offset']}）"
              + (f"、食い違う行 {r['lines_with_diff']}" if r["lines_with_diff"] else ""))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
