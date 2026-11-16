// 画像の処理（Pillow・OpenCV・scipy・scikit-image の、エンジンが使う関数を移したもの）。
// 画像は平らな型付き配列（行ごと、h × w。色は画素ごとに c 個並べる）で持つ。
// 整数の計算をするもの（Pillow の縮小、OpenCV の色の変換など）は Python と同じ値になる。
// 浮動小数で足し合わせるもの（ぼかしなど）は、足す順の違う誤差だけが出る。

const f32 = Math.fround;

// numpy の rint・Python の round（半分は偶数へ）
export function rint(v) {
  const r = Math.round(v);
  return Math.abs(v - Math.trunc(v)) === 0.5 ? 2 * Math.round(v / 2) : r;
}

// ---------- 距離変換（scipy.ndimage.distance_transform_edt） ----------

const BIG = 1e20;

// 1次元の距離変換（Felzenszwalb と Huttenlocher の方法。2乗の距離）。f を d に書く
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

// 各画素から、mask が 0 でない最も近い画素までの距離の2乗（Float64Array）。
// scipy の distance_transform_edt(~mask) の2乗と同じ（厳密なユークリッド距離）。1 が無ければ null。
export function edtSquared(mask, h, w) {
  let any = false;
  for (let p = 0; p < h * w; p++) if (mask[p]) { any = true; break; }
  if (!any) return null;
  const out = new Float64Array(h * w);
  const n = Math.max(h, w);
  const f = new Float64Array(n), d = new Float64Array(n);
  const v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = mask[y * w + x] ? 0 : BIG;
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) out[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = out[row + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[row + x] = d[x] >= BIG ? Infinity : d[x];
  }
  return out;
}

// 距離（float32 に丸めたもの）。mask に 1 が無ければ far で埋める
export function edt32(mask, h, w, far) {
  const sq = edtSquared(mask, h, w);
  const out = new Float32Array(h * w);
  if (sq === null) return out.fill(far);
  for (let p = 0; p < h * w; p++) out[p] = Math.sqrt(sq[p]);
  return out;
}

// 距離（Float64Array）。mask が 0 でない所までの距離。1 が無ければ全部 Infinity
export function edt(mask, h, w) {
  const sq = edtSquared(mask, h, w);
  const out = new Float64Array(h * w);
  if (sq === null) return out.fill(Infinity);
  for (let p = 0; p < h * w; p++) out[p] = Math.sqrt(sq[p]);
  return out;
}

// ---------- 色 ----------

// Pillow の convert("L")（RGB → 灰色）
export function grayPIL(rgb, n) {
  const out = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    out[p] = (rgb[3 * p] * 19595 + rgb[3 * p + 1] * 38470 + rgb[3 * p + 2] * 7471 + 0x8000) >> 16;
  }
  return out;
}

// OpenCV の cvtColor(COLOR_RGB2GRAY)（uint8。OpenCV 4.12 の 15bit の係数。全 1677 万色で同じになることを確かめた）
export function grayCV(rgb, n) {
  const out = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    out[p] = (rgb[3 * p] * 9798 + rgb[3 * p + 1] * 19235 + rgb[3 * p + 2] * 3735 + 16384) >> 15;
  }
  return out;
}

// ---------- Pillow の大きさの変更（Image.resize。8bit の画像） ----------

const FILTERS = {
  lanczos: {
    support: 3.0,
    f: (x) => {
      const sinc = (v) => {
        if (v === 0.0) return 1.0;
        v *= Math.PI;
        return Math.sin(v) / v;
      };
      return -3.0 <= x && x < 3.0 ? sinc(x) * sinc(x / 3.0) : 0.0;
    },
  },
  bilinear: { support: 1.0, f: (x) => { if (x < 0.0) x = -x; return x < 1.0 ? 1.0 - x : 0.0; } },
};
const PRECISION_BITS = 32 - 8 - 2;

