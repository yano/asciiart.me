#coding:utf-8
"""線画（目標）と AA を描いた画像を比べる指標。

どちらも「線のある画素が True」の2値配列で受け取る。

指標の考え方:
  hamming      画素が食い違う割合。現行の最適化が最小化しているもの（SSD）と同じ向き。
               1px のずれでも大きく悪化するので、見た目との対応は弱い。
  precision@t  AA の線のうち、目標の線から t px 以内にあるものの割合（余計な線が少ないか）
  recall@t     目標の線のうち、AA の線から t px 以内にあるものの割合（線の取りこぼしが少ないか）
  f@t          上2つの調和平均。輪郭検出の評価（BSDS の F 値）と同じ考え方
  chamfer      線から相手の線までの平均距離（px）。両方向の平均。遠い外れは cap で頭打ちにする
  skel_f@t     両方を1px幅に細線化してからの f@t。線の太さの違いに左右されない
  blur_ncc@s   両方をガウスぼかし（σ=s）してからの正規化相関。離れて見たときの似かた
  ink_ratio    AA の線の画素数 ÷ 目標の線の画素数（濃さのつりあい）
  stray        AA の線のうち、目標のどの線からも STRAY_DIST px より離れたものの割合。
               何も無い所に描き足された線（1本の線に「二」を当てたときのもう1本など）
  orient_*@t   precision/recall/f の「合った」の条件に、線の向きが合うこと（30度以内）を加えたもの。
               目標の線の近くにあっても、線を横切る画や直交する画は「合った」と数えない。
               線の上に置いた点（「.」など、向きの無いインク）も「合った」と数えない。
               込み入った文字や点の列で線を覆った AA は f@t では高く出るが、こちらでは下がる。
               向きの決め方は aame.orient（試作: 設定によって順位が変わりうる）。
"""

import numpy as np
from scipy import ndimage
from skimage.morphology import skeletonize

from aame.orient import MIN_COH, orientation

TOLERANCES = (1, 2, 3)
BLUR_SIGMAS = (1.0, 2.0, 4.0)
CHAMFER_CAP = 9.0       # 行の高さ 18px の半分
STRAY_DIST = 5.0
ORIENT_DEG = 30.0       # 向きが合ったとみなす角度の差


def fit(mask, shape):
    """mask を shape に合わせる（足りない所は線なし、はみ出す所は切り捨て）。"""
    out = np.zeros(shape, bool)
    h, w = min(shape[0], mask.shape[0]), min(shape[1], mask.shape[1])
    out[:h, :w] = mask[:h, :w]
    return out


def _dist_to(mask):
    """各画素から mask の最も近い True までの距離。mask が空なら無限大。"""
    if not mask.any():
        return np.full(mask.shape, np.inf)
    return ndimage.distance_transform_edt(~mask)


def _prf(target, render, d_target, d_render, tol):
    p = float((d_target[render] <= tol).mean()) if render.any() else 0.0
    r = float((d_render[target] <= tol).mean()) if target.any() else 0.0
    f = 2 * p * r / (p + r) if p + r > 0 else 0.0
    return p, r, f


def _oriented_hits(a, d_b, idx_b, o_a, o_b, tol, a_is_target):
    """a の各画素について、b の最も近い画素が tol 以内にあり、向きも合う割合。

    向きなしの画素の扱い（aame.cost と同じ考え方）:
      ・目標の向きなし（交点、点で描かれた鼻など）は、AA のどの画素とも合う
      ・AA の向きなし（「.」などの点、画の交点）は、向きのある目標の線とは合わない
    """
    if not a.any():
        return 0.0
    y, x = idx_b[0][a], idx_b[1][a]
    cos2 = o_a[0][a] * o_b[0][y, x] + o_a[1][a] * o_b[1][y, x]
    sure_a, sure_b = o_a[2][a] >= MIN_COH, o_b[2][y, x] >= MIN_COH
    sure_target, sure_aa = (sure_a, sure_b) if a_is_target else (sure_b, sure_a)
    aligned = sure_aa & (cos2 > np.cos(np.radians(2 * ORIENT_DEG)))
    return float(((d_b[a] <= tol) & (~sure_target | aligned)).mean())


def _ncc(a, b):
    a = a - a.mean()
    b = b - b.mean()
    den = float(np.sqrt((a * a).sum() * (b * b).sum()))
    return float((a * b).sum() / den) if den > 0 else 0.0


def evaluate(target, render):
    """target（目標の線画）と render（AA を描いたもの）を比べ、指標の辞書を返す。"""
    target = np.asarray(target, bool)
    render = fit(np.asarray(render, bool), target.shape)
    out = {}

    out["hamming"] = float((target != render).mean())
    union = int((target | render).sum())
    out["iou"] = float((target & render).sum() / union) if union else 1.0
    out["ink_ratio"] = float(render.sum() / target.sum()) if target.any() else float("inf")

    d_t, d_r = _dist_to(target), _dist_to(render)
    for tol in TOLERANCES:
        p, r, f = _prf(target, render, d_t, d_r, tol)
        out[f"precision@{tol}"], out[f"recall@{tol}"], out[f"f@{tol}"] = p, r, f

    if target.any() and render.any():
        i_t = ndimage.distance_transform_edt(~target, return_distances=False, return_indices=True)
        i_r = ndimage.distance_transform_edt(~render, return_distances=False, return_indices=True)
        o_t, o_r = orientation(target), orientation(render)
    for tol in TOLERANCES:
        p = r = 0.0
        if target.any() and render.any():
            p = _oriented_hits(render, d_t, i_t, o_r, o_t, tol, False)
            r = _oriented_hits(target, d_r, i_r, o_t, o_r, tol, True)
        out[f"orient_precision@{tol}"], out[f"orient_recall@{tol}"] = p, r
        out[f"orient_f@{tol}"] = 2 * p * r / (p + r) if p + r > 0 else 0.0

    out["stray"] = float((d_t[render] > STRAY_DIST).mean()) if render.any() else 0.0

    r2t = float(np.minimum(d_t[render], CHAMFER_CAP).mean()) if render.any() else CHAMFER_CAP
    t2r = float(np.minimum(d_r[target], CHAMFER_CAP).mean()) if target.any() else CHAMFER_CAP
    out["chamfer_aa_to_target"] = r2t
    out["chamfer_target_to_aa"] = t2r
    out["chamfer"] = (r2t + t2r) / 2

    ts, rs = skeletonize(target), skeletonize(render)
    ds_t, ds_r = _dist_to(ts), _dist_to(rs)
    for tol in TOLERANCES:
        _, _, f = _prf(ts, rs, ds_t, ds_r, tol)
        out[f"skel_f@{tol}"] = f

    tf, rf = target.astype(np.float32), render.astype(np.float32)
    for s in BLUR_SIGMAS:
        out[f"blur_ncc@{s:g}"] = _ncc(ndimage.gaussian_filter(tf, s), ndimage.gaussian_filter(rf, s))
    return out


def overlay(target, render):
    """見くらべ用の画像（RGB uint8）: 両方にある線は黒、目標だけは赤、AA だけは青。"""
    target = np.asarray(target, bool)
    render = fit(np.asarray(render, bool), target.shape)
    img = np.full(target.shape + (3,), 255, np.uint8)
    img[target & ~render] = (230, 60, 60)
    img[render & ~target] = (60, 110, 230)
    img[target & render] = (0, 0, 0)
    return img
