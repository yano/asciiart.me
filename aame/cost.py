#coding:utf-8
"""ずれに寛容で、線の向きも見る当てはめコスト（v2）。

v1 までのコストは「食い違う画素の数」で、線が 1px ずれただけで全画素が食い違いになる。
そのため細い線には空白が選ばれやすく、線を太らせて渡すしかなかった。

ここでは、文字を置いたときのコストを次の2つの和にする（どちらも単位は「画素」）:

  余計な線   文字のインクの各画素が、目標の線からどれだけ外れているか
  取りこぼし 目標の線の各画素が、文字のインクからどれだけ外れているか（× lam）

「外れ」は、相手の線までの距離に向きの違いを足したもの。距離 1px ごとに 1/TAU、
向きの違い 180/N_BINS 度ごとに MU/TAU を数え、1 で頭打ちにする。つまり
  ・同じ向きの線が TAU px 以上離れている → 1（完全に外れ）
  ・すぐ近くにあっても向きが大きく違う（線を横切る画など）→ 1 に近い
  ・線の上に「.」などの点を置いても、ほとんど合ったことにならない（NU）
向きの決め方と「向きなし」の画素については aame.orient と _penalty を参照。

幻の線: 目標のどの線からも離れた所のインクは、実際には無い線を描き足すことになる
（たとえば線が1本なのに「二」を当てて、もう1本が何も無い所に出る）。空いた所の線は目立つので、
余計な線のコストを TAU px から FAR px にかけて、1 から「取りこぼしの phantom 倍」まで引き上げる。

どちらの項も「窓 × 文字」の積の和なので、全位置・全文字ぶんを行列の積で求められる。

文字の上下のずらし（微小な変形）: 横線を描ける文字は「￣」「ー」「＿」のように高さが
限られていて、その間の高さにある線（行の上から 12〜15px のあごの線など）には合う文字が無い。
そこで、背の低い文字（インクの高さが SHORT px 以下）は、上下に shift px までずらした形でも
比べる。出力されるのは元の文字なので、絵のほうを少し上下に動かして文字に寄せたことになる。
ずらしたぶんは、インク 1px・ずらし 1px あたり slide のコストを足す。ずらした形が行から
はみ出すものは使わないので、目標の線を2つの行が取り合うことは無い。

黒い面: 瞳や太いまつげのように暗い色で塗られた所（fill）では、線ではなく濃さを合わせる。
面の中のインクは「余計な線」に数えず、逆に 1px あたり fill_gain だけコストを下げる。
面の中には画数の多い文字が選ばれ、面の外にはみ出すインクはこれまでどおり余計な線になる。
コストを下げるのは、漢字・記号・半角カタカナだけ（英数字やかなは、面の中に並ぶと
文字として読めてしまうので、埋める役には使わない。_fills を参照）。

近似: 取りこぼしは、その文字自身のインクだけで測る。隣の文字のインクが覆っている場合も
取りこぼしとして数えるので、文字の境目では少し厳しめになる。
"""

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view
from scipy import ndimage

from aame import orient
from aame.glyphs import MAX_W, ROW_H

N_BINS = 8      # 向きの刻み（180度を等分。8 なら 22.5度ごと）
TAU = 3.0       # これ以上外れたら「完全に外れ」
MU = 1.0        # 向きが1刻み違うことを、何 px のずれと同じに数えるか
NU = 2.0        # 文字の「向きなし」の画素（点など）を線に合わせることを、何 px のずれと数えるか
FAR = 6.0       # 目標のどの線からもこれ以上離れたインクは「幻の線」として phantom 倍に数える
SHORT = 6       # インクの高さがこれ以下の文字だけ、上下にずらした形も比べる
_FAR = 1.0e3


def _channels(ink, bin_idx):
    """線の画素を向きごとの面に分ける。(N_BINS + 1, ...) で、最後の面は向きなしの画素。"""
    out = np.zeros((N_BINS + 1,) + ink.shape, np.float32)
    for k in range(N_BINS):
        out[k] = bin_idx == k
    out[N_BINS] = bin_idx == -1
    return out


