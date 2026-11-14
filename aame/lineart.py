#coding:utf-8
"""画像を線画にする方法を集めたもの（前処理の比較用）。

どの方法も「線の強さ 0..1（1 = 線）」を、AA にする大きさ（長辺 800px まで）で返す。
学習済みの検出器は AA の大きさの2倍で通してから縮める（細い線を落とさないため）。
そのあと binarize() で2値にして 1px の線にそろえる。

検出器の実装と重みは ComfyUI の comfyui_controlnet_aux のものを使う（AUX を参照）。
dot-e-puppet/kirie/line_methods.py の比較を、任意の縦横比で使えるようにしたもの。
"""

import sys
import warnings
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage
from skimage import filters, morphology

AUX = Path("E:/StableDiffusion/SimpleComfyUi/ComfyUI/custom_nodes/comfyui_controlnet_aux/src")
DEXINED_WEIGHTS = Path("E:/StableDiffusion/dot-e-puppet/models/dexined/DexiNed_BIPED_10.pth")
MAX_SIZE = 800      # AA にする大きさの長辺（現行と同じ）
DETECT_SCALE = 2    # 検出器に通すときの拡大率
# 方法ごとの拡大率（複数あれば、それぞれで検出して強いほうを取る）。書いていない方法は DETECT_SCALE。
# manga_line は、太い線（アニメの上まぶたなど）を2倍に拡大すると塗りとみなして落とすので、
# 等倍でも検出して合わせる。細い線は2倍のほうがよく拾える。
DETECT_SCALES = {"manga_line": (2, 1)}

_CACHE = {}


def _device():
    import torch
    return "cuda" if torch.cuda.is_available() else "cpu"


def _model(name):
    if name in _CACHE:
        return _CACHE[name]
    warnings.filterwarnings("ignore")
    if str(AUX) not in sys.path:
        sys.path.insert(0, str(AUX))
    dev = _device()
    if name == "lineart_anime":
        from custom_controlnet_aux.lineart_anime import LineartAnimeDetector
        m = LineartAnimeDetector.from_pretrained().to(dev)
    elif name == "lineart":
        from custom_controlnet_aux.lineart import LineartDetector
        m = LineartDetector.from_pretrained().to(dev)
    elif name == "manga":
        from custom_controlnet_aux.manga_line import LineartMangaDetector
        m = LineartMangaDetector.from_pretrained().to(dev)
    elif name == "hed":
        from custom_controlnet_aux.hed import HEDdetector
        m = HEDdetector.from_pretrained().to(dev)
    elif name == "pidinet":
        from custom_controlnet_aux.pidi import PidiNetDetector
        m = PidiNetDetector.from_pretrained().to(dev)
    elif name == "teed":
        from custom_controlnet_aux.teed import TEDDetector
        m = TEDDetector.from_pretrained().to(dev)
    elif name == "mteed":
        # Anyline（TheMistoAI/MistoLine）の線検出部。TEED を線画向けに学習し直したもの
        from custom_controlnet_aux.teed import TEDDetector
        m = TEDDetector.from_pretrained("TheMistoAI/MistoLine", "MTEED.pth",
                                        subfolder="Anyline").to(dev)
    elif name == "dexined":
        import torch
        from kornia.filters import DexiNed
        m = DexiNed(pretrained=False)
        m.load_state_dict(torch.load(DEXINED_WEIGHTS, map_location="cpu", weights_only=True))
        m = m.eval().to(dev)
    else:
        raise ValueError(name)
    _CACHE[name] = m
    return m


def _as_strength(out):
    """検出器の出力（白線/黒地 か 黒線/白地 の uint8）を「線の強さ」にそろえる。"""
    a = np.asarray(out)
    if a.ndim == 3:
        a = a[..., 0]
    a = a.astype(np.float32) / 255.0
    return 1.0 - a if a.mean() > 0.5 else a


def _aux(name, rgb, **kw):
    import torch
    with torch.no_grad():
        out = _model(name)(rgb, detect_resolution=min(rgb.shape[:2]), output_type="np", **kw)
    return _as_strength(out)


# --- 各方法。big は検出用（AA の大きさの2倍）、small は AA の大きさの RGB uint8 ---

def m_legacy(big, small):
    """現行の前処理: 明るさ 128 で2値化して、暗い部分の輪郭を取る。"""
    from AA_ImPro import ImPro
    return (ImPro().edgeDetect(Image.fromarray(small)) < 128).astype(np.float32)


def m_lineart_anime(big, small):
    return _aux("lineart_anime", big)


def m_lineart(big, small):
    return _aux("lineart", big, coarse=False)


def m_lineart_coarse(big, small):
    return _aux("lineart", big, coarse=True)


def m_manga_line(big, small):
    return _aux("manga", big)


def m_hed(big, small):
    return _aux("hed", big, safe=False)


def m_pidinet(big, small):
    return _aux("pidinet", big, safe=False)


def m_teed(big, small):
    return _aux("teed", big)


def m_anyline_mteed(big, small):
    return _aux("mteed", big)


def m_dexined(big, small):
    import torch
    x = big[..., ::-1].astype(np.float32) - np.array([103.939, 116.779, 123.68], np.float32)
    t = torch.from_numpy(np.ascontiguousarray(x)).permute(2, 0, 1)[None].to(_device())
    with torch.no_grad():
        y = torch.sigmoid(_model("dexined")(t))[0, 0].float().cpu().numpy()
    return (y - y.min()) / max(float(y.max() - y.min()), 1e-6)


def m_canny(big, small):
    g = cv2.GaussianBlur(cv2.cvtColor(small, cv2.COLOR_RGB2GRAY), (0, 0), 0.8)
    return (cv2.Canny(g, 40, 100) > 0).astype(np.float32)


