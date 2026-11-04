/**
 * v2.2.0 知识库文档：列表视图「表头 + 分列」
 * 覆盖：表头列结构与顺序、排序状态（同列切换 / 换列 / 日期默认降序）、排序结果、
 *       行与列的对应关系与空值占位、CSS 栅格与三档窄屏断点、渲染入口。
 */
import { describe, test, expect } from 'vitest';
const fs = require('fs');
const { loadFns, HTML_PATH } = require('./extract-html.js');

const HTML = fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');

const LABEL = { name: '笔记名称', tags: '标签', kp: '知识点', link: '链接', mtime: '修改日期' };

/** 造一个「表头 + 排序」环境：kbdSort 是 let 变量，靠参数注入 */
function makeHead(sort, onSort) {
  return loadFns(['kbdListHeadHTML', 'kbdSortBy', 'KBD_SORT_LABEL'], {
    kbdSort: Object.assign({ by: 'mtime', dir: 'desc' }, sort || {}),
    viewKbDocs: () => { if (onSort) onSort(); },
  });
}

const DOCS = [
  { name: 'b-索引.md', tags: ['索引', '数据库', 'B+树'], fm: { kp: ['索引', 'B+树'] }, links: [{ target: 'x' }, { target: 'y' }], mtime: 3 },
  { name: 'a-事务.md', tags: ['事务'], fm: { kp: ['事务'] }, links: [{ target: 'x' }], mtime: 5 },
  { name: 'c-锁.md', tags: [], fm: { kp: [] }, links: [], mtime: 1 },
];
const BACK = { 'b-索引.md': [1, 2, 3], 'a-事务.md': [4], 'c-锁.md': [] };

function makeSort(sort) {
  return loadFns(['kbdSortDocs', 'kbdSortBy', 'KBD_SORT_LABEL'], {
    kbdSort: Object.assign({ by: 'mtime', dir: 'desc' }, sort || {}),
    kbdBacklinks: n => BACK[n] || [],
    viewKbDocs: () => { },
  });
}

