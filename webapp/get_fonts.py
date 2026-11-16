#coding:utf-8
"""画面の「表示フォント」で使う Web フォントを取ってくる。

一覧は static/fonts.json。フォントとライセンスの文書を static/fonts/<id>/ に置く
（配布元のファイルをそのまま置く。GitHub には上げない）。取ってこなかったフォントは、
画面の一覧で選べないだけで、ほかは動く。

使い方:
    python -m webapp.get_fonts              # まだ無いものだけ取ってくる
    python -m webapp.get_fonts --force      # 取り直す
"""

import argparse
import json
import urllib.request
from pathlib import Path

STATIC = Path(__file__).resolve().parent / "static"
FONTS = STATIC / "fonts"
USER_AGENT = "asciiart.me-get-fonts"


def fetch(url, path):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as res:
        data = res.read()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return len(data)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="あるものも取り直す")
    a = ap.parse_args()
    listing = json.loads((STATIC / "fonts.json").read_text(encoding="utf-8"))
    for font in listing["fonts"]:
        if font.get("builtin"):
            continue
        folder = FONTS / font["id"]
        for url, name in font["download"]:
            path = folder / name
            if path.exists() and not a.force:
                continue
            n = fetch(url, path)
            print(f"{font['id']}: {name} ({n:,} bytes)")
        note = (f"{font['label']}\n出どころ: {font['source']}\nライセンス: {font['license']}\n"
                "ファイルは配布元のものを、そのまま置いている。\n")
        (folder / "SOURCE.txt").write_text(note, encoding="utf-8")
    print(FONTS)


if __name__ == "__main__":
    main()
