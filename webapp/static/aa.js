// AA の表示と書き出し。
// 標準（MS Pゴシック）はフォントに頼らず、文字の表（glyphs.json）の形を並べて描く。どの OS でも、
// Windows のブラウザが MS Pゴシック 16px で表示したものと同じ画素になる。
// 表示フォントを切り替えたときは、その Web フォントで描く（Renderer）。

export const ROW_H = 18;

// 辞書に無い文字（手で打った文字など）を描くフォント。幅もこのフォントで測る
const FALLBACK_FONT = '16px "ＭＳ Ｐゴシック", "MS PGothic", "Saitamaar", sans-serif';

let measureCtx = null;
function measurer(font) {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  measureCtx.font = font;
  return measureCtx;
}

// 測れないときの仮の幅。半角らしい文字は 8px、それ以外は 16px
function guessWidth(ch) {
  const c = ch.codePointAt(0);
  return c < 0x1100 || (c >= 0xff61 && c <= 0xff9f) ? 8 : 16;
}

export class GlyphTable {
  // data は make_glyphs.py が作る JSON
  constructor(data) {
    this.rowH = data.row_h;
    this.map = new Map();
    this.fallback = new Map();
    for (const [ch, w, x0, y0, rows] of data.glyphs) this.map.set(ch, { w, x0, y0, rows });
  }

  has(ch) {
    return this.map.has(ch);
  }

  width(ch) {
    const g = this.map.get(ch);
    if (g) return g.w;
    let w = this.fallback.get(ch);
    if (w === undefined) {
      w = Math.round(measurer(FALLBACK_FONT).measureText(ch).width) || guessWidth(ch);
      this.fallback.set(ch, w);
    }
    return w;
  }

  lineWidth(line) {
    let w = 0;
    for (const ch of line) w += this.width(ch);
    return w;
  }

  // 辞書に無い文字の一覧（重複なし）
  unknown(lines) {
    const out = new Set();
    for (const line of lines) for (const ch of line) if (!this.map.has(ch)) out.add(ch);
    return [...out];
  }
}

// lines を描いた ImageData を返す。ink と bg は [r, g, b, a]。
// 幅は最も長い行の幅（と minWidth の大きいほう）。辞書に無い文字は img.fallback に
// {ch, x, top} を集めておき、paint() で canvas に文字として描く。
export function drawAA(table, lines, { ink = [0, 0, 0, 255], bg = [255, 255, 255, 255], minWidth = 0 } = {}) {
  let width = minWidth;
  for (const line of lines) width = Math.max(width, table.lineWidth(line));
  width = Math.max(1, width);
  const height = Math.max(1, lines.length * table.rowH);
  const img = new ImageData(width, height);
  const px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    px[i] = bg[0]; px[i + 1] = bg[1]; px[i + 2] = bg[2]; px[i + 3] = bg[3];
  }
  const put = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    px[i] = ink[0]; px[i + 1] = ink[1]; px[i + 2] = ink[2]; px[i + 3] = ink[3];
  };
  img.fallback = [];
  img.ink = ink;
  lines.forEach((line, r) => {
    const top = r * table.rowH;
    let x = 0;
    for (const ch of line) {
      const g = table.map.get(ch);
      if (g) {
        g.rows.forEach((bits, dy) => {
          for (let k = 0; bits >> k; k++) if ((bits >> k) & 1) put(x + g.x0 + k, top + g.y0 + dy);
        });
      } else {
        img.fallback.push({ ch, x, top });
      }
      x += table.width(ch);
    }
  });
  return img;
}

// ImageData を canvas に描く（canvas の大きさも合わせる）
export function paint(canvas, img) {
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  ctx.putImageData(img, 0, 0);
  if (img.fallback && img.fallback.length) {
    ctx.font = FALLBACK_FONT;
    ctx.textBaseline = "alphabetic";
    const ink = img.ink || [0, 0, 0, 255];
    ctx.fillStyle = `rgba(${ink[0]},${ink[1]},${ink[2]},${ink[3] / 255})`;
    for (const { ch, x, top } of img.fallback) ctx.fillText(ch, x, top + 16);
  }
}

const loadedFaces = new Set();

function css([r, g, b, a]) {
  return `rgba(${r},${g},${b},${a / 255})`;
}

// AA を canvas に描くもの。表示フォント（fonts.json の1つ）を切り替えられる。
export class Renderer {
  constructor(table) {
    this.table = table;
    this.info = null;     // fonts.json の項目。null か builtin なら文字の表で描く
    this.css = null;      // Web フォントで描くときの ctx.font
    this.baseline = 0;    // 行の上端からベースラインまで（px）
  }

