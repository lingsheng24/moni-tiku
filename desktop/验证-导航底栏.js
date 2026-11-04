/* 端到端验证：v2.1.1 导航栏底部固定项（帮助 / 设置）
 * 覆盖：底栏结构 → 并排不溢出 → 点击跳转与高亮 → 不参与拖动排序 → 折叠态竖排 → 截图
 * 运行：node desktop/验证-导航底栏.js       输出：%TEMP%/mtk-navfoot/*.png
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTML_URL = 'file:///' + encodeURI(ROOT + '/模拟题库-Web版.html').replace(/#/g, '%23');
const PORT = 9415;
const PROFILE = path.join(ROOT, '教程/.edge-profile-navfoot');
const OUT = path.join(os.tmpdir(), 'mtk-navfoot');
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

    /* 侧栏整条 + 底栏特写两张图 */
    const shot = async (name, clip) => {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', clip: Object.assign({ scale: 1 }, clip) });
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    };
    const shotSidebar = n => shot(n, { x: 0, y: 36, width: 240, height: 924, scale: 2 });

    /* 1) 底栏结构 */
    const s1 = await cdp.eval(`(()=>{
      const foot = document.querySelector('.nav-footrow');
      const items = [...foot.querySelectorAll('.nav-foot')];
      const rect = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) }; };
      const sidebar = document.querySelector('.sidebar');
      const tog = document.getElementById('navToggle');
      return {
        texts: items.map(i => i.querySelector('.txt').textContent),
        vs: items.map(i => i.dataset.v),
        rects: items.map(rect),
        togRect: rect(tog),
        sidebarRect: rect(sidebar),
        footBottom: Math.round(foot.getBoundingClientRect().bottom),
        footOverflow: foot.scrollWidth - foot.clientWidth,
        sidebarOverflow: sidebar.scrollWidth - sidebar.clientWidth,
        cls: items.map(i => i.className),
        groups: [...document.querySelectorAll('.nav-group .nav-item')].map(i => i.dataset.v),
      };
    })()`);
    check('底栏两项文案 = 帮助 / 设置', s1.texts.join('/') === '帮助/设置', s1.texts.join(','));
    check('底栏两项 data-v = help / set', s1.vs.join('/') === 'help/set', s1.vs.join(','));
    check('帮助与设置分行（y 不同、x 相同、等宽）', s1.rects[0].y < s1.rects[1].y && s1.rects[0].x === s1.rects[1].x && s1.rects[0].w === s1.rects[1].w, JSON.stringify(s1.rects));
    check('折叠按钮在两项下方且不越界', s1.togRect.y >= s1.rects[1].y + s1.rects[1].h && s1.togRect.right <= s1.sidebarRect.right, JSON.stringify({ tog: s1.togRect, sb: s1.sidebarRect }));
    check('底栏没有横向溢出', s1.footOverflow <= 0 && s1.sidebarOverflow <= 0, `foot=${s1.footOverflow} sidebar=${s1.sidebarOverflow}`);
    check('功能分组里已无 set / help', !s1.groups.includes('set') && !s1.groups.includes('help'), s1.groups.join(','));
    check('底栏处于侧栏最下方（在最后一项之下）', s1.footBottom <= s1.sidebarRect.y + s1.sidebarRect.h, `bottom=${s1.footBottom}`);
    await shotSidebar('1-侧栏-展开');

    /* 2) 点击跳转 + 高亮 + 页面标题 */
    const s2 = await cdp.eval(`(async()=>{
      const click = v => { document.querySelector('.nav-foot[data-v="' + v + '"]').click(); };
      click('set');
      await new Promise(r => setTimeout(r, 500));
      const setState = {
        h1: document.querySelector('#view h1') && document.querySelector('#view h1').textContent,
        active: [...document.querySelectorAll('.nav-item.active')].map(n => n.dataset.v),
        sub: document.querySelector('#view .sub') && document.querySelector('#view .sub').textContent,
      };
      click('help');
      await new Promise(r => setTimeout(r, 500));
      const helpState = {
        h1: document.querySelector('#view h1') && document.querySelector('#view h1').textContent,
        active: [...document.querySelectorAll('.nav-item.active')].map(n => n.dataset.v),
        tocFirst: [...document.querySelectorAll('#helpToc a[data-sec]')].slice(0, 3).map(a => a.textContent),
        title: (document.querySelector('#helpToc a[data-sec="set"]') || {}).textContent,
      };
      return { setState, helpState, docTitle: document.title };
    })()`);
    check('点「设置」→ 页面标题「设置」', s2.setState.h1 === '设置', s2.setState.h1);
    check('点「设置」→ 只有 set 高亮', s2.setState.active.join(',') === 'set', s2.setState.active.join(','));
    check('点「帮助」→ 页面标题「帮助」', s2.helpState.h1 === '帮助', s2.helpState.h1);
    check('点「帮助」→ 只有 help 高亮', s2.helpState.active.join(',') === 'help', s2.helpState.active.join(','));
    check('帮助目录里章节名为「设置」', (s2.helpState.title || '').includes('设置') && !(s2.helpState.title || '').includes('系统设置'), s2.helpState.title);
    await shot('2-帮助页', { x: 0, y: 36, width: 1440, height: 924, scale: 1.2 });

    /* 3) 底部项不参与拖动排序：长按 0.5s 不应进入 dragging */
    const s3 = await cdp.eval(`(async()=>{
      const el = document.querySelector('.nav-foot[data-v="set"]');
      const r = el.getBoundingClientRect();
      const opts = { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, button: 0, pointerId: 1, pointerType: 'mouse' };
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      await new Promise(r2 => setTimeout(r2, 600));
      const arming = el.classList.contains('nav-arming');
      const dragging = el.classList.contains('nav-dragging');
      document.dispatchEvent(new PointerEvent('pointerup', opts));
      await new Promise(r2 => setTimeout(r2, 100));
      return { arming, dragging, sorting: document.body.classList.contains('nav-sorting') };
    })()`);
    check('长按底部项不进入拖动（分组项才可排序）', !s3.dragging && !s3.sorting, JSON.stringify(s3));

    /* 4) 折叠态：底栏竖排、文字隐藏、不溢出 */
    const s4 = await cdp.eval(`(async()=>{
      document.getElementById('navToggle').click();
      await new Promise(r => setTimeout(r, 500));
      const foot = document.querySelector('.nav-footrow');
      const items = [...foot.querySelectorAll('.nav-foot')];
      const rect = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
      const sb = document.querySelector('.sidebar').getBoundingClientRect();
      return {
        collapsed: document.body.classList.contains('nav-collapsed'),
        dir: getComputedStyle(foot).flexDirection,
        rects: items.map(rect),
        txtVisible: items.map(i => getComputedStyle(i.querySelector('.txt')).display !== 'none'),
        overflow: document.querySelector('.sidebar').scrollWidth - document.querySelector('.sidebar').clientWidth,
        sbW: Math.round(sb.width),
      };
    })()`);
    check('折叠态生效', s4.collapsed === true, String(s4.collapsed));
    check('折叠态底栏竖排（column）', s4.dir === 'column', s4.dir);
    check('折叠态两项上下排列（y 递增、同宽）', s4.rects[0].y < s4.rects[1].y && s4.rects[0].w === s4.rects[1].w, JSON.stringify(s4.rects));
    check('折叠态文字隐藏（只留图标）', s4.txtVisible.every(v => v === false), JSON.stringify(s4.txtVisible));
    check('折叠态无横向溢出', s4.overflow <= 0, `overflow=${s4.overflow} sbW=${s4.sbW}`);
    await shotSidebar('3-侧栏-折叠');

    /* 5) 恢复展开 + 窄屏（900px）检查 */
    const s5 = await cdp.eval(`(async()=>{
      document.getElementById('navToggle').click();
      await new Promise(r => setTimeout(r, 400));
      return { collapsed: document.body.classList.contains('nav-collapsed') };
    })()`);
    check('再点一次恢复展开', s5.collapsed === false, String(s5.collapsed));

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 860, height: 960, deviceScaleFactor: 2, mobile: false });
    await sleep(600);
    const s6 = await cdp.eval(`(()=>{
      const foot = document.querySelector('.nav-footrow');
      const items = [...foot.querySelectorAll('.nav-foot')];
      const side = document.querySelector('.sidebar');
      return {
        dir: getComputedStyle(foot).flexDirection,
        w: Math.round(side.getBoundingClientRect().width),
        itemW: items.map(i => Math.round(i.getBoundingClientRect().width)),
        overflow: side.scrollWidth - side.clientWidth,
        txt: items.map(i => getComputedStyle(i.querySelector('.txt')).display),
      };
    })()`);
    check('窄屏自动折叠成图标条（64px）', s6.w === 64, s6.w);
    check('窄屏底栏竖排、图标 44px', s6.dir === 'column' && s6.itemW.every(w => w === 44), JSON.stringify(s6.itemW));
    check('窄屏无横向溢出', s6.overflow <= 0, String(s6.overflow));

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
