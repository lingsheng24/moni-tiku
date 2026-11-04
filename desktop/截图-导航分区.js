/* 截图：导航栏功能分区效果（展开态特写 / 整窗 / 折叠态图标条）
 * 运行：node desktop/截图-导航分区.js
 * 输出：%TEMP%/mtk-navgroup/*.png
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTML_URL = 'file:///' + encodeURI(ROOT + '/模拟题库-Web版.html').replace(/#/g, '%23');
const PORT = 9394;
const PROFILE = path.join(ROOT, '教程/.edge-profile-navgrp');
const OUT = path.join(os.tmpdir(), 'mtk-navgroup');
const sleep = ms => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0; this.pending = new Map(); this.logs = [];
    this.ready = new Promise((res, rej) => { this.ws.onopen = () => res(); this.ws.onerror = () => rej(new Error('ws fail')); });
    this.ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      } else if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        this.logs.push('[exception] ' + (d.exception && (d.exception.description || d.exception.value) || d.text));
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

async function waitJson(url, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch (e) { }
    await sleep(300);
  }
  throw new Error('等不到 ' + url);
}

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(PROFILE, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-sync', '--disable-features=Translate,MediaRouter',
    '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + PORT, '--window-size=1440,980', 'about:blank',
  ], { stdio: 'ignore' });
  let cdp;
  const cleanup = () => { try { cdp && cdp.close(); } catch (e) { } try { edge.kill(); } catch (e) { } };
  process.on('exit', cleanup);

  try {
    await waitJson('http://127.0.0.1:' + PORT + '/json/version');
    const list = await waitJson('http://127.0.0.1:' + PORT + '/json/list');
    const page = (Array.isArray(list) ? list : list.targetInfos || []).find(t => t.type === 'page');
    cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 2, mobile: false });
    await cdp.send('Page.navigate', { url: HTML_URL });
    await sleep(3000);

    const shot = async (name, clip) => {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    };

    // 结构自检：每组几项、标题文案
    const struct = await cdp.eval(`(()=> [...document.querySelectorAll('.sidebar .nav-group')].map(g => ({
      g: g.dataset.g,
      title: (g.querySelector('.nav-group-title') || {}).textContent || '(无标题)',
      items: [...g.querySelectorAll('.nav-item')].map(n => n.dataset.v).join(','),
    })))()`);
    console.log('分区结构：', JSON.stringify(struct, null, 0));

    const sw = await cdp.eval(`(()=>{ const r = document.querySelector('.sidebar').getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; })()`);
    await shot('1-导航栏分区', { x: sw.x, y: sw.y, width: sw.w, height: sw.h, scale: 2 });
    await shot('2-整窗效果');

    // 折叠态
    await cdp.eval(`(async()=>{ state.settings.navCollapsed = 1; applyNavWidth(); return true; })()`);
    await sleep(500);
    const sw2 = await cdp.eval(`(()=>{ const r = document.querySelector('.sidebar').getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; })()`);
    await shot('3-折叠态', { x: sw2.x, y: sw2.y, width: 200, height: Math.min(760, sw2.h), scale: 2 });

    // 排序兼容性：模拟保存顺序后重排，检查是否仍在各自分区
    const sortTest = await cdp.eval(`(async()=>{
      const before = [...document.querySelectorAll('.sidebar .nav-item')].map(n=>n.dataset.v);
      state.settings.navOrder = ['review','mist','exam','practice','kb','kp','bank','gen','docs','help','set','stats','dash'];
      applyNavOrder();
      const after = [...document.querySelectorAll('.sidebar .nav-group')].map(g=>g.dataset.g+':'+[...g.querySelectorAll('.nav-item')].map(n=>n.dataset.v).join('>'));
      state.settings.navOrder = []; applyNavOrder();
      return { before: before.join(','), after };
    })()`);
    console.log('组内排序测试：', JSON.stringify(sortTest));

    console.log('截图目录：' + OUT);
    if (cdp.logs.length) console.log('异常：', cdp.logs.slice(0, 3));
  } catch (e) {
    console.log('❌ 中断：', e && (e.stack || e.message));
    process.exitCode = 1;
  } finally {
    cleanup();
    setTimeout(() => process.exit(process.exitCode || 0), 200);
  }
})();