// Pillow の precompute_coeffs と normalize_coeffs_8bpc
function pilCoeffs(inSize, outSize, filter) {
  const scale = inSize / outSize;
  const filterscale = Math.max(scale, 1.0);
  const support = filter.support * filterscale;
  const ksize = Math.ceil(support) * 2 + 1;
  const bounds = new Int32Array(outSize * 2);
  const kk = new Int32Array(outSize * ksize);
  const k = new Float64Array(ksize);
  for (let xx = 0; xx < outSize; xx++) {
    const center = (xx + 0.5) * scale;
    const ss = 1.0 / filterscale;
    let xmin = Math.trunc(center - support + 0.5);
    if (xmin < 0) xmin = 0;
    let xmax = Math.trunc(center + support + 0.5);
    if (xmax > inSize) xmax = inSize;
    xmax -= xmin;
    let ww = 0.0;
    for (let x = 0; x < xmax; x++) {
      const v = filter.f((x + xmin - center + 0.5) * ss);
      k[x] = v;
      ww += v;
    }
    for (let x = 0; x < xmax; x++) {
      const v = ww !== 0.0 ? k[x] / ww : k[x];
      kk[xx * ksize + x] = v < 0 ? Math.trunc(-0.5 + v * (1 << PRECISION_BITS)) : Math.trunc(0.5 + v * (1 << PRECISION_BITS));
    }
    bounds[2 * xx] = xmin;
    bounds[2 * xx + 1] = xmax;
  }
  return { bounds, kk, ksize };
}

function clip8(v) {
  if (v >= (1 << PRECISION_BITS) * 256) return 255;
  if (v <= 0) return 0;
  return v >> PRECISION_BITS;
}

// Pillow の Image.resize(size, LANCZOS / BILINEAR / NEAREST) と同じ（uint8、c は 1 か 3）。
// Pillow と同じく、横に縮めてから縦に縮める（間で 8bit に丸める）。
export function resizePIL(src, w, h, c, nw, nh, filterName) {
  if (nw === w && nh === h) return src.slice();
  if (filterName === "nearest") {
    const out = new Uint8Array(nw * nh * c);
    const sx = w / nw, sy = h / nh;
    for (let y = 0; y < nh; y++) {
      const yi = Math.min(h - 1, Math.trunc((y + 0.5) * sy));
      for (let x = 0; x < nw; x++) {
        const xi = Math.min(w - 1, Math.trunc((x + 0.5) * sx));
        for (let ch = 0; ch < c; ch++) out[(y * nw + x) * c + ch] = src[(yi * w + xi) * c + ch];
      }
    }
    return out;
  }
  const filter = FILTERS[filterName];
  const needH = nw !== w, needV = nh !== h;
  const hc = pilCoeffs(w, nw, filter), vc = pilCoeffs(h, nh, filter);
  let img = src, iw = w;
  let yFirst = 0, yLast = h;
  if (needH) {
    yFirst = vc.bounds[0];
    yLast = vc.bounds[2 * nh - 2] + vc.bounds[2 * nh - 1];
    if (!needV) { yFirst = 0; yLast = h; }
    const rows = yLast - yFirst;
    const tmp = new Uint8Array(nw * rows * c);
    const half = 1 << (PRECISION_BITS - 1);
    for (let y = 0; y < rows; y++) {
      const srow = (y + yFirst) * w * c;
      for (let xx = 0; xx < nw; xx++) {
        const xmin = hc.bounds[2 * xx], xmax = hc.bounds[2 * xx + 1], k0 = xx * hc.ksize;
        for (let ch = 0; ch < c; ch++) {
          let ss = half;
          for (let x = 0; x < xmax; x++) ss += src[srow + (x + xmin) * c + ch] * hc.kk[k0 + x];
          tmp[(y * nw + xx) * c + ch] = clip8(ss);
        }
      }
    }
    img = tmp;
    iw = nw;
  }
  if (!needV) return img;
  const out = new Uint8Array(iw * nh * c);
  const half = 1 << (PRECISION_BITS - 1);
  for (let yy = 0; yy < nh; yy++) {
    const ymin = vc.bounds[2 * yy] - (needH ? yFirst : 0), ymax = vc.bounds[2 * yy + 1], k0 = yy * vc.ksize;
    for (let xx = 0; xx < iw; xx++) {
      for (let ch = 0; ch < c; ch++) {
        let ss = half;
        for (let y = 0; y < ymax; y++) ss += img[((y + ymin) * iw + xx) * c + ch] * vc.kk[k0 + y];
        out[(yy * iw + xx) * c + ch] = clip8(ss);
      }
    }
  }
  return out;
}

