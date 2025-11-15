#coding:utf-8

"""Image processing utilities used during ASCII art generation."""

from __future__ import annotations

import numpy as np
from PIL import Image, ImageFilter, ImageOps


class ImPro:
    """Image pre-processing pipeline that yields crisp edges.

    The original implementation relied on a fixed threshold and an
    ad-hoc thinning routine.  That approach worked for a handful of sample
    images but tended to lose faint edges and produced thick lines when the
    input resolution changed.  The new implementation extracts edges by
    combining a light Gaussian blur, gradient magnitude estimation and an
    automatic (Otsu) threshold.  The output is a high-contrast binary image
    that preserves detailed strokes while keeping the background dark.
    """

    def __init__(self, gaussian_radius: float = 1.2) -> None:
        self.gaussian_radius = gaussian_radius

    @staticmethod
    def _otsu_threshold(values: np.ndarray) -> float:
        """Return an Otsu threshold for the given image values."""

        histogram, bin_edges = np.histogram(values, bins=256, range=(0.0, 1.0))
        total = values.size

        sum_total = np.dot(histogram, np.linspace(0.0, 1.0, num=histogram.size))

        sum_background = 0.0
        weight_background = 0
        max_variance = 0.0
        threshold = 0.0

        for i, hist_value in enumerate(histogram):
            weight_background += hist_value
            if weight_background == 0:
                continue

            weight_foreground = total - weight_background
            if weight_foreground == 0:
                break

            bin_midpoint = bin_edges[i]
            sum_background += bin_midpoint * hist_value

            mean_background = sum_background / weight_background
            mean_foreground = (sum_total - sum_background) / weight_foreground

            variance_between = (
                weight_background
                * weight_foreground
                * (mean_background - mean_foreground) ** 2
            )

            if variance_between > max_variance:
                max_variance = variance_between
                threshold = bin_midpoint

        return threshold

    def edgeDetect(self, image: Image.Image) -> np.ndarray:
        """Return a binary edge map suitable for glyph matching."""

        gray = ImageOps.grayscale(image)
        if self.gaussian_radius > 0:
            gray = gray.filter(ImageFilter.GaussianBlur(radius=self.gaussian_radius))

        gray_array = np.asarray(gray, dtype=np.float32) / 255.0

        grad_y, grad_x = np.gradient(gray_array)
        gradient = np.sqrt(grad_x * grad_x + grad_y * grad_y)
        gradient /= gradient.max() + 1.0e-6

        threshold = self._otsu_threshold(gradient)
        mask = gradient >= threshold

        binary = np.where(mask, 0, 255).astype(np.uint8)

        # Suppress isolated noise pixels by looking at a 3x3 neighbourhood.
        padded = np.pad(binary, 1, mode="edge")
        neighbourhood = (
            padded[0:-2, 0:-2]
            + padded[0:-2, 1:-1]
            + padded[0:-2, 2:]
            + padded[1:-1, 0:-2]
            + padded[1:-1, 1:-1]
            + padded[1:-1, 2:]
            + padded[2:, 0:-2]
            + padded[2:, 1:-1]
            + padded[2:, 2:]
        )
        binary[neighbourhood >= 8 * 255] = 255

        return binary
