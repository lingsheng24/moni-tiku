/* ---------- 联网查询（v1.36.0） ----------
 * 桌面版由主进程抓取 Bing 结果页并解析，渲染层画成卡片；
 * 「AI 解答」把搜索结果摘要作为参考资料交给模型综合讲解，避免凭空编造。
 * 两种内容都能一键整理成笔记存进知识库（可选关联知识点）。 */
const WS_ENGINES = { bingcn: 'Bing 国内', bing: 'Bing 国际', sogou: '搜狗', so360: '360 搜索', aggregate: '智能聚合' };
const WS_HIST_MAX = 30;
const WS_FAV_MAX = 100;   // v1.38.0：收藏上限（超出自动淘汰最旧的）
let wsState = null;

function wsEngineName(id) { return WS_ENGINES[id] || WS_ENGINES.bingcn; }
function wsSearchUrl(q, engine) {
  const e = encodeURIComponent(q);
  if (engine === 'sogou') return 'https://www.sogou.com/web?query=' + e;
  if (engine === 'so360') return 'https://www.so.com/s?q=' + e;
  if (engine === 'bing') return 'https://www.bing.com/search?q=' + e + '&setlang=zh-CN';
  return 'https://cn.bing.com/search?q=' + e + '&setlang=zh-CN&ensearch=0';
}
/* ================= 划词工具条（v1.37.0） =================
 * 在正文里选中字 / 词 / 句，浮出「🔍 查询」「📝 笔记」两个按钮：
 *  · 查询：把选中内容当关键词打开联网查询面板；看完直接关掉即可（不点保存就不留痕），
 *          想保留就点面板里的「💾 存进知识库」
 *  · 笔记：把选中内容填进「新建知识库笔记」，可补充要点后保存，保存即进知识库
 */
let selBar = null;       // 浮出的工具条 DOM
let selBarText = '';     // 缓存的选中文字（点按钮的一瞬间选区可能已被浏览器清掉）
let selBarKp = '';       // 推测出的关联知识点
let selBarTimer = 0;     // 延迟句柄

/** 选区是否落在输入框 / 可编辑区域里（那种情况用户在打字，不该弹条） */
function selInEditable(node) {
  let el = node && (node.nodeType === 1 ? node : node.parentElement);
  while (el && el !== document.body) {
    const tag = (el.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    el = el.parentElement;
  }
  return false;
}

/** 从选中文字推测关联知识点：优先完全相等，其次「包含」里取最长的那个 */
function selGuessKP(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  let names = [];
  try { names = [...kbGraphNames(true)]; } catch (e) { names = []; }
  if (names.includes(t)) return t;
  let best = '';
  for (const n of names) {
    if (n && n.length >= 2 && t.includes(n) && n.length > best.length) best = n;
  }
  return best;
}

function selBarHide() {
  if (selBar && selBar.parentNode) selBar.parentNode.removeChild(selBar);
  selBar = null;
}

function selClear() {
  try { const s = window.getSelection(); if (s && s.removeAllRanges) s.removeAllRanges(); } catch (e) { }
}

/** 在选区上方浮出工具条；上方放不下就翻到下方 */
function selBarShow(text, rect) {
  selBarHide();
  selBarText = text;
  selBarKp = selGuessKP(text);
  const bar = document.createElement('div');
  bar.className = 'selbar';
  bar.id = 'selBar';
  bar.innerHTML =
    '<button class="selbar-btn" data-act="search" title="联网查询这段内容">🔍 查询</button>' +
    '<span class="selbar-sep"></span>' +
    '<button class="selbar-btn" data-act="note" title="存成知识库笔记">📝 笔记</button>';
  document.body.appendChild(bar);
  selBar = bar;
  /* 按下时阻止默认行为：否则浏览器会先清掉选区，后面就取不到选中内容了 */
  bar.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
  bar.addEventListener('click', e => {
    const btn = e.target && e.target.closest ? e.target.closest('.selbar-btn') : null;
    if (!btn) return;
    const act = btn.dataset.act;
    const t = selBarText, kp = selBarKp;
    selBarHide(); selClear();
    if (act === 'search') wsOpen(t, kp);
    else selMakeNote(t, kp);
  });
  const w = bar.offsetWidth || 150, h = bar.offsetHeight || 34, gap = 9;
  const vw = window.innerWidth || document.documentElement.clientWidth || 1200;
  /* v1.37.1：桌面版标题栏 36px，上翻时不得钻进标题栏底下 */
  const topMin = document.body.classList.contains('is-desktop') ? 44 : 8;
  let left = rect.left + rect.width / 2 - w / 2;
  left = Math.max(8, Math.min(left, vw - w - 8));
  let top = rect.top - h - gap, below = false;
  if (top < topMin) { top = rect.bottom + gap; below = true; }
  bar.style.left = Math.round(left) + 'px';
  bar.style.top = Math.round(top) + 'px';
  if (below) bar.classList.add('below');
}

/** mouseup / keyup 后统一走这里：读选区 → 过滤 → 显示或隐藏 */
function selBarSync() {
  clearTimeout(selBarTimer);
  selBarTimer = setTimeout(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) { selBarHide(); return; }
    const anchor = sel.anchorNode;
    const host = anchor && (anchor.nodeType === 1 ? anchor : anchor.parentElement);
    /* 输入框里是在编辑；标题栏 / 侧栏里选导航文字没意义 —— 都不弹 */
    if (selInEditable(anchor) || (host && host.closest && host.closest('#titlebar, .sidebar'))) { selBarHide(); return; }
    const text = String(sel.toString() || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 300) { selBarHide(); return; }
    let rect = null;
    try { rect = sel.getRangeAt(0).getBoundingClientRect(); } catch (e) { rect = null; }
    if (!rect || (!rect.width && !rect.height)) { selBarHide(); return; }
    selBarShow(text, rect);
  }, 20);
}

/** 把选中文字填进「新建知识库笔记」（保存后即进知识库） */
function selMakeNote(text, kp) {
  kbEditing = null;
  kbOpenEditor({ kind: 'free', kp: kp || '', text: String(text || ''), isNew: true });
  setTimeout(() => {
    const ta = document.getElementById('kbEText');
    if (!ta) return;
    try { ta.focus(); const n = ta.value.length; ta.setSelectionRange(n, n); } catch (e) { }
  }, 80);
}

