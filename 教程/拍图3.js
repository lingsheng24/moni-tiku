/* 只重拍 03（AI 生成题目）与 13（系统设置）两张 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTML_URL = 'file:///' + encodeURI(ROOT + '/模拟题库-Web版.html').replace(/#/g, '%23');
const OUT = path.join(ROOT, '教程/截图');
const PROFILE = path.join(ROOT, '教程/.edge-profile');
const PORT = 9336;
const W = 1480, H = 940, DPR = 2;
const sleep = ms => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0; this.pending = new Map(); this.handlers = [];
    this.ready = new Promise((res, rej) => { this.ws.onopen = () => res(); this.ws.onerror = () => rej(new Error('WS 失败')); });
    this.ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      } else this.handlers.forEach(h => h(m));
    };
  }
  async send(method, params = {}) {
    await this.ready; const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('页面脚本异常: ' + (d.exception && (d.exception.description || d.exception.value) || d.text));
    }
    return r.result && r.result.value;
  }
  close() { try { this.ws.close(); } catch (e) { } }
}

(async () => {
  if (fs.existsSync(PROFILE)) fs.rmSync(PROFILE, { recursive: true, force: true });
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--disable-sync',
    '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + PORT,
    '--window-size=' + W + ',' + H, 'about:blank',
  ], { stdio: 'ignore' });
  const cleanup = () => { try { edge.kill(); } catch (e) { } };
  process.on('exit', cleanup);
  try {
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) break; } catch (e) { }
      await sleep(300);
    }
    const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
    const cdp = new CDP(list.find(t => t.type === 'page').webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
    const loaded = new Promise(res => {
      const h = m => { if (m.method === 'Page.loadEventFired') { cdp.handlers = cdp.handlers.filter(x => x !== h); res(); } };
      cdp.handlers.push(h);
    });
    await cdp.send('Page.navigate', { url: HTML_URL });
    await loaded;
    await sleep(3000);
    const seed = fs.readFileSync(path.join(ROOT, '教程/种子数据.js'), 'utf8');
    console.log('种子:', await cdp.eval(seed));
    await sleep(800);
    const snap = async (name, wait = 1100) => {
      await sleep(wait);
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
      console.log('✓', name + '.png');
    };
    await cdp.eval(`go('gen')`);
    await snap('03-AI生成题目');
    await cdp.eval(`go('set')`);
    await snap('13-系统设置');
    console.log('重拍完成');
  } finally {
    cleanup();
    await sleep(400);
  }
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
