#coding:utf-8
"""JavaScript の当てはめ（webapp/static/aame/ の cost.js・match.js）を確かめるための入力と、Python の答えを書き出す。

    PYTHONPATH=. python aaeval/js/dump_core.py [--out out/js_core] [画像 ...]
    node aaeval/js/core_test.mjs [--out out/js_core]

画像ごと・設定ごとに、当てはめに渡す線画（mask）・重み（weight）・黒い面（fill）と、Python が出した AA の行を書く。
1 つの行のコスト c と、文字側の量（GlyphCost）・線の向き（orient.bins）も書く（違いを調べる用）。
"""

import argparse
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image

from aame import convert, cost, match, orient
from aame.candidates import PRESETS, settings
from aame.session import Session

IMAGES = ["miku.png", "luckystar01.jpg", "luckystar02.jpg"]
CASES = ["standard", "sparse", "color_all", "fill_face", "color_all_fill"]
PROBE_ROW = 10


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("images", nargs="*", default=IMAGES)
    ap.add_argument("--out", default="out/js_core")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    glyphs = convert.glyph_set()
    gc = cost.glyph_cost(glyphs, 4)
    np.save(out / "gc_miss.npy", gc.miss)
    np.save(out / "gc_ink.npy", gc.ink)
    np.save(out / "gc_moved.npy", gc.moved_ink)
    (out / "cost_table.json").write_text(json.dumps(match.COST.tolist()), encoding="utf-8")
    index = []
    by_name = {p[0]: p for p in PRESETS}
    for path in a.images:
        stem = Path(path).stem
        s = Session(Image.open(path))
        h, w = s.shape
        for name in CASES:
            st = settings(by_name[name])
            key = f"{stem}_{name}"
            mask = s.line_mask(st["color"], 1)
            weight = s.weight(st["face_gain"])
            fill = s.dark(st["fill"]) if st["fill"] else None
            s.render(**st)          # 文字側の量などを先に求めておく（時間に入れない）
            t = time.perf_counter()
            lines = s.render(**st)
            ms = (time.perf_counter() - t) * 1000
            np.save(out / f"{key}_mask.npy", mask)
            if weight is not None:
                np.save(out / f"{key}_weight.npy", weight.astype(np.float32))
            if fill is not None:
                np.save(out / f"{key}_fill.npy", fill)
            item = dict(key=key, mode="v2", h=h, w=w, lam=st["lam"], fill_gain=0.5, phantom=1.5, shift=4, slide=0.4,
                        weight=weight is not None, fill=fill is not None, lines=lines, ms=round(ms))
            if name == "standard":
                c, term = cost.costs(mask, glyphs, lam=st["lam"], weight=weight, only=[PROBE_ROW])
                np.save(out / f"{key}_c{PROBE_ROW}.npy", c[0])
                np.save(out / f"{key}_term{PROBE_ROW}.npy", term[0])
                np.save(out / f"{key}_bins.npy", orient.bins(mask[:h // 18 * 18], cost.N_BINS).astype(np.int8))
                item["probe"] = PROBE_ROW
            index.append(item)
            print(key, f"{ms:.0f} ms")
        # 高密度（v1、線の太さ 3）
        key = f"{stem}_dense"
        mask = s.line_mask(None, 3)
        t = time.perf_counter()
        lines = s.render(mode="v1", width=3)
        ms = (time.perf_counter() - t) * 1000
        np.save(out / f"{key}_mask.npy", mask)
        index.append(dict(key=key, mode="v1", h=h, w=w, lines=lines, ms=round(ms)))
        print(key, f"{ms:.0f} ms")
    (out / "index.json").write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
    print(out / "index.json")


if __name__ == "__main__":
    main()
