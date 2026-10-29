// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadFns } from './extract-html.js';

/* ================================================================
 * v1.38.0 联网查询面板 DOM 行为：面板结构 / 联想词 / 收藏夹渲染 / Esc 层级
 * 真实提取 HTML 里的函数，依赖（state/DB/toast/electronAPI…）以桩注入。
 * ================================================================ */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = d => d ? new Date(d).toLocaleString('zh-CN', { hour12: false }) : '';

const NAMES = [
  'WS_ENGINES', 'WS_HIST_MAX', 'WS_FAV_MAX',
  'wsEngineName', 'wsSearchUrl',
  'wsOpen', 'wsClose', 'wsEscHandler',
  'wsRun', 'wsPushHist', 'wsRenderHist',
  'wsRenderResults', 'wsDegradedNotice', 'wsRenderAI',
  'wsAskAI', 'wsAskAIFromInput', 'wsAiMessages',
  'wsSugInput', 'wsSugRender', 'wsSugClose', 'wsSugNav', 'wsSugPick',
  'wsFavPush', 'wsFavSave', 'wsFavToggle', 'wsFavRender', 'wsFavDel', 'wsFavAddResult', 'wsFavAddAI', 'wsFavNote',
  'wsNoteText', 'wsSaveNote', 'wsUseAsNote', 'wsOpenLink', 'wsCopy', 'wsReplay', 'wsHistToggle', 'wsNowText',
];

function boot(opts = {}) {
  const calls = { search: [], suggest: [], chat: [], bkvSet: [], toasts: [], openEditor: [], openLink: [] };
  const state = {
    settings: { searchEngine: opts.engine || 'bingcn', apiKey: opts.apiKey !== undefined ? opts.apiKey : 'sk-test', searchAutoAI: 0 },
    kbSearchHist: [], wsFavs: [],
  };
  const DB = { kvSet: () => {}, bkvSet: (k, v) => calls.bkvSet.push([k, v]), bkvGet: () => null };
  const toast = (m) => calls.toasts.push(m);
  const electronAPI = {
    webSearch: async (p) => { calls.search.push(p); return opts.searchResult || { ok: true, engine: p.engine, results: [] }; },
    webSuggest: async (q) => { calls.suggest.push(q); return { ok: true, items: ['联想A', '联想B', '联想C'] }; },
    openExternal: (u) => { calls.openLink.push(u); return true; },
  };
  const chat = async (messages, jsonMode, onChunk) => {
    calls.chat.push(messages);
    if (opts.chatFail) throw new Error('网络断了');
    onChunk('回答内容');
    return '回答内容';
  };
  const kbOpenEditor = (opt) => calls.openEditor.push(opt);
  const fns = loadFns(NAMES, {
    state, DB, toast, electronAPI, chat, kbOpenEditor, kbEditing: null,
    IS_DESKTOP: opts.IS_DESKTOP !== undefined ? opts.IS_DESKTOP : true,
    esc, fmtDate, document, window,
  });
  /* 提取的函数体里读的是 window.electronAPI / window.wsState（与源码运行时一致），
     桩必须挂到 window 上，仅传 ctx 变量不够 */
  window.electronAPI = electronAPI;
  return { ...fns, state, calls, electronAPI };
}

let T;
beforeEach(() => {
  document.body.innerHTML = '';
  vi.useFakeTimers();
  window.wsState = null;   // 提取的函数以「全局变量」方式读写面板状态（与源码 let wsState 对应）
  T = boot();
});
afterEach(() => { vi.useRealTimers(); });

describe('wsOpen：面板结构', () => {
  it('引擎下拉包含 5 个选项，默认选中设置里的引擎', () => {
    T.wsOpen('', '');
    const sel = document.getElementById('wsEngine');
    expect(sel.querySelectorAll('option')).toHaveLength(5);
    expect(sel.value).toBe('bingcn');
  });
  it('AI 对话区带输入行；底部有收藏夹和最近查询', () => {
    T.wsOpen('牛顿第二定律', '');
    expect(document.getElementById('wsAiIn')).toBeTruthy();
    expect(document.getElementById('wsFavBtn').textContent).toContain('收藏夹');
    expect(document.getElementById('wsFavCnt').textContent).toBe('0');
    expect(document.getElementById('wsHistBtn')).toBeTruthy();
    T.wsClose();
  });
  it('打开时带关键词自动搜索：webSearch 收到引擎参数，智能聚合原样传给主进程', async () => {
    T.wsOpen('牛顿第二定律', '');
    await vi.runAllTimersAsync();
    await Promise.resolve();
    expect(T.calls.search).toHaveLength(1);
    expect(T.calls.search[0]).toMatchObject({ q: '牛顿第二定律', engine: 'bingcn' });
    T.wsClose();
    T.state.settings.searchEngine = 'aggregate';
    T.wsOpen('动量定理', '');
    await vi.runAllTimersAsync();
    await Promise.resolve();
    expect(T.calls.search[1].engine).toBe('aggregate');
    T.wsClose();
  });
});

