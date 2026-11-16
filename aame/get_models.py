#coding:utf-8
"""ONNX にしたモデルを、GitHub の Releases から取ってくる（torch も ComfyUI も要らない）。

    python -m aame.get_models [--out models]

置き場所は RELEASE（タグ models-v1）。中身は sha256 で確かめる。ファイルは aame/export_onnx.py で作ったもの
（元の重みと、そのライセンスは THIRD_PARTY_NOTICES.txt）。自分で作るなら python -m aame.export_onnx。
"""

import argparse
import hashlib
import sys
import urllib.request
from pathlib import Path

RELEASE = "https://github.com/yano/asciiart.me/releases/download/models-v1/"
FILES = {
    "manga_line.onnx": "c3d7f329bf270fc6f8e431caee6a871d4c344748cc7108f7490408055ec5ec39",
    "teed.onnx": "0ad443441475c06192309b0649b86ab6e6c1cc88cc6441e08ce7a6afa2c3e78c",
    "face_unet.onnx": "acc4b2c0a246a93bb643c8f626ebf4042e1113657fcc22d6286a79f74e656efe",
    "THIRD_PARTY_NOTICES.txt": "bc19f57cb4eaaa05726363a7ac565ce28efc637c35675b09802bc6e84a0a5912",
}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def get(out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    for name, digest in FILES.items():
        path = out / name
        if path.exists() and sha256(path) == digest:
            print(f"{path}: ok")
            continue
        print(f"{path}: {RELEASE + name}", flush=True)
        part = path.with_suffix(path.suffix + ".part")
        urllib.request.urlretrieve(RELEASE + name, part)
        if sha256(part) != digest:
            part.unlink()
            sys.exit(f"{name} の中身が違います（sha256 が合わない）")
        part.replace(path)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "models"))
    get(ap.parse_args().out)


if __name__ == "__main__":
    main()
