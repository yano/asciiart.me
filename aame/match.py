#coding:utf-8
"""線画の各行に文字を当てはめる。

現行（AA_ChrTool.getAA）と同じ考え方: 行ごとに、各 x から始まる各幅の文字のうち最も合うものを
選んで「x から x + 幅 へ進む辺」とし、行の左端から右端までの最もコストの小さい並びを求める。

違いは計算のしかた。線画も文字も2値なので、差の2乗和は「食い違う画素の数 × 255²」になる。
食い違う画素の数は 窓の中の線の画素数 + 文字のインクの画素数 − 2 × 重なる画素数 で、
重なる画素数は「全位置の窓 × 全文字」の行列の積1回で求まる。

mode:
  "legacy"  現行の出力を1文字も変えずに再現する（照合用）。現行の癖もそのまま:
            ・食い違いが 0 の文字が見つかると、そこで辞書の走査を打ち切る
            ・行の右端 20px ほどには文字を置かない
            ・経路の終わりの1文字を落とすことがある
  "v1"      上の癖を取り除き、さらに「半角スペースを続けない・行頭に置かない」を
            並びを決める段階で守る（あとから全角スペースに置き換えて位置をずらさない）。
  "v2"      並びの決め方は v1 と同じで、コストを「ずれに寛容で、線の向きも見る」もの
            （aame.cost）に替えたもの。細い線（1px）の線画をそのまま渡す。
"""

import heapq
import math

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

from aame.glyphs import MAX_W, MIN_W, ROW_H

TOP = 2         # 各行の上 2px は比べない（現行と同じ）
BAND_H = ROW_H - TOP
N_WIDTHS = MAX_W - MIN_W + 1
POW = 0.4 * math.log(1.5) / math.log(2.0) + 0.7
# COST[n] = 食い違う画素が n 個のときのコスト（現行の math.pow(差の2乗和, POW) と同じ値）
COST = np.array([math.pow(65025.0 * n, POW) for n in range(BAND_H * MAX_W + 1)])
_BIG = 1 << 20


def mismatch_counts(mask, glyphs):
    """n[行, x, 文字] = その行の x に文字を置いたとき食い違う画素の数。x は 0..幅 まで。

    mask は線のある画素が True。画像の右にはみ出す部分は「線なし」として数える。
    """
    rows, width = mask.shape[0] // ROW_H, mask.shape[1]
    pad = np.zeros((rows * ROW_H, width + MAX_W), np.float32)
    pad[:, :width] = mask[:rows * ROW_H]
    band = pad.reshape(rows, ROW_H, width + MAX_W)[:, TOP:]
    win = sliding_window_view(band, MAX_W, axis=2)              # (行, 16, x, 16)
    win = np.ascontiguousarray(win.transpose(0, 2, 1, 3)).reshape(rows * (width + 1), -1)

    gm = glyphs.bitmaps[:, TOP:].reshape(len(glyphs), -1).astype(np.float32)
    box = np.zeros((N_WIDTHS, BAND_H, MAX_W), np.float32)
    for k in range(N_WIDTHS):
        box[k, :, :k + MIN_W] = 1.0
    overlap = win @ gm.T                                        # 重なる画素数
    in_window = win @ box.reshape(N_WIDTHS, -1).T               # 文字の幅の窓にある線の画素数
    n = in_window[:, glyphs.widths - MIN_W] + gm.sum(1) - 2.0 * overlap
    return np.rint(n).astype(np.int32).reshape(rows, width + 1, len(glyphs))


def _legacy_scanned(n, glyphs):
    """現行の打ち切りを再現する: 各位置で、走査される文字が True。

    現行は辞書を順に見ていき、3文字目以降で「その文字と同じ幅の最小の食い違いが 0」に
    なった時点で走査をやめる。
    """
    zero = n == 0
    stop = np.zeros_like(zero)
    for idx in glyphs.by_width:
        stop[:, idx] = np.logical_or.accumulate(zero[:, idx], axis=1)
    stop[:, :2] = False
    return (np.cumsum(stop, axis=1) - stop) == 0


def best_per_width(n, glyphs, scanned=None, skip=None):
    """幅ごとに最も合う文字を選ぶ。n は (位置, 文字)。

    (食い違いの数, 文字の番号) を (位置, 幅の種類) の形で返す。候補が無い所は番号 -1。
    同点なら辞書で先にある文字。skip はその番号の文字を候補から外す。
    """
    big = _BIG if n.dtype.kind == "i" else np.inf
    count = np.full((n.shape[0], N_WIDTHS), big, n.dtype)
    glyph = np.full((n.shape[0], N_WIDTHS), -1, np.int64)
    at = np.arange(n.shape[0])
    for k, idx in enumerate(glyphs.by_width):
        if skip is not None:
            idx = idx[idx != skip]
        if len(idx) == 0:
            continue
        sub = n[:, idx]
        if scanned is not None:
            sub = np.where(scanned[:, idx], sub, big)
        a = sub.argmin(axis=1)
        count[:, k] = sub[at, a]
        glyph[:, k] = np.where(count[:, k] < big, idx[a], -1)
    return count, glyph