describe('知识库文档列表：表头与分列', () => {
  test('表头六列，顺序 = 名称 / 标签 / 知识点 / 链出·被链 / 摘要 / 日期', () => {
    const { kbdListHeadHTML } = makeHead();
    const html = kbdListHeadHTML();
    expect(html).toContain('class="kbd-list-head"');
    const order = ['c-name', 'c-tags', 'c-kp', 'c-link', 'c-sum', 'c-date']
      .map(c => html.indexOf('kd-col ' + c));
    expect(order.every(i => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const label of ['笔记名称', '标签', '知识点', '链出/被链', '摘要', '修改日期']) expect(html).toContain(label);
  });

  test('只有可排序列是按钮，摘要列是纯文字', () => {
    const { kbdListHeadHTML } = makeHead();
    const html = kbdListHeadHTML();
    expect((html.match(/<button type="button" class="kd-col/g) || []).length).toBe(5);
    expect(html).toContain('<span class="kd-col c-sum" data-k="sum">摘要');
    // 五个可排序列都能点
    for (const k of ['name', 'tags', 'kp', 'link', 'mtime']) expect(html).toContain(`onclick="kbdSortBy('${k}')"`);
  });

  test('当前排序列高亮并显示方向箭头（日期默认降序 ▼）', () => {
    const html = makeHead().kbdListHeadHTML();
    expect(html).toMatch(/class="kd-col c-date on"[^>]*>修改日期<span class="kd-ar">▼<\/span>/);
    expect((html.match(/kd-ar/g) || []).length).toBe(1);      // 只有一个箭头
    expect(makeHead({ by: 'name', dir: 'asc' }).kbdListHeadHTML())
      .toMatch(/class="kd-col c-name on"[^>]*>笔记名称<span class="kd-ar">▲<\/span>/);
  });

  test('kbdSortBy：同列切换升降序，换列按新列升序（日期换回默认降序）', () => {
    let hits = 0;
    const a = makeHead({ by: 'name', dir: 'asc' }, () => hits++);
    expect(a.kbdSortBy('name')).toEqual({ by: 'name', dir: 'desc' });
    expect(a.kbdSortBy('name')).toEqual({ by: 'name', dir: 'asc' });
    expect(a.kbdSortBy('link')).toEqual({ by: 'link', dir: 'asc' });
    expect(a.kbdSortBy('mtime')).toEqual({ by: 'mtime', dir: 'desc' });
    expect(a.kbdSortBy('bogus')).toEqual({ by: 'mtime', dir: 'desc' });   // 非法列名忽略
    expect(hits).toBe(4);                                    // 非法那次不重渲染
  });

  test('kbdSortDocs：日期 / 名称 / 知识点数 / 链接数都能排', () => {
    expect(makeSort().kbdSortDocs(DOCS).map(d => d.name)).toEqual(['a-事务.md', 'b-索引.md', 'c-锁.md']);
    expect(makeSort({ by: 'mtime', dir: 'asc' }).kbdSortDocs(DOCS).map(d => d.name)).toEqual(['c-锁.md', 'b-索引.md', 'a-事务.md']);
    expect(makeSort({ by: 'name', dir: 'asc' }).kbdSortDocs(DOCS).map(d => d.name)).toEqual(['a-事务.md', 'b-索引.md', 'c-锁.md']);
    expect(makeSort({ by: 'name', dir: 'desc' }).kbdSortDocs(DOCS).map(d => d.name)).toEqual(['c-锁.md', 'b-索引.md', 'a-事务.md']);
    // 知识点 0 / 1 / 2
    expect(makeSort({ by: 'kp', dir: 'asc' }).kbdSortDocs(DOCS).map(d => d.name)).toEqual(['c-锁.md', 'a-事务.md', 'b-索引.md']);
    // 链出+被链：c 0 / a 1+1=2 / b 2+3=5
    expect(makeSort({ by: 'link', dir: 'desc' }).kbdSortDocs(DOCS).map(d => d.name)).toEqual(['b-索引.md', 'a-事务.md', 'c-锁.md']);
  });

  test('kbdSortDocs：不改原数组，同值时按修改时间兜底', () => {
    const f = makeSort({ by: 'kp', dir: 'asc' });
    const src = DOCS.map(d => ({ ...d }));
    f.kbdSortDocs(src);
    expect(src.map(d => d.name)).toEqual(['b-索引.md', 'a-事务.md', 'c-锁.md']);   // 原序未被改动
    const same = [
      { name: 'x.md', tags: [], fm: { kp: [] }, links: [], mtime: 1 },
      { name: 'y.md', tags: [], fm: { kp: [] }, links: [], mtime: 9 },
    ];
    expect(f.kbdSortDocs(same).map(d => d.name)).toEqual(['y.md', 'x.md']);
  });

  test('kbdRowHTML：六列与表头一一对应', () => {
    const { kbdRowHTML } = loadFns(['kbdRowHTML'], {
      kbdBacklinks: () => [{ from: 'a' }],
      kbdSummary: () => '三次握手的本质是……',
      esc: s => String(s),
      kbdFilter: {},
      viewKbDocs: () => { },
    });
    const html = kbdRowHTML({
      name: 'TCP 三次握手.md', tags: ['网络', 'TCP', '基础'], fm: { kp: ['三次握手', 'SYN'] },
      links: [{ target: 'a' }, { target: 'b' }], mtime: 1730000000000,
    });
    for (const c of ['c-name', 'c-tags', 'c-kp', 'c-link', 'c-sum', 'c-date']) expect(html).toContain(`class="${c}"`);
    expect(html).toContain('#网络');
    expect(html).toContain('#TCP');
    expect(html).toContain('+1');                            // 第三个标签折成 +1
    expect(html).toContain('三次握手 +1');                    // 知识点同理
    expect(html).toContain('<b>2</b> / 1');                  // 链出 2 · 被链 1
    expect(html).toContain('三次握手的本质是……');
    expect(html).toContain("kbdOpen('TCP 三次握手.md')");
  });

  test('kbdRowHTML：没有标签 / 知识点 / 链接时显示 — 占位，不留空列', () => {
    const { kbdRowHTML } = loadFns(['kbdRowHTML'], {
      kbdBacklinks: () => [], kbdSummary: () => '', esc: s => String(s), kbdFilter: {}, viewKbDocs: () => { },
    });
    const html = kbdRowHTML({ name: '空.md', tags: [], fm: { kp: [] }, links: [], mtime: 1730000000000 });
    expect((html.match(/class="kbd-none"/g) || []).length).toBe(3);
  });

  test('渲染入口：列表分支先画表头再画行', () => {
    expect(HTML).toContain('`<div id="kbdCards" class="kbd-list" style="${kbdColVars()}">${kbdListHeadHTML()}${shown.map(kbdRowHTML).join(\'\')}</div>`');
    expect(HTML).toContain('const shown = kbdSortDocs(matched);');
  });

  test('统计行写明当前视图与排序', () => {
    expect(HTML).toContain('`列表视图 · 按${KBD_SORT_LABEL[kbdSort.by]}${kbdSort.dir === \'asc\' ? \'升序\' : \'降序\'}`');
  });

  test('CSS：表头与行共用同一套栅格，窄屏逐级隐藏列且同步改模板', () => {
    expect(HTML).toContain('.kbd-list-head,.kbd-row{display:grid;grid-template-columns:minmax(0,var(--c-name)) minmax(0,var(--c-tags)) minmax(0,var(--c-kp)) minmax(0,var(--c-link)) var(--c-sum) minmax(0,var(--c-date));align-items:center;gap:10px;padding:9px 12px;min-width:0}');
    expect(HTML).toContain('.kbd-list-head{background:var(--panel2);border-bottom:1px solid var(--border);font-size:11.5px;font-weight:600;color:var(--muted)}');
    expect(HTML).toContain('.kbd-row{border-bottom:1px solid var(--border);cursor:pointer;transition:background .15s}');
    // 1240 隐藏摘要 → 五列；1000 隐藏知识点 → 四列；820 隐藏标签 → 三列
    expect(HTML).toContain('grid-template-columns:minmax(0,var(--c-name)) minmax(0,var(--c-tags)) minmax(0,var(--c-kp)) minmax(0,var(--c-link)) minmax(0,var(--c-date))');
    expect(HTML).toContain('.kbd-list-head .c-sum,.kbd-row .c-sum{display:none}');
    expect(HTML).toContain('grid-template-columns:minmax(0,var(--c-name)) minmax(0,var(--c-tags)) minmax(0,var(--c-link)) minmax(0,var(--c-date))');
    expect(HTML).toContain('.kbd-list-head .c-kp,.kbd-row .c-kp{display:none}');
    expect(HTML).toContain('grid-template-columns:minmax(0,var(--c-name)) minmax(0,var(--c-link)) minmax(0,var(--c-date))');
    expect(HTML).toContain('.kbd-list-head .c-tags,.kbd-row .c-tags{display:none}');
  });
});