/** 绑定全局事件（启动时调一次即可） */
function initSelBar() {
  document.addEventListener('mouseup', e => {
    if (selBar && selBar.contains(e.target)) return;
    selBarSync();
  });
  document.addEventListener('keyup', e => {
    /* Shift + 方向键、Ctrl+A 这类键盘选择也要支持 */
    if (e.shiftKey || e.key === 'Shift' || (e.ctrlKey && (e.key === 'a' || e.key === 'A'))) selBarSync();
  });
  document.addEventListener('touchend', () => selBarSync(), { passive: true });
  document.addEventListener('mousedown', e => {
    if (selBar && !selBar.contains(e.target)) selBarHide();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') selBarHide(); });
  window.addEventListener('scroll', () => selBarHide(), true);   // 捕获任意滚动容器
  window.addEventListener('resize', () => selBarHide());
  window.addEventListener('blur', () => selBarHide());
}

function wsNowText() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function wsOpen(q = '', kp = '') {
  const engine = WS_ENGINES[state.settings.searchEngine] ? state.settings.searchEngine : 'bingcn';
  wsState = { q: String(q || '').trim(), kp: String(kp || '').trim(), engine, results: [], ai: '', aiBusy: false,
    aiMsgs: [], loading: false, err: '', aiErr: '', searchUrl: '', at: 0,
    sugs: [], sugOpen: false, sugIdx: -1, sugTimer: 0, sugLastQ: '' };
  const el = document.createElement('div');
  el.className = 'ws-mask';
  el.id = 'wsMask';
  const engOpts = Object.keys(WS_ENGINES).map(k =>
    `<option value="${k}"${k === engine ? ' selected' : ''}>${WS_ENGINES[k]}</option>`).join('');
  el.innerHTML = `
  <div class="ws-panel" role="dialog" aria-label="联网查询">
    <div class="ws-head">
      <span class="ws-title">🔍 联网查询</span>
      <input id="wsQ" placeholder="输入不懂的知识点 / 问题，回车搜索…" value="${esc(wsState.q)}" autocomplete="off">
      <div id="wsSug" class="ws-sug"></div>
      <select id="wsEngine" title="搜索引擎（被拦截时会自动换其它引擎）">${engOpts}</select>
      <button class="primary" onclick="wsRun()">搜索</button>
      <button class="ghost" onclick="wsAskAI()" title="让 AI 结合网页摘要讲解">🤖 AI 解答</button>
      <span style="flex:1"></span>
      <button class="primary" onclick="wsSaveNote()">💾 存进知识库</button>
      <button class="ghost" onclick="wsClose()" title="关闭（Esc）">✕</button>
    </div>
    <div class="ws-body">
      <div class="ws-col">
        <div class="ws-col-hd">🌐 网页结果 <span id="wsResCnt" style="color:var(--muted);font-weight:400"></span></div>
        <div class="ws-col-bd" id="wsResBox"></div>
      </div>
      <div class="ws-col">
        <div class="ws-col-hd">🤖 AI 解答 <span id="wsAiHint" style="color:var(--muted);font-weight:400"></span>
          <span style="flex:1"></span>
          <button class="sm ghost" onclick="wsFavAddAI()" title="把最近一轮问答收进收藏夹">⭐ 收藏回答</button>
          <button class="sm ghost" onclick="wsAskAI()" title="清空对话，重新生成第一答">↻ 重答</button>
        </div>
        <div class="ws-col-bd"><div class="ws-ai" id="wsAiBox"></div></div>
        <div class="ws-ai-in">
          <input id="wsAiIn" placeholder="就着结果继续追问…（Enter 发送，如「它和动量定理什么关系」）">
          <button class="primary" onclick="wsAskAIFromInput()">发送</button>
        </div>
      </div>
    </div>
    <div class="ws-foot">
      <span class="hint" id="wsHint">结果来自${wsEngineName(engine)}；AI 会参考这些网页摘要来讲解。想留下就点「💾 存进知识库」，不想保留直接关掉即可</span>
      <span style="flex:1"></span>
      <button class="ghost" onclick="wsFavToggle()" id="wsFavBtn">⭐ 收藏夹<span class="ws-fav-badge" id="wsFavCnt">${(state.wsFavs || []).length}</span></button>
      <button class="ghost" onclick="wsHistToggle()" id="wsHistBtn">🕘 最近查询</button>
      ${wsState.kp ? `<span class="pill amber">关联知识点：${esc(wsState.kp)}</span>` : ''}
    </div>
    <div id="wsHistWrap" class="hidden" style="padding:0 18px 12px"></div>
    <div id="wsFavWrap" class="hidden" style="padding:0 18px 12px;max-height:38vh;overflow:auto"></div>
  </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', e => { if (e.target === el) wsClose(); });
  const sel = document.getElementById('wsEngine');
  if (sel) {
    sel.value = engine;
    sel.onchange = () => { wsState.engine = sel.value; state.settings.searchEngine = sel.value; DB.kvSet('settings', state.settings); wsRenderResults(); };
  }
  const inp = document.getElementById('wsQ');
  if (inp) {
    inp.onkeydown = e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { wsSugNav(e.key === 'ArrowDown' ? 1 : -1); e.preventDefault(); return; }
      if (e.key === 'Enter') {
        /* 联想列表开着且选中了某条 → 搜那条；否则搜输入框原文 */
        if (wsState.sugOpen && wsState.sugIdx >= 0 && wsState.sugs[wsState.sugIdx]) {
          inp.value = wsState.sugs[wsState.sugIdx];
        }
        wsSugClose(); wsRun();
        return;
      }
      if (e.key === 'Escape') wsSugClose();
    };
    inp.oninput = () => wsSugInput();
    inp.onblur = () => setTimeout(() => wsSugClose(), 180);   // 延迟收起，别挡住点击联想词
  }
  const aiIn = document.getElementById('wsAiIn');
  if (aiIn) aiIn.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); wsAskAIFromInput(); } };
  document.addEventListener('keydown', wsEscHandler);
  wsRenderResults(); wsRenderAI(); wsRenderHist();
  if (wsState.q) wsRun(); else setTimeout(() => { try { inp && inp.focus(); } catch (e) { } }, 30);
}
function wsEscHandler(e) {
  if (e.key !== 'Escape' || !wsState) return;
  if (document.querySelector('.modal-mask')) return;   // 保存笔记弹窗开着时先关弹窗
  if (wsState.sugOpen) { wsSugClose(); return; }       // 联想列表开着时先只收起联想
  wsClose();
}
function wsClose() {
  document.removeEventListener('keydown', wsEscHandler);
  const el = document.getElementById('wsMask');
  if (el) el.remove();
  wsState = null;
}
/** 搜索：桌面版走主进程抓取；网页版/旧版本给出明确降级路径 */
async function wsRun() {
  if (!wsState) return;
  const q = (document.getElementById('wsQ')?.value || '').trim();
  if (!q) { toast('先输入要查询的内容', 'err'); return; }
  wsSugClose();
  wsState.q = q; wsState.results = []; wsState.err = ''; wsState.loading = true; wsState.degraded = [];
  wsState.ai = ''; wsState.aiErr = ''; wsState.aiMsgs = [];   // 新搜索 = 新对话
  wsRenderResults(); wsRenderAI();
  const canFetch = IS_DESKTOP && window.electronAPI && typeof window.electronAPI.webSearch === 'function';
  if (!canFetch) {
    const url = wsSearchUrl(q, wsState.engine);
    wsState.loading = false;
    if (IS_DESKTOP) {
      wsState.err = '当前安装的桌面版还不支持在软件内抓取网页（需 1.36.0 及以上）。可以先点下面的按钮用浏览器打开，或直接用「AI 解答」。';
    } else {
      wsState.err = '网页版受浏览器跨域限制，无法在页内抓取搜索结果。已为你打开 Bing 新标签页；页内仍可用「AI 解答」，答完一样能存进知识库。';
      try { window.open(url, '_blank', 'noopener'); } catch (e) { }
    }
    wsState.searchUrl = url;
    wsRenderResults();
    return;
  }
  try {
    const r = await window.electronAPI.webSearch({ q, engine: wsState.engine });
    if (!wsState) return;   // 等待期间面板被关掉（Esc / ✕），放弃后续渲染
    wsState.loading = false;
    wsState.results = Array.isArray(r && r.results) ? r.results : [];
    wsState.degraded = Array.isArray(r && r.degraded) ? r.degraded : [];   // v1.41.0：本次启动内失效的引擎
    wsState.searchUrl = (r && r.searchUrl) || wsSearchUrl(q, wsState.engine);
    wsState.at = Date.now();
    if (!r || !r.ok) wsState.err = (r && r.error) || '联网查询失败，可能是网络不通或搜索被拦截';
    if (wsState.results.length) {
      wsState.engine = r.engine || wsState.engine;
      wsPushHist(q);
    }
  } catch (e) {
    if (!wsState) return;
    wsState.loading = false;
    wsState.err = '联网查询失败：' + String(e && e.message || e);
  }
  if (!wsState) return;
  wsRenderResults();
  /* 有结果且配了 AI 接口 → 自动让 AI 结合摘要整理一份讲解，省一步操作 */
  if (wsState.results.length && state.settings.apiKey && state.settings.searchAutoAI !== 0) wsAskAI(true);
}
function wsPushHist(q) {
  const hist = (Array.isArray(state.kbSearchHist) ? state.kbSearchHist : []).filter(x => x && x.q !== q);
  hist.unshift({ q, at: Date.now(), engine: wsState && wsState.engine || 'bingcn', kp: wsState && wsState.kp || '' });
  state.kbSearchHist = hist.slice(0, WS_HIST_MAX);
  if (DB.bkvSet) DB.bkvSet('kbSearchHist', state.kbSearchHist);
  wsRenderHist();
}
function wsRenderHist() {
  const wrap = document.getElementById('wsHistWrap');
  if (!wrap) return;
  const list = Array.isArray(state.kbSearchHist) ? state.kbSearchHist.slice(0, 10) : [];
  wrap.innerHTML = `<div style="font-size:12px;color:var(--muted);margin:6px 0 8px">最近查询（点击重新查）</div>
    <div class="ws-hist">${list.length ? list.map(h => `<div class="ws-hist-i" data-q="${esc(h.q)}" onclick="wsReplay(this.dataset.q)">
        <span class="t">${esc(h.q)}</span><span class="d">${fmtDate(h.at)}</span></div>`).join('')
      : '<div class="ws-empty">还没有查询记录</div>'}</div>`;
}
function wsHistToggle() {
  const w = document.getElementById('wsHistWrap');
  const b = document.getElementById('wsHistBtn');
  if (!w) return;
  const hidden = w.classList.toggle('hidden');
  if (b) b.textContent = hidden ? '🕘 最近查询' : '🕘 收起记录';
}
function wsReplay(q) {
  if (!wsState) return;
  const inp = document.getElementById('wsQ');
  if (inp) inp.value = q;
  wsRun();
}
/* v1.41.0 引擎健康度提示：某引擎连续多次解析不到结果（多半是对方改版）时，主进程
 * 会自动跳过它并在结果里带上名单，这里以一行小字告知用户，避免误以为「结果变少了」。 */
function wsDegradedNotice() {
  if (!wsState || !Array.isArray(wsState.degraded) || !wsState.degraded.length) return '';
  return `<div style="font-size:12px;color:#b45309;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);border-radius:8px;padding:6px 10px;margin-bottom:8px">⚠️ ${esc(wsState.degraded.join('、'))}源暂时无法解析（可能改版或维护），已自动跳过；重启软件后会自动重试。</div>`;
}
function wsRenderResults() {
  const box = document.getElementById('wsResBox');
  if (!box || !wsState) return;
  const cnt = document.getElementById('wsResCnt');
  const hint = document.getElementById('wsHint');
  if (cnt) cnt.textContent = wsState.results.length ? `（${wsState.results.length} 条）` : '';
  if (hint) {
    hint.textContent = wsState.loading ? `正在通过${wsEngineName(wsState.engine)}查询「${wsState.q}」…`
      : state.settings.searchAutoAI === 0 && state.settings.apiKey ? '结果来自' + wsEngineName(wsState.engine) + '；需要讲解可点「🤖 AI 解答」'
        : `结果来自${wsEngineName(wsState.engine)}；AI 会参考这些网页摘要来讲解，答完可一键存进知识库`;
  }
  if (wsState.loading) {
    box.innerHTML = '<div class="ws-empty">⏳ 正在联网查询…</div>';
    return;
  }
  if (wsState.err) {
    box.innerHTML = `<div class="ws-empty">⚠️ ${esc(wsState.err)}</div>
      <div class="row" style="margin-top:6px">
        <button class="sm ghost" onclick="wsOpenBrowser()">在浏览器中打开搜索页</button>
      </div>`;
    return;
  }
  if (!wsState.results.length) {
    box.innerHTML = wsDegradedNotice() + `<div class="ws-empty">没有查到结果。换个更具体的关键词试试（例如加上公式名、科目或「例题」）。</div>`;
    return;
  }
  box.innerHTML = wsDegradedNotice() + wsState.results.map((r, i) => `
    <div class="ws-res">
      <div class="ws-res-t" data-u="${esc(r.url)}" onclick="wsOpenLink(this.dataset.u)" title="用浏览器打开原文">${i + 1}. ${esc(r.title)}</div>
      <div class="ws-res-u">${esc(r.site || '')}${r.site ? ' · ' : ''}${esc(String(r.url).slice(0, 90))}</div>
      <div class="ws-res-s">${esc(r.snippet || '（该页面没有摘要，点标题打开查看）')}</div>
      <div class="ws-res-ft">
        <button class="ghost" data-u="${esc(r.url)}" onclick="wsOpenLink(this.dataset.u)">打开原文</button>
        <button class="ghost" data-u="${esc(r.url)}" onclick="wsCopy(this.dataset.u)">复制链接</button>
        <button class="ghost" data-i="${i}" onclick="wsUseAsNote(+this.dataset.i)" title="把这条结果的标题、摘要和链接存成笔记">💾 存这条</button>
        <button class="ghost" data-i="${i}" onclick="wsFavAddResult(+this.dataset.i)" title="收进收藏夹，随时回看">⭐ 收藏</button>
      </div>
    </div>`).join('');
}
function wsRenderAI() {
  const box = document.getElementById('wsAiBox');
  if (!box || !wsState) return;
  const s = wsState;
  const hint = document.getElementById('wsAiHint');
  const turns = (s.aiMsgs || []).length;
  if (hint) hint.textContent = s.aiBusy ? '（生成中…）' : (turns ? `（${Math.ceil(turns / 2)} 轮对话）` : '');
  if (s.aiErr && !(s.aiMsgs || []).length) { box.innerHTML = `<div class="ws-empty">⚠️ ${esc(s.aiErr)}</div>`; return; }
  const msgs = s.aiMsgs || [];
  if (!msgs.length) {
    if (s.aiErr) { box.innerHTML = `<div class="ws-empty">⚠️ ${esc(s.aiErr)}</div>`; return; }
    box.innerHTML = `<div class="ws-empty">${state.settings.apiKey
      ? '点「🤖 AI 解答」让 AI 用通俗的话讲清这个概念（会参考左侧网页摘要，避免瞎编）。\n答完后在下方输入框可以继续追问，AI 记得前面聊过什么。'
      : '还没配置 AI 接口 —— 到「系统设置 → AI 接口」填 API Key 后就能在这里直接得到讲解。'}</div>`;
    return;
  }
  /* 逐条渲染气泡；流式中最后一条 assistant 还没内容时显示生成中 */
  box.innerHTML = msgs.map((m, i) => {
    if (m.role === 'user') {
      return `<div class="ws-msg user">${esc(m.content.length > 500 ? m.content.slice(0, 500) + '…' : m.content)}</div>`;
    }
    const generating = s.aiBusy && i === msgs.length - 1 && !m.content;
    const op = (!s.aiBusy && i === msgs.length - 1 && m.content)
      ? `<div class="ws-msg-op"><button class="ghost" onclick="wsSaveNote()">💾 本轮问答存进知识库</button></div>` : '';
    return `<div class="ws-msg ai">${generating ? '⏳ AI 正在结合搜索结果整理讲解…' : esc(m.content)}${op}</div>`;
  }).join('') + (s.aiErr ? `<div class="ws-empty">⚠️ ${esc(s.aiErr)}</div>` : '');
  box.scrollTop = box.scrollHeight;   // 追问后自动滚到底
}
/** AI 问答（v1.38.0 多轮对话）：第一问带网页摘要作参考，之后可连续追问，历史一起发给模型 */
function wsAiMessages() {
  const s = wsState;
  const system = '你是一位严谨、讲人话的中文学习助教。讲解知识点时：先用一句话给结论或定义，再分点讲清要点、成立条件、易错点，必要时给一个最小例子或记忆方法。' +
    '如果给了「网页摘要参考」，以它为主要依据；摘要不足以支撑时明确写「以下为通用知识」。' +
    '不要编造文献、页码、链接或数据。单次回答控制在 400 字以内，可用短标题和序号，不要用 Markdown 星号强调。';
  const msgs = [{ role: 'system', content: system }];
  const hist = (s.aiMsgs || []).filter(m => m.role === 'user' || (m.role === 'assistant' && m.content));
  return msgs.concat(hist.map(m => ({ role: m.role, content: m.content })));
}
async function wsAskAI(text, auto = false) {
  if (!wsState || wsState.aiBusy) return;
  const s = wsState;
  /* 「↻ 重答」：没传 text 且已有对话 → 清空重新生成第一答 */
  if (!String(text || '').trim() && (s.aiMsgs || []).length) {
    s.aiMsgs = []; s.ai = ''; s.aiErr = '';
  }
  const ask = String(text || '').trim() || s.q;
  if (!ask) { toast('先输入要查询的内容', 'err'); return; }
  if (!state.settings.apiKey) {
    s.aiErr = '还没配置 AI 接口（系统设置 → AI 接口）。先看左侧网页结果，或点「在浏览器中打开搜索页」。';
    wsRenderAI();
    return;
  }
  s.aiBusy = true; s.aiErr = '';
  /* 首问固定以面板查询词为主体（「AI 解答」按钮/自动解答都走这里）；追问直接入历史 */
  const isFirst = !(s.aiMsgs || []).length;
  const ctx = s.results.slice(0, 5).map((r, i) =>
    `${i + 1}. ${r.title}（${r.site || ''}）\n${(r.snippet || '').slice(0, 300)}`).join('\n');
  const content = isFirst
    ? `请讲解：${s.q}` + (ctx ? `\n\n【网页摘要参考】\n${ctx}` : '')
    : ask;
  if (!s.aiMsgs) s.aiMsgs = [];
  s.aiMsgs.push({ role: 'user', content });
  const userMsg = s.aiMsgs[s.aiMsgs.length - 1];
  const reply = { role: 'assistant', content: '' };
  s.aiMsgs.push(reply);
  wsRenderAI();
  const input = document.getElementById('wsAiIn');
  if (input) input.value = '';
  let acc = '';
  try {
    /* wsAiMessages 已过滤流式空占位，直接发全量历史 */
    const messages = wsAiMessages();
    const full = await chat(messages, false, d => {
      acc += d;
      reply.content = acc;
      if (wsState) { s.ai = acc; wsRenderAI(); }
    });
    reply.content = (full || acc || '').trim();
    if (wsState) s.ai = reply.content;
  } catch (e) {
    /* 失败：整个未完成回合回滚（问与空答都移除），重试时仍是干净的首问 */
    if (wsState) {
      s.aiMsgs = s.aiMsgs.filter(m => m !== reply && m !== userMsg);
      s.aiErr = 'AI 解答失败：' + String(e && e.message || e) + (auto ? '（可点「↻ 重答」再试）' : '（可直接重发）');
    }
  }
  if (wsState) { s.aiBusy = false; wsRenderAI(); }
}
/** 右栏底部输入框发出的追问 */
function wsAskAIFromInput() {
  if (!wsState) return;
  const v = (document.getElementById('wsAiIn')?.value || '').trim();
  if (!v) { toast('输入想追问的内容', 'err'); return; }
  if (!state.settings.apiKey) {
    wsState.aiErr = '还没配置 AI 接口（系统设置 → AI 接口），配置后即可连续追问。';
    wsRenderAI();
    return;
  }
  wsAskAI(v);
}
function wsOpenLink(url) {
  if (!/^https?:\/\//i.test(url)) { toast('链接不合法', 'err'); return; }
  if (IS_DESKTOP && window.electronAPI && window.electronAPI.openExternal) window.electronAPI.openExternal(url);
  else { try { window.open(url, '_blank', 'noopener'); } catch (e) { } }
}
function wsOpenBrowser() {
  if (!wsState) return;
  wsOpenLink(wsState.searchUrl || wsSearchUrl(wsState.q, wsState.engine));
}
async function wsCopy(text) {
  try { await navigator.clipboard.writeText(text); toast('链接已复制', 'ok'); }
  catch (e) { toast('复制失败，可手动选中复制', 'err'); }
}
/** 把搜索结果（或 AI 讲解）整理成笔记文本 */
function wsNoteText(one) {
  const s = wsState;
  const L = [];
  L.push(`【联网查询】${s.q}`);
  if (s.kp && s.kp !== s.q) L.push(`关联知识点：${s.kp}`);
  L.push(`查询时间：${wsNowText()}`);
  L.push('');
  if (one) {
    L.push(`—— 网页摘录（${wsEngineName(s.engine)}）——`);
    L.push(`${one.title}（${one.site || ''}）`);
    L.push(one.url);
    if (one.snippet) { L.push(''); L.push(one.snippet); }
    L.push('');
    L.push('—— 我的补充 ——');
    L.push('');
    return L.join('\n');
  }
  if ((s.aiMsgs || []).length) {
    L.push('—— AI 问答 ——');
    s.aiMsgs.forEach(m => { if (m.content && m.content.trim()) L.push((m.role === 'user' ? '问：' : '答：') + m.content.trim()); });
    L.push('');
  } else if (s.ai) { L.push('—— AI 整理 ——'); L.push(s.ai.trim()); L.push(''); }
  if (s.results.length) {
    L.push(`—— 参考资料（${wsEngineName(s.engine)}，共 ${s.results.length} 条）——`);
    s.results.slice(0, 6).forEach((r, i) => L.push(`${i + 1}. ${r.title}（${r.site || ''}）\n   ${r.url}`));
    L.push('');
  }
  L.push('—— 我的补充 ——');
  L.push('');
  return L.join('\n');
}
/** 存进知识库：弹编辑框（可先改再存），关联知识点默认取打开时的知识点 */
function wsSaveNote(one) {
  if (!wsState) return;
  if (wsState.aiBusy) { toast('AI 还在生成，等它答完再存更完整', 'err'); return; }
  if (!wsState.ai && !wsState.results.length) { toast('先查询出内容再存笔记', 'err'); return; }
  const text = one ? wsNoteText(one) : wsNoteText();
  const kp = wsState.kp || '';
  kbEditing = null;
  kbOpenEditor({ kind: 'free', kp, text, isNew: true });
  toast('已把查询内容整理成草稿，确认后保存', 'ok');
}
function wsUseAsNote(i) {
  if (!wsState || !wsState.results[i]) return;
  wsSaveNote(wsState.results[i]);
}

/* ================= 搜索联想词（v1.38.0） =================
 * 桌面版调主进程 web:suggest（Bing 开放联想接口，6 秒超时、失败静默）；
 * 网页版受跨域限制，联想静默不出现，不影响其它功能。 */
function wsSugInput() {
  if (!wsState) return;
  const inp = document.getElementById('wsQ');
  if (!inp) return;
  const q = inp.value.trim();
  clearTimeout(wsState.sugTimer);
  if (!q || q.length > 60 || !IS_DESKTOP || !window.electronAPI || typeof window.electronAPI.webSuggest !== 'function') {
    wsSugClose(); return;
  }
  wsState.sugTimer = setTimeout(async () => {
    if (!wsState) return;
    const cur = (document.getElementById('wsQ')?.value || '').trim();
    if (!cur || cur !== q) return;                    // 输入已变化，丢弃过期结果
    try {
      const r = await window.electronAPI.webSuggest(q);
      const items = Array.isArray(r && r.items) ? r.items.filter(x => x && x !== cur) : [];
      wsState.sugLastQ = cur;
      wsSugRender(items.slice(0, 8), cur);
    } catch (e) { wsSugClose(); }
  }, 300);
}
function wsSugRender(items, cur) {
  const el = document.getElementById('wsSug');
  if (!el || !wsState) return;
  wsState.sugs = items;
  wsState.sugIdx = -1;
  if (!items.length) { wsSugClose(); return; }
  el.innerHTML = items.map((t, i) =>
    `<div class="ws-sug-i${i === wsState.sugIdx ? ' on' : ''}" data-i="${i}" data-t="${esc(t)}" onmousedown="wsSugPick(+this.dataset.i)">
      <span class="ico">🔍</span><span>${esc(t)}</span></div>`).join('');
  el.classList.add('open');
  wsState.sugOpen = true;
  /* 对齐输入框位置（ws-head 已设 position:relative） */
  const inp = document.getElementById('wsQ');
  if (inp) {
    el.style.left = inp.offsetLeft + 'px';
    el.style.width = Math.max(320, Math.min(inp.clientWidth, 560)) + 'px';
  }
}
function wsSugClose() {
  const el = document.getElementById('wsSug');
  if (el) el.classList.remove('open');
  if (wsState) { wsState.sugOpen = false; wsState.sugIdx = -1; }
}
function wsSugNav(dir) {
  if (!wsState || !wsState.sugOpen || !wsState.sugs.length) return;
  const n = wsState.sugs.length;
  wsState.sugIdx = ((wsState.sugIdx + dir) % n + n) % n;
  const el = document.getElementById('wsSug');
  if (el) el.querySelectorAll('.ws-sug-i').forEach((d, i) => d.classList.toggle('on', i === wsState.sugIdx));
}
function wsSugPick(i) {
  const t = wsState && wsState.sugs[i];
  if (!t) return;
  const inp = document.getElementById('wsQ');
  if (inp) inp.value = t;
  wsSugClose();
  wsRun();
}

/* ================= 收藏夹（v1.38.0） =================
 * 把有用的网页结果 / AI 问答收进 wsFavs（随题库隔离，上限 100 条，超出淘汰最旧）；
 * 收藏可随时回看、一键转成知识库笔记。 */
function wsFavSave() {
  if (DB.bkvSet) DB.bkvSet('wsFavs', state.wsFavs || []);
  const cnt = document.getElementById('wsFavCnt');
  if (cnt) cnt.textContent = (state.wsFavs || []).length;
  /* v1.38.1：收藏并入知识库，知识库页开着时同步刷新列表 */
  if (typeof curView !== 'undefined' && curView === 'kb') kbRenderList();
}
function wsFavPush(item) {
  const favs = Array.isArray(state.wsFavs) ? state.wsFavs : [];
  /* 同 URL（网页结果）或同「q+ai 前 40 字」（AI 问答）不重复收 */
  const key = item.kind === 'ai'
    ? 'ai|' + item.q + '|' + String(item.ai || '').slice(0, 40)
    : 'web|' + (item.url || '');
  if (favs.some(f => ((f.kind === 'ai' ? 'ai|' + f.q + '|' + String(f.ai || '').slice(0, 40) : 'web|' + (f.url || '')) === key))) {
    toast('这条已经在收藏夹里了', 'ok');
    return false;
  }
  favs.unshift(item);
  state.wsFavs = favs.slice(0, WS_FAV_MAX);   // 超出淘汰最旧
  wsFavSave();
  wsFavRender();
  toast('已收进收藏夹', 'ok');
  return true;
}
function wsFavAddResult(i) {
  if (!wsState || !wsState.results[i]) return;
  const r = wsState.results[i];
  wsFavPush({
    id: 'wf' + Date.now() + Math.random().toString(36).slice(2, 6),
    kind: 'web', q: wsState.q, kp: wsState.kp || '', engine: wsState.engine,
    title: r.title, url: r.url, snippet: r.snippet || '', ai: '', at: Date.now(),
  });
}
function wsFavAddAI() {
  if (!wsState) return;
  const msgs = (wsState.aiMsgs || []).filter(m => m.content && m.content.trim());
  if (!msgs.length) { toast('还没有 AI 回答，先让 AI 解答或追问一轮', 'err'); return; }
  wsFavPush({
    id: 'wf' + Date.now() + Math.random().toString(36).slice(2, 6),
    kind: 'ai', q: wsState.q, kp: wsState.kp || '', engine: wsState.engine,
    title: 'AI 问答：' + wsState.q, url: '', snippet: '', ai: msgs.map(m => (m.role === 'user' ? '问：' : '答：') + m.content.trim()).join('\n\n'), at: Date.now(),
  });
}
function wsFavToggle() {
  const w = document.getElementById('wsFavWrap');
  const b = document.getElementById('wsFavBtn');
  if (!w) return;
  wsFavRender();
  const hidden = w.classList.toggle('hidden');
  if (b) b.childNodes[0].textContent = hidden ? '⭐ 收藏夹' : '⭐ 收起收藏夹';
  /* 两个抽屉互斥，别一起摊开 */
  if (!hidden) {
    const h = document.getElementById('wsHistWrap');
    if (h && !h.classList.contains('hidden')) { h.classList.add('hidden'); const hb = document.getElementById('wsHistBtn'); if (hb) hb.textContent = '🕘 最近查询'; }
  }
}
function wsFavRender() {
  const wrap = document.getElementById('wsFavWrap');
  if (!wrap) return;
  const list = Array.isArray(state.wsFavs) ? state.wsFavs : [];
  wrap.innerHTML = `<div style="font-size:12px;color:var(--muted);margin:6px 0 8px">收藏夹（${list.length}/${WS_FAV_MAX}，随当前题库保存）· 全部收藏也会显示在「知识库 → ⭐ 查询收藏」，方便随时翻看</div>` +
    (list.length ? list.map(f => `
      <div class="ws-fav-i" style="margin-bottom:6px">
        <span class="t" ${f.url ? `data-u="${esc(f.url)}" onclick="wsOpenLink(this.dataset.u)" title="${esc(f.url)}"` : ''} style="${f.url ? 'cursor:pointer' : ''}">${f.kind === 'ai' ? '🤖 ' : '🌐 '}${esc(f.title || f.q || '（无标题）')}</span>
        <span class="d">${fmtDate(f.at)}</span>
        <span class="op">
          ${f.url ? `<button class="ghost" data-u="${esc(f.url)}" onclick="wsOpenLink(this.dataset.u)">打开</button>` : ''}
          <button class="ghost" data-id="${f.id}" onclick="wsFavNote(this.dataset.id)" title="整理成笔记存进知识库">转笔记</button>
          <button class="ghost" data-id="${f.id}" onclick="wsFavDel(this.dataset.id)" title="从收藏夹删除">✕</button>
        </span>
      </div>`).join('')
      : '<div class="ws-empty">收藏夹还是空的 —— 网页结果卡上的「⭐ 收藏」、AI 解答旁的「⭐ 收藏回答」都能收进来</div>');
}
function wsFavDel(id) {
  state.wsFavs = (state.wsFavs || []).filter(f => f.id !== id);
  wsFavSave();
  wsFavRender();
  toast('已从收藏夹删除', 'ok');
}
/** 收藏项 → 知识库笔记草稿 */
function wsFavNote(id) {
  const f = (state.wsFavs || []).find(x => x.id === id);
  if (!f) return;
  const L = [`【联网查询·收藏】${f.q || f.title || ''}`];
  if (f.kp && f.kp !== f.q) L.push(`关联知识点：${f.kp}`);
  L.push(`收藏时间：${wsNowText()}`, '');
  if (f.kind === 'ai') {
    L.push('—— AI 问答 ——', f.ai || '', '');
  } else {
    L.push(`—— 网页摘录（${wsEngineName(f.engine)}）——`, f.title || '');
    if (f.url) L.push(f.url);
    if (f.snippet) { L.push('', f.snippet); }
    L.push('');
  }
  L.push('—— 我的补充 ——', '');
  kbEditing = null;
  kbOpenEditor({ kind: 'free', kp: f.kp || '', text: L.join('\n'), isNew: true });
  toast('已把收藏整理成草稿，确认后保存', 'ok');
}

/** 重练某知识点下的所有错题（与错题本数据联动） */
function practiceKPMist(name) {
  const pool = state.mistakes
    .map(m => state.questions.find(x => x.id === m.question_id))
    .filter(q => q && q.knowledge_point === name);
  if (!pool.length) { toast('该知识点下已无错题', 'ok'); return; }
  quiz = { items: shuffle(pool), idx: 0, correct: 0, finished: false, answers: [], mode: 'kp' };
  go('practice');
}
function practiceKP(name) {
  const node = buildGraph().nodes.find(n => n.name === name);
  if (!node) return;
  const pool = state.questions.filter(q => node.ids.has(q.id));
  if (!pool.length) { toast('该知识点下没有题目', 'err'); return; }
  quiz = { items: shuffle(pool).slice(0, Math.min(pool.length, 20)), idx: 0, correct: 0, finished: false, answers: [], mode: 'kp' };
  go('practice');
}
/* AI 批量补全知识点标签 */
async function aiTagKP() {
  const qs = state.questions.filter(q => !q.knowledge_point);
  if (!qs.length) { toast('所有题目都已有知识点标签', 'ok'); return; }
  const batch = qs.slice(0, 20);
  const list = batch.map((q, i) => `${i + 1}|${TYPES[q.type]}|${q.content.slice(0, 90)}`).join('\n');
  toast(`正在为 ${batch.length} 道题标注知识点…`);
  try {
    const out = await chat([
      { role: 'system', content: '你是题库管理助手。为每道题提炼 1-2 个简洁的知识点标签（4-8 字，如「牛顿第二定律」「TCP三次握手」）。同类题目必须使用完全相同的标签表述。只返回 JSON。' },
      { role: 'user', content: `题目列表（序号|题型|题干）：\n${list}\n\n返回格式：{"items":[{"i":1,"kp":"知识点1、知识点2"}]}` },
    ], true);
    const items = parseJSON(out).items || [];
    let n = 0;
    for (const it of items) {
      const q = batch[(it.i | 0) - 1];
      if (!q || !it.kp) continue;
      q.knowledge_point = String(it.kp).trim();
      await DB.put('questions', q); n++;
    }
    await refreshData(); viewKP(); toast(`已为 ${n} 道题标注知识点`, 'ok');
  } catch (e) { toast('标注失败：' + e.message, 'err'); }
}

/* ============ 间隔复习（SM-2 记忆曲线） ============ */
const DAY_MS = 86400000;
const REV_MARK = [
  { k: 1, name: '忘记', desc: '完全没印象', cls: 'r1' },
  { k: 2, name: '困难', desc: '很吃力才想起', cls: 'r2' },
  { k: 3, name: '良好', desc: '想起来了', cls: 'r3' },
  { k: 4, name: '简单', desc: '脱口而出', cls: 'r4' },
];
const REV_STATES = { fresh: '未学习', learning: '学习中', young: '记忆期', mature: '已掌握' };
function todayStart() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
function ivlLabel(d) {
  d = +d || 0;
  if (d <= 0) return '一会儿';
  if (d < 1) return Math.max(1, Math.round(d * 24 * 60)) + ' 分钟';
  if (d < 30) return Math.round(d) + ' 天';
  if (d < 365) return (d / 30).toFixed(1) + ' 个月';
  return (d / 365).toFixed(1) + ' 年';
}
function dueLabel(ts) {
  const diff = (ts || 0) - Date.now();
  if (diff <= 0) return '待复习';
  const h = diff / 3600000;
  if (h < 1) return Math.max(1, Math.round(diff / 60000)) + ' 分钟后';
  if (h < 24) return Math.round(h) + ' 小时后';
  const d = Math.round(h / 24);
  return d === 1 ? '明天' : d + ' 天后';
}
function cardState(c) {
  if (!c.reps && !c.lapses) return 'fresh';
  const i = c.interval || 0;
  if (i < 1) return 'learning';
  return i >= 21 ? 'mature' : 'young';
}
const isFreshCard = c => cardState(c) === 'fresh';
/** SM-2 记忆调度：grade 1=忘记 2=困难 3=良好 4=简单；返回新的调度字段 */
function sm2(card, grade) {
  const now = Date.now();
  let ease = card.ease ?? 2.5, reps = card.reps || 0, lapses = card.lapses || 0, ivl;
  if (grade <= 1) {                       // 忘记 → 重置到短间隔，降低熟悉因子
    lapses++; reps = 0; ivl = 10 / 1440;  // 10 分钟后重现
    ease = Math.max(1.3, +(ease - 0.2).toFixed(2));
  } else {
    reps++;
    const q = grade === 2 ? 3 : grade === 3 ? 4 : 5;
    ease = +(ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))).toFixed(2);
    ease = Math.max(1.3, Math.min(2.8, ease));
    if (reps === 1) ivl = grade === 4 ? 4 : 1;
    else if (reps === 2) ivl = grade === 2 ? 2 : grade === 4 ? 8 : 3;
    else ivl = Math.max(1, Math.round((card.interval || 1) * ease * (grade === 2 ? 0.6 : grade === 4 ? 1.3 : 1)));
    ivl = Math.min(ivl, 365 * 3);
  }
  return { ease, interval: ivl, reps, lapses, due: now + ivl * DAY_MS, state: cardState({ reps, interval: ivl, lapses }), hist: [...(card.hist || []), { at: now, g: grade, i: ivl }].slice(-60) };
}
/** 今日调度统计 */
function revTodayStat() {
  const t0 = todayStart();
  let done = 0, fresh = 0, again = 0, ok = 0;
  for (const c of state.reviews) {
    const h = c.hist || [];
    for (const x of h) if (x.at >= t0) { done++; x.g <= 1 ? again++ : ok++; }
    const first = h[0];
    if (first && first.at >= t0 && !h.some(x => x.at < t0)) fresh++;
  }
  return { done, fresh, again, ok, keep: done ? Math.round(ok / done * 100) : null };
}
function revForecast(n = 14) {
  const t0 = todayStart(), b = Array.from({ length: n }, (_, i) => ({ day: i, n: 0 }));
  for (const c of state.reviews) {
    if (isFreshCard(c)) continue;
    const d = Math.floor((c.due - t0) / DAY_MS);
    if (d < n) b[d < 0 ? 0 : d].n++;
  }
  return b;
}
/** 组今日队列：先逾期复习卡，再新卡，均受每日上限约束 */
function buildRevQueue() {
  const s = state.settings, now = Date.now(), t = revTodayStat();
  const reviewLeft = Math.max(0, (+s.revLimit || 100) - t.done);
  const newLeft = Math.max(0, (+s.revNewLimit || 20) - t.fresh);
  const due = state.reviews.filter(c => !isFreshCard(c) && c.due <= now).sort((a, b) => a.due - b.due).slice(0, reviewLeft);
  const fresh = shuffle(state.reviews.filter(isFreshCard)).slice(0, newLeft);
  return { list: [...due, ...fresh], due: due.length, fresh: fresh.length, reviewLeft, newLeft };
}
let rev = null;
function startReview(list) {
  if (!list || !list.length) { toast('暂时没有到期的复习卡片 🎉', 'ok'); return; }
  rev = { items: list, idx: 0, start: Date.now(), rated: 0, again: 0 };
  renderRevCard();
}
function startTodayReview() { const q = buildRevQueue(); startReview(q.list); }
function reviewDueOnly() { const l = state.reviews.filter(c => !isFreshCard(c) && c.due <= Date.now()).sort((a, b) => a.due - b.due); startReview(l); }
function renderRevCard() {
  if (rev.idx >= rev.items.length) { renderRevResult(); return; }
  const card = rev.items[rev.idx];
  const q = state.questions.find(x => x.id === card.question_id);
  if (!q) { // 原题目已被删除
    rev.idx++;
    DB.del('review', card.id).catch(() => { });
    renderRevCard(); return;
  }
  const done = rev.idx, total = rev.items.length;
  const mode = state.settings.revMode || 'answer';
  $('#view').innerHTML = `
  <h1>间隔复习</h1><div class="sub">第 ${done + 1} / ${total} 张卡 · 已评 ${rev.rated} 张 · 忘记 ${rev.again} 张</div>
  <div class="progress" style="margin-bottom:14px"><i style="width:${done / total * 100}%"></i></div>
  <div class="card rev-card">
    ${qNoteHTML(q, 'sess' + card.id)}
    <div class="rev-chip" style="margin-bottom:12px">
      <span class="pill blue">${TYPES[q.type]}</span>
      <span class="pill gray">${DIFFS[q.difficulty] || ''}</span>
      <span class="pill ${card.lapses ? 'red' : 'gray'}">${REV_STATES[cardState(card)]}</span>
      ${card.reps ? `<span class="pill gray">第 ${card.reps} 轮</span>` : ''}
      ${card.lapses ? `<span class="pill amber">遗忘 ${card.lapses} 次</span>` : ''}
      ${qNote(q) ? `<span class="pill amber" title="这道题已写过笔记，在题目上方可继续修改">📝 已记笔记</span>` : ''}
      ${impStarsHTML(q)}
    </div>
    <div class="rev-q">${esc(q.content)}</div>
    <div id="revAnsWrap" class="${mode === 'answer' ? '' : 'hidden'}" style="width:100%;text-align:left;margin-top:6px">
      <div id="revAnswerArea">${mode === 'answer' ? revAnsInput(q, card.id) : ''}</div>
      <div class="row" style="justify-content:center;margin-top:8px">
        <button class="primary" id="revSubmit" onclick="submitRevSession()">提交答案</button>
      </div>
      <div id="revJudge" style="width:100%"></div>
    </div>
    ${mode === 'recall' ? `<div class="row" style="justify-content:center;margin-top:8px"><button class="ghost" id="revAnsToggle" onclick="toggleRevSessionAns()">✍️ 先作答再评分（可选）</button></div>` : ''}
    <div id="revAns" class="hidden" style="width:100%"></div>
    <div class="row" style="justify-content:center;margin-top:8px">
      <button class="primary" id="revShow">显示答案（空格）</button>
    </div>
    <div id="revRate" class="rate-grid hidden">
      ${REV_MARK.map(m => { const r = sm2(card, m.k); return `<div class="rate-btn ${m.cls}" onclick="rateRev(${m.k})">
        <div class="rt">${m.name}</div><div class="rs">${m.desc}</div>
        <div class="rk">${ivlLabel(r.interval)}后再来</div></div>`; }).join('')}
    </div>
    <div style="color:var(--muted);font-size:12px;margin-top:10px">
      快捷键：<b>空格</b> 显示答案 · <b>1</b> 忘记 / <b>2</b> 困难 / <b>3</b> 良好 / <b>4</b> 简单 · <b>Esc</b> 退出
    </div>
  </div>`;
  const reveal = userAnswer => revealRevAns(q, userAnswer);
  const showBtn = $('#revShow');
  showBtn.onclick = () => {
    if ($('#revAnswerArea') && !$('#revAnsWrap').classList.contains('hidden')) {
      const u = readRevInput(q);
      reveal(u || '');
    } else reveal('');
  };
  bindRevKeys(q, reveal);
  revNoteFlush = null;
  bindQNotes($('#view'), f => { revNoteFlush = f; });
}
/** 展开正确答案与评分网格（模块级：会话内「显示答案」与「提交答案」共用） */
function revealRevAns(q, userAnswer) {
  const $ans = $('#revAns');
  if (!$ans) return;
  $ans.classList.remove('hidden');
  let hint = '';
  if (userAnswer) hint = `<div style="margin-bottom:8px">${hintPill(q, userAnswer)}</div>`;
  $ans.innerHTML = `${hint}
    ${q.options ? q.options.map(o => `<div class="q-opt">${esc(o)}</div>`).join('') : ''}
    <div class="q-ans"><b>正确答案：</b>${esc(q.answer)}
      ${q.explanation ? `<br><b style="color:var(--muted)">解析：</b>${esc(q.explanation)}` : ''}</div>
    ${q.source_excerpt ? `<div class="q-src">📎 原文：${esc(q.source_excerpt)}</div>` : ''}`;
  $('#revShow')?.classList.add('hidden');
  $('#revRate')?.classList.remove('hidden');
}
/** 回忆式下展开「先作答」区 */
function toggleRevSessionAns() {
  const wrap = $('#revAnsWrap');
  if (!wrap || !rev) return;
  const opening = wrap.classList.contains('hidden');
  wrap.classList.toggle('hidden', !opening);
  if (opening) {
    const card = rev.items[rev.idx];
    const q = state.questions.find(x => x.id === card.question_id);
    $('#revAnswerArea').innerHTML = revAnsInput(q, card.id);
    $('#rv-ta-' + card.id)?.focus();
  }
}
/** 复习会话提交答案：判分（客观本地/主观 AI）→ 写练习记录 → 显示结果并展开答案与评分网格 */
async function submitRevSession() {
  if (!rev) return;
  const card = rev.items[rev.idx];
  const q = state.questions.find(x => x.id === card.question_id);
  if (!q) { toast('这道题的原题已被删除，已自动跳过', 'err'); rev.idx++; renderRevCard(); return; }
  const box = $('#revAnswerArea');
  let user = '';
  if (q.options && q.type !== 'true_false') {
    user = [...box.querySelectorAll('.opt-click.sel')].map(e => e.dataset.l).join('');
    if (!user) { toast('请先选择答案', 'err'); return; }
  } else if (q.type === 'true_false') {
    user = box.querySelector('.tag.on')?.dataset.v || '';
    if (!user) { toast('请先选择答案', 'err'); return; }
  } else {
    user = ($('#rv-ta-' + card.id)?.value || '').trim();
    if (!user) { toast('请先输入答案', 'err'); return; }
  }
  const goBtn = $('#revSubmit');
  if (goBtn) { goBtn.disabled = true; goBtn.textContent = '判分中…'; }
  const resetBtn = () => { if (goBtn) { goBtn.disabled = false; goBtn.textContent = '提交答案'; } };
  let correct, aiNote = '';
  try {
    if (q.type === 'short_answer' || isTextType(q.type) || (q.type === 'fill_blank' && /[一-龥]{4,}/.test(q.answer))) {
      const r = await gradeSubjective({ type: q.type, answer: q.answer }, user);
      if (r.correct === null) {
        correct = confirm(`AI 判分不可用，请自评。\n\n你的答案：${user}\n参考答案：${q.answer}\n\n点击「确定」= 答对，「取消」= 答错`);
      } else { correct = r.correct; aiNote = r.aiNote; }
    } else {
      correct = gradeObjective({ type: q.type, answer: q.answer }, user);
    }
  } catch (e) {
    console.error('复习会话判分失败', e);
    toast('判分失败：' + (e && e.message || e) + '，可再点一次提交', 'err');
    resetBtn();
    return;
  }
  /* 练习记录写失败/超时只提示，不阻断判分结果展示（与 v1.42.1 同款加固） */
  try { await dbWrite('practice', { question_id: q.id, is_correct: correct ? 1 : 0, answered_at: Date.now() }); }
  catch (e) { console.error('practice 写入失败', e); toast('练习记录保存失败：' + (e && e.message || e), 'err'); }
  const judge = $('#revJudge');
  if (judge) judge.innerHTML = `
    <div class="q-ans" style="margin-top:10px">
      <b style="color:${correct ? 'var(--green)' : 'var(--red)'}">${correct ? '✔ 回答正确' : '✘ 回答错误'}</b>　你的答案：${esc(user)}
      ${aiNote ? `<br><span style="color:var(--muted)">AI 点评：${esc(aiNote)}</span>` : ''}
      ${q.explanation ? `<br><span style="color:var(--muted)">解析：${esc(q.explanation)}</span>` : ''}
    </div>
    <div style="color:var(--muted);font-size:12px;margin-top:4px">请根据掌握程度评分（对错仅作参考）</div>`;
  if (goBtn) { goBtn.disabled = true; goBtn.textContent = '已判分 ✓'; }   // 文案复位，别一直挂「判分中…」
  revealRevAns(q, '');     // 展开正确答案与评分网格
  try { await dbRefresh(); } catch (e) { console.error('刷新失败', e); }
}
function readRevInput(q) {
  const area = $('#revAnswerArea');
  if (!area) return '';
  if (q.options && q.type !== 'true_false') return [...area.querySelectorAll('.opt-click.sel')].map(e => e.dataset.l).join('');
  if (q.type === 'true_false') return area.querySelector('.tag.on')?.dataset.v || '';
  const cid = rev && rev.items[rev.idx] ? rev.items[rev.idx].id : '';
  return ($('#rv-ta-' + cid)?.value || '').trim();
}
function hintPill(q, u) {
  const subjective = q.type === 'short_answer' || isTextType(q.type) || (q.type === 'fill_blank' && /[一-龥]{4,}/.test(q.answer));
  const ok = subjective ? null : gradeObjective(q, u);
  const map = { null: ['gray', '主观题，请对照参考答案自评'], true: ['green', '✔ 你的答案正确'], false: ['red', '✘ 你的答案不正确'] };
  const [c, t] = map[String(ok)];
  return `<span class="pill ${c}">${t}</span> <span style="color:var(--muted);font-size:12px">你的答案：${esc(u)}</span>`;
}
async function rateRev(g) {
  const card = rev.items[rev.idx];
  if (card.__rated) return;
  if (revNoteFlush) { try { await revNoteFlush(); } catch (e) { } }   // 翻卡前先把笔记落盘
  const up = sm2(card, g);
  card.__rated = g;
  Object.assign(card, up);
  const payload = { ...card }; delete payload.__rated;
  try { await DB.put('review', payload); } catch (e) { console.error(e); }
  rev.rated++;
  if (g <= 1) { rev.again++; rev.items.push(card); }  // 忘记 → 本轮稍后重现
  rev.idx++;
  renderRevCard();
}
function renderRevResult() {
  const sec = Math.round((Date.now() - rev.start) / 1000);
  const mm = Math.floor(sec / 60), ss = sec % 60;
  const left = rev.items.length - rev.idx;
  $('#view').innerHTML = `
  <h1>复习完成 🎉</h1><div class="sub">本次会话结束</div>
  <div class="grid c4" style="margin-bottom:16px">
    <div class="stat a"><div class="lbl">本次复习卡片</div><div class="num">${rev.rated}</div></div>
    <div class="stat b"><div class="lbl">用时</div><div class="num">${mm}<small style="font-size:14px">分</small>${ss}<small style="font-size:14px">秒</small></div></div>
    <div class="stat d"><div class="lbl">标记为忘记</div><div class="num">${rev.again}</div></div>
    <div class="stat c"><div class="lbl">稍后重现</div><div class="num">${left}</div></div>
  </div>
  <div class="card"><h3>🧠 记忆效果</h3>
    <div class="sub">本次「记得」比例：${rev.rated ? Math.round((rev.rated - rev.again) / rev.rated * 100) : 0}%。忘记的卡片会在 10 分钟后再次出现，帮你巩固短期记忆。</div>
    <div class="bar-row"><span class="name">记得</span><div class="bar"><i style="width:${rev.rated ? (rev.rated - rev.again) / rev.rated * 100 : 0}%"></i></div>
      <span class="val">${rev.rated - rev.again} 张</span></div>
    <div class="bar-row"><span class="name">忘记</span><div class="bar"><i style="width:${rev.rated ? rev.again / rev.rated * 100 : 0}%"></i></div>
      <span class="val">${rev.again} 张</span></div>
  </div>
  <div class="row">
    <button class="primary" onclick="startTodayReview()">🔁 再复习一轮</button>
    <button class="ghost" onclick="viewReview()">返回复习面板</button>
    <button class="ghost" onclick="go('practice')">去答题练习</button>
  </div>`;
  rev = null;
  refreshData();
}
async function autoEnqueueIds(ids) {
  if (!state.settings.reviewAutoAdd) return 0;
  const exist = new Set(state.reviews.map(r => r.question_id));
  let n = 0;
  for (const qid of new Set(ids)) {
    if (!qid || exist.has(qid)) continue;
    await DB.add('review', { question_id: qid, ease: 2.5, interval: 0, reps: 0, lapses: 0, due: Date.now(), added_at: Date.now(), last_at: null, hist: [] });
    n++;
  }
  if (n) await refreshData();
  return n;
}
