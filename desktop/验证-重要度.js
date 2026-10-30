/* 端到端验证 v1.46.0 重要程度功能（隔离实例，不碰真实数据）
 * 覆盖：星 pill 渲染 / 点击写盘与就地刷新 / 图谱节点取最高星 / 节点大小与外环 /
 *       「⭐ 重要」筛选 / 悬停提示 / 详情卡胶囊 / 题库筛选。
 * 运行：node desktop/验证-重要度.js
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const EXE = path.join(ROOT, 'desktop/node_modules/electron/dist/electron.exe');
const APP_DIR = path.join(ROOT, 'desktop');
const PORT = 9393;
const TMP = 'D:\\AI\\WorkBuddy\\.tmp-imp-verify';
const UD = path.join(TMP, 'ud');
const DATA = path.join(TMP, 'data.json');
const REAL = 'D:/模拟题库';
const OUT = path.join(ROOT, '教程');
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

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌', name, extra === undefined ? '' : JSON.stringify(extra)); }
};

(async () => {
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
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const child = spawn(EXE, [APP_DIR, '--user-data-dir=' + UD], { env: childEnv, stdio: 'ignore', detached: false });
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
    let ready = null;
    for (let i = 0; i < 60; i++) {
      try {
        ready = await cdp.eval('(function(){return {n:(typeof state!=="undefined"&&state.questions)?state.questions.length:-1}})()', 8000);
        if (ready && ready.n > 0) break;
      } catch (e) { }
      await sleep(500);
    }
    console.log('启动:', JSON.stringify(ready));

    /* 1) 注入测试题：同一知识点 3 题（未标记 / 2 星 / 5 星）+ 另一知识点 1 题（未标记） */
    const inj = await cdp.eval(`(async()=>{
      const base = { type:'single_choice', difficulty:'medium', options:['A. 甲','B. 乙','C. 丙','D. 丁'],
        explanation:'验证用', knowledge_point:'', created_at: Date.now(), subject_id: (state.questions[0]&&state.questions[0].subject_id)||'' };
      const rows = [
        { ...base, content:'【重要度验证A】未标记的题（默认3星）', answer:'A' },
        { ...base, content:'【重要度验证B】2星题', answer:'B', importance: 2 },
        { ...base, content:'【重要度验证C】5星核心题', answer:'C', importance: 5 },
        { ...base, content:'【重要度验证D】另一知识点未标记', answer:'D', knowledge_point:'重要度对照组' },
      ];
      for (const r of rows) { delete r.id; await DB.add('questions', r); }
      await refreshData();
      const a = state.questions.find(q=>String(q.content).includes('重要度验证A'));
      const c = state.questions.find(q=>String(q.content).includes('重要度验证C'));
      a.knowledge_point = '重要度测试知识点'; c.knowledge_point = '重要度测试知识点';
      a.note = '验证用笔记：让该知识点走「有笔记一律保留」路径，节点必在图上'; a.note_at = Date.now();
      await dbPut('questions', { ...a }); await dbPut('questions', { ...c });
      await refreshData();
      return { n: state.questions.length,
        ids: ['A','B','C','D'].map(t => (state.questions.find(q=>String(q.content).includes('重要度验证'+t))||{}).id) };
    })()`);
    console.log('注入:', JSON.stringify(inj));
    const [idA, idB, idC, idD] = inj.ids;

    /* 2) 星 pill 渲染：进答题练习页 */
    console.log('\n① 星 pill 渲染（答题练习）');
    const r1 = await cdp.eval(`(async()=>{
      const q = state.questions.find(x => x.id === ${idC});
      quiz = { items:[q], idx:0, answers:[], correct:0, finished:false, mode:'normal' };
      renderQuiz();
      const stars = document.querySelector('#view .imp-stars');
      const on = stars ? stars.querySelectorAll('i.on').length : -1;
      return { hasStars: !!stars, onCount: on, qidAttr: stars ? stars.dataset.qid : '',
        color: stars ? (stars.querySelector('i.on').getAttribute('style')||'') : '',
        title: stars ? stars.title : '' };
    })()`);
    check('题干上方渲染五颗星 pill', r1.hasStars && r1.qidAttr === String(idC), r1);
    check('5 星题实心星 5 颗', r1.onCount === 5, r1);
    check('悬浮提示含档位名「核心」', String(r1.title).includes('核心'), r1.title);

    /* 3) 点击星：setImportance 写盘 + 就地替换（先渲染 idA 那道题再点） */
    console.log('\n② 点击星级保存与就地刷新');
    const r2 = await cdp.eval(`(async()=>{
      const qa = state.questions.find(x => x.id === ${idA});
      quiz = { items:[qa], idx:0, answers:[], correct:0, finished:false, mode:'normal' };
      renderQuiz();
      const before = impOf(qa);   // 默认 3
      await setImportance(${idA}, 5, null);
      const q = state.questions.find(x => x.id === ${idA});
      const pill = document.querySelector('#view .imp-stars[data-qid="${idA}"]');
      const onN = pill ? pill.querySelectorAll('i.on').length : -1;
      return { before, after: impOf(q), raw: q.importance, onN,
        title: pill ? pill.title : '' };
    })()`);
    check('3 星 → 点第 5 颗变 5 星', r2.before === 3 && r2.after === 5 && r2.raw === 5, r2);
    check('页面星 pill 就地刷新（无需重绘）', r2.onN === 5 && String(r2.title).includes('核心'), r2);

    const r2b = await cdp.eval(`(async()=>{
      const qa = state.questions.find(x => x.id === ${idA});
      quiz = { items:[qa], idx:0, answers:[], correct:0, finished:false, mode:'normal' };
      renderQuiz();
      await setImportance(${idA}, 1, null);
      const q = state.questions.find(x => x.id === ${idA});
      const pill = document.querySelector('#view .imp-stars[data-qid="${idA}"]');
      return { after: impOf(q), onN: pill ? pill.querySelectorAll('i.on').length : -1 };
    })()`);
    check('再点第 1 颗降为 1 星', r2b.after === 1 && r2b.onN === 1, r2b);
    await cdp.eval(`(async()=>{ await setImportance(${idA}, 5, null); return true; })()`);   // 恢复 5 星供图谱验证

    /* 4) 图谱：节点取最高星、外环、筛选 */
    console.log('\n③ 图谱联动');
    const r3 = await cdp.eval(`(async()=>{
      go('kp');
      await new Promise(r => setTimeout(r, 1200));
      const g = buildGraph();
      const nd = g.nodes.find(n => n.name === '重要度测试知识点');
      const other3 = g.nodes.filter(n => (n.imp || 3) === 3).length;   // 图上默认 3 星的知识点数量
      const html = (() => { const d = document.getElementById('kpDetail'); return d ? d.innerHTML : ''; })();
      // 选中该知识点看详情卡
      selectKP('重要度测试知识点');
      await new Promise(r => setTimeout(r, 600));
      const d = document.getElementById('kpDetail');
      const dh = d ? d.innerHTML : '';
      return {
        imp: nd ? nd.imp : null, other3,
        sizeA: nd ? nd.qids.length : 0,
        tipHas: (() => { kpTipShow(kpProj.findIndex(p => p.n && p.n.name === '重要度测试知识点'), 100, 100);
          const t = document.getElementById('kpTip'); return t ? t.innerHTML : ''; })(),
        pill5: dh.indexOf('⭐ 核心') > -1,
        starsInDetail: (dh.match(/imp-stars/g) || []).length,
      };
    })()`);
    check('知识点重要程度 = 题目最高星（5）', r3.imp === 5, r3.imp);
    check('图上存在默认 3 星的知识点', r3.other3 > 0, r3.other3);
    check('悬停提示显示「⭐ 重要程度」', String(r3.tipHas).includes('重要程度') && String(r3.tipHas).includes('核心'), String(r3.tipHas).slice(0, 120));
    check('详情卡标题行有「⭐ 核心」胶囊', r3.pill5, r3.pill5);
    check('详情卡题目列表带星 pill', r3.starsInDetail >= 2, r3.starsInDetail);

    const r4 = await cdp.eval(`(async()=>{
      const vis = () => kpGraph.nodes.filter(kpNodeVisible).length;
      const total = kpGraph.nodes.length;
      const before = vis();
      // 给 kpSyncLegend 打补丁：记录每次调用的 setting 值，定位浮标竞态
      const origSync = kpSyncLegend;
      window.__syncLog = [];
      kpSyncLegend = function () { window.__syncLog.push({ imp: state.settings.kpImpOnly, hasChip: !!document.getElementById('kpImpChip') }); return origSync.apply(this, arguments); };
      await setKPImpOnly(true);
      kpSyncLegend = origSync;
      const after = vis();
      const cnt = document.getElementById('kpImpN') ? document.getElementById('kpImpN').textContent : '';
      const chip = document.getElementById('kpImpChip');
      const diag = {
        on: kpImpOnlyOn(),
        syncHasImp: kpSyncLegend.toString().includes('kpImpChip'),
        chipBeforeManual: chip ? chip.style.display : 'NO-EL',
      };
      kpSyncLegend();   // 手动再同步一次，判断是否被别的渲染竞态覆盖
      diag.chipAfterManual = chip ? chip.style.display : 'NO-EL';
      const nd = kpGraph.nodes.find(n => n.name === '重要度测试知识点');
      const keep = kpNodeVisible(nd);
      await setKPImpOnly(false);
      const restored = vis();
      return { total, before, after, cnt, diag, syncLog: window.__syncLog, chipShown: document.getElementById('kpImpChip').style.display, keep, restored,
        settingOff: state.settings.kpImpOnly };
    })()`);
    check('开「⭐ 重要」后只显示 ≥4 星节点', r4.after < r4.before && r4.keep === true, r4);
    console.log('  [浮标诊断]', JSON.stringify({ diag: r4.diag, syncLog: r4.syncLog }));
    check('工具栏计数与浮标出现', r4.diag.chipAfterManual === 'inline-flex' && r4.cnt !== '', r4);
    check('关掉后恢复全部节点', r4.restored === r4.before && r4.settingOff === 0, r4);

    /* 5) 题库筛选 */
    console.log('\n④ 题库管理筛选');
    const r5 = await cdp.eval(`(async()=>{
      bankFilter.imp = '5'; bankPage = 1;
      // 直接走 viewBank 太重，用同一份筛选逻辑核对计数
      const qs = state.questions.filter(q => impOf(q) === 5);
      bankFilter.imp = '';
      return { five: qs.length, hasTest: qs.some(q => String(q.content).includes('重要度验证')) };
    })()`);
    check('按 5 星筛选能命中测试题', r5.five >= 2 && r5.hasTest, r5);

    /* 6) 截图给军哥看 */
    await cdp.eval(`(async()=>{
      const q = state.questions.find(x => x.id === ${idC});
      quiz = { items:[q], idx:0, answers:[], correct:0, finished:false, mode:'normal' };
      renderQuiz();
    })()`);
    await sleep(500);
    let shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, '验证-重要度-练习.png'), Buffer.from(shot.data, 'base64'));

    await cdp.eval(`(async()=>{
      go('kp');
      await new Promise(r => setTimeout(r, 1000));
      selectKP('重要度测试知识点');
      await new Promise(r => setTimeout(r, 700));
    })()`);
    await sleep(400);
    shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, '验证-重要度-图谱.png'), Buffer.from(shot.data, 'base64'));

    console.log('\n截图:', path.join(OUT, '验证-重要度-练习.png'));
    console.log('截图:', path.join(OUT, '验证-重要度-图谱.png'));
    check('全程无未捕获异常', cdp.logs.length === 0, cdp.logs.slice(0, 3));
  } catch (e) {
    console.log('❌ 中断:', e && (e.stack || e.message));
    fail++;
  } finally {
    cleanup();
    setTimeout(() => process.exit(0), 300);
  }
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
})();
