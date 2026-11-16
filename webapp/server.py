#coding:utf-8
"""AA を作る Web アプリのサーバー（この PC で動かす試作。webapp_plan.md の段階1）。

使い方:
    python -m webapp.server              # http://127.0.0.1:8765/ を開く
    python -m webapp.server --port 9000 --no-browser

画面（static/）は素の HTML / CSS / JavaScript。エンジンの呼び出しは static/engine.js に
まとめてあり、ブラウザだけで動かす版（段階3）ではそこを差し替える。

API:
    POST /api/images                  画像を送る → id、AA の大きさ、候補の一覧、線の太さ
    POST /api/images/{id}/prepare     切り抜き・大きさ・線の太さを変えた画像を作る → 新しい id と線の太さ
    GET  /api/images/{id}/original    送った画像（切り抜きの画面用。長辺 MAX_SIDE px まで縮めたもの）
    POST /api/images/{id}/render      設定（と塗ったマスク、線画の直し、使わない文字、大きさの倍率）を送る → 行のリスト
    POST /api/images/{id}/rows/{row}  同じく設定を送る → その行の別の候補
    GET  /api/images/{id}/lineart     当てはめに使う線画（PNG。?color=face|all&scale=）
    GET  /api/images/{id}/source      元の画像を AA の大きさにしたもの（PNG。?scale=）
    GET  /api/presets                 候補の一覧
    POST /api/fonts/{id}/subset       表示フォントから、送った文字だけを抜き出す（woff2。.html に埋め込む）

扱う大きさは長辺 MAX_SIDE px まで。それより大きい画像は、送られたときに縮める。

AA の大きさの倍率（scale）ごとに、途中結果（aame.session.Session）を別に持つ。
前処理（aame.prep）した画像は、元の画像とは別の id で持つ（元の画像1枚につき1つ）。
当てはめは CPU を使い切るので、エンジンの仕事は1つずつ順に行う（並べても速くならない）。
"""

import argparse
import base64
import io
import json
import threading
import time
import uuid
import webbrowser
from collections import OrderedDict
from pathlib import Path
from typing import Literal, Optional

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps
from pydantic import BaseModel, Field

from aame import candidates, convert, cost, models, prep
from aame.lineart import canvas_size
from aame.session import Session

STATIC = Path(__file__).resolve().parent / "static"
MAX_IMAGES = 12                 # 覚えておく画像の数（前処理した画像も数える。古いものから忘れる）
MAX_SCALES = 8                  # 1枚の画像につき覚えておく大きさの数
MAX_UPLOAD = 30 * 1024 * 1024   # 受け付ける画像の大きさ（バイト）
MAX_SIDE = 2048                 # 扱う画像と AA の長辺の上限（px）。大きいほど当てはめに時間がかかる
MAX_SUBSET = 200_000            # フォントから抜き出すときに受け付ける文字数
MAX_GLYPH_SETS = 4              # 覚えておく「文字を外した辞書」の数（1つで 20MB ほど使う）
# 画面に出す候補（candidates.PRESETS の名前と、画面での名前）。描き込みの少ない順
WEB_PRESETS = [
    ("sparse", "控えめ"),
    ("standard", "標準"),
    ("color_all", "色の境界"),
    ("color_all_fill", "色の境界 + 黒い面"),
]

app = FastAPI(title="asciiart.me")
_engine = threading.Lock()      # エンジンの仕事は1つずつ
_images = OrderedDict()         # id → Entry
_images_lock = threading.Lock()


class Entry:
    """送られた画像1枚と、大きさの倍率ごとの Session。

    base は倍率 1 のときの AA の大きさ（前処理で決めたもの。None なら長辺 800px まで）。
    parent は前処理した画像のときの、元の画像の id。
    """

    def __init__(self, image, base=None, parent=None):
        self.image = image
        self.base = tuple(base) if base else canvas_size(image)
        self.parent = parent
        self.children = []           # 前処理した画像の id（元の画像のとき。新しいものが後ろ）
        self.measured = OrderedDict()   # (切り抜き, 大きさ) → 線の太さ（前処理で太さだけ変えるとき用）
        self.sessions = OrderedDict()

    def size(self, scale=1.0):
        """その倍率の AA の大きさ (幅, 高さ)（Session と同じ計算）。"""
        w, h = self.base
        if scale == 1.0:
            return w, h
        return max(1, int(round(w * scale))), max(1, int(round(h * scale)))

    def session(self, scale):
        """その倍率の Session（無ければ作る。_engine を持って呼ぶこと）。"""
        key = round(float(scale), 4)
        s = self.sessions.get(key)
        if s is None:
            s = Session(self.image, scale=key, base=self.base)
            self.sessions[key] = s
            while len(self.sessions) > MAX_SCALES:
                self.sessions.popitem(last=False)
        self.sessions.move_to_end(key)
        return s


