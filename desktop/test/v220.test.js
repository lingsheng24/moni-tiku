/**
 * v2.2.0 知识网络 + 互通
 * 覆盖：buildGraph 文档/题目图层与边、图层开关函数、节点可见性与半径、
 *      折叠面板图层行、题库包（.mtkpkg）导出/导入去重、Anki 卡片 TSV 导出。
 */
import { describe, test, expect } from 'vitest';
const fs = require('fs');
const { loadFns, HTML_PATH } = require('./extract-html.js');

const HTML = fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');
const between = (startFn, endMark) => {
  const s = HTML.indexOf('function ' + startFn);
  const e = HTML.indexOf(endMark, s);
  return s < 0 ? '' : HTML.slice(s, e < 0 ? s + 6000 : e);
};

const DOCS = new Map([
  ['TCP 三次握手笔记.md', { name: 'TCP 三次握手笔记.md', fm: { kp: ['三次握手', '拥塞控制'] }, body: 'x'.repeat(120), links: [{ target: '拥塞控制', isKp: true }], tags: ['网络'] }],
  ['索引笔记.md', { name: '索引笔记.md', fm: { kp: ['B+ 树'] }, body: 'y'.repeat(60), links: [], tags: ['数据库'] }],
]);
const QUESTIONS = [
  { id: 1, type: 'single_choice', content: '三次握手的第二次报文是什么？', options: ['A. SYN', 'B. SYN+ACK'], answer: 'B', knowledge_point: '三次握手', difficulty: 'medium', imp: 4, explanation: '服务端回 SYN+ACK' },
  { id: 2, type: 'true_false', content: '四次挥手比三次握手多一次。', options: null, answer: '正确', knowledge_point: '三次握手', difficulty: 'easy', imp: 2, explanation: '' },
  { id: 3, type: 'single_choice', content: 'B+ 树的高度通常是多少？', options: ['A. 3~4 层', 'B. 30 层'], answer: 'A', knowledge_point: 'B+ 树', difficulty: 'medium', imp: 5, explanation: '' },
];

function graphCtx(over) {
  return Object.assign({
    state: { questions: QUESTIONS, practice: [] },
    kpSubject: '',
    kpSelected: '三次握手',
    kpDocLayerOn: () => true,
    kpQLayerOn: () => true,
    kbdIndex: { docs: DOCS },
    kbdDocKpNames: doc => {
      const set = new Set();
      ((doc.fm && doc.fm.kp) || []).forEach(k => k && set.add(String(k).trim()));
      (doc.links || []).forEach(l => l && l.isKp && l.target && set.add(String(l.target).trim()));
      return set;
    },
    splitKP: s => String(s || '').split(/[、,，;；]/).filter(Boolean),
    impOf: q => q.imp || 3,
    matchSubject: () => true,
    kbAllNotes: () => [],
    kpLinkEnabled: () => true,
    kpLinkSecOn: () => false,
    kpLinkQsimOn: () => false,
    kpSimPairs: () => [],
    sectionOfQuestion: () => '',
    kpNameSim: () => 0,
    kbDocLayer: true,
  }, over || {});
}

