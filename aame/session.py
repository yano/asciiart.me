#coding:utf-8
"""画像1枚ぶんの途中結果を持ち、設定を変えた AA を何度でも作り直す。

線の強さ、顔の領域、色の境界、黒い面は、画像ごとに1度だけ求めて使い回す。
設定を変えた作り直しは当てはめ（aame.match）だけで済む。

使い方:
    s = Session(Image.open("miku.png"))
    lines = s.render(lam=2.0, color="face", face_gain=2.0)
    lines = s.render(lam=2.5, mask=painted, mask_gain=3.0)   # 塗った所だけ描き込みを増やす
    lines = s.render(paint=levels)          # 画面で塗り重ねた段階（regions.paint_weight）
    lines = s.render(edit=edited)           # 画面で直した線画（lineart.edit_masks）
    lines = s.render(glyphs=convert.glyph_set().without("escｅｓｃ"))   # 使わない文字を外す

aame.candidates と Web アプリ（webapp）が使う。
"""

import io

import cv2
import numpy as np
from PIL import Image

from aame import convert, lineart, match, regions
from aame.glyphs import ROW_H

DEFAULT_METHOD = "manga_line"
# 行の候補: 線画を上下にずらして当てはめ直す量（px）。(dx, dy, 名前)
# 左右のずらしは、文字の並びがほとんど変わらず行全体が動くだけだったので外した（2026-11-15）
ROW_SHIFTS = [(0, -1, "上に 1px"), (0, 1, "下に 1px"), (0, -2, "上に 2px"), (0, 2, "下に 2px")]
# 行の候補: 線画を、その行の線の重心を中心に横へ伸び縮みさせる倍率。(倍率, 名前)
# 重心から遠い所ほど大きく動くので、行の中の文字の間合いが変わる
ROW_SCALES = [(0.995, "0.5% 縮める"), (1.005, "0.5% 広げる"), (0.99, "1% 縮める"),
              (1.01, "1% 広げる"), (0.98, "2% 縮める"), (1.02, "2% 広げる")]
SCALE_MARGIN = 2        # 伸び縮みした線画を2値にするとき、上下に余分に見る行の数
ROW_OTHERS = 2          # 「別の並び」の数
OTHER_PENALTY = 2.0     # 別の並びを探すとき、前に選んだ文字を同じ所に置くと足すコスト
# 行の候補: 設定を変えて当てはめ直す。(名前, 設定を変える関数)
ROW_MODES = [
    ("標準（線だけ）", lambda st: dict(st, mode="v2", color=None, fill=None)),
    ("色の境界", lambda st: dict(st, mode="v2", color="all", fill=None)),
    ("色の境界 + 黒い面", lambda st: dict(st, mode="v2", color="all", fill="face")),
    ("控えめ", lambda st: dict(st, mode="v2", lam=round(st.get("lam", 2.0) * 0.75, 3))),
    ("多め", lambda st: dict(st, mode="v2", lam=round(st.get("lam", 2.0) * 1.33, 3))),
    ("高密度", lambda st: dict(st, mode="v1", width=3)),
]


