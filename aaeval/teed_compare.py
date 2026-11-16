#coding:utf-8
"""色の境界（TEED）の重みを替えたときの違いを、並べたページにする（開発用。2026-11-16）。

    PYTHONPATH=. python aaeval/teed_compare.py <別の teed.onnx> [--out out/teed] [画像 ...]

いまの models/teed.onnx と、別の重みで作った teed.onnx で、画像ごとに次を並べる:
  - 1px の線（色の境界を全体に足したもの。足した所を赤で）
  - 「全体に色の境界を足す」「顔の中だけ色の境界を足す」の AA（MS Pゴシックで描いたもの）
"""

import argparse
import base64
import html
import io
import os
from pathlib import Path

import numpy as np
from PIL import Image

from aame import candidates, models
from aame.session import Session
from aaeval.render import render_lines

IMAGES = ["luckystar01.jpg", "luckystar02.jpg", "miku.png",
          "E:/StableDiffusion/dot-e-puppet/refs/sdxl/c01.png",
          "E:/tmp/_a_clip_02000_sit_down_library/f_01.png"]
SHOW = ["color_all", "color_face"]


def png_url(image):
    buf = io.BytesIO()
    image.save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def lines_image(s):
    """1px の線。色の境界で足した所を赤にする。"""
    base = s.line_mask(None, 1)
    full = s.line_mask("all", 1)
    rgb = np.full(base.shape + (3,), 255, np.uint8)
    rgb[base] = (0, 0, 0)
    rgb[full & ~base] = (220, 30, 30)
    return Image.fromarray(rgb), int((full & ~base).sum())


def aa_image(lines):
    ink = render_lines(lines)
    return Image.fromarray(np.where(ink, 0, 255).astype(np.uint8))


def run(path, teed_file):
    """teed_file の重みで、線と AA を作る。"""
    models._SESSIONS.pop("teed", None)
    models.FILES["teed"] = str(teed_file)
    image = Image.open(path)
    image.load()
    s = Session(image)
    out = {"lines": lines_image(s)}
    for p in candidates.PRESETS:
        if p[0] in SHOW:
            out[p[0]] = s.render(**candidates.settings(p))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("other")
    ap.add_argument("images", nargs="*", default=IMAGES)
    ap.add_argument("--out", default="out/teed")
    a = ap.parse_args()
    Path(a.out).mkdir(parents=True, exist_ok=True)
    current = (models.MODELS / "teed.onnx").resolve()
    other = Path(a.other).resolve()
    rows = []
    for path in a.images:
        x = run(path, current)
        y = run(path, other)
        name = os.path.basename(path)
        diff = {k: sum(p != q for p, q in zip(x[k], y[k])) for k in SHOW}
        print(f"{name}: 足した線 {x['lines'][1]} → {y['lines'][1]} 画素、違う行 {diff}", flush=True)
        cells = [("いまの重み", x), ("元の TEED の重み", y)]
        rows.append(f"<h2>{html.escape(name)}</h2>")
        rows.append("<table><tr>" + "".join(
            f"<th>{t}<br><small>線（色の境界で足した所は赤。{v['lines'][1]} 画素）</small></th>" for t, v in cells) + "</tr><tr>"
            + "".join(f"<td><img src='{png_url(v['lines'][0])}'></td>" for _, v in cells) + "</tr>")
        for k in SHOW:
            note = dict((p[0], p[1]) for p in candidates.PRESETS)[k]
            rows.append(f"<tr><th colspan=2>{html.escape(note)}（違う行 {diff[k]}）</th></tr><tr>"
                        + "".join(f"<td><img src='{png_url(aa_image(v[k]))}'></td>" for _, v in cells) + "</tr>")
        rows.append("</table>")
    page = ("<!DOCTYPE html><meta charset='utf-8'><title>TEED の重みの比較</title>"
            "<style>body{font-family:sans-serif;margin:16px} td{vertical-align:top;padding:4px} "
            "th{text-align:left;font-weight:normal;padding:8px 4px 2px} img{max-width:640px}</style>"
            "<h1>色の境界（TEED）の重みの比較</h1>" + "\n".join(rows))
    (Path(a.out) / "index.html").write_text(page, encoding="utf-8")
    print(Path(a.out) / "index.html")


if __name__ == "__main__":
    main()