// ---------- OpenCV の大きさの変更（cv2.resize） ----------

// INTER_NEAREST（どの型でも）
export function resizeNearestCV(src, w, h, c, nw, nh) {
  const out = new src.constructor(nw * nh * c);
  const fx = 1 / (nw / w), fy = 1 / (nh / h);   // OpenCV と同じ計算
  for (let y = 0; y < nh; y++) {
    const sy = Math.min(Math.floor(y * fy), h - 1);
    for (let x = 0; x < nw; x++) {
      const sx = Math.min(Math.floor(x * fx), w - 1);
      for (let ch = 0; ch < c; ch++) out[(y * nw + x) * c + ch] = src[(sy * w + sx) * c + ch];
    }
  }
  return out;
}

function cubicCoeffs(x) {
  const A = -0.75;
  const c0 = f32(((A * (x + 1) - 5 * A) * (x + 1) + 8 * A) * (x + 1) - 4 * A);
  const c1 = f32(((A + 2) * x - (A + 3)) * x * x + 1);
  const c2 = f32(((A + 2) * (1 - x) - (A + 3)) * (1 - x) * (1 - x) + 1);
  return [c0, c1, c2, f32(1 - c0 - c1 - c2)];
}

// INTER_CUBIC（uint8）。端は端の画素をくり返す。OpenCV（pip の opencv-python 4.12）の結果は、float32 の係数で
// 浮動小数のまま補間して丸めた値に合う（11bit の固定小数点の版とは 2% の画素で 1 違った。こちらは 0.004%）
export function resizeCubicCV(src, w, h, c, nw, nh) {
  if (nw === w && nh === h) return src.slice();
  const sxF = 1 / (nw / w), syF = 1 / (nh / h);   // OpenCV と同じ計算
  const xofs = new Int32Array(nw), alpha = new Float64Array(nw * 4);
  for (let dx = 0; dx < nw; dx++) {
    const fx0 = f32((dx + 0.5) * sxF - 0.5);
    const sx = Math.floor(fx0);
    const cf = cubicCoeffs(f32(fx0 - sx));
    xofs[dx] = sx;
    for (let k = 0; k < 4; k++) alpha[dx * 4 + k] = cf[k];
  }
  // 横（行ごとに double で持つ）
  const hrow = (y) => {
    const row = new Float64Array(nw * c);
    for (let dx = 0; dx < nw; dx++) {
      for (let ch = 0; ch < c; ch++) {
        let v = 0;
        for (let k = 0; k < 4; k++) {
          const sx = Math.min(Math.max(xofs[dx] - 1 + k, 0), w - 1);
          v += src[(y * w + sx) * c + ch] * alpha[dx * 4 + k];
        }
        row[dx * c + ch] = v;
      }
    }
    return row;
  };
  const cache = new Map();
  const getRow = (y) => {
    let r = cache.get(y);
    if (!r) {
      r = hrow(y);
      cache.set(y, r);
      if (cache.size > 8) cache.delete(cache.keys().next().value);
    }
    return r;
  };
  const out = new Uint8Array(nw * nh * c);
  for (let dy = 0; dy < nh; dy++) {
    const fy0 = f32((dy + 0.5) * syF - 0.5);
    const sy = Math.floor(fy0);
    const b = cubicCoeffs(f32(fy0 - sy));
    const rows = [0, 1, 2, 3].map((k) => getRow(Math.min(Math.max(sy - 1 + k, 0), h - 1)));
    for (let i = 0; i < nw * c; i++) {
      const r = rint(rows[0][i] * b[0] + rows[1][i] * b[1] + rows[2][i] * b[2] + rows[3][i] * b[3]);
      out[dy * nw * c + i] = r < 0 ? 0 : r > 255 ? 255 : r;
    }
  }
  return out;
}

