/* 端到端验证：v2.1.1 知识库文档 卡片 / 列表双视图
 * 覆盖：默认卡片 → 切列表（行结构、高亮、持久化）→ 刷新后仍是列表 → 切回卡片 → 截图
 * 运行：node desktop/验证-文档视图.js   输出：%TEMP%/mtk-kbdview/*.png
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTML_URL = 'file:///' + encodeURI(ROOT + '/模拟题库-Web版.html').replace(/#/g, '%23');
const PORT = 9419;
const PROFILE = path.join(ROOT, '教程/.edge-profile-kbdview');
const OUT = path.join(os.tmpdir(), 'mtk-kbdview');
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
    '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + PORT, '--window-size=1440,960', 'about:blank',
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
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', clip: Object.assign({ scale: 1.2 }, clip || { x: 0, y: 36, width: 1440, height: 924 }) });
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    };

    /* 1) 造 3 篇文档，进知识库文档页（默认卡片视图） */
    const seed = await cdp.eval(`(async()=>{
      const fm = (o, b) => kbdBuildFM(Object.assign({ tags: o.tags || [], kp: o.kp || [], created: Date.now() - 86400000, updated: Date.now() }, o), b);
      await KBDOCS.write('TCP 三次握手笔记.md', fm({ tags: ['网络'], kp: ['三次握手'] }, '# 三次握手\\n\\n客户端 SYN → 服务端 SYN+ACK → 客户端 ACK。两次握手无法防止旧连接。\\n\\n参考 [[拥塞控制]]。'));
      await KBDOCS.write('拥塞控制.md', fm({ tags: ['网络'], kp: ['拥塞控制'] }, '# 拥塞控制\\n\\n慢开始 → 拥塞避免 → 快重传 → 快恢复。'));
      await KBDOCS.write('索引失效场景.md', fm({ tags: ['数据库'], kp: ['索引'] }, '# 索引失效\\n\\n函数列、前导 % 、隐式转换、最左前缀、OR 非索引列。'));
      await kbdBuildIndex();
      await go('kbdocs');
      await new Promise(r => setTimeout(r, 800));
      return { n: kbdIndex.docs.size };
    })()`);
    check('种子 3 篇文档就绪', seed.n === 3, JSON.stringify(seed));

    const s1 = await cdp.eval(`(()=>{
      const grid = document.querySelector('#kbdCards');
      const cards = [...document.querySelectorAll('.kbd-card')];
      const btns = [...document.querySelectorAll('.kbd-viewseg .ibtn')];
      return {
        cls: grid.className, cardN: cards.length,
        cardBtnOn: btns[0].classList.contains('on'), listBtnOn: btns[1].classList.contains('on'),
        statLine: [...document.querySelectorAll('#view .card div')].map(d => d.textContent).find(t => t.includes('当前显示')) || '',
      };
    })()`);
    check('默认是卡片视图（kbd-grid + 卡片数 = 3）', s1.cls === 'kbd-grid' && s1.cardN === 3, `${s1.cls} n=${s1.cardN}`);
    check('工具栏 ▦ 高亮、☰ 未高亮', s1.cardBtnOn === true && s1.listBtnOn === false, `card=${s1.cardBtnOn} list=${s1.listBtnOn}`);
    check('统计行写明「卡片视图」', s1.statLine.includes('卡片视图'), s1.statLine.trim());
    await shot('1-知识库文档-卡片视图');

    /* 2) 点 ☰ 切列表（v2.2.0：带表头、六列对齐） */
    const s2 = await cdp.eval(`(async()=>{
      document.querySelectorAll('.kbd-viewseg .ibtn')[1].click();
      await new Promise(r => setTimeout(r, 900));
      const list = document.querySelector('#kbdCards');
      const rows = [...document.querySelectorAll('.kbd-row')];
      const btns = [...document.querySelectorAll('.kbd-viewseg .ibtn')];
      const first = rows[0];
      const head = document.querySelector('.kbd-list-head');
      const box = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width) }; };
      return {
        cls: list && list.className, rowN: rows.length,
        headN: head ? head.children.length : 0,
        heads: head ? [...head.children].map(c => ({ t: c.textContent.trim(), tag: c.tagName, ...box(c) })) : [],
        cells: first ? [...first.children].map(c => ({ cls: c.className, ...box(c) })) : [],
        names: rows.map(r => r.querySelector('.c-name').textContent),
        title: first && first.querySelector('.c-name').textContent,
        hasSum: !!(first && first.querySelector('.c-sum')),
        hasDate: !!(first && first.querySelector('.c-date')),
        hasKp: !!(first && first.querySelector('.c-kp')),
        hasLink: !!(first && first.querySelector('.c-link')),
        cardBtnOn: btns[0].classList.contains('on'), listBtnOn: btns[1].classList.contains('on'),
        saved: state.settings.kbdView,
        statLine: [...document.querySelectorAll('#view .card div')].map(d => d.textContent).find(t => t.includes('当前显示')) || '',
      };
    })()`);
    check('切到列表视图（kbd-list + 行数 = 3）', s2.cls === 'kbd-list' && s2.rowN === 3, `${s2.cls} n=${s2.rowN}`);
    check('列表顶部有表头，六列', s2.headN === 6, `headN=${s2.headN}`);
    check('表头文案：名称 / 标签 / 知识点 / 链出·被链 / 摘要 / 日期',
      ['笔记名称', '标签', '知识点', '链出/被链', '摘要', '修改日期'].every((t, i) => (s2.heads[i].t || '').startsWith(t)),
      s2.heads.map(h => h.t.replace(/[▲▼]/g, '')).join(' | '));
    check('表头列宽与行单元格逐列对齐（误差 ≤ 2px）',
      s2.cells.length === 6 && s2.heads.every((h, i) => Math.abs(h.x - s2.cells[i].x) <= 2),
      s2.heads.map((h, i) => `${h.x}/${s2.cells[i] && s2.cells[i].x}`).join(' '));
    check('行内含 名称 / 摘要 / 知识点 / 链接 / 日期 五类单元格', s2.hasSum && s2.hasDate && s2.hasKp && s2.hasLink && !!s2.title, s2.title);
    check('☰ 高亮、▦ 取消', s2.listBtnOn === true && s2.cardBtnOn === false, `card=${s2.cardBtnOn} list=${s2.listBtnOn}`);
    check('选择已持久化（settings.kbdView = list）', s2.saved === 'list', String(s2.saved));
    check('统计行写明列表视图与排序', s2.statLine.includes('列表视图') && s2.statLine.includes('按修改日期降序'), s2.statLine.trim());
    await shot('2-知识库文档-列表视图');

    /* 2b) 点表头排序：笔记名称升序 → 再点降序 */
    const s2b = await cdp.eval(`(async()=>{
      const btn = t => [...document.querySelectorAll('.kbd-list-head button.kd-col')].find(b => b.textContent.includes(t));
      const names = () => [...document.querySelectorAll('.kbd-row')].map(r => r.querySelector('.c-name').textContent);
      const before = names();
      btn('笔记名称').click();
      await new Promise(r => setTimeout(r, 600));
      const asc = names();
      const arrow1 = document.querySelector('.kbd-list-head .kd-ar').textContent;
      const onCls = document.querySelector('.kbd-list-head button.kd-col.on').className;
      btn('笔记名称').click();
      await new Promise(r => setTimeout(r, 600));
      const desc = names();
      const arrow2 = document.querySelector('.kbd-list-head .kd-ar').textContent;
      return { before, asc, desc, arrow1, arrow2, onCls, stat: [...document.querySelectorAll('#view .card div')].map(d => d.textContent).find(t => t.includes('当前显示')) || '' };
    })()`);
    const iSuo = s2b.asc.findIndex(n => n.startsWith('索引'));
    const iYong = s2b.asc.findIndex(n => n.startsWith('拥塞'));
    check('点「笔记名称」按拼音升序（索引 < 拥塞）',
      iSuo >= 0 && iYong >= 0 && iSuo < iYong,
      s2b.asc.join(' , '));
    check('当前排序列高亮 + 升序箭头 ▲', /c-name on/.test(s2b.onCls) && s2b.arrow1 === '▲', `${s2b.onCls} ${s2b.arrow1}`);
    check('再点一次变降序（▲ → ▼，顺序反转）',
      s2b.arrow2 === '▼' && s2b.desc.join('|') === [...s2b.asc].reverse().join('|'), `${s2b.arrow2} ${s2b.desc.join(' , ')}`);
    check('统计行跟随排序变化', s2b.stat.includes('按笔记名称降序'), s2b.stat.trim());
    await shot('2b-知识库文档-列表排序');

    /* 2c) 窄屏逐级隐藏列：摘要 → 知识点 → 标签，表头与行同步 */
    const widths = [[1100, 5], [950, 4], [800, 3]];
    for (const [w, want] of widths) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: 960, deviceScaleFactor: 1, mobile: false });
      await sleep(500);
      const r = await cdp.eval(`(()=>{
        const vis = el => getComputedStyle(el).display !== 'none';
        const head = document.querySelector('.kbd-list-head');
        const row = document.querySelector('.kbd-row');
        const hn = [...head.children].filter(vis).length;
        const rn = [...row.children].filter(vis).length;
        const hx = [...head.children].filter(vis).map(c => Math.round(c.getBoundingClientRect().x));
        const rx = [...row.children].filter(vis).map(c => Math.round(c.getBoundingClientRect().x));
        return { hn, rn, aligned: hx.every((x, i) => Math.abs(x - rx[i]) <= 2) };
      })()`);
      check(`窄屏 ${w}px：表头与行都剩 ${want} 列且逐列对齐`, r.hn === want && r.rn === want && r.aligned, JSON.stringify(r));
    }
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 2, mobile: false });
    await sleep(400);

    /* 2d) 真实鼠标拖动表头手柄调列宽 */
    const beforeW = await cdp.eval(`(()=>{
      const hd = document.querySelector('.kbd-list-head .kd-hd[data-k="name"]');
      const cell = document.querySelector('.kbd-list-head .kd-col[data-k="name"]');
      const r = hd.getBoundingClientRect();
      return {
        w: Math.round(cell.getBoundingClientRect().width),
        x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2),
        cursor: getComputedStyle(hd).cursor,
        hdN: document.querySelectorAll('.kbd-list-head .kd-hd').length,
        hdCursorN: [...document.querySelectorAll('.kbd-list-head .kd-hd')].filter(h => getComputedStyle(h).cursor === 'col-resize').length,
      };
    })()`);
    check('表头六列都有拖拽手柄，光标 col-resize', beforeW.hdN === 6 && beforeW.hdCursorN === 6, `n=${beforeW.hdN} resize=${beforeW.hdCursorN}`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: beforeW.x, y: beforeW.y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: beforeW.x + 60, y: beforeW.y, button: 'left' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: beforeW.x + 120, y: beforeW.y, button: 'left' });
    const midW = await cdp.eval(`(()=>{
      const cell = document.querySelector('.kbd-list-head .kd-col[data-k="name"]');
      return { w: Math.round(cell.getBoundingClientRect().width), resizing: document.body.classList.contains('kd-resizing') };
    })()`);
    check('拖动过程中列宽实时跟随（~+120px）', Math.abs(midW.w - (beforeW.w + 120)) <= 6, `${beforeW.w} → ${midW.w}`);
    check('拖动中 body 带 kd-resizing（锁定光标 / 禁选中）', midW.resizing === true, '');
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: beforeW.x + 120, y: beforeW.y, button: 'left', clickCount: 1 });
    await sleep(600);
    const afterW = await cdp.eval(`(()=>{
      const cell = document.querySelector('.kbd-list-head .kd-col[data-k="name"]');
      const hx = [...document.querySelectorAll('.kbd-list-head .kd-col')].map(c => Math.round(c.getBoundingClientRect().x));
      const rx = [...document.querySelector('.kbd-row').children].map(c => Math.round(c.getBoundingClientRect().x));
      return {
        w: Math.round(cell.getBoundingClientRect().width), saved: (state.settings.kbdColW || {}).name,
        aligned: hx.every((x, i) => Math.abs(x - rx[i]) <= 2),
        resizing: document.body.classList.contains('kd-resizing'),
      };
    })()`);
    check('松手后列宽保持', Math.abs(afterW.w - (beforeW.w + 120)) <= 6, String(afterW.w));
    check('列宽写入设置（settings.kbdColW.name）', Math.abs(afterW.saved - afterW.w) <= 6, String(afterW.saved));
    check('拖宽后表头与行仍逐列对齐', afterW.aligned === true, '');
    check('松手后解除 kd-resizing', afterW.resizing === false, '');
    await shot('2c-列表-拖动列宽');

    /* 3) 刷新页面：视图与列宽都保持 */
    await cdp.send('Page.navigate', { url: HTML_URL });
    await sleep(3500);
    const s3 = await cdp.eval(`(async()=>{
      await go('kbdocs');
      await new Promise(r => setTimeout(r, 800));
      const list = document.querySelector('#kbdCards');
      const cell = document.querySelector('.kbd-list-head .kd-col[data-k="name"]');
      return {
        cls: list.className, saved: state.settings.kbdView,
        nowW: cell ? Math.round(cell.getBoundingClientRect().width) : 0,
        colW: (state.settings.kbdColW || {}).name,
      };
    })()`);
    check('刷新后仍是列表视图（设置被记住）', s3.cls === 'kbd-list' && s3.saved === 'list', `${s3.cls} saved=${s3.saved}`);
    check('刷新后列宽保持（拖动结果被记住）', Math.abs(s3.nowW - s3.colW) <= 3 && s3.nowW > 300, `${s3.nowW} vs saved=${s3.colW}`);

    /* 3b) 双击手柄恢复该列默认宽度 */
    const s3b = await cdp.eval(`(async()=>{
      const hd = document.querySelector('.kbd-list-head .kd-hd[data-k="name"]');
      hd.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await new Promise(r => setTimeout(r, 800));
      const cell = document.querySelector('.kbd-list-head .kd-col[data-k="name"]');
      return { w: Math.round(cell.getBoundingClientRect().width), saved: (state.settings.kbdColW || {}).name, sort: kbdSort.by };
    })()`);
    check('双击手柄恢复默认宽度 240px 并清掉该列设置',
      Math.abs(s3b.w - 240) <= 3 && s3b.saved === undefined, `${s3b.w} saved=${s3b.saved}`);
    check('双击不会误触发排序（排序仍是修改日期）', s3b.sort === 'mtime', s3b.sort);

    /* 3c) 拖动另一列后点「↺ 恢复默认列宽」全部复位 */
    const s3c = await cdp.eval(`(async()=>{
      const hd = document.querySelector('.kbd-list-head .kd-hd[data-k="tags"]');
      const r = hd.getBoundingClientRect();
      const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
      hd.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: cx, clientY: cy }));
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx + 90, clientY: cy }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: cx + 90, clientY: cy }));
      await new Promise(r => setTimeout(r, 700));
      const afterTags = Math.round(document.querySelector('.kbd-list-head .kd-col[data-k="tags"]').getBoundingClientRect().width);
      [...document.querySelectorAll('#view a')].find(a => a.textContent.includes('恢复默认列宽')).click();
      await new Promise(r => setTimeout(r, 800));
      const cell = document.querySelector('.kbd-list-head .kd-col[data-k="tags"]');
      return { afterTags, w: Math.round(cell.getBoundingClientRect().width), saved: JSON.stringify(state.settings.kbdColW || {}) };
    })()`);
    check('拖动标签列生效（~160+90px）', Math.abs(s3c.afterTags - 250) <= 8, String(s3c.afterTags));
    check('「↺ 恢复默认列宽」把全部列恢复默认', Math.abs(s3c.w - 160) <= 3 && s3c.saved === '{}', `${s3c.w} ${s3c.saved}`);

    /* 4) 点 ▦ 切回卡片 */
    const s4 = await cdp.eval(`(async()=>{
      document.querySelectorAll('.kbd-viewseg .ibtn')[0].click();
      await new Promise(r => setTimeout(r, 900));
      return { cls: document.querySelector('#kbdCards').className, saved: state.settings.kbdView };
    })()`);
    check('切回卡片视图并持久化', s4.cls === 'kbd-grid' && s4.saved === 'card', `${s4.cls} saved=${s4.saved}`);

    /* 5) 点一行打开文档编辑器 */
    const s5 = await cdp.eval(`(async()=>{
      document.querySelector('.kbd-row, .kbd-card').click();
      await new Promise(r => setTimeout(r, 900));
      return { editor: !!document.getElementById('kbdBody') || !!document.querySelector('#view textarea'), h1gone: !document.querySelector('#view h1') };
    })()`);
    check('点击行 / 卡片能打开文档编辑器', s5.editor === true, JSON.stringify(s5));

    const errs = cdp.logs.filter(l => !/favicon/i.test(l));
    check('运行期无 JS 异常', errs.length === 0, errs.slice(0, 3).join(' | '));

    console.log('\n截图目录：' + OUT);
    console.log(fails ? `\n❌ ${fails} 项未通过` : '\n✅ 全部通过');
    process.exitCode = fails ? 1 : 0;
  } catch (e) {
    console.error('运行出错：', e && e.message);
    process.exitCode = 1;
  } finally {
    cleanup();
  }
})();