describe('关系图谱 · 知识网络图层', () => {
  test('文档节点：kind=doc、i 在 1e6 段、name 去掉 .md，并连到它提到的知识点', () => {
    const f = loadFns(['buildGraph'], graphCtx());
    const g = f.buildGraph();
    const docs = g.nodes.filter(n => n.kind === 'doc');
    expect(docs.length).toBe(2);                              // 两篇文档都提到了图上存在的知识点
    expect(docs.map(n => n.name).sort()).toEqual(['TCP 三次握手笔记', '索引笔记']);
    expect(docs.every(n => n.i >= 1000000 && n.i < 2000000)).toBe(true);
    expect(docs.find(n => n.name === 'TCP 三次握手笔记').docName).toBe('TCP 三次握手笔记.md');
    const docEdges = g.edges.filter(e => e[3] === 'doc');
    expect(docEdges.length).toBe(3);                          // 三次握手 / 拥塞控制 / B+ 树 各一条
    expect(g.docN).toBe(2);
  });

  test('题目节点：只在开了图层且选中知识点时展开，题目挂在选中知识点下', () => {
    const on = loadFns(['buildGraph'], graphCtx());
    const g1 = on.buildGraph();
    const qs = g1.nodes.filter(n => n.kind === 'q');
    expect(qs.length).toBe(2);                                // 「三次握手」下两道题
    expect(qs.every(n => n.i >= 2000000)).toBe(true);
    expect(qs.map(n => n.qid).sort()).toEqual([1, 2]);
    expect(g1.edges.filter(e => e[3] === 'q').length).toBe(2);
    expect(g1.qN).toBe(2);
    /* 图层关掉 → 一个题目节点都不留 */
    const off = loadFns(['buildGraph'], graphCtx({ kpQLayerOn: () => false }));
    expect(off.buildGraph().nodes.filter(n => n.kind === 'q').length).toBe(0);
    /* 没选中知识点 → 也不展开 */
    const noSel = loadFns(['buildGraph'], graphCtx({ kpSelected: null }));
    expect(noSel.buildGraph().nodes.filter(n => n.kind === 'q').length).toBe(0);
  });

  test('题目节点最多 40 道（避免几百道题把球面糊满）', () => {
    const many = [];
    for (let i = 0; i < 60; i++) many.push({ id: 100 + i, type: 'single_choice', content: '题' + i, answer: 'A', knowledge_point: '三次握手', imp: 3 });
    const f = loadFns(['buildGraph'], graphCtx({ state: { questions: many, practice: [] } }));
    const g = f.buildGraph();
    expect(g.nodes.filter(n => n.kind === 'q').length).toBe(40);
  });

  test('图层开关：默认文档开、题目关，写进 settings 后持久化', () => {
    expect(HTML).toContain("function kpDocLayerOn() { return state.settings.kpLayerDoc !== 0; }");
    expect(HTML).toContain("function kpQLayerOn() { return state.settings.kpLayerQ === 1; }");
    const f = loadFns(['kpDocLayerOn', 'kpQLayerOn'], { state: { settings: {} } });
    expect(f.kpDocLayerOn()).toBe(true);
    expect(f.kpQLayerOn()).toBe(false);
  });

  test('节点可见性：只看题库时藏文档，只看知识库时藏题目，筛选不影响知识点逻辑', () => {
    const mk = over => loadFns(['kpNodeVisible'], Object.assign({
      kpSrcFilter: null, kpSrcMatch: () => true, kpMasteryMatch: () => true,
      kpImpOnlyOn: () => false, kpNoteOnlyOn: () => false, kpNoteCount: () => 0,
    }, over || {}));
    const doc = { kind: 'doc', name: '某文档' }, q = { kind: 'q', name: 'Q1' }, kp = { name: '三次握手', imp: 3 };
    expect(mk().kpNodeVisible(doc)).toBe(true);
    expect(mk({ kpSrcFilter: 'q' }).kpNodeVisible(doc)).toBe(false);
    expect(mk({ kpSrcFilter: 'kb' }).kpNodeVisible(doc)).toBe(true);
    expect(mk({ kpSrcFilter: 'kb' }).kpNodeVisible(q)).toBe(false);
    expect(mk({ kpSrcFilter: 'q' }).kpNodeVisible(q)).toBe(true);
    /* 文档 / 题目不受「有笔记 / 重要」筛选牵连 */
    expect(mk({ kpImpOnlyOn: () => true }).kpNodeVisible(doc)).toBe(true);
    expect(mk({ kpNoteOnlyOn: () => true }).kpNodeVisible(q)).toBe(true);
    expect(mk({ kpMasteryMatch: () => false }).kpNodeVisible(kp)).toBe(false);
  });

  test('节点半径：文档 > 知识点 > 题目（同一景深下）', () => {
    const f = loadFns(['kpNodeRadius'], {});
    const p = (n, s) => ({ n, s: s || 1 });
    const rd = f.kpNodeRadius(p({ kind: 'doc' }));
    const rk = f.kpNodeRadius(p({ kind: 'kp', imp: 3 }));
    const rq = f.kpNodeRadius(p({ kind: 'q' }));
    expect(rd).toBeGreaterThan(rk);
    expect(rk).toBeGreaterThan(rq);
    expect(f.kpNodeRadius(p({ imp: 5 }))).toBeGreaterThan(f.kpNodeRadius(p({ imp: 1 })));
  });

  test('工具栏折叠面板里有「图层」行（文档 / 题目两个开关）', () => {
    expect(HTML).toContain('<span class="kp-fold-lbl" title="知识网络的图层：知识点是主干，文档与题目是挂在上面的实体">图层</span>');
    expect(HTML).toMatch(/<input type="checkbox" id="kpDocChk"[^>]*onchange="kpSetLayer\('doc', this\.checked\)"/);
    expect(HTML).toMatch(/<input type="checkbox" id="kpQChk"[^>]*onchange="kpSetLayer\('q', this\.checked\)"/);
    expect(HTML).toContain('选中一个知识点，题目节点就会展开在它周围');
  });

  test('页头统计带上文档数与题目数，知识点统计只算 kind=kp', () => {
    expect(HTML).toContain("docN ? ` · <b style=\"color:#0d9488\">${docN} 篇文档</b>` : ''");
    expect(HTML).toContain("qN ? ` · <b>${qN} 道题</b>` : ''");
    expect(HTML).toContain("const kpNodes = nodes.filter(n => (n.kind || 'kp') === 'kp');");
  });

  test('点文档节点打开 .md、点题目节点看题（单击与双击都接）', () => {
    const pick = between('bindKPCanvas', 'function kpNeighborInfo');
    expect(pick).toContain("if (nd.kind === 'doc') kpOpenKbDoc(nd.docName)");
    expect(pick).toContain("else if (nd.kind === 'q') kpOpenQuestion(nd.qid)");
    expect(pick).toContain("if (nd.kind === 'doc') { kpOpenKbDoc(nd.docName); return; }");
    expect(typeof between('kpOpenQuestion', 'function kpTick')).toBe('string');
    expect(between('kpOpenQuestion', 'function kpTick')).toContain('practiceKP');
  });
});

