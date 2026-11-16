// ブラウザの中で学習済みモデルを動かす（onnxruntime-web）。models.js に渡す runner を作る。
//
// モデルは Hugging Face（5atoya/asciiartme-models。版を決めた URL）から読み、sha256 を確かめて
// Cache Storage に残す（2 回目からは読み込まない）。GPU（WebGPU）が使えればそれで、使えなければ CPU（WASM）で動かす。
// onnxruntime-web は jsDelivr から読む（画像はどこにも送らない。読むのはプログラムとモデルだけ）。

const ORT_VERSION = "1.31.1";
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
export const MODEL_BASE = "https://huggingface.co/5atoya/asciiartme-models/resolve/fbf65632d589b434eeb1a110783e2208b19e4c69/";
// 名前 → [ファイル, バイト数, sha256]（aame/get_models.py と同じもの）
export const FILES = {
  manga_line: ["manga_line.onnx", 86392030, "d486432cada895821b1153a92a64f2ffe9f21bf97e46a8c1c1bdb301de1da20f"],
  teed: ["teed.onnx", 252280, "0ad443441475c06192309b0649b86ab6e6c1cc88cc6441e08ce7a6afa2c3e78c"],
  face: ["face_unet.onnx", 6209211, "acc4b2c0a246a93bb643c8f626ebf4042e1113657fcc22d6286a79f74e656efe"],
  bg: ["isnet_anime.onnx", 88077609, "fdf90b7af006d665c6db2f657b5ef0a2f6e13dab010acb6a223fbc18d04db068"],
};
const CACHE = "aame-models-v1";

async function sha256(buf) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

// モデルのファイル（Uint8Array）。onProgress({kind: "download", name, received, total}) で進み具合を知らせる
async function fetchModel(name, onProgress) {
  const [file, size, digest] = FILES[name];
  const url = MODEL_BASE + file;
  let cache = null;
  try {
    cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  } catch (e) {
    cache = null;       // Cache Storage が使えない（プライベートウィンドウなど）。毎回読む
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`モデル（${file}）を読めませんでした（${res.status}）`);
  const total = Number(res.headers.get("content-length")) || size;
  const buf = new Uint8Array(total);
  const reader = res.body.getReader();
  let received = 0, last = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf.set(value, received);
    received += value.length;
    if (received - last > 2e6 || received === total) {
      last = received;
      onProgress({ kind: "download", name, received, total });
    }
  }
  if (received !== size || (await sha256(buf)) !== digest) throw new Error(`モデル（${file}）の中身が違います`);
  try {
    await cache?.put(url, new Response(buf, { headers: { "Content-Type": "application/octet-stream" } }));
  } catch (e) { /* 入りきらないときは残さない */ }
  return buf;
}

// GPU（WebGPU）が使えるか
export async function hasWebGPU() {
  try {
    return !!(globalThis.navigator?.gpu && (await navigator.gpu.requestAdapter()));
  } catch (e) {
    return false;
  }
}

// runner(name, {data, dims}) → [{data, dims}]（models.js の形）。runner.device は "webgpu" か "wasm"
// forceCPU: GPU があっても CPU（WASM）で動かす（試験用。?cpu=1）
export async function createRunner(onProgress = () => {}, { forceCPU = false } = {}) {
  const ort = await import(/* @vite-ignore */ `${ORT_BASE}ort.all.min.mjs`);
  ort.env.wasm.wasmPaths = ORT_BASE;
  ort.env.logLevel = "error";
  const gpu = !forceCPU && (await hasWebGPU());
  if (!gpu) ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(8, navigator.hardwareConcurrency || 4) : 1;
  // ノート PC で GPU が 2 つあるときは速いほうを使う（NHWC の並びも試したが、速さは変わらなかった）
  if (gpu) ort.env.webgpu.powerPreference = "high-performance";
  const providers = gpu ? ["webgpu"] : ["wasm"];
  const sessions = {};
  const session = (name) => {
    if (!sessions[name]) {
      sessions[name] = (async () => {
        const buf = await fetchModel(name, onProgress);
        onProgress({ kind: "init", name });
        return ort.InferenceSession.create(buf, { executionProviders: providers, graphOptimizationLevel: "all" });
      })();
      sessions[name].catch(() => { delete sessions[name]; });
    }
    return sessions[name];
  };
  const runner = async (name, input) => {
    const s = await session(name);
    const out = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", input.data, input.dims) });
    return s.outputNames.map((n) => {
      const t = out[n];
      const r = { data: t.data, dims: t.dims };
      return r;
    });
  };
  runner.device = gpu ? "webgpu" : "wasm";
  runner.threads = gpu ? 0 : ort.env.wasm.numThreads;
  // manga_line を 1 回に通す大きさの上限（1 辺。models.js の runTiled）。中間の面は 1 画素あたり約 1KB
  // （256 チャンネル × float32）なので、GPU の 1 つのバッファの上限の 8 割に収まる正方形にする
  if (gpu) {
    const a = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    const limit = Math.min(a.limits.maxBufferSize, a.limits.maxStorageBufferBindingSize);
    runner.maxSide = Math.max(512, Math.min(1024, Math.floor(Math.sqrt((0.8 * limit) / 1024) / 64) * 64));
  }
  runner.preload = (name) => session(name);
  return runner;
}
