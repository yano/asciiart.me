
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

Which settings look best depends on the image, so `aame.candidates` makes several variants and a
page to compare them (open `out/pick/<image>_index.html` in a browser):

```
python -m aame.candidates luckystar01.jpg --out out/pick
```

`--lineart` uses the detectors and weights of ComfyUI's `comfyui_controlnet_aux` (paths are set at
the top of `aame/lineart.py`) and also needs torch. `--face-gain`, `--color-edges face` and
`--fill face` use the anime face model from the same package.

## Demo

http://asciiart.me/

## License
MIT