describe('题库包（.mtkpkg）', () => {
  const baseCtx = over => Object.assign({
    MTKPACK_KIND: 'monitiku-bankpack', MTKPACK_SCHEMA: 1, APP_VER_SHOWN: '2.2.0',
    state: { questions: QUESTIONS, kpNotes: { '三次握手': { text: '三次握手记住 SYN 序号' } }, banks: [{ id: 'default', name: '网络题库' }], bankId: 'default' },
    kbdIndex: { docs: DOCS },
    kbdBuildIndex: async () => { },
    KBDOCS: { read: async n => (DOCS.get(n) ? '# 内容' : null) },
  }, over || {});

  test('normQKey：忽略空白与大小写差异，题干 / 答案都参与', () => {
    const f = loadFns(['normQKey'], {});
    expect(f.normQKey('  三次握手  ', 'B')).toBe(f.normQKey('三次握手', 'b'));
    expect(f.normQKey('三次握手', 'B')).not.toBe(f.normQKey('三次握手', 'A'));
  });

  test('mtkpackCollect：kind / schema / 题目去 id / 文档带原文 / 笔记一并带', async () => {
    const f = loadFns(['mtkpackCollect', 'normQKey'], baseCtx());
    const pack = await f.mtkpackCollect();
    expect(pack.kind).toBe('monitiku-bankpack');
    expect(pack.schema).toBe(1);
    expect(pack.bank.name).toBe('网络题库');
    expect(pack.app_ver).toBe('2.2.0');
    expect(pack.questions.length).toBe(3);
    expect(pack.questions[0].id).toBeUndefined();
    expect(pack.questions[0].content).toContain('三次握手');
    expect(pack.docs.length).toBe(2);
    expect(pack.docs[0].content).toBe('# 内容');
    expect(pack.counts).toEqual({ questions: 3, docs: 2, kp_notes: 1 });
    expect(pack.kp_notes['三次握手'].text).toContain('SYN');
  });

  test('mtkpackImport：按题干+答案去重，重复的不再写入；同名文档自动加序号', async () => {
    const added = [], wrote = [];
    const pack = {
      kind: 'monitiku-bankpack', bank: { name: '别人的题库' },
      questions: [
        { type: 'single_choice', content: '三次握手的第二次报文是什么？', options: ['A. SYN'], answer: 'B' },
        { type: 'single_choice', content: '全新的题目', answer: 'A' },
      ],
      docs: [{ name: 'TCP 三次握手笔记', content: '# 别人的版本' }],
      kp_notes: { '已有笔记': { text: 'x' }, '新笔记': { text: 'y' } },
    };
    const f = loadFns(['mtkpackImport', 'normQKey'], {
      MTKPACK_KIND: 'monitiku-bankpack',
      state: {
        questions: QUESTIONS, kpNotes: { '已有笔记': { text: '我的' } },
        banks: [], bankId: 'default',
      },
      pickOneFile: async () => ({ text: async () => JSON.stringify(pack) }),
      confirm: () => true,
      toast: () => { },
      DB: { add: async (store, item) => { added.push(item); }, kvSet: async () => { } },
      KBDOCS: {
        read: async n => (n === 'TCP 三次握手笔记' ? '# 已有' : null),
        write: async (n, c) => { wrote.push([n, c]); },
      },
      refreshData: async () => { },
      kbdBuildIndex: async () => { },
      curView: 'dash',
      viewBank: () => { }, viewKbDocs: () => { },
    });
    await f.mtkpackImport();
    expect(added.length).toBe(1);                              // 只有「全新的题目」进来
    expect(added[0].content).toBe('全新的题目');
    expect(wrote.length).toBe(1);
    expect(wrote[0][0]).toBe('TCP 三次握手笔记 (2)');           // 同名不覆盖，加序号
    expect(wrote[0][1]).toBe('# 别人的版本');
  });

  test('mtkpackImport：不是题库包的文件直接拒绝，不写任何数据', async () => {
    const added = [], msgs = [];
    const f = loadFns(['mtkpackImport', 'normQKey'], {
      MTKPACK_KIND: 'monitiku-bankpack',
      state: { questions: [], kpNotes: {}, banks: [], bankId: 'default' },
      pickOneFile: async () => ({ text: async () => JSON.stringify({ kind: 'other', questions: [{}] }) }),
      confirm: () => true, toast: m => msgs.push(m),
      DB: { add: async () => { added.push(1); }, kvSet: async () => { } },
      KBDOCS: { read: async () => null, write: async () => { } },
      refreshData: async () => { }, kbdBuildIndex: async () => { },
      curView: 'dash', viewBank: () => { }, viewKbDocs: () => { },
    });
    await f.mtkpackImport();
    expect(added.length).toBe(0);
    expect(msgs.join('')).toContain('不是「模拟题库」的题库包');
  });
});

