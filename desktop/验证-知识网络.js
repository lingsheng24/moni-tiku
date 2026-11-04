/* 端到端验证：v2.2.0 知识网络（文档 / 题目图层）+ 互通（题库包、Anki 卡片）
 * 覆盖：文档节点上图与连线 → 题目图层按选中知识点展开 → 图层开关 → 点文档节点打开 .md
 *       → 点题目节点看题 → 页头统计 → 题库包导出结构 → 题库包导入去重合并 → Anki TSV
 * 运行：node desktop/验证-知识网络.js      输出：%TEMP%/mtk-kpnet/*.png
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTML_URL = 'file:///' + encodeURI(ROOT + '/模拟题库-Web版.html').replace(/#/g, '%23');
const PORT = 9421;
const PROFILE = path.join(ROOT, '教程/.edge-profile-kpnet');
const OUT = path.join(os.tmpdir(), 'mtk-kpnet');
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

    const shot = async (name, clip) => {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', clip: Object.assign({ x: 212, y: 36, width: 1228, height: 900, scale: 1.45 }, clip || {}) });
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    };

    /* ---------- 1) 造数据：3 篇文档 + 6 道题（两个知识点） ---------- */
    const seed = await cdp.eval(`(async()=>{
      const fm = (t, tags, kp) => kbdBuildFM({ tags: tags || [], kp: kp || [], created: Date.now(), updated: Date.now() }, t);
      await KBDOCS.write('三次握手笔记', fm('# 三次握手\\n\\nSYN → SYN+ACK → ACK，三次是为了确认双方的收发能力。\\n\\n配合 [[kp:拥塞控制]] 理解慢启动。\\n\\n#网络', ['网络'], ['三次握手']));
      await KBDOCS.write('拥塞控制笔记', fm('# 拥塞控制\\n\\n慢启动、拥塞避免、快重传、快恢复四个阶段。\\n\\n与 [[kp:三次握手]] 同属 TCP 连接管理。\\n\\n#网络', ['网络'], ['拥塞控制']));
      await KBDOCS.write('索引笔记', fm('# B+ 树\\n\\n所有数据都在叶子节点，用链表相连，适合范围查询。\\n\\n#数据库', ['数据库'], ['B+ 树']));
      await kbdBuildIndex();
      const QS = [
        { type:'single_choice', content:'TCP 三次握手的第二个报文是？', options:['A. SYN','B. SYN+ACK','C. ACK','D. FIN'], answer:'B', explanation:'服务端回 SYN+ACK', knowledge_point:'三次握手', difficulty:'easy', imp:4 },
        { type:'true_false', content:'三次握手可以简化为两次。', options:null, answer:'错误', explanation:'两次无法确认客户端收包能力', knowledge_point:'三次握手', difficulty:'medium', imp:3 },
        { type:'single_choice', content:'慢启动阶段拥塞窗口如何增长？', options:['A. 线性','B. 指数'], answer:'B', explanation:'每经过一个 RTT 翻倍', knowledge_point:'拥塞控制', difficulty:'medium', imp:4 },
        { type:'single_choice', content:'B+ 树的非叶子节点存什么？', options:['A. 数据','B. 索引键'], answer:'B', explanation:'数据只在叶子', knowledge_point:'B+ 树', difficulty:'medium', imp:3 },
        { type:'fill_blank', content:'B+ 树的叶子节点用 ____ 相连。', options:null, answer:'链表', explanation:'便于范围扫描', knowledge_point:'B+ 树', difficulty:'easy', imp:2 },
      ];
      for (const q of QS) await DB.add('questions', q);
      await refreshData();
      return { q: state.questions.length };
    })()`);
    check('造数据：5 道题入库', seed.q === 5, 'q=' + seed.q);

    await cdp.eval(`go('kp')`);
    await sleep(1200);

    /* ---------- 2) 默认视图：文档节点在、题目节点不在 ---------- */
    const s1 = await cdp.eval(`(()=>({
      docs: kpGraph.nodes.filter(n=>n.kind==='doc').map(n=>n.name).sort(),
      qn: kpGraph.nodes.filter(n=>n.kind==='q').length,
      docEdges: kpGraph.edges.filter(e=>e[3]==='doc').length,
      docChk: document.getElementById('kpDocChk').checked,
      qChk: document.getElementById('kpQChk').checked,
      sub: document.querySelector('#view .sub').textContent.replace(/\\s+/g,' ').trim(),
      layerRow: !!document.querySelector('#kpFoldPanel .kp-fold-lbl') && [...document.querySelectorAll('#kpFoldPanel .kp-fold-lbl')].some(e=>e.textContent.trim()==='图层'),
    }))()`);
    check('文档节点进图（3 篇，名称去掉 .md）', s1.docs.join('|') === '三次握手笔记|拥塞控制笔记|索引笔记', s1.docs.join(','));
    check('文档↔知识点连线：5 条（每篇连到它提到的每个知识点）', s1.docEdges === 5, 'docEdges=' + s1.docEdges);
    check('文档图层默认开、题目图层默认关', s1.docChk === true && s1.qChk === false, `doc=${s1.docChk} q=${s1.qChk}`);
    check('题目节点默认不展开', s1.qn === 0, 'qn=' + s1.qn);
    check('页头统计写出「3 篇文档」', /3 篇文档/.test(s1.sub), s1.sub);
    check('折叠面板里有「图层」行', s1.layerRow === true);
    await shot('1-图谱-默认带文档节点');

    /* ---------- 3) 选中知识点 + 开题目图层 → 题目节点展开 ---------- */
    const s2 = await cdp.eval(`(async()=>{
      const el = document.getElementById('kpQChk'); el.checked = true; el.dispatchEvent(new Event('change'));
      await new Promise(r=>setTimeout(r,500));
      selectKP('三次握手');
      await new Promise(r=>setTimeout(r,700));
      return {
        qn: kpGraph.nodes.filter(n=>n.kind==='q').length,
        qEdges: kpGraph.edges.filter(e=>e[3]==='q').length,
        saved: state.settings.kpLayerQ,
        chip: !!document.getElementById('kpQCnt') && document.getElementById('kpQCnt').textContent,
        detail: (document.getElementById('kpDetail').textContent||'').includes('三次握手'),
      };
    })()`);
    check('开题目图层 + 选中「三次握手」→ 展开 2 道题', s2.qn === 2, 'qn=' + s2.qn);
    check('题目↔知识点连线 2 条', s2.qEdges === 2, 'qEdges=' + s2.qEdges);
    check('图层选择已写入设置', s2.saved === 1, 'kpLayerQ=' + s2.saved);
    check('图层行显示题目数量', /2/.test(s2.chip || ''), String(s2.chip));
    check('选中后详情卡正常', s2.detail === true);
    await shot('2-图谱-题目图层展开');

    /* ---------- 4) 换一个知识点：题目节点跟着换 ---------- */
    const s3 = await cdp.eval(`(async()=>{
      selectKP('B+ 树'); await new Promise(r=>setTimeout(r,700));
      return { qn: kpGraph.nodes.filter(n=>n.kind==='q').length, ids: kpGraph.nodes.filter(n=>n.kind==='q').map(n=>n.qid) };
    })()`);
    check('切到「B+ 树」→ 题目节点换成它的 2 道题', s3.qn === 2, JSON.stringify(s3.ids));

    /* ---------- 5) 点题目节点 → 弹出题目预览 ---------- */
    const tap = await cdp.eval(`(async()=>{
      const cv = document.getElementById('kpCanvas');
      cv.scrollIntoView({ block: 'center' });
      await new Promise(r=>setTimeout(r,450));
      const p = kpProj.find(x=>x.n.kind==='q' && x.z > 0) || kpProj.find(x=>x.n.kind==='q');
      const r = cv.getBoundingClientRect();
      return p ? { x: Math.round(r.left + p.sx), y: Math.round(r.top + p.sy) } : null;
    })()`);
    check('题目节点有可点击的投影坐标', !!tap, JSON.stringify(tap));
    if (tap) {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await cdp.send('Input.dispatchMouseEvent', { type, x: tap.x, y: tap.y, button: 'left', clickCount: 1 });
      }
      await sleep(600);
      const s4 = await cdp.eval(`(()=>{const m=document.querySelector('.modal-mask'); return { open: !!m, txt: m ? m.textContent.slice(0,500) : '' };})()`);
      check('点题目节点弹出题目预览（含答案）', s4.open && /答案/.test(s4.txt), s4.txt.replace(/\s+/g, ' '));
      await shot('3-题目节点-题目预览');
      await cdp.eval(`closeModal()`);
      await sleep(300);
    }

    /* ---------- 6) 点文档节点 → 打开 .md 编辑器 ---------- */
    const tapDoc = await cdp.eval(`(async()=>{
      const cv = document.getElementById('kpCanvas');
      cv.scrollIntoView({ block: 'center' });
      await new Promise(r=>setTimeout(r,450));
      const p = kpProj.find(x=>x.n.kind==='doc' && x.z > 0) || kpProj.find(x=>x.n.kind==='doc');
      const r = cv.getBoundingClientRect();
      return p ? { x: Math.round(r.left + p.sx), y: Math.round(r.top + p.sy), name: p.n.docName } : null;
    })()`);
    if (tapDoc) {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await cdp.send('Input.dispatchMouseEvent', { type, x: tapDoc.x, y: tapDoc.y, button: 'left', clickCount: 1 });
      }
      await sleep(1500);
      const s5 = await cdp.eval(`(()=>({ view: curView, hasEd: !!document.querySelector('#view textarea'), body: document.body.innerText.includes('三次握手笔记') || document.body.innerText.includes('拥塞控制笔记') || document.body.innerText.includes('索引笔记') }))()`);
      check('点文档节点打开知识库文档编辑器', s5.view === 'kbdocs' && s5.hasEd === true, `view=${s5.view} ed=${s5.hasEd}`);
      await shot('4-点文档节点-打开编辑器');
    } else check('文档节点可点击', false, '未找到 doc 节点投影');

    /* ---------- 7) 图层关掉：文档 / 题目都收起来 ---------- */
    const s6 = await cdp.eval(`(async()=>{
      await go('kp'); await new Promise(r=>setTimeout(r,900));
      const kept = kpGraph.nodes.filter(n=>n.kind==='q').length;      // 仍选中「B+ 树」→ 题目还挂着
      clearKPSelection(true); await new Promise(r=>setTimeout(r,500));
      const cleared = kpGraph.nodes.filter(n=>n.kind==='q').length;   // 取消选中 → 收起
      const d = document.getElementById('kpDocChk'); d.checked = false; d.dispatchEvent(new Event('change'));
      await new Promise(r=>setTimeout(r,600));
      return { kept, cleared, docs: kpGraph.nodes.filter(n=>n.kind==='doc').length, saved: state.settings.kpLayerDoc };
    })()`);
    check('重进页面保留选中，题目节点跟着它', s6.kept === 2, 'kept=' + s6.kept);
    check('取消选中 → 题目节点收起', s6.cleared === 0, 'cleared=' + s6.cleared);
    check('关掉文档图层 → 文档节点消失', s6.docs === 0, 'docs=' + s6.docs);
    check('文档图层关闭已持久化', s6.saved === 0, 'kpLayerDoc=' + s6.saved);

    /* ---------- 8) 题库包导出 → 结构正确 ---------- */
    const packInfo = await cdp.eval(`(async()=>{
      const p = await mtkpackCollect();
      return { kind: p.kind, schema: p.schema, q: p.questions.length, docs: p.docs.length, bank: p.bank.name,
               noId: p.questions.every(x=>x.id===undefined), counts: p.counts };
    })()`);
    check('题库包结构：kind / schema / 题目 / 文档齐全', packInfo.kind === 'monitiku-bankpack' && packInfo.schema === 1, JSON.stringify(packInfo));
    check('题库包含 5 道题、3 篇文档，题目不带 id', packInfo.q === 5 && packInfo.docs === 3 && packInfo.noId === true, `q=${packInfo.q} docs=${packInfo.docs}`);

    /* ---------- 9) 题库包导入：去重 + 文档改名 ---------- */
    const imp = await cdp.eval(`(async()=>{
      const before = state.questions.length;
      const pack = {
        kind:'monitiku-bankpack', bank:{name:'别人的题库'}, schema:1,
        questions: [
          { type:'single_choice', content:'TCP 三次握手的第二个报文是？', options:['A. SYN'], answer:'B' },
          { type:'single_choice', content:'导入进来的新题', answer:'A', knowledge_point:'新知识点' },
        ],
        docs: [{ name:'三次握手笔记', content:'# 别人的版本' }],
        kp_notes: { '新笔记知识点': { text: '别人的笔记' } },
      };
      const origPick = window.pickOneFile, origConfirm = window.confirm;
      window.pickOneFile = async () => ({ text: async () => JSON.stringify(pack) });
      window.confirm = () => true;
      await mtkpackImport();
      window.pickOneFile = origPick; window.confirm = origConfirm;
      const after = state.questions.length;
      const docs = await KBDOCS.list();
      return { before, after, added: after - before, docNames: docs.map(d=>d.name).sort(), note: !!state.kpNotes['新笔记知识点'] };
    })()`);
    check('导入去重：只新增 1 道题（重复的那道被跳过）', imp.added === 1, `${imp.before} → ${imp.after}`);
    check('同名文档不覆盖，自动加序号的副本入库', imp.docNames.includes('三次握手笔记 (2)'), imp.docNames.join(','));
    check('知识点笔记合并进来', imp.note === true);

    /* ---------- 10) Anki 卡片导出 ---------- */
    const anki = await cdp.eval(`(async()=>{
      let out = null, fname = '';
      const orig = window.downloadBlob;
      window.downloadBlob = (blob, name) => { fname = name; out = blob; };
      await ankiExport();
      window.downloadBlob = orig;
      const txt = out ? await out.text() : '';
      const lines = txt.split('\\n');
      return { fname, head: lines.slice(0,4), rows: lines.slice(4), cols: lines.slice(4).map(l=>l.split('\\t').length) };
    })()`);
    check('Anki 文件名规范', /^Anki卡片_\d{4}-\d{2}-\d{2}\.txt$/.test(anki.fname), anki.fname);
    check('Anki 文件头正确（tab / html / deck / 标签列）',
      anki.head.join('|') === '#separator:tab|#html:true|#deck:模拟题库|#tags column:3', anki.head.join(' | '));
    check('每张卡片都是 3 列（正面 / 反面 / 标签）', anki.cols.every(n => n === 3) && anki.rows.length === 6, `rows=${anki.rows.length} cols=${[...new Set(anki.cols)].join(',')}`);

    /* ---------- 11) 无 JS 异常 ---------- */
    check('运行期间没有未捕获异常', cdp.logs.length === 0, cdp.logs.slice(0, 2).join(' / '));

    console.log(fails ? `\n未通过 ${fails} 项` : '\n全部通过');
    console.log('截图目录：' + OUT);
  } catch (e) {
    console.error('脚本异常：', e && e.message || e);
    fails++;
  } finally {
    cleanup();
    process.exit(fails ? 1 : 0);
  }
})();
