#coding:utf-8
"""AA のテキストを、ブラウザで表示したときと同じ画素の画像にする。

評価は「最適化が想定した配置」ではなく「実際に表示される配置」に対して行う。
そのため辞書のビットマップではなく、実フォント（既定は MS Pゴシック 16px）で描く。
MS Pゴシックは 16px の埋め込みビットマップを持つので、2値で描けば画素単位で再現できる。

文字の送り幅は Pillow（FreeType）ではなく Windows の GDI に問い合わせる。
MS Pゴシック 16px では T Y y ｼ ﾜ の5文字で両者が 1px 違い、ブラウザ（Edge）の表示と
合うのは GDI のほう（辞書の幅とも全文字で一致する）。check_render.py で実表示と照合できる。
"""

import ctypes
import re
import sys
from html import unescape

import numpy as np
from PIL import Image, ImageDraw, ImageFont

FONT_PATH = "C:/Windows/Fonts/msgothic.ttc"
FONT_INDEX = 2          # 0: MS Gothic, 1: MS UI Gothic, 2: MS PGothic
FONT_FACE = u"ＭＳ Ｐゴシック"
FONT_SIZE = 16
LINE_HEIGHT = 18
# 行の上端から文字の描画原点までの距離。辞書（18px 高）のビットマップと一致する値
Y_OFFSET = 2

_BR = re.compile(r"<br\s*/?>", re.IGNORECASE)
_SPACES = re.compile(r" {2,}")


class Font:
    """描画用のフォント（Pillow）と、ブラウザと同じ送り幅（GDI）の組。"""

    def __init__(self, path=FONT_PATH, size=FONT_SIZE, index=FONT_INDEX, face=FONT_FACE):
        self.pil = ImageFont.truetype(path, size, index=index)
        self._widths = {}
        self._dc = None
        if sys.platform == "win32":
            self._open_gdi(face, size)

    def _open_gdi(self, face, size):
        from ctypes import wintypes
        gdi = ctypes.windll.gdi32
        gdi.CreateCompatibleDC.argtypes = [wintypes.HDC]
        gdi.CreateCompatibleDC.restype = wintypes.HDC
        gdi.CreateFontW.restype = wintypes.HFONT
        gdi.SelectObject.argtypes = [wintypes.HDC, wintypes.HGDIOBJ]
        gdi.SelectObject.restype = wintypes.HGDIOBJ
        gdi.GetCharWidth32W.argtypes = [wintypes.HDC, wintypes.UINT, wintypes.UINT,
                                        ctypes.POINTER(ctypes.c_int)]
        gdi.GetTextFaceW.argtypes = [wintypes.HDC, ctypes.c_int, wintypes.LPWSTR]
        dc = gdi.CreateCompatibleDC(None)
        # 高さ -size = 文字の大きさ size px、DEFAULT_CHARSET(1)、NONANTIALIASED_QUALITY(3)
        font = gdi.CreateFontW(-size, 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 3, 0, face)
        gdi.SelectObject(dc, font)
        got = ctypes.create_unicode_buffer(64)
        gdi.GetTextFaceW(dc, 64, got)
        if got.value == face:       # 指定のフォントが無いと別のフォントで代用されるので確かめる
            self._gdi, self._dc = gdi, dc

    def width(self, ch):
        w = self._widths.get(ch)
        if w is None:
            if self._dc is not None and ord(ch) < 0x10000:
                out = ctypes.c_int(0)
                self._gdi.GetCharWidth32W(self._dc, ord(ch), ord(ch), ctypes.byref(out))
                w = out.value
            else:
                w = int(round(self.pil.getlength(ch)))
            self._widths[ch] = w
        return w

    def text_width(self, text):
        return sum(self.width(ch) for ch in text)


def html_to_lines(html):
    """asciiartme.py が出力する HTML から AA の各行を取り出す。

    現行の出力は文字を HTML エスケープしていないので、タグとしては解釈せず
    <nobr> の中を <br> で区切る。&amp; などの文字参照はブラウザと同じ規則で戻す。
    """
    m = re.search(r"<nobr>(.*)</nobr>", html, re.DOTALL | re.IGNORECASE)
    body = m.group(1) if m else html
    lines = [unescape(s.strip("\r\n")) for s in _BR.split(body)]
    while lines and lines[-1] == "":
        lines.pop()
    if lines and lines[0] == "":
        lines.pop(0)
    return lines


def browser_text(line):
    """ブラウザの空白の扱いをまねる: 連続する半角スペースは1つになり、行末の半角スペースは消える。"""
    return _SPACES.sub(" ", line).rstrip(" ")


def render_lines(lines, font=None, size=None, line_height=LINE_HEIGHT, y_offset=Y_OFFSET,
                 x_offset=0, as_browser=True):
    """AA を描いて、インクのある画素が True の配列を返す。

    size:     (高さ, 幅)。省略時は AA が収まる大きさ。はみ出した分は切り捨てる。
    x_offset: 描き始めの x。行頭に入れた全角スペースの分を戻すときは負の値にする。
    """
    font = font or Font()
    if as_browser:
        lines = [browser_text(s) for s in lines]
    if size is None:
        w = max([font.text_width(s) for s in lines] + [1]) + x_offset
        size = (line_height * len(lines), max(w, 1))
    h, w = size
    im = Image.new("L", (w, h), 255)
    dr = ImageDraw.Draw(im)
    dr.fontmode = "1"       # アンチエイリアスなし（埋め込みビットマップをそのまま使う）
    for i, s in enumerate(lines):
        x, y = x_offset, i * line_height + y_offset
        for ch in s:
            if x >= w:
                break
            if not ch.isspace():
                dr.text((x, y), ch, font=font.pil, fill=0)
            x += font.width(ch)
    return np.asarray(im) < 128