class RenderRequest(BaseModel):
    """Session.render に渡す設定。paint は塗り重ねた段階の画像（灰色の PNG の data URL。
    aame.regions.paint_weight）。edit は線画の直し（PNG の data URL。赤が描いた線、緑が消した所。
    aame.lineart.edit_masks）。exclude は使わない文字（空白は外せない）。
    scale は AA の大きさの倍率（1 で前処理で決めた大きさ）。"""
    scale: float = Field(1.0, ge=0.5, le=1.6)
    lam: float = Field(2.0, ge=0.5, le=6.0)
    color: Optional[Literal["face", "all"]] = None
    fill: Optional[Literal["face", "all"]] = None
    fill_gain: float = Field(0.5, ge=0.0, le=3.0)
    face_gain: float = Field(2.0, ge=1.0, le=8.0)
    mode: Literal["v2", "v1"] = "v2"
    width: int = Field(2, ge=1, le=4)
    paint: Optional[str] = None
    edit: Optional[str] = None
    exclude: str = Field("", max_length=2000)


class RowRequest(RenderRequest):
    """行の候補を求める設定。current はいま表示している行（見た目が同じ候補を除く）。"""
    current: Optional[str] = None


class PrepRequest(BaseModel):
    """前処理の設定。crop は (x0, y0, x1, y1)（画像の幅・高さに対する 0..1）、long は AA の長辺
    （px。None なら長辺 800px まで縮めるだけ）、delta は線の太さを変える量（AA の大きさで px）。"""
    crop: Optional[list[float]] = Field(None, min_length=4, max_length=4)
    long: Optional[int] = Field(None, ge=200, le=MAX_SIDE)
    delta: float = Field(0.0, ge=-4.0, le=4.0)
    keep: Optional[str] = None      # 画面がいま使っている、前に前処理した画像の id（忘れない）


def presets():
    """候補の一覧（名前、画面での名前、説明、設定）。描き込みの少ない順。"""
    by_name = {p[0]: p for p in candidates.PRESETS}
    return [dict(name=name, title=title, note=by_name[name][1],
                 settings=candidates.settings(by_name[name])) for name, title in WEB_PRESETS]


class SubsetRequest(BaseModel):
    text: str = Field(..., max_length=MAX_SUBSET)


def open_image(data):
    """送られた画像を開く。スマホの写真の向きを直し、透明な所は白にする。
    長辺が MAX_SIDE px より大きければ縮める。"""
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except Exception:
        raise HTTPException(400, "画像として読めませんでした")
    image = ImageOps.exif_transpose(image)
    if image.mode in ("RGBA", "LA", "PA") or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        white = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        image = Image.alpha_composite(white, rgba)
    image = image.convert("RGB")
    if max(image.size) > MAX_SIDE:
        image.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    return image


def decode_mask(url, what="塗った所"):
    """data URL（PNG）を PIL の画像にする。"""
    if not url:
        return None
    try:
        data = base64.b64decode(url.split(",", 1)[1] if url.startswith("data:") else url)
        image = Image.open(io.BytesIO(data))
        image.load()
        return image
    except Exception:
        raise HTTPException(400, f"{what}の画像が読めませんでした")


_glyph_sets = OrderedDict()     # 使わない文字（並べ替えたもの）→ その文字を外した辞書


def glyphs_without(exclude):
    """使わない文字を外した辞書（無ければ None = 標準の辞書）。_engine を持って呼ぶこと。

    同じ文字の組なら同じ GlyphSet を返す（aame.cost が辞書ごとに文字側の量を覚えるため）。
    古いものは忘れ、覚えた量も捨てる。"""
    full = convert.glyph_set()
    key = "".join(sorted(set(exclude) & set(full.chars)))
    if not key:
        return None
    g = _glyph_sets.get(key)
    if g is None:
        g = full.without(key)
        _glyph_sets[key] = g
        while len(_glyph_sets) > MAX_GLYPH_SETS:
            cost.forget(_glyph_sets.popitem(last=False)[1])
    _glyph_sets.move_to_end(key)
    return g


def entry(image_id):
    with _images_lock:
        e = _images.get(image_id)
        if e is None:
            raise HTTPException(404, "画像が見つかりません（サーバーを再起動したときは、もう一度画像を入れてください）")
        _images.move_to_end(image_id)
        return e