// INTER_AREA。縮めるときは面積の重みの平均（uint8 は丸め、float32 はそのまま）。
// 整数倍の縮小は、ブロックの平均（OpenCV の resizeAreaFast と同じ）。広げるときは OpenCV と同じく線形に近い補間
export function resizeAreaCV(src, w, h, c, nw, nh) {
  const isInt = src instanceof Uint8Array;
  const out = new src.constructor(nw * nh * c);
  if (nw === w && nh === h) {
    out.set(src);
    return out;
  }
  const put = (i, v) => { out[i] = isInt ? Math.min(255, Math.max(0, rint(v))) : v; };
  const sx = 1 / (nw / w), sy = 1 / (nh / h);   // OpenCV と同じ計算
  if (sx >= 1 && sy >= 1) {
    if (Math.abs(sx - Math.round(sx)) < Number.EPSILON && Math.abs(sy - Math.round(sy)) < Number.EPSILON) {
      const ix = Math.round(sx), iy = Math.round(sy);
      const area = ix * iy, scale = isInt ? 1 / area : f32(1 / area);
      for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) for (let ch = 0; ch < c; ch++) {
        let s = 0;
        for (let yy = 0; yy < iy; yy++) for (let xx = 0; xx < ix; xx++) s += src[((y * iy + yy) * w + x * ix + xx) * c + ch];
        put((y * nw + x) * c + ch, isInt ? s * scale : f32(f32(s) * scale));
      }
      return out;
    }
    // OpenCV の computeResizeAreaTab（重みは float32）
    const tab = (n, nn, s) => {
      const items = [];
      for (let d = 0; d < nn; d++) {
        const fs1 = d * s, fs2 = fs1 + s;
        const cellW = Math.min(s, n - fs1);
        let s2 = Math.min(Math.floor(fs2), n - 1);
        const s1 = Math.min(Math.ceil(fs1), s2);
        const parts = [];
        if (s1 - fs1 > 1e-3) parts.push([s1 - 1, f32((s1 - fs1) / cellW)]);
        for (let i = s1; i < s2; i++) parts.push([i, f32(1.0 / cellW)]);
        if (fs2 - s2 > 1e-3) parts.push([s2, f32(Math.min(Math.min(fs2 - s2, 1.0), cellW) / cellW)]);
        items.push(parts);
      }
      return items;
    };
    // OpenCV の ResizeArea_Invoker と同じく、行ごとに横の重みで足し（float32）、縦の重みを掛けて足す
    const tx = tab(w, nw, sx), ty = tab(h, nh, sy);
    const buf = new Float32Array(nw * c), sum = new Float32Array(nw * c);
    for (let y = 0; y < nh; y++) {
      sum.fill(0);
      for (const [yi, beta] of ty[y]) {
        buf.fill(0);
        const row = yi * w * c;
        for (let x = 0; x < nw; x++) {
          for (const [xi, alpha] of tx[x]) {
            for (let ch = 0; ch < c; ch++) buf[x * c + ch] = buf[x * c + ch] + f32(src[row + xi * c + ch] * alpha);
          }
        }
        for (let i = 0; i < nw * c; i++) sum[i] = sum[i] + f32(beta * buf[i]);
      }
      for (let i = 0; i < nw * c; i++) put(y * nw * c + i, sum[i]);
    }
    return out;
  }
  // 広げる: OpenCV の INTER_AREA の拡大（線形補間の係数を面積で決める）
  const coeffs = (n, nn, s) => {
    const ofs = new Int32Array(nn), a = new Float64Array(nn);
    const inv = 1 / s;
    for (let d = 0; d < nn; d++) {
      let sv = Math.floor(d * s);
      let fv = (d + 1) - (sv + 1) * inv;
      fv = fv <= 0 ? 0 : fv - Math.floor(fv);
      if (sv < 0) { fv = 0; sv = 0; }
      if (sv >= n - 1) { fv = 0; sv = n - 1; }
      ofs[d] = sv;
      a[d] = fv;
    }
    return { ofs, a };
  };
  const cx = coeffs(w, nw, sx), cy = coeffs(h, nh, sy);
  for (let y = 0; y < nh; y++) {
    const y0 = cy.ofs[y], y1 = Math.min(y0 + 1, h - 1), fy = cy.a[y];
    for (let x = 0; x < nw; x++) {
      const x0 = cx.ofs[x], x1 = Math.min(x0 + 1, w - 1), fx = cx.a[x];
      for (let ch = 0; ch < c; ch++) {
        const v = (src[(y0 * w + x0) * c + ch] * (1 - fx) + src[(y0 * w + x1) * c + ch] * fx) * (1 - fy)
          + (src[(y1 * w + x0) * c + ch] * (1 - fx) + src[(y1 * w + x1) * c + ch] * fx) * fy;
        put((y * nw + x) * c + ch, v);
      }
    }
  }
  return out;
}

