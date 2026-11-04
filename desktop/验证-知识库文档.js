/* 端到端验证：知识库 MD 文档（v1.52.0）
 * 覆盖：列表空态 → 新建两篇（MD + [[双链]] + [[kp:知识点]] + #标签）→ 保存 →
 *       列表卡片与链数 → 反链面板 → 预览渲染 → 链接跳转 → 重命名 / 删除 → 截图
 * 运行：node desktop/验证-知识库文档.js      输出：%TEMP%/mtk-kbdocs/*.png
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTML_URL = 'file:///' + encodeURI(ROOT + '/模拟题库-Web版.html').replace(/#/g, '%23');
const PORT = 9396;
const PROFILE = path.join(ROOT, '教程/.edge-profile-kbdocs');
const OUT = path.join(os.tmpdir(), 'mtk-kbdocs');
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

    const shot = async (name, full) => {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', ...(full ? {} : { clip: { x: 212, y: 36, width: 1228, height: 900, scale: 1.6 } }) });
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    };

    // 0) 注入一条题目，让 [[ 联想池里有知识点
    await cdp.eval(`(async()=>{ state.questions = [{ id: 9001, type: 'single_choice', content: '测试题', knowledge_point: '货币政策' }]; return true; })()`);

    // 1) 进入知识库文档页（列表空态）
    await cdp.eval(`(async()=>{ go('kbdocs'); return true; })()`);
    await sleep(1200);
    const s1 = await cdp.eval(`(()=>({
      sec: document.body.dataset.sec, view: curView,
      title: (document.querySelector('#view h1')||{}).textContent,
      cards: document.querySelectorAll('.kbd-card').length,
      hasNewBtn: !!document.querySelector('#view .card button.primary'),
    }))()`);
    check('进入知识库文档页（知识库板块、空列表）', s1.sec === 'kb' && s1.view === 'kbdocs' && s1.title === '知识库文档' && s1.cards === 0 && s1.hasNewBtn, JSON.stringify(s1));
    await shot('1-文档列表-空态');

    // 2) 新建第一篇：MD 正文 + 标签 + 关联知识点
    const doc1 = await cdp.eval(`(async()=>{
      await kbdOpen(null);
      document.getElementById('kbdName').value = '货币政策工具';
      const ta = document.getElementById('kbdTa');
      ta.value = '# 货币政策工具\\n\\n数量型工具包括**存款准备金率**、再贴现等。\\n\\n- 存款准备金率\\n- 再贴现\\n\\n> 价格型工具见 [[利率体系]]\\n\\n| 工具 | 类型 |\\n| --- | --- |\\n| 准备金率 | 数量型 |\\n| LPR | 价格型 |\\n\\n关联：[[kp:货币政策]]  #宏观 #难点';
      document.getElementById('kbdTags').value = '宏观, 难点';
      document.getElementById('kbdKp').value = '货币政策';
      await kbdSaveDoc(true);
      const raw = await KBDOCS.read('货币政策工具');
      return { cur: kbdCur, saved: raw ? 1 : 0, len: raw ? raw.length : 0, head: raw ? raw.slice(0, 90) : '' };
    })()`);
    check('新建并保存第一篇（MD + front-matter）', doc1.cur === '货币政策工具' && doc1.saved === 1, JSON.stringify(doc1));

    // 3) 新建第二篇，链接第一篇（产生反链）
    const doc2 = await cdp.eval(`(async()=>{
      await kbdOpen(null);
      document.getElementById('kbdName').value = '利率体系';
      document.getElementById('kbdTa').value = 'LPR = MLF + 加点。\\n\\n传导链与 [[货币政策工具]] 配合使用。\\n\\n#宏观';
      document.getElementById('kbdTags').value = '宏观';
      await kbdSaveDoc(true);
      return { cur: kbdCur };
    })()`);
    check('新建并保存第二篇（链到第一篇）', doc2.cur === '利率体系', JSON.stringify(doc2));

    // 4) 列表页：两篇卡片 + 链数统计
    await cdp.eval(`(async()=>{ viewKbDocs(); return true; })()`);
    await sleep(900);
    const s4 = await cdp.eval(`(()=>({
      cards: [...document.querySelectorAll('.kbd-card')].map(c => ({
        t: c.querySelector('.kbd-title').textContent,
        pills: [...c.querySelectorAll('.pill')].map(p => p.textContent.trim()),
      })),
      stats: [...document.querySelectorAll('.stat .num')].map(n => n.textContent.trim()),
    }))()`);
    check('列表显示两篇文档 + 双链统计', s4.cards.length === 2 && s4.cards.some(c => c.t === '货币政策工具') && s4.cards.some(c => c.t === '利率体系'), JSON.stringify(s4.cards));
    check('统计：文档 2 / 标签 2 / 双链 3（含 kp 链接）/ 关联知识点 1', s4.stats[0] === '2' && s4.stats[1] === '2' && s4.stats[2] === '3' && s4.stats[3] === '1', s4.stats.join('/'));
    await shot('2-文档列表-两篇');

    // 5) 打开第一篇：反链面板出现「利率体系」
    const s5 = await cdp.eval(`(async()=>{
      await kbdOpen('货币政策工具');
      const box = document.getElementById('kbdBackBox');
      const preview = document.getElementById('kbdPreview').innerHTML;
      return {
        backShown: box && box.style.display !== 'none',
        backText: box ? box.textContent.replace(/\\s+/g, ' ').trim().slice(0, 80) : '',
        hasH2: preview.includes('<h2 class="kbd-h">货币政策工具</h2>'),
        hasBold: preview.includes('<b>存款准备金率</b>'),
        hasTable: preview.includes('<table class="kbd-tb">'),
        hasKpLink: preview.includes('data-kbkp="1"'),
        hasTag: preview.includes('data-kbtag="宏观"'),
        hasDocLink: preview.includes('data-kblink="利率体系"'),
      };
    })()`);
    check('预览渲染：标题/粗体/表格/双链/知识点链接/标签', s5.hasH2 && s5.hasBold && s5.hasTable && s5.hasKpLink && s5.hasTag && s5.hasDocLink, JSON.stringify(s5));
    check('反链面板显示「利率体系」提到本文', s5.backShown && s5.backText.includes('利率体系'), s5.backText);
    await shot('3-编辑器-预览');

    // 6) 点击双链跳转
    const s6 = await cdp.eval(`(async()=>{
      const link = document.querySelector('#kbdPreview .kbd-link[data-kbkp="0"]');
      const dbg = { found: !!link, target: link && link.dataset.kblink, hasTarget: link ? kbdIndex.docs.has(link.dataset.kblink) : false, inPrev: link ? !!link.closest('#kbdPreview') : false };
      if (link) link.click();
      await new Promise(r => setTimeout(r, 1200));
      dbg.cur = kbdCur;
      return dbg;
    })()`);
    check('点击 [[利率体系]] 跳到对应文档', s6.found && s6.hasTarget && s6.cur === '利率体系', JSON.stringify(s6));

    // 7) 重命名
    const s7 = await cdp.eval(`(async()=>{
      await kbdOpen('利率体系');
      document.getElementById('kbdName').value = '利率体系与LPR';
      await kbdSaveDoc(true);
      const names = (await KBDOCS.list()).map(x => x.name).sort();
      return { cur: kbdCur, names };
    })()`);
    check('重命名生效（旧名消失、新名存在）', s7.cur === '利率体系与LPR' && s7.names.includes('利率体系与LPR') && !s7.names.includes('利率体系'), JSON.stringify(s7));

    // 8) 删除第二篇
    const s8 = await cdp.eval(`(async()=>{
      const oldConfirm = window.confirm; window.confirm = () => true;
      await kbdOpen('利率体系与LPR');
      await kbdDelDoc();
      window.confirm = oldConfirm;
      const names = (await KBDOCS.list()).map(x => x.name);
      return { names };
    })()`);
    await sleep(600);
    check('删除文档后只剩一篇', s8.names.length === 1 && s8.names[0] === '货币政策工具', JSON.stringify(s8));

    // 9) 板块归属：出题资料在模拟题库板块
    const s9 = await cdp.eval(`(()=>{
      const docsItem = document.querySelector('.nav-item[data-v="docs"]');
      const kbdItem = document.querySelector('.nav-item[data-v="kbdocs"]');
      return {
        docsGroup: docsItem.closest('.nav-group').dataset.sec || '',
        kbdGroup: kbdItem.closest('.nav-group').dataset.sec || '',
        docsText: docsItem.querySelector('.txt').textContent,
        kbdText: kbdItem.querySelector('.txt').textContent,
        kbText: document.querySelector('.nav-item[data-v="kb"] .txt').textContent,
      };
    })()`);
    check('出题资料归模拟题库板块、知识库文档归知识库板块', s9.docsGroup === 'tik' && s9.kbdGroup === 'kb' && s9.docsText === '出题资料' && s9.kbdText === '知识库文档' && s9.kbText === '笔记聚合', JSON.stringify(s9));

    console.log('截图目录：' + OUT);
    console.log(fails ? ('❌ ' + fails + ' 项不通过') : '✅ 全部通过');
    if (cdp.logs.length) { console.log('页面异常：', cdp.logs.slice(0, 3)); }
    if (fails || cdp.logs.length) process.exitCode = 1;
  } catch (e) {
    console.log('❌ 中断：', e && (e.stack || e.message));
    process.exitCode = 1;
  } finally {
    cleanup();
    setTimeout(() => process.exit(process.exitCode || 0), 200);
  }
})();
