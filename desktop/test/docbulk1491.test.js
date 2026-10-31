// @vitest-environment jsdom
/* v1.49.1 文档管理批量管理（勾选 / 批量出题队列 / 批量归科目 / 批量删除）
 * + 知识库里的「知识点图谱」图标改用与左侧导航同一套 SVG */
import { describe, test, expect } from 'vitest';
const { loadFns, HTML_PATH } = require('./extract-html.js');
const fs = require('fs');

const HTML = fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');
const between = (a, b) => {
  const i = HTML.indexOf(a);
  if (i < 0) return '';
  const j = HTML.indexOf(b, i + a.length);
  return j < 0 ? HTML.slice(i) : HTML.slice(i, j);
};

describe('docBulkIds：只取勾选且仍存在的文档', () => {
  const mk = (docs, sel) => loadFns(['docBulkIds'], {
    state: { docs },
    docSel: new Set(sel),
  });

  test('按列表顺序返回勾选文档 id', () => {
    const { docBulkIds } = mk([{ id: 1 }, { id: 2 }, { id: 3 }], [3, 1]);
    expect(docBulkIds()).toEqual([1, 3]);
  });

  test('已不在列表里的 id（被删/失效）自动忽略', () => {
    const { docBulkIds } = mk([{ id: 1 }], [1, 99]);
    expect(docBulkIds()).toEqual([1]);
  });

  test('未勾选时返回空数组', () => {
    const { docBulkIds } = mk([{ id: 1 }, { id: 2 }], []);
    expect(docBulkIds()).toEqual([]);
  });
});

describe('docBulkGen：批量出题写队列并跳到出题页', () => {
  test('按勾选顺序写入 gen_queue 并 go(gen)', () => {
    let jumped = null;
    window.sessionStorage.removeItem('gen_queue');
    const { docBulkGen } = loadFns(['docBulkGen'], {
      docBulkIds: () => [2, 5],
      sessionStorage: window.sessionStorage,
      toast: () => {},
      go: v => { jumped = v; },
    });
    docBulkGen();
    expect(JSON.parse(window.sessionStorage.getItem('gen_queue'))).toEqual([2, 5]);
    expect(jumped).toBe('gen');
  });

  test('未勾选时提示且不跳转、不写队列', () => {
    let jumped = null, tipped = '';
    window.sessionStorage.removeItem('gen_queue');
    const { docBulkGen } = loadFns(['docBulkGen'], {
      docBulkIds: () => [],
      sessionStorage: window.sessionStorage,
      toast: (m) => { tipped = m; },
      go: v => { jumped = v; },
    });
    docBulkGen();
    expect(jumped).toBeNull();
    expect(window.sessionStorage.getItem('gen_queue')).toBeNull();
    expect(tipped).toContain('勾选');
  });
});

describe('文档列表结构与批量工具条', () => {
  test('每行有勾选框、表头有全选，三个批量按钮初始 disabled', () => {
    expect(HTML).toContain('class="doc-cb"');
    expect(HTML).toContain('id="docAll"');
    const bar = between('id="docBulkBar"', '</table>');
    expect(bar).toContain('id="docBulkGen"');
    expect(bar).toContain('id="docBulkSubj"');
    expect(bar).toContain('id="docBulkDel"');
    expect(bar).toContain('disabled');
  });

  test('勾选状态在重绘后保留（checked 跟着 docSel）', () => {
    expect(HTML).toContain('${docSel.has(d.id) ? \'checked\' : \'\'}');
  });

  test('bindDocBulk 绑定单选/全选/半选与三个批量按钮', () => {
    const fn = between('function bindDocBulk', 'async function viewDocs');
    expect(fn).toContain('all.indeterminate');
    expect(fn).toContain("$('#docBulkGen').onclick = docBulkGen");
    expect(fn).toContain("$('#docBulkSubj').onclick = docBulkSubj");
    expect(fn).toContain("$('#docBulkDel').onclick = docBulkDel");
    expect(fn).toContain('b.disabled = !n');
  });

  test('viewDocs 渲染后会调用 bindDocBulk', () => {
    const v = between('async function viewDocs', 'function genFromDoc');
    expect(v).toContain('bindDocBulk()');
  });
});

