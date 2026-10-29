/* 桌面版验证 v1.44.0 笔记归入知识库：走 Electron IPC 数据层（真实打包产物）
 * 运行：node desktop/验证-知识库笔记-桌面版.js
 * 隔离：独立 userData + 独立数据目录（不动军哥的真实题库）；复制真实 Local State 以便解密密钥（知识库不依赖，但保持一致）
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const EXE = path.join(ROOT, '发布/模拟题库-1.44.0-portable.exe');
const PORT = 9389;
const TMP = 'D:\\AI\\WorkBuddy\\.tmp-kb-diag';
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
  fs.rmSync(TMP, { recursive: true, force: true });
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
      return { ver: APP_VER, desktop: IS_DESKTOP, hasKb: typeof kbAllNotes === 'function', qn: !!(KB_KIND && KB_KIND.qn) };
    })()`);
    check('打包版 1.44.0 且知识库含题目笔记', env.ver === '1.44.0' && env.desktop === true && env.hasKb === true && env.qn === true, env);

    const prep = await cdp.eval(`(async()=>{
      const base = { document_id: 0, difficulty:'easy', created_at: Date.now() };
      const q1 = await DB.add('questions', { ...base, type:'single_choice', knowledge_point:'桌面知识库A', content:'桌面知识库题一：GDP 属于什么指标？', options:['A. 流量','B. 存量'], answer:'A' });
      const q2 = await DB.add('questions', { ...base, type:'fill_blank', knowledge_point:'桌面知识库B', content:'桌面知识库题二：首都是____', answer:'北京' });
      await refreshData();
      await saveQNote(q1, '桌面知识库笔记：GDP 是流量，不是存量');
      await refreshData();
      return { q1, q2, total: state.questions.length };
    })()`);
    check('IPC 建题并写入笔记成功', prep.total >= 2, prep);

    const pageKb = await cdp.eval(`(async()=>{
      go('kb');
      await new Promise(r => setTimeout(r, 600));
      const stats = [...document.querySelectorAll('.stat')].map(s => ({
        lbl: (s.querySelector('.lbl')||{}).textContent, num: (s.querySelector('.num')||{}).textContent }));
      const cards = [...document.querySelectorAll('.kb-note')].map(c => ({
        pills: [...c.querySelectorAll('.pill')].map(p => p.textContent.trim()),
        txt: (c.querySelector('.kb-note-txt')||{}).textContent }));
      return { stats, cards, qn: (stats.find(s => s.lbl === '题目笔记')||{}).num };
    })()`);
    check('知识库统计卡「题目笔记」为 1', pageKb.qn === '1', pageKb.stats);
    check('知识库出现题目笔记卡片（走 IPC 数据）', (pageKb.cards || []).some(c => (c.pills || []).some(p => p.includes('题目笔记'))), pageKb.cards);

    const edit = await cdp.eval(`(async()=>{
      kbEditNote('qn:${prep.q1}');
      await new Promise(r => setTimeout(r, 200));
      document.querySelector('#kbEText').value = '桌面改后：GDP 是流量指标';
      document.querySelector('.modal .primary').click();
      await new Promise(r => setTimeout(r, 800));
      const saved = await DB.get('questions', ${prep.q1});
      const txt = [...document.querySelectorAll('.kb-note-txt')].map(e => e.textContent);
      return { note: saved && saved.note, txt };
    })()`);
    check('知识库内编辑写回原题（IPC 落库）', edit.note === '桌面改后：GDP 是流量指标', { note: edit.note });
    check('卡片同步刷新', (edit.txt || []).some(t => t === '桌面改后：GDP 是流量指标'), edit.txt);

    const del = await cdp.eval(`(async()=>{
      await kbDeleteNote('qn:${prep.q1}');
      await new Promise(r => setTimeout(r, 700));
      const q = await DB.get('questions', ${prep.q1});
      return { alive: !!q, note: q && q.note, cards: [...document.querySelectorAll('.kb-note')].length };
    })()`);
    check('删除题目笔记只清空笔记、题目保留', del.alive === true && del.note === '', del);

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
    // 磁盘核对：在删除之前写一条，确保能落到 banks/default.json
    try {
      const raw = fs.readFileSync(path.join(TMP, 'banks', 'default.json'), 'utf8');
      const hasQ = raw.includes('桌面知识库题一');
      check('题目已落盘 banks/default.json', hasQ, { size: raw.length });
    } catch (e) {
      check('题目已落盘 banks/default.json', false, { error: e.message });
    }
    const bad = results.filter(r => !r.pass).length;
    console.log(`\n===== 合计 ${results.length} 项，通过 ${results.length - bad} 项，失败 ${bad} 项 =====`);
    setTimeout(() => process.exit(bad ? 1 : 0), 200);
  }
})();
