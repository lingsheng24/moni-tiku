/* 图谱页图标精简验收：注入种子数据 → 打开知识点图谱 → 截图（总览 / 详情卡 / 悬停气泡）
 * 运行：node desktop/截图-图谱图标.js
 * 输出：%TEMP%/mtk-kpico/*.png
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTML_URL = 'file:///' + encodeURI(ROOT + '/模拟题库-Web版.html').replace(/#/g, '%23');
const PORT = 9391;
const PROFILE = path.join(ROOT, '教程/.edge-profile-kpico');
const OUT = path.join(os.tmpdir(), 'mtk-kpico');
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
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1480, height: 1100, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: HTML_URL });
    await sleep(3200);

    // 种子数据：8 题覆盖多个知识点，部分题跨知识点形成双链
    await cdp.eval(`(async()=>{
      window.confirm = () => true; window.alert = () => {};
      const base = { document_id: 0, difficulty: 'medium', created_at: Date.now() };
      const rows = [
        ['宏观经济学、GDP核算', 'single_choice', '某国去年名义 GDP 增长 8%，GDP 平减指数上涨 3%，则实际 GDP 增速约为？', ['A. 5%','B. 8%','C. 11%','D. 无法判断'], 'A'],
        ['宏观经济学、通货膨胀', 'true_false', '通货膨胀率上升时，居民手中货币的实际购买力下降。', null, '正确'],
        ['货币政策、通货膨胀', 'single_choice', '中央银行提高法定存款准备金率，通常会导致？', ['A. 货币供给收缩','B. 货币供给扩张','C. 利率下降','D. 物价上涨'], 'A'],
        ['财政政策、宏观经济学', 'fill_blank', '政府通过增加支出、减少税收来刺激总需求的政策叫______政策。', null, '扩张性财政'],
        ['汇率、国际贸易', 'single_choice', '本币贬值通常会使本国出口商品在国际市场上？', ['A. 更便宜、更有竞争力','B. 更昂贵','C. 数量减少','D. 没有影响'], 'A'],
        ['失业率、宏观经济学', 'short_answer', '简述摩擦性失业与结构性失业的区别。', null, '摩擦性失业是劳动力市场信息不充分、转换工作期间的暂时失业；结构性失业是技能与岗位需求不匹配造成的长期失业。'],
        ['GDP核算', 'true_false', 'GDP 只统计最终产品和服务，不统计中间产品。', null, '正确'],
        ['国际贸易、汇率', 'short_answer', '简述购买力平价理论的基本含义。', null, '两国货币的购买力之比决定汇率，长期看汇率会趋向于使同一篮子商品在两国价格相等。'],
      ];
      const ids = [];
      for (const [kp, type, content, options, answer] of rows) {
        ids.push(await DB.add('questions', { ...base, knowledge_point: kp, type, content, options, answer }));
      }
      await refreshData();
      await saveQNote(ids[0], '先算实际 = 名义 − 通胀；别把平减指数当 CPI。');
      await DB.kvSet('kpNotes', {
        '通货膨胀': { text: '通胀 = 物价总水平持续上涨；注意区分 CPI 与 GDP 平减指数。', at: Date.now() },
        '货币政策': { text: '三大工具：存款准备金率、再贴现率、公开市场操作。', at: Date.now() },
      });
      await DB.add('mistakes', { question_id: ids[0], type: 'single_choice',
        question_content: '某国去年名义 GDP 增长 8%，GDP 平减指数上涨 3%，则实际 GDP 增速约为？',
        user_answer: 'C', correct_answer: 'A', difficulty: 'medium',
        mistake_reason: '把名义增速当实际增速', created_at: Date.now() });
      await refreshData();
      return ids.length;
    })()`);
    await sleep(600);

    const shot = async (name) => {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    };

    // 1) 图谱总览
    await cdp.eval(`(async()=>{ await go('kp'); return true; })()`);
    await sleep(2200);
    await shot('1-图谱总览');

    // 2) 控制条悬停气泡（放大按钮）
    const tipInfo = await cdp.eval(`(()=>{
      const b = document.querySelector('.kpz button[data-tip]');
      if (!b) return { ok:false };
      b.dispatchEvent(new MouseEvent('mouseover', { bubbles:true }));
      const cs = getComputedStyle(b, '::after');
      return { ok:true, tip: b.dataset.tip, w: b.offsetWidth, h: b.offsetHeight,
               content: cs.content, opacity: cs.opacity, right: cs.right };
    })()`);
    console.log('控制条气泡：', JSON.stringify(tipInfo));
    await shot('2-图谱-控制条气泡');

    // 3) 选中知识点 → 详情卡
    const sel = await cdp.eval(`(async()=>{
      selectKP('宏观经济学');
      await new Promise(r => setTimeout(r, 500));
      const d = document.getElementById('kpDetail');
      if (d) d.scrollIntoView({ block:'start' });
      await new Promise(r => setTimeout(r, 400));
      const btns = d ? [...d.querySelectorAll('button')].map(b => ({ cls: b.className, txt: b.textContent.trim().slice(0,12), tip: b.dataset.tip || '' })) : [];
      return { hasDetail: !!d, h3: d ? (d.querySelector('h3') || {}).textContent.trim().slice(0,40) : '', btns };
    })()`);
    console.log('详情卡按钮：', JSON.stringify(sel, null, 1));
    await shot('3-图谱-详情卡');

    // 4) 详情卡下半（笔记区、题目行）
    await cdp.eval(`(()=>{ const e = document.getElementById('kpQNotes') || document.getElementById('kpn-tgl'); if (e) e.scrollIntoView({ block:'center' }); return true; })()`);
    await sleep(500);
    await shot('4-图谱-笔记与题目行');

    // 统计
    const stats = await cdp.eval(`(()=>{
      const all = [...document.querySelectorAll('#view button')];
      return { total: all.length,
        ibtn: all.filter(b => b.classList.contains('ibtn')).length,
        ghost: all.filter(b => b.classList.contains('ghost')).length,
        primary: all.filter(b => b.classList.contains('primary')).length,
        textBtn: all.filter(b => b.textContent.trim().length > 2 && !b.classList.contains('kp-legend-item')).map(b => b.textContent.trim().slice(0,14)) };
    })()`);
    console.log('图谱页按钮统计：', JSON.stringify(stats));

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