def options_of(req):
    """リクエストを Session.render の設定にする（塗りと線画の直しの data URL は画像にする）。
    使わない文字（exclude）は、_engine を持ってから glyphs_without で辞書にする。"""
    options = req.model_dump(exclude={"paint", "edit", "exclude", "scale", "current"})
    options.update(paint=decode_mask(req.paint), edit=decode_mask(req.edit, "線画の直し"))
    return options


def sized(e, scale):
    """倍率 scale の AA が長辺 MAX_SIDE px に収まるか確かめる。"""
    if max(e.size(round(scale, 4))) > MAX_SIDE:
        raise HTTPException(400, f"AA の長辺は {MAX_SIDE}px までです")
    return e


def size_of(s):
    return dict(scale=s.scale, width=s.size[0], height=s.size[1], rows=s.rows)


def entry_size(e):
    w, h = e.base
    return dict(scale=1.0, width=w, height=h, rows=h // 18)


def analysis(image, size):
    """線の太さ（aame.prep.measure）と、太さを変える量のおすすめ。"""
    info = prep.measure(image, size)
    info["recommended"] = prep.recommended(info)
    return info


def remember(e):
    image_id = uuid.uuid4().hex
    with _images_lock:
        _images[image_id] = e
        while len(_images) > MAX_IMAGES:
            _images.popitem(last=False)
    return image_id


def crop_box(req):
    if not req.crop:
        return None
    x0, y0, x1, y1 = (min(1.0, max(0.0, v)) for v in req.crop)
    if abs(x1 - x0) < 0.02 or abs(y1 - y0) < 0.02:
        raise HTTPException(400, "切り抜く範囲が小さすぎます")
    return (x0, y0, x1, y1)


@app.get("/api/presets")
def get_presets():
    return presets()


@app.post("/api/images")
def post_image(file: UploadFile = File(...)):
    data = file.file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "画像が大きすぎます")
    image = open_image(data)
    shrunk = None       # 縮めたときの、縮める前の大きさ
    try:
        sent = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).size
        if max(sent) > MAX_SIDE:
            shrunk = list(sent)
    except Exception:
        pass
    e = Entry(image)
    t = time.perf_counter()
    found = analysis(e.image, e.base)
    image_id = remember(e)
    return dict(id=image_id, **entry_size(e), image_width=e.image.size[0], image_height=e.image.size[1],
                shrunk=shrunk, max_side=MAX_SIDE, analysis=found, presets=presets(),
                ms=int((time.perf_counter() - t) * 1000))


@app.post("/api/images/{image_id}/prepare")
def post_prepare(image_id: str, req: PrepRequest):
    """前処理した画像を、新しい id で覚える。

    同じ元の画像の、前に作ったものは忘れる（画面がいま使っているもの req.keep は残す）。

    before は切り抜いて大きさを決めただけの画像の線の太さ、after は太さを変えたあとのもの
    （変えないときは None）。
    """
    e = entry(image_id)
    if e.parent:
        raise HTTPException(400, "前処理した画像には、もう一度前処理できません（元の画像の id を使ってください）")
    t = time.perf_counter()
    box = crop_box(req)
    image = prep.crop(e.image, box)
    size = prep.target_size(image, req.long) if req.long else canvas_size(image)
    key = (box, size)
    with _images_lock:
        before = e.measured.get(key)
    if before is None:
        before = analysis(image, size)
        with _images_lock:
            e.measured[key] = before
            while len(e.measured) > 16:
                e.measured.popitem(last=False)
    after = None
    if req.delta:
        image = prep.adjust(image, size, req.delta)
        after = analysis(image, size)
    child = Entry(image, base=size, parent=image_id)
    child_id = remember(child)
    with _images_lock:
        for old in e.children:
            if old != req.keep:
                _images.pop(old, None)
        e.children = [i for i in e.children if i == req.keep and i in _images] + [child_id]
    return dict(id=child_id, **entry_size(child), before=before, after=after, presets=presets(),
                ms=int((time.perf_counter() - t) * 1000))


@app.get("/api/images/{image_id}/original")
def get_original(image_id: str):
    image = entry(image_id).image
    buf = io.BytesIO()
    image.save(buf, "PNG")
    return Response(buf.getvalue(), media_type="image/png")


@app.post("/api/images/{image_id}/render")
def post_render(image_id: str, req: RenderRequest):
    e = sized(entry(image_id), req.scale)
    options = options_of(req)
    t = time.perf_counter()
    with _engine:
        s = e.session(req.scale)
        lines = s.render(glyphs=glyphs_without(req.exclude), **options)
    return dict(lines=lines, **size_of(s), ms=int((time.perf_counter() - t) * 1000))