// 右と下を、端の画素をくり返して nw × nh に広げる（numpy の pad(mode="edge")）
export function padEdge(src, w, h, c, nw, nh) {
  const out = new src.constructor(nw * nh * c);
  for (let y = 0; y < nh; y++) {
    const sy = Math.min(y, h - 1);
    for (let x = 0; x < nw; x++) {
      const sx = Math.min(x, w - 1);
      for (let ch = 0; ch < c; ch++) out[(y * nw + x) * c + ch] = src[(sy * w + sx) * c + ch];
    }
  }
  return out;
}

// ---------- 形の処理（OpenCV の dilate・erode・morphologyEx） ----------

// 形の要素を、行ごとの横の範囲 [dy, x0, x1]（中心からの位置、x0..x1 を含む）にしたもの
export function ellipseKernel(k) {
  const r = Math.floor(k / 2), c = Math.floor(k / 2);
  const invR2 = r ? 1 / (r * r) : 0;
  const out = [];
  for (let i = 0; i < k; i++) {
    const dy = i - r;
    if (Math.abs(dy) > r) continue;
    const dx = rint(c * Math.sqrt((r * r - dy * dy) * invR2));
    const j1 = Math.max(c - dx, 0), j2 = Math.min(c + dx + 1, k);
    if (j2 > j1) out.push([i - r, j1 - c, j2 - 1 - c]);
  }
  return out;
}

// np.ones((kh, kw)) の形の要素（中心は kh // 2, kw // 2。2x2 なら -1..0）
export function rectKernel(kw, kh = kw) {
  const ax = Math.floor(kw / 2), ay = Math.floor(kh / 2);
  const out = [];
  for (let i = 0; i < kh; i++) out.push([i - ay, -ax, kw - 1 - ax]);
  return out;
}

// 横の窓 [x + x0, x + x1] の最大（最小）。画像の外は見ない。c 個の色を別々に。
// van Herk / Gil-Werman の方法（窓の長さによらず 1 画素あたり定数回）
function rowExtreme(src, w, h, c, x0, x1, isMax) {
  const out = new src.constructor(src.length);
  const len = x1 - x0 + 1, n = w + len - 1;
  const b = new Float64Array(n), g = new Float64Array(n), r = new Float64Array(n);
  const fillV = isMax ? -Infinity : Infinity;
  for (let y = 0; y < h; y++) {
    for (let ch = 0; ch < c; ch++) {
      // b[i] は元の x = i + x0 の値。出力の x の窓は b[x .. x + len - 1]
      for (let i = 0; i < n; i++) {
        const sx = i + x0;
        b[i] = sx >= 0 && sx < w ? src[(y * w + sx) * c + ch] : fillV;
      }
      if (isMax) {
        for (let i = 0; i < n; i++) g[i] = i % len === 0 ? b[i] : Math.max(g[i - 1], b[i]);
        for (let i = n - 1; i >= 0; i--) r[i] = i % len === len - 1 || i === n - 1 ? b[i] : Math.max(r[i + 1], b[i]);
        for (let x = 0; x < w; x++) out[(y * w + x) * c + ch] = Math.max(r[x], g[x + len - 1]);
      } else {
        for (let i = 0; i < n; i++) g[i] = i % len === 0 ? b[i] : Math.min(g[i - 1], b[i]);
        for (let i = n - 1; i >= 0; i--) r[i] = i % len === len - 1 || i === n - 1 ? b[i] : Math.min(r[i + 1], b[i]);
        for (let x = 0; x < w; x++) out[(y * w + x) * c + ch] = Math.min(r[x], g[x + len - 1]);
      }
    }
  }
  return out;
}

