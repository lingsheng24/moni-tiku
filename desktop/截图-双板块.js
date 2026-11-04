/* 截图：两大板块切换工作区（v1.51.0）
 * 验证：板块卡显隐 / 点击切换跳转 / go() 跟随 / 折叠态单字卡 / 刷新记住板块 / 组内排序兼容
 * 运行：node desktop/截图-双板块.js
 * 输出：%TEMP%/mtk-navsec/*.png
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTML_URL = 'file:///' + encodeURI(ROOT + '/模拟题库-Web版.html').replace(/#/g, '%23');
const PORT = 9395;
const PROFILE = path.join(ROOT, '教程/.edge-profile-navsec');
const OUT = path.join(os.tmpdir(), 'mtk-navsec');
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
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 2, mobile: false });
    await cdp.send('Page.navigate', { url: HTML_URL });
    await sleep(3000);

    const shot = async (name, clip) => {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    };
    const snap = `(()=>{ const r = document.querySelector('.sidebar').getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; })()`;

    // 1) 初始：知识库板块
    const s1 = await cdp.eval(`(()=>({
      sec: document.body.dataset.sec,
      active: document.querySelector('.nav-sec-card.active') && document.querySelector('.nav-sec-card.active').dataset.sec,
      visible: [...document.querySelectorAll('.sidebar .nav-group')].filter(g => getComputedStyle(g).display !== 'none').map(g => (g.dataset.sec || g.dataset.g) + ':' + [...g.querySelectorAll('.nav-item')].map(n => n.dataset.v).join('>')),
    }))()`);
    check('启动默认知识库板块', s1.sec === 'kb' && s1.active === 'kb', JSON.stringify(s1));
    check('可见组 = 首页 + 知识库3项 + 统计/设置',
      s1.visible.length === 3 && s1.visible[0] === 'common:dash' && s1.visible[1] === 'kb:docs>kb>kp' && s1.visible[2] === 'common2:stats>set',
      s1.visible.join(' | '));
    const sw = await cdp.eval(snap);
    await shot('1-知识库板块', { x: sw.x, y: sw.y, width: sw.w, height: Math.min(760, sw.h), scale: 2 });

    // 2) 点「模拟题库」卡 → 切板块 + 跳 AI 生成题目
    await cdp.eval(`(async()=>{ document.querySelector('.nav-sec-card[data-sec="tik"]').click(); return true; })()`);
    await sleep(700);
    const s2 = await cdp.eval(`(()=>({
      sec: document.body.dataset.sec, view: curView,
      active: document.querySelector('.nav-sec-card.active').dataset.sec,
      tikVisible: getComputedStyle(document.querySelector('[data-g="sec-tik"]')).display !== 'none',
      kbHidden: getComputedStyle(document.querySelector('[data-g="sec-kb"]')).display === 'none',
      saved: state.settings.navSection,
    }))()`);
    check('点卡切板块并跳到 AI 生成题目', s2.sec === 'tik' && s2.view === 'gen' && s2.active === 'tik' && s2.tikVisible && s2.kbHidden, JSON.stringify(s2));
    await shot('2-模拟题库板块', { x: sw.x, y: sw.y, width: sw.w, height: Math.min(760, sw.h), scale: 2 });

    // 3) go('review') → 板块跟随
    await cdp.eval(`(async()=>{ go('review'); return true; })()`);
    await sleep(700);
    const s3 = await cdp.eval(`(()=>({ sec: document.body.dataset.sec, view: curView }))()`);
    check('跳板块内视图自动跟随板块', s3.sec === 'tik' && s3.view === 'review', JSON.stringify(s3));

    // 4) 刷新后记住板块
    await cdp.send('Page.navigate', { url: HTML_URL });
    await sleep(3000);
    const s4 = await cdp.eval(`(()=>({ sec: document.body.dataset.sec, saved: state.settings.navSection }))()`);
    check('刷新后记住上次板块（模拟题库）', s4.sec === 'tik' && s4.saved === 'tik', JSON.stringify(s4));

    // 5) 折叠态单字卡
    await cdp.eval(`(async()=>{ state.settings.navCollapsed = 1; applyNavWidth(); return true; })()`);
    await sleep(500);
    const s5 = await cdp.eval(`(()=>({
      cardsVisible: [...document.querySelectorAll('.nav-sec-card')].every(c => getComputedStyle(c).display !== 'none'),
      miniShown: getComputedStyle(document.querySelector('.nav-sec-card[data-sec="tik"] .sec-mini')).display !== 'none',
      metaHidden: getComputedStyle(document.querySelector('.nav-sec-card[data-sec="tik"] .sec-meta')).display === 'none',
    }))()`);
    check('折叠态两卡竖排单字显示', s5.cardsVisible && s5.miniShown && s5.metaHidden, JSON.stringify(s5));
    const sw2 = await cdp.eval(snap);
    await shot('3-折叠态', { x: sw2.x, y: sw2.y, width: 200, height: Math.min(700, sw2.h), scale: 2 });

    // 6) 组内排序兼容（模拟题库板块内换序仍生效、跨组不落位）
    await cdp.eval(`(async()=>{ document.body.classList.remove('nav-collapsed'); applyNavWidth(); return true; })()`);
    await sleep(400);
    const s6 = await cdp.eval(`(async()=>{
      state.settings.navOrder = ['review','mist','exam','practice','kb','kp','bank','gen','docs','help','set','stats','dash'];
      applyNavOrder();
      const groups = [...document.querySelectorAll('.sidebar .nav-group')].map(g=>(g.dataset.sec||g.dataset.g)+':'+[...g.querySelectorAll('.nav-item')].map(n=>n.dataset.v).join('>'));
      state.settings.navOrder = []; applyNavOrder();
      return groups;
    })()`);
    const kbG = s6.find(g => g.startsWith('kb:')) || '', tikG = s6.find(g => g.startsWith('tik:')) || '';
    check('组内排序兼容：板块内换序生效、未串组',
      tikG.startsWith('tik:review>mist') && tikG.includes('>docs') === false && kbG.startsWith('kb:kb>kp>docs'),
      s6.join(' | '));

    // 7) 恢复板块到知识库，避免污染后续手工测试
    await cdp.eval(`(async()=>{ applySection('kb', true); go('dash'); return true; })()`);
    await sleep(400);

    console.log('截图目录：' + OUT);
    console.log(fails ? ('❌ ' + fails + ' 项不通过') : '✅ 全部通过');
    if (cdp.logs.length) console.log('页面异常：', cdp.logs.slice(0, 3));
    if (fails || cdp.logs.length) process.exitCode = 1;
  } catch (e) {
    console.log('❌ 中断：', e && (e.stack || e.message));
    process.exitCode = 1;
  } finally {
    cleanup();
    setTimeout(() => process.exit(process.exitCode || 0), 200);
  }
})();