def _cost(count):
    return COST[np.minimum(count, len(COST) - 1)]


def _legacy_row(cost, glyph, n_labels):
    """現行の Dijkstra と経路の取り出しを、選ぶ順番まで同じにして再現する。文字の番号の列を返す。

    節点は x = 0..n_labels-1。右端の節点から左へたどる。現行は「距離が最小、同じなら
    左の節点」を毎回選ぶので、(距離, x) のヒープで同じ順になる。
    """
    dist = [1.0e29] * n_labels
    dist[-1] = 0.0
    parent = [-1] * n_labels
    via = [-1] * n_labels
    done = [False] * n_labels
    heap = [(0.0, n_labels - 1)]
    while heap:
        d, s = heapq.heappop(heap)
        if done[s] or d != dist[s]:
            continue
        done[s] = True
        for k in range(N_WIDTHS):
            e = s - k - MIN_W
            if e < 0 or done[e] or glyph[e][k] < 0:
                continue
            nd = d + cost[e][k]
            if dist[e] > nd:
                dist[e] = nd
                parent[e] = s
                via[e] = glyph[e][k]
                heapq.heappush(heap, (nd, e))

    reached = [x for x in range(n_labels) if parent[x] >= 0]
    if not reached:
        return []
    out, x, last = [], reached[0], reached[-1]
    while x != last:        # 現行は、たどり着いた節点のうち最も右のものの文字を出力しない
        out.append(via[x])
        x = parent[x]
        if parent[x] < 0:
            break
    return out


def _v1_row(cost, glyph, alt_cost, alt_glyph, term, space, width):
    """半角スペースを続けない・行頭に置かない、という条件つきで最もコストの小さい並びを求める。

    状態は (x, 直前が半角スペースか)。行頭は「直前が半角スペース」と同じ扱いにする。
    term[x] は x で行を終えるコスト（終えられない所は無限大）。
    """
    inf = float("inf")
    free = [inf] * (width + 1)      # 直前が半角スペースでないとき、x から右端までの最小コスト
    held = [inf] * (width + 1)      # 直前が半角スペースのとき
    free_step = [None] * (width + 1)
    held_step = [None] * (width + 1)
    for x in range(width, -1, -1):
        bf = bh = term[x]
        sf = sh = None
        for k in range(N_WIDTHS - 1, -1, -1):
            nx = x + k + MIN_W
            if nx > width:
                continue
            g = glyph[x][k]
            if g < 0:
                continue
            if g == space:
                v = cost[x][k] + held[nx]
                if v < bf:
                    bf, sf = v, (g, nx, True)
                if alt_glyph[x] >= 0:
                    v = alt_cost[x] + free[nx]
                    if v < bh:
                        bh, sh = v, (alt_glyph[x], nx, False)
            else:
                v = cost[x][k] + free[nx]
                if v < bf:
                    bf, sf = v, (g, nx, False)
                if v < bh:
                    bh, sh = v, (g, nx, False)
        free[x], held[x], free_step[x], held_step[x] = bf, bh, sf, sh

    out, x, is_held = [], 0, True
    while True:
        step = held_step[x] if is_held else free_step[x]
        if step is None:
            return out
        g, x, is_held = step
        out.append(g)


def solve_rows(cost, glyph, alt_cost, alt_glyph, term, space):
    """_v1_row と同じ並びを、すべての行まとめて求める（同点のときの選び方も同じ）。

    cost, glyph は (行, x, 幅の種類)、alt_cost, alt_glyph, term は (行, x)。
    文字の番号の列を行ごとに返し、あわせて各行の合計コストも返す。
    """
    n_rows, n_x, _ = cost.shape
    width = n_x - 1
    ks = np.arange(N_WIDTHS)[::-1]                      # 広い文字から見る（同点なら広いほう）
    at = np.arange(n_rows)
    free = np.full((n_rows, n_x + MAX_W), np.inf)       # 直前が半角スペースでないとき
    held = np.full((n_rows, n_x + MAX_W), np.inf)       # 直前が半角スペースのとき
    free_k = np.full((n_rows, n_x), -1, np.int64)
    held_k = np.full((n_rows, n_x), -1, np.int64)
    is_space = glyph == space
    usable = glyph >= 0
    has_alt = alt_glyph >= 0
    for x in range(width, -1, -1):
        nxs = x + MIN_W + ks
        fr, he = free[:, nxs], held[:, nxs]
        sp = is_space[:, x][:, ks]
        vf = np.where(usable[:, x][:, ks], cost[:, x][:, ks] + np.where(sp, he, fr), np.inf)
        vh = np.where(sp, np.where(has_alt[:, x, None], alt_cost[:, x, None] + fr, np.inf), vf)
        for v, best, step in ((vf, free, free_k), (vh, held, held_k)):
            i = v.argmin(axis=1)
            take = v[at, i] < term[:, x]
            best[:, x] = np.where(take, v[at, i], term[:, x])
            step[:, x] = np.where(take, ks[i], -1)

    picked = []
    for r in range(n_rows):
        out, x, is_held = [], 0, True
        while True:
            k = (held_k if is_held else free_k)[r, x]
            if k < 0:
                break
            g = glyph[r, x, k]
            if g == space and is_held:
                g, is_held = alt_glyph[r, x], False
            else:
                is_held = g == space
            out.append(int(g))
            x += k + MIN_W
        picked.append(out)
    return picked, held[:, 0].copy()


