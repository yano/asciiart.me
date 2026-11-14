#coding:utf-8

# from __future__ import print_function

import os
import sys
# import uuid

import numpy as np
from PIL import Image
import PIL.Image

from AA_ImPro import ImPro
from AA_ChrTool import ChrTool

# from binascii import crc32
# import urllib

impro = ImPro()
chrtool = ChrTool()


def resize_to_max(image, max_size=800): #640
    # resize image to max_size
    im_w, im_h = image.size
    if im_w >= im_h:
        if im_w > max_size:
            return image.resize((max_size, int(im_h * float(max_size) / im_w)), Image.LANCZOS)
    else:
        if im_h > max_size:
            return image.resize((int(im_w * float(max_size) / im_h), max_size), Image.LANCZOS)
    return image


if __name__ == '__main__':

    image = Image.open(sys.argv[1])

    filename =  os.path.splitext(sys.argv[1])

    if image != None:

        # アップロードパスを設定する
        filename_aa = filename[0] + '.html'

        img_im = resize_to_max(image)

        # image pre-processing
        img_im = impro.edgeDetect(img_im)

        # generate asciiart
        aa_code = chrtool.getAA(img_im)

        print('done.')

        # output asciiart
        # fout = open(filename_aa, "w")
        # fout.write(aa_code.encode('utf-8'))
        # fout.close()

        with open(filename_aa, "w", encoding="utf-8", newline="\n") as fout:
            fout.write(aa_code)
