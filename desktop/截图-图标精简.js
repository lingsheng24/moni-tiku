/* 图标精简改造：逐页截图，确认按钮尺寸、间距、提示气泡正常
 * 运行：node desktop/截图-图标精简.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTML_URL = 'file:///' + encodeURI(ROOT + '/模拟题库-Web版.html').replace(/#/g, '%23');
const PORT = 9377;
const PROFILE = path.join(ROOT, '教程/.edge-profile-icobtn');
const OUT = path.join(os.tmpdir(), 'mtk-icobtn');
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
    '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + PORT, '--window-size=1480,1000', 'about:blank',
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
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1480, height: 1000, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: HTML_URL });
    await sleep(3200);

    // 种子数据：3 道题（1 道带笔记）+ 1 条错题（带笔记）
    const seed = await cdp.eval(`(async()=>{
      window.confirm = () => true; window.alert = () => {};
      const base = { document_id: 0, difficulty: 'medium', created_at: Date.now(), knowledge_point: '宏观经济' };
      const q1 = await DB.add('questions', { ...base, type:'single_choice',
        content:'某国去年名义 GDP 增长 8%，GDP 平减指数上涨 3%，则实际 GDP 增速约为？',
        options:['A. 5%','B. 8%','C. 11%','D. 无法判断'], answer:'A' });
      const q2 = await DB.add('questions', { ...base, type:'true_false',
        content:'通货膨胀率上升时，居民手中货币的实际购买力下降。', answer:'正确' });
      const q3 = await DB.add('questions', { ...base, type:'fill_blank',
        content:'GDP 平减指数 = 名义 GDP ÷ ______ × 100%。', answer:'实际 GDP' });
      await refreshData();
      await saveQNote(q1, '先算实际 = 名义 − 通胀；别把平减指数当 CPI。');
      const mid = await DB.add('mistakes', { question_id: q1, type:'single_choice',
        question_content:'某国去年名义 GDP 增长 8%，GDP 平减指数上涨 3%，则实际 GDP 增速约为？',
        user_answer:'C', correct_answer:'A', difficulty:'medium',
        mistake_reason:'把名义增速当实际增速', created_at: Date.now() });
      await DB.kvSet('kpNotes', { '宏观经济': { text: '名义量 → 实际量必须扣除价格因素。', at: Date.now() } });
      await refreshData();
      return { q1, q2, q3, mid };
    })()`);

    const shot = async (name) => {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    };

    // 1) 文档管理
    await cdp.eval(`(async()=>{ await go('docs'); return true; })()`);
    await sleep(600); await shot('1-文档管理');

    // 2) 题库管理
    await cdp.eval(`(async()=>{ await go('bank'); return true; })()`);
    await sleep(600); await shot('2-题库管理');

    // 3) 错题本
    await cdp.eval(`(async()=>{ await go('mist'); return true; })()`);
    await sleep(600); await shot('3-错题本');

    // 4) 知识库
    await cdp.eval(`(async()=>{ await go('kb'); return true; })()`);
    await sleep(600); await shot('4-知识库');

    // 5) 系统设置（数据管理区）
    await cdp.eval(`(async()=>{ await go('set'); return true; })()`);
    await sleep(700);
    await cdp.eval(`(()=>{ const h=[...document.querySelectorAll('h3')].find(x=>x.textContent.includes('数据管理'));
      if(h) h.scrollIntoView({block:'center'}); return true; })()`);
    await sleep(400); await shot('5-设置-数据管理');

    // 6) 悬停提示气泡：模拟 hover 到「导出出题模板」图标按钮
    const tip = await cdp.eval(`(()=>{
      const b = document.querySelector('button.ibtn[data-tip]');
      if (!b) return { ok:false };
      b.dispatchEvent(new MouseEvent('mouseover', { bubbles:true }));
      const cs = getComputedStyle(b, '::after');
      return { ok:true, tip: b.dataset.tip, w: b.offsetWidth, h: b.offsetHeight, afterContent: cs.content, afterOpacity: cs.opacity };
    })()`);
    console.log('图标按钮实测：', JSON.stringify(tip));

    // 统计：改造后剩余「图标+文字」的 ghost 按钮
    const stats = await cdp.eval(`(()=>{
      const all = [...document.querySelectorAll('#view button')];
      return {
        ibtn: all.filter(b => b.classList.contains('ibtn')).length,
        ghost: all.filter(b => b.classList.contains('ghost')).length,
        primary: all.filter(b => b.classList.contains('primary')).length,
      };
    })()`);
    console.log('当前页按钮统计：', JSON.stringify(stats));

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