// 形の要素 kernel（[dy, x0, x1] の並び）で広げる（dilate）か削る（erode）。画像の外は見ない
export function morph(src, w, h, c, kernel, op) {
  const isMax = op === "dilate";
  const byRange = new Map();
  for (const [, x0, x1] of kernel) {
    const key = `${x0},${x1}`;
    if (!byRange.has(key)) byRange.set(key, rowExtreme(src, w, h, c, x0, x1, isMax));
  }
  const out = new src.constructor(src.length);
  const acc = new Float64Array(w * c);
  for (let y = 0; y < h; y++) {
    acc.fill(isMax ? -Infinity : Infinity);
    for (const [dy, x0, x1] of kernel) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      const r = byRange.get(`${x0},${x1}`);
      const base = yy * w * c;
      if (isMax) { for (let i = 0; i < w * c; i++) if (r[base + i] > acc[i]) acc[i] = r[base + i]; }
      else { for (let i = 0; i < w * c; i++) if (r[base + i] < acc[i]) acc[i] = r[base + i]; }
    }
    for (let i = 0; i < w * c; i++) out[y * w * c + i] = acc[i];
  }
  return out;
}

export const dilate = (src, w, h, c, kernel) => morph(src, w, h, c, kernel, "dilate");
export const erode = (src, w, h, c, kernel) => morph(src, w, h, c, kernel, "erode");
export const opening = (src, w, h, c, kernel) => dilate(erode(src, w, h, c, kernel), w, h, c, kernel);

// 黒トップハット（閉じた画像 − 元の画像）。float32
export function blackhat(src, w, h, kernel) {
  const closed = erode(dilate(src, w, h, 1, kernel), w, h, 1, kernel);
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = closed[i] - src[i];
  return out;
}

// ---------- ぼかしと足し合わせ（float32） ----------

function reflect101(i, n) {
  if (n === 1) return 0;
  while (i < 0 || i >= n) i = i < 0 ? -i : 2 * n - 2 - i;
  return i;
}

// 縦横に分けた畳み込み（端は BORDER_REFLECT_101）
function sepFilter(src, w, h, kx, ky) {
  const rx = (kx.length - 1) >> 1, ry = (ky.length - 1) >> 1;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  const xi = Int32Array.from({ length: w + 2 * rx }, (_, i) => reflect101(i - rx, w));
  const yi = Int32Array.from({ length: h + 2 * ry }, (_, i) => reflect101(i - ry, h));
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = 0; k < kx.length; k++) s += src[row + xi[x + k]] * kx[k];
      tmp[row + x] = s;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = 0; k < ky.length; k++) s += tmp[yi[y + k] * w + x] * ky[k];
      out[y * w + x] = s;
    }
  }
  return out;
}

// cv2.GaussianBlur(src, (0, 0), sigma)（float32）。窓の大きさも OpenCV と同じ決め方
export function gaussianBlur32(src, w, h, sigma) {
  const n = rint(sigma * 4 * 2 + 1) | 1;
  const kern = new Float32Array(n);
  const s2 = -0.5 / (sigma * sigma);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const x = i - (n - 1) * 0.5;
    kern[i] = Math.exp(s2 * x * x);
    sum += kern[i];
  }
  sum = 1 / sum;
  for (let i = 0; i < n; i++) kern[i] = kern[i] * sum;
  return sepFilter(src, w, h, kern, kern);
}

