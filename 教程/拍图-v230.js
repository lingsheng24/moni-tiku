/* 拍 v2.3.0 帮助配图：22-学习周报（宽屏弹窗）/ 23-手机-首页 / 24-手机-抽屉
 * 直接输出 JPEG（quality 0.85）到 教程/截图精简/，随后跑 node 教程/生成帮助配图.js 回填
 * 运行：node 教程/拍图-v230.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTML_URL = 'file:///' + encodeURI(ROOT + '/模拟题库-Web版.html').replace(/#/g, '%23');
const PORT = 9431;
const PROFILE = path.join(ROOT, '教程/.edge-profile-v230');
const DST = path.join(ROOT, '教程/截图精简');
const sleep = ms => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0; this.pending = new Map();
    this.ready = new Promise((res, rej) => { this.ws.onopen = () => res(); this.ws.onerror = () => rej(new Error('ws fail')); });
    this.ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      }
    };
  }
  async send(method, params = {}) {
    await this.ready; const id = ++this.id;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
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
  fs.mkdirSync(DST, { recursive: true });
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-sync', '--disable-features=Translate,MediaRouter',
    '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + PORT, '--window-size=1480,960', 'about:blank',
  ], { stdio: 'ignore' });
  let cdp;
  const cleanup = () => { try { cdp && cdp.close(); } catch (e) { } try { edge.kill(); } catch (e) { } };
  process.on('exit', cleanup);

  const save = async (name, quality) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: quality || 85 });
    fs.writeFileSync(path.join(DST, name), Buffer.from(r.data, 'base64'));
    console.log('✓ 已拍', name);
  };
  const metrics = (w, h, mobile) => cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: !!mobile });

  try {
    await waitJson('http://127.0.0.1:' + PORT + '/json/version');
    const list = await waitJson('http://127.0.0.1:' + PORT + '/json/list');
    const page = (Array.isArray(list) ? list : list.targetInfos || []).find(t => t.type === 'page');
    cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');

    /* ---------- 种子数据（只造一次；IndexedDB 属于独立 profile） ---------- */
    const seed = async () => {
      await metrics(1480, 940, false);
      await cdp.send('Page.navigate', { url: HTML_URL });
      await sleep(3200);
      return await cdp.eval(`(async()=>{
        const DAY = 86400000, mon = weekStartOf(Date.now());
        const QS = [
          { type:'single_choice', content:'TCP 三次握手的第二个报文是？', options:['A. SYN','B. SYN+ACK','C. ACK','D. FIN'], answer:'B', explanation:'服务端回 SYN+ACK', knowledge_point:'三次握手', difficulty:'easy', imp:4 },
          { type:'true_false', content:'三次握手可以简化为两次。', options:null, answer:'错误', explanation:'两次无法确认客户端收包能力', knowledge_point:'三次握手', difficulty:'medium', imp:3 },
          { type:'single_choice', content:'慢启动阶段拥塞窗口如何增长？', options:['A. 线性','B. 指数'], answer:'B', explanation:'每经过一个 RTT 翻倍', knowledge_point:'拥塞控制', difficulty:'medium', imp:4 },
          { type:'fill_blank', content:'B+ 树的叶子节点用 ____ 相连。', options:null, answer:'链表', explanation:'便于范围扫描', knowledge_point:'B+ 树', difficulty:'easy', imp:2 },
        ];
        for (const q of QS) await DB.add('questions', q);
        await refreshData();
        const id = state.questions.map(q=>q.id);
        for (let i=0;i<2;i++) await DB.add('practice', { question_id:id[0], is_correct:0, answered_at: mon - 7*DAY + i*3600000 });
        await DB.add('practice', { question_id:id[0], is_correct:1, answered_at: mon + 3600000*9 });
        await DB.add('practice', { question_id:id[1], is_correct:1, answered_at: mon + DAY + 3600000*10 });
        await DB.add('practice', { question_id:id[1], is_correct:1, answered_at: mon + 2*DAY + 3600000*10 });
        await DB.add('practice', { question_id:id[2], is_correct:0, answered_at: mon + DAY + 3600000*11 });
        await DB.add('practice', { question_id:id[2], is_correct:0, answered_at: mon + 2*DAY + 3600000*11 });
        await DB.add('practice', { question_id:id[2], is_correct:1, answered_at: mon + 2*DAY + 3600000*12 });
        await DB.add('practice', { question_id:id[3], is_correct:1, answered_at: mon + 2*DAY + 3600000*13 });
        await refreshData();
        go('dash');
        await new Promise(r=>setTimeout(r,400));
        return state.practice.length;
      })()`);
    };
    const n = await seed();
    if (n !== 9) throw new Error('种子数据异常：' + n);

    /* ---------- 22-学习周报：宽屏弹窗（clip 到主区） ---------- */
    await cdp.eval(`openWeeklyReport()`);
    await sleep(700);
    let r = await cdp.send('Page.captureScreenshot', {
      format: 'jpeg', quality: 85,
      clip: { x: 212, y: 36, width: 1220, height: 900, scale: 1.4 },
    });
    fs.writeFileSync(path.join(DST, '22-学习周报.jpg'), Buffer.from(r.data, 'base64'));
    console.log('✓ 已拍 22-学习周报.jpg');
    await cdp.eval(`closeModal()`);

    /* ---------- 23/24：手机视口 ---------- */
    await metrics(390, 844, true);
    await sleep(600);
    await cdp.eval(`go('dash')`);
    await sleep(600);
    await save('23-手机-首页.jpg');
    await cdp.eval(`mDrawer(true)`);
    await sleep(500);
    await save('24-手机-抽屉.jpg');

    console.log('\n完成：教程/截图精简/ 下新增 22 / 23 / 24 三张，接着运行 node 教程/生成帮助配图.js');
  } catch (e) {
    console.error('拍图失败：', e && e.message || e);
    process.exitCode = 1;
  } finally {
    cleanup();
  }
})();