describe('Anki 卡片导出', () => {
  test('TSV 结构：Anki 文件头 + 每行 3 列（正面 / 反面 / 标签）', async () => {
    let out = null, name = '';
    const f = loadFns(['ankiExport'], {
      state: { questions: QUESTIONS }, TYPES: { single_choice: '单选题', true_false: '判断题' },
      esc: s => String(s == null ? '' : s), IS_DESKTOP: true,
      saveAs: async (n, c) => { name = n; out = c; },
      downloadBlob: () => { }, toast: () => { },
    });
    await f.ankiExport();
    expect(name).toMatch(/^Anki卡片_\d{4}-\d{2}-\d{2}\.txt$/);
    const lines = out.split('\n');
    expect(lines[0]).toBe('#separator:tab');
    expect(lines[1]).toBe('#html:true');
    expect(lines[2]).toBe('#deck:模拟题库');
    expect(lines[3]).toBe('#tags column:3');
    const rows = lines.slice(4);
    expect(rows.length).toBe(3);
    rows.forEach(r => expect(r.split('\t').length).toBe(3));
    expect(rows[0].split('\t')[0]).toContain('三次握手的第二次报文');
    expect(rows[0].split('\t')[1]).toContain('答案');
    expect(rows[0].split('\t')[2]).toContain('三次握手');       // 知识点进标签列
    expect(rows[0].split('\t')[2]).toContain('单选题');
  });

  test('题干里的制表符 / 换行被清理，不会把列拆坏', async () => {
    let out = null;
    const f = loadFns(['ankiExport'], {
      state: { questions: [{ type: 'single_choice', content: 'A\tB\nC', options: null, answer: 'X', knowledge_point: 'K' }] },
      TYPES: { single_choice: '单选题' }, esc: s => String(s), IS_DESKTOP: true,
      saveAs: async (n, c) => { out = c; }, downloadBlob: () => { }, toast: () => { },
    });
    await f.ankiExport();
    const row = out.split('\n')[4];
    expect(row.split('\t').length).toBe(3);
    expect(row).toContain('A B<br>C');
  });
});