class Session:
    """1枚の画像と、その途中結果。

    image:  PIL の画像。
    method: 線画にする方法（aame.lineart.METHODS の名前）。
    scale:  AA の大きさの倍率（1 で長辺 800px まで。lineart.canvas_size）。大きさが少し
            変わるだけで文字の並びが変わるので、少しずつ違う大きさの候補を作るのに使う。
    base:   倍率 1 のときの AA の大きさ (幅, 高さ)。省くと lineart.canvas_size(image)。
            前処理（aame.prep）で大きさを決めた画像に使う。
    """

    def __init__(self, image, method=DEFAULT_METHOD, scale=1.0, base=None):
        self.image = image
        self.method = method
        self.scale = scale
        bw, bh = base or lineart.canvas_size(image)
        size = (bw, bh) if scale == 1.0 else (max(1, int(round(bw * scale))), max(1, int(round(bh * scale))))
        base = lineart.strength(image, method, size=size)
        self.shape = base.shape                     # (高さ, 幅)。AA にする大きさ
        self.size = (base.shape[1], base.shape[0])  # (幅, 高さ)
        self._strength = {None: base}
        self._masks = {}
        self._faces = None
        self._face_weights = {}
        self._edges = None
        self._dark = {}

    @property
    def rows(self):
        """AA の行の数（下の端の、1行に満たない所は使わない）。"""
        return self.shape[0] // ROW_H

    @property
    def faces(self):
        """顔の領域（True が顔）。初めて使うときに求める。"""
        if self._faces is None:
            self._faces = regions.find_faces(self.image, self.size)
        return self._faces

    def face_weight(self, gain):
        """顔の中が gain、外が 1 の重みの地図。"""
        if gain not in self._face_weights:
            self._face_weights[gain] = regions.face_weight(self.image, self.size, gain=gain,
                                                           faces=self.faces)
        return self._face_weights[gain]

    def strength(self, color=None):
        """線の強さ。color に "face" か "all" を渡すと色の境界を足したもの。"""
        if color not in self._strength:
            if color == "face":
                region = self.face_weight(2.0) - 1.0
            elif color == "all":
                region = None
            else:
                raise ValueError(f"unknown region: {color}")
            if self._edges is None:
                self._edges = lineart.strength(self.image, lineart.COLOR_METHOD, size=self.size)
            self._strength[color] = lineart.merge_color_edges(self._strength[None], self._edges,
                                                              region)
        return self._strength[color]

    def edits(self, edit):
        """線画の直し edit を (描いた線, 消した所) の2値の配列の組にする。

        edit は画面で直した画像（RGB。lineart.edit_masks）か、その配列の組か None。
        """
        if edit is None or isinstance(edit, tuple):
            return edit
        return lineart.edit_masks(edit, self.size)

    def line_mask(self, color=None, width=1, edit=None):
        """2値の線（True が線）。v2 には width=1 の細い線を渡す。

        edit（線画の直し。edits）を渡すと、1px の線に当ててから width の太さにする。
        """
        edit = self.edits(edit)
        if edit is not None:
            return lineart.apply_edit(self.line_mask(color, 1), *edit, width=width)
        key = (color, width)
        if key not in self._masks:
            self._masks[key] = lineart.binarize(self.strength(color), width=width)
        return self._masks[key]

    def dark(self, where):
        """黒い面（True が面）。where は "face" か "all"。"""
        if where not in self._dark:
            faces = self.faces if where == "face" else None
            self._dark[where] = regions.dark_areas(self.image, self.size, where, faces=faces)
        return self._dark[where]

    def weight(self, face_gain=1.0, mask=None, mask_gain=2.0, less=None, less_gain=0.5, paint=None):
        """場所ごとの描き込みの量（v2 の weight）。何も指定が無ければ None。

        顔（face_gain）と増やすマスク（mask）は大きいほうを取り、減らすマスク（less）は
        それに掛ける。mask と less は塗った画像（PIL。白か不透明な所が塗った所）。
        paint は画面で塗り重ねた段階の画像（regions.paint_weight）で、顔の中でも外でも掛ける。
        """
        maps = []
        if face_gain != 1.0:
            maps.append(self.face_weight(face_gain))
        if mask is not None:
            maps.append(regions.mask_weight(mask, self.size, gain=mask_gain))
        w = None
        if maps:
            w = maps[0] if len(maps) == 1 else np.maximum(*maps)
        if less is not None:
            cut = regions.mask_weight(less, self.size, gain=less_gain)
            w = cut if w is None else w * cut
        if paint is not None:
            p = regions.paint_weight(paint, self.size)
            w = p if w is None else w * p
        return w

    def render(self, lam=2.0, color=None, fill=None, fill_gain=0.5, face_gain=2.0,
               mask=None, mask_gain=2.0, less=None, less_gain=0.5, paint=None, mode="v2", width=2,
               phantom=1.5, shift=4, slide=0.4, glyphs=None, edit=None):
        """設定に合わせて AA を作り、行のリストを返す。

        mode="v2"（標準）の設定:
            lam        描き込みの量（1.5 で控えめ、3 で多め）
            color      色の境界を足す所（None / "face" / "all"）
            fill       黒い面を埋める所（None / "face" / "all"）と、その濃さ fill_gain
            face_gain  顔の中の描き込みを何倍にするか（1 で変えない）
            mask       描き込みを増やす所を塗った画像と、その倍率 mask_gain
            less       描き込みを減らす所を塗った画像と、その倍率 less_gain（1 未満）
            paint      画面で「増やす」「減らす」を塗り重ねた段階の画像（regions.paint_weight）
            phantom, shift, slide は aame.cost.costs を参照
        mode="v1" は線を width px に太らせて当てはめる（width=3 で高密度）。lam や重みは使わない。
        glyphs は使う文字の辞書（aame.glyphs.GlyphSet。GlyphSet.without で文字を外せる）。
        省くと標準の辞書。
        edit は線画の直し（画面で消した所・描いた線。edits を参照）。v1 にも v2 にも効く。
        """
        if mode != "v2":
            return convert.to_lines(self.line_mask(color, width, edit), mode, glyphs=glyphs)
        weight = self.weight(face_gain, mask, mask_gain, less, less_gain, paint)
        return convert.to_lines(self.line_mask(color, 1, edit), "v2", glyphs=glyphs, lam=lam, phantom=phantom,
                                weight=weight, shift=shift, slide=slide,
                                fill=self.dark(fill) if fill else None, fill_gain=fill_gain)

    # ---------- 行ごとの候補（画面の「行を直す」） ----------

    def _window(self, a, row, dx, dy, fill_value):
        """配列 a（AA の大きさ）から、row 行目とその上下1行ずつ（3行 = 54px）を切り出す。

        中身を右に dx、下に dy px ずらす（はみ出した所は fill_value）。下の端の1行に満たない所は、
        全体を当てはめるときと同じく使わない。
        """
        used = self.rows * ROW_H
        h, w = 3 * ROW_H, a.shape[1]
        out = np.full((h, w) + a.shape[2:], fill_value, a.dtype)
        y0 = (row - 1) * ROW_H - dy                 # 窓の上端に来る元の y
        ys, ye = max(0, -y0), min(h, used - y0)
        xs, xe = max(0, dx), min(w, w + dx)
        if ys < ye and xs < xe:
            out[ys:ye, xs:xe] = a[y0 + ys:y0 + ye, xs - dx:xe - dx]
        return out

    def _center(self, row, color, width, edit=None):
        """row 行目の線（2値の線画）の、横の重心（線の画素を同じ重さとして）。線が無ければ None。"""
        band = self.line_mask(color, width, edit)[row * ROW_H:(row + 1) * ROW_H]
        xs = np.nonzero(band)[1]
        return float(xs.mean()) if xs.size else None

    def _scaled_mask(self, row, sx, cx, color, width, edit=None):
        """線の強さを、x = cx を中心に横へ sx 倍してから2値にした線画（AA の大きさ）。

        2値の線を直接伸び縮みすると、縮めたとき縦の線が消えたり、広げたとき横の線が切れたり
        するので、2値にする前の強さを伸び縮みする。row 行目の上下 1 + SCALE_MARGIN 行だけ作る
        （その外は線なし。_window が切り出すのは上下1行まで）。
        edit（線画の直し）は、同じだけ伸び縮みしてから 1px の線に当てる。
        """
        used = self.rows * ROW_H
        y0 = max(0, (row - 1 - SCALE_MARGIN) * ROW_H)
        y1 = min(used, (row + 2 + SCALE_MARGIN) * ROW_H)
        out = np.zeros(self.shape, bool)
        if y0 < y1:
            band = _hscale(self.strength(color)[y0:y1], sx, cx, 0.0, cv2.INTER_LINEAR)
            if edit is None:
                out[y0:y1] = lineart.binarize(band, width=width)
            else:
                add, erase = (_hscale(a[y0:y1], sx, cx, False, cv2.INTER_NEAREST) for a in edit)
                out[y0:y1] = lineart.apply_edit(lineart.binarize(band, width=1), add, erase, width=width)
        return out

    def _row_cost(self, row, dx=0, dy=0, sx=1.0, lam=2.0, color=None, fill=None, fill_gain=0.5,
                  face_gain=2.0, mask=None, mask_gain=2.0, less=None, less_gain=0.5, paint=None,
                  mode="v2", width=2, phantom=1.5, shift=4, slide=0.4, glyphs=None, edit=None):
        """row 行目だけのコスト c[1, x, 文字] と term[1, x]（render と同じ設定）。

        dx, dy で線画（と重みなどの地図）をずらし、sx で行の線の重心を中心に横へ伸び縮みする。
        """
        glyphs = glyphs or convert.glyph_set()
        edit = self.edits(edit)
        lw = width if mode != "v2" else 1
        cx = self._center(row, color, lw, edit) if sx != 1.0 else None
        scaled = cx is not None

        def lines():
            if scaled:
                return self._scaled_mask(row, sx, cx, color, lw, edit)
            return self.line_mask(color, lw, edit)

        def stretch(a, fill_value, interp):
            return _hscale(a, sx, cx, fill_value, interp) if scaled else a

        if mode != "v2":
            m = self._window(lines(), row, dx, dy, False)
            c, term = match.v1_costs(m, glyphs)
            return c[1:2], term[1:2], glyphs
        from aame import cost
        weight = self.weight(face_gain, mask, mask_gain, less, less_gain, paint)
        m = self._window(lines(), row, dx, dy, False)
        w = None if weight is None else self._window(
            stretch(weight.astype(np.float32), 1.0, cv2.INTER_LINEAR), row, dx, dy, 1.0)
        f = (self._window(stretch(self.dark(fill), False, cv2.INTER_NEAREST), row, dx, dy, False)
             if fill else None)
        c, term = cost.costs(m, glyphs, lam=lam, phantom=phantom, weight=w, shift=shift,
                             slide=slide, fill=f, fill_gain=fill_gain, only=[1])
        return c, term, glyphs

    @staticmethod
    def _placed(line, glyphs):
        """行の文字列を、インクのある文字の (x, 文字の番号) の並びにする（空白は除く）。"""
        out, x = [], 0
        for ch in line:
            i = glyphs.index(ch)
            if glyphs.bitmaps[i].any():
                out.append((x, i))
            x += int(glyphs.widths[i])
        return out

    def row_line(self, row, **settings):
        """row 行目だけを当てはめる（render(**settings)[row] と同じ行になる）。"""
        c, term, glyphs = self._row_cost(row, **settings)
        return convert.finish(match.match_cost(c, term, glyphs)[0], glyphs)[0]

    def row_options(self, row, settings, current=None):
        """row 行目の別の候補を返す。[{"kind", "label", "line"}]。

        kind:
          "other"  同じ設定で、前に選んだ文字を同じ所に置くとコストが上がるようにして
                   当てはめ直したもの（2番目、3番目に良い並び）
          "shift"  線画を上下に少しずらして当てはめ直したもの（ROW_SHIFTS）
          "scale"  線画を、行の線の重心を中心に横へ少し伸び縮みさせたもの（ROW_SCALES）
          "mode"   設定を変えて当てはめ直したもの（ROW_MODES）
        settings は render に渡す設定。current（いま表示している行）と見た目が同じになる
        候補と、候補どうしで見た目が同じものは除く。
        """
        glyphs = settings.get("glyphs") or convert.glyph_set()
        settings = dict(settings, edit=self.edits(settings.get("edit")))   # 画像なら1度だけ配列にする
        seen = set()
        if current is not None:
            seen.add(_look(current, glyphs))
        out = []

        def add(kind, label, line):
            key = _look(line, glyphs)
            if key not in seen:
                seen.add(key)
                out.append(dict(kind=kind, label=label, line=line))

        # 同じ設定のまま、別の並び
        c, term, _ = self._row_cost(row, **settings)
        raw = match.match_cost(c, term, glyphs)[0][0]
        base = convert.finish([raw], glyphs)[0]
        if current is None or _look(base, glyphs) != _look(current, glyphs):
            add("other", "いまの設定のいちばん", base)
        else:
            seen.add(_look(base, glyphs))
        c = c.copy()
        for k in range(ROW_OTHERS):
            for x, i in self._placed(raw, glyphs):
                c[0, x, i] += OTHER_PENALTY
            raw = match.match_cost(c, term, glyphs)[0][0]
            add("other", f"{k + 2}番目", convert.finish([raw], glyphs)[0])
        # 上下にずらす
        for dx, dy, label in ROW_SHIFTS:
            add("shift", label, self.row_line(row, dx=dx, dy=dy, **settings))
        # 横に伸び縮み（行に線が無ければ出さない）
        lw = settings.get("width", 2) if settings.get("mode", "v2") != "v2" else 1
        if self._center(row, settings.get("color"), lw, settings["edit"]) is not None:
            for sx, label in ROW_SCALES:
                add("scale", label, self.row_line(row, sx=sx, **settings))
        # 設定を変える
        for label, change in ROW_MODES:
            add("mode", label, self.row_line(row, **change(dict(settings))))
        return out

    def lineart_png(self, color=None, edit=None):
        """当てはめに使う 1px の線を、黒い線・透明な地の PNG にして返す（edit は線画の直し）。"""
        m = self.line_mask(color, 1, edit)
        rgba = np.zeros(m.shape + (4,), np.uint8)
        rgba[m, 3] = 255
        return _png(Image.fromarray(rgba, "RGBA"))

    def source_png(self):
        """元の画像を AA の大きさにしたものを PNG で返す（AA と重ねて表示する用）。"""
        image = self.image.convert("RGB")
        if image.size != self.size:
            image = image.resize(self.size, Image.LANCZOS)
        return _png(image)


