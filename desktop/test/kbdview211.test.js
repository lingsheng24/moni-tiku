/**
 * v2.1.1 知识库文档：卡片 / 列表双视图
 * 覆盖：视图模式函数（默认 card、持久化）、切换函数、渲染分支、列表行 HTML、工具栏切换按钮、CSS。
 */
import { describe, test, expect } from 'vitest';
const fs = require('fs');
const { loadFns, HTML_PATH } = require('./extract-html.js');

const HTML = fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');

function between(a, b) {
  const s = HTML.indexOf(a);
  if (s < 0) return '';
  const e = HTML.indexOf(b, s + a.length);
  return e < 0 ? '' : HTML.slice(s, e);
}

function makeView(opts = {}) {
  const settings = Object.assign({ kbdView: opts.saved }, {});
  const kv = [];
  const fns = loadFns(['kbdViewMode', 'kbdSetView'], {
    state: { settings },
    DB: { kvSet: (k, v) => kv.push([k, v]) },
    viewKbDocs: () => { settings.reloaded = true; },
  });
  return { fns, settings, kv };
}

const DOC = name => ({
  name, tags: ['网络'], fm: { kp: ['三次握手'] }, links: [{ target: '拥塞控制', isKp: false }], body: '三次握手的本质是……', mtime: 1730000000000,
});

