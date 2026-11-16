#coding:utf-8
"""学習済みモデルを ONNX に変換する（段階2。1度だけ走らせればよい）。

    PYTHONPATH=. python -m aame.export_onnx [--out models] [--only manga_line|teed|face]

変換するのは Web アプリが使う3つ:

  manga_line.onnx  線画化（manga_line、erika.pth）。入力 1x1xHxW の灰色 0..255、出力 1x1xHxW（白地に黒線、0..255 の外にもはみ出す）
  teed.onnx        色の境界（TEED、7_model.pth）。入力 1x3xHxW の RGB 0..255、出力 4 つ（各 1x1xHxW、sigmoid の前）
  face_unet.onnx   顔の部位（anime_face_segment の UNet、UNet.pth）。入力 1x3xHxW の RGB 0..1、出力 1x7xHxW（確率）
  isnet_anime.onnx 背景を消す（SkyTNT/anime-segmentation の ISNet。rembg の isnet-anime と同じもの）。入力 1x3x1024x1024、
                   出力 1x1x1024x1024。元から ONNX なので、重みを float16 で持つ形にし（half_weights。約 88MB）、
                   WebGPU で動くように MaxPool の ceil_mode を外す（no_ceil_mode。結果は変わらない）

isnet_anime 以外の H と W は可変（どれも 64 の倍数で渡す）。前と後の処理は aame/models.py にある。

重みは、元の配布元（MIT か Apache-2.0）から版を決めて取ってきて、sha256 で確かめる（SOURCES。<out>/src/ に置く）。
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
    "isnetis.onnx": (
        "https://huggingface.co/skytnt/anime-seg/resolve/493cb60893f47441b26ec4fb9a306bce9e342982/isnetis.onnx",
        "f15622d853e8260172812b657053460e20806f04b9e05147d49af7bed31a6e99",
        "Apache-2.0 (c) SkyTNT", "https://github.com/SkyTNT/anime-segmentation"),
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
    "LICENSE-anime-segmentation.txt": (
        "https://raw.githubusercontent.com/SkyTNT/anime-segmentation/55d874013a2811cdf59c365059174c7823acf5b4/LICENSE",
        "50e6751797c50dedd75ef1b8a0d9e42f5f8472e9fbce91f34718e9f97b0c780a", "isnetis.onnx"),
}
NOTICE_HEAD = """Third-party notices for the model files of asciiart.me (aame)

The ONNX files were converted from the following weights, without retraining.
Each is distributed under the licence of its original repository (MIT or Apache-2.0).
isnet_anime.onnx is the original ONNX file with its weights stored as float16 (computed in float32).

"""
MODEL_OF = {"erika.pth": "manga_line.onnx", "7_model.pth": "teed.onnx", "UNet.pth": "face_unet.onnx",
            "isnetis.onnx": "isnet_anime.onnx"}


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


def half_weights(src, dst, min_size=256):
    """重みを float16 で持ち、計算は float32 のままのモデルにする（ファイルが約半分になる）。

    float32 の重み（min_size 個以上の要素のもの）を float16 にして、その後ろに float32 へ戻す Cast を置く。
    onnxruntime は読み込むときに Cast を先に計算してしまう（定数の畳み込み）ので、動かすときは元のモデルと同じ
    float32 の計算になる。違いは重みを float16 に丸めた分だけ（計算まで float16 にすると manga_line が壊れた。17 章）。
    """
    import onnx
    from onnx import TensorProto, helper, numpy_helper
    model = onnx.load(str(src))
    g = model.graph
    casts, keep = [], []
    for init in g.initializer:
        if init.data_type != TensorProto.FLOAT or np.prod(init.dims) < min_size:
            keep.append(init)
            continue
        half = numpy_helper.from_array(numpy_helper.to_array(init).astype(np.float16), init.name + "__f16")
        keep.append(half)
        casts.append(helper.make_node("Cast", [half.name], [init.name], to=TensorProto.FLOAT, name=init.name + "__cast"))
    del g.initializer[:]
    g.initializer.extend(keep)
    nodes = casts + list(g.node)
    del g.node[:]
    g.node.extend(nodes)
    onnx.checker.check_model(model)
    onnx.save(model, str(dst))
    print(f"{dst}  {Path(dst).stat().st_size / 1e6:.1f} MB（重みを float16 で持つ。{len(casts)} 個）")


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


def no_ceil_mode(path):
    """MaxPool の ceil_mode を 0 にする（onnxruntime-web の WebGPU の MaxPool は ceil_mode に対応していない）。
    入力の大きさが決まったモデルで、どの MaxPool の入力も偶数（2x2、刻み 2）のときだけ。そのときは結果が変わらない。"""
    import onnx
    from onnx import shape_inference
    model = onnx.load(str(path))
    inferred = shape_inference.infer_shapes(model)
    shapes = {v.name: [d.dim_value for d in v.type.tensor_type.shape.dim]
              for v in list(inferred.graph.value_info) + list(inferred.graph.input)}
    n = 0
    for node in model.graph.node:
        if node.op_type != "MaxPool":
            continue
        attrs = {a.name: a for a in node.attribute}
        if "ceil_mode" not in attrs or attrs["ceil_mode"].i == 0:
            continue
        k = list(attrs["kernel_shape"].ints)
        s = list(attrs["strides"].ints) if "strides" in attrs else [1, 1]
        h, w = shapes[node.input[0]][2:]
        if k != [2, 2] or s != [2, 2] or h % 2 or w % 2 or ("pads" in attrs and any(attrs["pads"].ints)):
            raise SystemExit(f"{node.name}: ceil_mode を外すと結果が変わる（{k}, {s}, {h}x{w}）")
        attrs["ceil_mode"].i = 0
        n += 1
    onnx.save(model, str(path))
    print(f"  MaxPool の ceil_mode を外した: {n} 個")


def export_bg(out, src):
    """背景を消すモデル（元から ONNX）。重みを float16 で持つ形にして、元のモデルとの差を出す。"""
    import onnxruntime as ort
    orig = weights("isnetis.onnx", src)
    path = out / "isnet_anime.onnx"
    half_weights(orig, path)
    no_ceil_mode(path)
    x = np.random.default_rng(0).random((1, 3, 1024, 1024), dtype=np.float32) - 0.45
    a, b = (ort.InferenceSession(str(p), providers=["CPUExecutionProvider"]) for p in (orig, path))
    ya, yb = (s.run(None, {"img": x})[0] for s in (a, b))
    print(f"  元のモデルとの差: 最大 {float(np.abs(ya - yb).max()):.3g}（出力の大きさ {float(np.abs(ya).max()):.3g}）")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "models"))
    ap.add_argument("--only", choices=["manga_line", "teed", "face", "bg"])
    ap.add_argument("--src", help="元の重みを置くフォルダ（省くと <out>/src）")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    src = Path(a.src) if a.src else out / "src"
    jobs = {"manga_line": export_manga_line, "teed": export_teed, "face": export_face, "bg": export_bg}
    for name, job in jobs.items():
        if a.only in (None, name):
            t = time.perf_counter()
            job(out, src)
            print(f"  {time.perf_counter() - t:.1f}s")
    write_notice(out, src)


if __name__ == "__main__":
    main()
