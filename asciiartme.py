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

if __name__ == '__main__':

    image = Image.open(sys.argv[1])
        
    filename =  os.path.splitext(sys.argv[1])
    
    if image != None:

        # アップロードパスを設定する
        filename_aa = filename[0] + '.html'

        image_size = image.size
        im_w = image_size[0]
        im_h = image_size[1]

        max_size = 800 #640

        # resize image to max_size
        img_im = None
        if im_w >= im_h:
            if im_w > max_size:
                img_im = image.resize((max_size, int(im_h * float(max_size) / im_w)), Image.ANTIALIAS)
            else:
                img_im = image
        else:
            if im_h > max_size:
                img_im = image.resize((int(im_w * float(max_size) / im_h), max_size), Image.ANTIALIAS)
            else:
                img_im = image

        # image pre-processing
        img_im = impro.edgeDetect(img_im)
        
        # generate asciiart
        aa_code = chrtool.getAA(img_im)

        print('done.')

        # output asciiart
        fout = open(filename_aa, "w")
        fout.write(aa_code.encode('utf-8'))
        fout.close()
