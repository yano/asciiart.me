#coding:utf-8
"""AA にする前の画像の下ごしらえ（Web アプリの「0 前処理」）。

- 切り抜き（crop）と、AA の大きさ（長辺の px）を決める。
- 絵の線の太さを、AA の大きさに直して測る。太すぎると AA で線が二重になることがあり、
  細すぎると線を拾えないことがあるので、目安から外れていれば知らせる。
- 線の太さを変える。太くするときは暗い所を、細くするときは明るい所を広げる（erosion /
  dilation）。線を新しく描き直す方法（線の芯を決めた太さで引き直す）も試したが、ぼかしの影まで
  線として描いてしまい、線画にごみが増えたので使わない（webapp_plan.md 13 章）。

線の太さを変えた画像は、AA の大きさの WORK 倍で持つ（線画の検出器も 2 倍の大きさで見るので、
この大きさがあれば足りる）。AA の大きさは aame.session.Session の base で渡す。
使い方は webapp/server.py の post_prepare を参照。
"""

import numpy as np
import cv2
from PIL import Image
from scipy import ndimage
from skimage import morphology

WORK = 2                 # 下ごしらえする大きさ（AA の何倍か）
MAX_LINE = 6.0           # これより太い所は線ではなく面とみなす（AA の大きさで px）
LOCAL = 4                # 太さを測るときに見る範囲の半径（AA の大きさで px）
# 線の太さの目安（AA の大きさで px。measure の値）。試験の画像で決めた（webapp_plan.md 13 章）:
# 線を引き直して太さを変えると、0.6px で線の 15% を拾えなくなり、5px で二重線が目立つ。
GOOD = (1.0, 3.5)
TARGET = 2.2             # 直すときに目指す太さ（試験の画像は 2.1〜2.7px で、うまく AA になる）


def crop(image, box=None):
    """box = (x0, y0, x1, y1)（画像の幅・高さに対する 0..1 の割合）で切り抜く。None なら切り抜かない。"""
    if not box:
        return image
    w, h = image.size
    x0, y0, x1, y1 = box
    l, t = int(round(min(x0, x1) * w)), int(round(min(y0, y1) * h))
    r, b = int(round(max(x0, x1) * w)), int(round(max(y0, y1) * h))
    l, t = max(0, min(l, w - 1)), max(0, min(t, h - 1))
    r, b = max(l + 1, min(r, w)), max(t + 1, min(b, h))
    if (l, t, r, b) == (0, 0, w, h):
        return image
    return image.crop((l, t, r, b))


def target_size(image, long_side):
    """長辺を long_side px にした (幅, 高さ)（大きくもする）。"""
    w, h = image.size
    s = float(long_side) / max(w, h)
    return max(1, int(round(w * s))), max(1, int(round(h * s)))


def _work(image, size):
    """AA の大きさ size の WORK 倍に直した RGB（uint8）。"""
    image = image.convert("RGB")
    ws = (size[0] * WORK, size[1] * WORK)
    if image.size != ws:
        image = image.resize(ws, Image.LANCZOS)
    return np.asarray(image)


