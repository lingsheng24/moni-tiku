/* 用 Edge headless + CDP 给 Web 版界面拍照（教程配图用）
 * 运行：node 教程/拍图.js
 * 输出：教程/截图/*.png（2 倍高清） */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTML_URL = 'file:///' + encodeURI(ROOT + '/模拟题库-Web版.html').replace(/#/g, '%23');
const OUT = path.join(ROOT, '教程/截图');
const PROFILE = path.join(ROOT, '教程/.edge-profile');
const PORT = 9333;
const W = 1480, H = 940, DPR = 2;

const sleep = ms => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.handlers = [];
    this.ready = new Promise((res, rej) => {
      this.ws.onopen = () => res();
      this.ws.onerror = () => rej(new Error('WebSocket 连接失败'));
    });
    this.ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      } else {
        this.handlers.forEach(h => h(m));
      }
    };
  }
  async send(method, params = {}) {
    await this.ready;
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  once(method, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('等 ' + method + ' 超时')), timeout);
      const h = m => { if (m.method === method) { clearTimeout(t); this.handlers = this.handlers.filter(x => x !== h); resolve(m.params); } };
      this.handlers.push(h);
    });
  }
  async eval(expr, awaitPromise = true) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('页面脚本异常: ' + (d.exception && (d.exception.description || d.exception.value) || d.text));
    }
    return r.result && r.result.value;
  }
  close() { try { this.ws.close(); } catch (e) { } }
}

async function waitPort(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch (e) { }
    await sleep(300);
  }
  throw new Error('等不到调试端口');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  if (fs.existsSync(PROFILE)) fs.rmSync(PROFILE, { recursive: true, force: true });

  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--disable-sync',
    '--disable-features=Translate,MediaRouter', '--force-device-scale-factor=' + DPR,
    '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + PORT,
    '--window-size=' + W + ',' + H, 'about:blank',
  ], { stdio: 'ignore' });

  let cdp;
  const cleanup = () => { try { cdp && cdp.close(); } catch (e) { } try { edge.kill(); } catch (e) { } };
  process.on('exit', cleanup);

  try {
    await waitPort('http://127.0.0.1:' + PORT + '/json/version');
    const list = await waitPort('http://127.0.0.1:' + PORT + '/json/list');
    const page = (Array.isArray(list) ? list : await list.json()).find(t => t.type === 'page');
    if (!page) throw new Error('找不到 page target');
    cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

    const loaded = cdp.once('Page.loadEventFired', 30000);
    await cdp.send('Page.navigate', { url: HTML_URL });
    await loaded;
    await sleep(3000);   // 等 IndexedDB 打开 + 首次 refreshData

    const guard = await cdp.eval('typeof state !== "undefined" && typeof go === "function"');
    if (!guard) throw new Error('页面未正常初始化');
    // 关掉首次引导 / 提示层，避免遮挡
    await cdp.eval(`(() => { const t = document.getElementById('toast'); if (t) t.textContent = ''; const m = document.getElementById('modal'); if (m) { m.classList.remove('on'); m.innerHTML = ''; } return 1; })()`);

    const seed = fs.readFileSync(path.join(ROOT, '教程/种子数据.js'), 'utf8');
    const seedRes = await cdp.eval(seed);
    console.log('种子数据:', seedRes);
    await sleep(1200);

    const snap = async (name, opts = {}) => {
      const { wait = 900, full = false } = opts;
      await sleep(wait);
      let params = { format: 'png', fromSurface: true, captureBeyondViewport: false };
      if (full) {
        const m = await cdp.send('Page.getLayoutMetrics');
        const cs = m.cssContentSize || m.contentSize;
        const h = Math.min(Math.ceil(cs.height), 4200);
        params = {
          format: 'png', fromSurface: true, captureBeyondViewport: true,
          clip: { x: 0, y: 0, width: W, height: h, scale: DPR },
        };
      }
      const r = await cdp.send('Page.captureScreenshot', params);
      const file = path.join(OUT, name + '.png');
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      const kb = (fs.statSync(file).size / 1024).toFixed(0);
      console.log('✓', name + '.png', kb + 'KB');
    };

    const run = async (js) => cdp.eval(js);

    /* ---------- 逐页拍照 ---------- */
    await run(`go('dash')`);
    await snap('01-首页总览', { wait: 1400 });

    await run(`go('docs')`);
    await snap('02-文档管理');

    await run(`sessionStorage.setItem('gen_doc', String(state.docs[0].id)); go('gen')`);
    await snap('03-AI生成题目', { wait: 1200 });

    await run(`go('bank')`);
    await snap('04-题库管理');

    await run(`go('kp')`);
    await snap('05-知识点图谱', { wait: 3200 });

    await run(`go('kb')`);
    await snap('06-知识库');

    await run(`go('practice')`);
    await snap('07-答题练习设置');

    await run(`$('#pBtn').click()`);
    await snap('08-答题界面', { wait: 1000 });

    await run(`go('exam')`);
    await snap('09-模拟考试组卷');

    await run(`go('mist')`);
    await snap('10-错题本');

    await run(`go('review')`);
    await snap('11-间隔复习', { wait: 1200 });

    await run(`go('stats')`);
    await snap('12-统计分析', { wait: 1400 });

    await run(`go('set')`);
    await snap('13-系统设置', { wait: 1200, full: false });

    await run(`go('help')`);
    await snap('14-帮助手册', { wait: 1000 });

    console.log('全部完成');
  } finally {
    cleanup();
    await sleep(500);
  }
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
