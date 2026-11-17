#coding:utf-8
"""ブラウザ版（段階3）を、静的なファイルだけのフォルダにまとめる。

    python -m webapp.build_static [--out out/asciiartme]

できたフォルダは、そのまま静的なサイト（panzersoft.com の static/asciiartme/ など）に置ける。
エンジンはブラウザの中で動き（webapp/static/engine.js がサーバーの無いことを見て engine_local.js を使う）、
モデルは Hugging Face から読む。

ほかの PC で試すときは、フォルダを写して、その中で python serve.py を実行する（Python だけあればよい）。
serve.py はこの PC の中（127.0.0.1）にだけ配る。WebGPU などは https か localhost でしか使えないので、
LAN のほかの PC から http で開いても動かない。
"""

import argparse
import hashlib
import re
import shutil
from pathlib import Path

from aame.glyphs import DICT_FILE

STATIC = Path(__file__).resolve().parent / "static"
SKIP = {"engine_server.js"}         # サーバーのエンジン（静的なサイトでは使わない）

SERVE = '''#coding:utf-8
"""asciiart.me のブラウザ版を、この PC で開く（ファイルを配るだけ。Python 3 だけで動く）。

    python serve.py [--port 8000] [--no-browser]

AA を作る処理はすべてブラウザの中で行う。画像はこの PC の外に送らない
（初めて使うときに、プログラム〈jsDelivr〉とモデル〈Hugging Face、約 180MB〉を読み込む）。
Chrome か Edge の新しい版で開くこと（GPU を WebGPU で使う）。止めるときは Ctrl+C。
"""

import argparse
import functools
import http.server
import threading
import webbrowser
from pathlib import Path


class Handler(http.server.SimpleHTTPRequestHandler):
    # Windows では .js が text/plain として配られることがあり、ブラウザが読まないので決めておく
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
                      ".wasm": "application/wasm", ".woff2": "font/woff2", ".css": "text/css",
                      ".html": "text/html; charset=utf-8", ".txt": "text/plain; charset=utf-8"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        # CPU で動かすときに複数のスレッドを使えるようにする（crossOriginIsolated）
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()

    def log_message(self, *args):
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--no-browser", action="store_true")
    a = ap.parse_args()
    handler = functools.partial(Handler, directory=str(Path(__file__).resolve().parent))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", a.port), handler)
    url = f"http://127.0.0.1:{a.port}/"
    print(f"{url} を開いてください（止めるときは Ctrl+C）", flush=True)
    if not a.no_browser:
        threading.Timer(1.0, webbrowser.open, (url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
'''


# 版をつける文字列: JS の中の、相対パスだけの文字列（モジュール、Worker、辞書・glyphs.json・fonts.json）と、index.html の src・href
LOCAL_FILE = re.compile(r"""(["'])((?:\.{1,2}/)?[\w\-./]+\.(?:js|json|txt))\1""")
HTML_REF = re.compile(r"""((?:src|href)=")([\w\-./]+\.(?:js|css))(")""")


def rewrite(path, pattern, repl):
    """文字列を置き換える（改行は元のまま）"""
    with open(path, encoding="utf-8", newline="") as f:
        s = f.read()
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(pattern.sub(repl, s))


def stamp(out):
    """プログラムとデータの URL に ?v=<版> を付ける。

    panzersoft.com（Cloudflare）は JS などをブラウザに 4 時間残させる（_headers の no-cache より、サイトの設定が勝つ）ので、
    更新した直後に、古いファイルと新しいファイルが混ざって動くことがある（2026-11-17）。index.html は毎回読み直されるので、
    そこから読むファイルの URL を版ごとに変えれば、いつもそろった組で動く。版は中身のハッシュ（変わらなければ同じ URL のまま）。
    """
    files = sorted(p for p in out.rglob("*") if p.is_file() and p.suffix in (".js", ".json", ".txt", ".css", ".html"))
    h = hashlib.sha256()
    for p in files:
        h.update(p.relative_to(out).as_posix().encode() + b"\0" + p.read_bytes())
    version = h.hexdigest()[:10]
    # 付けるのは、まとめたフォルダに実際にあるファイルを指す文字列だけ（モジュールはその JS から、データはページから
    # 読むので、どちらかの場所から探す）。ダウンロードのファイル名（"asciiartme_dict.txt" など）には付けない
    def refers(js_dir, path):
        return any((base / path).resolve().is_file() for base in (js_dir, out))

    for p in files:
        if p.suffix == ".js":
            rewrite(p, LOCAL_FILE,
                    lambda m, d=p.parent: f"{m[1]}{m[2]}?v={version}{m[1]}" if refers(d, m[2]) else m[0])
    rewrite(out / "index.html", HTML_REF,
            lambda m: f"{m[1]}{m[2]}?v={version}{m[3]}" if refers(out, m[2]) else m[0])
    return version


def build(out):
    out = Path(out)
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(STATIC, out, ignore=lambda d, names: [n for n in names if n in SKIP or n.startswith("_")])
    (out / "dict").mkdir()
    shutil.copy2(DICT_FILE, out / "dict" / DICT_FILE.name)
    version = stamp(out)
    (out / "serve.py").write_text(SERVE, encoding="utf-8")
    fonts = out / "fonts"
    if not fonts.exists():
        print("表示フォントがありません（python -m webapp.get_fonts で取ってくると、Saitamaar などが使えます）")
    files = [p for p in out.rglob("*") if p.is_file()]
    size = sum(p.stat().st_size for p in files)
    print(f"{out}  {len(files)} ファイル、{size / 1e6:.1f} MB（版 {version}）")
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "out" / "asciiartme"))
    build(ap.parse_args().out)


if __name__ == "__main__":
    main()
