/* 验证 v1.43.0 题目笔记：复习会话写笔记 → 评分翻卡 → 重新进入仍保留；卡片管理/题库弹窗同样可用
 * 运行：node desktop/验证-笔记.js
 * 手法：Edge headless 打开网页版（与桌面版同一份逻辑），注入题目与复习卡后真跑 UI 交互。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTML_URL = 'file:///' + encodeURI(ROOT + '/模拟题库-Web版.html').replace(/#/g, '%23');
const PORT = 9366;
const PROFILE = path.join(ROOT, '教程/.edge-profile-note');
const sleep = ms => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0; this.pending = new Map(); this.logs = [];
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
      }
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
      throw new Error((d.exception && (d.exception.description || d.exception.value)) || d.text);
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

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
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

    const boot = await cdp.eval(`(function(){
      window.confirm = () => true; window.alert = () => {}; window.prompt = () => '';
      window.__errs = [];
      window.addEventListener('unhandledrejection', e => __errs.push('unhandledrejection: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)));
      window.onerror = (m, s, l, c, err) => { __errs.push('onerror: ' + (err && err.stack || m)); return true; };
      return { ver: APP_VER, desktop: IS_DESKTOP, hasQNote: typeof qNoteHTML === 'function' };
    })()`);
    check('页面载入且已含笔记能力', boot.hasQNote === true, boot);

    // 造两道题并加入复习队列
    const prep = await cdp.eval(`(async()=>{
      const base = { document_id: 0, difficulty: 'easy', created_at: Date.now(), knowledge_point: '笔记验证' };
      const q1 = await DB.add('questions', { ...base, type:'single_choice', content:'笔记验证题一：1+1=?', options:['A. 1','B. 2'], answer:'B' });
      const q2 = await DB.add('questions', { ...base, type:'short_answer', content:'笔记验证题二：简述光合作用。', answer:'植物把光能转成化学能' });
      await refreshData();
      await addReviewCards([q1, q2]);
      await refreshData();
      return { q1, q2, cards: state.reviews.length };
    })()`);
    check('题目与复习卡准备完成', prep.cards >= 2, prep);

    // 1) 复习会话：输入笔记 → 防抖自动保存
    const typed = await cdp.eval(`(async()=>{
      const card = state.reviews.find(c => c.question_id === ${prep.q1});
      const other = state.reviews.find(c => c.question_id === ${prep.q2});
      startReview([card, other]);   // 放两张，评分后会话仍在，便于验证「翻卡后笔记仍存活」
      const ta = document.querySelector('#qn-sess' + card.id);
      if (!ta) return { ok:false, msg:'笔记框没渲染', html: document.querySelector('#view').innerHTML.slice(0,200) };
      const hadValue = ta.value;
      ta.value = '  选 B：1+1=2，别被选项顺序骗  ';
      ta.dispatchEvent(new Event('input', { bubbles:true }));
      await new Promise(r => setTimeout(r, 1400));   // 等 900ms 防抖
      const saved = await DB.get('questions', ${prep.q1});
      return { ok:true, hadValue, note: saved && saved.note, noteAt: saved && saved.note_at, tip: (document.querySelector('#qnt-sess' + card.id)||{}).textContent };
    })()`);
    check('会话内输入笔记自动保存（含 trim）', typed.ok && typed.note === '选 B：1+1=2，别被选项顺序骗', typed);

    // 2) 点评分翻下一张：笔记必须先落盘，且卡片调度正常推进
    const rated = await cdp.eval(`(async()=>{
      const before = rev.items[rev.idx].question_id;
      await rateRev(3);
      await new Promise(r => setTimeout(r, 200));
      const saved = await DB.get('questions', ${prep.q1});
      return { ok:true, before, idxNow: rev.idx, rated: rev.rated, note: saved && saved.note };
    })()`);
    check('评分翻卡前笔记落盘且调度推进', rated.note === '选 B：1+1=2，别被选项顺序骗' && rated.idxNow === 1, rated);

    // 3) 再次进入同一张卡：笔记回显 + 有笔记标记
    const revisit = await cdp.eval(`(async()=>{
      await refreshData();
      const card = state.reviews.find(c => c.question_id === ${prep.q1});
      startReview([card]);
      const ta = document.querySelector('#qn-sess' + card.id);
      const pills = [...document.querySelectorAll('.rev-chip .pill')].map(e => e.textContent.trim());
      return { ok:true, value: ta && ta.value, pills };
    })()`);
    check('重新进入复习，笔记原样回显', revisit.value === '选 B：1+1=2，别被选项顺序骗', revisit);
    check('卡片上显示「📝 已记笔记」', (revisit.pills || []).some(p => p.includes('已记笔记')), revisit.pills);

    // 4) 卡片管理：表格标记 + 行内笔记框
    const mgr = await cdp.eval(`(async()=>{
      rev = null;
      await viewReview();
      const rows = document.querySelector('#view').innerHTML;
      const hasPill = rows.includes('📝 有笔记');
      const card = state.reviews.find(c => c.question_id === ${prep.q1});
      toggleRevAns(card.id);
      await new Promise(r => setTimeout(r, 100));
      const ta = document.querySelector('#qn-rv' + card.id);
      return { ok:true, hasPill, boxExists: !!ta, value: ta && ta.value };
    })()`);
    check('卡片管理列表标注「📝 有笔记」', mgr.hasPill === true, mgr);
    check('卡片管理行内答题区带笔记框且回显', mgr.boxExists === true && mgr.value === '选 B：1+1=2，别被选项顺序骗', mgr);

    // 5) 题库管理：弹窗编辑笔记并即时更新卡片展示
    const bank = await cdp.eval(`(async()=>{
      await viewBank();
      const html = document.querySelector('#view').innerHTML;
      const hasBtn = html.includes('onclick="editQNote(');
      editQNote(${prep.q2});
      await new Promise(r => setTimeout(r, 100));
      const ta = document.querySelector('#qnEdit');
      if (!ta) return { ok:false, msg:'弹窗没渲染' };
      ta.value = '光合作用 = 光能 → 化学能，记成「光进水出」';
      document.querySelector('#qnSave').click();
      await new Promise(r => setTimeout(r, 300));
      const saved = await DB.get('questions', ${prep.q2});
      return { ok:true, hasBtn, note: saved && saved.note };
    })()`);
    check('题库管理提供「📝 笔记」入口', bank.hasBtn === true, bank);
    check('弹窗保存笔记写库成功', bank.note === '光合作用 = 光能 → 化学能，记成「光进水出」', bank);

    // 6) 清空笔记：note 归零、卡片标记消失
    const cleared = await cdp.eval(`(async()=>{
      await saveQNote(${prep.q1}, '');
      const saved = await DB.get('questions', ${prep.q1});
      return { ok:true, note: saved && saved.note, noteAt: saved && saved.note_at };
    })()`);
    check('清空笔记：note 为空、note_at 归零', cleared.note === '' && cleared.noteAt === 0, cleared);

    // 7) 搜索能命中笔记内容
    const search = await cdp.eval(`(async()=>{
      await saveQNote(${prep.q1}, '关键词测试：边际效用递减');
      await viewBank();
      bankFilter.kw = '边际效用递减';
      await viewBank();
      const html = document.querySelector('#view').innerHTML;
      return { ok:true, hit: html.includes('笔记验证题一') };
    })()`);
    check('题库搜索可命中笔记内容', search.hit === true, search);

    // 8) 答题练习：切题前强制落盘（不等防抖）
    const prac = await cdp.eval(`(async()=>{
      const a = state.questions.find(x => x.id === ${prep.q1});
      const b = state.questions.find(x => x.id === ${prep.q2});
      quiz = { items: [a, b], idx: 0, answers: [], correct: 0 };
      renderQuiz();
      const ta = document.querySelector('#qn-quiz' + a.id);
      if (!ta) return { ok:false, msg:'练习题没渲染笔记框', html: document.querySelector('#view').innerHTML.slice(0,200) };
      const pre = ta.value;
      ta.value = '练习笔记：先算括号再乘除';
      ta.dispatchEvent(new Event('input', { bubbles:true }));
      await goQuestion(1);   // 立刻切题，不等 900ms 防抖
      const savedA = await DB.get('questions', a.id);
      const tb = document.querySelector('#qn-quiz' + b.id);
      tb.value = '练习笔记二：光合作用';
      tb.dispatchEvent(new Event('input', { bubbles:true }));
      await submitAnswer(b);   // 提交答案前也要落盘
      const savedB = await DB.get('questions', b.id);
      return { ok:true, pre, noteA: savedA && savedA.note, noteB: savedB && savedB.note, idx: quiz.idx };
    })()`);
    check('练习页渲染笔记框并回显旧笔记', prac.ok === true && prac.pre === '关键词测试：边际效用递减', prac);
    check('练习切题前强制落盘', prac.noteA === '练习笔记：先算括号再乘除', prac);
    check('练习提交答案前强制落盘', prac.noteB === '练习笔记二：光合作用', prac);

    // 9) 页面无未捕获异常
    const errs = await cdp.eval('window.__errs');
    check('全程无未捕获异常', Array.isArray(errs) && errs.length === 0, errs || []);

    const logs = cdp.logs.filter(l => l.startsWith('[exception]'));
    check('控制台无异常日志', logs.length === 0, logs.slice(0, 3));
  } catch (e) {
    console.log('❌ 验证中断：', e && (e.stack || e.message));
    process.exitCode = 1;
  } finally {
    const bad = results.filter(r => !r.pass).length;
    console.log(`\n===== 合计 ${results.length} 项，通过 ${results.length - bad} 项，失败 ${bad} 项 =====`);
    cleanup();
    setTimeout(() => process.exit(bad ? 1 : 0), 200);
  }
})();
