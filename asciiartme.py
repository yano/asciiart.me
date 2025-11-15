#coding:utf-8

"""Command line interface for the ASCII art generator."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from PIL import Image

from AA_ImPro import ImPro
from AA_ChrTool import ChrTool


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate ASCII art from an image")
    parser.add_argument("image", help="Path to the input image")
    parser.add_argument(
        "--dictionary",
        dest="dictionary",
        default=None,
        help="Path to a custom character dictionary",
    )
    parser.add_argument(
        "--output-html",
        dest="output_html",
        default=None,
        help="Path to the output HTML file (defaults to <image>.html)",
    )
    parser.add_argument(
        "--output-text",
        dest="output_text",
        default=None,
        help="Optional path for plain-text ASCII art output",
    )
    parser.add_argument(
        "--output-image",
        dest="output_image",
        default=None,
        help="Optional path for rendered ASCII art image",
    )
    parser.add_argument(
        "--font",
        dest="font_path",
        default=None,
        help="Font path used when rendering the ASCII art image",
    )
    parser.add_argument(
        "--font-size",
        dest="font_size",
        type=int,
        default=14,
        help="Font size used when rendering the ASCII art image",
    )
    parser.add_argument(
        "--max-size",
        dest="max_size",
        type=int,
        default=800,
        help="Resize the longer edge of the input before processing",
    )
    parser.add_argument(
        "--gaussian-radius",
        dest="gaussian_radius",
        type=float,
        default=1.2,
        help="Gaussian blur radius applied during edge detection",
    )
    return parser.parse_args()


def _get_resample_filter() -> int:
    try:
        return Image.Resampling.LANCZOS  # type: ignore[attr-defined]
    except AttributeError:
        return Image.LANCZOS  # type: ignore[attr-defined]


def resize_image(image: Image.Image, max_size: int) -> Image.Image:
    if max(image.size) <= max_size:
        return image

    width, height = image.size
    if width >= height:
        new_size = (max_size, int(height * float(max_size) / width))
    else:
        new_size = (int(width * float(max_size) / height), max_size)
    return image.resize(new_size, _get_resample_filter())


def main() -> None:
    args = parse_args()

    impro = ImPro(gaussian_radius=args.gaussian_radius)
    chrtool = ChrTool(dictionary_path=args.dictionary)

    image = Image.open(args.image)
    image = resize_image(image, args.max_size)

    processed = impro.edgeDetect(image)
    lines = chrtool.generate_text_lines(processed)
    html = chrtool.generate_ascii_art(processed)

    output_html = args.output_html
    if not output_html:
        base, _ = os.path.splitext(args.image)
        output_html = base + ".html"
    with open(output_html, "w", encoding="utf-8") as fout:
        fout.write(html)

    if args.output_text:
        with open(args.output_text, "w", encoding="utf-8") as fout:
            fout.write("\n".join(lines))

    if args.output_image:
        output_path = Path(args.output_image)
        chrtool.save_ascii_image(
            lines,
            output_path=output_path,
            font_path=args.font_path,
            font_size=args.font_size,
        )

    print("ASCII art generation complete.")


if __name__ == "__main__":
    main()
