"""場所ごとに描き込みの量を変えるための「重みの地図」を作る。

重みは aame.cost.costs の weight に渡す。重み g の所は、線の取りこぼしが g 倍重くなり、
そこだけ lam を g 倍にしたのと同じになる（文字が増え、細部を拾う）。

黒い面（dark_areas）は別の地図で、aame.cost.costs の fill に渡す。

重みの作り方は2つ:
  face_weight  アニメ顔の部位を塗り分けるモデルで顔を見つけて、顔の中を上げる
  mask_weight  人が塗ったマスク画像（明るい所ほど上げる）から作る
  paint_weight 画面で「増やす」「減らす」を塗り重ねた段階の画像から作る

顔のモデルは comfyui_controlnet_aux の anime_face_segment（UNet、約 6MB）。ONNX に変換したもの
（aame/models.py）があれば onnxruntime で動かす。顔のアップで
学習されているので、全身の絵では背景に誤検出が出る。そこで「顔の肌と目の両方を含む
かたまり」だけを顔とみなす。
"""

import importlib.util
import sys

import cv2
import numpy as np
from PIL import Image

from aame import models
from aame.lineart import AUX

FACE_WEIGHTS = AUX.parent / "ckpts/bdsqlsz/qinglong_controlnet-lllite/Annotators/UNet.pth"
# モデルの出力の並び
BACKGROUND, HAIR, EYE, MOUTH, FACE, SKIN, CLOTHES = range(7)
DETECT_SHORT = 512      # モデルに通すときの短辺
# 画面の塗り: 同じ所を何回塗ったか（増やすは +1、減らすは -1 ずつ。PAINT_MAX 回まで）と、
# その所の描き込みの倍率。-PAINT_MAX は「線を拾わない」
PAINT_MAX = 4
PAINT_STEPS = [(-4, 0.0), (-3, 0.2), (-2, 0.4), (-1, 0.65), (0, 1.0), (1, 1.5), (2, 2.25), (3, 3.4), (4, 5.0)]
PAINT_CODE = 30         # 塗りの画像の値 = 128 + 段階 × PAINT_CODE（灰色 128 が塗っていない所）

_STATE = {}


def _model():
    if "model" not in _STATE:
        import torch
        if str(AUX) not in sys.path:
            sys.path.insert(0, str(AUX))
        # パッケージごと読むと ComfyUI 本体が必要になるので、ネットワークの定義だけを読む
        spec = importlib.util.spec_from_file_location(
            "aame_face_network", AUX / "custom_controlnet_aux/anime_face_segment/network.py")
        network = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(network)
        model = network.UNet()
        model.load_state_dict(torch.load(FACE_WEIGHTS, map_location="cpu"))
        device = "cuda" if torch.cuda.is_available() else "cpu"
        _STATE.update(model=model.eval().to(device), device=device)
    return _STATE["model"], _STATE["device"]


def face_parts(image, size):
    """各画素の部位の番号（BACKGROUND..CLOTHES）を、size = (幅, 高さ) の大きさで返す。"""
    rgb = np.asarray(image.convert("RGB").resize(size, Image.LANCZOS))
    k = DETECT_SHORT / min(size)
    dw, dh = (max(64, int(round(v * k / 64)) * 64) for v in size)
    small = cv2.resize(rgb, (dw, dh), interpolation=cv2.INTER_AREA)
    if models.use("face"):
        parts = models.face_parts(small)
    else:
        import torch
        model, device = _model()
        with torch.no_grad():
            parts = model(torch.from_numpy(small).float().permute(2, 0, 1)[None].to(device) / 255)[0].argmax(0)
        parts = parts.cpu().numpy()
    return cv2.resize(parts.astype(np.uint8), size, interpolation=cv2.INTER_NEAREST)


