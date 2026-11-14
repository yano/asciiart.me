#coding:utf-8
"""2値の細い線（1px 幅）の、各画素での線の向き。

各画素について、まわり (2R+1)x(2R+1) の中でその画素とつながっている線の画素を集め、
その並びの主軸を向きとする（その画素を原点にした2次モーメント）。
フォントのビットマップのような短い画（「_」など）でも向きが決まり、
込み入った文字でも、つながっていない隣の画は混ざらない。

次の画素は「向きなし」とする:
  ・点（つながった画素が隣にしか無い。「.」や 2x2 の点）
  ・角や交点（つながった画素の並びが一方向にそろっていない）

向きは2倍角の単位ベクトルで持つ（0度と180度を同じ向きとして扱うため）。
当てはめのコスト（aame.cost）と評価（aaeval.metrics）の両方で使う。
"""

import numpy as np

RADIUS = 3      # 向きを見る範囲
MIN_COH = 0.5   # これより向きがそろっていない所は「向きなし」とする


def _ring(r):
    return [(dy, dx) for dy in range(-r, r + 1) for dx in range(-r, r + 1)
            if max(abs(dy), abs(dx)) == r]


def orientation(mask, radius=RADIUS):
    """各画素の向き。2倍角の単位ベクトル (cos2θ, sin2θ) と、向きのそろい具合 0..1 を返す。

    θ は線の向き（x 軸から、画像の下向きを正に測る）。線の無い画素と点では、そろい具合は 0。
    mask は (..., 高さ, 幅)。前の軸があれば、1枚ずつ別の画像として扱う。
    """
    m = np.asarray(mask, bool)
    h, w = m.shape[-2:]
    pad = np.pad(m, [(0, 0)] * (m.ndim - 2) + [(radius, radius)] * 2)

    def at(dy, dx):
        return pad[..., radius + dy:radius + dy + h, radius + dx:radius + dx + w]

    # joined[(dy, dx)] = その画素と (dy, dx) 先の画素が、窓の中でつながっている
    joined = {o: m & at(*o) for o in _ring(1)}
    for r in range(2, radius + 1):
        for o in _ring(r):
            via = np.zeros(m.shape, bool)
            for q in _ring(r - 1):
                if max(abs(o[0] - q[0]), abs(o[1] - q[1])) == 1:
                    via |= joined[q]
            joined[o] = via & at(*o)

    mxx = np.zeros(m.shape, np.float32)
    myy = np.zeros(m.shape, np.float32)
    mxy = np.zeros(m.shape, np.float32)
    reach = np.zeros(m.shape, bool)
    for (dy, dx), j in joined.items():
        mxx += j * (dx * dx)
        myy += j * (dy * dy)
        mxy += j * (dx * dy)
        if max(abs(dy), abs(dx)) >= 2:
            reach |= j
    c, s = mxx - myy, 2 * mxy
    mag = np.hypot(c, s)
    coh = np.where(reach, mag / (mxx + myy + 1e-9), 0.0)
    return c / (mag + 1e-9), s / (mag + 1e-9), coh


def bins(mask, n_bins, min_coh=MIN_COH):
    """各画素の向きを n_bins 等分した番号（0..n_bins-1）。向きなしは -1。線の無い画素は -2。"""
    c, s, coh = orientation(mask)
    theta = 0.5 * np.arctan2(s, c)                      # -90度..90度
    b = np.rint(theta / (np.pi / n_bins)).astype(np.int64) % n_bins
    b[coh < min_coh] = -1
    b[~np.asarray(mask, bool)] = -2
    return b
