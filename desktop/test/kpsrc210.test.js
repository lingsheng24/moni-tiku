/**
 * v2.1.0 关系图谱的来源筛选（题库 / 知识库）
 * 覆盖：知识库文档的知识点进图、来源标记、同文档建链、来源筛选函数、工具栏与浮标结构。
 */
import { describe, test, expect } from 'vitest';
const fs = require('fs');
const { loadFns, HTML_PATH } = require('./extract-html.js');

const HTML = fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');

const splitKP = s => String(s || '').split(/[、,，;；\/|]+/).map(x => x.trim()).filter(x => x && x !== '未分类');

function makeGraph(opts = {}) {
  const docs = new Map();
  for (const [name, d] of Object.entries(opts.docs || {})) {
    docs.set(name, { name, fm: { tags: [], kp: [], ...(d.fm || {}) }, links: d.links || [], body: d.body || '' });
  }
  const ctx = {
    state: {
      questions: opts.questions || [],
      practice: [],
      docs: [],
      mistakes: [],
      kpNotes: {},
      kbNotes: [],
    },
    kbdIndex: { docs },
    kbAllNotes: () => opts.notes || [],
    splitKP,
    matchSubject: () => true,
    kpSubject: '',
    sectionOfQuestion: () => '',
    impOf: q => q.imp || 3,
    kpLinkEnabled: () => opts.link !== false,
    kpLinkSecOn: () => false,
    kpLinkQsimOn: () => false,
    kpSimPairs: () => [],
    kpNameSim: () => 0,
  };
  const fns = loadFns(['kbdDocKpNames', 'buildGraph'], ctx);
  return fns;
}

const Q = (id, kp, imp) => ({
  id, content: '题目' + id, type: 'single_choice', difficulty: 'easy',
  knowledge_point: kp, imp: imp || 3,
});

describe('知识库来源进图谱', () => {
  test('文档 front-matter kp: 与正文 [[kp:...]] 都成为节点，且标记为「无题」', () => {
    const { buildGraph } = makeGraph({
      questions: [Q(1, '货币政策')],
      docs: {
        '宏观笔记.md': { fm: { kp: ['货币政策', '汇率'] }, links: [{ target: '利率', isKp: true, alias: '' }] },
      },
    });
    const g = buildGraph();
    const names = g.nodes.map(n => n.name).sort();
    expect(names).toEqual(['利率', '汇率', '货币政策'].sort());
    const cur = g.nodes.find(n => n.name === '货币政策');
    expect(cur.hasQ).toBe(true);
    expect(cur.hasKb).toBe(true);
    expect(cur.kbDocs).toEqual(['宏观笔记.md']);
    const fx = g.nodes.find(n => n.name === '汇率');
    expect(fx.hasQ).toBe(false);
    expect(fx.hasKb).toBe(true);
    expect(fx.imp).toBe(3);                 // 知识库节点按「一般」3 星
    expect(fx.size).toBe(0);
  });

  test('笔记里关联的知识点也进图（没有题、也没有文档时也能上图）', () => {
    const { buildGraph } = makeGraph({
      questions: [Q(1, '货币政策')],
      notes: [{ kps: ['供给弹性'], text: '弹性笔记' }],
    });
    const g = buildGraph();
    const nd = g.nodes.find(n => n.name === '供给弹性');
    expect(nd).toBeTruthy();
    expect(nd.hasQ).toBe(false);
    expect(nd.hasKb).toBe(true);
    expect(nd.kbNotes).toBe(1);
  });

  test('「未分类」不会被知识库笔记带进图谱', () => {
    const { buildGraph } = makeGraph({
      questions: [Q(1, '货币政策')],
      notes: [{ kps: ['未分类'], text: '随手记' }],
    });
    expect(buildGraph().nodes.some(n => n.name === '未分类')).toBe(false);
  });

  test('同一篇文档里的知识点互链，边类型为 kb', () => {
    const { buildGraph } = makeGraph({
      questions: [],
      docs: { 'a.md': { fm: { kp: ['甲', '乙'] }, links: [{ target: '丙', isKp: true }] } },
    });
    const g = buildGraph();
    expect(g.edges.length).toBe(3);         // 甲-乙、甲-丙、乙-丙
    expect(g.edges.every(e => e[3] === 'kb')).toBe(true);
  });

  test('同题共现的优先级高于同文档（一条边只画最强的依据）', () => {
    const { buildGraph } = makeGraph({
      questions: [Q(1, '甲、乙')],
      docs: { 'a.md': { fm: { kp: ['甲', '乙'] } } },
    });
    const g = buildGraph();
    expect(g.edges.length).toBe(1);
    expect(g.edges[0][3]).toBe('co');
  });

  test('双链总开关关掉时，同文档也不建链（但节点仍在）', () => {
    const { buildGraph } = makeGraph({
      questions: [],
      docs: { 'a.md': { fm: { kp: ['甲', '乙'] } } },
      link: false,
    });
    const g = buildGraph();
    expect(g.nodes.length).toBe(2);
    expect(g.edges.length).toBe(0);
  });
});

