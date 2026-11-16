// 当てはめ（v2）の行を、いくつかの Worker（cost_worker.js）に分けて求める。
// 行はそれぞれ独立なので、行のまとまりごとに別の Worker で求めてつなぐ（結果は 1 つで求めたときと同じ）。

import { band } from "./cost.js";

let nextKey = 1;
const keys = new WeakMap();
const keyOf = (glyphs) => {
  if (!keys.has(glyphs)) keys.set(glyphs, nextKey++);
  return keys.get(glyphs);
};

export class Pool {
  constructor(n) {
    this.waiting = new Map();
    this.seq = 0;
    this.workers = [];
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL("./cost_worker.js", import.meta.url), { type: "module" });
      w.onmessage = ({ data }) => this._reply(w, data);
      w.onerror = (ev) => {
        for (const [id, job] of this.waiting) {
          if (job.worker === w) { job.reject(new Error(`当てはめの Worker が止まりました（${ev.message || ""}）`)); this.waiting.delete(id); }
        }
      };
      this.workers.push(w);
    }
  }

  // 使う Worker の数（論理コアの数 - 1。多すぎるとメモリを使うので 6 まで）
  static size() {
    return Math.max(1, Math.min(6, (globalThis.navigator?.hardwareConcurrency || 4) - 1));
  }

  _reply(w, data) {
    const job = this.waiting.get(data.id);
    if (!job) return;
    if (data.need !== undefined) {
      // 辞書を持っていなかった: 送ってからもう一度
      w.postMessage({ glyphs: job.glyphsData() });
      w.postMessage(job.message);
      return;
    }
    this.waiting.delete(data.id);
    if (data.error) job.reject(new Error(data.error));
    else job.resolve(data);
  }

  _run(w, glyphs, ctx) {
    const key = keyOf(glyphs);
    const id = ++this.seq;
    const message = { id, key, ctx };
    const glyphsData = () => ({ key, chars: glyphs.chars, widths: glyphs.widths, bitmaps: glyphs.bitmaps });
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { worker: w, resolve, reject, message, glyphsData });
      w.postMessage(message);
    });
  }

  // cost.js の prepare の ctx から、全部の行の並びを求める。{picked, lines, totals}（match.js の matchCost と同じ形）
  async match(ctx, glyphs) {
    const k = Math.min(this.workers.length, ctx.rows);
    const per = Math.ceil(ctx.rows / k);
    const jobs = [];
    for (let i = 0; i < k; i++) {
      const r0 = i * per, r1 = Math.min(ctx.rows, r0 + per);
      if (r0 >= r1) break;
      jobs.push(this._run(this.workers[i], glyphs, band(ctx, r0, r1)));
    }
    const parts = await Promise.all(jobs);
    const picked = parts.flatMap((p) => p.picked);
    const totals = parts.flatMap((p) => p.totals);
    const lines = picked.map((row) => row.map((g) => glyphs.chars[g]).join(""));
    return { picked, lines, totals };
  }
}
