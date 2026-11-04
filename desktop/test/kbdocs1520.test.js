/**
 * v1.52.0 知识库 MD 文档（Obsidian 式）：
 * - 文件名即标题 + front-matter（tags/kp/created/updated）解析与组装
 * - [[双链]] / [[kp:知识点]] / #标签 抽取
 * - 轻量 Markdown 渲染（先转义防注入，再渲染标题/粗体/列表/表格/代码块/引用）
 * - 反向链接索引、文档名安全化、旧手记迁移逻辑
 */
import { describe, test, expect } from 'vitest';
const fs = require('fs');
const { HTML_PATH } = require('./extract-html.js');

const HTML = fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');

function between(a, b) {
  const s = HTML.indexOf(a);
  if (s < 0) return '';
  const e = HTML.indexOf(b, s + a.length);
  return e < 0 ? '' : HTML.slice(s, e);
}
/** 在沙箱里执行 MD 模块函数（截取从模块开始到 viewKbDocs 前） */
function loadKbd() {
  const code = between('let kbdFilter = { kw: \'\', tag: \'\' };', 'const KB_KIND = {');
  const sandbox = {
    window: {},
    esc: s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  };
  const fn = new Function('SB', `with (SB) { ${code}; return { kbdParseFM, kbdBuildFM, kbdExtractLinks, kbdExtractTags, mdRender, kbdSafeName }; }`);
  return fn(sandbox);
}

