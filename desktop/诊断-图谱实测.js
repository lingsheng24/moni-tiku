/* 只读诊断：用军哥真实题库跑 1.45.0 打包版，查「题目笔记为什么不显示在图谱知识点上」
 * 隔离：复制一份题库到 .tmp-kpnode-diag，绝不写回真实数据
 * 运行：node desktop/诊断-图谱实测.js
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const EXE = path.join(ROOT, 'desktop/node_modules/electron/dist/electron.exe');
const APP_DIR = path.join(ROOT, 'desktop');
const PORT = 9391;
const TMP = 'D:\\AI\\WorkBuddy\\.tmp-kpnode-diag';
const UD = path.join(TMP, 'ud');
const DATA = path.join(TMP, 'data.json');
const REAL = 'D:/模拟题库';
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
  async eval(expr, timeoutMs = 90000) {
    const r = await Promise.race([
      this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('页面执行超时')), timeoutMs)),
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
  // 1) 准备隔离副本（真实题库拷一份，绝不改原件）
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(UD, { recursive: true });
  fs.copyFileSync(path.join(REAL, 'data.json'), DATA);
  fs.mkdirSync(path.join(TMP, 'banks'), { recursive: true });
  for (const f of fs.readdirSync(path.join(REAL, 'banks'))) {
    const src = path.join(REAL, 'banks', f);
    if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(TMP, 'banks', f));
  }
  fs.writeFileSync(path.join(UD, 'data-path.json'), JSON.stringify({ customPath: DATA }, null, 2));
  const realLS = path.join(process.env.APPDATA, 'moni-tiku', 'Local State');
  try { if (fs.existsSync(realLS)) fs.copyFileSync(realLS, path.join(UD, 'Local State')); } catch (e) { }

  const childEnv = { ...process.env, MTK_DEBUG_PORT: String(PORT) };
  delete childEnv.ELECTRON_RUN_AS_NODE;   // 本机环境带这个变量会让 Electron 以 Node 模式秒退
  const child = spawn(EXE, [APP_DIR, '--user-data-dir=' + UD], {
    env: childEnv, stdio: 'ignore', detached: false,
  });
  let cdp;
  const cleanup = () => { try { cdp && cdp.close(); } catch (e) { } try { child.kill(); } catch (e) { } };
  process.on('exit', cleanup);

  try {
    let list = null;
    for (let i = 0; i < 100; i++) {
      try { list = await getJson('/json/list'); if (list && (list.length || list.targetInfos)) break; } catch (e) { }
      await sleep(300);
    }
    const page = (Array.isArray(list) ? list : (list && list.targetInfos) || []).find(t => t.type === 'page');
    if (!page) throw new Error('找不到页面');
    cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await sleep(1000);

    // 等数据加载完
    let ready = null;
    for (let i = 0; i < 60; i++) {
      try {
        ready = await cdp.eval('(function(){return {v:typeof APP_VER!=="undefined"?APP_VER:"",n:(typeof state!=="undefined"&&state.questions)?state.questions.length:-1,view:typeof curView!=="undefined"?curView:""}})()', 8000);
        if (ready && ready.n > 100) break;
      } catch (e) { }
      await sleep(500);
    }
    console.log('启动状态:', JSON.stringify(ready));

    // 2) 数据层核对：这条笔记到底在不在内存里
    const data = await cdp.eval(`(async()=>{
      const q = state.questions.find(x => String(x.content||'').indexOf('石漠化') > -1);
      const bank = state.questions.find(x => x.note && String(x.note).trim());
      return {
        total: state.questions.length,
        found: q ? { id:q.id, kp:q.knowledge_point, note:(q.note||'').slice(0,30) } : null,
        notedCount: state.questions.filter(x => x.note && String(x.note).trim()).length,
        bankNote: bank ? { id:bank.id, kp:bank.knowledge_point, note:String(bank.note).slice(0,40) } : null,
        hasQNote: typeof qNote === 'function',
        qNoteOfBank: bank ? qNote(bank).slice(0,40) : '',
      };
    })()`);
    console.log('数据层:', JSON.stringify(data, null, 1));

    // 3) 图谱：节点是否存在、ids 是否包含该题
    const graph = await cdp.eval(`(async()=>{
      go('kp');
      await new Promise(r => setTimeout(r, 1200));
      const g = typeof kpGraph !== 'undefined' ? kpGraph : null;
      const names = g ? g.nodes.map(n => n.name) : [];
      const nd = g ? g.nodes.find(n => n.name === '石漠化治理') : null;
      const qid = ${data.bankNote ? data.bankNote.id : 0};
      const g2 = buildGraph();
      const kpSet = new Set();
      state.questions.forEach(q => splitKP(q.knowledge_point).forEach(k => kpSet.add(k)));
      return {
        nodeCount: names.length,
        buildAgain: g2.nodes.length,
        uniqKP: kpSet.size,
        emptyKP: state.questions.filter(q => !splitKP(q.knowledge_point).length).length,
        sampleKP: state.questions.slice(0, 3).map(q => q.knowledge_point),
        sampleNames: g2.nodes.slice(0, 8).map(n => n.name),
        sumSize: g2.nodes.reduce((a, n) => a + n.size, 0),
        subjMatch: state.questions.filter(q => matchSubject(q, kpSubject)).length,
        subjects: [...new Set(state.questions.map(q => q.subject))].slice(0, 6),
        subjects2: [...new Set(state.questions.map(q => q.subject_id))].slice(0, 6),
        hasNode: !!nd,
        nodeHit: !!nd && nd.ids.has(qid),
        nodeIds: nd ? [...nd.ids].slice(0, 5) : [],
        qidType: typeof qid,
        nameSample: names.filter(x => String(x).indexOf('石漠') > -1).slice(0, 3),
        subjectFilter: typeof kpSubject !== 'undefined' ? kpSubject : '(no)',
      };
    })()`);
    console.log('图谱:', JSON.stringify(graph, null, 1));

    // 4) 选中该知识点，看详情卡到底渲染了什么
    const detail = await cdp.eval(`(async()=>{
      selectKP('石漠化治理');
      await new Promise(r => setTimeout(r, 800));
      const d = document.getElementById('kpDetail');
      const html = d ? d.innerHTML : '';
      const box = document.getElementById('kpQNotes');
      return {
        hasDetail: !!d,
        len: html.length,
        hasBox: !!box,
        boxItems: box ? box.querySelectorAll('.q-item').length : 0,
        hasPill: html.indexOf('题目笔记') > -1,
        hasNoteText: html.indexOf('碳酸钙盐岩') > -1,
        count: typeof kpNoteCount === 'function' ? kpNoteCount('石漠化治理') : -1,
        snippet: html.slice(0, 300),
      };
    })()`);
    console.log('详情卡:', JSON.stringify(detail, null, 1));

    // 截图留档
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const outDir = path.join(ROOT, '教程');
    fs.writeFileSync(path.join(outDir, '诊断-图谱笔记.png'), Buffer.from(shot.data, 'base64'));
    console.log('截图:', path.join(outDir, '诊断-图谱笔记.png'));
    console.log('异常:', cdp.logs.slice(0, 5));
  } catch (e) {
    console.log('❌ 中断:', e && (e.stack || e.message));
  } finally {
    cleanup();
    setTimeout(() => process.exit(0), 300);
  }
})();