describe('知识库文档 卡片 / 列表双视图', () => {
  test('kbdViewMode：未设置默认 card，list / card 都能读出', () => {
    expect(makeView({}).fns.kbdViewMode()).toBe('card');
    expect(makeView({ saved: 'list' }).fns.kbdViewMode()).toBe('list');
    expect(makeView({ saved: 'card' }).fns.kbdViewMode()).toBe('card');
    expect(makeView({ saved: '其他' }).fns.kbdViewMode()).toBe('card');   // 非法值兜底 card
  });

  test('kbdSetView：写入 settings.kbdView、kvSet 持久化、重渲染；同值不重复刷', async () => {
    const a = makeView({});
    await a.fns.kbdSetView('list');
    expect(a.settings.kbdView).toBe('list');
    expect(a.kv[0][0]).toBe('settings');
    expect(a.settings.reloaded).toBe(true);
    const b = makeView({ saved: 'list' });
    await b.fns.kbdSetView('list');
    expect(b.settings.reloaded).toBeUndefined();   // 同值直接返回
    const c = makeView({});
    await c.fns.kbdSetView('whatever');            // 非法值兜底成 card：与默认相同则不写设置
    expect(c.fns.kbdViewMode()).toBe('card');
    const d = makeView({ saved: 'list' });
    await d.fns.kbdSetView('bogus');               // 从 list 切非法值 → 落回 card 并持久化
    expect(d.settings.kbdView).toBe('card');
  });

  test('渲染分支：card 用 kbd-grid，list 用 kbd-list（v2.2.0 起带表头）', () => {
    expect(HTML).toContain("kbdViewMode() === 'list'\n        ? `<div id=\"kbdCards\" class=\"kbd-list\" style=\"${kbdColVars()}\">${kbdListHeadHTML()}${shown.map(kbdRowHTML).join('')}</div>`");
    expect(HTML).toContain(": `<div id=\"kbdCards\" class=\"kbd-grid\">${shown.map(kbdCardHTML).join('')}</div>`");
  });

  test('kbdRowHTML：名称 / 标签 / 知识点 / 链数 / 摘要 / 日期分列输出', () => {
    const { kbdRowHTML } = loadFns(['kbdRowHTML'], {
      kbdBacklinks: () => [{ from: '其他.md' }],
      kbdSummary: () => '三次握手的本质是……',
      esc: s => String(s),
      kbdFilter: {},
      viewKbDocs: () => { },
    });
    const html = kbdRowHTML(DOC('TCP 三次握手笔记.md'));
    expect(html).toContain('class="kbd-row"');
    expect(html).toContain('class="c-name"');
    expect(html).toContain('class="c-sum"');
    expect(html).toContain('#网络');
    expect(html).toContain('三次握手');
    expect(html).toContain('<b>1</b> / 1');
    expect(html).toContain('class="c-date"');
    expect(html).toContain("kbdOpen('TCP 三次握手笔记.md')");
  });

  test('工具栏有 ▦ / ☰ 切换按钮，当前视图高亮（ibtn.on）', () => {
    expect(HTML).toContain('class="kbd-viewseg"');
    expect(HTML).toMatch(/<button class="ibtn \$\{kbdViewMode\(\) === 'card' \? 'on' : ''\}" data-tip="卡片视图[^"]*" onclick="kbdSetView\('card'\)">▦<\/button>/);
    expect(HTML).toMatch(/<button class="ibtn \$\{kbdViewMode\(\) === 'list' \? 'on' : ''\}" data-tip="列表视图[^"]*" onclick="kbdSetView\('list'\)">☰<\/button>/);
    expect(HTML).toContain("`列表视图 · 按${KBD_SORT_LABEL[kbdSort.by]}");
  });

  test('CSS：列表是带表头的表格容器，行间用分隔线而不是独立卡片', () => {
    expect(HTML).toContain('.kbd-list{margin-top:14px;border:1px solid var(--border);border-radius:10px;overflow:hidden;background:var(--panel);');
    expect(HTML).toContain('--c-name:240px;--c-tags:160px;--c-kp:150px;--c-link:92px;--c-sum:minmax(140px,1fr);--c-date:96px}');
    expect(HTML).toContain('.kbd-list-head,.kbd-row{display:grid;grid-template-columns:minmax(0,var(--c-name))');
    expect(HTML).toContain('.kbd-row:last-child{border-bottom:0}');
    expect(HTML).toContain('.kbd-row:hover{background:var(--panel2)}');
    expect(HTML).toContain('.kbd-row .c-name{font-weight:600;font-size:13.5px}');
  });

  test('空库空态两种视图共用一个提示卡', () => {
    expect(HTML).toContain('还没有文档 —— 点「＋ 新建文档」写第一篇 Markdown');
  });

  test('帮助手册新增「知识库文档」章，讲清两种视图', () => {
    expect(HTML).toContain("id: 'kbdocs', ico: '📓', title: '知识库文档'");
    expect(HTML).toContain("['19', '知识库文档 · 卡片视图：摘要 + 标签 + 关联知识点']");
    expect(HTML).toContain("['20', '列表视图 · 一行一篇，文档多时翻得快', 'wide']");
    expect(HTML).toMatch(/<b>▦ 卡片视图<\/b>/);
    expect(HTML).toMatch(/<b>☰ 列表视图<\/b>/);
    expect(HTML).toContain('选择会记住');
  });

  test('帮助手册讲清列表表头与点表头排序', () => {
    expect(HTML).toContain('<b>笔记名称 / 标签 / 知识点 / 链出·被链 / 摘要 / 修改日期</b>各占一列');
    expect(HTML).toContain('点表头排序');
    expect(HTML).toMatch(/再点同一切换升降序/);
    expect(HTML).toContain('「修改日期」默认降序');
  });

  test('帮助手册配图引用扩到 19 / 20 / 21，且 help-imgs 数据已生成对应 key', () => {
    expect(HTML).toContain("['21', 'AI 助教 · 只用你的资料作答，每条结论带 [编号] 角标可跳回原文']");
    const imgs = fs.readFileSync(require('path').join(__dirname, '..', 'help-imgs.json'), 'utf8');
    const keys = Object.keys(JSON.parse(imgs));
    for (const k of ['s01', 's05', 's13', 's19', 's20', 's21']) expect(keys).toContain(k);
  });

  test('旧章节名同步：笔记聚合、设置、出题资料的截图说明', () => {
    expect(HTML).toContain("['06', '笔记聚合 · 五类内容统一检索，每条笔记可一键跳回对应页面']");
    expect(HTML).toContain('底部固定 帮助 / 设置');
    expect(HTML).toContain("['13', '设置 · AI 接口 / 界面主题 / 数据管理 / 软件更新（卡片末尾有数据存放说明）']");
  });
});