def m_xdog(big, small):
    """XDoG: ガウスぼかし2つの差。学習なし。"""
    g = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY).astype(np.float32)
    d = cv2.GaussianBlur(g, (0, 0), 0.5) - cv2.GaussianBlur(g, (0, 0), 5.0)
    return np.clip(-d / 32.0, 0.0, 1.0)


def m_blackhat(big, small):
    """周囲より暗くて細い所（黒トップハット）を、近くの明暗の幅で割ったもの。学習なし。

    もともと線で描かれた絵の、線そのものを拾う。
    """
    g = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY).astype(np.float32)
    bh = cv2.morphologyEx(g, cv2.MORPH_BLACKHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    big_k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21))
    return np.clip(bh / np.maximum(cv2.dilate(g, big_k) - cv2.erode(g, big_k), 24.0), 0.0, 1.0)


METHODS = {
    "legacy": m_legacy,
    "lineart_anime": m_lineart_anime,
    "lineart": m_lineart,
    "lineart_coarse": m_lineart_coarse,
    "manga_line": m_manga_line,
    "anyline_mteed": m_anyline_mteed,
    "teed": m_teed,
    "hed": m_hed,
    "pidinet": m_pidinet,
    "dexined": m_dexined,
    "canny": m_canny,
    "xdog": m_xdog,
    "blackhat": m_blackhat,
}


def canvas_size(image, max_size=MAX_SIZE):
    """AA にする大きさ (幅, 高さ)。長辺が max_size を超えるときだけ縮める。"""
    w, h = image.size
    s = min(1.0, float(max_size) / max(w, h))
    return (int(w * s), int(h * s)) if s < 1.0 else (w, h)


COLOR_METHOD = "teed"   # 色の境界を拾うのに使う方法（輪郭の検出器。重みは約 0.25MB）
COLOR_NEAR = 3.0        # 線からこの px 以内の境界は、線そのものの縁なので足さない
COLOR_FEATHER = 2.0     # そこから何 px かけて足す量を 0 から 1 にするか


def add_color_edges(s, image, where="all"):
    """線の強さ s に、色の境界（線では描かれていない、色の塗り分けの境目）を足して返す。

    アニメの画面のような絵では、瞳の形やハイライトは色の塗り分けだけで描かれていて、
    線を拾う方法（manga_line など）では出てこない。輪郭の検出器はそれも拾うが、線の両側も
    輪郭として拾って2重になる。そこで、すでに線がある所から離れた境界だけを足す。

    where: "all" なら絵の全体、"face" なら顔の中だけ（服の影や背景の境界は足さない）。
    """
    edge = strength(image, COLOR_METHOD)
    blob = filters.apply_hysteresis_threshold(s, 0.15, 0.4)
    if blob.any():
        away = (ndimage.distance_transform_edt(~blob) - COLOR_NEAR) / COLOR_FEATHER
        edge = edge * np.clip(away, 0.0, 1.0)
    if where == "face":
        from aame import regions
        edge = edge * (regions.face_weight(image, (s.shape[1], s.shape[0]), gain=2.0) - 1.0)
    elif where != "all":
        raise ValueError(f"unknown region: {where}")
    return np.maximum(s, edge).astype(np.float32)


def strength(image, method, color=None):
    """PIL の画像を、線の強さ 0..1（AA にする大きさの float32 配列）にする。

    color に "face" か "all" を渡すと、色の境界も足す（add_color_edges）。
    """
    if color:
        return add_color_edges(strength(image, method), image, color)
    image = image.convert("RGB")
    cw, ch = canvas_size(image)
    small = np.asarray(image.resize((cw, ch), Image.LANCZOS) if (cw, ch) != image.size else image)
    out = np.zeros((ch, cw), np.float32)
    for k in DETECT_SCALES.get(method, (DETECT_SCALE,)):
        big = small if k == 1 else np.asarray(image.resize((cw * k, ch * k), Image.LANCZOS))
        s = METHODS[method](big, small)
        if s.shape != (ch, cw):
            s = cv2.resize(s.astype(np.float32), (cw, ch), interpolation=cv2.INTER_AREA)
        out = np.maximum(out, s)
    return np.clip(out, 0.0, 1.0).astype(np.float32)


def binarize(s, low=0.15, high=0.4, width=1, min_size=6, dot_area=6):
    """線の強さを2値の線にする。

    high 以上の所と、そこにつながる low 以上の所を線とし、1px に細線化して、
    小さなかけら（min_size 画素未満）を除く。width が 2 以上なら、その太さに太らせる。

    点で描かれた鼻や口は、細線化すると 1〜2 画素になって「小さなかけら」として消えてしまう。
    そこで、細線化の前の面積が dot_area 画素以上あるかたまりは、2x2 の点として残す
    （dot_area=0 で残さない）。
    """
    blob = filters.apply_hysteresis_threshold(s, low, high)
    m = morphology.remove_small_objects(morphology.skeletonize(blob), min_size=min_size,
                                        connectivity=2)
    if dot_area:
        labels, n = ndimage.label(blob, structure=np.ones((3, 3), bool))
        if n:
            ids = np.arange(1, n + 1)
            lost = (ndimage.sum_labels(blob, labels, ids) >= dot_area) \
                & (ndimage.sum_labels(m, labels, ids) == 0)
            for cy, cx in ndimage.center_of_mass(blob, labels, ids[lost]):
                y, x = min(int(cy), m.shape[0] - 2), min(int(cx), m.shape[1] - 2)
                m[y:y + 2, x:x + 2] = True
    if width > 1:
        m = cv2.dilate(m.astype(np.uint8), np.ones((width, width), np.uint8)) > 0
    return m