// cv2.boxFilter(src, -1, (k, k), normalize=False)（float32、k = 2r + 1。和は double。端は BORDER_REFLECT_101）
export function boxSum32(src, w, h, r) {
  const tmp = new Float64Array(w * h), out = new Float32Array(w * h);
  const xi = Int32Array.from({ length: w + 2 * r }, (_, i) => reflect101(i - r, w));
  const yi = Int32Array.from({ length: h + 2 * r }, (_, i) => reflect101(i - r, h));
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = 0; k <= 2 * r; k++) s += src[row + xi[x + k]];
      tmp[row + x] = s;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = 0; k <= 2 * r; k++) s += tmp[yi[y + k] * w + x];
      out[y * w + x] = s;
    }
  }
  return out;
}

// ---------- つながり ----------

// つながった所に番号を付ける（0 は地）。conn8 が真なら斜めもつながる。番号は左上から見つけた順。
// {labels: Int32Array, n: かたまりの数} を返す
export function label(mask, w, h, conn8) {
  const labels = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let n = 0;
  for (let p = 0; p < w * h; p++) {
    if (!mask[p] || labels[p]) continue;
    n++;
    labels[p] = n;
    let top = 0;
    stack[top++] = p;
    while (top) {
      const q = stack[--top];
      const y = (q / w) | 0, x = q - y * w;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if ((!dy && !dx) || (!conn8 && dy && dx)) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const r = yy * w + xx;
          if (mask[r] && !labels[r]) { labels[r] = n; stack[top++] = r; }
        }
      }
    }
  }
  return { labels, n };
}

// skimage.filters.apply_hysteresis_threshold(s, low, high)。low は float64、high は float32 で比べる
// （Python のコードでの型の扱いに合わせる）。つながりは上下左右（4 方向）
export function hysteresis(s, w, h, low, high) {
  const hi = f32(high);
  const lowMask = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) lowMask[p] = s[p] > low ? 1 : 0;
  const { labels, n } = label(lowMask, w, h, false);
  const hit = new Uint8Array(n + 1);
  for (let p = 0; p < w * h; p++) if (s[p] > hi) hit[labels[p]] = 1;
  hit[0] = 0;
  const out = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) out[p] = hit[labels[p]];
  return out;
}

// skimage.morphology.remove_small_objects(mask, min_size, connectivity)
export function removeSmallObjects(mask, w, h, minSize, conn8 = true) {
  const { labels, n } = label(mask, w, h, conn8);
  const size = new Int32Array(n + 1);
  for (let p = 0; p < w * h; p++) size[labels[p]]++;
  const out = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) out[p] = labels[p] && size[labels[p]] >= minSize ? 1 : 0;
  return out;
}

// skimage.morphology.skeletonize（2次元。Zhang と Suen の方法を scikit-image の表で）
const SKEL_LUT = Uint8Array.from([
  0, 0, 0, 1, 0, 0, 1, 3, 0, 0, 3, 1, 1, 0, 1, 3, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 2, 0, 3, 0, 3, 3,
  0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 3, 0, 2, 2,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  2, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 3, 0, 2, 0,
  0, 0, 3, 1, 0, 0, 1, 3, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
  3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  2, 3, 1, 3, 0, 0, 1, 3, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  2, 3, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 0, 1, 0, 0, 0, 0, 2, 2, 0, 0, 2, 0, 0, 0,
]);

