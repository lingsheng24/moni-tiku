/**
 * 验证-题型分值.js —— 端到端验证「按题型设置分值」：
 * 设置页改分值 → 持久化 → 题库管理/练习显示同步 → 考试满分按新分值算
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 9490;
const TMP = path.join(os.tmpdir(), 'mtk-score-' + Date.now());
const UD = path.join(TMP, 'ud');
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
      if (m.method === 'Runtime.exceptionThrown') {
        this.logs.push(m.params.exceptionDetails.exception?.description || 'exception');
      } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        this.logs.push(m.params.args[0]?.value || 'console.error');
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
    return r.result.value;
  }
}

(async () => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  fs.mkdirSync(UD, { recursive: true });
  fs.writeFileSync(path.join(UD, 'data.json'), JSON.stringify({
    curBank: 'default',
    banks: { default: { name: '我的题库', createdAt: new Date().toISOString() } },
    kv: {},
  }));
  fs.mkdirSync(path.join(UD, 'banks'), { recursive: true });
  fs.writeFileSync(path.join(UD, 'banks', 'default.json'), JSON.stringify({
    name: '我的题库', seq: {},
    docs: [], mistakes: [], practice: [], exams: [], review: [],
    questions: [
      { id: 1, type: 'single_choice', difficulty: 'easy', content: '单选题一', options: ['A. 甲', 'B. 乙'], answer: 'A', knowledge_point: 'K1' },
      { id: 2, type: 'single_choice', difficulty: 'medium', content: '单选题二', options: ['A. 甲', 'B. 乙'], answer: 'B', knowledge_point: 'K1' },
      { id: 3, type: 'short_answer', difficulty: 'hard', content: '简答题一', answer: '参考答案', knowledge_point: 'K2' },
    ],
    kv: {},
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

    /* 1) 设置页有「题型分值」卡片，默认值正确 */
    const s1 = await cdp.eval(`(async () => {
      go('set');
      await new Promise(r => setTimeout(r, 500));
      const inp = document.querySelector('input[data-ttype="single_choice"]');
      const inpSA = document.querySelector('input[data-ttype="short_answer"]');
      return {
        hasCard: document.body.innerHTML.includes('📊 题型分值'),
        single: inp ? +inp.value : null,
        shortA: inpSA ? +inpSA.value : null,
        hasReset: !!document.getElementById('sScoreReset'),
      };
    })()`);
    check('设置页有「题型分值」卡片（单选默认 3 / 简答默认 8）', s1.hasCard && s1.single === 3 && s1.shortA === 8 && s1.hasReset, s1);

    /* 2) 真改输入框并触发 change → 分值保存进 settings */
    const s2 = await cdp.eval(`(async () => {
      const inp = document.querySelector('input[data-ttype="single_choice"]');
      inp.value = '8';
      inp.dispatchEvent(new Event('change'));
      await new Promise(r => setTimeout(r, 500));
      const saved = await DB.kvGet('settings');
      return {
        mem: state.settings.typeScores && state.settings.typeScores.single_choice,
        disk: saved && saved.typeScores && saved.typeScores.single_choice,
        tip: (document.getElementById('sScoreTip') || {}).textContent || '',
      };
    })()`);
    check('改单选为 8 分：内存 + 磁盘（kv settings）都已保存', s2.mem === 8 && s2.disk === 8, s2);
    check('保存后有「已保存」提示', /已保存/.test(s2.tip), s2.tip);

    /* 3) 题库管理：单选题卡片显示 8 分，简答题仍 8 分（不同题型互不影响） */
    const s3 = await cdp.eval(`(async () => {
      go('bank');
      await new Promise(r => setTimeout(r, 500));
      const pills = [...document.querySelectorAll('[data-score-pill]')].map(e => e.textContent.trim());
      const vals = {};
      document.querySelectorAll('[data-score-pill]').forEach(e => {
        const q = state.questions.find(x => x.id === +e.dataset.scorePill);
        if (q) vals[q.id] = e.textContent.trim();
      });
      return { pills, vals };
    })()`);
    check('题库管理显示每题分值：单选题 8 分、简答题 8 分', s3.vals['1'] === '8 分' && s3.vals['2'] === '8 分' && s3.vals['3'] === '8 分', s3);

    /* 4) 练习页显示分值 */
    const s4 = await cdp.eval(`(async () => {
      quiz = { items: [...state.questions].filter(q => q.type === 'single_choice'), idx: 0, answers: [], correct: 0 };
      renderQuiz();
      await new Promise(r => setTimeout(r, 300));
      const pill = document.querySelector('#view [data-score-pill]');
      return { txt: pill ? pill.textContent.trim() : 'NO-PILL' };
    })()`);
    check('答题练习卡片显示 8 分', s4.txt === '8 分', s4);

    /* 5) 考试满分按新分值：2 单选×8 + 1 简答×8 = 24 */
    const s5 = await cdp.eval(`(() => {
      const items = [...state.questions];
      return { total: examTotalScore(items), paper: items.map(q => paperScoreOf(q)) };
    })()`);
    check('考试/组卷满分按题型分值为 24 分（8+8+8）', s5.total === 24 && JSON.stringify(s5.paper) === '[8,8,8]', s5);

    /* 6) 「恢复默认」按钮：回到单选 3 分并落盘 */
    const s6 = await cdp.eval(`(async () => {
      go('set');
      await new Promise(r => setTimeout(r, 400));
      window.confirm = () => true;
      document.getElementById('sScoreReset').click();
      await new Promise(r => setTimeout(r, 600));
      const saved = await DB.kvGet('settings');
      const inp = document.querySelector('input[data-ttype="single_choice"]');
      return {
        memEmpty: !state.settings.typeScores || Object.keys(state.settings.typeScores).length === 0,
        diskEmpty: !saved || !saved.typeScores || Object.keys(saved.typeScores).length === 0,
        inp: inp ? +inp.value : null,
        eff: typeScoreOf('single_choice'),
      };
    })()`);
    check('恢复默认：配置清空、输入框回到 3、生效值回到 3', s6.memEmpty && s6.diskEmpty && s6.inp === 3 && s6.eff === 3, s6);

    check('全程无未捕获异常', cdp.logs.filter(l => /error|exception/i.test(String(l))).length === 0, cdp.logs.slice(0, 3));

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false });
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ROOT, '教程', '验证-题型分值.png'), Buffer.from(shot.data, 'base64'));
    console.log('截图: 教程/验证-题型分值.png');
  } finally {
    try { child.kill(); } catch (e) {}
  }
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('脚本异常:', e); process.exit(1); });