  get builtin() {
    return !this.css;
  }

  // フォントを切り替える。読めなければ例外（切り替えない）
  async setFont(info) {
    if (!info || info.builtin) {
      this.info = info || null;
      this.css = null;
      return;
    }
    const family = `AA_${info.id}`;
    if (!loadedFaces.has(family)) {
      const face = new FontFace(family, `url(${info.file})`);
      await face.load();
      document.fonts.add(face);
      loadedFaces.add(family);
    }
    this.info = info;
    this.css = `16px "${family}"`;
    // ブラウザが行の高さ 18px の行で文字を置く位置に合わせる（行の上下の余りを半分ずつ）
    const m = measurer(this.css).measureText("あ");
    const ascent = Math.round(m.fontBoundingBoxAscent);
    const descent = Math.round(m.fontBoundingBoxDescent);
    this.baseline = Math.floor((ROW_H - (ascent + descent)) / 2) + ascent;
  }

  lineWidth(line) {
    if (this.builtin) return this.table.lineWidth(line);
    return measurer(this.css).measureText(line).width;
  }

  // lines を描く。canvas を渡せばそこに描き、無ければ作って返す
  draw(lines, { canvas = null, minWidth = 0, ink = [0, 0, 0, 255], bg = [255, 255, 255, 255] } = {}) {
    const c = canvas || document.createElement("canvas");
    if (this.builtin) {
      paint(c, drawAA(this.table, lines, { ink, bg, minWidth }));
      return c;
    }
    let width = minWidth;
    for (const line of lines) width = Math.max(width, Math.ceil(this.lineWidth(line)));
    c.width = Math.max(1, width);
    c.height = Math.max(1, lines.length * ROW_H);
    const ctx = c.getContext("2d");
    if (bg[3] > 0) {
      ctx.fillStyle = css(bg);
      ctx.fillRect(0, 0, c.width, c.height);
    }
    ctx.font = this.css;
    ctx.fontKerning = "none";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = css(ink);
    lines.forEach((line, r) => ctx.fillText(line, 0, r * ROW_H + this.baseline));
    return c;
  }
}

// テキスト（コピーと .txt 用）
export function toText(lines) {
  return lines.join("\n") + "\n";
}

const HEADER = '<!DOCTYPE html>\r\n<html>\r\n<head>\r\n<meta http-equiv="Content-Type" content="text/html">\r\n'
  + '<meta charset="UTF-8">\r\n</head>\r\n<body>\r\n'
  + "<div style=\"font-family:'ＭＳ Ｐゴシック';font-size:16px;line-height:18px;\">\r\n<nobr>\r\n";
const FOOTER = "</nobr>\r\n</div>\r\n</body>\r\n</html>\r\n";

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// .html（aame.convert.to_html(lines, "v2") と1文字も違わない）
// font を渡すと、そのフォントを埋め込んだ .html にする（どの環境・ズームでも同じ見た目になる）。
// font: {family, label, license, source, url（woff2 の data URL）}
// filter:grayscale(1) は文字に色が付くのを防ぐ。Saitamaar は 16px でちょうど画素の升目に乗る字形なので、
// Windows の Chrome・Edge がズーム 100% で ClearType（サブピクセル）で描くと、どの画素も同じ向きに色が
// 偏って、文字が緑や紫がかって見える（2026-11-15 の感想）。filter があると色の無い描き方になる。
export function toHtml(lines, font = null) {
  const body = lines.map((s) => escapeHtml(s) + "<br>\r\n").join("") + FOOTER;
  if (!font) return HEADER + body;
  const note = `文字の形: ${font.label}（${font.license}${font.source ? "、" + font.source : ""}）。AA に使う文字だけを埋め込んでいます`;
  return '<!DOCTYPE html>\r\n<html>\r\n<head>\r\n<meta http-equiv="Content-Type" content="text/html">\r\n'
    + '<meta charset="UTF-8">\r\n'
    + `<!-- ${escapeHtml(note).replace(/--/g, "‐‐")} -->\r\n`
    + `<style>\r\n@font-face { font-family: "${font.family}"; src: url(${font.url}) format("woff2"); }\r\n</style>\r\n`
    + "</head>\r\n<body>\r\n"
    + `<div style="font-family:'${font.family}','ＭＳ Ｐゴシック';font-size:16px;line-height:18px;font-kerning:none;filter:grayscale(1);">\r\n<nobr>\r\n`
    + body;
}
