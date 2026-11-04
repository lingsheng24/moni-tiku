/* 截图：知识库卡片折叠按钮（折叠态 / 展开态）
 * 运行：node desktop/截图-知识库折叠.js
 * 输出：%TEMP%/mtk-kbfold/*.png
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTML_URL = 'file:///' + encodeURI(ROOT + '/模拟题库-Web版.html').replace(/#/g, '%23');
const PORT = 9395;
const PROFILE = path.join(ROOT, '教程/.edge-profile-kbfold');
const OUT = path.join(os.tmpdir(), 'mtk-kbfold');
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

    // 种三条知识库手记（隔离 profile，不动真实题库）
    await cdp.eval(`(async()=>{
      state.kbNotes = [
        { id: 't1', text: '名义 GDP 与实际 GDP 的区别：名义值按当期价格计算，实际值按基期不变价格计算，两者之比即为 GDP 平减指数。考试里常考「平减指数上涨意味着什么」。', at: Date.now() - 3600e3 },
        { id: 't2', text: '提高法定存款准备金率属于紧缩性货币政策，会直接减少商业银行可贷资金，货币乘数下降。', at: Date.now() - 7200e3 },
        { id: 't3', text: '本币贬值利出口、不利进口：出口商品以外币计价变便宜，进口商品以本币计价变贵。', at: Date.now() - 86400e3 },
      ];
      await DB.bkvSet('kbNotes', state.kbNotes);
      await go('kb');
      return true;
    })()`);
    await sleep(1500);

    const shot = async (name, clip) => {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    };

    const before = await cdp.eval(`(()=>{ const f = document.querySelector('.kb-fold'); if (!f) return null;
      const r = f.getBoundingClientRect(); return { w: f.offsetWidth, h: f.offsetHeight, x: r.x, y: r.y, on: f.classList.contains('on') }; })()`);
    console.log('折叠按钮尺寸：', JSON.stringify(before));

    const grid = await cdp.eval(`(()=>{ const g = document.querySelector('.kb-grid'); const r = g.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: Math.min(r.height, 520) }; })()`);
    await shot('1-折叠态', { x: grid.x, y: grid.y, width: grid.w, height: grid.h, scale: 2 });

    // 点第一张卡片的折叠按钮展开
    await cdp.eval(`(async()=>{ document.querySelector('.kb-fold').click(); await new Promise(r=>setTimeout(r,400)); return true; })()`);
    const after = await cdp.eval(`(()=>{ const f = document.querySelector('.kb-fold'); return { on: f.classList.contains('on'), rotated: getComputedStyle(f.querySelector('svg')).transform }; })()`);
    console.log('展开后按钮状态：', JSON.stringify(after));
    await sleep(400);
    await shot('2-展开态', { x: grid.x, y: grid.y, width: grid.w, height: grid.h, scale: 2 });

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
