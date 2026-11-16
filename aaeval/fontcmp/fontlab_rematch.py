"""フォントごとに辞書を作り直して当てはめる。python fontlab_rematch.py <fontlab> <画像>..."""
import json, sys, time
from pathlib import Path
import numpy as np
from PIL import Image
sys.path.insert(0, ".")
from aame import candidates, convert
from aame.glyphs import GlyphSet, MAX_W, MIN_W, ROW_H
from aame.session import Session

lab = Path(sys.argv[1])
images = sys.argv[2:]
meta = json.loads((lab / "fonts.json").read_text(encoding="utf-8"))
m = json.loads((lab / "measure.json").read_text(encoding="utf-8"))
base = convert.glyph_set()
COLS, CW, CH, OX, OY = 25, 28, 26, 6, 4
THRESH = 0.4
FONTS = ["mspg", "Saitamaar", "AA-PGothic-16px", "textar", "monapo"]
PRESETS = ["standard", "color_all"]


def font_glyphs(fid):
    """Edge が描いたそのフォントの形から GlyphSet を作る。使えない文字（幅が整数でない、3〜16px の外、
    フォントに無い）は除く。エンジンの座標は Edge の表示より 1px 下（MS Pゴシックで確かめた）。"""
    im = 1.0 - np.asarray(Image.open(lab / "shots" / f"glyphs_{fid}.png").convert("L"), np.float32) / 255.0
    miss = set(meta["missing"].get(fid, []))
    chars, widths, bitmaps, dropped = [], [], [], []
    for i, (ch, w) in enumerate(zip(base.chars, m["widths"][fid])):
        rw = int(round(w))
        if ch in miss or abs(w - rw) > 0.01 or not MIN_W <= rw <= MAX_W:
            dropped.append(ch)
            continue
        x, y = (i % COLS) * CW + OX, (i // COLS) * CH + OY
        bm = np.zeros((ROW_H, MAX_W), bool)
        bm[:, :rw] = im[y - 1:y - 1 + ROW_H, x:x + rw] > THRESH
        chars.append(ch); widths.append(rw); bitmaps.append(bm)
    return GlyphSet(chars, widths, bitmaps), dropped


sets = {}
report = {}
for fid in FONTS:
    gs, dropped = font_glyphs(fid)
    sets[fid] = gs
    same_w = sum(int(gs.widths[i]) == int(base.widths[base.index(c)]) for i, c in enumerate(gs.chars))
    diff_bits = sum(int((gs.bitmaps[i] != base.bitmaps[base.index(c)]).sum()) for i, c in enumerate(gs.chars))
    report[fid] = dict(chars=len(gs), dropped="".join(dropped), same_width=same_w, bit_diff_vs_dict=diff_bits)
print(json.dumps(report, ensure_ascii=False, indent=1))

(lab / "rematch").mkdir(exist_ok=True)
presets = {p[0]: p for p in candidates.PRESETS}
for path in images:
    stem = Path(path).stem
    s = Session(Image.open(path))
    for pname in PRESETS:
        st = candidates.settings(presets[pname])
        ref = s.render(**st)
        (lab / "rematch" / f"{stem}_{pname}_dict.json").write_text(json.dumps(ref, ensure_ascii=False), encoding="utf-8")
        for fid in FONTS:
            t = time.perf_counter()
            lines = s.render(**st, glyphs=sets[fid])
            (lab / "rematch" / f"{stem}_{pname}_{fid}.json").write_text(json.dumps(lines, ensure_ascii=False), encoding="utf-8")
            same = sum(a == b for a, b in zip(lines, ref))
            print(f"{stem} {pname} {fid}: {time.perf_counter() - t:.1f}s, rows identical to dict result {same}/{len(ref)}")
