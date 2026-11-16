#coding:utf-8
"""学習済みモデルを ONNX に変換する（段階2。1度だけ走らせればよい）。

    PYTHONPATH=. python -m aame.export_onnx [--out models] [--only manga_line|teed|face]

変換するのは Web アプリが使う3つ:

  manga_line.onnx  線画化（manga_line、erika.pth）。入力 1x1xHxW の灰色 0..255、出力 1x1xHxW（白地に黒線、0..255 の外にもはみ出す）
  teed.onnx        色の境界（TEED、7_model.pth）。入力 1x3xHxW の RGB 0..255、出力 4 つ（各 1x1xHxW、sigmoid の前）
  face_unet.onnx   顔の部位（anime_face_segment の UNet、UNet.pth）。入力 1x3xHxW の RGB 0..1、出力 1x7xHxW（確率）

H と W は可変（どれも 64 の倍数で渡す）。前と後の処理は aame/models.py にある。

重みは、元の配布元（どれも MIT）から版を決めて取ってきて、sha256 で確かめる（SOURCES。<out>/src/ に置く）。
comfyui_controlnet_aux が取ってくる TEED の 7_model.pth は元の TEED と違う重み（出どころの分からない、
CC BY-NC-SA 4.0 の置き場所のもの）なので使わない（webapp_plan.md の 17 章）。

変換には torch と ComfyUI の comfyui_controlnet_aux（aame.lineart.AUX。ネットワークの定義を借りる）が要る。
変換したあとは、aame は onnxruntime だけで動く（torch も ComfyUI も要らない）。
"""

import argparse
import hashlib
import time
import urllib.request
from pathlib import Path

import numpy as np

OPSET = 17

# 重みの元の配布元: (URL, sha256, ライセンス, 配布元)
SOURCES = {
    "erika.pth": (
        "https://github.com/ljsabc/MangaLineExtraction_PyTorch/releases/download/v1/erika.pth",
        "badbd6baf013cefbd98993307b02cc14a26c770d067416e4fdecc8720b88feeb",
        "MIT (c) 2021 Miaomiao Li", "https://github.com/ljsabc/MangaLineExtraction_PyTorch"),
    "7_model.pth": (
        "https://raw.githubusercontent.com/xavysp/TEED/5db2621ea5f0b20dbfd1c00aa7f5cea00399665b/"
        "checkpoints/BIPED/7/7_model.pth",
        "d0109e7f40e7d9f1f495d34947eb08167e8fbb0a13b4e6ab3121261fb8d5a416",
        "MIT (c) 2022 Xavier Soria Poma", "https://github.com/xavysp/TEED"),
    "UNet.pth": (
        "https://raw.githubusercontent.com/siyeong0/Anime-Face-Segmentation/585f778a1790c9f4e95d7edce27fb630850018ce/"
        "model/UNet.pth",
        "96c2a509b3eb1b2083b5384bbc30808dc205f370c513ee930e644edc0ea4688d",
        "MIT (c) 2025 siyeong", "https://github.com/siyeong0/Anime-Face-Segmentation"),
}
# 元の配布元のライセンスの文（版を決めて取る）。モデルと一緒に配る THIRD_PARTY_NOTICES.txt に入れる
LICENSES = {
    "LICENSE-MangaLineExtraction.txt": (
        "https://raw.githubusercontent.com/ljsabc/MangaLineExtraction_PyTorch/a748a0c8aa5b48e049b5220e72bd3d52fd5418aa/LICENSE",
        "6a038977670f3010892f223fa5eaad0f1d3f071e9e3c66d116f0f8e90fe68635", "erika.pth"),
    "LICENSE-TEED.txt": (
        "https://raw.githubusercontent.com/xavysp/TEED/8a12d3088629f26ade0822dafd38a2c4be52eb03/LICENSE",
        "b62889ee92d00f60fb54ccbbb3c9bb0a1cdbc10bbf779f0d715e53f9acc8733d", "7_model.pth"),
    "LICENSE-Anime-Face-Segmentation.txt": (
        "https://raw.githubusercontent.com/siyeong0/Anime-Face-Segmentation/7107bfc64610cec5b9e64a2c16a4f011b5f513e5/LICENSE",
        "bd0eab5045709c3be3c38251f9076fa3893d19293c6c452d7f20b451fad7473a", "UNet.pth"),
}
NOTICE_HEAD = """Third-party notices for the model files of asciiart.me (aame)

The ONNX files were converted from the following PyTorch weights, without retraining.
Each is distributed under the licence of its original repository (all MIT).

"""
MODEL_OF = {"erika.pth": "manga_line.onnx", "7_model.pth": "teed.onnx", "UNet.pth": "face_unet.onnx"}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def weights(name, folder, table=SOURCES):
    """元の配布元の重みのファイル（無ければ取ってくる）。中身が違えば止める。"""
    url, digest = table[name][:2]
    path = Path(folder) / name
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        print(f"取ってくる: {url}")
        urllib.request.urlretrieve(url, path)
    if sha256(path) != digest:
        raise SystemExit(f"{path} の中身が違います（sha256 が {digest} ではない）")
    return path