def _kernel(r):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def _lines(rgb):
    """線の芯と、芯の各点での線の太さを求める。返り値: (skel, width)。

    線の所は、周りより暗い量（黒トップハット）を近くの線のいちばん暗い所で割った「濃さ」が
    半分以上の所。広い面（MAX_LINE より太い所）は含めない。
    skel:  線の所を細線化した線の芯
    width: 芯の各点での線の太さ（WORK 倍の大きさで px。芯でない所は 0）
    """
    g = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)
    big = int(np.ceil(MAX_LINE * WORK)) + 2
    bh = cv2.morphologyEx(g, cv2.MORPH_BLACKHAT, _kernel(big))        # 周りより暗い量
    peak = cv2.dilate(bh, _kernel(int(np.ceil(WORK * 1.5))))           # 近くのいちばん暗い所
    strong = bh > 28.0
    ink = np.where(peak > 28.0, np.clip(bh / np.maximum(peak, 1.0), 0.0, 1.0), 0.0).astype(np.float32)
    mask = (ink >= 0.5) & cv2.dilate(strong.astype(np.uint8), _kernel(1)).astype(bool)
    # 広い面を除く: 中心から縁まで MAX_LINE/2 より遠い所と、その周り
    dt = ndimage.distance_transform_edt(mask)
    core = dt > MAX_LINE * WORK / 2.0
    if core.any():
        area = cv2.dilate(core.astype(np.uint8), _kernel(int(np.ceil(MAX_LINE * WORK / 2.0)) + 1)).astype(bool)
        mask &= ~area
    mask = morphology.remove_small_objects(mask, min_size=4 * WORK * WORK, connectivity=2)
    skel = morphology.skeletonize(mask)
    # 太さ = 芯の近くの線の濃さの合計 ÷ 芯の長さ（半径 LOCAL の範囲で）
    r = LOCAL * WORK
    near = cv2.dilate(mask.astype(np.uint8), _kernel(WORK)).astype(np.float32)
    area_sum = cv2.boxFilter(ink * near, -1, (2 * r + 1, 2 * r + 1), normalize=False)
    len_sum = cv2.boxFilter(skel.astype(np.float32), -1, (2 * r + 1, 2 * r + 1), normalize=False)
    width = np.where(skel, area_sum / np.maximum(len_sum, 1.0), 0.0).astype(np.float32)
    return skel, width


def measure(image, size):
    """AA の大きさ size（幅, 高さ）にしたときの線の太さ（px）を測る。

    返り値: {"width": 中央値, "p25", "p75", "lines": 線の芯の長さ（AA の大きさで px）,
             "verdict": "thin" / "good" / "thick" / "none", "good": GOOD}
    """
    rgb = _work(image, size)
    skel, width = _lines(rgb)
    w = width[skel] / WORK
    out = {"good": list(GOOD), "lines": int(skel.sum() / WORK)}
    if w.size < 20 * WORK:
        out.update(width=None, p25=None, p75=None, verdict="none")
        return out
    p25, med, p75 = (float(v) for v in np.percentile(w, [25, 50, 75]))
    verdict = "thin" if med < GOOD[0] else "thick" if med > GOOD[1] else "good"
    out.update(width=round(med, 2), p25=round(p25, 2), p75=round(p75, 2), verdict=verdict)
    return out


def recommended(info):
    """measure の結果から、太さを変える量（AA の大きさで px、0.5 刻み）のおすすめ。目安の中なら 0。"""
    w = info.get("width")
    if w is None or info.get("verdict") == "good":
        return 0.0
    return float(np.round((TARGET - w) * 2.0) / 2.0)


def adjust(image, size, delta):
    """線の太さを delta px（AA の大きさで）だけ変えた画像（AA の大きさの WORK 倍）を返す。

    新しい線は描かず、明暗の広げ縮めだけで変える。太くするときは暗い所を広げ（erosion）、
    細くするときは明るい所を広げる（dilation）。細くするとき、もとから細い線が消えないように、
    線の芯の周り（AA の大きさで約 1px）は元のまま残す。delta は 0.5 刻みより細かくてもよい
    （間の値は、前後の整数の半径の結果を混ぜる）。
    """
    rgb = _work(image, size)
    if not delta:
        return Image.fromarray(rgb)
    r = abs(float(delta)) * WORK / 2.0          # 片側に何 px（WORK 倍の大きさで）広げ縮めするか
    lo, frac = int(np.floor(r)), r - np.floor(r)
    op = cv2.erode if delta > 0 else cv2.dilate

    def morph(k):
        return rgb if k == 0 else op(rgb, _kernel(k))

    out = morph(lo).astype(np.float32)
    if frac > 1e-6:
        out = out * (1.0 - frac) + morph(lo + 1).astype(np.float32) * frac
    if delta < 0:
        skel, _ = _lines(rgb)
        keep = cv2.dilate(skel.astype(np.uint8), np.ones((WORK, WORK), np.uint8)).astype(bool)
        out[keep] = np.minimum(out[keep], rgb[keep])
    return Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8))
