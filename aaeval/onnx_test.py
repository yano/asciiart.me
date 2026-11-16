#coding:utf-8
"""ONNX に変換したモデル（aame/models.py）が、torch で動かしたときと同じ結果になるかを確かめる（開発用。2026-11-16）。

    PYTHONPATH=. python aaeval/onnx_test.py [--cuda] [画像 ...]

画像ごとに、torch（comfyui_controlnet_aux、GPU があれば GPU）と onnxruntime（CPU）で:
  - manga_line と teed の線の強さの差、顔の部位が食い違う画素の数
  - 1px の線（binarize）の食い違う画素の数（色の境界なし・全体）
  - 候補の6通りの AA で、違う行の数
  - かかった時間（モデルの読み込みを除く）
--cuda を付けると、onnxruntime の GPU（CUDA）でも時間を測る。

2026-11-16 から teed.onnx は元の TEED（MIT）の重みなので、torch（comfyui_controlnet_aux の別の重み）とは色の境界が
違う。結果の表（webapp_plan.md の 17 章）は、その前に aux と同じ重みで作った teed.onnx で測ったもの。
"""

import argparse
import os
import time

import numpy as np
from PIL import Image

from aame import lineart, models, regions
from aame.candidates import PRESETS, settings
from aame.session import Session

IMAGES = [
    "miku.png", "luckystar01.jpg", "luckystar02.jpg",
    "E:/StableDiffusion/dot-e-puppet/refs/sdxl/c01.png",
    "E:/StableDiffusion/dot-e-puppet/refs/sdxl/s01.png",
    "E:/StableDiffusion/dot-e-puppet/refs/sdxl/c07.png",
    "E:/tmp/_a_clip_02000_sit_down_library/f_01.png",
]


def timed(f, *a, **k):
    t = time.perf_counter()
    r = f(*a, **k)
    return r, time.perf_counter() - t


def run(image, size, backend):
    os.environ["AAME_BACKEND"] = backend
    r = {}
    r["manga"], r["t_manga"] = timed(lineart.strength, image, "manga_line", size=size)
    r["teed"], r["t_teed"] = timed(lineart.strength, image, "teed", size=size)
    r["parts"], r["t_face"] = timed(regions.face_parts, image, size)
    s = Session(image, base=size)
    r["aa"] = [s.render(**settings(p)) for p in PRESETS]
    r["mask"] = s.line_mask()
    r["mask_color"] = s.line_mask(color="all")
    return r


def warm_up(backend):
    os.environ["AAME_BACKEND"] = backend
    im = Image.new("RGB", (256, 256), "white")
    lineart.strength(im, "manga_line", size=(256, 256))
    lineart.strength(im, "teed", size=(256, 256))
    regions.face_parts(im, (256, 256))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("images", nargs="*", default=IMAGES)
    ap.add_argument("--cuda", action="store_true")
    a = ap.parse_args()
    os.environ["AAME_ORT"] = "cpu"
    warm_up("torch")
    warm_up("onnx")
    log = []
    total = {"rows": 0, "diff": 0}
    for path in a.images:
        image = Image.open(path)
        image.load()
        size = lineart.canvas_size(image)
        t = run(image, size, "torch")
        o = run(image, size, "onnx")
        dm = np.abs(t["manga"] - o["manga"])
        dt = np.abs(t["teed"] - o["teed"])
        rows = sum(len(x) for x in t["aa"])
        diff = sum(a != b for x, y in zip(t["aa"], o["aa"]) for a, b in zip(x, y))
        per = [sum(a != b for a, b in zip(x, y)) for x, y in zip(t["aa"], o["aa"])]
        total["rows"] += rows
        total["diff"] += diff
        log.append(f"{os.path.basename(path)} {size[0]}x{size[1]}")
        log.append(f"  manga_line 強さの差 最大 {dm.max():.4f} 平均 {dm.mean():.6f}、違う画素 {(dm > 0).sum()}")
        log.append(f"  teed       強さの差 最大 {dt.max():.4f}、違う画素 {(dt > 0).sum()}")
        log.append(f"  顔の部位   違う画素 {(t['parts'] != o['parts']).sum()} / {t['parts'].size}")
        log.append(f"  1px の線   違う画素 {(t['mask'] != o['mask']).sum()}（線 {t['mask'].sum()}）、"
                   f"色の境界あり {(t['mask_color'] != o['mask_color']).sum()}（線 {t['mask_color'].sum()}）")
        log.append(f"  AA 6候補   違う行 {diff} / {rows}（候補ごと {per}）")
        log.append(f"  時間 torch: manga {t['t_manga']:.2f}s teed {t['t_teed']:.2f}s 顔 {t['t_face']:.2f}s / "
                   f"onnx CPU: manga {o['t_manga']:.2f}s teed {o['t_teed']:.2f}s 顔 {o['t_face']:.2f}s")
        if a.cuda:
            models._SESSIONS.clear()
            os.environ["AAME_ORT"] = "cuda"
            warm_up("onnx")
            c = run(image, size, "onnx")
            log.append(f"  時間 onnx CUDA（{models.session('manga_line').get_providers()[0]}）: "
                       f"manga {c['t_manga']:.2f}s teed {c['t_teed']:.2f}s 顔 {c['t_face']:.2f}s、"
                       f"CPU との違う行 {sum(a != b for x, y in zip(o['aa'], c['aa']) for a, b in zip(x, y))}")
            models._SESSIONS.clear()
            os.environ["AAME_ORT"] = "cpu"
            warm_up("onnx")
        print("\n".join(log[-7 - a.cuda:]), flush=True)
    print(f"合計: 違う行 {total['diff']} / {total['rows']}")


if __name__ == "__main__":
    main()
