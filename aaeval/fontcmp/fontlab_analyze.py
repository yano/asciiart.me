"""フォントの比較の数字をまとめる。python fontlab_analyze.py <fontlab>"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image
sys.path.insert(0, ".")
from aame import convert

lab = Path(sys.argv[1])
meta = json.loads((lab / "fonts.json").read_text(encoding="utf-8"))
m = json.loads((lab / "measure.json").read_text(encoding="utf-8"))
g = convert.glyph_set()
dict_w = g.widths.astype(float)
COLS, CW, CH, OX, OY = 25, 28, 26, 6, 4


def cells(fid):
    """各文字の灰色の画像（行の上端から 18px、左端 -3px から 22px 幅）。0..1 でインクの濃さ。"""
    im = np.asarray(Image.open(lab / "shots" / f"glyphs_{fid}.png").convert("L"), np.float32) / 255.0
    out = []
    for i in range(len(g.chars)):
        x, y = (i % COLS) * CW + OX, (i // COLS) * CH + OY
        out.append(1.0 - im[y - 2:y + 20, x - 3:x + 19])        # (22, 22)。行の上端は 2 行目
    return np.array(out)


ref = cells("mspg")
ref_ink = ref > 0.5
rows = []
for fid in meta["fonts"]:
    w = np.array(m["widths"][fid])
    miss = set(meta["missing"].get(fid, []))
    have = np.array([c not in miss for c in g.chars])
    same = np.abs(w - dict_w) < 0.01
    c = cells(fid)
    ink = c > 0.5
    gray = ((c > 0.1) & (c < 0.9)).sum() / max((c > 0.1).sum(), 1)  # なめらかさ（中間の濃さの割合）
    # 形の近さ: インクの重なり（IoU）。空白の文字は除く
    sel = have & ref_ink.reshape(len(g.chars), -1).any(1)
    inter = (ink & ref_ink)[sel].reshape(sel.sum(), -1).sum(1)
    union = (ink | ref_ink)[sel].reshape(sel.sum(), -1).sum(1)
    iou = float(np.mean(inter / np.maximum(union, 1)))
    exact = int(((ink == ref_ink).reshape(len(g.chars), -1).all(1) & sel).sum())
    darkness = float(c[sel].sum() / ref[sel].sum())                # インクの量（MS Pゴシック = 1）
    drift = {}
    for case, lw in m["lineWidths"][fid].items():
        base = np.array(m["lineWidths"]["mspg"][case])
        drift[case] = float(np.max(np.abs(np.array(lw) - base)))
    rows.append(dict(font=fid, width_same=int(same.sum()), width_total=len(g.chars),
                     width_diff_chars="".join(ch for ch, s in zip(g.chars, same) if not s)[:40],
                     missing=len(miss), iou=round(iou, 3), exact_shape=exact, ink_ratio=round(darkness, 2),
                     smooth=round(float(gray), 2), max_line_drift_px=round(max(drift.values()), 1)))
(lab / "analysis.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
hdr = "font               width_same  missing  shape_IoU  exact  ink   smooth  line_drift"
lines = [hdr]
for r in rows:
    lines.append(f"{r['font']:<18} {r['width_same']:>3}/{r['width_total']}   {r['missing']:>4}    {r['iou']:.3f}   {r['exact_shape']:>4}  {r['ink_ratio']:.2f}  {r['smooth']:.2f}   {r['max_line_drift_px']}")
(lab / "analysis.txt").write_text("\n".join(lines), encoding="utf-8")
print("\n".join(lines))