@app.post("/api/images/{image_id}/rows/{row}")
def post_row(image_id: str, row: int, req: RowRequest):
    e = sized(entry(image_id), req.scale)
    options = options_of(req)
    t = time.perf_counter()
    with _engine:
        s = e.session(req.scale)
        if not 0 <= row < s.rows:
            raise HTTPException(400, "行の番号が範囲の外です")
        found = s.row_options(row, dict(options, glyphs=glyphs_without(req.exclude)), req.current)
    return dict(row=row, options=found, ms=int((time.perf_counter() - t) * 1000))


@app.get("/api/images/{image_id}/lineart")
def get_lineart(image_id: str, color: Optional[Literal["face", "all"]] = None,
                scale: float = Query(1.0, ge=0.5, le=1.6)):
    e = sized(entry(image_id), scale)
    with _engine:
        png = e.session(scale).lineart_png(color)
    return Response(png, media_type="image/png")


@app.get("/api/images/{image_id}/source")
def get_source(image_id: str, scale: float = Query(1.0, ge=0.5, le=1.6)):
    e = sized(entry(image_id), scale)
    image = e.image
    size = e.size(round(scale, 4))
    if image.size != size:
        image = image.resize(size, Image.LANCZOS)
    buf = io.BytesIO()
    image.save(buf, "PNG")
    return Response(buf.getvalue(), media_type="image/png")


_fonts = {}     # フォントの id → 展開したフォントのバイト列（woff2 の展開は 9 秒ほどかかるので覚えておく）
_fonts_lock = threading.Lock()
WARM_FONT = "saitamaar"         # 起動したときに裏で展開しておくフォント（表示フォントの既定）


def font_bytes(font_id):
    """static/fonts.json にある表示フォントを読む（woff2 は展開して覚えておく）。"""
    with _fonts_lock:
        if font_id not in _fonts:
            from fontTools.ttLib import TTFont
            listed = json.loads((STATIC / "fonts.json").read_text(encoding="utf-8"))["fonts"]
            info = next((f for f in listed if f["id"] == font_id and f.get("file")), None)
            if info is None:
                raise HTTPException(404, "そのフォントは埋め込めません")
            path = (STATIC / info["file"]).resolve()
            if STATIC not in path.parents or not path.is_file():
                raise HTTPException(404, f"フォント「{info['label']}」のファイルがありません"
                                         "（python -m webapp.get_fonts で取ってきてください）")
            font = TTFont(str(path))
            font.flavor = None
            buf = io.BytesIO()
            font.save(buf)
            _fonts[font_id] = buf.getvalue()
        return _fonts[font_id]


def warm_font():
    try:
        font_bytes(WARM_FONT)
    except Exception:
        pass        # フォントが無ければ、書き出すときに知らせる


@app.post("/api/fonts/{font_id}/subset")
def post_subset(font_id: str, req: SubsetRequest):
    """表示フォントから req.text の文字だけを抜き出した woff2 を返す（.html に埋め込む用）。

    カーニングなどの文字の並びを変える機能は抜く（AA の文字の位置がずれないように）。
    フォントの名前と著作権・ライセンスの情報（name テーブル）は残す。
    """
    from fontTools import subset
    from fontTools.ttLib import TTFont
    font = TTFont(io.BytesIO(font_bytes(font_id)))
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = []
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.notdef_outline = True
    sub = subset.Subsetter(options)
    sub.populate(text=req.text + " \u3000")
    sub.subset(font)
    buf = io.BytesIO()
    subset.save_font(font, buf, options)
    return Response(buf.getvalue(), media_type="font/woff2")


app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")


def main():
    import uvicorn
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true", help="ブラウザを開かない")
    a = ap.parse_args()
    url = f"http://{a.host}:{a.port}/"
    if models.use("manga_line"):
        dev = models.device()   # ここで線画化のモデルを読む（初めの画像を待たせない）
        print(f"線画化: onnxruntime（{'GPU' if dev != 'CPUExecutionProvider' else 'CPU'}: {dev}）", flush=True)
    else:
        print("線画化: torch（comfyui_controlnet_aux）", flush=True)
    print(f"{url} を開いてください（止めるときは Ctrl+C）", flush=True)
    if not a.no_browser:
        threading.Timer(1.5, webbrowser.open, (url,)).start()
    threading.Thread(target=warm_font, daemon=True).start()
    uvicorn.run(app, host=a.host, port=a.port, log_level="warning")


if __name__ == "__main__":
    main()