def _hscale(a, sx, cx, fill_value, interp):
    """2次元以上の配列 a を、x = cx を中心に横へ sx 倍する（大きさは変えない。外は fill_value）。"""
    h, w = a.shape[:2]
    map_x = np.broadcast_to((cx + (np.arange(w, dtype=np.float32) - cx) / sx)[None, :], (h, w))
    map_y = np.broadcast_to(np.arange(h, dtype=np.float32)[:, None], (h, w))
    src = a.astype(np.uint8) if a.dtype == bool else a
    out = cv2.remap(src, np.ascontiguousarray(map_x), np.ascontiguousarray(map_y), interp,
                    borderMode=cv2.BORDER_CONSTANT, borderValue=float(fill_value))
    return out.astype(bool) if a.dtype == bool else out


def _look(line, glyphs):
    """行の見た目（インクのある文字の位置と形）。空白の並べ方だけが違う行は同じになる。"""
    out, x = [], 0
    for ch in line:
        try:
            i = glyphs.index(ch)
        except ValueError:
            out.append((x, ch))
            x += 16
            continue
        if glyphs.bitmaps[i].any():
            out.append((x, glyphs.bitmaps[i].tobytes()))
        x += int(glyphs.widths[i])
    return tuple(out)


def _png(image):
    buf = io.BytesIO()
    image.save(buf, "PNG")
    return buf.getvalue()
