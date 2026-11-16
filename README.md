
# Ascii Art Me

This is AsciiArt auto generator.
asciiartme.py converts image to asciiart.

## Requirements

- numpy
- PIL

## Usage

```
python asciiartme.py <imagename>

python asciiartme.py miku.png  # this outputs miku.html

```
Output : asciiart html file.

## New engine (work in progress)

`aame` is a faster reimplementation of the matcher (about 0.5 s instead of 20-50 s per image).
It needs a few more packages: `pip install -r requirements-aame.txt`.

```
python -m aame.convert miku.png                 # v1: no horizontal drift from space replacement
python -m aame.convert miku.png --mode legacy   # byte-identical to asciiartme.py
python -m aame.convert miku.png --lineart manga_line --width 2   # learned line-art extractor
python -m aame.convert miku.png --mode v2 --lineart manga_line --lam 2   # v2: shift-tolerant, orientation-aware cost
```

`--mode v2` matches 1px line art directly (no line thickening). `--lam` sets the density:
1.5 is sparse, 3 is dense. Density can also be raised locally:

```
python -m aame.convert miku.png --mode v2 --lineart manga_line --face-gain 2             # faces, found automatically
python -m aame.convert miku.png --mode v2 --lineart manga_line --mask m.png --mask-gain 3   # where m.png is painted white
```

v2 also slides short glyphs (`_`, `-`, `.` ...) up or down by up to `--shift` px (default 4) when
matching, so lines at heights no glyph can draw are not left blank. `--shift 0` turns this off.

Anime screenshots draw pupils and highlights with colour areas, not lines. `--color-edges` adds
those colour boundaries to the line art (`face`: inside faces only, `all`: whole image):

```
python -m aame.convert luckystar01.jpg --mode v2 --lineart manga_line --color-edges face --face-gain 2
```

`--fill face` (or `all`) fills dark areas such as pupils with dense glyphs (`--fill-gain` sets how dense).

The glyph dictionary is `chrDict_20261115_utf8.txt`: the same 551 characters as the 2017 dictionary
(`chrDict_20170327_utf8.txt`), redrawn from today's MS PGothic (v5.32), which differs in 34 glyphs.
`python -m aame.make_dict` rebuilds it (Windows only). `--mode legacy` still uses the 2017 dictionary.

Which settings look best depends on the image, so `aame.candidates` makes several variants and a
page to compare them (open `out/pick/<image>_index.html` in a browser):

```
python -m aame.candidates luckystar01.jpg --out out/pick
```

### Models

The learned models (`manga_line` line art, the `teed` colour edges, the anime face model used by
`--face-gain`, `--color-edges face` and `--fill face`, and the background remover of the web app)
run with onnxruntime from the ONNX files in `models/`. Download them from this repository's releases
(tag `models-v2`; the files are checked with sha256):

```
python -m aame.get_models
```

Or make them yourself from the original weights, which `aame.export_onnx` downloads from the
repositories below (pinned versions, checked with sha256):

```
python -m aame.export_onnx
```

This needs torch and ComfyUI's `comfyui_controlnet_aux` for the network definitions (set `AAME_AUX`
to its `src` folder; the default is the path at the top of `aame/lineart.py`). Neither is needed to
run the models. The other `--lineart` methods, which are only there for comparison, still run on
torch through that package.

