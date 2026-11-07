/* 验证：设置页「默认出题难度」改动即保存，并在出题页预选
 * 运行：node desktop/验证-设置难度.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTML_URL = 'file:///' + encodeURI(ROOT + '/模拟题库-Web版.html').replace(/#/g, '%23');
const PORT = 9411;
const PROFILE = path.join(os.tmpdir(), 'mtk-diffchk');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  ok ? pass++ : fail++;
  console.log((ok ? '✅' : '❌') + ' ' + name + (extra !== undefined ? ' —— ' + JSON.stringify(extra) : ''));
};

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url); this.id = 0; this.pending = new Map(); this.errors = [];
    this.ready = new Promise((res, rej) => { this.ws.onopen = () => res(); this.ws.onerror = () => rej(new Error('ws')); });
    this.ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      } else if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        this.errors.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
      }
    };
  }
  async send(method, params = {}) {
    await this.ready; const id = ++this.id;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async eval(x) {
    const r = await this.send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || 'eval fail');
    return r.result && r.result.value;
  }
  close() { try { this.ws.close(); } catch (e) { } }
}
async function waitJson(u) {
  for (let i = 0; i < 80; i++) { try { const r = await fetch(u); if (r.ok) return r.json(); } catch (e) { } await sleep(300); }
  throw new Error('等不到 ' + u);
}

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true }); fs.mkdirSync(PROFILE, { recursive: true });
  const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + PROFILE,
    '--remote-debugging-port=' + PORT, '--window-size=1480,960', 'about:blank'], { stdio: 'ignore' });
  let c;
  try {
    await waitJson('http://127.0.0.1:' + PORT + '/json/version');
    const list = await waitJson('http://127.0.0.1:' + PORT + '/json/list');
    const page = (Array.isArray(list) ? list : list.targetInfos || []).find(t => t.type === 'page');
    c = new CDP(page.webSocketDebuggerUrl);
    await c.send('Page.enable'); await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1480, height: 940, deviceScaleFactor: 1, mobile: false });
    await c.send('Page.navigate', { url: HTML_URL }); await sleep(3200);

    const r1 = await c.eval(`(async()=>{
      go('set'); await new Promise(r=>setTimeout(r,600));
      const sel = document.getElementById('sDiff');
      return { has: !!sel, value: sel && sel.value, hasHandler: !!(sel && sel.onchange) };
    })()`);
    check('设置页有「默认出题难度」下拉', r1.has, r1.value);
    check('已绑定 onchange 处理器', r1.hasHandler);

    const r2 = await c.eval(`(async()=>{
      const sel = document.getElementById('sDiff');
      sel.value = 'hard';
      sel.dispatchEvent(new Event('change'));
      await new Promise(r=>setTimeout(r,700));
      const saved = await DB.kvGet('settings');
      return { mem: state.settings.defaultDifficulty, db: saved && saved.defaultDifficulty };
    })()`);
    check('改难度后内存已更新为 hard', r2.mem === 'hard', r2.mem);
    check('已落库（kv.settings.defaultDifficulty）', r2.db === 'hard', r2.db);

    const r3 = await c.eval(`(async()=>{
      go('dash'); await new Promise(r=>setTimeout(r,300));
      go('set'); await new Promise(r=>setTimeout(r,600));
      return document.getElementById('sDiff').value;
    })()`);
    check('重进设置页仍显示 hard', r3 === 'hard', r3);

    /* 出题页无文档时只有引导页，先造一篇文档再验预选 */
    const r4 = await c.eval(`(async()=>{
      await DB.add('docs', { title: '难度验证文档', name: 'diff.txt', text: '演示文本', type: 'txt', size: 8, mtime: Date.now() });
      await refreshData();
      go('gen'); await new Promise(r=>setTimeout(r,900));
      const g = document.getElementById('gDiff');
      return g ? g.value : '(无下拉)';
    })()`);
    check('出题页按保存的难度预选', r4 === 'hard', r4);

    check('运行期无 JS 异常', c.errors.length === 0, c.errors.slice(0, 2));
    console.log('\n' + (fail ? '❌ 失败 ' + fail + ' 项' : '✅ 全部通过') + `（通过 ${pass} / ${pass + fail}）`);
    if (fail) process.exitCode = 1;
  } catch (e) {
    console.error('ERR', e.message); process.exitCode = 1;
  } finally {
    c && c.close(); try { edge.kill(); } catch (e) { }
  }
})();
