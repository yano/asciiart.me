#coding:utf-8
"""背景を消すモデルを比べる（u2netp 4.6MB と isnet-anime 176MB）。結果を白い背景に置いた画像と、その線画を並べたページを出す。

    PYTHONPATH=. python aaeval/bg_compare.py [--out out/bg] [--models <フォルダ>] [画像 ...]

前と後の処理は rembg と同じ（u2netp: 320×320、isnet-anime: 1024×1024 に縦横比を変えて縮め、出力を最小〜最大で 0..1 にして
LANCZOS で元の大きさに戻す）。線画は aame.session.Session の line_mask（標準、1px）。
"""

import argparse
import html
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

from aame.session import Session

MODELS = "E:/StableDiffusion/stable-diffusion-webui-1.10.1/models/u2net"
IMAGES = ["miku.png", "luckystar01.jpg", "luckystar02.jpg",
          "E:/StableDiffusion/dot-e-puppet/refs/sdxl/c01.png", "E:/StableDiffusion/dot-e-puppet/refs/sdxl/c07.png",
          "E:/StableDiffusion/dot-e-puppet/refs/sdxl/s01.png", "E:/tmp/_a_clip_02000_sit_down_library/f_01.png"]
# 名前 → (ファイル, 入力の大きさ, mean, std)
SPECS = {
    "u2netp": ("u2netp.onnx", 320, (0.485, 0.456, 0.406), (0.229, 0.224, 0.225)),
    "isnet-anime": ("isnet-anime.onnx", 1024, (0.485, 0.456, 0.406), (1.0, 1.0, 1.0)),
}


def mask(session, image, size, mean, std):
    """rembg と同じ前景のマスク（PIL の L、元の大きさ）。"""
    im = np.asarray(image.convert("RGB").resize((size, size), Image.LANCZOS)).astype(np.float64)
    im = im / np.max(im)
    x = np.stack([(im[..., c] - mean[c]) / std[c] for c in range(3)])[None].astype(np.float32)
    pred = session.run(None, {session.get_inputs()[0].name: x})[0][:, 0]
    pred = (pred - pred.min()) / (pred.max() - pred.min())
    return Image.fromarray((np.squeeze(pred) * 255).astype(np.uint8), "L").resize(image.size, Image.LANCZOS)


def on_white(image, m):
    a = np.asarray(m, np.float32)[..., None] / 255.0
    rgb = np.asarray(image.convert("RGB"), np.float32)
    return Image.fromarray(np.clip(rgb * a + 255.0 * (1 - a) + 0.5, 0, 255).astype(np.uint8))


def lines(image):
    m = Session(image).line_mask(None, 1)
    return Image.fromarray(np.where(m, 0, 255).astype(np.uint8))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("images", nargs="*", default=IMAGES)
    ap.add_argument("--out", default="out/bg")
    ap.add_argument("--models", default=MODELS)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    sessions = {}
    for name, (file, size, mean, std) in SPECS.items():
        path = Path(a.models) / file
        for dev, prov in (("cpu", ["CPUExecutionProvider"]), ("gpu", ["CUDAExecutionProvider", "CPUExecutionProvider"])):
            sessions[name, dev] = ort.InferenceSession(str(path), providers=prov)
        print(name, f"{path.stat().st_size / 1e6:.1f} MB")
    rows = []
    times = {k: [] for k in sessions}
    for p in a.images:
        if not Path(p).exists():
            print("ない:", p)
            continue
        image = Image.open(p).convert("RGB")
        if max(image.size) > 1024:
            image.thumbnail((1024, 1024), Image.LANCZOS)
        stem = Path(p).stem
        image.save(out / f"{stem}_0.png")
        cells = [(f"{stem}_0.png", "元の画像"), (f"{stem}_0_lines.png", "元の画像の線画")]
        lines(image).save(out / f"{stem}_0_lines.png")
        for name, (file, size, mean, std) in SPECS.items():
            for dev in ("gpu", "cpu"):
                mask(sessions[name, dev], image, size, mean, std)        # 1 回目は準備に時間がかかるので測らない
                t = time.perf_counter()
                m = mask(sessions[name, dev], image, size, mean, std)
                times[name, dev].append(time.perf_counter() - t)
            w = on_white(image, m)
            w.save(out / f"{stem}_{name}.png")
            lines(w).save(out / f"{stem}_{name}_lines.png")
            cells += [(f"{stem}_{name}.png", name), (f"{stem}_{name}_lines.png", f"{name} の線画")]
        rows.append((stem, cells))
        print(stem)
    summary = ", ".join(f"{n}（{d}）{np.mean(v):.2f} 秒" for (n, d), v in times.items() if v)
    body = "\n".join(
        f"<h2>{html.escape(stem)}</h2><div class=row>" + "".join(
            f'<figure><img src="{f}" loading=lazy><figcaption>{html.escape(c)}</figcaption></figure>' for f, c in cells)
        + "</div>" for stem, cells in rows)
    page = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>背景を消すモデルの比べ</title>
<style>body{{font-family:sans-serif;margin:16px;background:#eee}} .row{{display:flex;gap:8px;flex-wrap:wrap}}
figure{{margin:0;background:#fff;padding:4px}} img{{width:260px;display:block}} figcaption{{font-size:12px}}</style></head>
<body><h1>背景を消すモデルの比べ</h1><p>u2netp（4.6MB、一般向け）と isnet-anime（176MB、アニメ絵向け）。白い背景に置いたものと、その線画（AA にする線）。
1 枚あたりの時間（1 回目を除く）: {summary}</p>{body}</body></html>"""
    (out / "index.html").write_text(page, encoding="utf-8")
    print(out / "index.html")
    print(summary)


if __name__ == "__main__":
    main()