describe('批量归科目 / 批量删除', () => {
  test('批量归科目复用 pickSubjectModal 并写回文档与题目', () => {
    const fn = between('async function docBulkSubj', 'async function docBulkDel');
    expect(fn).toContain('pickSubjectModal(null');
    expect(fn).toContain('批量归入科目');
    expect(fn).toContain('q.subject_id = sid');
    expect(fn).toContain('refreshData()');
  });

  test('批量归科目在无科目时提示先建科目', () => {
    const fn = between('async function docBulkSubj', 'async function docBulkDel');
    expect(fn).toContain('还没有科目');
  });

  test('批量删除确认文案说明题目保留，逐篇删除并清掉勾选', () => {
    const fn = between('async function docBulkDel', '/* ---------- 题目详情');
    expect(fn).toContain('题目会保留');
    expect(fn).toContain("DB.del('docs'");
    expect(fn).toContain('docSel.delete(id)');
  });

  test('pickSubjectModal 支持自定义标题/说明/按钮文案（默认行为不变）', () => {
    const fn = between('function pickSubjectModal', '/* 文档解析质量报告');
    expect(fn).toContain('opt.title');
    expect(fn).toContain('opt.okText');
    expect(fn).toContain('opt.hint');
    expect(fn).toContain("opt.okText || '开始导入'");
  });
});

describe('出题页批量队列', () => {
  test('读取 gen_queue、默认选中队列首篇、渲染队列条', () => {
    const fn = between('async function viewGen', 'function clampCount');
    expect(fn).toContain("sessionStorage.getItem('gen_queue')");
    expect(fn).toContain('genQueue = Array.isArray(q)');
    expect(fn).toContain('if (!pre && genQueue.length) pre = genQueue[0]');
    expect(fn).toContain('id="genQueueBar"');
    expect(fn).toContain('id="genQueueNext"');
  });

  test('「下一篇」按队列顺序切换并同步题型勾选', () => {
    const fn = between('async function viewGen', 'function clampCount');
    expect(fn).toContain('genQueue[i + 1]');
    expect(fn).toContain('syncGenTypesFromDoc(null)');
    expect(fn).toContain('updQ()');
  });

  test('队列里已删除的文档会被剔除', () => {
    const fn = between('async function viewGen', 'function clampCount');
    expect(fn).toContain("filter(id => state.docs.some(d => String(d.id) === id))");
  });
});

describe('知识库图谱图标与导航栏一致', () => {
  test('kpIconSVG 与左侧导航同一套图形（中心球 + 三个卫星 + 虚线）', () => {
    const fn = between('function kpIconSVG', '/* ============ 知识点图谱');
    expect(fn).toContain('circle cx="12" cy="12" r="2.8"');
    expect(fn).toContain('circle cx="12" cy="4.9"');
    expect(fn).toContain('circle cx="18.9" cy="16.9"');
    expect(fn).toContain('circle cx="5.1" cy="16.9"');
    expect(fn).toContain('stroke-dasharray="2 2.6"');
  });

  test('知识库两处图谱按钮改用 kpIconSVG，不再用 emoji', () => {
    const a = HTML.indexOf('data-tip="打开知识点图谱"');
    expect(a).toBeGreaterThan(0);
    expect(HTML.slice(a, a + 160)).toContain('${kpIconSVG(15)}');
    const b = HTML.indexOf('data-tip="打开完整图谱"');
    expect(b).toBeGreaterThan(0);
    expect(HTML.slice(b, b + 160)).toContain('${kpIconSVG(13)}');
    expect(HTML.slice(a, a + 160)).not.toContain('\u{1F9E0}');
  });
});