describe('v1.52.0 知识库 MD 文档', () => {
  test('front-matter 解析：tags/kp 数组 + created/updated 时间', () => {
    const { kbdParseFM } = loadKbd();
    const r = kbdParseFM('---\ntags: 宏观, 难点\nkp: 货币政策, 利率体系\ncreated: 2026-11-04T00:00:00Z\nupdated: 2026-11-04T01:00:00Z\n---\n\n# 正文');
    expect(r.fm.tags).toEqual(['宏观', '难点']);
    expect(r.fm.kp).toEqual(['货币政策', '利率体系']);
    expect(r.fm.created).toBe(Date.parse('2026-11-04T00:00:00Z'));
    expect(r.body).toBe('\n# 正文');
  });
  test('无 front-matter 时全文即正文', () => {
    const { kbdParseFM } = loadKbd();
    const r = kbdParseFM('# 直接正文');
    expect(r.body).toBe('# 直接正文');
    expect(r.fm.tags).toEqual([]);
  });
  test('front-matter 组装 → 解析往返一致', () => {
    const { kbdBuildFM, kbdParseFM } = loadKbd();
    const text = kbdBuildFM({ tags: ['a', 'b'], kp: ['k1'], created: 1700000000000, updated: 1700000100000 }, '# 正文');
    const r = kbdParseFM(text);
    expect(r.fm.tags).toEqual(['a', 'b']);
    expect(r.fm.kp).toEqual(['k1']);
    expect(r.body).toContain('# 正文');
  });
  test('双链抽取：[[文档]]、[[文档|别名]]、[[kp:知识点]]、去重', () => {
    const { kbdExtractLinks } = loadKbd();
    const links = kbdExtractLinks('见 [[利率体系]] 与 [[利率体系|LPR]]，知识点 [[kp:货币政策]]，空 [[ ]] 不算');
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({ target: '利率体系', isKp: false });
    expect(links[1]).toMatchObject({ target: '货币政策', isKp: true });
  });
  test('标签抽取：front-matter tags + 正文 #标签（代码块内不算）', () => {
    const { kbdExtractTags } = loadKbd();
    const tags = kbdExtractTags('---\ntags: 宏观\n---\n正文 #难点 讨论\n```\n#code块内不算\n```\n`#行内代码也不算`');
    expect(tags).toContain('宏观');
    expect(tags).toContain('难点');
    expect(tags).not.toContain('code块内不算');
    expect(tags).not.toContain('行内代码也不算');
  });
  test('文件名安全化：去非法字符、限长、补 .md 由存储层处理', () => {
    const { kbdSafeName } = loadKbd();
    expect(kbdSafeName('  a/b\\c:d*e?f"g<h>i|j ')).toBe('a b c d e f g h i j');
    expect(kbdSafeName('[[测试]]#tag')).toBe('测试 tag');
    expect(kbdSafeName('')).toBe('未命名');
    expect(kbdSafeName('长'.repeat(100)).length).toBe(80);
  });
  test('MD 渲染：标题/粗体/列表/表格/代码块/引用，正文先转义防注入', () => {
    const { mdRender } = loadKbd();
    const h = mdRender('# 大标题\n\n**粗体** 与 *斜体* 和 ~~删除~~\n\n- 甲\n- 乙\n\n> 引用一行\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```js\nconst x = "<b>不转义</b>";\n```');
    expect(h).toContain('<h2 class="kbd-h">大标题</h2>');
    expect(h).toContain('<b>粗体</b>');
    expect(h).toContain('<i>斜体</i>');
    expect(h).toContain('<del>删除</del>');
    expect(h).toContain('<ul><li>甲</li><li>乙</li></ul>');
    expect(h).toContain('<blockquote>');
    expect(h).toContain('<th>A</th>');
    expect(h).toContain('<pre class="kbd-code">');
    expect(h).toContain('&lt;b&gt;不转义&lt;/b&gt;');
    expect(h).not.toContain('<b>不转义</b>');
  });
  test('MD 渲染：[[双链]] 变可点链接，[[kp:]] 带知识点标记，#标签 变 pill', () => {
    const { mdRender } = loadKbd();
    const h = mdRender('见 [[利率体系]] 和 [[利率体系|LPR]] 与 [[kp:货币政策]]，标签 #宏观');
    expect(h).toContain('data-kblink="利率体系"');
    expect(h).toContain('>LPR<');
    expect(h).toContain('data-kblink="货币政策" data-kbkp="1"');
    expect(h).toContain('data-kbtag="宏观"');
  });
  test('存储抽象 KBDOCS：桌面版走 electronAPI.kbDocs，网页版走 IndexedDB kbdocs', () => {
    expect(HTML).toContain("if (IS_DESKTOP && window.electronAPI.kbDocs) return window.electronAPI.kbDocs;");
    expect(HTML).toContain("d.createObjectStore('kbdocs', { keyPath: 'name' })");
    expect(HTML).toContain("indexedDB.open('tiku-web', 4)");
  });
  test('主进程 knowledge 目录 IPC：list/read/write/del/rename，删除进 .trash', () => {
    const main = fs.readFileSync(require('path').join(require('path').dirname(HTML_PATH), 'desktop/main.js'), 'utf8');
    for (const h of ["ipcMain.handle('kbdoc:dir'", "ipcMain.handle('kbdoc:list'", "ipcMain.handle('kbdoc:read'", "ipcMain.handle('kbdoc:write'", "ipcMain.handle('kbdoc:del'", "ipcMain.handle('kbdoc:rename'"]) {
      expect(main).toContain(h);
    }
    expect(main).toContain("'.trash'");
    const preload = fs.readFileSync(require('path').join(require('path').dirname(HTML_PATH), 'desktop/preload.js'), 'utf8');
    expect(preload).toContain('kbDocs:');
  });
  test('迁移：旧手记一键转 MD（幂等标记 + 原数据留底 kv）', () => {
    const f = between('async function kbdMigrateNotes', 'function viewKB()');
    expect(f).toContain("state.settings.kbDocsMigrated");
    expect(f).toContain("kbNotes_backup");
    expect(HTML).toContain('await kbdMigrateNotes();');
  });
  test('视图接入：views 表含 kbdocs，[[ 联想、反链面板、自动保存齐备', () => {
    expect(HTML).toContain('kbdocs: viewKbDocs');
    const ed = between('async function kbdOpen(name)', 'function kbdSetMode');
    expect(ed).toContain('kbdSuggestCheck');
    expect(ed).toContain("setTimeout(() => kbdSaveDoc(false), 1500)");
    expect(HTML).toContain('function kbdRenderBacklinks');
    expect(HTML).toContain('kbdBacklinks(kbdCur)');
  });
});
