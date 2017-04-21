#coding:utf-8

import numpy as np
from PIL import Image
import PIL.Image

class ImPro:

    def __init__(self):
        pass

    def edgeDetect(self, image):

        imgArray = np.asarray(image, dtype=float)

        # --- gray画像化 ---
        imgGray = (imgArray[:, :, 0] + imgArray[:, :, 1] + imgArray[:, :, 2]) / 3.0
        # ------

        # --- ２値化---
        threshold = 128.0  # 64 96 128 160 192 224
        imgGray[imgGray > threshold] = 255.0
        imgGray[imgGray <= threshold] = 0.0
        imgGray = 255.0 - imgGray # 下地を黒に、線を白に
        # ------

        # --- 細線化 ---
        imgGray = imgGray / 255.0

        img_h = imgGray.shape[0]
        img_w = imgGray.shape[1]

        imgGray2 = np.zeros((img_h, img_w), dtype=float)

        for y in range(3, img_h - 1):
            for x in range(3, img_w - 1):
                # 削除候補？
                if int(imgGray[y, x]) != 0:

                    if int(imgGray[y - 1, x] * imgGray[y + 1, x] * imgGray[y, x - 1] * imgGray[y, x + 1]) == 0:
                        if (imgGray[y - 1, x] + imgGray[y + 1, x] + imgGray[y, x - 1] + imgGray[y, x + 1]) > 0:
                            imgGray2[y - 2:y, x - 2:x] = 255.0

        imgGray2 = 255 - imgGray2

        return imgGray2
