/**
 * 验证-文档批量.js —— 端到端验证文档管理批量管理：
 * 勾选/全选 → 批量出题队列 → 批量归科目 → 批量删除；顺带核对知识库图谱图标。
 * 复用 CDP 骨架：本地 electron + 隔离 userData + 调试端口。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 9491;
const TMP = path.join(os.tmpdir(), 'mtk-docbulk-' + Date.now());
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

(async () => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  fs.mkdirSync(UD, { recursive: true });
  fs.writeFileSync(DATA, JSON.stringify({
    curBank: 'default',
    banks: { default: { name: '我的题库', createdAt: new Date().toISOString() } },
    kv: {},
  }));
  fs.mkdirSync(path.join(UD, 'banks'), { recursive: true });
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(UD, 'banks', 'default.json'), JSON.stringify({
    name: '我的题库', seq: {},
    docs: [
      { id: 1, title: '第一讲 集合', file_type: 'txt', file_size: 2048, content: '集合的定义与运算。', subject_id: 's1', created_at: now },
      { id: 2, title: '第二讲 函数', file_type: 'txt', file_size: 3072, content: '函数的定义域与值域。', subject_id: null, created_at: now },
      { id: 3, title: '第三讲 极限', file_type: 'txt', file_size: 4096, content: '数列极限与函数极限。', subject_id: null, created_at: now },
    ],
    mistakes: [], practice: [], exams: [], review: [],
    questions: [
      { id: 1, type: 'single_choice', difficulty: 'easy', content: '集合 A={1,2} 的子集个数是？', options: ['A. 2', 'B. 3', 'C. 4', 'D. 5'], answer: 'C', explanation: '', knowledge_point: '集合', importance: 3, document_id: 1, subject_id: 's1', created_at: now },
      { id: 2, type: 'true_false', difficulty: 'easy', content: '空集是任何集合的子集。', options: null, answer: '正确', explanation: '', knowledge_point: '集合', importance: 3, document_id: 1, subject_id: 's1', created_at: now },
    ],
    kv: { subjects: [{ id: 's1', name: '语文', color: '#3b82f6' }, { id: 's2', name: '数学', color: '#10b981' }] },
  }));

  const env = { ...process.env, MTK_DEBUG_PORT: String(PORT) };
  delete env.ELECTRON_RUN_AS_NODE;
  const exe = path.join(ROOT, 'desktop', 'node_modules', 'electron', 'dist', 'electron.exe');
  const child = spawn(exe, [path.join(ROOT, 'desktop'), '--user-data-dir=' + UD], { env, stdio: 'ignore' });

  try {
    const cdp = await CDP.connect(PORT);
    await cdp.open();
    await sleep(2500);
    await cdp.eval(`(async()=>{ await refreshData(); window.confirm = () => true; return true; })()`);
    const base = await cdp.eval(`({ docs: (state.docs||[]).length, subj: (subjects||[]).length })`);
    check('种子数据就绪：3 篇文档 / 2 个科目', base.docs === 3 && base.subj === 2, base);

    /* 1) 文档列表批量工具条初始态 */
    await cdp.eval(`go('docs')`);
    await sleep(500);
    const init = await cdp.eval(`(() => {
      const cbs = [...document.querySelectorAll('.doc-cb')];
      return {
        cbs: cbs.length,
        hasAll: !!document.getElementById('docAll'),
        n: (document.getElementById('docBulkN')||{}).textContent,
        disabled: ['docBulkGen','docBulkSubj','docBulkDel'].map(k => (document.getElementById(k)||{}).disabled),
      };
    })()`);
    check('每篇文档有勾选框 + 表头全选', init.cbs === 3 && init.hasAll, init);
    check('未勾选时计数 0、三个批量按钮禁用', init.n === '已选 0 篇' && init.disabled.every(Boolean), init);

    /* 2) 真点击勾选前两篇 → 计数与按钮联动 */
    const sel = await cdp.eval(`(() => {
      const cbs = [...document.querySelectorAll('.doc-cb')];
      cbs[0].click(); cbs[1].click();
      return {
        n: document.getElementById('docBulkN').textContent,
        disabled: ['docBulkGen','docBulkSubj','docBulkDel'].map(k => document.getElementById(k).disabled),
        all: document.getElementById('docAll').checked,
        half: document.getElementById('docAll').indeterminate,
      };
    })()`);
    check('勾选 2 篇后计数与按钮启用', sel.n === '已选 2 篇' && sel.disabled.every(x => x === false), sel);
    check('全选框处于半选态', sel.all === false && sel.half === true, sel);

    /* 3) 全选 → 3 篇；再取消全选 → 0 篇 */
    const allR = await cdp.eval(`(() => {
      const a = document.getElementById('docAll');
      a.click();
      const on = { n: document.getElementById('docBulkN').textContent, checked: [...document.querySelectorAll('.doc-cb')].filter(c => c.checked).length };
      a.click();
      const off = { n: document.getElementById('docBulkN').textContent, checked: [...document.querySelectorAll('.doc-cb')].filter(c => c.checked).length };
      return { on, off };
    })()`);
    check('全选勾中 3 篇', allR.on.n === '已选 3 篇' && allR.on.checked === 3, allR.on);
    check('取消全选清空勾选', allR.off.n === '已选 0 篇' && allR.off.checked === 0, allR.off);

    /* 4) 勾 1、2 → 批量出题 → 跳到出题页并出现队列条 */
    const gen = await cdp.eval(`(async () => {
      const cbs = [...document.querySelectorAll('.doc-cb')];
      cbs[0].click(); cbs[1].click();
      document.getElementById('docBulkGen').click();
      await new Promise(r => setTimeout(r, 500));
      const bar = document.getElementById('genQueueBar');
      return {
        view: curView,
        bar: !!bar,
        txt: (document.getElementById('genQueueTxt')||{}).textContent,
        doc: (document.getElementById('gDoc')||{}).value,
        nextDisabled: (document.getElementById('genQueueNext')||{}).disabled,
      };
    })()`);
    check('批量出题跳到 AI 出题页且出现队列条', gen.view === 'gen' && gen.bar, gen);
    check('队列显示「共 2 篇」并默认选中第 1 篇', /共 2 篇/.test(gen.txt || '') && /第 1 篇/.test(gen.txt || '') && gen.doc === '1', gen);
    check('「下一篇」在还有排队文档时可用', gen.nextDisabled === false, gen);

    /* 5) 点「下一篇」→ 切到第 2 篇 */
    const next = await cdp.eval(`(async () => {
      document.getElementById('genQueueNext').click();
      await new Promise(r => setTimeout(r, 250));
      return {
        doc: document.getElementById('gDoc').value,
        txt: document.getElementById('genQueueTxt').textContent,
        nextDisabled: document.getElementById('genQueueNext').disabled,
      };
    })()`);
    check('切到队列第 2 篇且「下一篇」变为禁用', next.doc === '2' && /第 2 篇/.test(next.txt) && next.nextDisabled === true, next);

    /* 6) 回文档管理 → 批量归科目（换成数学），文档与题目一起改 */
    const subj = await cdp.eval(`(async () => {
      go('docs'); await new Promise(r => setTimeout(r, 450));
      let cbs0 = [...document.querySelectorAll('.doc-cb')];
      cbs0.forEach(c => { if (c.checked) c.click(); });          // 重绘后勾选会保留，先清空
      await new Promise(r => setTimeout(r, 100));
      const cbs = [...document.querySelectorAll('.doc-cb')];
      cbs[0].click(); cbs[1].click();
      document.getElementById('docBulkSubj').click();
      await new Promise(r => setTimeout(r, 250));
      const title = (document.querySelector('#modal h3')||{}).textContent || '';
      const okText = (document.getElementById('pkOk')||{}).textContent || '';
      const selEl = document.getElementById('pkSubj');
      selEl.value = 's2';
      document.getElementById('pkOk').click();
      for (let t = 0; t < 20; t++) { await new Promise(r => setTimeout(r, 120)); if (state.docs.filter(d => d.id <= 2).every(d => d.subject_id === 's2')) break; }
      await new Promise(r => setTimeout(r, 300));
      return {
        title, okText,
        docs: state.docs.filter(d => d.id <= 2).map(d => d.subject_id),
        qs: state.questions.filter(q => q.document_id === 1).map(q => q.subject_id),
      };
    })()`);
    check('批量归科目弹窗标题带篇数、按钮为「确认归类」', /批量归入科目（2 篇）/.test(subj.title) && subj.okText === '确认归类', subj);
    check('两篇文档归入数学（s2）', subj.docs.join(',') === 's2,s2', subj.docs);
    check('其下题目科目同步跟随', subj.qs.length > 0 && subj.qs.every(x => x === 's2'), subj.qs);

    /* 7) 批量删除第 3 篇（题目保留规则） */
    const del = await cdp.eval(`(async () => {
      const cbs = [...document.querySelectorAll('.doc-cb')];
      cbs.forEach((c, i) => { if (c.checked) c.click(); });      // 清空旧勾选
      await new Promise(r => setTimeout(r, 100));
      const cbs2 = [...document.querySelectorAll('.doc-cb')];
      cbs2[2].click();
      const before = state.docs.length;
      document.getElementById('docBulkDel').click();
      for (let t = 0; t < 25; t++) { await new Promise(r => setTimeout(r, 120)); if (state.docs.length < before) break; }
      await new Promise(r => setTimeout(r, 300));
      return {
        before, after: state.docs.length,
        titles: state.docs.map(d => d.title),
        n: (document.getElementById('docBulkN')||{}).textContent,
        qs: state.questions.length,
      };
    })()`);
    check('批量删除后文档数 3 → 2，被删的是第三讲', del.before === 3 && del.after === 2 && !del.titles.includes('第三讲 极限'), del);
    check('删除后勾选清空、题目全部保留', del.n === '已选 0 篇' && del.qs === 2, del);

    /* 8) 知识库里的图谱图标与导航栏一致（SVG，不是 emoji） */
    const ico = await cdp.eval(`(async () => {
      go('kb'); await new Promise(r => setTimeout(r, 500));
      const b = [...document.querySelectorAll('button')].filter(x => x.getAttribute('data-tip') === '打开知识点图谱');
      const navSvg = document.querySelector('.nav-item[data-v="kp"] svg');
      if (!b.length) return { btn: 0 };
      const svg = b[0].querySelector('svg');
      return {
        btn: b.length,
        hasSvg: !!svg,
        sameVb: !!svg && !!navSvg && svg.getAttribute('viewBox') === navSvg.getAttribute('viewBox'),
        text: (b[0].textContent || '').trim(),
        circles: svg ? svg.querySelectorAll('circle').length : 0,
      };
    })()`);
    check('知识库「打开知识点图谱」按钮用 SVG 图标', ico.btn >= 1 && ico.hasSvg && ico.circles === 4, ico);
    check('图标 viewBox 与左侧导航栏一致、无 emoji 文字', ico.sameVb === true && ico.text === '', ico);

    check('全程无未捕获异常', cdp.logs.filter(l => /error|exception/i.test(String(l))).length === 0, cdp.logs.slice(0, 3));

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false });
    await cdp.eval(`go('docs')`);
    await sleep(500);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ROOT, '教程', '验证-文档批量.png'), Buffer.from(shot.data, 'base64'));
    console.log('截图: 教程/验证-文档批量.png');

  } catch (e) {
    console.error('  ❌ 验证中断：', (e && e.message) || e);
    fail++;
  } finally {
    try { child.kill(); } catch (e2) {}
    console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
    process.exit(fail ? 1 : 0);
  }
})().catch(e => { console.error('验证脚本异常：', e); process.exit(1); });