def _penalty(ink, bin_idx, of_text):
    """相手側の画素から見た「外れ」を 0..1 で返す。(N_BINS + 1, ...)。

    k 番目の面は「相手側の、向き k の画素がここにあったら、どれだけ外れか」。
    最後の面は、相手側の画素が向きなしの場合。
    of_text が True なら ink は文字（相手は目標の線）、False なら ink は目標の線（相手は文字）。

    向きなしの扱いは対称ではない:
      ・目標の向きなし（交点や、点で描かれた鼻など）には、文字のどの画素を合わせてもよい
      ・文字の向きなし（「.」などの点、画の交点）を、向きのある目標の線に合わせると NU だけ外れ
    ink は (..., 高さ, 幅)。前の軸があれば1枚ずつ別の画像として扱う。
    """
    sampling = (_FAR,) * (ink.ndim - 2) + (1.0, 1.0)

    def dist(m):
        if not m.any():
            return np.full(m.shape, _FAR, np.float32)
        return ndimage.distance_transform_edt(~m, sampling=sampling).astype(np.float32)

    by_bin = [dist(bin_idx == j) for j in range(N_BINS)]
    plain = dist(bin_idx == -1)                         # 向きなしの画素まで
    anyone = dist(np.asarray(ink, bool))
    out = np.empty((N_BINS + 1,) + ink.shape, np.float32)
    for k in range(N_BINS):
        best = plain + NU if of_text else plain
        for j in range(N_BINS):
            apart = min((j - k) % N_BINS, (k - j) % N_BINS)
            best = np.minimum(best, by_bin[j] + MU * apart)
        out[k] = best
    out[N_BINS] = anyone if of_text else np.minimum(plain, anyone + NU)
    return np.minimum(out, TAU) / TAU


def _fills(ch):
    """黒い面を埋める役に使う文字か。

    英数字・ギリシャ文字・キリル文字・ひらがな・全角カタカナ（ミを除く）は使わない。
    残るのは漢字、記号、半角カタカナ。
    """
    o = ord(ch)
    letter = (ch.isascii() and ch.isalnum()) or 0xFF10 <= o <= 0xFF19 or 0xFF21 <= o <= 0xFF3A         or 0xFF41 <= o <= 0xFF5A or 0x0370 <= o <= 0x03FF or 0x0400 <= o <= 0x04FF         or 0x3041 <= o <= 0x3096 or (0x30A1 <= o <= 0x30FA and ch != u"ミ")
    return not letter


def _variants(glyphs, shift):
    """上下にずらした形を足したビットマップを返す。(ビットマップ, 元の文字の番号, ずらし量)。

    並びは元の文字ごとにまとめ、ずらさない形を先頭にする。
    """
    bitmaps, owner, moved = [], [], []
    for i, bm in enumerate(glyphs.bitmaps):
        bitmaps.append(bm), owner.append(i), moved.append(0)
        ys = np.nonzero(bm.any(1))[0]
        if len(ys) == 0 or ys[-1] - ys[0] + 1 > SHORT:
            continue
        for dy in range(-shift, shift + 1):
            if dy != 0 and ys[0] + dy >= 0 and ys[-1] + dy < ROW_H:
                bitmaps.append(np.roll(bm, dy, axis=0)), owner.append(i), moved.append(dy)
    return np.array(bitmaps), np.array(owner), np.array(moved)


class GlyphCost:
    """文字側の量（辞書と shift ごとに1度だけ計算する）。"""

    def __init__(self, glyphs, shift=0):
        bm, owner, moved = _variants(glyphs, shift)
        b = orient.bins(bm, N_BINS)
        # ink[形, 向き, y, x] = 文字のインク（向きごと）
        self.ink = _channels(bm, b).transpose(1, 0, 2, 3).reshape(len(bm), -1)
        # miss[形, 向き, y, x] = そこに向き k の目標の線があったときの取りこぼし。文字の幅の外は 0
        miss = _penalty(bm, b, True).transpose(1, 0, 2, 3).copy()
        for i, w in enumerate(glyphs.widths[owner]):
            miss[i, :, :, w:] = 0.0
        self.miss = miss.reshape(len(bm), -1)
        # starts[文字] = その文字の形が始まる位置。moved_ink[形] = ずらした px × インクの画素数
        self.starts = np.nonzero(np.diff(owner, prepend=-1))[0]
        self.moved_ink = (np.abs(moved) * bm.reshape(len(bm), -1).sum(1)).astype(np.float32)
        # tone[形, y, x] = 黒い面を埋める役の文字のインク（向きは問わない）
        usable = np.array([_fills(ch) for ch in glyphs.chars])[owner]
        self.tone = (bm & usable[:, None, None]).reshape(len(bm), -1).astype(np.float32)


_CACHE = {}


def glyph_cost(glyphs, shift=0):
    key = (id(glyphs), shift)
    if key not in _CACHE:
        _CACHE[key] = (glyphs, GlyphCost(glyphs, shift))
    return _CACHE[key][1]


