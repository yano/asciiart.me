#coding:utf-8
"""文字の辞書（文字、幅、ビットマップ）を配列で持つ。"""

import numpy as np

ROW_H = 18      # 1行の高さ
MAX_W = 16      # 最も広い文字の幅
MIN_W = 3       # 最も狭い文字の幅


class GlyphSet:
    """chars[i] の幅が widths[i]、形が bitmaps[i]（インクが True、右側は空白で埋めて幅 16）。

    並び順は辞書ファイルの順。同点のときは先にある文字を選ぶので、順番にも意味がある。
    """

    def __init__(self, chars, widths, bitmaps):
        self.chars = list(chars)
        self.widths = np.asarray(widths, np.int64)
        self.bitmaps = np.asarray(bitmaps, bool)
        # by_width[k] = 幅 k + MIN_W の文字の番号（辞書の順）
        self.by_width = [np.nonzero(self.widths == w)[0] for w in range(MIN_W, MAX_W + 1)]

    def __len__(self):
        return len(self.chars)

    def index(self, ch):
        return self.chars.index(ch)

    @classmethod
    def from_chr_list(cls, chr_list):
        """AA_ChrTool.ChrTool.chrDict（Chr のリスト）から作る。"""
        bitmaps = np.zeros((len(chr_list), ROW_H, MAX_W), bool)
        for i, c in enumerate(chr_list):
            bitmaps[i, :, :c.chrIm_w] = (c.chrIm == 0)
        return cls([c.chr for c in chr_list], [c.chrIm_w for c in chr_list], bitmaps)
