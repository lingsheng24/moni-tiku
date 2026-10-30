/**
 * 验证-知识库折叠.js —— 端到端验证知识库卡片默认折叠、点击展开
 * 复用诊断-图谱实测.js 的 CDP 骨架：本地 electron + 隔离 userData + 调试端口。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 9488;
const TMP = path.join(os.tmpdir(), 'mtk-kbfold-' + Date.now());
const UD = path.join(TMP, 'ud');
const DATA = path.join(UD, 'data.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (name, ok, info) => {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (ok ? '' : '  ' + JSON.stringify(info || '')));
  ok ? pass++ : fail++;
};

/* ---------- CDP 小客户端（原生 WebSocket） ---------- */
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
      if (m.method === 'Runtime.consoleAPICalled' || m.method === 'Runtime.exceptionThrown') {
        const p = m.params;
        this.logs.push(m.method === 'Runtime.exceptionThrown'
          ? (p.exceptionDetails.exception && p.exceptionDetails.exception.description || 'exception')
          : (p.args[0] && p.args[0].value || ''));
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception && r.exceptionDetails.exception.description || 'eval error');
    return r.result.value;
  }
}

(async () => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  fs.mkdirSync(UD, { recursive: true });
  // 数据直接放 userData：data.json = 元数据（curBank + banks 清单）；banks/default.json = 题库数据 + 题库私有 kv（kpNotes/wsFavs）
  fs.writeFileSync(DATA, JSON.stringify({
    curBank: 'default',
    banks: { default: { name: '我的题库', createdAt: new Date().toISOString() } },
    kv: { kpNotes: { '折叠知识点甲': { text: '知识点笔记正文，展开后才显示。'.repeat(3), at: Date.now() } } },   // 桌面版 kpNotes 在主文件全局 kv
  }));
  fs.mkdirSync(path.join(UD, 'banks'), { recursive: true });
  fs.writeFileSync(path.join(UD, 'banks', 'default.json'), JSON.stringify({
    name: '我的题库', seq: {},
    docs: [], mistakes: [], practice: [], exams: [], review: [],
    questions: [
      { id: 1, type: 'single', difficulty: 'easy', content: '折叠测试题 A 的题干', answer: 'A', knowledge_point: '折叠知识点甲', note: '这是题目笔记的完整内容，应该折叠后不可见，展开后可见。'.repeat(3), note_at: Date.now() },
      { id: 2, type: 'single', difficulty: 'easy', content: '折叠测试题 B 的题干', answer: 'B', knowledge_point: '折叠知识点乙' },
    ],
    kv: {
      wsFavs: [{ id: 'fav1', kind: 'ai', q: '什么是弹奏?', ai: 'AI 回答的完整内容，展开后才显示。'.repeat(3), kp: '', at: Date.now() }],
    },
  }));

  const env = { ...process.env, MTK_DEBUG_PORT: String(PORT) };
  delete env.ELECTRON_RUN_AS_NODE;
  const exe = path.join(ROOT, 'desktop', 'node_modules', 'electron', 'dist', 'electron.exe');
  const child = spawn(exe, [path.join(ROOT, 'desktop'), '--user-data-dir=' + UD], { env, stdio: 'ignore' });

  try {
    const cdp = await CDP.connect(PORT);
    await cdp.open();
    await sleep(2500);

    /* 0) 注入数据并进知识库 */
    await cdp.eval(`(async()=>{ await refreshData(); go('kb'); return true; })()`);
    await sleep(800);
    const dbg = await cdp.eval(`({ q: (state.questions||[]).length, cur: curView, notes: (document.getElementById('kbNotes')||{}).innerHTML ? document.getElementById('kbNotes').innerHTML.slice(0,120) : 'NO-EL', all: typeof kbAllNotes === 'function' ? kbAllNotes().length : -1 })`);
    console.log('[诊断]', JSON.stringify(dbg));

    /* 1) 默认折叠：正文 display:none、摘要行存在、折叠箭头 ▸ */
    const r1 = await cdp.eval(`(() => {
      const cards = document.querySelectorAll('#kbNotes .kb-note');
      const first = cards[0];
      const bd = first && first.querySelector('.kb-note-bd');
      const sum = first && first.querySelector('.kb-note-sum');
      const fold = first && first.querySelector('.kb-fold');
      return {
        cardN: cards.length,
        bdHidden: bd ? bd.style.display === 'none' : null,
        bdVisibleText: bd ? bd.textContent.trim().slice(0, 30) : '',
        sumShown: sum ? sum.offsetHeight > 0 : false,
        sumText: sum ? sum.textContent.slice(0, 24) : '',
        foldMark: fold ? fold.textContent : '',
        txtVisible: first.querySelector('.kb-note-txt') ? first.querySelector('.kb-note-txt').offsetHeight : -1,
      };
    })()`);
    check('知识库渲染出 3 张卡（题目笔记/知识点笔记/查询收藏）', r1.cardN === 3, r1);
    check('默认折叠：正文隐藏、摘要可见、箭头 ▸', r1.bdHidden === true && r1.sumShown === true && r1.foldMark === '▸' && r1.txtVisible === 0, r1);
    check('摘要行显示的是截断文本', r1.sumText.length <= 74 && r1.sumText.length > 4, r1.sumText);

    /* 2) 点击摘要展开 → 正文可见、箭头 ▾、摘要隐藏；再点头部收起 */
    const r2 = await cdp.eval(`(async () => {
      const first = document.querySelector('#kbNotes .kb-note');
      first.querySelector('.kb-note-sum').click();
      await new Promise(r => setTimeout(r, 120));
      const bd = first.querySelector('.kb-note-bd');
      const afterOpen = {
        bdShown: bd.style.display !== 'none',
        txtVisible: first.querySelector('.kb-note-txt').offsetHeight > 0,
        foldMark: first.querySelector('.kb-fold').textContent,
        sumHidden: first.querySelector('.kb-note-sum').style.display === 'none',
      };
      first.querySelector('.kb-note-hd').click();
      await new Promise(r => setTimeout(r, 120));
      afterOpen.bdClosedAgain = bd.style.display === 'none';
      afterOpen.foldBack = first.querySelector('.kb-fold').textContent === '▸';
      return afterOpen;
    })()`);
    check('点击摘要：正文展开、箭头 ▾、摘要隐藏', r2.bdShown && r2.txtVisible && r2.foldMark === '▾' && r2.sumHidden, r2);
    check('点击头部：重新收起、箭头 ▸', r2.bdClosedAgain && r2.foldBack, r2);

    /* 3) 各类型卡都能展开（收藏 AI 卡正文长，也折叠） */
    const r3 = await cdp.eval(`(() => {
      const out = [];
      document.querySelectorAll('#kbNotes .kb-note').forEach(card => {
        const bd = card.querySelector('.kb-note-bd');
        const label = card.querySelector('.pill').textContent.trim();
        card.querySelector('.kb-note-sum').click();
        out.push({ label, open: bd.style.display !== 'none', len: bd.textContent.trim().length });
      });
      return out;
    })()`);
    check('三类卡（题目/知识点/收藏）点击都展开且正文完整', r3.length === 3 && r3.every(x => x.open && x.len > 20), r3);

    /* 4) 操作按钮折叠态仍可用（footer 常显） */
    const r4 = await cdp.eval(`(() => {
      const first = document.querySelector('#kbNotes .kb-note');
      const btns = [...first.querySelectorAll('.kb-note-ft button')].map(b => b.textContent.trim());
      const ftVisible = first.querySelector('.kb-note-ft').offsetHeight > 0;
      return { ftVisible, btns };
    })()`);
    check('操作按钮常显（折叠态也能编辑/删除/看原题）', r4.ftVisible && r4.btns.includes('✏️ 编辑') && r4.btns.includes('删除'), r4);

    /* 5) 重渲染（搜索）后回到折叠默认 */
    const r5 = await cdp.eval(`(async () => {
      const inp = document.getElementById('kbKw');
      inp.value = '折叠';
      kbRenderList();
      await new Promise(r => setTimeout(r, 120));
      const bd = document.querySelector('#kbNotes .kb-note-bd');
      return { reFolded: bd ? bd.style.display === 'none' : null };
    })()`);
    check('搜索重渲染后恢复默认折叠', r5.reFolded === true, r5);

    check('全程无未捕获异常', cdp.logs.filter(l => /error|exception/i.test(String(l))).length === 0, cdp.logs.slice(0, 3));

    // 截图留档
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false });
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ROOT, '教程', '验证-知识库折叠.png'), Buffer.from(shot.data, 'base64'));
    console.log('截图: 教程/验证-知识库折叠.png');
  } finally {
    try { child.kill(); } catch (e) {}
  }
  console.log(`\\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('脚本异常:', e); process.exit(1); });
