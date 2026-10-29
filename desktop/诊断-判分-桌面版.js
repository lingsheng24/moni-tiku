/* 桌面版复现：模拟考试交卷 / 复习判分 卡在哪一步
 * 前置：本机 data-path.json 已临时指向隔离副本 D:\AI\WorkBuddy\.tmp-diag-tiku
 * 运行：node desktop/诊断-判分-桌面版.js
 */
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const EXE = path.join(ROOT, '发布/模拟题库-1.42.1-portable.exe');
const PORT = 9377;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const getJson = p => new Promise((resolve, reject) => {
  http.get({ hostname: '127.0.0.1', port: PORT, path: p, timeout: 5000 }, res => {
    let b = ''; res.on('data', c => b += c);
    res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
  }).on('error', reject).on('timeout', function () { this.destroy(); reject(new Error('timeout')); });
});

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url); this.id = 0; this.pending = new Map(); this.logs = [];
    this.ready = new Promise((res, rej) => { this.ws.onopen = () => res(); this.ws.onerror = () => rej(new Error('ws fail')); });
    this.ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      } else if (m.method === 'Runtime.consoleAPICalled') {
        this.logs.push('[' + m.params.type + '] ' + m.params.args.map(a => a.value !== undefined ? a.value : (a.description || a.type)).join(' '));
      } else if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        this.logs.push('[EXCEPTION] ' + (d.exception && (d.exception.description || d.exception.value) || d.text));
      }
    };
  }
  async send(method, params = {}) {
    await this.ready; const id = ++this.id;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async eval(expr, timeoutMs = 90000) {
    const r = await Promise.race([
      this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('页面执行超时 ' + timeoutMs + 'ms（很可能卡在 await 上）')), timeoutMs)),
    ]);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('页面异常: ' + ((d.exception && (d.exception.description || d.exception.value)) || d.text));
    }
    return r.result && r.result.value;
  }
  close() { try { this.ws.close(); } catch (e) { } }
}

