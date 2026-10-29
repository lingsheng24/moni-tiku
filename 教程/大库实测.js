/* 大题库性能实测：注入 2000 题 + 练习/错题记录，逐视图计时（优化建议 #10 预防性实测）
 * 运行：node 教程/大库实测.js */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTML_URL = 'file:///' + encodeURI(ROOT + '/模拟题库-Web版.html').replace(/#/g, '%23');
const PROFILE = path.join(ROOT, '教程/.edge-profile-bench');
const PORT = 9341;
const W = 1480, H = 940;

const sleep = ms => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0; this.pending = new Map(); this.handlers = [];
    this.ready = new Promise((res, rej) => { this.ws.onopen = () => res(); this.ws.onerror = () => rej(new Error('WebSocket 连接失败')); });
    this.ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      } else this.handlers.forEach(h => h(m));
    };
  }
  async send(method, params = {}) {
    await this.ready; const id = ++this.id;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) { const d = r.exceptionDetails; throw new Error('页面脚本异常: ' + (d.exception && (d.exception.description || d.exception.value) || d.text)); }
    return r.result && r.result.value;
  }
  close() { try { this.ws.close(); } catch (e) { } }
}

async function waitPort(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch (e) { }
    await sleep(300);
  }
  throw new Error('等不到调试端口');
}

(async () => {
  const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + PORT, '--window-size=' + W + ',' + H, 'about:blank'], { stdio: 'ignore' });
  process.on('exit', () => { try { edge.kill(); } catch (e) { } });
  const list = await waitPort('http://127.0.0.1:' + PORT + '/json/list');
  const cdp = new CDP(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  const loaded = new Promise(res => { const h = m => { if (m.method === 'Page.loadEventFired') { cdp.handlers = cdp.handlers.filter(x => x !== h); res(); } }; cdp.handlers.push(h); });
  await cdp.send('Page.navigate', { url: HTML_URL }); await loaded; await sleep(2500);

  /* 干净库：清掉旧 IndexedDB 后整页重载（不删 profile 目录，避免批量删除） */
  await cdp.eval(`(async () => {
    indexedDB.deleteDatabase('tiku-web');
    localStorage.clear(); sessionStorage.clear();
    return 'cleared';
  })()`);
  const reloaded = new Promise(res => { const h = m => { if (m.method === 'Page.loadEventFired') { cdp.handlers = cdp.handlers.filter(x => x !== h); res(); } }; cdp.handlers.push(h); });
  await cdp.send('Page.reload'); await reloaded; await sleep(2500);

  /* 注入 2000 题 + 记录 */
  console.log('注入数据中…');
  await cdp.eval(`(async () => {
    const now = Date.now(), DAY = 86400000;
    subjects = [{ id: 'sb', name: '计算机网络（压力测试）', color: '#5b8def' }];
    await saveSubjects();
    const d1 = await DB.add('docs', { title: '压力测试文档', file_name: 'bench.pdf', file_type: 'pdf', file_size: 1024000, content: '计算机网络分层模型。OSI 七层：物理层、数据链路层、网络层、传输层、会话层、表示层、应用层。TCP 三次握手与四次挥手是常考知识点。路由算法分为距离向量和链路状态两类。'.repeat(40), page_count: 30, subject_id: 'sb', created_at: now });
    const TYPES = ['single_choice', 'multiple_choice', 'true_false', 'fill_blank', 'short_answer'];
    const KPS = ['OSI模型','TCP三次握手','四次挥手','IP地址分类','子网划分','路由算法','距离向量','链路状态','ARP协议','ICMP','UDP特性','TCP拥塞控制','滑动窗口','HTTP方法','DNS解析','CDN原理','NAT转换','IPv6','VLAN','交换机原理','路由器工作原理','流量控制','差错检测','CRC校验','集线器','网桥','协议分层','服务与协议','面向连接','无连接服务'];
    const DIFS = ['easy','medium','hard'];
    const n = 2000;
    for (let i = 0; i < n; i++) {
      const t = TYPES[i % 5], kp = KPS[i % KPS.length], dif = DIFS[i % 3];
      let options = null, answer;
      if (t === 'single_choice') { options = ['A. 选项一','B. 选项二','C. 选项三','D. 选项四']; answer = 'B'; }
      else if (t === 'multiple_choice') { options = ['A. 选项一','B. 选项二','C. 选项三','D. 选项四']; answer = 'AB'; }
      else if (t === 'true_false') answer = i % 2 ? '正确' : '错误';
      else answer = '参考答案 ' + i;
      await DB.add('questions', {
        type: t, difficulty: dif,
        content: '【' + kp + '】第 ' + (i + 1) + ' 题：关于' + kp + '的说法，下列哪一项是正确的？（考察' + kp + '的基本概念与实际应用场景）',
        options, answer,
        explanation: '解析：本题考察' + kp + '，正确答案是 ' + answer + '。',
        knowledge_point: kp, document_id: d1, subject_id: 'sb',
        source_excerpt: '', created_at: now - i * 60000,
      });
    }
    /* 练习与错题各 400 条 */
    const qs = (await DB.all('questions')).map(q => q.id);
    for (let i = 0; i < 400; i++) {
      const qid = qs[(i * 37) % qs.length];
      await DB.add('practice', { question_id: qid, is_correct: i % 3 !== 0, answered_at: now - (i % 14) * DAY - i * 60000 });
      if (i % 3 === 0) {
        const q = (await DB.get('questions', qid));
        await DB.add('mistakes', { question_id: qid, user_answer: 'A', correct_answer: q.answer, mistake_reason: '知识点记错', note: '', created_at: now - (i % 10) * DAY, question_content: q.content, question_type: q.type });
      }
    }
    return 'injected:' + (await DB.all('questions')).length;
  })()`);
  await cdp.eval(`refreshData()`);   // 把注入的数据读进 state，视图计时才真实

  /* 逐视图计时 */
  console.log('逐视图计时…');
  const T = await cdp.eval(`(async () => {
    const T = {};
    const time = async (name, fn) => { const t0 = performance.now(); await fn(); T[name] = Math.round(performance.now() - t0); };
    await time('文档管理', async () => { go('docs'); await new Promise(r => setTimeout(r, 100)); });
    await time('题库列表', async () => { go('bank'); await new Promise(r => setTimeout(r, 100)); });
    await time('题库翻页', async () => { bankPage = 50; await viewBank(); await new Promise(r => setTimeout(r, 50)); });
    await time('统计分析', async () => { go('stats'); await new Promise(r => setTimeout(r, 100)); });
    await time('知识点图谱(构建+渲染)', async () => { go('kp'); await new Promise(r => setTimeout(r, 500)); });
    await time('模拟考试组卷', async () => { go('exam'); await new Promise(r => setTimeout(r, 100)); });
    await time('错题本', async () => { go('mist'); await new Promise(r => setTimeout(r, 100)); });
    await time('间隔复习', async () => { go('review'); await new Promise(r => setTimeout(r, 100)); });
    await time('知识库', async () => { go('kb'); await new Promise(r => setTimeout(r, 100)); });
    await time('首页', async () => { go('dash'); await new Promise(r => setTimeout(r, 100)); });
    return T;
  })()`);
  const kpCount = await cdp.eval(`buildGraph().nodes.length`);
  console.log('题库规模：2000 题 / 图谱节点', kpCount);
  console.log('── 视图耗时 ──');
  const SLOW = 800;
  for (const [k, v] of Object.entries(T)) console.log((v > SLOW ? '⚠ 卡' : '✓') + ' ' + k.padEnd(14, '　'), v + 'ms');
  edge.kill();
  process.exit(0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