export function skeletonize(mask, w, h) {
  const W = w + 2, H = h + 2;
  let skel = new Uint8Array(W * H);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) skel[(y + 1) * W + x + 1] = mask[y * w + x] ? 1 : 0;
  const clean = skel.slice();
  // 調べる画素（線の画素）を並べておき、消えたものを落としていく
  let live = [];
  for (let p = 0; p < W * H; p++) if (skel[p]) live.push(p);
  let removed = true;
  while (removed) {
    removed = false;
    for (let pass = 0; pass < 2; pass++) {
      const first = pass === 0;
      for (let i = 0; i < live.length; i++) {
        const p = live[i];
        if (!skel[p]) continue;
        const nb = SKEL_LUT[skel[p - W - 1] + 2 * skel[p - W] + 4 * skel[p - W + 1] + 8 * skel[p + 1]
          + 16 * skel[p + W + 1] + 32 * skel[p + W] + 64 * skel[p + W - 1] + 128 * skel[p - 1]];
        if (nb === 0) continue;
        if (nb === 3 || (nb === 1 && first) || (nb === 2 && !first)) {
          clean[p] = 0;
          removed = true;
        }
      }
      skel.set(clean);
    }
    live = live.filter((p) => skel[p]);
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = skel[(y + 1) * W + x + 1];
  return out;
}

// ---------- 凸包を塗る（cv2.convexHull と cv2.fillConvexPoly） ----------

// 点（[x, y] の並び）の凸包。反時計回り（y 下向きの座標で）
export function convexHull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// 8 方向につながる直線（Bresenham）
function line8(out, w, h, x0, y0, x1, y1) {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    if (x0 >= 0 && x0 < w && y0 >= 0 && y0 < h) out[y0 * w + x0] = 1;
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
}

// 凸多角形（整数の頂点）の中と縁を 1 にする。行ごとに左右の縁の x を四捨五入した間を塗り、縁の線も引く
export function fillConvexPoly(out, w, h, poly) {
  const n = poly.length;
  if (n === 0) return;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % n];
    line8(out, w, h, x0, y0, x1, y1);
  }
  if (n < 3) return;
  let ymin = Infinity, ymax = -Infinity;
  for (const [, y] of poly) { ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
  for (let y = Math.max(ymin, 0); y <= Math.min(ymax, h - 1); y++) {
    let xl = Infinity, xr = -Infinity;
    for (let i = 0; i < n; i++) {
      const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % n];
      if ((y < Math.min(y0, y1)) || (y > Math.max(y0, y1))) continue;
      if (y0 === y1) { xl = Math.min(xl, x0, x1); xr = Math.max(xr, x0, x1); continue; }
      const x = x0 + (x1 - x0) * (y - y0) / (y1 - y0);
      xl = Math.min(xl, x);
      xr = Math.max(xr, x);
    }
    if (xl > xr) continue;
    const a = Math.max(Math.floor(xl + 0.5), 0), b = Math.min(Math.floor(xr + 0.5), w - 1);
    for (let x = a; x <= b; x++) out[y * w + x] = 1;
  }
}

// ---------- そのほか ----------

// numpy の線形補間（_lerp。float32 の配列のとき float32 で計算する）
function lerp32(a, b, t) {
  const t32 = f32(t), diff = f32(b - a);
  return t32 >= 0.5 ? f32(b - f32(diff * f32(1 - t32))) : f32(a + f32(diff * t32));
}

// np.percentile(values, q)。values は float32 の配列（値は何でも）。結果も float32
export function percentile32(values, q) {
  const s = Float32Array.from(values).sort();
  const pos = (q / 100) * (s.length - 1);
  const lo = Math.floor(pos);
  if (lo + 1 >= s.length) return s[s.length - 1];
  return lerp32(s[lo], s[lo + 1], pos - lo);
}

// np.percentile(values, q)。values は 0..255 の整数の配列（float32 として扱う）。数え上げで求める
export function percentileU8(values, q) {
  const hist = new Float64Array(256);
  for (let i = 0; i < values.length; i++) hist[values[i]]++;
  const at = (k) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > k) return v; }
    return 255;
  };
  const pos = (q / 100) * (values.length - 1);
  const lo = Math.floor(pos);
  return lerp32(at(lo), at(Math.min(lo + 1, values.length - 1)), pos - lo);
}
