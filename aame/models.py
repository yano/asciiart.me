#coding:utf-8
"""学習済みモデルを onnxruntime で動かす（torch と ComfyUI を使わない。段階2）。

モデルのファイルは aame/export_onnx.py で作り、MODELS のフォルダ（環境変数 AAME_MODELS で変えられる）に置く:

  manga_line.onnx  線画化（aame.lineart の manga_line）
  teed.onnx        色の境界（aame.lineart の teed）
  face_unet.onnx   顔の部位（aame.regions.face_parts）
  isnet_anime.onnx 背景を消す（aame.prep.remove_background。rembg の isnet-anime と同じもの）

前と後の処理は comfyui_controlnet_aux の LineartMangaDetector と TEDDetector の __call__ と同じにしてある
（大きさを合わせる拡大、64 の倍数への詰め物、uint8 への丸めまで）。torch で動かしたときとの差は
浮動小数の誤差だけ（aaeval/onnx_test.py で確かめる）。

どちらで動かすかは環境変数 AAME_BACKEND で決める: "onnx"、"torch"、"auto"（既定。ファイルがあれば onnx）。
onnxruntime の実行先は AAME_ORT（"auto" が既定で GPU があれば GPU。"cpu"、"cuda"、"dml"）。
"""

import os
from pathlib import Path

import cv2
import numpy as np

MODELS = Path(os.environ.get("AAME_MODELS", Path(__file__).resolve().parent.parent / "models"))
FILES = {"manga_line": "manga_line.onnx", "teed": "teed.onnx", "face": "face_unet.onnx", "bg": "isnet_anime.onnx"}
BG_SIZE = 1024                       # 背景を消すモデルの入力の大きさ（縦横比を変えてこの正方形にする）
BG_MEAN = (0.485, 0.456, 0.406)

_SESSIONS = {}
_STATE = {}


def backend():
    return os.environ.get("AAME_BACKEND", "auto")


def use(name):
    """name のモデルを onnxruntime で動かすか。"""
    b = backend()
    if b == "torch":
        return False
    if b == "onnx":
        return True
    return (MODELS / FILES[name]).exists()


def providers():
    """onnxruntime の実行先の優先順。GPU（CUDA、Windows なら DirectML）が使えればそれを先にする。"""
    import onnxruntime as ort
    want = os.environ.get("AAME_ORT", "auto")
    if want == "cpu":
        return ["CPUExecutionProvider"]
    gpu = {"cuda": ["CUDAExecutionProvider"], "dml": ["DmlExecutionProvider"]}.get(
        want, ["CUDAExecutionProvider", "DmlExecutionProvider"])
    have = ort.get_available_providers()
    if "CUDAExecutionProvider" in gpu and "CUDAExecutionProvider" in have and not _STATE.get("dlls"):
        # CUDA と cuDNN の DLL を先に読む（Windows では、入っている torch の lib から。torch 自体は読まない）
        _STATE["dlls"] = True
        try:
            ort.preload_dlls()
        except Exception:
            pass
    return [p for p in gpu if p in have] + ["CPUExecutionProvider"]


def device():
    """いま線画化に使っている実行先（"CUDAExecutionProvider" など）。"""
    return session("manga_line").get_providers()[0]


def session(name):
    if name not in _SESSIONS:
        import onnxruntime as ort
        path = MODELS / FILES[name]
        if not path.exists():
            raise FileNotFoundError(f"{path} がありません（python -m aame.export_onnx で作る）")
        opts = ort.SessionOptions()
        opts.log_severity_level = 3
        _SESSIONS[name] = ort.InferenceSession(str(path), opts, providers=providers())
    return _SESSIONS[name]


def _run(name, x):
    s = session(name)
    return s.run(None, {s.get_inputs()[0].name: np.ascontiguousarray(x, np.float32)})


def _resize_with_pad(rgb, resolution, upscale=cv2.INTER_CUBIC):
    """comfyui_controlnet_aux の resize_image_with_pad と同じ: 短辺を resolution にして、
    右と下を端の画素で 64 の倍数まで伸ばす。(伸ばした画像, 伸ばす前の高さ, 幅) を返す。"""
    h, w = rgb.shape[:2]
    k = float(resolution) / float(min(h, w))
    ht, wt = int(np.round(h * k)), int(np.round(w * k))
    img = cv2.resize(rgb, (wt, ht), interpolation=upscale if k > 1 else cv2.INTER_AREA)
    ph, pw = (int(np.ceil(v / 64.0) * 64 - v) for v in (ht, wt))
    return np.pad(img, [[0, ph], [0, pw], [0, 0]], mode="edge"), ht, wt


def manga_line(rgb):
    """RGB uint8 (H, W, 3) → 白地に黒線の uint8 を反転したもの（白線/黒地、uint8 (h, w)）。

    LineartMangaDetector(detect_resolution=min(H, W)) と同じ。大きさは短辺を 256 の倍数に上げたもの。"""
    res = 256 * int(np.ceil(min(rgb.shape[:2]) / 256.0))
    img, ht, wt = _resize_with_pad(rgb, res)
    gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    line = _run("manga_line", gray[None, None].astype(np.float32))[0][0, 0]
    line = np.clip(line, 0, 255).astype(np.uint8)
    return (255 - line)[:ht, :wt]


def teed(rgb, safe_steps=2):
    """RGB uint8 (H, W, 3) → 輪郭の強さ uint8 (H, W)（白線/黒地）。TEDDetector と同じ。"""
    img, ht, wt = _resize_with_pad(rgb, min(rgb.shape[:2]))
    edges = _run("teed", img.transpose(2, 0, 1)[None].astype(np.float32))
    edge = np.mean(np.stack([e[0, 0] for e in edges], axis=2), axis=2).astype(np.float64)
    edge = 1 / (1 + np.exp(-edge))
    if safe_steps:
        edge = (edge.astype(np.float32) * float(safe_steps + 1)).astype(np.int32).astype(np.float32) / float(safe_steps)
    return (edge * 255.0).clip(0, 255).astype(np.uint8)[:ht, :wt]


def face_parts(rgb):
    """RGB uint8 (H, W, 3)（H と W は 64 の倍数）→ 部位の番号 (H, W)。aame.regions の並び。"""
    probs = _run("face", (rgb.astype(np.float32) / 255).transpose(2, 0, 1)[None])[0][0]
    return probs.argmax(0)


def foreground(rgb):
    """RGB uint8 (H, W, 3) → 前景の濃さ uint8 (H, W)（255 が前景）。rembg の isnet-anime と同じ前と後の処理:
    1024×1024 に縮めて（縦横比は変える）最大値で割り、平均を引く。出力は最小〜最大で 0..1 にして、元の大きさに戻す。"""
    from PIL import Image
    h, w = rgb.shape[:2]
    im = np.asarray(Image.fromarray(rgb).resize((BG_SIZE, BG_SIZE), Image.LANCZOS))
    im = im / max(np.max(im), 1e-6)
    x = np.stack([im[..., c] - BG_MEAN[c] for c in range(3)])[None].astype(np.float32)
    pred = _run("bg", x)[0][0, 0]
    mi, ma = np.min(pred), np.max(pred)
    if ma - mi < 1e-6:
        return np.full((h, w), 255, np.uint8)
    pred = (pred - mi) / (ma - mi)
    mask = Image.fromarray((pred * 255).astype(np.uint8), "L")
    return np.asarray(mask.resize((w, h), Image.LANCZOS))