def find_faces(image, size, min_area=0.003):
    """顔の領域（True が顔）を返す。目・口・顔の肌のかたまりのうち、肌と目の両方を含むもの。

    かたまりは外形（凸包）で埋めるので、まゆ・鼻・輪郭の線も中に入る。
    """
    parts = face_parts(image, size)
    blob = np.isin(parts, (EYE, MOUTH, FACE)).astype(np.uint8)
    blob = cv2.morphologyEx(blob, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(blob, connectivity=8)
    out = np.zeros(blob.shape, np.uint8)
    for i in range(1, n):
        inside = labels == i
        area = int(stats[i, cv2.CC_STAT_AREA])
        eye = int((parts[inside] == EYE).sum())
        if area < min_area * blob.size or not 0.03 * area <= eye <= 0.5 * area:
            continue
        points = cv2.findNonZero(inside.astype(np.uint8))
        cv2.fillConvexPoly(out, cv2.convexHull(points), 1)
    return out > 0


def _soften(inside, feather):
    """枠やマスクの境目を feather px かけてなだらかにする（文字の並びが急に変わらないように）。"""
    if feather <= 0:
        return inside
    return cv2.GaussianBlur(inside.astype(np.float32), (0, 0), feather / 2.0)


def face_weight(image, size, gain=2.0, grow=6, feather=8, faces=None):
    """顔の中が gain、外が 1 の重みの地図を返す。grow は顔の領域を外へ広げる画素数。

    faces に find_faces の結果を渡すと、顔を探し直さない。
    """
    inside = find_faces(image, size) if faces is None else faces
    if grow > 0:
        inside = cv2.dilate(inside.astype(np.uint8), np.ones((2 * grow + 1,) * 2, np.uint8)) > 0
    return 1.0 + (gain - 1.0) * _soften(inside, feather)


def dark_areas(image, size, where="all", level=0.4, thick=5, min_area=20, faces=None):
    """黒い面（瞳や太いまつげのように、暗い色で塗られた所）を返す。True が面。size = (幅, 高さ)。

    線ではなく面だけを取りたいので、暗い画素のうち、差し渡しが thick px に満たない所
    （線）は除く。「暗い」の境目は、絵の最も暗い所と明るい所の間の level の位置にする。
    where が "face" なら顔の中だけ（黒い服や髪は塗らない）。faces に find_faces の結果を
    渡すと、顔を探し直さない。
    """
    g = np.asarray(image.convert("L").resize(size, Image.LANCZOS), np.float32)
    lo, hi = np.percentile(g, 1), np.percentile(g, 70)
    dark = (g < lo + level * (hi - lo)).astype(np.uint8)
    dark = cv2.morphologyEx(dark, cv2.MORPH_OPEN,
                            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (thick, thick)))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(dark, connectivity=8)
    keep = np.zeros(n, bool)
    keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= min_area
    out = keep[labels]
    if where == "face":
        face = (find_faces(image, size) if faces is None else faces).astype(np.uint8)
        out &= cv2.dilate(face, np.ones((13, 13), np.uint8)) > 0
    elif where != "all":
        raise ValueError(f"unknown region: {where}")
    return out


def paint_weight(paint_image, size, feather=4):
    """塗り重ねた段階の画像（値 = 128 + 段階 × PAINT_CODE の灰色）から、描き込みの倍率の地図を作る。

    段階は PAINT_STEPS の間をなめらかにつないだ倍率になる（ブラシの縁のような半端な段階も）。
    塗っていない所は 1。
    """
    m = paint_image.convert("L")
    level = (np.asarray(m.resize(size, Image.BILINEAR), np.float32) - 128.0) / PAINT_CODE
    level = np.clip(_soften(level, feather), -PAINT_MAX, PAINT_MAX)
    xs, ys = zip(*PAINT_STEPS)
    return np.interp(level, xs, ys).astype(np.float32)


def mask_weight(mask_image, size, gain=2.0, feather=4):
    """塗ったマスク画像から重みの地図を作る。白い所が gain、黒い所が 1（灰色はその間）。

    透明度のある画像なら、色ではなく不透明な所を「塗った所」とする。
    gain を 1 より小さくすると、塗った所の描き込みを減らす地図になる（0 で線を拾わない）。
    """
    if mask_image.mode in ("RGBA", "LA"):
        m = mask_image.getchannel("A")
    else:
        m = mask_image.convert("L")
    inside = np.asarray(m.resize(size, Image.BILINEAR), np.float32) / 255.0
    return 1.0 + (gain - 1.0) * _soften(inside, feather)