def match_cost(cost, term, glyphs):
    """コスト c[行, x, 文字] と、行を終えるコストから、最もコストの小さい並びを求める。

    (行ごとの文字列のリスト, 行ごとの合計コスト) を返す。
    """
    rows, n_x, _ = cost.shape
    flat = cost.reshape(-1, len(glyphs))
    space = glyphs.index(" ")
    k_space = int(glyphs.widths[space]) - MIN_W
    best, glyph = best_per_width(flat, glyphs)
    alt_best, alt_glyph = best_per_width(flat, glyphs, skip=space)
    picked, total = solve_rows(best.reshape(rows, n_x, N_WIDTHS).astype(np.float64),
                               glyph.reshape(rows, n_x, N_WIDTHS),
                               alt_best[:, k_space].reshape(rows, n_x).astype(np.float64),
                               alt_glyph[:, k_space].reshape(rows, n_x), term, space)
    return ["".join(glyphs.chars[g] for g in row) for row in picked], total


def v1_costs(mask, glyphs):
    """v1 のコスト c[行, x, 文字] と、行を終えるコスト term[行, x]（match_cost に渡せる形）。

    match_cost(*v1_costs(mask, glyphs), glyphs) は match(mask, glyphs, "v1") と同じ並びになる。
    """
    mask = np.asarray(mask, bool)
    rows, width = mask.shape[0] // ROW_H, mask.shape[1]
    band = mask[:rows * ROW_H].reshape(rows, ROW_H, width)[:, TOP:]
    rest = np.concatenate([band.sum(1)[:, ::-1].cumsum(1)[:, ::-1],
                           np.zeros((rows, 1), np.int64)], axis=1)
    term = _cost(rest)
    term[:, :max(width - MAX_W + 1, 0)] = np.inf
    return _cost(mismatch_counts(mask, glyphs)), term


def match(mask, glyphs, mode="v1", **options):
    """線画（線が True）に文字を当てはめ、行ごとの文字列のリストを返す。

    options は v2 のコストの設定（aame.cost.costs の lam、phantom、weight、shift、slide、fill、fill_gain）。
    """
    mask = np.asarray(mask, bool)
    rows, width = mask.shape[0] // ROW_H, mask.shape[1]
    if mode == "v2":
        from aame import cost as cost_v2
        c, term = cost_v2.costs(mask, glyphs, **options)
        return match_cost(c, term, glyphs)[0]
    n = mismatch_counts(mask, glyphs)
    flat = n.reshape(-1, len(glyphs))

    if mode == "legacy":
        count, glyph = best_per_width(flat, glyphs, scanned=_legacy_scanned(flat, glyphs))
        cost = _cost(count).reshape(rows, width + 1, N_WIDTHS).tolist()
        glyph = glyph.reshape(rows, width + 1, N_WIDTHS).tolist()
        n_labels = width - 20
        picked = [_legacy_row(cost[r], glyph[r], n_labels) for r in range(rows)]
    elif mode == "v1":
        space = glyphs.index(" ")
        k_space = int(glyphs.widths[space]) - MIN_W
        count, glyph = best_per_width(flat, glyphs)
        alt_count, alt_glyph = best_per_width(flat, glyphs, skip=space)
        cost = _cost(count).reshape(rows, width + 1, N_WIDTHS).tolist()
        glyph = glyph.reshape(rows, width + 1, N_WIDTHS).tolist()
        alt_cost = _cost(alt_count[:, k_space]).reshape(rows, width + 1).tolist()
        alt_glyph = alt_glyph[:, k_space].reshape(rows, width + 1).tolist()
        # 行を終えるコスト: 残りの幅に文字が1つも入らなくてもよいよう、残り 15px 以下なら
        # 終えてよい。残した所にある線の画素は、すべて食い違いとして数える。
        band = mask[:rows * ROW_H].reshape(rows, ROW_H, width)[:, TOP:]
        rest = np.concatenate([band.sum(1)[:, ::-1].cumsum(1)[:, ::-1],
                               np.zeros((rows, 1), np.int64)], axis=1)
        term = _cost(rest)
        term[:, :max(width - MAX_W + 1, 0)] = np.inf
        term = term.tolist()
        picked = [_v1_row(cost[r], glyph[r], alt_cost[r], alt_glyph[r], term[r], space, width)
                  for r in range(rows)]
    else:
        raise ValueError(f"unknown mode: {mode}")
    return ["".join(glyphs.chars[g] for g in row) for row in picked]
