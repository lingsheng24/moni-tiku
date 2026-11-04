/* 端到端验证：v2.3.0 随身刷题（手机布局 / 抽屉 / 底部标签栏 / PWA）+ 学习周报
 * 覆盖：390×844 移动视口下顶栏与底栏 → 标签切换 → 抽屉开合 → 答题页选项热区
 *       → 首页周报卡 → 周报弹窗（KPI / 每日柱 / 收获 / 待补）→ 上一周切换 → 导出 PNG
 *       → manifest 生成与图标 → 宽屏下手机布局自动隐藏
 * 运行：node desktop/验证-全端.js      输出：%TEMP%/mtk-mobile/*.png
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTML_URL = 'file:///' + encodeURI(ROOT + '/模拟题库-Web版.html').replace(/#/g, '%23');
const PORT = 9427;
const PROFILE = path.join(ROOT, '教程/.edge-profile-mobile');
const OUT = path.join(os.tmpdir(), 'mtk-mobile');
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
    '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + PORT, '--window-size=420,900', 'about:blank',
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
    // 手机视口：iPhone 12/13 逻辑尺寸
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Page.navigate', { url: HTML_URL });
    await sleep(3500);

    const shot = async (name) => {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    };

    /* ---------- 1) 造数据：题目 + 本周练习 + 上周练习 + 错题 ---------- */
    const seed = await cdp.eval(`(async()=>{
      const DAY = 86400000, now = Date.now();
      const mon = weekStartOf(now);
      const QS = [
        { type:'single_choice', content:'TCP 三次握手的第二个报文是？', options:['A. SYN','B. SYN+ACK','C. ACK','D. FIN'], answer:'B', explanation:'服务端回 SYN+ACK', knowledge_point:'三次握手', difficulty:'easy', imp:4 },
        { type:'true_false', content:'三次握手可以简化为两次。', options:null, answer:'错误', explanation:'两次无法确认客户端收包能力', knowledge_point:'三次握手', difficulty:'medium', imp:3 },
        { type:'single_choice', content:'慢启动阶段拥塞窗口如何增长？', options:['A. 线性','B. 指数'], answer:'B', explanation:'每经过一个 RTT 翻倍', knowledge_point:'拥塞控制', difficulty:'medium', imp:4 },
        { type:'fill_blank', content:'B+ 树的叶子节点用 ____ 相连。', options:null, answer:'链表', explanation:'便于范围扫描', knowledge_point:'B+ 树', difficulty:'easy', imp:2 },
      ];
      for (const q of QS) await DB.add('questions', q);
      await refreshData();
      const id = state.questions.map(q=>q.id);
      // 上周：三次握手 0/2（好让本周有「进步」可看）
      for (let i=0;i<2;i++) await DB.add('practice', { question_id:id[0], is_correct:0, answered_at: mon - 7*DAY + i*3600000 });
      // 本周：三次握手 3 对；拥塞控制 2 错 1 对；B+ 树 1 对
      await DB.add('practice', { question_id:id[0], is_correct:1, answered_at: mon + 3600000*9 });
      await DB.add('practice', { question_id:id[1], is_correct:1, answered_at: mon + DAY + 3600000*10 });
      await DB.add('practice', { question_id:id[1], is_correct:1, answered_at: mon + 2*DAY + 3600000*10 });
      await DB.add('practice', { question_id:id[2], is_correct:0, answered_at: mon + DAY + 3600000*11 });
      await DB.add('practice', { question_id:id[2], is_correct:0, answered_at: mon + 2*DAY + 3600000*11 });
      await DB.add('practice', { question_id:id[2], is_correct:1, answered_at: mon + 2*DAY + 3600000*12 });
      await DB.add('practice', { question_id:id[3], is_correct:1, answered_at: mon + 2*DAY + 3600000*13 });
      await DB.add('mistakes', { question_id:id[2], user_answer:'A', correct_answer:'B', mistake_reason:'', created_at: mon + DAY + 3600000*11, question_content:'慢启动阶段拥塞窗口如何增长？', type:'single_choice', difficulty:'medium' });
      await refreshData();
      go('dash');
      await new Promise(r=>setTimeout(r,400));
      return { q: state.questions.length, p: state.practice.length };
    })()`);
    check('造数据：4 道题 + 9 条练习记录', seed.q === 4 && seed.p === 9, `q=${seed.q} p=${seed.p}`);

    /* ---------- 2) 手机布局：顶栏 / 底栏 / 主区全宽 ---------- */
    const s1 = await cdp.eval(`(()=>{
      const cs = el => el ? getComputedStyle(el) : null;
      const main = document.querySelector('.main');
      const side = document.querySelector('.sidebar');
      return {
        mobile: mMobile(),
        top: cs(document.getElementById('mTopbar')).display,
        bar: cs(document.getElementById('mTabbar')).display,
        tabs: [...document.querySelectorAll('#mTabbar .m-tab')].map(b=>b.dataset.t),
        mainLeft: getComputedStyle(main).marginLeft,
        mainPadTop: getComputedStyle(main).paddingTop,
        sideLeft: Math.round(side.getBoundingClientRect().left),
        barH: Math.round(document.getElementById('mTabbar').getBoundingClientRect().height),
        scrollW: document.documentElement.scrollWidth,
        winW: window.innerWidth,
      };
    })()`);
    check('390 宽下判定为手机端', s1.mobile === true);
    check('顶栏显示', s1.top === 'flex', s1.top);
    check('底栏显示、6 格', s1.bar === 'grid' && s1.tabs.join(',') === 'dash,practice,mist,review,stats,more', s1.tabs.join(','));
    check('主区左边距 0（侧栏不再占位）', s1.mainLeft === '0px', s1.mainLeft);
    check('主区顶部让出 60px 给顶栏', s1.mainPadTop === '60px', s1.mainPadTop);
    check('侧栏默认在屏幕外（抽屉收起）', s1.sideLeft <= -272, 'left=' + s1.sideLeft);
    check('底栏高度 56px', s1.barH === 56, s1.barH + 'px');
    check('无横向溢出（内容不超出视口）', s1.scrollW <= s1.winW + 1, `scrollW=${s1.scrollW} winW=${s1.winW}`);
    await shot('1-首页-手机');

    /* ---------- 3) 底部标签切换 ---------- */
    const s2 = await cdp.eval(`(async()=>{
      document.querySelector('#mTabbar .m-tab[data-t="practice"]').click();
      await new Promise(r=>setTimeout(r,500));
      const t = document.getElementById('mTitle').textContent;
      const active = document.querySelector('#mTabbar .m-tab.active')?.dataset.t;
      return { cur: curView, title: t, active };
    })()`);
    check('点「练习」→ 进入答题练习页', s2.cur === 'practice', s2.cur);
    check('顶栏标题跟着变', s2.title === '答题练习', s2.title);
    check('底栏高亮跟着变', s2.active === 'practice', s2.active);
    await shot('2-答题练习-手机');

    /* ---------- 4) 开始练习 → 选项热区 ≥44px ---------- */
    const s3 = await cdp.eval(`(async()=>{
      document.querySelector('#pTypes .tag[data-k="single_choice"]').click();   // 只抽选择题，保证有选项可量
      document.querySelector('#pCount').value = '5';
      document.getElementById('pBtn').click();
      await new Promise(r=>setTimeout(r,600));
      const opt = document.querySelector('#answerArea .q-opt');
      const btn = document.getElementById('submitBtn');
      const r = opt ? opt.getBoundingClientRect() : null;
      return { hasQuiz: !!quiz, h: r ? Math.round(r.height) : 0, btnH: btn ? Math.round(btn.getBoundingClientRect().height) : 0,
               fontSize: opt ? getComputedStyle(opt).fontSize : '' };
    })()`);
    check('可以开始练习', s3.hasQuiz === true);
    check('选项行高 ≥44px（触控友好）', s3.h >= 44, s3.h + 'px');
    check('选项字号放大到 15.5px', s3.fontSize === '15.5px', s3.fontSize);
    check('提交按钮 ≥40px 高', s3.btnH >= 40, s3.btnH + 'px');
    await shot('3-答题-手机');

    /* ---------- 5) 抽屉开合 ---------- */
    const s4 = await cdp.eval(`(async()=>{
      document.querySelector('#mTabbar .m-tab[data-t="more"]').click();
      await new Promise(r=>setTimeout(r,400));
      const open = document.body.classList.contains('m-drawer');
      const left = Math.round(document.querySelector('.sidebar').getBoundingClientRect().left);
      const scrim = getComputedStyle(document.getElementById('mScrim')).opacity;
      return { open, left, scrim };
    })()`);
    check('点「更多」打开抽屉', s4.open === true);
    check('抽屉滑到 left=0', s4.left === 0, 'left=' + s4.left);
    check('遮罩可见', +s4.scrim > 0.9, s4.scrim);
    await shot('4-抽屉-手机');

    const s5 = await cdp.eval(`(async()=>{
      document.getElementById('mScrim').click();
      await new Promise(r=>setTimeout(r,400));
      return { open: document.body.classList.contains('m-drawer'), left: Math.round(document.querySelector('.sidebar').getBoundingClientRect().left) };
    })()`);
    check('点遮罩收回抽屉', s5.open === false && s5.left <= -272, JSON.stringify(s5));

    const s6 = await cdp.eval(`(async()=>{
      mDrawer(true); await new Promise(r=>setTimeout(r,250));
      document.querySelector('.sidebar .nav-item[data-v="stats"]').click();
      await new Promise(r=>setTimeout(r,450));
      return { cur: curView, open: document.body.classList.contains('m-drawer') };
    })()`);
    check('抽屉里点菜单 → 跳转并自动收起', s6.cur === 'stats' && s6.open === false, JSON.stringify(s6));

    /* ---------- 6) 首页周报卡 ---------- */
    const s7 = await cdp.eval(`(async()=>{
      go('dash'); await new Promise(r=>setTimeout(r,450));
      const card = document.querySelector('.wk-card');
      const nums = card ? [...card.querySelectorAll('.wk-mini-num b')].map(e=>e.textContent.trim()) : [];
      return {
        has: !!card,
        nums,
        bars: card ? card.querySelectorAll('.wk-spark-bar').length : 0,
        tone: card ? card.querySelector('.wk-tone').textContent.trim() : '',
      };
    })()`);
    check('首页有「本周学习」卡', s7.has === true);
    check('四个数字：题量 / 正确率 / 活跃天数 / 连续天数', s7.nums.length === 4, s7.nums.join(' | '));
    check('本周题量 = 7（上周 2 条不计）', s7.nums[0] === '7', s7.nums[0]);
    check('正确率 = 71%（5 对 7 题）', s7.nums[1] === '71%', s7.nums[1]);
    check('7 根迷你柱', s7.bars === 7, String(s7.bars));
    check('评语非空', s7.tone.length > 4, s7.tone);
    await shot('5-首页周报卡-手机');

    /* ---------- 7) 周报弹窗 ---------- */
    const s8 = await cdp.eval(`(async()=>{
      openWeeklyReport();
      await new Promise(r=>setTimeout(r,400));
      const m = document.querySelector('.modal');
      if (!m) return { open:false };
      return {
        open: true,
        kpis: [...m.querySelectorAll('.wk-kpis b')].map(e=>e.textContent.trim()),
        cols: m.querySelectorAll('.wk-col').length,
        gains: [...m.querySelectorAll('.wk-block')][0].textContent.replace(/\\s+/g,' ').trim(),
        weak: [...m.querySelectorAll('.wk-block')][1].textContent.replace(/\\s+/g,' ').trim(),
        label: m.querySelector('.pill').textContent.trim(),
      };
    })()`);
    check('周报弹窗打开', s8.open === true);
    check('KPI 四格齐全', s8.kpis && s8.kpis.length === 4, (s8.kpis || []).join(' | '));
    check('每日 7 根柱', s8.cols === 7, String(s8.cols));
    check('收获榜出现「三次握手」', /三次握手/.test(s8.gains || ''), (s8.gains || '').slice(0, 80));
    check('待补榜出现「拥塞控制」', /拥塞控制/.test(s8.weak || ''), (s8.weak || '').slice(0, 80));
    await shot('6-周报弹窗-手机');

    /* ---------- 8) 上一周切换 ---------- */
    const s9 = await cdp.eval(`(async()=>{
      const btns = [...document.querySelectorAll('.wk-modal .wk-head button')];
      const prev = btns.find(b=>/上一周/.test(b.textContent));
      prev.click();
      await new Promise(r=>setTimeout(r,350));
      const m = document.querySelector('.modal');
      const kpi = [...m.querySelectorAll('.wk-kpis b')].map(e=>e.textContent.trim());
      const nextDisabled = [...m.querySelectorAll('.wk-head button')].find(b=>/下一周/.test(b.textContent)).disabled;
      return { kpi, nextDisabled, label: m.querySelector('.pill').textContent.trim() };
    })()`);
    check('切到上一周：题量变 2 道', s9.kpi[0] === '2', s9.kpi.join(' | '));
    check('有下一周可点（不在未来）', s9.nextDisabled === false);
    await shot('7-周报上一周-手机');

    /* ---------- 9) 导出 PNG（拦下载，只校验 canvas 产出） ---------- */
    const s10 = await cdp.eval(`(async()=>{
      let captured = null;
      const orig = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function(){ if (this.download) captured = { name: this.download, len: this.href.length }; };
      weekExportPng();
      await new Promise(r=>setTimeout(r,300));
      HTMLAnchorElement.prototype.click = orig;
      return captured;
    })()`);
    check('导出周报图片：文件名带日期', !!s10 && /^学习周报-\d{4}-\d{2}-\d{2}\.png$/.test(s10.name), s10 && s10.name);
    check('图片数据已生成（dataURL 长度 > 20KB）', !!s10 && s10.len > 20000, s10 && String(s10.len));

    /* ---------- 10) PWA manifest ---------- */
    const s11 = await cdp.eval(`(async()=>{
      const link = document.querySelector('link[rel="manifest"]');
      if (!link) return { ok:false };
      const txt = await (await fetch(link.href)).text();
      const mf = JSON.parse(txt);
      return {
        ok: true,
        blob: link.href.startsWith('blob:'),
        name: mf.name, display: mf.display,
        icons: mf.icons.map(i=>i.sizes + '/' + i.purpose),
        theme: !!document.querySelector('meta[name="theme-color"]'),
        apple: !!document.querySelector('meta[name="apple-mobile-web-app-capable"]'),
        touch: !!document.querySelector('link[rel="apple-touch-icon"]'),
      };
    })()`);
    check('页面挂了 manifest', s11.ok === true);
    check('manifest 走 blob（单文件无需外置 json）', s11.blob === true);
    check('standalone 全屏模式', s11.display === 'standalone', s11.display);
    check('图标含 192 / 512 / maskable', s11.icons && s11.icons.some(x=>/192/.test(x)) && s11.icons.some(x=>/512/.test(x)) && s11.icons.some(x=>/maskable/.test(x)), (s11.icons || []).join(' '));
    check('theme-color 与 iOS 主屏 meta 齐全', s11.theme && s11.apple && s11.touch);

    /* ---------- 11) 宽屏：手机布局自动隐藏 ---------- */
    await cdp.eval(`closeModal()`);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    await sleep(500);
    const s12 = await cdp.eval(`(()=>{
      const cs = el => getComputedStyle(el).display;
      return { mobile: mMobile(), top: cs(document.getElementById('mTopbar')), bar: cs(document.getElementById('mTabbar')),
               mainLeft: getComputedStyle(document.querySelector('.main')).marginLeft,
               drawer: document.body.classList.contains('m-drawer') };
    })()`);
    check('宽屏下手机顶栏 / 底栏隐藏', s12.mobile === false && s12.top === 'none' && s12.bar === 'none', JSON.stringify(s12));
    check('宽屏主区恢复侧栏左边距', s12.mainLeft !== '0px', s12.mainLeft);
    check('宽屏不留抽屉状态', s12.drawer === false);
    const errs = cdp.logs.filter(l => !/favicon/i.test(l));
    check('运行期无 JS 异常', errs.length === 0, errs.slice(0, 3).join(' | '));
  } catch (e) {
    console.error('验证异常：', e && e.message || e);
    fails++;
  } finally {
    cleanup();
  }
  console.log(fails ? `\n❌ ${fails} 项未通过` : '\n✅ 全部通过');
  process.exit(fails ? 1 : 0);
})();