def forget(glyphs):
    """glyphs の辞書について覚えた量を捨てる（使わなくなった辞書の分のメモリを空ける）。"""
    for key in [k for k in _CACHE if k[0] == id(glyphs)]:
        del _CACHE[key]


def costs(mask, glyphs, lam=2.0, phantom=1.5, weight=None, shift=4, slide=0.4,
          fill=None, fill_gain=0.5, only=None):
    """c[行, x, 文字] = その行の x に文字を置いたときのコスト。x は 0..幅。

    mask:    目標の線画（線が True）。細い線（1px）のまま渡す。
    lam:     取りこぼしの重み。大きいほど線を拾おうとして、文字が増える。
    phantom: 幻の線（目標から FAR px 以上離れたインク）1px を、取りこぼし何 px ぶんに数えるか。
             1 より大きければ、線を1本拾うために同じ長さの線をもう1本描き足すことはしない。
    weight:  場所ごとの描き込みの量（mask と同じ形。省略時はすべて 1）。大きい所ほど
             取りこぼしが重くなり、そこだけ lam を上げたのと同じになる（幻の線も同じ率で重くなる）。
    shift:   背の低い文字を上下に何 px までずらして比べるか（0 ならずらさない）。
    slide:   ずらしのコスト（インク 1px を 1px ずらすごと）。小さいほど気軽にずらす。
    fill:    黒い面（mask と同じ形。True が面）。面の中はインクが多いほどコストが下がる。
    fill_gain: 面の中のインク 1px あたりに下げるコスト。大きいほど面を濃く埋める。
    only:    求める行の番号のリスト（省くと全部）。返す配列の行もその順になる。
             線の向きや距離は mask 全体で求めるので、前後の行を含めて渡せば、その行だけを
             全体で求めたときと同じ値になる（aame.session の行の候補で使う）。
    行を終えるコスト term[行, x]（x より右の目標の線をすべて取りこぼす）も返す。
    """
    mask = np.asarray(mask, bool)
    rows, width = mask.shape[0] // ROW_H, mask.shape[1]
    mask = mask[:rows * ROW_H]
    gc = glyph_cost(glyphs, shift)
    n_ch = N_BINS + 1
    n_forms = len(gc.moved_ink)

    b = orient.bins(mask, N_BINS)
    target = _channels(mask, b)
    local = lam
    if weight is not None:
        weight = np.asarray(weight, np.float32)[:rows * ROW_H]
        target *= weight
        local = lam * weight
    n_feat = 2 * n_ch + (fill is not None)
    feat = np.zeros((n_feat, rows * ROW_H, width + MAX_W), np.float32)
    feat[:n_ch, :, width:] = 1.0
    feat[:n_ch, :, :width] = _penalty(mask, b, False)
    if mask.any():
        away = np.clip((ndimage.distance_transform_edt(~mask) - TAU) / (FAR - TAU), 0.0, 1.0)
        feat[:n_ch, :, :width] += np.maximum(phantom * local - 1.0, 0.0) * away
    if fill is not None:
        inside = np.asarray(fill, bool)[:rows * ROW_H]
        feat[:n_ch, :, :width][:, inside] = 0.0
        feat[2 * n_ch, :, :width] = -fill_gain * inside
    feat[n_ch:2 * n_ch, :, :width] = target
    parts = [gc.ink.reshape(n_forms, n_ch, -1), lam * gc.miss.reshape(n_forms, n_ch, -1)]
    if fill is not None:
        parts.append(gc.tone.reshape(n_forms, 1, -1))
    table = np.ascontiguousarray(np.concatenate(parts, axis=1).reshape(n_forms, -1).T)
    moved = slide * gc.moved_ink

    pick = list(range(rows)) if only is None else list(only)
    out = np.empty((len(pick), width + 1, len(glyphs)), np.float32)
    for i, r in enumerate(pick):
        band = feat[:, r * ROW_H:(r + 1) * ROW_H]
        win = sliding_window_view(band, MAX_W, axis=2)          # (面, 18, x, 16)
        win = np.ascontiguousarray(win.transpose(2, 0, 1, 3)).reshape(width + 1, -1)
        # 文字ごとに、ずらした形のうち最も合うものを取る
        out[i] = np.minimum.reduceat(win @ table + moved, gc.starts, axis=1)

    ink = target.sum(0).reshape(rows, ROW_H, width).sum(1)       # (行, x) 列ごとの目標の線の量
    term = np.zeros((rows, width + 1))
    term[:, :width] = lam * ink[:, ::-1].cumsum(1)[:, ::-1]
    term[:, :max(width - MAX_W + 1, 0)] = np.inf
    return out, term[pick]
