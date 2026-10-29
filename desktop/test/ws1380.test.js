import { describe, it, expect } from 'vitest';
import { loadFns } from './extract-html.js';
import fs from 'fs';
import path from 'path';

/* ================================================================
 * v1.38.0 联网查询丰富化：多引擎 / 智能聚合 / 联想词 / 收藏夹 / AI 追问
 * 引擎解析器直接抠 desktop/main.js 真实实现执行；前端纯函数用 loadFns。
 * ================================================================ */

/* ---------- 主进程：抠 decodeBody→registerWebSearch 之间整段 ---------- */
function loadMainSearch() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  /* 必须从 const zlib 那行开始抠：decodeBody 依赖它，漏了会在 catch 里静默返回原始字节 */
  const a = src.indexOf("const zlib = require('zlib');");
  const b = src.indexOf('function registerWebSearch');
  if (a < 0 || b < 0 || b <= a) throw new Error('main.js 抠段失败');
  const seg = src.slice(a, b);
  /* v1.41.0：健康度调用在段内、引入在 main.js 头部（段外），这里补齐依赖（须在段前声明，避开 TDZ） */
  const req = (name) => name === './engineHealth' ? require('../engineHealth') : require(name);
  return new Function('require',
    'const { createEngineHealth } = require("./engineHealth");\n' + seg
    + '\nreturn { parseBingResults, parseSogouResults, parseSoResults, searchWeb, SEARCH_ENGINES, AGG_ORDER };')(req);
}

/* ---------- mini 样本（真实页面结构的最小复刻，特征均来自 2026-10 线上抓包） ---------- */
const SOGOU_HTML = `<html><body>
<div class="vrwrap"><div class="aicard">AI解题答疑卡片，没有 h3 应被跳过</div></div>
<div class="vrwrap">
  <h3 class="vr-title"><a target="_blank" href="/link?url=abc123"><em>牛顿第二定律</em>— 刘叔物理</a></h3>
  <div class="text-layout"><p class="space-txt">加速度与合外力成正比 <em>牛顿第二定律</em> 公式 F=ma。</p></div>
  <a href="http://www.myliushu.com/post/1" class="citeLinkClass"><span>刘叔物理</span></a>
</div>
<div class="vrwrap">
  <h3 class="vr-title"><a target="_blank" href="https://baike.sogou.com/v132389.htm">牛顿第二定律（力学定律）- 搜狗百科</a></h3>
  <div class="str_info">物体的加速度跟所受合外力成正比，跟物体质量成反比。</div>
</div>
<div class="vrwrap">
  <h3 class="vr-title"><a target="_blank" href="/link?url=abc123">重复链接去重</a></h3>
  <p>重复</p>
  <a href="http://www.myliushu.com/post/1" class="citeLinkClass">重复来源</a>
</div>
</body></html>`;

const SO_HTML = `<html><body><ul>
<li class="res-list"><h3 class="res-title"><a href="https://www.so.com/link?m=abc" data-mdurl="https://wiki.cnki.com.cn/HotWord/1.htm" target="_blank"><em>牛顿第二定律</em>-学术百科</a></h3>
<p class="res-desc"><span class="gray">2026年10月15日 - </span><span data-result-summary>提供全面的 <em>牛顿第二定律</em> 相关文献下载。</span></p></li>
<li class="res-list"><h3 class="res-title"><a href="https://wenku.so.com/d/xxx" target="_blank">牛顿第二定律- 360文库</a></h3><div class="res-rich"><span data-result-summary>文档预览摘要文字。</span></div></li>
<li class="res-list"><h3 class="res-title"><a href="https://www.so.com/link?m=zzz" target="_blank">没有mdurl的跳转</a></h3><p>普通摘要段落</p></li>
</ul></body></html>`;

const BING_HTML = `
<li class="b_algo"><h2><a href="https://cn.bing.com/ck/a?!&u=a1aHR0cHM6Ly9iYWlrZS5iYWlkdS5jb20vaXRlbS8xMjM" target="_blank">牛顿第二运动定律_百度百科</a></h2><div class="b_caption"><p class="b_lineclamp">牛顿第二定律表明：加速度与合外力成正比。</p></div></li>
<li class="b_algo"><h2><a href="https://zhuanlan.zhihu.com/p/123" target="_blank">牛顿三大定律 - 知乎</a></h2><p>直接摘要</p></li>`;