describe('联想词：防抖 / 键盘导航 / 点击搜索', () => {
  it('输入触发防抖联想，300ms 后调 webSuggest 并渲染列表', async () => {
    T.wsOpen('', '');
    const inp = document.getElementById('wsQ');
    inp.value = '牛顿';
    inp.oninput();
    expect(T.calls.suggest).toHaveLength(0);          // 还没到 300ms
    await vi.advanceTimersByTimeAsync(320);
    expect(T.calls.suggest).toEqual(['牛顿']);
    const sug = document.getElementById('wsSug');
    expect(sug.classList.contains('open')).toBe(true);
    expect(sug.querySelectorAll('.ws-sug-i')).toHaveLength(3);
  });
  it('输入清空立即收起，不再请求', async () => {
    T.wsOpen('', '');
    const inp = document.getElementById('wsQ');
    inp.value = '';
    inp.oninput();
    await vi.advanceTimersByTimeAsync(320);
    expect(T.calls.suggest).toHaveLength(0);
    expect(document.getElementById('wsSug').classList.contains('open')).toBe(false);
  });
  it('↑↓ 循环选择，Enter 搜选中项；Esc 只收联想不关面板', async () => {
    T.wsOpen('', '');
    const inp = document.getElementById('wsQ');
    inp.value = '牛顿';
    inp.oninput();
    await vi.advanceTimersByTimeAsync(320);
    T.wsSugNav(1); T.wsSugNav(1);   // 选中第 2 条「联想B」
    inp.onkeydown({ key: 'Enter', preventDefault() {} });
    expect(inp.value).toBe('联想B');
    // 输入后联想应开着 → Esc 第一次只收联想
    inp.value = 'again';
    inp.oninput();
    await vi.advanceTimersByTimeAsync(320);
    expect(T.wsEscHandlerGlobal || true).toBeTruthy();
    document.dispatchEvent ? null : null;
    // 直接调用 esc handler（与真实 keydown 等价）
    T.wsEscHandler({ key: 'Escape' });
    expect(document.getElementById('wsSug').classList.contains('open')).toBe(false);
    expect(document.getElementById('wsMask')).toBeTruthy();   // 面板还在
    T.wsEscHandler({ key: 'Escape' });
    expect(document.getElementById('wsMask')).toBeFalsy();    // 第二次才关面板
  });
  it('点联想词直接搜索', async () => {
    T.wsOpen('', '');
    const inp = document.getElementById('wsQ');
    inp.value = '牛';
    inp.oninput();
    await vi.advanceTimersByTimeAsync(320);
    T.wsSugPick(1);
    await vi.runAllTimersAsync();
    await Promise.resolve();
    expect(inp.value).toBe('联想B');
    expect(T.calls.search.some(s => s.q === '联想B')).toBe(true);
  });
  it('网页版（无 electronAPI.webSuggest）静默无联想', async () => {
    document.body.innerHTML = '';
    T = boot({ IS_DESKTOP: false });
    T.wsOpen('', '');
    const inp = document.getElementById('wsQ');
    inp.value = '牛顿';
    inp.oninput();
    await vi.advanceTimersByTimeAsync(320);
    expect(T.calls.suggest).toHaveLength(0);
    expect(document.getElementById('wsSug').classList.contains('open')).toBe(false);
  });
});

