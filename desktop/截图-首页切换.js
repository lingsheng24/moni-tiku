/* 截图：首页顶部板块切换条（题库工作区 / 切到知识库后的效果）
 * 运行：node desktop/截图-首页切换.js
 * 输出：%TEMP%/mtk-dsec/*.png
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const DESKTOP = path.join(ROOT, 'desktop');
const ELECTRON = path.join(DESKTOP, 'node_modules/electron/dist/electron.exe');
const OUT = path.join(os.tmpdir(), 'mtk-dsec');
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

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const elec = spawn(ELECTRON, [DESKTOP, '--remote-debugging-port=9335'], { env, stdio: 'ignore' });
  let c;
  try {
    await waitJson('http://127.0.0.1:9335/json/version');
    await sleep(1200);
    const list = await waitJson('http://127.0.0.1:9335/json/list');
    const page = (Array.isArray(list) ? list : list.targetInfos || []).find(t => t.type === 'page');
    c = new CDP(page.webSocketDebuggerUrl);
    await c.send('Page.enable'); await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1480, height: 940, deviceScaleFactor: 1, mobile: false });
    await sleep(1800);

    const shot = async (name) => {
      const s = await c.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(s.data, 'base64'));
    };

    /* 初始：题库工作区 */
    const st1 = await c.eval(`(async()=>{ go('dash'); await new Promise(r=>setTimeout(r,600));
      window.scrollTo(0,0); await new Promise(r=>setTimeout(r,250));
      const sw=document.querySelector('.dsec-switch');
      const btns=[...document.querySelectorAll('.dsec')].map(b=>({sec:b.dataset.sec, active:b.classList.contains('active'), txt:b.textContent.trim().replace(/\\s+/g,' ')}));
      const quick=[...document.querySelectorAll('#view .card h3')].length;
      return { hasSwitch:!!sw, top: sw?Math.round(sw.getBoundingClientRect().top):-1, btns, sub:document.querySelector('#view .sub')?.textContent, cards:quick };
    })()`);
    console.log('初始：', JSON.stringify(st1));
    await shot('1-首页-题库工作区');

    /* 点「知识库」 */
    const st2 = await c.eval(`(async()=>{
      document.querySelector('.dsec[data-sec="kb"]').click();
      await new Promise(r=>setTimeout(r,700));
      window.scrollTo(0,0); await new Promise(r=>setTimeout(r,250));
      const btns=[...document.querySelectorAll('.dsec')].map(b=>({sec:b.dataset.sec, active:b.classList.contains('active')}));
      const quick=[...document.querySelectorAll('#view .card')].find(c=>/快速开始/.test(c.textContent));
      return { btns, sub:document.querySelector('#view .sub')?.textContent,
        quick: quick?[...quick.querySelectorAll('button')].map(b=>b.textContent.trim()):[],
        bodySec: document.body.dataset.sec,
        navNow: [...document.querySelectorAll('.nsn-set')].filter(n=>getComputedStyle(n).display!=='none').map(n=>n.dataset.s) };
    })()`);
    console.log('切到知识库：', JSON.stringify(st2));
    await shot('2-首页-知识库工作区');

    /* 再切回题库，确认可来回切 */
    const st3 = await c.eval(`(async()=>{
      document.querySelector('.dsec[data-sec="tik"]').click();
      await new Promise(r=>setTimeout(r,700));
      return { bodySec: document.body.dataset.sec, active: document.querySelector('.dsec.active')?.dataset.sec };
    })()`);
    console.log('切回题库：', JSON.stringify(st3));

    /* 侧栏指示条：正常态文字 + 折叠态单字 */
    const st4 = await c.eval(`(async()=>{
      const now=document.querySelector('.nav-sec-now');
      const shown=[...now.querySelectorAll('.nsn-set')].find(n=>getComputedStyle(n).display!=='none');
      const before={ sec:shown.dataset.s, txt:shown.textContent.trim().replace(/\\s+/g,' ') };
      document.getElementById('navToggle')?.click();
      await new Promise(r=>setTimeout(r,450));
      const shown2=[...now.querySelectorAll('.nsn-set')].find(n=>getComputedStyle(n).display!=='none');
      const mini=shown2.querySelector('.sec-mini');
      const after={ sec:shown2.dataset.s, mini:getComputedStyle(mini).display!=='none'?mini.textContent:'(隐藏)', meta:getComputedStyle(shown2.querySelector('.sec-meta')).display };
      document.getElementById('navToggle')?.click();
      await new Promise(r=>setTimeout(r,450));
      return { before, after, backMeta:getComputedStyle(now.querySelector('.nsn-set[data-s="tik"] .sec-meta')).display };
    })()`);
    console.log('侧栏指示条：', JSON.stringify(st4));
    if (c.errors.length) console.log('JS 异常：', c.errors.slice(0, 3));
    console.log('输出目录：' + OUT);
  } catch (e) {
    console.error('失败:', e.message);
    process.exitCode = 1;
  } finally {
    c && c.close(); try { elec.kill(); } catch (e) { }
  }
})();
