/* 截图：设置 → 数据管理（分区改造效果，桌面版真实窗口 + 网页版窄屏）
 * 运行：node desktop/截图-数据管理.js
 * 输出：%TEMP%/mtk-dm/*.png
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const DESKTOP = path.join(ROOT, 'desktop');
const ELECTRON = path.join(DESKTOP, 'node_modules/electron/dist/electron.exe');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTML_URL = 'file:///' + encodeURI(ROOT + '/模拟题库-Web版.html').replace(/#/g, '%23');
const OUT = path.join(os.tmpdir(), 'mtk-dm');
const EDGE_PROFILE = path.join(ROOT, '教程/.edge-profile-dm');
const sleep = ms => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0; this.pending = new Map(); this.errors = [];
    this.ready = new Promise((res, rej) => { this.ws.onopen = () => res(); this.ws.onerror = () => rej(new Error('ws fail')); });
    this.ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      } else if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        this.errors.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
      }
    };
  }
  async send(method, params = {}) {
    await this.ready; const id = ++this.id;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error((d.exception && (d.exception.description || d.exception.value)) || d.text);
    }
    return r.result && r.result.value;
  }
  close() { try { this.ws.close(); } catch (e) { } }
}

async function waitJson(url, tries = 100) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch (e) { }
    await sleep(300);
  }
  throw new Error('等不到 ' + url);
}

async function shotCard(cdp, name) {
  const box = await cdp.eval(`(async()=>{
    go('set'); await new Promise(r=>setTimeout(r,500));
    const card = [...document.querySelectorAll('#view .card')].find(c=>/数据管理/.test(c.querySelector('h3')?.textContent||''));
    if (!card) return null;
    card.scrollIntoView({block:'center'});
    await new Promise(r=>setTimeout(r,450));
    const r = card.getBoundingClientRect();
    return { x:r.left+scrollX-12, y:r.top+scrollY-12, w:r.width+24, h:r.height+24 };
  })()`);
  if (!box) throw new Error('找不到数据管理卡片');
  const s = await cdp.send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true,
    clip: { x: box.x, y: box.y, width: box.w, height: box.h, scale: 2 }
  });
  const p = path.join(OUT, name + '.png');
  fs.writeFileSync(p, Buffer.from(s.data, 'base64'));
  return p;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;

  /* ---------- 1) 桌面版（含「数据文件位置」分区） ---------- */
  const elec = spawn(ELECTRON, [DESKTOP, '--remote-debugging-port=9333'], { env, stdio: 'ignore' });
  let c;
  try {
    await waitJson('http://127.0.0.1:9333/json/version');
    await sleep(1200);
    const list = await waitJson('http://127.0.0.1:9333/json/list');
    const page = (Array.isArray(list) ? list : list.targetInfos || []).find(t => t.type === 'page');
    c = new CDP(page.webSocketDebuggerUrl);
    await c.send('Page.enable'); await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1480, height: 940, deviceScaleFactor: 1, mobile: false });
    await sleep(1500);
    console.log('桌面版 ->', await shotCard(c, '1-数据管理-桌面'));
    const st = await c.eval(`(()=>{
      const card=[...document.querySelectorAll('#view .card')].find(c=>/数据管理/.test(c.querySelector('h3')?.textContent||''));
      const secs=[...card.querySelectorAll('.dm-sec')].map(s=>({h:s.querySelector('.dm-sec-h')?.textContent.trim().slice(0,6), n:s.querySelectorAll('.dm-btn').length}));
      return { secs, btns: card.querySelectorAll('.dm-btn').length };
    })()`);
    console.log('分区：', JSON.stringify(st, null, 0));
    if (c.errors.length) console.log('JS 异常：', c.errors.slice(0, 3));
  } catch (e) {
    console.error('桌面版失败:', e.message);
  } finally {
    c && c.close(); try { elec.kill(); } catch (e) { }
  }

  /* ---------- 2) 网页版（含「手机 / 平板」分区 + 手机窄屏） ---------- */
  fs.rmSync(EDGE_PROFILE, { recursive: true, force: true });
  fs.mkdirSync(EDGE_PROFILE, { recursive: true });
  const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
    '--user-data-dir=' + EDGE_PROFILE, '--remote-debugging-port=9334', '--window-size=1480,960', 'about:blank'], { stdio: 'ignore' });
  let c2;
  try {
    await waitJson('http://127.0.0.1:9334/json/version');
    const list = await waitJson('http://127.0.0.1:9334/json/list');
    const page = (Array.isArray(list) ? list : list.targetInfos || []).find(t => t.type === 'page');
    c2 = new CDP(page.webSocketDebuggerUrl);
    await c2.send('Page.enable'); await c2.send('Runtime.enable');
    await c2.send('Emulation.setDeviceMetricsOverride', { width: 1480, height: 940, deviceScaleFactor: 1, mobile: false });
    await c2.send('Page.navigate', { url: HTML_URL }); await sleep(3200);
    console.log('网页版 ->', await shotCard(c2, '2-数据管理-网页'));

    await c2.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await sleep(800);
    /* 窄屏直接滚到卡片截视口（clip 在 mobile 模拟下会偏移） */
    await c2.eval(`(async()=>{ go('set'); await new Promise(r=>setTimeout(r,500));
      const card=[...document.querySelectorAll('#view .card')].find(c=>/数据管理/.test(c.querySelector('h3')?.textContent||''));
      card.scrollIntoView({block:'start'}); await new Promise(r=>setTimeout(r,400)); })()`);
    const s3 = await c2.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, '3-数据管理-手机.png'), Buffer.from(s3.data, 'base64'));
    console.log('手机窄屏 ->', path.join(OUT, '3-数据管理-手机.png'));
    if (c2.errors.length) console.log('JS 异常：', c2.errors.slice(0, 3));
  } catch (e) {
    console.error('网页版失败:', e.message);
  } finally {
    c2 && c2.close(); try { edge.kill(); } catch (e) { }
  }
  console.log('输出目录：' + OUT);
})();