| Model | Weights | Licence |
|---|---|---|
| manga_line | `erika.pth` from [ljsabc/MangaLineExtraction_PyTorch](https://github.com/ljsabc/MangaLineExtraction_PyTorch) (release v1) | MIT |
| TEED | `checkpoints/BIPED/7/7_model.pth` from [xavysp/TEED](https://github.com/xavysp/TEED) | MIT |
| Anime face segmentation | `model/UNet.pth` from [siyeong0/Anime-Face-Segmentation](https://github.com/siyeong0/Anime-Face-Segmentation) | MIT |
| Background removal (`isnet_anime.onnx`) | `isnetis.onnx` from [skytnt/anime-seg](https://huggingface.co/skytnt/anime-seg) ([SkyTNT/anime-segmentation](https://github.com/SkyTNT/anime-segmentation); the same file as rembg's `isnet-anime`), with its weights stored as float16 (88 MB instead of 176 MB; computed in float32, the output is the same within 3e-6) | Apache-2.0 |

`models/THIRD_PARTY_NOTICES.txt` holds these licences and must be kept with the model files.
`comfyui_controlnet_aux` downloads the same `erika.pth` and `UNet.pth`, but its TEED `7_model.pth`
holds different weights (it comes from a CC BY-NC-SA 4.0 repository), so it is not used.

onnxruntime uses the GPU when it can. Install `onnxruntime-gpu` (CUDA) or `onnxruntime-directml`
(Windows) instead of `onnxruntime` for that. On the CPU, the line art takes about 20 s for each
image and size (Core i7-8700K, 800 px). On a GPU it takes under 1 s. Environment variables:

- `AAME_MODELS`: the folder that holds the `.onnx` files.
- `AAME_ORT`: where to run them (`auto`, `cpu`, `cuda` or `dml`).
- `AAME_BACKEND`: `auto` (ONNX when the files exist), `onnx` or `torch`.

## Web app (prototype)

A browser front end for `aame`:

0. Drop (or paste) an image and prepare it (or skip this): crop it, remove the background (the
   character stays and the rest turns white, so background lines stay out of the AA; isnet-anime,
   made for anime pictures, also works fairly well on photos), set the AA size, and check the
   line width. Lines that are too thick for the AA size tend to come out doubled and lines that are
   too thin get lost, so the width is measured at the AA size and can be changed (by growing the
   light or the dark areas; no lines are redrawn). The prepared image and its line art can be
   checked at 1:1. Images and AA are limited to 2048 px on the long side (larger images are
   shrunk when they are opened); a 2048 px AA takes about 15 s per candidate.
1. Four candidates appear, from the sparsest to the densest. Hover over a candidate to see that spot
   at 1:1 on the right; click to hold the spot and compare the others there.
2. Pick the size: the chosen candidate is made again at slightly different scales (the glyph
   layout changes with the size), compared the same way.
3. Finish it: adjust the settings, fix single rows (click a row to get alternatives: other
   layouts, the row's line art shifted up or down by 1-2 px, stretched or shrunk by 0.5-2% around
   its centre of mass, other settings), paint where you want more (or less) detail (each stroke
   over the same spot goes one step further, up to four, and the AA is remade right away), fix the
   line art itself (erase lines you do not want, such as the background, or draw lines and dots,
   such as a nose; the lines the matcher uses are shown under the AA), edit the text directly,
   undo / redo or drop all the edits, then copy or save it as text, PNG or HTML. The HTML comes
   in two versions: plain MS PGothic, or with the display font embedded (only the glyphs the AA
   uses, a few kB), which looks the same everywhere and at any zoom.

"使う文字" (characters to use) in the top bar chooses which glyphs the AA may use: switch whole
groups (symbols, half-width kana, katakana, hiragana, letters and digits, kanji, Greek and
Cyrillic) or single characters off, for example round letters that land on lines. The characters
the current AA uses are listed first, most used first. Spaces are always used. The choice is kept
in the browser and applies to the candidates, the sizes, the finished AA and the row alternatives.

The image never leaves your PC: the server runs locally and the browser only talks to it.
The same page also runs without the server, entirely in the browser (see Browser version below).

```
pip install -r requirements-aame.txt -r requirements-webapp.txt
python -m aame.get_models          # once: the ONNX models (see Models above)
python -m webapp.get_fonts         # optional: display fonts (Saitamaar, textar, ...)
python -m webapp.server            # opens http://127.0.0.1:8765/
```

The AA is drawn on a canvas from `webapp/static/glyphs.json` (MS PGothic 16px glyph shapes), so it
looks the same on every OS. `python -m webapp.make_glyphs` rebuilds that file (Windows only).
The display font can be switched to the AA web fonts listed in `webapp/static/fonts.json`
(Saitamaar by default, when it has been downloaded); `python -m webapp.get_fonts` downloads them
(and their licence files) from their distributors into `webapp/static/fonts/`.
The plain HTML uses MS PGothic, so view it at 100% zoom: at other zoom levels MS PGothic's glyph
widths do not scale evenly and the rows drift apart. The other HTML embeds a subset of the display
font (Saitamaar when the display font is MS PGothic), made on the server with fontTools.
The server keeps the line art, faces and colour edges of each image and size, so changing a setting
only re-runs the matcher (about 2 s for an 800px image) and a row's alternatives take about 1.5 s.

## Browser version

The web app also runs with no server at all: the whole engine (`webapp/static/aame/`, a JavaScript
port of `aame`) runs in a Web Worker, the models run with
[onnxruntime-web](https://onnxruntime.ai/) on the GPU (WebGPU) and are loaded once from
[Hugging Face](https://huggingface.co/5atoya/asciiartme-models) (about 180 MB, plus 88 MB for the
background remover when it is used; the browser keeps them). Images are not sent anywhere. AA are
limited to 1024 px on the long side. `webapp/static/engine.js` uses the local server when there is
one and the in-browser engine otherwise (`?engine=local` or `?engine=server` picks one).

```
python -m webapp.build_static      # writes out/asciiartme/: put it on any static web server
cd out/asciiartme && python serve.py   # or try it here (Python only, nothing to install)
```

Opening `index.html` as a file does not work (the browser does not load the modules), and the page
needs https or localhost for WebGPU. Without WebGPU it runs on the CPU, which is much slower; send
`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (as
`serve.py` and `webapp.server` do) so that it can use several threads. Use a recent Chrome or Edge.
The HTML with the embedded display font holds the whole font file (about 1 MB) instead of a subset.

On an RTX 3090 (800 px AA): four candidates in about 12 s, four more sizes in about 15 s (the server
with CUDA: 8 s and 10 s). The AA differs from the server's in about 1 row in 12 (GPU rounding).
`aaeval/js/` checks the port against the Python engine (`dump_*.py` then `node *_test.mjs`) and
`aaeval/webapp_test/ui_local.mjs` runs the page in both engines.

## Evaluation

`aaeval` renders the AA with the real font (pixel-exact with Edge for MS PGothic 16px, Windows only)
and scores it against the line drawing. Requires `pip install -r requirements-aame.txt`.

```
python -m aaeval.run_engine miku.png --out out/engine   # compare legacy and v1
python -m aaeval.compare_lineart miku.png --out out/lineart   # compare line-art methods
python -m aaeval.compare_cost miku.png --out out/cost         # compare v1 and v2 matching costs
python -m aaeval.compare_cost miku.png --out out/cost_color_face --color-edges face
python -m aaeval.run_baseline miku.png                  # run and score asciiartme.py itself
python -m aaeval.check_render miku.html                 # verify the renderer against Edge
```

## Demo

http://asciiart.me/

## License
MIT

