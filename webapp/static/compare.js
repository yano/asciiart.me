// 候補を並べて見比べる部品。
// 左に候補の全体の図を並べ、図の上にマウスを置くと、その候補のその所を右に等倍で表示する。
// 図を押すと表示する位置を止めるので、ほかの候補の図にマウスを移すと、同じ所を見比べられる。
// 候補ごとに大きさが違ってもよい（位置は図の幅・高さに対する割合で持つ）。

export class Compare {
  // root: 部品を入れる要素。onChoose(key): 「これにする」が押されたとき
  constructor(root, { onChoose }) {
    this.root = root;
    this.onChoose = onChoose;
    this.items = [];
    this.active = null;
    this.u = 0.5;           // 表示している所の中心（図の幅に対する割合）
    this.v = 0.35;
    this.pinned = false;
    this.zoom = "1";
    root.classList.add("compare");
    root.innerHTML = `
      <div class="thumbs"></div>
      <div class="loupe">
        <div class="loupebar">
          <b class="lname"></b><span class="lnote"></span>
          <button class="lpin ghost" hidden title="押すと、マウスに合わせて動くようになります">位置を止めています ✕</button>
          <span class="spacer"></span>
          <span class="seg lzoom" role="radiogroup" aria-label="拡大"><button data-v="1">等倍</button><button data-v="2">2倍</button></span>
          <button class="primary lgo">これにする</button>
        </div>
        <div class="lwrap"><canvas class="lcanvas"></canvas><div class="lwait" hidden>作っています…</div></div>
      </div>`;
    this.thumbs = root.querySelector(".thumbs");
    this.canvas = root.querySelector(".lcanvas");
    this.wrap = root.querySelector(".lwrap");
    root.querySelector(".lgo").addEventListener("click", () => this.chooseActive());
    root.querySelector(".lpin").addEventListener("click", () => this.setPinned(false));
    root.querySelector(".lzoom").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (b) { this.zoom = b.dataset.v; this.drawLoupe(); }
    });
    new ResizeObserver(() => this.fitLoupe()).observe(this.wrap);
    this.setupPan();
  }

  // items: [{key, title, note, width, height, chooseable, canvas?, time?}]
  setItems(items, active = null) {
    this.items = items.map((it) => ({ ...it }));
    this.thumbs.textContent = "";
    for (const it of this.items) this.thumbs.append(this.makeCard(it));
    this.active = active ?? (this.items.find((it) => it.chooseable) || this.items[0] || {}).key ?? null;
    this.refresh();
  }

  item(key) {
    return this.items.find((it) => it.key === key);
  }

  // 候補ができたとき（canvas は全体を等倍で描いたもの）
  update(key, fields) {
    const it = this.item(key);
    if (!it) return;
    Object.assign(it, fields);
    this.fillCard(it);
    this.drawThumb(it);
    if (key === this.active) this.drawLoupe();
  }

  // すべて描き直す（表示フォントを変えたときなど）
  refresh() {
    for (const it of this.items) {
      this.fillCard(it);
      this.drawThumb(it);
    }
    this.fitLoupe();
  }

  makeCard(it) {
    const card = document.createElement("div");
    card.className = "ccard";
    card.innerHTML = '<div class="chead"><span class="cname"></span><span class="ctime"></span></div>'
      + '<div class="cnote"></div>'
      + '<div class="cthumb"><canvas></canvas><div class="cview" hidden></div><div class="cwait">作っています…</div></div>'
      + '<button class="cgo">これにする</button>';
    it.card = card;
    it.thumb = card.querySelector(".cthumb canvas");
    it.view = card.querySelector(".cview");
    const box = card.querySelector(".cthumb");
    const at = (e) => {
      const r = box.getBoundingClientRect();
      return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
              Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
    };
    box.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return;
      this.active = it.key;
      if (!this.pinned) [this.u, this.v] = at(e);
      this.drawLoupe();
    });
    box.addEventListener("click", (e) => {
      this.active = it.key;
      [this.u, this.v] = at(e);
      this.setPinned(e.pointerType === "touch" ? true : !this.pinned);
    });
    box.addEventListener("dblclick", () => {
      if (it.chooseable && it.canvas) this.onChoose(it.key);
    });
    card.querySelector(".cgo").addEventListener("click", () => {
      if (it.chooseable && it.canvas) this.onChoose(it.key);
    });
    this.fillCard(it);
    return card;
  }

  fillCard(it) {
    const card = it.card;
    card.querySelector(".cname").textContent = it.title;
    card.querySelector(".cnote").textContent = it.note || "";
    card.querySelector(".ctime").textContent = it.time || "";
    card.querySelector(".cwait").hidden = !!it.canvas;
    const go = card.querySelector(".cgo");
    go.hidden = !it.chooseable;
    go.disabled = !it.canvas;
    card.classList.toggle("active", it.key === this.active);
  }

  drawThumb(it) {
    const c = it.thumb;
    const dpr = window.devicePixelRatio || 1;
    const cssW = c.parentElement.clientWidth || 200;
    const cssH = Math.round((cssW * it.height) / it.width);
    c.style.height = `${cssH}px`;
    c.width = Math.max(1, Math.round(cssW * dpr));
    c.height = Math.max(1, Math.round(cssH * dpr));
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    if (!it.canvas) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(it.canvas, 0, 0, it.canvas.width, it.canvas.height,
                  0, 0, (c.width * it.canvas.width) / it.width, (c.height * it.canvas.height) / it.height);
  }

  setPinned(on) {
    this.pinned = on;
    this.root.querySelector(".lpin").hidden = !on;
    this.root.classList.toggle("pinned", on);
    this.drawLoupe();
  }

  fitLoupe() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.wrap.clientWidth;
    const h = this.wrap.clientHeight;
    if (!w || !h) return;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.drawLoupe();
  }

  // 1 画素を何画素で描くか（画面の画素で）。等倍は、画面の拡大率に近い整数
  scaleK() {
    const k = Math.max(1, Math.round(window.devicePixelRatio || 1));
    return this.zoom === "2" ? 2 * k : k;
  }

  drawLoupe() {
    for (const b of this.root.querySelectorAll(".lzoom button")) b.setAttribute("aria-checked", String(b.dataset.v === this.zoom));
    for (const it of this.items) it.card && it.card.classList.toggle("active", it.key === this.active);
    const it = this.item(this.active);
    this.root.querySelector(".lname").textContent = it ? it.title : "";
    this.root.querySelector(".lnote").textContent = it ? it.note || "" : "";
    const go = this.root.querySelector(".lgo");
    go.hidden = !it || !it.chooseable;
    go.disabled = !it || !it.canvas;
    this.root.querySelector(".lwait").hidden = !it || !!it.canvas;
    const c = this.canvas;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    if (!it) return;
    const k = this.scaleK();
    const vw = c.width / k;
    const vh = c.height / k;
    const place = (center, size, view) => (size <= view ? (size - view) / 2 : Math.min(Math.max(center - view / 2, 0), size - view));
    const sx = Math.round(place(this.u * it.width, it.width, vw));
    const sy = Math.round(place(this.v * it.height, it.height, vh));
    this.viewRect = { x: sx / it.width, y: sy / it.height, w: vw / it.width, h: vh / it.height };
    if (it.canvas) {
      ctx.imageSmoothingEnabled = false;
      const x0 = Math.max(0, sx);
      const y0 = Math.max(0, sy);
      const x1 = Math.min(it.canvas.width, sx + vw);
      const y1 = Math.min(it.canvas.height, sy + vh);
      if (x1 > x0 && y1 > y0) {
        ctx.drawImage(it.canvas, x0, y0, x1 - x0, y1 - y0, (x0 - sx) * k, (y0 - sy) * k, (x1 - x0) * k, (y1 - y0) * k);
      }
    }
    this.drawViews();
  }

  // 全体の図に、いま表示している所の枠を描く
  drawViews() {
    const r = this.viewRect;
    for (const it of this.items) {
      if (!it.view) continue;
      if (!r || !it.canvas) { it.view.hidden = true; continue; }
      const x = Math.max(0, r.x), y = Math.max(0, r.y);
      const w = Math.min(1, r.x + r.w) - x, h = Math.min(1, r.y + r.h) - y;
      it.view.hidden = w <= 0 || h <= 0;
      Object.assign(it.view.style, { left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` });
    }
  }

  // 右の表示をつかんで動かす
  setupPan() {
    let last = null;
    this.canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      last = [e.clientX, e.clientY];
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!last) return;
      const it = this.item(this.active);
      if (!it) return;
      const perPx = this.scaleK() / (window.devicePixelRatio || 1);     // 図の 1px が画面の何 CSS px か
      this.u -= (e.clientX - last[0]) / perPx / it.width;
      this.v -= (e.clientY - last[1]) / perPx / it.height;
      this.u = Math.min(1, Math.max(0, this.u));
      this.v = Math.min(1, Math.max(0, this.v));
      last = [e.clientX, e.clientY];
      if (!this.pinned) this.setPinned(true);
      else this.drawLoupe();
    });
    const end = () => { last = null; };
    this.canvas.addEventListener("pointerup", end);
    this.canvas.addEventListener("pointercancel", end);
  }

  // 次（d=1）・前（d=-1）の候補を表示する（できているものだけ）
  step(d) {
    const ready = this.items.filter((it) => it.canvas);
    if (!ready.length) return;
    const i = ready.findIndex((it) => it.key === this.active);
    this.active = ready[(i + d + ready.length) % ready.length].key;
    this.drawLoupe();
  }

  chooseActive() {
    const it = this.item(this.active);
    if (it && it.chooseable && it.canvas) this.onChoose(it.key);
  }
}
