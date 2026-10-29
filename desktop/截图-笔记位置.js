/* 截两张图确认「📝 我的笔记」已移到题干上方：答题练习页 + 间隔复习会话
 * 运行：node desktop/截图-笔记位置.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTML_URL = 'file:///' + encodeURI(ROOT + '/模拟题库-Web版.html').replace(/#/g, '%23');
const PORT = 9369;
const PROFILE = path.join(ROOT, '教程/.edge-profile-shot');
const OUT = path.join(os.tmpdir(), 'mtk-note-pos');
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
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(PROFILE, { recursive: true });
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
    await sleep(3500);

    const prep = await cdp.eval(`(async()=>{
      window.confirm = () => true; window.alert = () => {};
      const base = { document_id: 0, difficulty: 'medium', created_at: Date.now(), knowledge_point: '宏观经济学' };
      const q1 = await DB.add('questions', { ...base, type:'single_choice',
        content:'某国去年名义 GDP 增长 8%，GDP 平减指数上涨 3%，则实际 GDP 增速约为？',
        options:['A. 5%','B. 8%','C. 11%','D. 无法判断'], answer:'A' });
      const q2 = await DB.add('questions', { ...base, type:'short_answer',
        content:'简述边际效用递减规律，并举一个生活中的例子。', answer:'同一商品连续消费，每新增一单位带来的满足感递减' });
      await refreshData();
      await saveQNote(q1, '先算实际 = 名义 − 通胀；别把平减指数当 CPI。');
      await refreshData();
      return { q1, q2 };
    })()`);

    // 答题练习
    await cdp.eval(`(()=>{
      const a = state.questions.find(x => x.id === ${prep.q1});
      quiz = { items: [a], idx: 0, answers: [], correct: 0 };
      go('practice'); renderQuiz(); return true;
    })()`);
    await sleep(400);
    const shot1 = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, '练习.png'), Buffer.from(shot1.data, 'base64'));

    // 间隔复习会话
    await cdp.eval(`(async()=>{
      const a = state.questions.find(x => x.id === ${prep.q1});
      await addReviewCards([a.id]);
      await refreshData();
      const card = state.reviews.find(c => c.question_id === a.id);
      startReview([card]);
      return true;
    })()`);
    await sleep(500);
    const shot2 = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, '复习.png'), Buffer.from(shot2.data, 'base64'));

    // 卡片管理行内答题区
    const order = await cdp.eval(`(async()=>{
      await viewReview();
      const card = state.reviews.find(c => c.question_id === ${prep.q1});
      toggleRevAns(card.id);
      const row = document.querySelector('#rvrow-' + card.id);
      row.scrollIntoView({ block: 'center' });
      const first = row.querySelector('.mist-ans') && row.querySelector('.mist-ans').firstElementChild;
      return { isNoteTop: !!(first && first.classList.contains('qnote')),
        hasStem: row.textContent.indexOf('实际 GDP') > -1 };
    })()`);
    await sleep(400);
    console.log('卡片管理展开行 DOM 顺序：', JSON.stringify(order));
    const shot3 = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, '卡片管理.png'), Buffer.from(shot3.data, 'base64'));

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
