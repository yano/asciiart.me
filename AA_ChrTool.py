#coding:utf-8

"""Core routines that convert processed images into ASCII art."""

from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from numpy.lib.stride_tricks import sliding_window_view

CHAR_HEIGHT = 18
DEFAULT_DICTIONARY = Path(__file__).with_name("chrDict_20170327_utf8.txt")


@dataclass(frozen=True)
class GlyphTemplate:
    """Representation of a single glyph from the dictionary."""

    char: str
    matrix: np.ndarray
    width: int
    centered: np.ndarray
    norm: float
    mean: float

    @classmethod
    def from_dictionary(cls, char: str, width: int, rows: Sequence[str]) -> "GlyphTemplate":
        matrix = np.full((CHAR_HEIGHT, width), 255, dtype=np.uint8)
        for y, row in enumerate(rows):
            row = row.rstrip("\r\n")
            for x in range(min(width, len(row))):
                matrix[y, x] = 0 if row[x] == "1" else 255

        # Focus matching on the lower 16 rows where most glyph strokes live.
        body = matrix[2:, :].astype(np.float32) / 255.0
        mean = float(body.mean())
        centered = body.ravel() - mean
        norm = float(np.linalg.norm(centered) + 1.0e-6)
        return cls(char=char, matrix=matrix, width=width, centered=centered, norm=norm, mean=mean)

    @classmethod
    def blank(cls, width: int = 1) -> "GlyphTemplate":
        matrix = np.full((CHAR_HEIGHT, width), 255, dtype=np.uint8)
        body = matrix[2:, :].astype(np.float32) / 255.0
        mean = float(body.mean())
        centered = body.ravel() - mean
        norm = float(np.linalg.norm(centered) + 1.0e-6)
        return cls(char=" ", matrix=matrix, width=width, centered=centered, norm=norm, mean=mean)

    def match_cost(self, window: np.ndarray) -> float:
        """Return a normalised cost between this glyph and the given window."""

        body = window[2:, :].astype(np.float32) / 255.0
        window_flat = body.ravel()
        window_mean = float(window_flat.mean())
        centered = window_flat - window_mean
        norm = float(np.linalg.norm(centered) + 1.0e-6)
        similarity = float(np.dot(centered, self.centered) / (norm * self.norm))
        density_penalty = abs(window_mean - self.mean)
        return 1.0 - similarity + 0.3 * density_penalty


