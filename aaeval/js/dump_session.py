#coding:utf-8
"""JavaScript の Session（webapp/static/aame/session.js）の行の候補と、塗り・線画の直しを使った AA を確かめる入力と答え。

    PYTHONPATH=. python aaeval/js/dump_session.py [--out out/js_session]
    node aaeval/js/session_test.mjs [--out out/js_session]

モデルの入力と出力も書く（JavaScript の試験はモデルの代わりにこれを返す）。cv2.remap（行の伸び縮み）の答えも書く。
"""

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

from aame import models, regions
from aame.candidates import PRESETS, settings
from aame.session import Session, _hscale

ROWS = [8, 15, 22, 30]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", default="miku.png")
    ap.add_argument("--out", default="out/js_session")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    calls = []
    run = models._run

    def recording(name, x):
        y = run(name, x)
        calls.append((name, y))
        return y

    models._run = recording
    image = Image.open(a.image).convert("RGB")
    np.save(out / "rgb.npy", np.asarray(image))
    s = Session(image)
    w, h = s.size
    by_name = {p[0]: p for p in PRESETS}
    # 塗り（AA の大きさ）と線画の直し（赤が描いた線、緑が消した所）
    paint = Image.new("L", (w, h), 128)
    d = ImageDraw.Draw(paint)
    d.ellipse([w // 4, h // 6, w // 2, h // 3], fill=128 + 2 * regions.PAINT_CODE)
    d.rectangle([0, h // 2, w // 3, h // 2 + 60], fill=128 - 2 * regions.PAINT_CODE)
    edit = Image.new("RGB", (w, h), (0, 0, 0))
    d = ImageDraw.Draw(edit)
    d.line([w // 3, h // 4, w // 2, h // 4 + 30], fill=(255, 0, 0), width=1)
    d.rectangle([w // 2, h // 3, w // 2 + 80, h // 3 + 50], fill=(0, 255, 0))
    np.save(out / "paint.npy", np.asarray(paint))
    np.save(out / "edit.npy", np.asarray(edit.convert("RGBA")))
    cases = {
        "standard": dict(settings(by_name["standard"])),
        "color_all_fill_paint": dict(settings(by_name["color_all_fill"]), paint=paint),
        "edit": dict(settings(by_name["standard"]), edit=edit),
        "dense": dict(mode="v1", width=3),
    }
    result = {}
    for key, st in cases.items():
        lines = s.render(**st)
        options = {row: s.row_options(row, dict(st), None) for row in ROWS}
        result[key] = dict(lines=lines, options=options)
        print(key, sum(len(v) for v in options.values()), "options")
    # cv2.remap の答え
    rng = np.random.default_rng(0)
    band = rng.random((54, w), dtype=np.float32)
    mask = rng.random((54, w)) > 0.7
    np.save(out / "remap_src.npy", band)
    np.save(out / "remap_mask.npy", mask)
    remap = []
    for i, (sx, cx) in enumerate([(0.98, w * 0.37), (1.02, w * 0.61), (1.005, 123.4567)]):
        np.save(out / f"remap_lin{i}.npy", _hscale(band, sx, cx, 0.0, cv2.INTER_LINEAR))
        np.save(out / f"remap_near{i}.npy", _hscale(mask, sx, cx, False, cv2.INTER_NEAREST))
        remap.append([sx, cx])
    for i, (name, y) in enumerate(calls):
        for j, o in enumerate(y):
            np.save(out / f"call{i}_out{j}.npy", o)
    (out / "index.json").write_text(json.dumps(dict(w=w, h=h, calls=[c[0] for c in calls], result=result,
                                                    remap=remap, rows=ROWS), ensure_ascii=False), encoding="utf-8")
    print(out / "index.json")


if __name__ == "__main__":
    main()
