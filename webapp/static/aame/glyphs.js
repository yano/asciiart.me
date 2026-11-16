// 文字の辞書（文字、幅、ビットマップ）。aame/glyphs.py を JavaScript に移したもの。

export const ROW_H = 18;      // 1行の高さ
export const MAX_W = 16;      // 最も広い文字の幅
export const MIN_W = 3;       // 最も狭い文字の幅
export const N_WIDTHS = MAX_W - MIN_W + 1;
export const CELL = ROW_H * MAX_W;  // 1文字のビットマップの画素数

// chars[i] の幅が widths[i]、形が bitmaps の i 番目（ROW_H × MAX_W、1 がインク。幅の外は 0）。
// 並び順は辞書ファイルの順。同点のときは先にある文字を選ぶので、順番にも意味がある。
export class GlyphSet {
  constructor(chars, widths, bitmaps) {
    this.chars = chars;
    this.widths = Int32Array.from(widths);
    this.bitmaps = bitmaps;
    this.size = chars.length;
    this._index = new Map();
    chars.forEach((ch, i) => { if (!this._index.has(ch)) this._index.set(ch, i); });
    this.inked = new Uint8Array(this.size);
    for (let i = 0; i < this.size; i++) {
      const bm = this.bitmap(i);
      for (let p = 0; p < CELL; p++) if (bm[p]) { this.inked[i] = 1; break; }
    }
    // byWidth[k] = 幅 k + MIN_W の文字の番号（辞書の順）
    this.byWidth = [];
    for (let w = MIN_W; w <= MAX_W; w++) {
      const idx = [];
      for (let i = 0; i < this.size; i++) if (this.widths[i] === w) idx.push(i);
      this.byWidth.push(Int32Array.from(idx));
    }
  }

  has(ch) { return this._index.has(ch); }

  index(ch) {
    const i = this._index.get(ch);
    return i === undefined ? -1 : i;
  }

  bitmap(i) { return this.bitmaps.subarray(i * CELL, (i + 1) * CELL); }

  // chars の文字を外した辞書（並び順はそのまま）。インクの無い文字（空白）は外さない
  // （当てはめが隙間を埋めるのに使うため）。外す文字が無ければ自分を返す。
  without(chars) {
    const drop = new Set(Array.from(chars));
    const keep = [];
    for (let i = 0; i < this.size; i++) if (!drop.has(this.chars[i]) || !this.inked[i]) keep.push(i);
    if (keep.length === this.size) return this;
    const bitmaps = new Uint8Array(keep.length * CELL);
    keep.forEach((i, j) => bitmaps.set(this.bitmap(i), j * CELL));
    return new GlyphSet(keep.map((i) => this.chars[i]), keep.map((i) => this.widths[i]), bitmaps);
  }
}

// 辞書のファイル（chrDict_*.txt）を読む。1行目が文字数、そのあと文字ごとに「文字」「幅」「18 行の 0/1」。
export function parseDict(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines.length && lines[0].startsWith("﻿")) lines[0] = lines[0].slice(1);
  const n = parseInt(lines[0], 10);
  const chars = [], widths = [];
  const bitmaps = new Uint8Array(n * CELL);
  let at = 1;
  for (let i = 0; i < n; i++) {
    chars.push(String.fromCodePoint(lines[at].codePointAt(0)));
    const w = parseInt(lines[at + 1].trim(), 10);
    widths.push(w);
    for (let y = 0; y < ROW_H; y++) {
      const row = lines[at + 2 + y] || "";
      for (let x = 0; x < w; x++) if (row[x] === "1") bitmaps[i * CELL + y * MAX_W + x] = 1;
    }
    at += 2 + ROW_H;
  }
  return new GlyphSet(chars, widths, bitmaps);
}
