/* 端到端验证：v2.1.1 图谱工具栏（来源并进科目下拉 + 筛选折叠）
 * 覆盖：知识库知识点进图 → 下拉来源项 → 只看题库/知识库 → 浮标恢复 → 折叠面板（默认收起/展开/徽标/点外面收起/清除筛选）
 *       → 知识库独有节点详情 → 点文档名开 .md → 截图
 * 运行：node desktop/验证-图谱来源.js       输出：%TEMP%/mtk-kpsrc/*.png
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTML_URL = 'file:///' + encodeURI(ROOT + '/模拟题库-Web版.html').replace(/#/g, '%23');
const PORT = 9413;
const PROFILE = path.join(ROOT, '教程/.edge-profile-kpsrc');
const OUT = path.join(os.tmpdir(), 'mtk-kpsrc');
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

    /* 1) 造数据：两篇文档（含题库没有的知识点 + [[kp:]]）+ 5 道题 */
    const seed = await cdp.eval(`(async()=>{
      const fm = (t, tags, kp) => kbdBuildFM({ tags: tags || [], kp: kp || [], created: Date.now(), updated: Date.now() }, t);
      await KBDOCS.write('货币政策笔记.md', fm('# 货币政策\\n\\n公开市场操作通过买卖国债调节流动性。\\n\\n传导机制包括利率渠道与信贷渠道，配合 [[kp:货币政策传导机制]] 一起理解。\\n\\n还涉及 [[kp:货币政策工具]]。', ['宏观'], ['货币政策']));
      await KBDOCS.write('利率笔记.md', fm('LPR = MLF + 加点。\\n\\n利率渠道的传导效率在 LPR 改革后提升。', ['宏观'], ['利率体系', '货币政策传导机制']));
      await kbdBuildIndex();
      state.questions = [
        { id: 9101, type: 'single_choice', content: '下列属于数量型货币政策工具的是？', options: ['A.存款准备金率','B.税收'], answer: 'A', explanation: '存款准备金率属于数量型工具。', knowledge_point: '货币政策', difficulty: 'easy' },
        { id: 9102, type: 'single_choice', content: 'LPR 的报价基础是？', options: ['A.MLF','B.SHIBOR'], answer: 'A', explanation: 'LPR 由 MLF 加点形成。', knowledge_point: '利率体系', difficulty: 'medium' },
        { id: 9103, type: 'true_false', content: '存款准备金率下调会收缩流动性。', answer: '错误', explanation: '下调是扩张。', knowledge_point: '货币政策工具', difficulty: 'easy' },
        { id: 9104, type: 'single_choice', content: '购买力平价属于哪类理论？', options: ['A.汇率决定','B.利率决定'], answer: 'A', explanation: '长期汇率决定理论。', knowledge_point: '汇率决定理论', difficulty: 'hard' },
        { id: 9105, type: 'fill_blank', content: '国际收支平衡表包括经常账户和____账户。', answer: '资本', explanation: '资本与金融账户。', knowledge_point: '国际收支', difficulty: 'medium' },
      ];
      state.practice = [
        { question_id: 9101, is_correct: 1, answered_at: Date.now() - 86400000 },
        { question_id: 9103, is_correct: 0, answered_at: Date.now() - 2 * 86400000 },
        { question_id: 9104, is_correct: 0, answered_at: Date.now() - 86400000 },
      ];
      return { docs: kbdIndex.docs.size, q: state.questions.length };
    })()`);
    check('资料就绪：2 篇 MD + 5 道题', seed.docs === 2 && seed.q === 5, JSON.stringify(seed));

    /* 2) 进图谱：结构 + 默认收起 */
    const s1 = await cdp.eval(`(async()=>{
      await go('kp');
      await new Promise(r => setTimeout(r, 700));
      const ns = kpGraph.nodes;
      const opts = [...document.querySelectorAll('#kpSubj option')].map(o => o.textContent);
      const panel = document.getElementById('kpFoldPanel');
      return {
        total: ns.length,
        q: ns.filter(n => n.hasQ).length,
        kb: ns.filter(n => n.hasKb).length,
        onlyKb: ns.filter(n => !n.hasQ).map(n => n.name),
        kbEdges: kpGraph.edges.filter(e => e[3] === 'kb').length,
        srcOpts: opts.filter(t => /只看/.test(t)),
        subjVal: document.getElementById('kpSubj').value,
        oldSrcBtns: document.querySelectorAll('#kpSrc').length,
        foldOpen: panel.classList.contains('open'),
        panelDisplay: getComputedStyle(panel).display,
        panelCbs: panel.querySelectorAll('input[type=checkbox]').length,
        masteryOutside: !!document.querySelector('.kp-toolbar > #kpMastery'),
        badgeHidden: document.getElementById('kpFoldN').hidden,
        sub: (document.querySelector('#view .sub') || {}).textContent,
      };
    })()`);
    check('知识库知识点并进图谱（题库 5 + 知识库独有）',
      s1.total >= 6 && s1.q === 5 && s1.kb >= 2 && s1.onlyKb.includes('货币政策传导机制'),
      JSON.stringify({ total: s1.total, q: s1.q, kb: s1.kb, onlyKb: s1.onlyKb }));
    check('同文档建链生效', s1.kbEdges > 0, 'kb 边 ' + s1.kbEdges + ' 条');
    check('来源筛选已并入科目下拉（两项，独立图例消失）',
      s1.srcOpts.length === 2 && /只看题库知识点（5）/.test(s1.srcOpts[0]) && s1.oldSrcBtns === 0,
      JSON.stringify(s1.srcOpts));
    check('筛选面板默认收起，掌握度仍在工具栏外面',
      !s1.foldOpen && s1.panelDisplay === 'none' && s1.panelCbs >= 4 && s1.masteryOutside && s1.badgeHidden === true,
      JSON.stringify({ foldOpen: s1.foldOpen, cbs: s1.panelCbs, masteryOutside: s1.masteryOutside }));
    check('副标题统计题库/知识库/只在知识库', /题库 5 · 知识库 \d+/.test(s1.sub) && /只在知识库/.test(s1.sub), s1.sub);
    await shot('1-图谱-工具栏收起');

    /* 3) 展开筛选面板：控件可见 + 徽标 + 点外面收起 */
    const s2 = await cdp.eval(`(async()=>{
      document.getElementById('kpFoldBtn').click();
      await new Promise(r => setTimeout(r, 300));
      const panel = document.getElementById('kpFoldPanel');
      const opened = panel.classList.contains('open') && getComputedStyle(panel).display !== 'none';
      const btnOn = document.getElementById('kpFoldBtn').classList.contains('on');
      const legendN = panel.querySelectorAll('#kpLegend .kp-legend-item').length;
      // 面板里开「有笔记」→ 徽标计数
      document.getElementById('kpNoteChk').click();
      await new Promise(r => setTimeout(r, 350));
      const badge = document.getElementById('kpFoldN');
      const badgeTxt = badge.hidden ? '' : badge.textContent;
      return { opened, btnOn, legendN, badgeTxt, setting: state.settings.kpFilterFold };
    })()`);
    check('点「筛选」展开面板（关联类型一并出现）', s2.opened && s2.btnOn && s2.legendN >= 3, JSON.stringify(s2));
    check('面板内切换筛选 → 按钮徽标显示生效数量', s2.badgeTxt === '1', 'badge=' + s2.badgeTxt);
    await shot('2-图谱-筛选面板展开');

    const s3 = await cdp.eval(`(async()=>{
      // 清除筛选：徽标归零
      [...document.querySelectorAll('#kpFoldPanel button')].find(b => /清除筛选/.test(b.textContent)).click();
      await new Promise(r => setTimeout(r, 350));
      const badge = document.getElementById('kpFoldN');
      const cleared = badge.hidden;
      // 点画布外面 → 自动收起
      document.getElementById('kpCanvas').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await new Promise(r => setTimeout(r, 300));
      return { cleared, closed: !document.getElementById('kpFoldPanel').classList.contains('open'), note: document.getElementById('kpNoteChk').checked, src: kpSrcFilter };
    })()`);
    check('「清除筛选」恢复默认、点面板外面自动收起',
      s3.cleared && s3.closed && s3.note === false && s3.src === null, JSON.stringify(s3));

    /* 4) 下拉只看知识库 */
    const s4 = await cdp.eval(`(async()=>{
      const sel = document.getElementById('kpSubj');
      sel.value = '__kp_src_kb';
      sel.dispatchEvent(new Event('change'));
      await new Promise(r => setTimeout(r, 350));
      const vis = kpGraph.nodes.filter(kpNodeVisible).map(n => n.name);
      return {
        filter: kpSrcFilter, vis, n: vis.length,
        selVal: sel.value,
        chip: (document.getElementById('kpSrcChip') || {}).style.display,
        chipTxt: (document.getElementById('kpSrcChip') || {}).textContent || '',
      };
    })()`);
    check('下拉选「只看知识库」：只剩有文档或笔记的节点',
      s4.filter === 'kb' && s4.vis.length === s1.kb && !s4.vis.includes('国际收支') && s4.selVal === '__kp_src_kb',
      JSON.stringify({ n: s4.n, vis: s4.vis, selVal: s4.selVal }));
    check('只看知识库：浮标出现', s4.chip === 'inline-flex' && /知识库/.test(s4.chipTxt), JSON.stringify({ chip: s4.chip, txt: s4.chipTxt }));
    await shot('3-图谱-只看知识库');

    /* 5) 下拉只看题库 */
    const s5 = await cdp.eval(`(async()=>{
      const sel = document.getElementById('kpSubj');
      sel.value = '__kp_src_q';
      sel.dispatchEvent(new Event('change'));
      await new Promise(r => setTimeout(r, 350));
      const vis = kpGraph.nodes.filter(kpNodeVisible).map(n => n.name);
      return { filter: kpSrcFilter, n: vis.length, hasKbOnly: vis.includes('货币政策传导机制'), selVal: sel.value };
    })()`);
    check('下拉选「只看题库」：知识库独有节点被隐藏',
      s5.filter === 'q' && s5.n === s1.q && !s5.hasKbOnly && s5.selVal === '__kp_src_q', JSON.stringify(s5));

    /* 6) 浮标 ✕ 恢复：下拉回到科目（全部科目） */
    const s6 = await cdp.eval(`(async()=>{
      document.querySelector('#kpSrcChip button').click();
      await new Promise(r => setTimeout(r, 350));
      return {
        filter: kpSrcFilter,
        vis: kpGraph.nodes.filter(kpNodeVisible).length,
        chip: (document.getElementById('kpSrcChip') || {}).style.display,
        selVal: document.getElementById('kpSubj').value,
        selTxt: document.getElementById('kpSubj').selectedOptions[0].textContent,
      };
    })()`);
    check('浮标 ✕ 恢复全部，下拉回到「全部科目」',
      s6.filter === null && s6.vis === s1.total && s6.chip === 'none' && s6.selVal === '' && s6.selTxt === '全部科目',
      JSON.stringify(s6));

    /* 7) 知识库独有节点详情 */
    const s7 = await cdp.eval(`(async()=>{
      selectKP('货币政策传导机制');
      await new Promise(r => setTimeout(r, 400));
      const d = document.getElementById('kpDetail');
      const html = d ? d.innerHTML : '';
      return {
        has: html.includes('知识库知识点'),
        docLink: /kpOpenKbDoc\\(/.test(html),
        gen: html.includes('生成这个知识点的题'),
        practice: html.includes('练习这些题'),
        text: (d ? d.textContent : '').replace(/\\s+/g, ' ').slice(0, 120),
      };
    })()`);
    check('知识库独有节点详情：标记 / 文档入口 / 生成题按钮',
      s7.has && s7.docLink && s7.gen && !s7.practice, s7.text);
    await shot('4-知识库知识点详情');

    /* 8) 点文档名打开 .md */
    const s8 = await cdp.eval(`(async()=>{
      const a = [...document.querySelectorAll('#kpDetail a')].find(x => /kpOpenKbDoc/.test(x.getAttribute('onclick') || ''));
      if (!a) return { ok: false };
      a.click();
      await new Promise(r => setTimeout(r, 1600));
      return { ok: true, view: curView, doc: kbdCur, sec: document.body.dataset.sec };
    })()`);
    check('点文档名跳到知识库文档编辑器', s8.ok && s8.view === 'kbdocs' && !!s8.doc && s8.sec === 'kb', JSON.stringify(s8));

    const logs = (cdp.logs || []).filter(x => /exception/i.test(x));
    check('无未捕获脚本异常', logs.length === 0, logs.slice(0, 2).join(' | '));

    console.log('\n截图目录：' + OUT);
    console.log(fails ? `\n❌ ${fails} 项未通过` : '\n✅ 全部通过');
  } finally {
    cleanup();
  }
})();
