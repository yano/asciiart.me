#!/bin/sh
# エンジンの出力の回帰確認（開発用）。23 通りの出力を <出力フォルダ> に書く。
#   sh aaeval/regress.sh out/regress/new
#   for f in out/regress/20261115/*; do cmp -s "$f" "out/regress/new/$(basename $f)" || echo "DIFF $f"; done
# 2026-11-15 に辞書を作り直したので、それ以前の出力とは legacy と *_source.jpg 以外が違う。
# 2026-11-16 から線画化などのモデルは ONNX（aame/models.py）で動く。基準は2つ:
#   out/regress/20261115       … AAME_BACKEND=torch で走らせたとき 1 文字も違わないこと
#   out/regress/20261116_onnx  … ONNX（GPU）で走らせたとき。TEED は元の TEED（MIT）の重みなので、torch（comfyui_controlnet_aux
#                                の別の重み）とは色の境界を使う出力が違う。ほかは miku の 1〜2 行が違う（浮動小数の誤差）
set -e
cd "$(dirname "$0")/.."
B="$1"; mkdir -p "$B"
export PYTHONPATH=.
python -c "
from PIL import Image, ImageDraw
im = Image.new('L', (600, 669), 0); ImageDraw.Draw(im).ellipse((200, 100, 420, 330), fill=255); im.save('$B/mask_miku.png')
im = Image.new('RGBA', (600, 669), (0, 0, 0, 0)); ImageDraw.Draw(im).rectangle((0, 400, 600, 669), fill=(255, 0, 0, 255)); im.save('$B/less_miku.png')
"
python -m aame.convert miku.png --mode legacy -o $B/miku_legacy.html
python -m aame.convert miku.png -o $B/miku_v1.html
python -m aame.convert miku.png --lineart manga_line --width 2 -o $B/miku_v1_manga.html
python -m aame.convert miku.png --mode v2 -o $B/miku_v2_legacyline.html
python -m aame.convert miku.png --mode v2 --lineart manga_line --mask $B/mask_miku.png --mask-gain 3 --face-gain 2 -o $B/miku_v2_mask.html
python -m aame.convert luckystar01.jpg --mode v2 --lineart manga_line --lam 2.5 --face-gain 2 --color-edges face --fill face --fill-gain 0.7 -o $B/ls1_v2_full.html
python -m aame.convert luckystar02.jpg --mode v2 --lineart manga_line --color-edges all --fill all -o $B/ls2_v2_all.html
python -m aame.candidates miku.png luckystar01.jpg --out $B
cmp -s miku.html $B/miku_legacy.html && echo "legacy: miku.html と同じ" || echo "legacy: miku.html と違う!"
