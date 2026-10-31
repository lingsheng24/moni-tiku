/* 重要程度在图谱里的实际表现：注入不同星级的题目 → 截总览 / 放大节点看外环 / 只看重要筛选
 * 运行：node desktop/截图-重要度图谱.js
 * 输出：%TEMP%/mtk-impkp/*.png
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTML_URL = 'file:///' + encodeURI(ROOT + '/模拟题库-Web版.html').replace(/#/g, '%23');
const PORT = 9393;
const PROFILE = path.join(ROOT, '教程/.edge-profile-impkp');
const OUT = path.join(os.tmpdir(), 'mtk-impkp');
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

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(PROFILE, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-sync', '--disable-features=Translate,MediaRouter',
    '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + PORT, '--window-size=1480,1100', 'about:blank',
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
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1480, height: 1050, deviceScaleFactor: 2, mobile: false });
    await cdp.send('Page.navigate', { url: HTML_URL });
    await sleep(3200);

    // 种子：6 个知识点，星级分别为 5 / 4 / 3 / 2 / 1 / 5+笔记，形成明显对比
    const seedInfo = await cdp.eval(`(async()=>{
      window.confirm = () => true; window.alert = () => {};
      const base = { document_id: 0, difficulty: 'medium', created_at: Date.now() };
      const mk = (kp, imp, content, type, options, answer) =>
        DB.add('questions', { ...base, knowledge_point: kp, importance: imp, type: type || 'single_choice', content, options, answer });
      const ids = [];
      ids.push(await mk('宏观经济', 5, '某国名义 GDP 增长 8%，平减指数上涨 3%，实际 GDP 增速约为？', 'single_choice', ['A. 5%','B. 8%','C. 11%','D. 无法判断'], 'A'));
      ids.push(await mk('宏观经济', 3, 'GDP 与 GNP 的区别是什么？', 'short_answer', null, 'GDP 按国土原则，GNP 按国民原则。'));
      ids.push(await mk('货币政策', 4, '提高法定存款准备金率会导致？', 'single_choice', ['A. 货币供给收缩','B. 货币供给扩张','C. 利率下降','D. 物价上涨'], 'A'));
      ids.push(await mk('财政政策', 3, '扩张性财政政策的主要手段是？', 'fill_blank', null, '增加政府支出、减税'));
      ids.push(await mk('通货膨胀', 2, '通货膨胀是指物价总水平持续上涨。', 'true_false', null, '正确'));
      ids.push(await mk('失业率', 1, '失业率的计算公式是什么？', 'fill_blank', null, '失业人数 ÷ 劳动力总数'));
      ids.push(await mk('汇率', 5, '本币贬值对出口的影响是？', 'single_choice', ['A. 出口更有利','B. 出口更不利','C. 无影响','D. 无法判断'], 'A'));
      await refreshData();
      await saveQNote(ids[6], '贬值 → 出口商品变便宜 → 出口增加。');
      await DB.kvSet('kpNotes', { '汇率': { text: '本币贬值利出口、不利进口。', at: Date.now() } });
      await refreshData();
      return { n: ids.length };
    })()`);
    console.log('种子题数：', JSON.stringify(seedInfo));

    const shotClip = async (name, clip) => {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    };

    // 1) 图谱总览
    await cdp.eval(`(async()=>{ await go('kp'); return true; })()`);
    await sleep(2400);

    const nodeInfo = await cdp.eval(`(()=>{
      const g = kpGraph;
      return (g ? g.nodes : []).map(n => ({ name: n.name, imp: n.imp,
        radius: Math.max(3, 8 * (0.85 + ((n.imp || 3) - 3) * 0.12)).toFixed(2) }));
    })()`);
    console.log('节点星级与半径：', JSON.stringify(nodeInfo));

    await shotClip('1-重要度-总览');

    // 2) 放大画布，看清外环与大小差异
    const rect = await cdp.eval(`(()=>{ const c = document.getElementById('kpCanvas'); const r = c.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    await shotClip('2-重要度-节点放大', { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 2 });

    // 3) 勾「⭐ 重要」筛选（真实 change 事件）
    const filt = await cdp.eval(`(async()=>{
      const chk = document.getElementById('kpImpChk');
      if (!chk) return { ok:false, reason:'找不到 kpImpChk' };
      chk.checked = true;
      chk.dispatchEvent(new Event('change', { bubbles:true }));
      await new Promise(r => setTimeout(r, 900));
      const vis = [...document.querySelectorAll('#kpImpChip')].map(x => x.style.display + '|' + x.textContent.trim().replace(/\\s+/g,' '));
      return { ok:true, chip: vis[0] || '', visibleNodes: (kpGraph ? kpGraph.nodes.filter(n => (n.imp||3) >= 4).map(n => n.name) : []) };
    })()`);
    console.log('只看重要筛选：', JSON.stringify(filt));
    await sleep(600);
    await shotClip('3-重要度-只看重要');
    const rect2 = await cdp.eval(`(()=>{ const c = document.getElementById('kpCanvas'); const r = c.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    await shotClip('4-重要度-只看重要放大', { x: rect2.x, y: rect2.y, width: rect2.w, height: rect2.h, scale: 2 });

    // 4) 选中 5 星知识点，看悬停/详情里的重要度展示
    await cdp.eval(`(async()=>{ selectKP('宏观经济'); await new Promise(r=>setTimeout(r,600)); return true; })()`);
    await sleep(700);
    const detail = await cdp.eval(`(()=>{ const d = document.getElementById('kpDetail'); return d ? d.querySelector('h3').textContent.replace(/\\s+/g,' ').trim().slice(0,120) : ''; })()`);
    console.log('5 星知识点详情卡标题：', detail);
    await shotClip('5-重要度-详情卡');

    console.log('截图目录：' + OUT);
    if (cdp.logs.length) console.log('异常：', cdp.logs.slice(0, 3));
  } catch (e) {
    console.log('❌ 中断：', e && (e.stack || e.message));
    process.exitCode = 1;
  } finally {
    cleanup();
    setTimeout(() => process.exit(process.exitCode || 0), 200);
  }
})();
