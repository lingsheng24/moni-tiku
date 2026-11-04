/* 按 v2.1.0 界面重拍帮助配图（两大板块导航 / 底部帮助·设置 / 知识库文档 / AI 助教）
 * 输出：教程/截图/*.png（1480×940 @2x）
 * 运行：node 教程/拍图-v210.js
 * 之后：node 教程/压缩配图.js → node 教程/生成帮助配图.js
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTML_URL = 'file:///' + encodeURI(ROOT + '/模拟题库-Web版.html').replace(/#/g, '%23');
const OUT = path.join(ROOT, '教程/截图');
const PROFILE = path.join(ROOT, '教程/.edge-profile-v210');
const PORT = 9341;
const W = 1480, H = 940, DPR = 2;

const sleep = ms => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.handlers = [];
    this.ready = new Promise((res, rej) => {
      this.ws.onopen = () => res();
      this.ws.onerror = () => rej(new Error('WebSocket 连接失败'));
    });
    this.ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      } else {
        this.handlers.forEach(h => h(m));
      }
    };
  }
  async send(method, params = {}) {
    await this.ready;
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  once(method, timeout = 30000) {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('等 ' + method + ' 超时')), timeout);
      const h = m => { if (m.method === method) { clearTimeout(t); this.handlers = this.handlers.filter(x => x !== h); res(m); } };
      this.handlers.push(h);
    });
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

async function waitPort(url, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch (e) { }
    await sleep(300);
  }
  throw new Error('等不到调试端口');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });

  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--disable-sync',
    '--disable-features=Translate,MediaRouter', '--force-device-scale-factor=' + DPR,
    '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + PORT,
    '--window-size=' + W + ',' + H, 'about:blank',
  ], { stdio: 'ignore' });

  let cdp;
  const cleanup = () => { try { cdp && cdp.close(); } catch (e) { } try { edge.kill(); } catch (e) { } };
  process.on('exit', cleanup);

  try {
    await waitPort('http://127.0.0.1:' + PORT + '/json/version');
    const list = await waitPort('http://127.0.0.1:' + PORT + '/json/list');
    const page = (Array.isArray(list) ? list : list.targets || []).find(t => t.type === 'page');
    if (!page) throw new Error('找不到 page target');
    cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

    const loaded = cdp.once('Page.loadEventFired', 30000);
    await cdp.send('Page.navigate', { url: HTML_URL });
    await loaded;
    await sleep(3200);

    const guard = await cdp.eval('typeof state !== "undefined" && typeof go === "function" && typeof KBDOCS !== "undefined"');
    if (!guard) throw new Error('页面未正常初始化');

    const seed = fs.readFileSync(path.join(ROOT, '教程/种子数据.js'), 'utf8');
    console.log('种子数据:', await cdp.eval(seed));
    await sleep(1000);

    /* 知识库 MD 文档（v1.52.0 起）：写 5 篇，让「知识库文档」页与图谱都有内容 */
    const kbdSeed = await cdp.eval(`(async()=>{
      const fm = (o, b) => kbdBuildFM(Object.assign({ tags: [], kp: [], created: Date.now() - 86400000 * 3, updated: Date.now() - 3600000 }, o), b);
      const docs = [
        ['TCP 三次握手笔记.md', ['网络', '传输层'], ['三次握手', 'TCP 可靠传输'],
          '# 三次握手\\n\\n客户端 SYN（seq=x）→ 服务端 SYN+ACK（seq=y, ack=x+1）→ 客户端 ACK（ack=y+1）。\\n\\n**为什么不能两次**：旧 SYN 迟到会让服务端空等；第三次 ACK 才能确认客户端能收。\\n\\n参考 [[TCP 可靠传输机制]]，与 [[擁塞控制]] 一起看。\\n\\n#网络 #高频考点'],
        ['拥塞控制.md', ['网络'], ['擁塞控制', 'TCP 可靠传输'],
          '# 拥塞控制\\n\\n四个阶段：慢开始 → 拥塞避免 → 快重传 → 快恢复。\\n\\n慢开始每 RTT cwnd 翻倍；到 ssthresh 后线性增长。收到 3 个重复 ACK 走快重传。\\n\\n配合 [[TCP 三次握手笔记]] 理解连接建立过程。'],
        ['索引失效场景.md', ['数据库'], ['索引', 'B+ 树'],
          '# 索引失效的常见场景\\n\\n1. 对索引列用函数或表达式：WHERE YEAR(created)=2024\\n2. 以 % 开头的 LIKE\\n3. 隐式类型转换：字符串列传数字\\n4. 联合索引不满足最左前缀\\n5. OR 条件中存在非索引列\\n\\nB+ 树把查找从 O(n) 降到 O(log n)，但上面几种会让优化器放弃索引。\\n\\n#数据库 #索引'],
        ['事务隔离级别.md', ['数据库'], ['事务', 'ACID'],
          '# 事务隔离级别\\n\\n读未提交 → 读已提交 → 可重复读 → 串行化。级别越高并发越低。\\n\\nMySQL 默认可重复读，用 MVCC + 间隙锁解决幻读。\\n\\n关联 [[索引失效场景]]（锁与索引的关系）。'],
        ['需求分析清单.md', ['软件工程'], ['需求分析', '用例图'],
          '# 需求分析清单\\n\\n- 用例图：参与者与用例的关联，不表达顺序\\n- 数据流图：数据在系统内的流动\\n- 数据字典：每个数据项的定义\\n\\n输出《需求规格说明书》。\\n\\n#软件工程 #模板'],
      ];
      for (const [name, tags, kp, body] of docs) await KBDOCS.write(name, fm({ tags, kp }, body));
      await kbdBuildIndex();
      return { docs: kbdIndex.docs.size };
    })()`);
    console.log('知识库文档:', kbdSeed);

    /* 关掉可能遮挡的浮层 */
    await cdp.eval(`(() => { const t = document.getElementById('toast'); if (t) t.textContent = ''; const m = document.getElementById('modal'); if (m) { m.classList.remove('on'); m.innerHTML = ''; } return 1; })()`);

    const snap = async (name, opts = {}) => {
      const { wait = 900, full = false } = opts;
      await sleep(wait);
      let params = { format: 'png', fromSurface: true, captureBeyondViewport: false };
      if (full) {
        const m = await cdp.send('Page.getLayoutMetrics');
        const cs = m.cssContentSize || m.contentSize;
        params = {
          format: 'png', fromSurface: true, captureBeyondViewport: true,
          clip: { x: 0, y: 0, width: W, height: Math.min(Math.ceil(cs.height), 4200), scale: DPR },
        };
      }
      const r = await cdp.send('Page.captureScreenshot', params);
      const file = path.join(OUT, name + '.png');
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      console.log('✓', name + '.png', (fs.statSync(file).size / 1024).toFixed(0) + 'KB');
    };
    const run = js => cdp.eval(js);

    /* ---------- 逐页拍照 ---------- */
    await run(`go('dash')`);
    await snap('01-首页总览', { wait: 1500 });

    await run(`go('docs')`);
    await snap('02-出题资料');

    await run(`sessionStorage.setItem('gen_doc', String(state.docs[0].id)); go('gen')`);
    await snap('03-AI生成题目', { wait: 1200 });

    await run(`go('bank')`);
    await snap('04-题库管理', { wait: 1100 });

    await run(`go('kp')`);
    await snap('05-知识点图谱', { wait: 3400 });

    await run(`go('kb')`);
    await snap('06-笔记聚合', { wait: 1200 });

    await run(`go('kbdocs')`);
    await snap('19-知识库文档', { wait: 1300 });

    /* 列表视图也来一张（帮助里说明两种视图差别） */
    await run(`kbdSetView('list')`);
    await snap('20-知识库文档-列表视图', { wait: 1000 });
    await run(`kbdSetView('card')`);

    await run(`go('ask')`);
    await snap('21-AI助教', { wait: 1400 });

    await run(`go('practice')`);
    await snap('07-答题练习设置');

    await run(`$('#pBtn').click()`);
    await snap('08-答题界面', { wait: 1100 });

    await run(`go('exam')`);
    await snap('09-模拟考试组卷');

    await run(`go('mist')`);
    await snap('10-错题本');

    await run(`go('review')`);
    await snap('11-间隔复习', { wait: 1300 });

    await run(`go('stats')`);
    await snap('12-统计分析', { wait: 1500 });

    await run(`go('set')`);
    await snap('13-设置', { wait: 1400 });

    /* 15. 联网查询：注入演示搜索结果（网页版无真实抓取） */
    await run(`go('kb')`);
    await sleep(500);
    await run(`(() => {
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
    })()`);
    await snap('15-联网查询搜索', { wait: 800 });

    /* 16. AI 连续追问 */
    await run(`wsClose()`);
    await sleep(400);
    await run(`(() => {
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
    })()`);
    await snap('16-联网查询AI对话', { wait: 900 });

    /* 17. 成绩报告（整页长图） */
    await run(`wsClose(); go('exam')`);
    await sleep(800);
    await run(`viewExamReport(state.exams[0].id)`);
    await snap('17-成绩报告', { wait: 1100, full: true });

    /* 18. 组卷导出面板 */
    await run(`go('exam')`);
    await sleep(800);
    await run(`(() => { const cards = [...document.querySelectorAll('.card')]; const t = cards.find(c => c.textContent.includes('组卷导出')); if (t) t.scrollIntoView({ block: 'center' }); return !!t; })()`);
    await snap('18-组卷导出', { wait: 700 });

    console.log('\n全部拍完，接下来：node 教程/压缩配图.js && node 教程/生成帮助配图.js');
  } finally {
    cleanup();
    await sleep(500);
  }
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