describe('v1.38.0 主进程：四个引擎的解析器', () => {
  const M = loadMainSearch();

  it('引擎表：4 个单引擎 + 智能聚合并发顺序', () => {
    expect(Object.keys(M.SEARCH_ENGINES).sort()).toEqual(['bing', 'bingcn', 'so360', 'sogou']);
    expect(M.AGG_ORDER).toEqual(['bingcn', 'sogou', 'so360']);
    expect(M.SEARCH_ENGINES.sogou.build('F=ma')).toContain('sogou.com/web?query=F%3Dma');
    expect(M.SEARCH_ENGINES.so360.build('F=ma')).toContain('so.com/s?q=F%3Dma');
  });

  it('Bing：b_algo 提取 + ck/a 跳转还原', () => {
    const r = M.parseBingResults(BING_HTML, 10);
    expect(r).toHaveLength(2);
    expect(r[0].url).toBe('https://baike.baidu.com/item/123');
    expect(r[0].site).toBe('baike.baidu.com');
    expect(r[0].snippet).toContain('加速度与合外力成正比');
    expect(r[1].url).toBe('https://zhuanlan.zhihu.com/p/123');
  });

  it('搜狗：/link 绝对化、cite 真实域名、AI 卡跳过、同链接去重', () => {
    const r = M.parseSogouResults(SOGOU_HTML, 10);
    expect(r).toHaveLength(2);   // AI 卡无 h3 跳过；第三条与第二条 url 相同被去重
    expect(r[0].url).toBe('https://www.sogou.com/link?url=abc123');
    expect(r[0].title).toContain('刘叔物理');
    expect(r[0].site).toBe('myliushu.com');   // 来自 citeLinkClass 真实链接
    expect(r[0].snippet).toContain('F=ma');
    expect(r[1].url).toBe('https://baike.sogou.com/v132389.htm');
    expect(r[1].site).toBe('baike.sogou.com');
  });

  it('搜狗：跳转链接拿不到真实来源时 site 清空而不是显示搜狗自己', () => {
    const r = M.parseSogouResults('<div class="vrwrap"><h3 class="vr-title"><a href="/link?url=x">无cite的结果</a></h3><p>摘要</p></div>', 10);
    expect(r).toHaveLength(1);
    expect(r[0].site).toBe('');
  });

  it('360：data-mdurl 还原真实地址、res-desc / data-result-summary 双摘要兜底', () => {
    const r = M.parseSoResults(SO_HTML, 10);
    expect(r).toHaveLength(3);
    expect(r[0].url).toBe('https://wiki.cnki.com.cn/HotWord/1.htm');
    expect(r[0].site).toBe('wiki.cnki.com.cn');
    expect(r[0].snippet).toContain('相关文献下载');
    expect(r[1].url).toBe('https://wenku.so.com/d/xxx');
    expect(r[1].snippet).toContain('文档预览摘要');
    expect(r[2].url).toBe('https://www.so.com/link?m=zzz');   // 无 mdurl 保留跳转链接
  });

  it('空/垃圾输入不抛错，返回空数组', () => {
    expect(M.parseSogouResults('', 10)).toEqual([]);
    expect(M.parseSoResults(null, 10)).toEqual([]);
    expect(M.parseBingResults('<html></html>', 10)).toEqual([]);
  });
});

/* ---------- 前端纯函数 ---------- */
describe('v1.38.0 前端：引擎表与搜索 URL', () => {
  const { WS_ENGINES, wsEngineName, wsSearchUrl } = loadFns(['WS_ENGINES', 'wsEngineName', 'wsSearchUrl']);
  it('引擎表含 5 项（4 引擎 + 智能聚合）', () => {
    expect(Object.keys(WS_ENGINES)).toEqual(['bingcn', 'bing', 'sogou', 'so360', 'aggregate']);
  });
  it('wsSearchUrl 各引擎落到正确的站点', () => {
    expect(wsSearchUrl('x', 'sogou')).toContain('www.sogou.com/web?query=x');
    expect(wsSearchUrl('x', 'so360')).toContain('www.so.com/s?q=x');
    expect(wsSearchUrl('x', 'bing')).toContain('www.bing.com');
    expect(wsSearchUrl('x', 'aggregate')).toContain('cn.bing.com');   // 聚合的浏览器打开地址用国内 Bing
    expect(wsSearchUrl('x', 'unknown')).toContain('cn.bing.com');     // 未知引擎兜底
  });
  it('wsEngineName 兜底', () => {
    expect(wsEngineName('sogou')).toBe('搜狗');
    expect(wsEngineName('aggregate')).toBe('智能聚合');
    expect(wsEngineName('nope')).toBe(WS_ENGINES.bingcn);
  });
});

