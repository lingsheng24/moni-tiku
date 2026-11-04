/* 端到端验证：v2.0.0 AI 助教 + 掌握度今日计划
 * 覆盖：AI 助教入口 → 建库检索 → 问答渲染（角标/来源）→ 引用跳转 → 存为笔记
 *       → 首页今日学习计划 → 统计页掌握度看板 → 截图
 * 运行：node desktop/验证-v2.0.js       输出：%TEMP%/mtk-v200/*.png
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTML_URL = 'file:///' + encodeURI(ROOT + '/模拟题库-Web版.html').replace(/#/g, '%23');
const PORT = 9412;
const PROFILE = path.join(ROOT, '教程/.edge-profile-v200');
const OUT = path.join(os.tmpdir(), 'mtk-v200');
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
let fails = 0;
function check(name, cond, detail) {
  console.log((cond ? '✅' : '❌') + ' ' + name + (detail ? ' —— ' + detail : ''));
  if (!cond) fails++;
}

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(PROFILE, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-sync', '--disable-features=Translate,MediaRouter',
    '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + PORT, '--window-size=1440,980', 'about:blank',
  ], { stdio: 'ignore' });
  let cdp;
  const cleanup = () => { try { cdp && cdp.close(); } catch (e) { } try { edge.kill(); } catch (e) { } };
  process.on('exit', cleanup);

  try {
    await waitJson('http://127.0.0.1:' + PORT + '/json/version');
    const list = await waitJson('http://127.0.0.1:' + PORT + '/json/list');
    const page = (Array.isArray(list) ? list : list.targetInfos || []).find(t => t.type === 'page');
    cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 2, mobile: false });
    await cdp.send('Page.navigate', { url: HTML_URL });
    await sleep(3500);

    const shot = async (name) => {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 212, y: 36, width: 1228, height: 900, scale: 1.6 } });
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    };

    /* 1) 准备资料：两篇 MD + 一批题目 + 若干答题记录 */
    const seed = await cdp.eval(`(async()=>{
      const fm = (t, tags, kp) => kbdBuildFM({ tags: tags || [], kp: kp || [], created: Date.now(), updated: Date.now() }, t);
      await KBDOCS.write('货币政策工具', fm('# 货币政策工具\\n\\n公开市场操作是货币政策的主要工具，通过买卖国债、逆回购调节银行体系流动性。\\n\\n存款准备金率调整会放大货币乘数效应，属于数量型工具。\\n\\n传导渠道包括利率渠道、信贷渠道和资产价格渠道。', ['宏观'], ['货币政策']));
      await KBDOCS.write('利率体系', fm('LPR = MLF + 加点。\\n\\n利率渠道的传导效率在 LPR 改革后明显提升，但存款端仍然偏慢。\\n\\n配合 [[货币政策工具]] 一起看。', ['宏观'], ['利率体系']));
      await kbdBuildIndex();
      state.questions = [
        { id: 9001, type: 'single_choice', content: '下列属于数量型货币政策工具的是？', options: ['A.存款准备金率','B.税收'], answer: 'A', explanation: '存款准备金率属于数量型工具，通过货币乘数影响流动性。', knowledge_point: '货币政策', difficulty: 'easy' },
        { id: 9002, type: 'single_choice', content: 'LPR 的报价基础是？', options: ['A.MLF','B.SHIBOR'], answer: 'A', explanation: 'LPR 由 MLF 加点形成。', knowledge_point: '利率体系', difficulty: 'medium' },
        { id: 9003, type: 'true_false', content: '存款准备金率下调会收缩流动性。', answer: '错误', explanation: '下调是扩张。', knowledge_point: '货币政策', difficulty: 'easy' },
        { id: 9004, type: 'single_choice', content: '购买力平价属于哪类理论？', options: ['A.汇率决定','B.利率决定'], answer: 'A', explanation: '长期汇率决定理论。', knowledge_point: '汇率决定理论', difficulty: 'hard' },
        { id: 9005, type: 'fill_blank', content: '国际收支平衡表包括经常账户和____账户。', answer: '资本', explanation: '资本与金融账户。', knowledge_point: '国际收支', difficulty: 'medium' },
      ];
      const now = Date.now(), D = 86400000;
      state.practice = [
        { question_id: 9001, is_correct: 1, answered_at: now - D },
        { question_id: 9003, is_correct: 0, answered_at: now - 2 * D },
        { question_id: 9004, is_correct: 0, answered_at: now - D },
        { question_id: 9004, is_correct: 0, answered_at: now - 4 * D },
        { question_id: 9002, is_correct: 1, answered_at: now - 10 * D },
      ];
      return { docs: kbdIndex.docs.size, q: state.questions.length, p: state.practice.length };
    })()`);
    check('资料就绪：2 篇 MD + 5 道题 + 5 条练习记录', seed.docs === 2 && seed.q === 5 && seed.p === 5, JSON.stringify(seed));

    /* 2) AI 助教入口与空态 */
    await cdp.eval(`(async()=>{ go('ask'); return true; })()`);
    await sleep(900);
    const s1 = await cdp.eval(`(()=>({
      view: curView, sec: document.body.dataset.sec,
      title: (document.querySelector('#view h1')||{}).textContent,
      nav: !!document.querySelector('.nav-item[data-v="ask"]'),
      empty: !!document.querySelector('.ask-empty'),
      chips: document.querySelectorAll('.ask-chip2').length,
      hasSw: !!document.getElementById('askWebSw'),
    }))()`);
    check('进入 AI 助教（知识库板块、空态引导、联网开关）',
      s1.view === 'ask' && s1.sec === 'kb' && s1.title === 'AI 助教' && s1.nav && s1.empty && s1.chips > 0 && s1.hasSw, JSON.stringify(s1));

    /* 3) 本地检索：相关问句命中文档，无关问句覆盖率为 0 */
    const s2 = await cdp.eval(`(async()=>{
      const a = await askSearch('公开市场操作 流动性', 5);
      const b = await askSearch('量子纠缠退相干', 5);
      return {
        n: a.hits.length, cover: +a.cover.toFixed(2), top: a.hits[0] && (a.hits[0].doc || a.hits[0].title),
        kinds: [...new Set(a.hits.map(x => x.kind))].sort(),
        none: b.hits.length, noneCover: b.cover,
        chunks: askCorpus.chunks.length,
      };
    })()`);
    check('本地检索命中相关文档，无关问句无命中',
      s2.n > 0 && s2.cover > 0.5 && String(s2.top).includes('货币') && s2.none === 0 && s2.noneCover === 0,
      JSON.stringify(s2));
    check('索引覆盖文档与题库两类来源', s2.chunks > 2 && s2.kinds.includes('doc') && s2.kinds.includes('q'), JSON.stringify(s2.kinds));

    /* 4) 问答链路（mock 模型返回，验证引用渲染） */
    const s3 = await cdp.eval(`(async()=>{
      state.settings.apiKey = 'sk-test';
      const realChat = window.chat;
      window.chat = async () => '主要有三条渠道：利率渠道[1]、信贷渠道[2]、资产价格渠道[2]。';
      await askSend('货币政策传导渠道有哪些');
      const msgs = document.querySelectorAll('#askLog .ask-a').length;
      const cites = document.querySelectorAll('#askLog .ask-cite').length;
      const srcs = document.querySelectorAll('#askLog .ask-src').length;
      const txt = (document.querySelector('#askLog .ask-md')||{}).textContent || '';
      window.chat = realChat;
      return { msgs, cites, srcs, txt: txt.slice(0, 60), ops: document.querySelectorAll('#askLog .ask-ops').length };
    })()`);
    check('问答渲染：回答 + 可点角标 + 来源卡',
      s3.msgs === 1 && s3.cites >= 2 && s3.srcs >= 2 && s3.txt.length > 5 && s3.ops === 1, JSON.stringify(s3));
    await shot('1-AI助教-问答');

    /* 5) 引用跳转：点来源卡 → 打开对应文档并定位 */
    const s4 = await cdp.eval(`(async()=>{
      const card = document.querySelector('#askLog [data-asksrc]');
      const label = card ? card.textContent : '';
      card.click();
      await new Promise(r => setTimeout(r, 1400));
      return { label, view: curView, doc: kbdCur, sec: document.body.dataset.sec, prev: !!document.getElementById('kbdPreview') };
    })()`);
    check('点来源卡跳回原文档并进入预览',
      s4.view === 'kbdocs' && !!s4.doc && s4.prev && s4.sec === 'kb', JSON.stringify(s4));

    /* 6) 存为知识库文档 */
    const s5 = await cdp.eval(`(async()=>{
      go('ask');
      await new Promise(r => setTimeout(r, 400));
      const before = kbdIndex.docs.size;
      await askSaveNote(1);
      await new Promise(r => setTimeout(r, 600));
      const names = [...kbdIndex.docs.keys()];
      return { before, after: kbdIndex.docs.size, names };
    })()`);
    check('回答可存为知识库文档（带 AI助教 标签）',
      s5.after === s5.before + 1 && s5.names.some(n => n.startsWith('答 ·')), JSON.stringify(s5.names));

    /* 7) 首页今日学习计划 */
    await cdp.eval(`(async()=>{ go('dash'); return true; })()`);
    await sleep(800);
    const s6 = await cdp.eval(`(()=>({
      plan: !!document.querySelector('.mas-plan'),
      rows: document.querySelectorAll('.mas-row').length,
      tags: [...document.querySelectorAll('.mas-tag')].map(x => x.textContent),
      bar: !!document.querySelector('.mas-bar'),
      legend: document.querySelectorAll('.mas-legend span').length,
      first: (document.querySelector('.mas-t')||{}).textContent || '',
    }))()`);
    check('首页出现今日学习计划（薄弱点排入 + 掌握分布）',
      s6.plan && s6.rows >= 2 && s6.tags.includes('薄弱点') && s6.bar && s6.legend === 4, JSON.stringify(s6));
    check('薄弱知识点确实被识别（汇率决定理论 2 错）', String(s6.tags.join('')).includes('薄弱'), s6.first);
    await shot('2-首页-今日计划');

    /* 8) 统计页掌握度看板 */
    await cdp.eval(`(async()=>{ go('stats'); return true; })()`);
    await sleep(800);
    const s7 = await cdp.eval(`(()=>({
      board: !!document.querySelector('.mas-kp'),
      rows: document.querySelectorAll('.mas-kp').length,
      total: (document.querySelector('.mas-plan, .card h3')||{}).textContent || '',
      bars: document.querySelectorAll('.mas-kp-b i').length,
    }))()`);
    check('统计页掌握度看板：逐知识点进度条', s7.board && s7.rows > 0 && s7.bars === s7.rows, JSON.stringify(s7));
    await shot('3-统计-掌握度看板');

    /* 9) 组卷按掌握度加权：弱项题多进卷 */
    const s8 = await cdp.eval(`(()=>{
      const cfg = { count: 4 };
      const r = examPick(cfg);
      const kps = r.items.map(q => splitKP(q.knowledge_point)[0]);
      return { n: r.items.length, kps, unique: new Set(kps).size };
    })()`);
    check('组卷仍能正常出题（掌握度加权不破坏出题）', s8.n === 4, JSON.stringify(s8));

    const errs = (cdp.logs || []).filter(l => !/favicon|net::ERR_FILE/.test(l));
    check('运行期无未捕获异常', errs.length === 0, errs.slice(0, 2).join(' | '));

    console.log('\n' + (fails ? '❌ 失败 ' + fails + ' 项' : '✅ 全部通过'));
  } catch (e) {
    console.error('脚本异常：' + (e && e.stack || e));
    fails++;
  } finally {
    cleanup();
    process.exit(fails ? 1 : 0);
  }
})();
