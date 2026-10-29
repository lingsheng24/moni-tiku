/* 诊断：模拟考试交卷判分 / 复习卡片判分 为什么会中断
 * 运行：node desktop/诊断-判分.js
 * 手法：Edge headless 打开网页版（逻辑与桌面版共用），注入题目与复习卡，真跑 submitExam / submitRevSession。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTML_URL = 'file:///' + encodeURI(ROOT + '/模拟题库-Web版.html').replace(/#/g, '%23');
const PORT = 9355;
const PROFILE = path.join(ROOT, '教程/.edge-profile-diag');
const sleep = ms => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0; this.pending = new Map(); this.handlers = []; this.logs = [];
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
        this.logs.push('[exception] ' + (d.exception && (d.exception.description || d.exception.value) || d.text));
      } else this.handlers.forEach(h => h(m));
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
      const desc = (d.exception && (d.exception.description || d.exception.value)) || d.text;
      const e = new Error(desc); e.page = true; throw e;
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
  fs.mkdirSync(PROFILE, { recursive: true });
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-sync', '--disable-features=Translate,MediaRouter',
    '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + PORT, '--window-size=1480,940', 'about:blank',
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
    await cdp.send('Page.navigate', { url: HTML_URL });
    await sleep(3500);

    // 0) 准备：静音对话框 + 收集未捕获异常
    console.log('页面载入:', await cdp.eval(`(function(){
      window.confirm = () => true; window.alert = () => {}; window.prompt = () => '';
      window.__errs = [];
      window.addEventListener('unhandledrejection', e => __errs.push('unhandledrejection: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)));
      window.onerror = (m, s, l, c, err) => { __errs.push('onerror: ' + (err && err.stack || m)); return true; };
      return 'ok ver=' + APP_VER + ' desktop=' + IS_DESKTOP;
    })()`));

    // 1) 造题：单选 / 多选 / 判断 / 填空 / 简答
    console.log('注入题目:', await cdp.eval(`(async()=>{
      const made = [];
      const base = { document_id: 0, difficulty: 'easy', created_at: Date.now(), knowledge_point: '诊断知识点' };
      made.push(await DB.add('questions', { ...base, type:'single_choice', content:'1+1=?', options:['A. 1','B. 2','C. 3'], answer:'B' }));
      made.push(await DB.add('questions', { ...base, type:'multiple_choice', content:'哪些是偶数？', options:['A. 2','B. 3','C. 4'], answer:'AC' }));
      made.push(await DB.add('questions', { ...base, type:'true_false', content:'地球是圆的。', options:['正确','错误'], answer:'正确' }));
      made.push(await DB.add('questions', { ...base, type:'fill_blank', content:'中国的首都是____。', answer:'北京' }));
      made.push(await DB.add('questions', { ...base, type:'short_answer', content:'简述牛顿第一定律。', answer:'物体在不受外力时保持静止或匀速直线运动' }));
      await refreshData();
      return { ids: made, total: state.questions.length };
    })()`));

    // 2) 模拟考试交卷（全客观题，答对）
    console.log('考试交卷:', await cdp.eval(`(async()=>{
      const qs = state.questions.filter(q => q.type !== 'short_answer' && q.type !== 'fill_blank');
      exam = { cfg:{ types:['single_choice','multiple_choice','true_false'], diffs:['easy'], count: qs.length },
        items: qs, idx: 0, answers: {}, marked: new Set(), name:'诊断考试',
        minutes: 0, startedAt: Date.now() - 60000, deadline: 0, finished: false, results: [] };
      exam.answers[qs[0].id] = 'B';
      exam.answers[qs[1].id] = 'AC';
      exam.answers[qs[2].id] = '正确';
      try {
        await submitExam(false);
        return { ok:true, record: exam && exam.record ? { obtained: exam.record.obtained, total: exam.record.total, n: exam.record.results.length } : 'no record', errs: __errs };
      } catch (e) { return { ok:false, stage:'submitExam', error: e && e.stack || String(e), errs: __errs }; }
    })()`));

    // 2b) 用填空 + 简答走一遍（会走 confirm 自评路径）
    console.log('考试交卷(含主观):', await cdp.eval(`(async()=>{
      const qs = state.questions.filter(q => q.type === 'fill_blank' || q.type === 'short_answer');
      exam = { cfg:{ types:['fill_blank','short_answer'], diffs:['easy'], count: qs.length },
        items: qs, idx: 0, answers: {}, marked: new Set(), name:'诊断考试2',
        minutes: 0, startedAt: Date.now() - 30000, deadline: 0, finished: false, results: [] };
      exam.answers[qs[0].id] = '北京';
      exam.answers[qs[1].id] = '物体不受力时保持静止或匀速直线运动';
      try {
        await submitExam(false);
        return { ok:true, record: exam && exam.record ? { obtained: exam.record.obtained, total: exam.record.total } : 'no record', errs: __errs };
      } catch (e) { return { ok:false, stage:'submitExam-subjective', error: e && e.stack || String(e), errs: __errs }; }
    })()`));

    // 3) 复习判分：加入卡片 → 开始一轮 → 选答案 → 提交 → 评分
    console.log('复习判分:', await cdp.eval(`(async()=>{
      const q = state.questions.find(x => x.type === 'single_choice');
      try {
        await addReviewCards([q.id]);
        const card = state.reviews.find(c => c.question_id === q.id);
        if (!card) return { ok:false, stage:'addReviewCards', msg:'卡片没进队列', errs: __errs };
        startReview([card]);
        if (!rev) return { ok:false, stage:'startReview', msg:'rev 未建立', errs: __errs };
        const el = document.querySelector('#revAnswerArea .opt-click');
        if (!el) return { ok:false, stage:'render', msg:'选项没渲染', html: (document.querySelector('#revAnswerArea')||{}).innerHTML };
        el.click();
        const btn = document.querySelector('#revSubmit');
        await submitRevSession();
        const judged = (document.querySelector('#revJudge')||{}).textContent || '';
        const rateBtns = document.querySelectorAll('.rate-btn');
        if (rateBtns.length) rateBtns[1].click();
        await new Promise(r => setTimeout(r, 400));
        return { ok:true, judged: judged.slice(0,80), rateBtns: rateBtns.length, errs: __errs };
      } catch (e) { return { ok:false, stage:'review', error: e && e.stack || String(e), errs: __errs }; }
    })()`));

    // 4) 逐题卡片式复习（题库里「复习」按钮那条路径）
    console.log('逐题复习: ', await cdp.eval(`(async()=>{
      const q = state.questions.find(x => x.type === 'multiple_choice');
      try {
        await reviewQuestion(q.id);          // 加卡 + 跳转
        const card = state.reviews.find(c => c.question_id === q.id);
        if (!card) return { ok:false, stage:'reviewQuestion', msg:'卡片不存在', errs: __errs };
        startReview([card]);
        const el = document.querySelector('#revAnswerArea .opt-click');
        if (el) el.click();
        await submitRevSession();
        const judged = (document.querySelector('#revJudge')||{}).textContent || '';
        return { ok:true, judged: judged.slice(0,80), errs: __errs };
      } catch (e) { return { ok:false, stage:'reviewQuestion', error: e && e.stack || String(e), errs: __errs }; }
    })()`));

    console.log('\n===== 控制台/异常日志 =====');
    console.log(cdp.logs.slice(-40).join('\n') || '(空)');
    console.log('\n===== 页面未捕获异常 =====');
    console.log(await cdp.eval('JSON.stringify(window.__errs || [])'));
  } catch (e) {
    console.error('诊断脚本失败:', e.message);
    if (cdp && cdp.logs.length) console.error('页面日志:\n' + cdp.logs.slice(-30).join('\n'));
  } finally {
    cleanup();
    await sleep(400);
    process.exit(0);
  }
})();