describe('v1.38.0 前端：AI 多轮对话构造', () => {
  const mk = (wsState) => loadFns(['wsAiMessages'], { wsState }).wsAiMessages;
  it('无对话时只返回 system', () => {
    const m = mk({ q: 'X', results: [], aiMsgs: [] })();
    expect(m).toHaveLength(1);
    expect(m[0].role).toBe('system');
  });
  it('流式空占位（assistant.content 为空）被过滤，不会发给模型', () => {
    const m = mk({ q: 'X', results: [], aiMsgs: [
      { role: 'user', content: '请讲解：X' },
      { role: 'assistant', content: '' },   // 正在生成
    ] })();
    expect(m).toHaveLength(2);   // system + 已完成的 user
  });
  it('完整问答历史按顺序透传', () => {
    const m = mk({ q: 'X', results: [], aiMsgs: [
      { role: 'user', content: '请讲解：X' },
      { role: 'assistant', content: '答案是…' },
      { role: 'user', content: '那公式呢' },
      { role: 'assistant', content: 'F=ma' },
    ] })();
    expect(m).toHaveLength(5);
    expect(m.map(x => x.role)).toEqual(['system', 'user', 'assistant', 'user', 'assistant']);
  });
});

describe('v1.38.0 前端：笔记文本包含多轮问答', () => {
  const mk = () => loadFns(['wsNoteText'], {
    wsState: {
      q: '牛顿第二定律', kp: '', engine: 'aggregate', results: [
        { title: 'T1', url: 'https://a.com', site: 'a.com', snippet: 'S1' },
      ],
      aiMsgs: [
        { role: 'user', content: '请讲解：牛顿第二定律' },
        { role: 'assistant', content: 'F=ma' },
        { role: 'user', content: '那动量呢' },
        { role: 'assistant', content: 'Ft=mv 变化' },
      ],
      ai: 'Ft=mv 变化',
    },
    wsNowText: () => '2026-10-28 15:00',
    wsEngineName: () => '智能聚合',
    WS_ENGINES: {},
  }).wsNoteText();
  it('问与答逐条带「问：/答：」前缀', () => {
    const t = mk();
    expect(t).toContain('问：请讲解：牛顿第二定律');
    expect(t).toContain('答：F=ma');
    expect(t).toContain('问：那动量呢');
    expect(t).toContain('答：Ft=mv 变化');
  });
  it('保留参考资料段', () => {
    const t = mk();
    expect(t).toContain('参考资料（智能聚合，共 1 条）');
    expect(t).toContain('T1');
  });
});

describe('v1.38.0 前端：收藏夹去重 / 上限 / 持久化', () => {
  function mkFns() {
    const calls = { bkvSet: [], toasts: [], renders: 0 };
    const fns = loadFns(['wsFavPush', 'wsFavSave', 'wsFavDel'], {
      state: { wsFavs: [] },
      document: { getElementById: () => null },   // node 环境：wsFavSave 里的计数徽章跳过
      DB: { bkvSet: (k, v) => calls.bkvSet.push([k, v]) },
      toast: (m) => calls.toasts.push(m),
      wsFavRender: () => { calls.renders++; },
      WS_FAV_MAX: 3,
    });
    return { ...fns, calls };
  }
  const mkItem = (n) => ({ id: 'wf' + n, kind: 'web', q: 'Q', url: 'https://x.com/' + n, title: 'T' + n, snippet: '', ai: '', at: n });

  it('同 URL 不重复收藏，提示已存在', () => {
    const { wsFavPush, calls } = mkFns();
    expect(wsFavPush(mkItem(1))).toBe(true);
    expect(wsFavPush({ ...mkItem(1), id: 'wf-again' })).toBe(false);
    expect(calls.toasts.some(t => t.includes('已经在收藏夹'))).toBe(true);
  });
  it('AI 收藏按「q + ai 前 40 字」判重', () => {
    const { wsFavPush } = mkFns();
    const ai = { id: 'a1', kind: 'ai', q: 'Q', url: '', title: '', snippet: '', ai: 'F=ma 是核心公式', at: 1 };
    expect(wsFavPush(ai)).toBe(true);
    expect(wsFavPush({ ...ai, id: 'a2' })).toBe(false);
    expect(wsFavPush({ ...ai, id: 'a3', ai: '完全不同的回答内容' })).toBe(true);
  });
  it('超出上限淘汰最旧（WS_FAV_MAX=3），每次收藏都持久化', () => {
    const { wsFavPush, calls } = mkFns();
    for (const n of [1, 2, 3, 4]) wsFavPush(mkItem(n));
    wsFavPush(mkItem(5));
    // 最后一次持久化的数组应为 3 条且最旧被淘汰（calls 里每条 [k, v]）
    const last = calls.bkvSet[calls.bkvSet.length - 1];
    expect(last[0]).toBe('wsFavs');
    expect(last[1]).toHaveLength(3);
    expect(last[1].map(x => x.url)).toEqual(['https://x.com/5', 'https://x.com/4', 'https://x.com/3']);
  });
  it('wsFavDel 删除并持久化', () => {
    const { wsFavPush, wsFavDel, calls } = mkFns();
    wsFavPush(mkItem(9));
    wsFavDel('wf9');
    const last = calls.bkvSet[calls.bkvSet.length - 1];
    expect(last[1]).toHaveLength(0);
  });
});
