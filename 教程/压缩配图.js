/* 把 教程/截图/*.png 用浏览器 canvas 压成宽 1200 的 JPEG，并产出 base64 清单
 * 输出：教程/截图精简/<name>.jpg + 教程/配图清单.json */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SRC = path.join(ROOT, '教程/截图');
const DST = path.join(ROOT, '教程/截图精简');
const PROFILE = path.join(ROOT, '教程/.edge-profile-c');
const PORT = 9337;
const WIDTH = 1200, QUALITY = 0.82;

const sleep = ms => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0; this.pending = new Map();
    this.ready = new Promise((res, rej) => { this.ws.onopen = () => res(); this.ws.onerror = () => rej(new Error('WS 失败')); });
    this.ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      }
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
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result && r.result.value;
  }
}

(async () => {
  fs.mkdirSync(DST, { recursive: true });
  if (fs.existsSync(PROFILE)) fs.rmSync(PROFILE, { recursive: true, force: true });
  const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + PORT, 'about:blank'], { stdio: 'ignore' });
  process.on('exit', () => { try { edge.kill(); } catch (e) { } });

  for (let i = 0; i < 60; i++) {
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) break; } catch (e) { }
    await sleep(300);
  }
  const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
  const cdp = new CDP(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const files = fs.readdirSync(SRC).filter(f => f.endsWith('.png')).sort();
  const manifest = {};
  for (const f of files) {
    const raw = fs.readFileSync(path.join(SRC, f)).toString('base64');
    const dataUrl = 'data:image/png;base64,' + raw;
    const out = await cdp.eval(`(async () => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('decode fail')); img.src = ${JSON.stringify(dataUrl)}; });
      const scale = Math.min(1, ${WIDTH} / img.naturalWidth);
      const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      return { url: c.toDataURL('image/jpeg', ${QUALITY}), w, h };
    })()`);
    const b64 = out.url.split(',')[1];
    const name = f.replace(/\.png$/, '');
    fs.writeFileSync(path.join(DST, name + '.jpg'), Buffer.from(b64, 'base64'));
    manifest[name] = { w: out.w, h: out.h, jpg: path.join(DST, name + '.jpg'), b64len: b64.length };
    console.log('✓', name, `${out.w}x${out.h}`, (b64.length / 1024).toFixed(0) + 'KB(b64)');
  }
  fs.writeFileSync(path.join(ROOT, '教程/配图清单.json'), JSON.stringify(manifest, null, 2), 'utf8');
  const total = Object.values(manifest).reduce((s, m) => s + m.b64len, 0);
  console.log('总计 base64', (total / 1024 / 1024).toFixed(2) + 'MB');
  edge.kill();
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