def write_notice(out, src):
    """モデルと一緒に配るライセンスの文（THIRD_PARTY_NOTICES.txt）を書く。"""
    parts = [NOTICE_HEAD]
    for name, (url, digest, weight) in LICENSES.items():
        w_url, w_digest, _, repo = SOURCES[weight]
        text = weights(name, src, LICENSES).read_text(encoding="utf-8").strip()
        parts.append("\n".join([
            "=" * 72, MODEL_OF[weight], f"  weights: {weight} from {repo}", f"  {w_url}",
            f"  sha256 {w_digest}", "", text, "", ""]))
    path = Path(out) / "THIRD_PARTY_NOTICES.txt"
    path.write_text("".join(parts), encoding="utf-8")
    print(path)


def _load(path):
    import torch
    state = torch.load(path, map_location="cpu", weights_only=True)
    return {k.replace("module.", ""): v for k, v in state.items()}


def _export(model, x, path, inputs, outputs):
    import torch
    model = model.float().eval().cpu()
    axes = {n: {2: "h", 3: "w"} for n in inputs + outputs}
    with torch.no_grad():
        torch.onnx.export(model, x, str(path), input_names=inputs, output_names=outputs,
                          dynamic_axes=axes, opset_version=OPSET, do_constant_folding=True, dynamo=False)
    print(f"{path}  {path.stat().st_size / 1e6:.1f} MB")


def _check(path, x, expect):
    """onnxruntime（CPU）で同じ入力を通して、torch の出力との差を出す。"""
    import onnxruntime as ort
    s = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    got = s.run(None, {s.get_inputs()[0].name: x.numpy()})
    diff = max(float(np.abs(g - e.numpy()).max()) for g, e in zip(got, expect))
    scale = max(float(np.abs(e.numpy()).max()) for e in expect)
    print(f"  torch との差（CPU）: 最大 {diff:.3g}（出力の大きさ {scale:.3g}）")


def export_manga_line(out, src):
    import torch
    from aame import lineart
    model = lineart._model("manga").model
    model.load_state_dict(_load(weights("erika.pth", src)))
    x = torch.rand(1, 1, 256, 320) * 255
    path = out / "manga_line.onnx"
    _export(model, x, path, ["gray"], ["line"])
    with torch.no_grad():
        _check(path, x, [model.float().cpu()(x)])


def export_teed(out, src):
    import torch
    from aame import lineart
    model = lineart._model("teed").model
    model.load_state_dict(_load(weights("7_model.pth", src)))
    import custom_controlnet_aux.teed.ted as ted
    import custom_controlnet_aux.teed.Xsmish as xs
    # smish は torch.jit.script の関数なので、そのままでは書き出せない。同じ式の素の関数に差し替える
    ted.Fsmish = xs.smish = lambda x: x * torch.tanh(torch.log(1 + torch.sigmoid(x)))
    x = torch.rand(1, 3, 256, 320) * 255
    path = out / "teed.onnx"
    _export(model, x, path, ["rgb"], ["edge1", "edge2", "edge3", "edge_fused"])
    with torch.no_grad():
        _check(path, x, model.float().cpu()(x))


def export_face(out, src):
    import torch
    from aame import regions
    model, _ = regions._model()
    model.load_state_dict(_load(weights("UNet.pth", src)))
    x = torch.rand(1, 3, 256, 320)
    path = out / "face_unet.onnx"
    _export(model, x, path, ["rgb"], ["parts"])
    with torch.no_grad():
        _check(path, x, [model.float().cpu()(x)])


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "models"))
    ap.add_argument("--only", choices=["manga_line", "teed", "face"])
    ap.add_argument("--src", help="元の重みを置くフォルダ（省くと <out>/src）")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    src = Path(a.src) if a.src else out / "src"
    jobs = {"manga_line": export_manga_line, "teed": export_teed, "face": export_face}
    for name, job in jobs.items():
        if a.only in (None, name):
            t = time.perf_counter()
            job(out, src)
            print(f"  {time.perf_counter() - t:.1f}s")
    write_notice(out, src)


if __name__ == "__main__":
    main()
