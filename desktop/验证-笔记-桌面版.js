/* 桌面版验证 v1.43.0 题目笔记：走 Electron IPC 数据层（真实打包产物），确认笔记能落盘到 data.json
 * 运行：node desktop/验证-笔记-桌面版.js
 * 隔离：独立 userData + 独立 data.json（不动军哥的真实题库）
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const EXE = path.join(ROOT, '发布/模拟题库-1.43.0-portable.exe');
const PORT = 9388;
const TMP = 'D:\\AI\\WorkBuddy\\.tmp-note-diag';
const UD = path.join(TMP, 'ud');
const DATA = path.join(TMP, 'data.json');
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
  async eval(expr, timeoutMs = 60000) {
    const r = await Promise.race([
      this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('页面执行超时（可能卡在 await）')), timeoutMs)),
    ]);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('页面异常: ' + ((d.exception && (d.exception.description || d.exception.value)) || d.text));
    }
    return r.result && r.result.value;
  }
  close() { try { this.ws.close(); } catch (e) { } }
}

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? '  ' + JSON.stringify(detail) : ''}`);
};

(async () => {
  fs.mkdirSync(UD, { recursive: true });
  fs.writeFileSync(path.join(UD, 'data-path.json'), JSON.stringify({ customPath: DATA }, null, 2));
  const realLS = path.join(process.env.APPDATA, 'moni-tiku', 'Local State');
  try { if (fs.existsSync(realLS)) fs.copyFileSync(realLS, path.join(UD, 'Local State')); } catch (e) { console.warn('复制 Local State 失败:', e.message); }

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

    const env = await cdp.eval(`(function(){
      window.confirm = () => true; window.alert = () => {}; window.prompt = () => '';
      window.__errs = [];
      window.addEventListener('unhandledrejection', e => __errs.push('unhandledrejection: ' + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason)));
      window.onerror = (m, s, l, c, err) => { __errs.push('onerror: ' + ((err && err.stack) || m)); return true; };
      return { ver: APP_VER, desktop: IS_DESKTOP, hasQNote: typeof qNoteHTML === 'function' };
    })()`);
    check('打包版 1.43.0 且带笔记能力', env.ver === '1.43.0' && env.desktop === true && env.hasQNote === true, env);

    const prep = await cdp.eval(`(async()=>{
      const base = { document_id: 0, difficulty:'easy', created_at: Date.now(), knowledge_point:'笔记桌面验证' };
      const q1 = await DB.add('questions', { ...base, type:'single_choice', content:'桌面笔记题一：2+2=?', options:['A. 3','B. 4'], answer:'B' });
      const q2 = await DB.add('questions', { ...base, type:'fill_blank', content:'桌面笔记题二：首都是____', answer:'北京' });
      await refreshData();
      await addReviewCards([q1, q2]);
      await refreshData();
      return { q1, q2, reviews: state.reviews.length };
    })()`);
    check('IPC 建题与建卡成功', prep.reviews >= 2, prep);

    const typed = await cdp.eval(`(async()=>{
      const card = state.reviews.find(c => c.question_id === ${prep.q1});
      const other = state.reviews.find(c => c.question_id === ${prep.q2});
      startReview([card, other]);
      const ta = document.querySelector('#qn-sess' + card.id);
      if (!ta) return { ok:false, msg:'笔记框未渲染', html: document.querySelector('#view').innerHTML.slice(0,200) };
      ta.value = '桌面验证：2+2=4，注意选项顺序';
      ta.dispatchEvent(new Event('input', { bubbles:true }));
      await new Promise(r => setTimeout(r, 1400));
      const saved = await DB.get('questions', ${prep.q1});
      return { ok:true, note: saved && saved.note, tip: (document.querySelector('#qnt-sess' + card.id)||{}).textContent };
    })()`);
    check('会话内输入笔记经 IPC 落库', typed.ok && typed.note === '桌面验证：2+2=4，注意选项顺序', typed);

    const rated = await cdp.eval(`(async()=>{
      await rateRev(3);
      await new Promise(r => setTimeout(r, 300));
      const saved = await DB.get('questions', ${prep.q1});
      return { idx: rev.idx, rated: rev.rated, note: saved && saved.note };
    })()`);
    check('评分翻卡后笔记仍在且会话推进', rated.note === '桌面验证：2+2=4，注意选项顺序' && rated.idx === 1, rated);

    const revisit = await cdp.eval(`(async()=>{
      await refreshData();
      const card = state.reviews.find(c => c.question_id === ${prep.q1});
      startReview([card, state.reviews.find(c => c.question_id === ${prep.q2})]);
      const ta = document.querySelector('#qn-sess' + card.id);
      return { value: ta && ta.value, pills: [...document.querySelectorAll('.rev-chip .pill')].map(e => e.textContent.trim()) };
    })()`);
    check('重新进入复习回显笔记', revisit.value === '桌面验证：2+2=4，注意选项顺序', revisit);

    const cleared = await cdp.eval(`(async()=>{
      await saveQNote(${prep.q1}, '');
      const saved = await DB.get('questions', ${prep.q1});
      return { note: saved && saved.note, noteAt: saved && saved.note_at };
    })()`);
    check('清空笔记写库生效', cleared.note === '' && cleared.noteAt === 0, cleared);

    // 再写一条，供磁盘核对
    await cdp.eval(`(async()=>{ await saveQNote(${prep.q2}, '磁盘核对：首都=北京'); return true; })()`);
    await sleep(600);

    // 练习页：切题前强制落盘（IPC 通道）
    const prac = await cdp.eval(`(async()=>{
      const a = state.questions.find(x => x.id === ${prep.q1});
      const b = state.questions.find(x => x.id === ${prep.q2});
      quiz = { items: [a, b], idx: 0, answers: [], correct: 0 };
      renderQuiz();
      const ta = document.querySelector('#qn-quiz' + a.id);
      if (!ta) return { ok:false, msg:'练习题没渲染笔记框' };
      ta.value = '练习桌面验证：先括号后乘除';
      ta.dispatchEvent(new Event('input', { bubbles:true }));
      await goQuestion(1);
      const saved = await DB.get('questions', a.id);
      return { ok:true, note: saved && saved.note, idx: quiz.idx };
    })()`);
    check('练习页笔记经 IPC 落库（切题即存）', prac.ok && prac.note === '练习桌面验证：先括号后乘除' && prac.idx === 1, prac);

    const errs = await cdp.eval('window.__errs');
    check('全程无未捕获异常', Array.isArray(errs) && errs.length === 0, errs || []);
    const logs = cdp.logs.filter(l => l.startsWith('[EXCEPTION]'));
    check('无渲染进程异常', logs.length === 0, logs.slice(0, 3));
  } catch (e) {
    console.log('❌ 验证中断：', e && (e.stack || e.message));
    process.exitCode = 1;
  } finally {
    cleanup();
    await sleep(1500);
    // 磁盘核对：多题库结构下实际数据文件是 banks/default.json，笔记文本必须真在里面
    try {
      const raw = fs.readFileSync(path.join(TMP, 'banks', 'default.json'), 'utf8');
      check('笔记已写入 banks/default.json（磁盘持久化）', raw.includes('磁盘核对：首都=北京'), { size: raw.length });
    } catch (e) {
      check('笔记已写入 banks/default.json（磁盘持久化）', false, { error: e.message });
    }
    const bad = results.filter(r => !r.pass).length;
    console.log(`\n===== 合计 ${results.length} 项，通过 ${results.length - bad} 项，失败 ${bad} 项 =====`);
    setTimeout(() => process.exit(bad ? 1 : 0), 200);
  }
})();