class ChrTool:
    """Dictionary driven ASCII art generator."""

    header1 = (
        "<!DOCTYPE html>\r\n<html>\r\n<head>\r\n<meta http-equiv=\"Content-Type\""
        " content=\"text/html\">\r\n<meta charset=\"UTF-8\">\r\n</head>\r\n<body>\r\n"
    )
    header2 = "<div style=\"font-family:'ＭＳ Ｐゴシック';font-size:16px;line-height:18px;\">\r\n<nobr>\r\n"
    footer1 = "</nobr>\r\n</div>\r\n"
    footer2 = "</body>\r\n</html>\r\n"

    def __init__(self, dictionary_path: Optional[str] = None) -> None:
        self.dictionary_path = Path(dictionary_path) if dictionary_path else DEFAULT_DICTIONARY
        self.chrDict = self.getChrListFrom18Line(self.dictionary_path)
        self._glyphs_by_width = self._group_by_width(self.chrDict)
        self._blank = GlyphTemplate.blank()

    @staticmethod
    def _group_by_width(glyphs: Sequence[GlyphTemplate]) -> Dict[int, List[GlyphTemplate]]:
        grouped: Dict[int, List[GlyphTemplate]] = {}
        for glyph in glyphs:
            grouped.setdefault(glyph.width, []).append(glyph)
        return grouped

    def getChrListFrom18Line(self, filename: Path) -> List[GlyphTemplate]:
        glyphs: List[GlyphTemplate] = []
        with io.open(filename, "r", encoding="utf-8") as f:
            total = int(f.readline().strip())
            for _ in range(total):
                char_line = f.readline()
                while char_line == "\n":
                    char_line = f.readline()
                char = char_line.rstrip("\r\n")
                char = char[0] if char else " "

                width_line = f.readline()
                width = int(width_line.strip())

                rows = [f.readline().rstrip("\r\n") for _ in range(CHAR_HEIGHT)]
                glyphs.append(GlyphTemplate.from_dictionary(char, width, rows))
        return glyphs

    def _precompute_costs(self, row_block: np.ndarray) -> Tuple[Dict[int, np.ndarray], Dict[int, List[GlyphTemplate]]]:
        width = row_block.shape[1]
        cost_table: Dict[int, np.ndarray] = {}
        glyph_table: Dict[int, List[GlyphTemplate]] = {}

        for glyph_width, glyphs in self._glyphs_by_width.items():
            limit = width - glyph_width + 1
            if limit <= 0:
                continue

            windows = sliding_window_view(row_block, (CHAR_HEIGHT, glyph_width))
            windows = windows.reshape(-1, CHAR_HEIGHT, glyph_width)
            body = windows[:, 2:, :].astype(np.float32) / 255.0
            flattened = body.reshape(body.shape[0], -1)
            means = flattened.mean(axis=1)
            centered = flattened - means[:, None]
            norms = np.linalg.norm(centered, axis=1) + 1.0e-6

            costs = np.full(limit, np.inf, dtype=np.float32)
            chosen = np.empty(limit, dtype=object)
            chosen[:] = self._blank

            for glyph in glyphs:
                similarity = centered @ glyph.centered
                similarity = similarity / (norms * glyph.norm)
                density_penalty = np.abs(means - glyph.mean)
                glyph_costs = 1.0 - similarity + 0.3 * density_penalty
                mask = glyph_costs < costs
                if np.any(mask):
                    costs[mask] = glyph_costs[mask]
                    chosen[mask] = glyph

            cost_table[glyph_width] = costs
            glyph_table[glyph_width] = list(chosen)

        return cost_table, glyph_table

    def _solve_row(self, row_block: np.ndarray) -> List[str]:
        width = row_block.shape[1]
        cost_table, glyph_table = self._precompute_costs(row_block)

        best_cost = np.full(width + 1, np.inf, dtype=np.float32)
        best_choice: List[Tuple[int, GlyphTemplate]] = [(1, self._blank)] * (width + 1)
        best_cost[width] = 0.0

        for x in range(width - 1, -1, -1):
            candidate_cost = best_cost[x + 1] + 0.1
            candidate_choice = (1, self._blank)

            for glyph_width, costs in cost_table.items():
                if x + glyph_width > width:
                    continue

                cost_index = x
                if cost_index >= costs.shape[0]:
                    continue

                glyph = glyph_table[glyph_width][cost_index]
                total_cost = costs[cost_index] + best_cost[x + glyph_width]

                if total_cost < candidate_cost:
                    candidate_cost = total_cost
                    candidate_choice = (glyph_width, glyph)

            best_cost[x] = candidate_cost
            best_choice[x] = candidate_choice

        chars: List[str] = []
        x = 0
        while x < width:
            glyph_width, glyph = best_choice[x]
            chars.append(glyph.char)
            x += max(glyph_width, 1)

        return chars

    def generate_text_lines(self, imgGray: np.ndarray) -> List[str]:
        if imgGray.ndim != 2:
            raise ValueError("Expected a 2-D grayscale image array")

        img_h, img_w = imgGray.shape
        count = img_h // CHAR_HEIGHT
        lines: List[str] = []

        for i in range(count):
            y = i * CHAR_HEIGHT
            row_block = np.ascontiguousarray(imgGray[y : y + CHAR_HEIGHT, :])
            chars = self._solve_row(row_block)
            text = "　" + "".join(chars)
            text = text.replace("  ", "　")
            text = text.replace("l!", "|.").replace("j!", "｝")
            lines.append(text)

        return lines

    def generate_ascii_art(self, imgGray: np.ndarray) -> str:
        lines = self.generate_text_lines(imgGray)
        strTmpContents = "<br>\r\n".join(lines) + "<br>\r\n"
        strTmp2 = self.header1 + self.header2 + strTmpContents + self.footer1 + self.footer2
        return strTmp2

    def getAA(self, imgGray: np.ndarray) -> str:
        return self.generate_ascii_art(imgGray)

    def render_image(
        self,
        lines: Sequence[str],
        font_path: Optional[str] = None,
        font_size: int = 14,
        padding: int = 8,
    ) -> Image.Image:
        """Render ASCII art lines to a PIL image."""

        if not lines:
            raise ValueError("No lines provided for rendering")

        if font_path:
            font = ImageFont.truetype(font_path, font_size)
        else:
            font = ImageFont.load_default()

        line_heights = []
        line_widths = []
        for line in lines:
            if hasattr(font, "getbbox"):
                bbox = font.getbbox(line)
                line_widths.append(bbox[2] - bbox[0])
                line_heights.append(bbox[3] - bbox[1])
            else:
                size = font.getsize(line)
                line_widths.append(size[0])
                line_heights.append(size[1])

        max_width = max(line_widths) + 2 * padding
        line_height = max(line_heights) + 2
        total_height = len(lines) * line_height + 2 * padding

        image = Image.new("L", (max_width, total_height), color=255)
        draw = ImageDraw.Draw(image)

        y = padding
        for line in lines:
            draw.text((padding, y), line, font=font, fill=0)
            y += line_height

        return image

    def save_ascii_image(
        self,
        lines: Sequence[str],
        output_path: Path,
        font_path: Optional[str] = None,
        font_size: int = 14,
        padding: int = 8,
    ) -> None:
        image = self.render_image(lines, font_path=font_path, font_size=font_size, padding=padding)
        image.save(output_path)
