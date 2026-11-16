// 最小の DevTools プロトコルのクライアント。ヘッドレスの Edge を起動して操作する。
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ width = 1600, height = 1000, scale = 1, port = 9333, headless = true } = {}) {
  const profile = mkdtempSync(join(tmpdir(), "edge-cdp-"));
  const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run",
    "--no-default-browser-check", `--window-size=${width},${height}`, `--force-device-scale-factor=${scale}`,
    "--disable-gpu", "--hide-scrollbars", "about:blank"];
  if (headless) args.unshift("--headless");
  const proc = spawn(EDGE, args, { stdio: "ignore" });
  let info;
  for (let i = 0; i < 100; i++) {
    try { info = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (info.length) break; } catch (e) {}
    await sleep(200);
  }
  const page = info.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let next = 1;
  const waiting = new Map();
  const listeners = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) {
      const { resolve, reject } = waiting.get(msg.id);
      waiting.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) {
      for (const l of listeners) l(msg);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = next++;
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error("cdp timeout: " + method)); }, 60000);
    waiting.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const api = {
    send,
    on: (fn) => listeners.push(fn),
    async eval(expr) {
      const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    },
    async waitFor(expr, timeout = 120000) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        if (await api.eval(expr)) return true;
        await sleep(250);
      }
      throw new Error("timeout: " + expr);
    },
    async shot(path, clip) {
      const r = await send("Page.captureScreenshot", clip ? { format: "png", clip: { ...clip, scale: 1 } } : { format: "png" });
      writeFileSync(path, Buffer.from(r.data, "base64"));
    },
    async goto(url) {
      await send("Page.navigate", { url });
      await api.waitFor("document.readyState === 'complete'");
    },
    async mouse(type, x, y, buttons = 1) {
      await send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1, pointerType: "mouse" });
    },
    async drag(points) {
      await api.mouse("mouseMoved", points[0][0], points[0][1], 0);
      await api.mouse("mousePressed", points[0][0], points[0][1]);
      for (const [x, y] of points.slice(1)) { await api.mouse("mouseMoved", x, y); await sleep(10); }
      const [x, y] = points[points.length - 1];
      await api.mouse("mouseReleased", x, y, 0);
    },
    async setFile(selector, path) {
      const doc = await send("DOM.getDocument");
      const { nodeId } = await send("DOM.querySelector", { nodeId: doc.root.nodeId, selector });
      await send("DOM.setFileInputFiles", { nodeId, files: [path] });
    },
    async downloadsTo(dir) {
      mkdirSync(dir, { recursive: true });
      await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dir });
    },
    async close() {
      try { await send("Browser.close"); } catch (e) {}
      proc.kill();
    },
  };
  await send("Page.enable");
  await send("Runtime.enable");
  return api;
}
