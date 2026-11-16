#coding:utf-8
"""文字の辞書（文字、幅、ビットマップ）を配列で持つ。"""

from pathlib import Path

import numpy as np

ROW_H = 18      # 1行の高さ
MAX_W = 16      # 最も広い文字の幅
MIN_W = 3       # 最も狭い文字の幅

ROOT = Path(__file__).resolve().parents[1]
# 当てはめに使う辞書。いまの MS Pゴシック（v5.32）で描き直したもの（aame.make_dict）
DICT_FILE = ROOT / "chrDict_20261115_utf8.txt"
# 2017 年の辞書。現行の asciiartme.py と同じ出力を出す legacy でだけ使う
LEGACY_DICT_FILE = ROOT / "chrDict_20170327_utf8.txt"


class GlyphSet:
    """chars[i] の幅が widths[i]、形が bitmaps[i]（インクが True、右側は空白で埋めて幅 16）。

    並び順は辞書ファイルの順。同点のときは先にある文字を選ぶので、順番にも意味がある。
    """

    def __init__(self, chars, widths, bitmaps):
        self.chars = list(chars)
        self.widths = np.asarray(widths, np.int64)
        self.bitmaps = np.asarray(bitmaps, bool)
        self._set = set(self.chars)
        # by_width[k] = 幅 k + MIN_W の文字の番号（辞書の順）
        self.by_width = [np.nonzero(self.widths == w)[0] for w in range(MIN_W, MAX_W + 1)]

    def __len__(self):
        return len(self.chars)

    def __contains__(self, ch):
        return ch in self._set

    def index(self, ch):
        return self.chars.index(ch)

    def without(self, chars):
        """chars の文字を外した辞書（並び順はそのまま）。インクの無い文字（空白）は外さない
        （当てはめが隙間を埋めるのに使うため）。外す文字が無ければ自分を返す。"""
        drop = set(chars)
        keep = [i for i, ch in enumerate(self.chars) if ch not in drop or not self.bitmaps[i].any()]
        if len(keep) == len(self.chars):
            return self
        return GlyphSet([self.chars[i] for i in keep], self.widths[keep], self.bitmaps[keep])

    @classmethod
    def from_chr_list(cls, chr_list):
        """AA_ChrTool.ChrTool.chrDict（Chr のリスト）から作る。"""
        bitmaps = np.zeros((len(chr_list), ROW_H, MAX_W), bool)
        for i, c in enumerate(chr_list):
            bitmaps[i, :, :c.chrIm_w] = (c.chrIm == 0)
        return cls([c.chr for c in chr_list], [c.chrIm_w for c in chr_list], bitmaps)


def load(path=DICT_FILE):
    """辞書のファイルを読む。形式は AA_ChrTool.getChrListFrom18Line と同じ:
    1行目が文字数、そのあと文字ごとに「文字」「幅」「18 行の 0/1（1 がインク）」。
    """
    # splitlines は改行以外の制御文字でも切るので使わない（文字の行に何が来てもよいように）
    lines = Path(path).read_text(encoding="utf-8").replace("\r\n", "\n").split("\n")
    if lines and lines[0].startswith("﻿"):
        lines[0] = lines[0][1:]
    n = int(lines[0])
    chars, widths = [], []
    bitmaps = np.zeros((n, ROW_H, MAX_W), bool)
    at = 1
    for i in range(n):
        chars.append(lines[at][0])
        w = int(lines[at + 1].strip())
        widths.append(w)
        for y in range(ROW_H):
            row = lines[at + 2 + y].ljust(w, "0")
            bitmaps[i, y, :w] = [c == "1" for c in row[:w]]
        at += 2 + ROW_H
    return GlyphSet(chars, widths, bitmaps)
