// エンジンの呼び出しを1か所にまとめたもの。画面（app.js）はここだけを通してエンジンを使う。
// 段階1（この PC で動かす試作）ではサーバーの API を呼ぶ。ブラウザだけで動かす版（段階3）では、
// このファイルをブラウザ内の Worker を呼ぶものに差し替える（関数の形は変えない）。

async function check(res) {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body.detail) msg = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch (e) { /* 本文が JSON でないときは状態の文字列のまま */ }
    throw new Error(msg);
  }
  return res;
}

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return (await check(res)).json();
}

// 画面で AA を描くための文字の表
export async function glyphs() {
  return (await check(await fetch("glyphs.json"))).json();
}

// 候補の一覧 [{name, title, note, settings}]（描き込みの少ない順）
export async function presets() {
  return (await check(await fetch("api/presets"))).json();
}

// 画像（File か Blob）を渡す → {id, scale, width, height, rows, image_width, image_height,
//   shrunk, max_side, analysis（線の太さ）, presets, ms}。width, height は前処理しないときの AA の大きさ。
//   長辺が max_side px より大きい画像は縮める（shrunk は縮める前の大きさ。縮めなければ null）
export async function open(file) {
  const form = new FormData();
  form.append("file", file, file.name || "image.png");
  return (await check(await fetch("api/images", { method: "POST", body: form }))).json();
}

// 前処理した画像を作る → {id（前処理した画像の id）, scale, width, height, rows, before, after, presets, ms}
// id は元の画像の id。prep: {crop: [x0, y0, x1, y1]（0..1）か null, long: AA の長辺（px）か null,
// delta: 線の太さを変える量（AA の大きさで px）}。before / after は変える前と後の線の太さ
export async function prepare(id, prep) {
  return post(`api/images/${id}/prepare`, prep);
}

// 設定で AA を作る → {lines, scale, width, height, rows, ms}
// settings: lam, color, fill, fill_gain, face_gain, mode, width, exclude（使わない文字。空白は外せない）
// paint: 塗り重ねた段階の灰色の PNG の data URL（値 = 128 + 段階 × 30。aame.regions.paint_weight）か null
// scale: AA の大きさの倍率（1 で前処理で決めた大きさ）
// edit: 線画の直し（その倍率の AA の大きさの PNG の data URL。赤が描いた線、緑が消した所。
//       aame.lineart.edit_masks）か null
export async function render(id, settings, paint = null, scale = 1, edit = null) {
  return post(`api/images/${id}/render`, { ...settings, paint, scale, edit });
}

// row 行目の別の候補 → {row, options: [{kind, label, line}], ms}
// current は、いま表示している行（見た目が同じ候補は返らない）。ほかは render と同じ
export async function rowOptions(id, row, settings, paint = null, scale = 1, current = null, edit = null) {
  return post(`api/images/${id}/rows/${row}`, { ...settings, paint, scale, current, edit });
}

// 表示フォント（fonts.json の id）から、text に使う文字だけを抜き出したフォント → Blob（woff2）
// .html にフォントを埋め込むときに使う
export async function fontSubset(fontId, text) {
  const res = await fetch(`api/fonts/${fontId}/subset`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }),
  });
  return (await check(res)).blob();
}

// 当てはめに使う線画（黒い線・透明な地）の URL
export function lineartURL(id, color, scale = 1) {
  const q = new URLSearchParams({ scale: String(scale) });
  if (color) q.set("color", color);
  return `api/images/${id}/lineart?${q}`;
}

// 送った画像そのもの（長辺 max_side px まで縮めたもの）の URL。切り抜きの画面で使う
export function originalURL(id) {
  return `api/images/${id}/original`;
}

// 元の画像を AA の大きさにしたものの URL
export function sourceURL(id, scale = 1) {
  return `api/images/${id}/source?scale=${scale}`;
}
