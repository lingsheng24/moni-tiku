/* 验证 v1.45.0：题目笔记自动挂到知识点图谱
 * 运行：node desktop/验证-图谱笔记.js
 * 手法：Edge headless 打开网页版，注入同知识点题目 + 笔记 → 进图谱选中知识点 → 核对详情卡与角标
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTML_URL = 'file:///' + encodeURI(ROOT + '/模拟题库-Web版.html').replace(/#/g, '%23');
const PORT = 9372;
const PROFILE = path.join(ROOT, '教程/.edge-profile-kpnote');
const OUT = path.join(os.tmpdir(), 'mtk-kpnote');
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

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
}

const KP = '需求价格弹性';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });   // 每次从干净题库跑，避免上次数据累积
  fs.mkdirSync(PROFILE, { recursive: true });
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-sync', '--disable-features=Translate,MediaRouter',
    '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + PORT, '--window-size=1480,1000', 'about:blank',
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
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1480, height: 1000, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: HTML_URL });
    await sleep(3500);

    // 1) 准备：两道同知识点题目 + 一条题目笔记
    const prep = await cdp.eval(`(async()=>{
      window.confirm = () => true; window.alert = () => {};
      const base = { document_id: 0, difficulty: 'medium', created_at: Date.now(), knowledge_point: '${KP}' };
      const q1 = await DB.add('questions', { ...base, type:'single_choice',
        content:'某商品价格上升 10%，需求量下降 20%，需求价格弹性是多少？',
        options:['A. 0.5','B. 2','C. 1','D. 无法判断'], answer:'B' });
      const q2 = await DB.add('questions', { ...base, type:'short_answer',
        content:'说明需求价格弹性与总收益之间的关系。', answer:'弹性大于 1 时降价增收' });
      await refreshData();   // 先刷新，saveQNote 是从 state.questions 里找原题的
      await saveQNote(q1, '弹性 = 需求量变动% ÷ 价格变动% = 20/10 = 2，是富有弹性。');
      await refreshData();
      return { q1, q2 };
    })()`);

    // 2) 进图谱并选中该知识点
    const view = await cdp.eval(`(async()=>{
      go('kp');
      await new Promise(r => setTimeout(r, 600));
      selectKP('${KP}');
      await new Promise(r => setTimeout(r, 400));
      const d = document.getElementById('kpDetail');
      const html = d ? d.innerHTML : '';
      const box = document.getElementById('kpQNotes');
      return {
        hasNode: !!(kpGraph && kpGraph.nodes.find(n => n.name === '${KP}')),
        hasBox: !!box,
        hasNoteText: html.includes('富有弹性'),
        hasPill: (d ? [...d.querySelectorAll('.pill.violet')].map(x => x.textContent.trim()).join('|') : '').includes('✏️ 题目笔记 ' + (box ? box.querySelectorAll('.q-item').length : 0) + ' 条'),
        count: kpNoteCount('${KP}'),
        chipTxt: (document.querySelector('#kpSelChip') || {}).textContent || '',
        noteItems: box ? box.querySelectorAll('.q-item').length : 0,
      };
    })()`);
    check('图谱里能找到该知识点节点', view.hasNode === true, view);
    check('详情卡出现「✏️ 题目笔记」区块', view.hasBox === true && view.noteItems >= 1, view);
    check('笔记正文出现在知识点详情卡里', view.hasNoteText === true, view);
    check('顶部胶囊显示题目笔记条数', view.hasPill === true, view);
    check('节点笔记计数把题目笔记算进去', view.count >= 1, view);

    // 3) 停在图谱详情卡上直接写新笔记 → 自动刷新（不用手动重进）
    const live = await cdp.eval(`(async()=>{
      const q2 = state.questions.find(x => x.content.indexOf('总收益') > -1);
      const before = document.querySelector('#kpQNotes') ? document.querySelector('#kpQNotes').querySelectorAll('.q-item').length : 0;
      await saveQNote(q2.id, '降价增收的前提是富有弹性；缺乏弹性时降价反而减收。');
      await new Promise(r => setTimeout(r, 200));
      const html = document.getElementById('kpDetail').innerHTML;
      const after = document.querySelector('#kpQNotes') ? document.querySelector('#kpQNotes').querySelectorAll('.q-item').length : 0;
      return { before, after, hit: html.includes('缺乏弹性时降价反而减收'), count: kpNoteCount('${KP}') };
    })()`);
    check('写笔记后详情卡当场多出一条（无需切页）', live.after === live.before + 1, live);
    check('新笔记正文即时出现', live.hit === true, live);

    // 4) 节点角标 / 「只看有笔记」把题目笔记算进去
    const badge = await cdp.eval(`(async()=>{
      setKPNoteOnly(true);
      await new Promise(r => setTimeout(r, 300));
      const visible = kpGraph.nodes.filter(n => kpNodeVisible(n)).map(n => n.name);
      setKPNoteOnly(false);
      return { visible, has: visible.indexOf('${KP}') > -1 };
    })()`);
    check('「只看有笔记」筛选包含该知识点', badge.has === true, badge);

    // 5) 一条都没有的知识点不渲染空区块
    const empty = await cdp.eval(`(async()=>{
      const qa = await DB.add('questions', { document_id:0, difficulty:'easy', created_at:Date.now(), knowledge_point:'空白知识点',
        type:'single_choice', content:'没有笔记的题', options:['A. 对','B. 错'], answer:'A' });
      await refreshData();
      go('kp'); await new Promise(r => setTimeout(r, 500));
      selectKP('空白知识点'); await new Promise(r => setTimeout(r, 300));
      const d = document.getElementById('kpDetail');
      return { hasBox: !!document.getElementById('kpQNotes'), text: d ? d.innerHTML.indexOf('✏️ 题目笔记（') : -1 };
    })()`);
    check('没有题目笔记的知识点不出现空区块', empty.hasBox === false && empty.text === -1, empty);

    // 6) 截图留档
    await cdp.eval(`(async()=>{ go('kp'); await new Promise(r=>setTimeout(r,600)); selectKP('${KP}'); await new Promise(r=>setTimeout(r,500)); return true; })()`);
    await sleep(500);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, '图谱题目笔记.png'), Buffer.from(shot.data, 'base64'));

    const errs = cdp.logs.filter(l => l.startsWith('[exception]'));
    check('无未捕获异常', errs.length === 0, errs.slice(0, 3));
    console.log('截图：' + path.join(OUT, '图谱题目笔记.png'));
  } catch (e) {
    console.log('❌ 验证中断：', e && (e.stack || e.message));
    process.exitCode = 1;
  } finally {
    const bad = results.filter(r => !r.pass).length;
    console.log(`\n===== 合计 ${results.length} 项，通过 ${results.length - bad} 项，失败 ${bad} 项 =====`);
    cleanup();
    setTimeout(() => process.exit(bad ? 1 : 0), 200);
  }
})();
