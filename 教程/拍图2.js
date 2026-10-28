/* 补拍 15-18：联网查询（注入演示结果）/ AI 对话 / 成绩报告 / 组卷导出区
 * 需先注入种子数据（IndexedDB），保证收藏夹、考试记录等有内容 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTML_URL = 'file:///' + encodeURI(ROOT + '/模拟题库-Web版.html').replace(/#/g, '%23');
const OUT = path.join(ROOT, '教程/截图');
const PROFILE = path.join(ROOT, '教程/.edge-profile');
const PORT = 9335;
const W = 1480, H = 940, DPR = 2;

const sleep = ms => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0; this.pending = new Map(); this.handlers = [];
    this.ready = new Promise((res, rej) => {
      this.ws.onopen = () => res(); this.ws.onerror = () => rej(new Error('WS 失败'));
    });
    this.ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      } else this.handlers.forEach(h => h(m));
    };
  }
  async send(method, params = {}) {
    await this.ready; const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expr, awaitPromise = true) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('页面脚本异常: ' + (d.exception && (d.exception.description || d.exception.value) || d.text));
    }
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
  if (fs.existsSync(PROFILE)) fs.rmSync(PROFILE, { recursive: true, force: true });
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--disable-sync',
    '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + PORT,
    '--window-size=' + W + ',' + H, 'about:blank',
  ], { stdio: 'ignore' });
  const cleanup = () => { try { edge.kill(); } catch (e) { } };
  process.on('exit', cleanup);

  try {
    await waitPort('http://127.0.0.1:' + PORT + '/json/version');
    const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
    const page = list.find(t => t.type === 'page');
    const cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
    const loaded = new Promise(res => {
      const h = m => { if (m.method === 'Page.loadEventFired') { cdp.handlers = cdp.handlers.filter(x => x !== h); res(); } };
      cdp.handlers.push(h);
    });
    await cdp.send('Page.navigate', { url: HTML_URL });
    await loaded;
    await sleep(3000);

    const seed = fs.readFileSync(path.join(ROOT, '教程/种子数据.js'), 'utf8');
    console.log('种子:', await cdp.eval(seed));
    await sleep(800);

    const snap = async (name, wait = 900) => {
      await sleep(wait);
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      const file = path.join(OUT, name + '.png');
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      console.log('✓', name + '.png', (fs.statSync(file).size / 1024).toFixed(0) + 'KB');
    };

    /* 15. 联网查询：注入演示搜索结果（真实抓取仅桌面版支持，网页版演示用注入） */
    await cdp.eval(`go('kb')`, false);
    await sleep(500);
    await cdp.eval(`(() => {
      wsOpen('', '');
      const inp = document.getElementById('wsQ');
      if (inp) inp.value = 'TCP 三次握手 为什么不能是两次';
      wsState.q = 'TCP 三次握手 为什么不能是两次';
      wsState.kp = '三次握手';
      wsState.results = [
        { title: 'TCP 为什么是三次握手，而不是两次或四次？', site: '知乎', url: 'https://www.zhihu.com/question/24690569', snippet: '三次握手的本质是通信双方各交换一次 SYN 和 ACK：客户端证明自己能发能收，服务端同样确认对方的收发能力，同时同步初始序号（ISN）。两次握手无法阻止历史失效的连接请求突然到达服务端……' },
        { title: '图解 TCP 三次握手与四次挥手', site: '博客园', url: 'https://www.cnblogs.com/tcpray/p/10334532.html', snippet: '第一次握手：客户端发送 SYN 包（seq=x）进入 SYN_SENT；第二次握手：服务端回复 SYN+ACK（seq=y, ack=x+1）进入 SYN_RCVD；第三次握手：客户端发送 ACK（ack=y+1），双方进入 ESTABLISHED。' },
        { title: '为什么 TCP 建立连接需要三次握手？', site: 'CSDN', url: 'https://blog.csdn.net/hyg131081/article/details/105368928', snippet: '核心是 RFC 793 指出的：旧的重复连接请求（历史 SYN）可能因网络延迟迟到。若采用两次握手，服务端收到旧 SYN 后即建立连接并等待数据，造成资源浪费；三次握手下客户端可用 RST 拒绝历史连接。' },
        { title: '计算机网络微课堂 · 传输层 TCP 连接建立', site: 'Bilibili', url: 'https://www.bilibili.com/video/BV1c4411d7jb?p=57', snippet: '用动画演示三次握手每一帧报文段的序号变化，解释 SYN 消耗一个序号、ACK 不消耗序号的细节，以及 SYN Flood 攻击与半连接队列的关系。' },
        { title: 'TCP 三次握手、四次挥手 - 面试高频考点整理', site: '掘金', url: 'https://juejin.cn/post/6844904002828167181', snippet: '三次握手不能简化为两次：服务端需要确认客户端能收到自己的报文；也不能省掉 SYN 的确认——初始序号必须被双方确认，否则后续可靠传输无从谈起。' },
      ];
      wsRenderResults();
      return 1;
    })()`, false);
    await snap('15-联网查询搜索', 700);

    /* 16. AI 对话演示（注入对话内容渲染 UI） */
    await cdp.eval(`wsClose()`, false);
    await sleep(400);
    await cdp.eval(`(() => {
      wsOpen('', '');
      const inp = document.getElementById('wsQ');
      if (inp) inp.value = 'TCP 三次握手 为什么不能是两次';
      wsState.q = inp ? inp.value : '';
      wsState.kp = '三次握手';
      wsState.results = [
        { title: 'TCP 为什么是三次握手，而不是两次或四次？', site: '知乎', url: 'https://www.zhihu.com/question/24690569', snippet: '三次握手的本质是通信双方各交换一次 SYN 和 ACK……' },
      ];
      wsRenderResults();
      wsState.aiMsgs = [
        { role: 'user', content: 'TCP 三次握手 为什么不能是两次？' },
        { role: 'assistant', content: '核心原因：两次握手无法让**服务端**确认客户端的接收能力，也无法防止历史（迟到）连接占用资源。\\n\\n分两点看：\\n\\n1. **确认能力需要来回两次**——客户端发 SYN 证明"我能发"，服务端回 SYN+ACK 证明"我能发也能收"，但此时客户端还没证明"我能收"。第三次 ACK 补上这一环。\\n\\n2. **防止旧 SYN 重复建立连接**——一个在网络里迷路很久的旧 SYN 若到达服务端，两次握手下服务端回个确认就直接建立连接并分配缓冲区，而客户端根本不认这个连接，服务端就会一直空等。三次握手中客户端收到旧连接的 SYN+ACK 会回复 RST，连接建立不起来。' },
        { role: 'user', content: '那 TIME_WAIT 为什么要等 2MSL？' },
        { role: 'assistant', content: '两个目的：\\n\\n1. **保证最后一个 ACK 可达**——如果第四次挥手的 ACK 丢了，被动关闭方会重传 FIN，主动方在 2MSL 内还能重发 ACK。\\n2. **让旧报文自然消亡**——等待两个报文最大生存时间，本连接的所有报文都从网络中消失，不会窜进复用同四元组的新连接。' },
      ];
      wsRenderAI();
      return 1;
    })()`, false);
    await snap('16-联网查询AI对话', 800);

    /* 17. 成绩报告（整页长图） */
    await cdp.eval(`wsClose(); go('exam')`, false);
    await sleep(700);
    await cdp.eval(`viewExamReport(state.exams[0].id)`, false);
    await sleep(1000);
    const m = await cdp.send('Page.getLayoutMetrics');
    const cs = m.cssContentSize || m.contentSize;
    const r = await cdp.send('Page.captureScreenshot', {
      format: 'png', fromSurface: true, captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: W, height: Math.min(Math.ceil(cs.height), 4200), scale: DPR },
    });
    fs.writeFileSync(path.join(OUT, '17-成绩报告.png'), Buffer.from(r.data, 'base64'));
    console.log('✓ 17-成绩报告.png', (fs.statSync(path.join(OUT, '17-成绩报告.png')).size / 1024).toFixed(0) + 'KB');

    /* 18. 组卷导出面板（滚动到该区域） */
    await cdp.eval(`go('exam')`, false);
    await sleep(700);
    await cdp.eval(`(() => { const cards = [...document.querySelectorAll('.card')]; const t = cards.find(c => c.textContent.includes('组卷导出')); if (t) t.scrollIntoView(); window.scrollBy(0, -10); return !!t; })()`, false);
    await snap('18-组卷导出', 600);

    console.log('补拍完成');
  } finally {
    cleanup();
    await sleep(400);
  }
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
