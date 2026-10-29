/* 验证 v1.44.0 笔记归入知识库：题目笔记在知识库里的收集、检索、看原题、编辑回写、删除
 * 运行：node desktop/验证-知识库笔记.js
 * 手法：Edge headless 打开网页版（与桌面版同一份逻辑），注入题目后真跑知识库页面 UI。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTML_URL = 'file:///' + encodeURI(ROOT + '/模拟题库-Web版.html').replace(/#/g, '%23');
const PORT = 9367;
const PROFILE = path.join(ROOT, '教程/.edge-profile-kb');
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
      return { ver: APP_VER, hasKb: typeof kbAllNotes === 'function', hasQn: !!(KB_KIND && KB_KIND.qn), kindLabel: KB_KIND.qn && KB_KIND.qn.label };
    })()`);
    check('页面载入且知识库含题目笔记类型', boot.hasKb && boot.hasQn && boot.kindLabel === '题目笔记', boot);

    // 造题：两道有笔记、一道没笔记
    const prep = await cdp.eval(`(async()=>{
      const base = { document_id: 0, difficulty: 'easy', created_at: Date.now() };
      const q1 = await DB.add('questions', { ...base, type:'single_choice', knowledge_point:'知识库验证A', content:'知识库验证题一：环比与同比的区别？', options:['A. 基期不同','B. 完全相同'], answer:'A' });
      const q2 = await DB.add('questions', { ...base, type:'short_answer', knowledge_point:'知识库验证B、二级知识点', content:'知识库验证题二：简述牛顿第二定律。', answer:'F=ma' });
      const q3 = await DB.add('questions', { ...base, type:'single_choice', knowledge_point:'知识库验证C', content:'知识库验证题三：这道题不写笔记。', options:['A. 一','B. 二'], answer:'A' });
      await refreshData();
      await saveQNote(q1, '环比看相邻期，同比看去年同期');
      await saveQNote(q2, '口诀：力等于质量乘加速度');
      await refreshData();
      return { q1, q2, q3, total: state.questions.length };
    })()`);
    check('三道题准备完成，两道已写笔记', prep.total >= 3, prep);

    // 1) 打开知识库：统计卡数字 + 列表卡片
    const pageKb = await cdp.eval(`(async()=>{
      go('kb');
      await new Promise(r => setTimeout(r, 500));
      const stats = [...document.querySelectorAll('.stat')].map(s => ({
        lbl: (s.querySelector('.lbl')||{}).textContent, num: (s.querySelector('.num')||{}).textContent
      }));
      const cards = [...document.querySelectorAll('.kb-note')].map(c => ({
        pills: [...c.querySelectorAll('.pill')].map(p => p.textContent.trim()),
        txt: (c.querySelector('.kb-note-txt')||{}).textContent,
        qline: (c.querySelector('.kb-note-q')||{}).textContent,
        btns: [...c.querySelectorAll('button')].map(b => b.textContent.trim()),
      }));
      return { stats, cards, qnStat: (stats.find(s => s.lbl === '题目笔记')||{}).num };
    })()`);
    check('统计卡有「题目笔记」且数量正确', pageKb.qnStat === '2', pageKb.stats);
    const qnCards = (pageKb.cards || []).filter(c => (c.pills || []).some(p => p.includes('题目笔记')));
    check('列表里出现两条题目笔记卡片', qnCards.length === 2, { count: qnCards.length, cards: pageKb.cards.map(c => c.pills) });
    check('卡片显示题干摘要与题型', (qnCards[0] || {}).qline && /知识库验证题/.test(qnCards[0].qline), (qnCards[0] || {}).qline);
    check('卡片有「看原题」「编辑」「删除」按钮',
      qnCards[0] && ['📖 看原题', '✏️ 编辑', '删除'].every(b => qnCards[0].btns.includes(b)), (qnCards[0] || {}).btns);

    // 2) 看原题弹窗
    const orig = await cdp.eval(`(async()=>{
      kbShowQuestion(${prep.q1});
      await new Promise(r => setTimeout(r, 200));
      const m = document.querySelector('#modal').textContent;
      return { hasContent: m.includes('知识库验证题一'), hasAnswer: m.includes('基期不同'), hasNote: m.includes('环比看相邻期'), hasReview: m.includes('复习这道题') };
    })()`);
    check('「看原题」弹窗含题干 / 答案 / 笔记 / 复习入口',
      orig.hasContent && orig.hasAnswer && orig.hasNote && orig.hasReview, orig);
    await cdp.eval('closeModal()');

    // 3) 编辑题目笔记 → 写回原题
    const edit = await cdp.eval(`(async()=>{
      kbEditNote('qn:${prep.q1}');
      await new Promise(r => setTimeout(r, 200));
      const kpBox = document.querySelector('#kbEKP');
      const ta = document.querySelector('#kbEText');
      const before = ta && ta.value;
      const kpDisabled = !!(kpBox && kpBox.disabled);
      ta.value = '改过的笔记：同比=去年同期';
      document.querySelector('.modal .primary').click();
      await new Promise(r => setTimeout(r, 700));
      const saved = await DB.get('questions', ${prep.q1});
      const cardTxt = [...document.querySelectorAll('.kb-note')].map(c => (c.querySelector('.kb-note-txt')||{}).textContent);
      return { before, kpDisabled, note: saved && saved.note, cardTxt, modalClosed: document.querySelector('#modal').textContent.trim() === '' };
    })()`);
    check('编辑器回填原笔记、知识点框只读', edit.before === '环比看相邻期，同比看去年同期' && edit.kpDisabled === true, { before: edit.before, kpDisabled: edit.kpDisabled });
    check('编辑保存后写回原题（questions.note）', edit.note === '改过的笔记：同比=去年同期', { note: edit.note });
    check('知识库卡片同步显示新内容', (edit.cardTxt || []).some(t => t === '改过的笔记：同比=去年同期'), edit.cardTxt);

    // 4) 类型芯片筛选
    const chip = await cdp.eval(`(async()=>{
      const btn = [...document.querySelectorAll('#kbKindBox .kb-kind')].find(b => b.textContent.includes('题目笔记'));
      if (!btn) return { ok:false, chips: [...document.querySelectorAll('#kbKindBox .kb-kind')].map(b => b.textContent.trim()) };
      btn.click();
      await new Promise(r => setTimeout(r, 300));
      const cards = [...document.querySelectorAll('.kb-note')];
      return { ok:true, chips: [], count: cards.length, allQn: cards.every(c => c.textContent.includes('题目笔记')), counter: (document.querySelector('#kbCount')||{}).textContent };
    })()`);
    check('「✏️ 题目笔记」芯片只显示题目笔记', chip.ok && chip.count === 2 && chip.allQn, chip);

    // 5) 搜索命中笔记内容 / 题干
    const search = await cdp.eval(`(async()=>{
      document.querySelectorAll('#kbKindBox .kb-kind')[0].click();   // 回到全部
      await new Promise(r => setTimeout(r, 200));
      const kw = document.querySelector('#kbKw');
      kw.value = '质量乘加速度';
      kw.dispatchEvent(new Event('input', { bubbles:true }));
      await new Promise(r => setTimeout(r, 300));
      const byNote = [...document.querySelectorAll('.kb-note')].length;
      kw.value = '不写笔记';
      kw.dispatchEvent(new Event('input', { bubbles:true }));
      await new Promise(r => setTimeout(r, 300));
      const byContent = [...document.querySelectorAll('.kb-note')].length;
      kw.value = '';
      kw.dispatchEvent(new Event('input', { bubbles:true }));
      await new Promise(r => setTimeout(r, 200));
      return { byNote, byContent };
    })()`);
    check('按笔记内容搜索命中 1 条', search.byNote === 1, search);
    check('按题干搜不会误命中没笔记的题（只收有笔记的）', search.byContent === 0, search);

    // 6) 知识点联动：题目知识点计入图谱角标
    const kpSync = await cdp.eval(`(async()=>{
      const cnt = kpNoteCount('知识库验证B');
      const cnt2 = kpNoteCount('二级知识点');
      return { cnt, cnt2, map: [...kpNoteCounts.entries()].filter(([k]) => k.startsWith('知识库验证')).length };
    })()`);
    check('题目笔记的知识点计入图谱角标（题干多个知识点都算）', kpSync.cnt >= 1 && kpSync.cnt2 >= 1, kpSync);

    // 7) 删除题目笔记 = 清空原题笔记，题目还在
    const del = await cdp.eval(`(async()=>{
      await kbDeleteNote('qn:${prep.q2}');
      await new Promise(r => setTimeout(r, 600));
      const q = await DB.get('questions', ${prep.q2});
      const stillThere = !!q;
      const noteNow = q && q.note;
      const cards = [...document.querySelectorAll('.kb-note')].length;
      return { stillThere, noteNow, cards };
    })()`);
    check('删除题目笔记只清空笔记，题目本身保留', del.stillThere === true && del.noteNow === '', del);
    check('删除后知识库卡片减少一条', del.cards === 1, { cards: del.cards });

    // 8) 页面无未捕获异常
    const errs = await cdp.eval('__errs');
    check('页面无未捕获异常', Array.isArray(errs) && errs.length === 0, errs);

    const pass = results.filter(r => r.pass).length;
    console.log(`\n结果：${pass} / ${results.length} 通过`);
    if (pass !== results.length) process.exitCode = 1;
  } catch (e) {
    console.error('验证异常：', e && e.stack || e);
    process.exitCode = 1;
  } finally {
    cleanup();
  }
})();
