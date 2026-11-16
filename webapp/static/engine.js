// エンジンの呼び出しを1か所にまとめたもの。画面（app.js）はここだけを通してエンジンを使う。
//
// この PC のサーバー（python -m webapp.server）があればそれを使い（engine_server.js）、
// 無ければ（panzersoft.com のような静的なサイトに置いたとき）ブラウザの中のエンジンを使う（engine_local.js）。
// URL に ?engine=local か ?engine=server を付けると、どちらかに決められる。
// 画像の URL を返す関数（lineartURL・originalURL・sourceURL）は、どちらでも await して使う。

const want = new URLSearchParams(location.search).get("engine");

async function hasServer() {
  try {
    const res = await fetch("api/presets");
    return res.ok && (res.headers.get("content-type") || "").includes("json");
  } catch (e) {
    return false;
  }
}

const useLocal = want === "local" || (want !== "server" && !(await hasServer()));
const impl = useLocal ? await import("./engine_local.js") : await import("./engine_server.js");

export const { kind, setProgressHandler, glyphs, presets, open, prepare, render, rowOptions, fontSubset,
  lineartURL, originalURL, sourceURL } = impl;
