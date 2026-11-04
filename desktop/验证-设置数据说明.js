/* 端到端验证：v2.1.1 数据说明移入「设置 → 软件更新」卡片
 * 覆盖：侧栏无底部小字 → 设置页卡片内容（版本 / 刷新 / 数据说明）→ 说明块样式 → 帮助手册同步 → 截图
 * 运行：node desktop/验证-设置数据说明.js   输出：%TEMP%/mtk-updnote/*.png
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTML_URL = 'file:///' + encodeURI(ROOT + '/模拟题库-Web版.html').replace(/#/g, '%23');
const PORT = 9417;
const PROFILE = path.join(ROOT, '教程/.edge-profile-updnote');
const OUT = path.join(os.tmpdir(), 'mtk-updnote');
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
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: Object.assign({ scale: 1 }, clip || { x: 0, y: 36, width: 1440, height: 924 }) });
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    };

    /* 1) 侧栏干净、底栏仍在底部 */
    const s1 = await cdp.eval(`(()=>{
      const sb = document.querySelector('.sidebar');
      const foot = document.querySelector('.nav-footrow');
      return {
        hasFootText: !!sb.querySelector('.foot'),
        sidebarText: sb.innerText.replace(/\\n+/g, '|'),
        footBottomGap: Math.round(sb.getBoundingClientRect().bottom - foot.getBoundingClientRect().bottom),
        footItems: [...foot.querySelectorAll('.nav-foot')].map(i => i.querySelector('.txt').textContent),
        overflow: sb.scrollWidth - sb.clientWidth,
      };
    })()`);
    check('侧栏已无底部灰字说明', s1.hasFootText === false && !s1.sidebarText.includes('数据保存在本机'), s1.sidebarText.slice(0, 60));
    check('底栏仍贴底（只剩侧栏 padding ≤ 24px）', s1.footBottomGap >= 0 && s1.footBottomGap <= 24, String(s1.footBottomGap));
    check('底栏仍是 帮助 + 设置', s1.footItems.join('/') === '帮助/设置', s1.footItems.join(','));
    check('侧栏无横向溢出', s1.overflow <= 0, String(s1.overflow));
    await shot('1-侧栏-无底部说明', { x: 0, y: 36, width: 240, height: 924, scale: 2 });

    /* 2) 设置页最后一张卡片 = 软件更新，含版本 / 刷新 / 数据说明 */
    const s2 = await cdp.eval(`(async()=>{
      go('set');
      await new Promise(r => setTimeout(r, 900));
      const host = document.getElementById('updCardHost');
      const card = host && host.querySelector('.card');
      const note = host && host.querySelector('.upd-data-note');
      const cards = [...document.querySelectorAll('#view .card h3')].map(h => h.textContent);
      const rect = el => { const r = el.getBoundingClientRect(); return { y: Math.round(r.y), h: Math.round(r.height), w: Math.round(r.width) }; };
      return {
        isLast: cards[cards.length - 1] && cards[cards.length - 1].includes('软件更新'),
        cardTitles: cards.slice(-3),
        h3: card && card.querySelector('h3').textContent,
        pills: card ? [...card.querySelectorAll('.pill')].map(p => p.textContent) : [],
        buttons: card ? [...card.querySelectorAll('button')].map(b => b.textContent.trim()) : [],
        noteText: note && note.innerText.replace(/\\s+/g, ' '),
        noteBg: note && getComputedStyle(note).backgroundColor,
        noteBorder: note && getComputedStyle(note).borderTopWidth,
        noteRect: note && rect(note),
        hasCheckBtn: !!(card && card.querySelector('#updCheck')),
        hostDisplay: host && getComputedStyle(host).display,
      };
    })()`);
    check('设置页最后一张卡片是「软件更新」', s2.isLast === true, s2.cardTitles.join(' / '));
    check('卡片显示当前版本 + 网页版标记', s2.pills.some(p => p.includes('当前版本')) && s2.pills.some(p => p.includes('网页版')), s2.pills.join(','));
    check('网页版卡片有「刷新到最新」而非检查更新', s2.buttons.some(b => b.includes('刷新到最新')) && !s2.hasCheckBtn, s2.buttons.join(','));
    check('数据说明块存在且文案含 IndexedDB / 不上传', !!s2.noteText && s2.noteText.includes('IndexedDB') && s2.noteText.includes('不会上传到任何服务器'), s2.noteText && s2.noteText.slice(0, 80));
    check('数据说明块是灰底带边框的小块', s2.noteBg !== 'rgba(0, 0, 0, 0)' && s2.noteBorder !== '0px', `${s2.noteBg} / ${s2.noteBorder}`);
    check('说明块高度合理（未被压扁 / 撑爆）', s2.noteRect.h > 40 && s2.noteRect.h < 160, JSON.stringify(s2.noteRect));
    await shot('2-设置页-软件更新卡片');
    
    await shot('3-设置页-数据说明特写', { x: 500, y: 2380, width: 940, height: 560, scale: 1.6 });

    /* 3) 帮助手册同步 */
    const s3 = await cdp.eval(`(async()=>{
      go('help');
      await new Promise(r => setTimeout(r, 600));
      const txt = document.getElementById('helpBody').innerText;
      return {
        hasCardNote: txt.includes('「设置 → 软件更新」卡片末尾'),
        hasSection: txt.includes('检查更新 / 版本与数据'),
        hasSetSec: txt.includes('软件更新 / 版本与数据'),
        hasOld: txt.includes('使用帮助'),
      };
    })()`);
    check('帮助·安装章提到数据说明在软件更新卡片末尾', s3.hasCardNote === true, String(s3.hasCardNote));
    check('帮助·安装章小节名为「检查更新 / 版本与数据」', s3.hasSection === true, String(s3.hasSection));
    check('帮助·设置章有「软件更新 / 版本与数据」小节', s3.hasSetSec === true, String(s3.hasSetSec));

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