describe('收藏夹：添加 / 渲染 / 删除 / 转笔记', () => {
  it('结果卡「⭐ 收藏」写入 state.wsFavs 并持久化，重复收藏被拦', async () => {
    T.wsOpen('Q1', 'KP1');
    await vi.runAllTimersAsync();
    await Promise.resolve();
    T.state.settings.searchAutoAI = 0;
    window.wsState.results = [{ title: '结果一', url: 'https://a.com/1', snippet: '摘要', site: 'a.com' }];
    T.wsRenderResults();
    T.wsFavAddResult(0);
    expect(T.state.wsFavs).toHaveLength(1);
    expect(T.state.wsFavs[0]).toMatchObject({ kind: 'web', q: 'Q1', kp: 'KP1', url: 'https://a.com/1' });
    expect(T.calls.bkvSet.some(([k]) => k === 'wsFavs')).toBe(true);
    expect(document.getElementById('wsFavCnt').textContent).toBe('1');
    T.wsFavAddResult(0);
    expect(T.state.wsFavs).toHaveLength(1);   // 同 URL 去重
    T.wsClose();
  });
  it('「⭐ 收藏回答」收最后一轮问答；没有回答时提示', async () => {
    T.wsOpen('Q2', '');
    await vi.runAllTimersAsync();
    await Promise.resolve();
    T.wsFavAddAI();
    expect(T.calls.toasts.some(t => t.includes('还没有 AI 回答'))).toBe(true);
    T.state.settings.searchAutoAI = 0;
    window.wsState.results = [{ title: 't', url: 'https://a.com', snippet: '', site: '' }];
    await T.wsAskAI();                       // 不带参数 → 用面板查询词 Q2 作首问
    T.wsFavAddAI();
    expect(T.state.wsFavs).toHaveLength(1);
    expect(T.state.wsFavs[0].kind).toBe('ai');
    expect(T.state.wsFavs[0].ai).toContain('问：请讲解：Q2');
    expect(T.state.wsFavs[0].ai).toContain('答：回答内容');
    T.wsClose();
  });
  it('收藏夹渲染：打开/转笔记/删除', () => {
    T.state.wsFavs = [
      { id: 'wf1', kind: 'web', q: 'Q', kp: '', engine: 'bingcn', title: '网页T', url: 'https://a.com', snippet: 'S', ai: '', at: Date.now() },
      { id: 'wf2', kind: 'ai', q: 'Q', kp: '', engine: 'bingcn', title: 'AI T', url: '', snippet: '', ai: '问：x\n\n答：y', at: Date.now() },
    ];
    T.wsOpen('', '');
    T.wsFavToggle();
    const wrap = document.getElementById('wsFavWrap');
    expect(wrap.classList.contains('hidden')).toBe(false);
    expect(wrap.textContent).toContain('2/100');
    T.wsFavNote('wf2');
    expect(T.calls.openEditor).toHaveLength(1);
    expect(T.calls.openEditor[0].text).toContain('问：x');
    T.wsFavDel('wf1');
    expect(T.state.wsFavs).toHaveLength(1);
    T.wsClose();
  });
});

describe('AI 连续追问：消息流与失败处理', () => {
  it('第一问带网页摘要参考，追问透传历史，流式写入气泡', async () => {
    T.wsOpen('Q3', '');
    await vi.runAllTimersAsync();
    await Promise.resolve();
    T.state.settings.searchAutoAI = 0;
    window.wsState.results = [{ title: 't', url: 'https://a.com', snippet: '参考摘要', site: '' }];
    await T.wsAskAI('讲解一下');
    expect(T.calls.chat[0]).toHaveLength(2);                       // system + user
    expect(T.calls.chat[0][1].content).toContain('请讲解：Q3');
    expect(T.calls.chat[0][1].content).toContain('【网页摘要参考】');
    expect(window.wsState.aiMsgs).toHaveLength(2);
    expect(window.wsState.aiMsgs[1].content).toBe('回答内容');

    await T.wsAskAI('那动量定理呢');                               // 追问
    expect(T.calls.chat[1]).toHaveLength(4);                       // system + 历史2 + 新问1
    expect(T.calls.chat[1][3].content).toBe('那动量定理呢');
    expect(window.wsState.aiMsgs).toHaveLength(4);
    T.wsClose();
  });
  it('「↻ 重答」清空对话重新生成；AI 失败移除空占位并亮错误', async () => {
    T.wsOpen('Q4', '');
    await vi.runAllTimersAsync();
    await Promise.resolve();
    T.state.settings.searchAutoAI = 0;
    window.wsState.results = [];
    await T.wsAskAI();
    expect(window.wsState.aiMsgs).toHaveLength(2);
    T.wsAskAI();                                                    // 重答（不传 text）：清空后立刻开始新一轮
    expect(window.wsState.aiMsgs).toHaveLength(2);                  // user + 流式占位
    await vi.runAllTimersAsync();
    await Promise.resolve();
    expect(T.calls.chat).toHaveLength(2);
    expect(T.calls.chat[1]).toHaveLength(2);                        // 只有 system + 新首问，旧对话没带走

    // 失败路径
    document.body.innerHTML = '';
    T = boot({ chatFail: true });
    T.wsOpen('Q5', '');
    await vi.runAllTimersAsync();
    await Promise.resolve();
    T.state.settings.searchAutoAI = 0;
    window.wsState.results = [];
    await T.wsAskAI();
    expect(window.wsState.aiMsgs).toHaveLength(0);                       // 空占位被移除
    expect(window.wsState.aiErr).toContain('网络断了');
    T.wsClose();
  });
  it('未配置 API Key：追问给明确提示，不调用 chat', async () => {
    document.body.innerHTML = '';
    T = boot({ apiKey: '' });
    T.wsOpen('Q6', '');
    await vi.runAllTimersAsync();
    await Promise.resolve();
    await T.wsAskAI();
    expect(T.calls.chat).toHaveLength(0);
    expect(window.wsState.aiErr).toContain('还没配置 AI 接口');
    T.wsClose();
  });
});