describe('来源筛选', () => {
  const NODES = [
    { name: 'A', hasQ: true, hasKb: true },
    { name: 'B', hasQ: true, hasKb: false },
    { name: 'C', hasQ: false, hasKb: true },
  ];

  test('kpSrcMatch：题库看 hasQ，知识库看 hasKb', () => {
    const all = loadFns(['kpSrcMatch'], { kpSrcFilter: null });
    expect(NODES.every(n => all.kpSrcMatch(n))).toBe(true);
    const q = loadFns(['kpSrcMatch'], { kpSrcFilter: 'q' });
    expect(q.kpSrcMatch(NODES[0])).toBe(true);
    expect(q.kpSrcMatch(NODES[2])).toBe(false);
    const kb = loadFns(['kpSrcMatch'], { kpSrcFilter: 'kb' });
    expect(kb.kpSrcMatch(NODES[1])).toBe(false);
    expect(kb.kpSrcMatch(NODES[2])).toBe(true);
    expect(kb.kpSrcMatch(null)).toBe(false);
  });

  test('kpSrcCount：按来源统计图上节点数', () => {
    const f = loadFns(['kpSrcCount'], { kpGraph: { nodes: NODES }, kpSrcFilter: null });
    expect(f.kpSrcCount('q')).toBe(2);
    expect(f.kpSrcCount('kb')).toBe(2);
    expect(f.kpSrcCount(null)).toBe(3);
  });

  test('kpSetSrcFilter：设了来源会同步下拉与徽标，再点同一次恢复全部', () => {
    const msgs = [];
    const sync = { select: 0, badge: 0 };
    const f = loadFns(['kpSetSrcFilter', 'kpSrcMatch', 'kpSrcCount', 'KP_SRC_NAME'], {
      kpSrcFilter: null,
      kpGraph: { nodes: NODES },
      toast: m => msgs.push(m),
      kpSyncLegend: () => { },
      kpSyncSrcSelect: () => { sync.select++; },
      kpFoldBadge: () => { sync.badge++; },
      kpDraw: () => { },
    });
    f.kpSetSrcFilter('kb');
    expect(msgs[0]).toContain('知识库');
    expect(msgs[0]).toContain('2');
    expect(sync.select).toBe(1);
    expect(sync.badge).toBe(1);
    f.kpSetSrcFilter('kb');
    expect(msgs[1]).toContain('恢复');
  });

  test('kpNodeVisible 尊重来源筛选（与掌握度/笔记/重要筛选叠加）', () => {
    const f = loadFns(['kpNodeVisible', 'kpSrcMatch'], {
      kpSrcFilter: 'kb',
      kpMasteryMatch: () => true,
      kpImpOnlyOn: () => false,
      kpNoteOnlyOn: () => false,
      kpNoteCount: () => 0,
    });
    expect(f.kpNodeVisible({ name: 'B', hasQ: true, hasKb: false })).toBe(false);
    expect(f.kpNodeVisible({ name: 'C', hasQ: false, hasKb: true })).toBe(true);
  });
});

