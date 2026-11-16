// 2値の細い線（1px 幅）の、各画素での線の向き。aame/orient.py を JavaScript に移したもの。
//
// 各画素について、まわり (2R+1)x(2R+1) の中でその画素とつながっている線の画素を集め、
// その並びの主軸を向きとする。点（つながった画素が隣にしか無い）と、角や交点（並びが
// 一方向にそろっていない）は「向きなし」。

const RADIUS = 3;
const MIN_COH = 0.5;
const f32 = Math.fround;

// 窓の中の位置。輪（中心からのチェビシェフ距離 r）の内側から順に並べ、
// r が 2 以上のものには、1つ内側の輪で隣り合う位置の番号（adj）を持たせる
const OFFS = (() => {
  const out = [];
  const ring = (r) => {
    const a = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dy), Math.abs(dx)) === r) a.push([dy, dx]);
    }
    return a;
  };
  let prev = [];
  for (let r = 1; r <= RADIUS; r++) {
    const cur = [];
    for (const [dy, dx] of ring(r)) {
      const adj = r === 1 ? [] : prev.filter((i) => Math.max(Math.abs(out[i].dy - dy), Math.abs(out[i].dx - dx)) === 1);
      cur.push(out.length);
      out.push({ dy, dx, r, adj: Int32Array.from(adj) });
    }
    prev = cur;
  }
  return out;
})();

// numpy の rint（半分は偶数へ）
export function rint(v) {
  const r = Math.round(v);
  return Math.abs(v - Math.trunc(v)) === 0.5 ? 2 * Math.round(v / 2) : r;
}

// 各画素の向きを nBins 等分した番号（0..nBins-1）。向きなしは -1。線の無い画素は -2。
// mask は Uint8Array（h × w、1 が線）。
export function bins(mask, h, w, nBins = 8) {
  const out = new Int8Array(h * w).fill(-2);
  const joined = new Uint8Array(OFFS.length);
  const step = f32(Math.PI / nBins);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      let mxx = 0, myy = 0, mxy = 0, reach = false;
      for (let i = 0; i < OFFS.length; i++) {
        const o = OFFS[i];
        const yy = y + o.dy, xx = x + o.dx;
        let v = yy >= 0 && yy < h && xx >= 0 && xx < w ? mask[yy * w + xx] : 0;
        if (v && o.r > 1) {
          v = 0;
          for (let q = 0; q < o.adj.length; q++) if (joined[o.adj[q]]) { v = 1; break; }
        }
        joined[i] = v;
        if (v) {
          mxx += o.dx * o.dx;
          myy += o.dy * o.dy;
          mxy += o.dx * o.dy;
          if (o.r >= 2) reach = true;
        }
      }
      // aame/orient.py と同じく float32 で求める
      const c = mxx - myy, s = 2 * mxy;
      const mag = f32(Math.hypot(c, s));
      const coh = reach ? f32(mag / f32(mxx + myy + 1e-9)) : 0;
      if (coh < MIN_COH) {
        out[y * w + x] = -1;
        continue;
      }
      const den = f32(mag + 1e-9);
      const theta = f32(0.5 * f32(Math.atan2(f32(s / den), f32(c / den))));
      const b = rint(f32(theta / step));
      out[y * w + x] = ((b % nBins) + nBins) % nBins;
    }
  }
  return out;
}
