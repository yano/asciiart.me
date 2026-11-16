#coding:utf-8
"""JavaScript のエンジン（webapp/static/aame/）を、画像から AA まで通して確かめるための入力と、Python の途中結果を書き出す。

    PYTHONPATH=. python aaeval/js/dump_pipeline.py [--out out/js_pipe] [画像 ...]
    node aaeval/js/pipeline_test.mjs [--out out/js_pipe]

モデルを呼んだときの入力と出力（aame.models._run）も書く。JavaScript の試験は、モデルの代わりにこの出力を返す
（モデル自体の違い〈WebGPU と CUDA〉を除いて、前と後の処理と、そのほかの全部を比べる）。
"""

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from aame import models, prep, regions
from aame.candidates import PRESETS, settings
from aame.session import Session

IMAGES = ["miku.png", "luckystar01.jpg"]
CASES = ["standard", "color_all_fill"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("images", nargs="*", default=IMAGES)
    ap.add_argument("--out", default="out/js_pipe")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    calls = []
    run = models._run

    def recording(name, x):
        y = run(name, x)
        calls.append((name, np.ascontiguousarray(x, np.float32), y))
        return y

    models._run = recording
    by_name = {p[0]: p for p in PRESETS}
    index = []
    for path in a.images:
        stem = Path(path).stem
        calls.clear()
        image = Image.open(path).convert("RGB")
        save = lambda name, arr: np.save(out / f"{stem}_{name}.npy", np.ascontiguousarray(arr))
        save("rgb", np.asarray(image))
        s = Session(image)
        w, h = s.size
        save("strength", s.strength(None))
        save("strength_all", s.strength("all"))
        save("edges", s._edges)
        save("faces", s.faces)
        save("face_weight", s.face_weight(2.0))
        save("strength_face", s.strength("face"))
        for color in (None, "all", "face"):
            save(f"mask_{color}_1", s.line_mask(color, 1))
        save("mask_None_2", s.line_mask(None, 2))
        save("mask_None_3", s.line_mask(None, 3))
        save("dark_face", s.dark("face"))
        save("dark_all", s.dark("all"))
        # 塗り（画面と同じ灰色の段階の画像。AA の大きさより小さくして縮め方も確かめる）
        paint = Image.new("L", (w // 2, h // 2), 128)
        d = ImageDraw.Draw(paint)
        d.ellipse([w // 8, h // 8, w // 4, h // 4], fill=128 + 2 * regions.PAINT_CODE)
        d.ellipse([w // 5, h // 3, w // 3, h // 2], fill=128 - 3 * regions.PAINT_CODE)
        save("paint", np.asarray(paint))
        save("paint_weight", regions.paint_weight(paint, (w, h)))
        lines = {}
        for name in CASES:
            lines[name] = s.render(**settings(by_name[name]))
        lines["dense"] = s.render(mode="v1", width=3)
        # 前処理
        size = prep.target_size(image, 600)
        info = prep.measure(image, size)
        save("adjust_plus", np.asarray(prep.adjust(image, size, 1.0)))
        save("adjust_minus", np.asarray(prep.adjust(image, size, -0.5)))
        cropped = prep.crop(image, (0.1, 0.05, 0.85, 0.9))
        for i, (name, x, y) in enumerate(calls):
            save(f"call{i}_in", x)
            for j, o in enumerate(y):
                save(f"call{i}_out{j}", o)
        index.append(dict(stem=stem, w=w, h=h, iw=image.size[0], ih=image.size[1], lines=lines,
                          calls=[c[0] for c in calls], prep=dict(size=list(size), measure=info,
                                                                  crop=list(cropped.size))))
        print(stem, len(calls), "calls")
    (out / "index.json").write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
    print(out / "index.json")


if __name__ == "__main__":
    main()