describe('相关常量与结构', () => {
  test('KP_FILTER_NAME 增加「同文档」，kpKindCount 也统计它', () => {
    expect(HTML).toMatch(/const KP_FILTER_NAME = \{[^}]*kb: '同文档'/);
    const f = loadFns(['kpKindCount'], {});
    expect(f.kpKindCount([{ kind: 'kb' }, { kind: 'kb' }, { kind: 'co' }])).toBe('同题共现 1 · 同文档 2');
  });

  test('来源筛选在科目下拉里，不是独立图例（v2.1.1）', () => {
    expect(HTML).toMatch(/<optgroup label="按来源只看">/);
    expect(HTML).toMatch(/只看题库知识点/);
    expect(HTML).toMatch(/只看知识库知识点/);
    expect(HTML).toMatch(/id="kpSrcChip"/);          // 筛选浮标仍在
    expect(HTML).not.toMatch(/bindLegend\(\$\('#kpSrc'\)/);
  });

  test('kbdDocKpNames 同时收 front-matter 与 [[kp:]]，去重去空', () => {
    const f = loadFns(['kbdDocKpNames'], {});
    const set = f.kbdDocKpNames({
      fm: { kp: ['甲', ' 乙 ', '甲'] },
      links: [{ target: '乙', isKp: true }, { target: '丙', isKp: true }, { target: '普通文档', isKp: false }],
    });
    expect([...set].sort()).toEqual(['丙', '乙', '甲'].sort());
  });
});

describe('图谱工具栏折叠（v2.1.1）', () => {
  test('除掌握度外，其余筛选都收进折叠面板', () => {
    const toolbar = HTML.slice(HTML.indexOf('<div class="row kp-toolbar"'), HTML.indexOf('<div id="kpWrap">'));
    expect(toolbar).toMatch(/id="kpFoldPanel"/);
    // 掌握度留在工具栏常显
    const outside = toolbar.slice(0, toolbar.indexOf('id="kpFoldPanel"'));
    expect(outside).toMatch(/id="kpMastery"/);
    expect(outside).not.toMatch(/id="kpLinkChk"/);
    expect(outside).not.toMatch(/id="kpNoteChk"/);
    expect(outside).not.toMatch(/id="kpImpChk"/);
    expect(outside).not.toMatch(/id="kpLegend"/);
    // 面板里齐全
    const panel = toolbar.slice(toolbar.indexOf('id="kpFoldPanel"'));
    ['kpLinkChk', 'kpNoteChk', 'kpImpChk', 'kpLegend'].forEach(id => expect(panel).toContain('id="' + id + '"'));
  });

  test('折叠默认收起，展开态持久化到 settings.kpFilterFold', () => {
    const f = loadFns(['kpFoldCollapsed'], { state: { settings: {} } });
    expect(f.kpFoldCollapsed()).toBe(true);                       // 未设置 = 收起
    const g = loadFns(['kpFoldCollapsed'], { state: { settings: { kpFilterFold: 0 } } });
    expect(g.kpFoldCollapsed()).toBe(false);
  });

  test('徽标只统计面板内的生效筛选（双链关闭 / 有笔记 / 重要 / 关联类型）', () => {
    const f = loadFns(['kpFoldActiveN'], {
      kpLinkEnabled: () => true,
      kpNoteOnlyOn: () => false,
      kpImpOnlyOn: () => false,
      kpEdgeFilter: null,
    });
    expect(f.kpFoldActiveN()).toBe(0);
    const g = loadFns(['kpFoldActiveN'], {
      kpLinkEnabled: () => false,
      kpNoteOnlyOn: () => true,
      kpImpOnlyOn: () => true,
      kpEdgeFilter: 'kb',
    });
    expect(g.kpFoldActiveN()).toBe(4);
  });

  test('科目下拉：来源项用特殊值，选中态跟随 kpSrcFilter', () => {
    const ctx = {
      kpSrcFilter: 'kb',
      kpSubject: '',
      subjects: [{ id: 's1', name: '宏观' }],
      NO_SUBJ: '__none__',
      esc: s => String(s),
      kpSrcCount: k => (k === 'q' ? 5 : 3),
      KP_SRC_Q: '__kp_src_q',
      KP_SRC_KB: '__kp_src_kb',
    };
    const f = loadFns(['kpSubjectOptionsHTML'], ctx);
    const html = f.kpSubjectOptionsHTML();
    expect(html).toContain('value="__kp_src_q"');
    expect(html).toContain('value="__kp_src_kb" selected');
    expect(html).toContain('只看题库知识点（5）');
    expect(html).toContain('只看知识库知识点（3）');
  });
});
