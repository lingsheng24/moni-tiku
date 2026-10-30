/**
 * 验证-模板导入.js —— 端到端验证出题模板导入：粘贴 TSV → 解析预览 → 确认入库
 * 复用 CDP 骨架：本地 electron + 隔离 userData + 调试端口。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 9489;
const TMP = path.join(os.tmpdir(), 'mtk-qtplimp-' + Date.now());
const UD = path.join(TMP, 'ud');
const DATA = path.join(UD, 'data.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (name, ok, info) => {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (ok ? '' : '  ' + JSON.stringify(info || '')));
  ok ? pass++ : fail++;
};

class CDP {
  static async connect(port) {
    for (let t = 0; t < 40; t++) {
      try {
        const targets = await new Promise((res, rej) => {
          http.get({ hostname: '127.0.0.1', port, path: '/json/list' }, r => {
            let b = ''; r.on('data', c => b += c); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
          }).on('error', rej);
        });
        const page = targets.find(t => t.type === 'page');
        if (page) return new CDP(page.webSocketDebuggerUrl);
      } catch (e) { /* retry */ }
      await sleep(300);
    }
    throw new Error('CDP 连接失败');
  }
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.logs = []; }
  async open() {
    this.ws = new WebSocket(this.url);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
      if (m.method === 'Runtime.consoleAPICalled' || m.method === 'Runtime.exceptionThrown') {
        const p = m.params;
        this.logs.push(m.method === 'Runtime.exceptionThrown'
          ? (p.exceptionDetails.exception && p.exceptionDetails.exception.description || 'exception')
          : (p.args[0] && p.args[0].value || ''));
      }
    };
    await this.send('Runtime.enable');
    await this.send('Page.enable');
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, m => m.error ? rej(new Error(m.error.message)) : res(m.result));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception && r.exceptionDetails.exception.description || 'eval error');
    return r.result.value;
  }
}

/* 模拟军哥填好的模板（Excel 复制 → TSV）：表头 + 示例行 + 3 道真题 */
const TSV = [
  '序号\t题型\t难度\t知识点\t重要程度\t题干\t选项A\t选项B\t选项C\t选项D\t答案\t解析',
  '1\t单选题\t简单\t示例知识点\t3\t空气中含量最多的气体是？\t氧\t氮\t碳\t氢\tB\t空气中氮气约占 78%',
  '2\t单选题\t简单\t光合作用\t5\t氧气主要由什么产生？\t水\t二氧化碳\t土壤\t氮气\tA\t光反应释放氧气',
  '3\t判断题\t中等\t大气成分\t4\t空气中氧气含量高于氮气。\t\t\t\t\t错\t氮气约 78%，氧气约 21%',
  '4\t填空题\t困难\t水的组成\t1\t水的化学式是____。\t\t\t\t\tH₂O\t两个氢原子一个氧原子',
].join('\n');

