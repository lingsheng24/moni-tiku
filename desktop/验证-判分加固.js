/* 验证 v1.42.1 判分加固：写库失败 / AI 超时 时不能卡在「判分中…」
 * 运行：node desktop/验证-判分加固.js
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTML_URL = 'file:///' + encodeURI(ROOT + '/模拟题库-Web版.html').replace(/#/g, '%23');
const PORT = 9366;
const PROFILE = path.join(ROOT, '教程/.edge-profile-guard');
const sleep = ms => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url); this.id = 0; this.pending = new Map(); this.logs = [];
    this.ready = new Promise((res, rej) => { this.ws.onopen = () => res(); this.ws.onerror = () => rej(new Error('ws fail')); });
    this.ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
      else if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; this.logs.push('[EXC] ' + ((d.exception && d.exception.description) || d.text)); }
    };
  }
  async send(method, params = {}) {
    await this.ready; const id = ++this.id;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result && r.result.value;
  }
  close() { try { this.ws.close(); } catch (e) { } }
}
async function waitJson(url, tries = 80) {
  for (let i = 0; i < tries; i++) { try { const r = await fetch(url); if (r.ok) return await r.json(); } catch (e) { } await sleep(300); }
  throw new Error('等不到 ' + url);
}

(async () => {
  fs.mkdirSync(PROFILE, { recursive: true });
  const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-sync', '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + PORT,
    '--window-size=1480,940', 'about:blank'], { stdio: 'ignore' });
  let cdp;
  const cleanup = () => { try { cdp && cdp.close(); } catch (e) { } try { edge.kill(); } catch (e) { } };
  process.on('exit', cleanup);
  try {
    await waitJson('http://127.0.0.1:' + PORT + '/json/version');
    const list = await waitJson('http://127.0.0.1:' + PORT + '/json/list');
    const page = (Array.isArray(list) ? list : []).find(t => t.type === 'page');
    cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    await cdp.send('Page.navigate', { url: HTML_URL });
    await sleep(3500);
    await cdp.eval(`(function(){ window.confirm=()=>true; window.alert=()=>{}; window.__errs=[];
      window.addEventListener('unhandledrejection', e => __errs.push('rejection: '+((e.reason&&(e.reason.stack||e.reason.message))||e.reason)));
      window.onerror=(m,s,l,c,err)=>{__errs.push('error: '+((err&&err.stack)||m));return true;}; return 'ok'; })()`);

    console.log('0) withTimeoutP 是否生效:', await cdp.eval(`(async()=>{
      const t0=Date.now();
      const r = await withTimeoutP(new Promise(()=>{}), 300, 'FALLBACK');
      return { result:r, ms: Date.now()-t0 };
    })()`));

    await cdp.eval(`(async()=>{
      const base={document_id:0,difficulty:'easy',created_at:Date.now(),knowledge_point:'加固验证'};
      await DB.add('questions',{...base,type:'single_choice',content:'加固题1',options:['A. 甲','B. 乙'],answer:'A'});
      await DB.add('questions',{...base,type:'short_answer',content:'加固简答题',answer:'参考答案内容'});
      await refreshData(); return state.questions.length;
    })()`);

    console.log('\n1) 复习判分：写 practice 失败时', await cdp.eval(`(async()=>{
      const q = [...state.questions].reverse().find(x=>x.type==='single_choice');
      const orig = DB.add;
      DB.add = (s,v)=> s==='practice' ? Promise.reject(new Error('模拟磁盘写入失败')) : orig(s,v);
      try {
        await addReviewCards([q.id]);
        const card = state.reviews.find(c=>c.question_id===q.id);
        startReview([card]);
        document.querySelector('#revAnswerArea .opt-click').click();
        await submitRevSession();
        const judge = (document.querySelector('#revJudge')||{}).textContent||'';
        const btn = document.querySelector('#revSubmit');
        return { 判分结果是否显示: /回答(正确|错误)/.test(judge), 按钮文案: btn && btn.textContent, 按钮是否仍禁用: btn && btn.disabled };
      } finally { DB.add = orig; }
    })()`));

    console.log('\n2) 考试交卷：写 exams 失败时', await cdp.eval(`(async()=>{
      const qs = state.questions.filter(q=>q.type==='single_choice').slice(-2);
      const orig = DB.add;
      DB.add = (s,v)=> s==='exams' ? Promise.reject(new Error('模拟考试记录写入失败')) : orig(s,v);
      try {
        exam = { cfg:{types:['single_choice'],diffs:[],count:qs.length}, items:qs, idx:0, answers:{}, marked:new Set(),
          name:'加固验证考试', minutes:0, startedAt:Date.now()-10000, deadline:0, finished:false, results:[] };
        qs.forEach(q=>exam.answers[q.id]=q.answer);
        await submitExam(false);
        const btn = document.querySelector('#examSubmitBtn');
        return { 按钮文案: btn && btn.textContent, 按钮可点: btn && !btn.disabled, exam仍可重试: !!(exam && !exam.finished), 锁已释放: !!(exam && !exam.__grading) };
      } finally { DB.add = orig; }
    })()`));

    console.log('\n3) 重试交卷应能成功:', await cdp.eval(`(async()=>{
      const before = state.exams.length;
      if (!exam) return { skip:'exam 已清空' };
      await submitExam(false);
      return { 交卷成功: /成绩报告/.test((document.querySelector('#view h1')||{}).textContent||''), 记录数: state.exams.length - before };
    })()`));

    console.log('\n4) 页面未捕获异常:', await cdp.eval('JSON.stringify(window.__errs||[])'));
    if (cdp.logs.length) console.log('CDP 异常:', cdp.logs.slice(-10).join('\n'));
  } catch (e) {
    console.error('验证失败:', e.message);
    if (cdp) console.error(cdp.logs.slice(-10).join('\n'));
  } finally { cleanup(); await sleep(300); process.exit(0); }
})();