(async () => {
  // 隔离运行：独立 userData（避免与军哥正在运行的安装版抢单实例锁），
  // 数据指向 .tmp-diag-tiku 副本（不动真实题库）
  const UD = 'D:\\AI\\WorkBuddy\\.tmp-diag-tiku\\ud';
  const DATA = 'D:\\AI\\WorkBuddy\\.tmp-diag-tiku\\data.json';
  require('fs').mkdirSync(UD, { recursive: true });
  require('fs').writeFileSync(path.join(UD, 'data-path.json'), JSON.stringify({ customPath: DATA }, null, 2));
  // safeStorage 的 DPAPI 密钥存在 userData/Local State：不带过去就解不开 settings.apiKeyEnc
  const realLS = path.join(process.env.APPDATA, 'moni-tiku', 'Local State');
  try { if (require('fs').existsSync(realLS)) require('fs').copyFileSync(realLS, path.join(UD, 'Local State')); } catch (e) { console.warn('复制 Local State 失败:', e.message); }

  const child = spawn(EXE, ['--user-data-dir=' + UD], {
    env: { ...process.env, MTK_DEBUG_PORT: String(PORT) }, stdio: 'ignore', detached: false,
  });
  let cdp;
  const cleanup = () => { try { cdp && cdp.close(); } catch (e) { } try { child.kill(); } catch (e) { } };
  process.on('exit', cleanup);

  try {
    let list = null;
    for (let i = 0; i < 60; i++) {
      try { list = await getJson('/json/list'); if (list && list.length) break; } catch (e) { }
      await sleep(500);
    }
    const page = (list || []).find(t => t.type === 'page');
    if (!page) throw new Error('调试端口未就绪');
    cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await sleep(1500);

    console.log('环境:', await cdp.eval(`(function(){
      window.confirm = () => true; window.alert = () => {}; window.prompt = () => '';
      window.__errs = [];
      window.addEventListener('unhandledrejection', e => __errs.push('unhandledrejection: ' + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason)));
      window.onerror = (m, s, l, c, err) => { __errs.push('onerror: ' + ((err && err.stack) || m)); return true; };
      return { ver: APP_VER, desktop: IS_DESKTOP, qs: state.questions.length, reviews: state.reviews.length,
        exams: state.exams.length, grading: state.settings.grading, apiKeyLen: (state.settings.apiKey||'').length,
        apiBase: state.settings.apiBase, model: state.settings.model };
    })()`));

    // ── A. 复习判分：客观题（不走 AI）
    console.log('\n[A] 复习·单选题:', await cdp.eval(`(async()=>{
      const due = state.reviews.find(c => !isFreshCard(c) || c.due <= Date.now());
      const q = state.questions.find(x => x.type === 'single_choice' && x.options && x.options.length);
      if (!q) return { skip: '没有单选题' };
      try {
        await addReviewCards([q.id]);
        const card = state.reviews.find(c => c.question_id === q.id) || due;
        startReview([card]);
        if (!rev) return { ok:false, stage:'startReview', msg:'rev 未建立' };
        const area = document.querySelector('#revAnswerArea');
        if (!area) return { ok:false, stage:'render', msg:'答案区不存在', judge: (document.querySelector('#revJudge')||{}).innerHTML };
        const el = area.querySelector('.opt-click');
        if (!el) return { ok:false, stage:'render', msg:'选项未渲染', html: area.innerHTML.slice(0,200) };
        el.click();
        const t0 = Date.now();
        await submitRevSession();
        const judge = (document.querySelector('#revJudge')||{}).textContent || '';
        return { ok:true, ms: Date.now()-t0, judge: judge.trim().slice(0,60), rateBtns: document.querySelectorAll('.rate-btn').length };
      } catch (e) { return { ok:false, stage:'review-objective', error: (e && e.stack) || String(e), errs: __errs }; }
    })()`, 60000));

    // ── B. 复习判分：简答题（走 AI）
    console.log('\n[B] 复习·简答题(AI):', await cdp.eval(`(async()=>{
      const q = state.questions.find(x => x.type === 'short_answer');
      if (!q) return { skip: '没有简答题' };
      try {
        await addReviewCards([q.id]);
        const card = state.reviews.find(c => c.question_id === q.id);
        startReview([card]);
        const area = document.querySelector('#revAnswerArea');
        const ta = area.querySelector('textarea') || document.querySelector('#rv-ta-' + card.id);
        if (!ta) return { ok:false, stage:'render', msg:'没有输入框', html: area.innerHTML.slice(0,300) };
        ta.value = q.answer.slice(0, 40);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        const t0 = Date.now();
        await submitRevSession();
        const judge = (document.querySelector('#revJudge')||{}).textContent || '';
        return { ok:true, ms: Date.now()-t0, judge: judge.trim().slice(0,80), rateBtns: document.querySelectorAll('.rate-btn').length, errs: __errs };
      } catch (e) { return { ok:false, stage:'review-subjective', error: (e && e.stack) || String(e), errs: __errs }; }
    })()`, 200000));

    // ── C. 考试交卷（真实题目，含简答）
    console.log('\n[C] 考试交卷:', await cdp.eval(`(async()=>{
      const qs = state.questions.filter(q => ['single_choice','multiple_choice','true_false'].includes(q.type)).slice(0,3);
      if (!qs.length) return { skip: '没有客观题' };
      exam = { cfg:{ types:['single_choice','multiple_choice','true_false'], diffs:[], count: qs.length },
        items: qs, idx: 0, answers: {}, marked: new Set(), name:'诊断考试',
        minutes: 0, startedAt: Date.now()-60000, deadline: 0, finished: false, results: [] };
      qs.forEach(q => exam.answers[q.id] = q.answer);
      const t0 = Date.now();
      try {
        await submitExam(false);
        return { ok:true, ms: Date.now()-t0, examsNow: state.exams.length, view: (document.querySelector('#view h1')||{}).textContent };
      } catch (e) { return { ok:false, stage:'submitExam', error: (e && e.stack) || String(e), errs: __errs }; }
    })()`, 120000));

    // ── D. 考试交卷（含简答，走 AI/自评）
    console.log('\n[D] 考试·含简答:', await cdp.eval(`(async()=>{
      const qs = state.questions.filter(q => q.type === 'short_answer' || (q.type === 'fill_blank' && /[\\u4e00-\\u9fa5]{4,}/.test(q.answer))).slice(0,2);
      if (!qs.length) return { skip: '没有简答/长填空' };
      exam = { cfg:{ types:['short_answer','fill_blank'], diffs:[], count: qs.length },
        items: qs, idx: 0, answers: {}, marked: new Set(), name:'诊断考试2',
        minutes: 0, startedAt: Date.now()-60000, deadline: 0, finished: false, results: [] };
      qs.forEach(q => exam.answers[q.id] = q.answer);
      const t0 = Date.now();
      try {
        await submitExam(false);
        return { ok:true, ms: Date.now()-t0, examsNow: state.exams.length, view: (document.querySelector('#view h1')||{}).textContent };
      } catch (e) { return { ok:false, stage:'submitExam-subjective', error: (e && e.stack) || String(e), errs: __errs }; }
    })()`, 300000));

    console.log('\n===== 页面控制台 =====');
    console.log(cdp.logs.slice(-30).join('\n') || '(空)');
    console.log('\n===== 未捕获异常 =====');
    console.log(await cdp.eval('JSON.stringify(window.__errs||[])', 10000));
  } catch (e) {
    console.error('诊断失败:', e.message);
    if (cdp) console.error('日志:\n' + cdp.logs.slice(-30).join('\n'));
  } finally {
    cleanup();
    await sleep(300);
    process.exit(0);
  }
})();