(async () => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  fs.mkdirSync(UD, { recursive: true });
  fs.writeFileSync(DATA, JSON.stringify({
    curBank: 'default',
    banks: { default: { name: '我的题库', createdAt: new Date().toISOString() } },
    kv: {},
  }));
  fs.mkdirSync(path.join(UD, 'banks'), { recursive: true });
  fs.writeFileSync(path.join(UD, 'banks', 'default.json'), JSON.stringify({
    name: '我的题库', seq: {},
    docs: [], mistakes: [], practice: [], exams: [], review: [],
    questions: [], kv: {},
  }));

  const env = { ...process.env, MTK_DEBUG_PORT: String(PORT) };
  delete env.ELECTRON_RUN_AS_NODE;
  const exe = path.join(ROOT, 'desktop', 'node_modules', 'electron', 'dist', 'electron.exe');
  const child = spawn(exe, [path.join(ROOT, 'desktop'), '--user-data-dir=' + UD], { env, stdio: 'ignore' });

  try {
    const cdp = await CDP.connect(PORT);
    await cdp.open();
    await sleep(2500);
    await cdp.eval(`(async()=>{ await refreshData(); return true; })()`);
    const base = await cdp.eval(`({ q: (state.questions||[]).length })`);
    check('初始题库为空', base.q === 0, base);

    /* 1) 真点击打开导入弹窗 */
    await cdp.eval(`go('docs')`);
    await sleep(400);
    const openR = await cdp.eval(`(async () => {
      const btns = [...document.querySelectorAll('button')].filter(b => b.textContent.includes('导入模板题目'));
      if (!btns.length) return { ok: false };
      btns[0].click();
      await new Promise(r => setTimeout(r, 200));
      return { ok: !!document.getElementById('qTplPaste'), hasParseBtn: !!document.getElementById('qTplParseBtn') };
    })()`);
    check('文档管理页「导入模板题目」按钮存在且点开弹窗', openR.ok && openR.hasParseBtn, openR);

    /* 2) 粘贴 TSV → 点解析预览 */
    const pv = await cdp.eval(`(async () => {
      document.getElementById('qTplPaste').value = ${JSON.stringify(TSV)};
      document.getElementById('qTplParseBtn').click();
      await new Promise(r => setTimeout(r, 250));
      const h3 = document.querySelector('#modal h3');
      const rows = [...document.querySelectorAll('#modal table tr')].length - 1;
      const subj = !!document.getElementById('qTplSubj');
      return { title: h3 ? h3.textContent : '', rows, subj };
    })()`);
    check('解析预览：3 题可导入、示例行自动跳过', /可导入 3 题/.test(pv.title) && /1 行示例行/.test(pv.title), pv.title);
    check('预览表列出 3 行真题', pv.rows === 3, pv.rows);

    /* 3) 确认导入 → 题库出现 3 题，字段映射正确 */
    const imp = await cdp.eval(`(async () => {
      const doBtn = document.getElementById('qTplDoBtn');
      doBtn.click();
      for (let t = 0; t < 20; t++) { await new Promise(r => setTimeout(r, 150)); if ((state.questions||[]).length) break; }
      await new Promise(r => setTimeout(r, 300));
      const qs = [...state.questions].sort((a, b) => a.content < b.content ? -1 : 1);
      const byContent = s => qs.find(q => q.content === s);
      const single = byContent('氧气主要由什么产生？');
      const tf = byContent('空气中氧气含量高于氮气。');
      const fb = byContent('水的化学式是____。');
      return {
        n: (state.questions||[]).length,
        single: single && { opts: single.options, imp: single.importance, kp: single.knowledge_point, diff: single.difficulty },
        tf: tf && { ans: tf.answer, imp: tf.importance },
        fb: fb && { ans: fb.answer, imp: fb.importance, diff: fb.difficulty, opts: fb.options },
        view: curView,
      };
    })()`);
    check('导入后题库共 3 题、自动跳到题库页', imp.n === 3 && imp.view === 'bank', imp.n);
    check('单选题：options 带 A. 前缀、重要度 5、难度 easy', imp.single && imp.single.opts.join('|') === 'A. 水|B. 二氧化碳|C. 土壤|D. 氮气' && imp.single.imp === 5 && imp.single.diff === 'easy' && imp.single.kp === '光合作用', imp.single);
    check('判断题：「错」映射为「错误」、重要度 4', imp.tf && imp.tf.ans === '错误' && imp.tf.imp === 4, imp.tf);
    check('填空题：options 为 null、重要度 1、难度 hard', imp.fb && imp.fb.opts === null && imp.fb.imp === 1 && imp.fb.diff === 'hard', imp.fb);

    /* 4) 题库管理页也有入口按钮 */
    const bankBtn = await cdp.eval(`(() => {
      const b = [...document.querySelectorAll('button')].filter(b => b.textContent.includes('导入模板题目'));
      return { n: b.length, visible: b.length && b[0].offsetHeight > 0 };
    })()`);
    check('题库管理页同样有「导入模板题目」入口', bankBtn.n >= 1 && bankBtn.visible, bankBtn);

    check('全程无未捕获异常', cdp.logs.filter(l => /error|exception/i.test(String(l))).length === 0, cdp.logs.slice(0, 3));

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false });
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ROOT, '教程', '验证-模板导入.png'), Buffer.from(shot.data, 'base64'));
    console.log('截图: 教程/验证-模板导入.png');
  } finally {
    try { child.kill(); } catch (e) {}
  }
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('脚本异常:', e); process.exit(1); });
