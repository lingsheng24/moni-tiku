import { loadFns, HTML_PATH } from './extract-html.js';
import fs from 'fs';

const HTML = fs.readFileSync(HTML_PATH, 'utf8');

/* v2.0.0：AI 助教本地检索 + 掌握度模型 */

describe('AI 助教：分词与切块', () => {
  const { askTokens, askSplitBody } = loadFns(['ASK_STOP', 'askTokens', 'askSplitBody']);

  test('中文按二元切分，英文数字单独成词', () => {
    const t = askTokens('货币政策传导');
    expect(t).toContain('货币');
    expect(t).toContain('政策');
    expect(t).toContain('传导');
    expect(askTokens('LPR 改革 2024')).toContain('lpr');
    expect(askTokens('LPR 改革 2024')).toContain('2024');
  });

  test('疑问词被过滤，不参与打分', () => {
    const t = askTokens('什么是货币政策');
    expect(t).not.toContain('什么');
    expect(t).toContain('货币');
  });

  test('空串与单字不炸', () => {
    expect(askTokens('')).toEqual([]);
    expect(askTokens('好').length).toBe(1);
  });

  test('按空行切段，短段合并，长段独立', () => {
    const seg = askSplitBody('第一段内容。\n\n第二段内容。\n\n' + '长'.repeat(400) + '\n\n末段');
    expect(seg.length).toBeGreaterThanOrEqual(2);
    expect(seg[0].text).toContain('第一段');
    expect(seg[0].text).toContain('第二段');            // 两个短段被合并
    expect(seg.every(s => s.text.length <= 400)).toBe(true);
  });

  test('标题井号与强调符号被清掉，正文可读', () => {
    const seg = askSplitBody('## 标题\n\n**重点内容**在这里');
    expect(seg[0].text).not.toContain('#');
    expect(seg[0].text).not.toContain('**');
  });
});

describe('AI 助教：BM25 检索', () => {
  const now = Date.now();
  const kbdIndex = {
    docs: new Map([
      ['货币政策工具', { name: '货币政策工具', body: '公开市场操作是货币政策的主要工具，通过买卖国债调节银行体系流动性。\n\n存款准备金率调整影响货币乘数。', tags: ['宏观'], mtime: now }],
      ['汇率体系', { name: '汇率体系', body: '汇率由外汇市场供求决定，长期看购买力平价。', tags: ['宏观'], mtime: now }],
    ]),
  };
  const state = {
    questions: [{ id: 7, content: '下列哪项属于货币政策工具？', options: ['A.存款准备金', 'B.财政补贴'], answer: 'A', explanation: '存款准备金属于货币政策工具', knowledge_point: '货币政策' }],
    practice: [],
    reviews: [],
  };
  const ctx = {
    kbdIndex,
    kbAllNotes: () => [],
    clipText: (s, n) => String(s || '').slice(0, n),
    state,
    KB_KIND: { kp: { label: '知识点笔记' } },
    kbdBuildIndex: async () => { },
    askCorpus: { chunks: [], inv: new Map(), avgLen: 1, builtAt: 0 },
  };
  const { askEnsureCorpus, askSearch } = loadFns(
    ['ASK_STOP', 'askTokens', 'askSplitBody', 'askEnsureCorpus', 'askSearch'], ctx);

  test('建库覆盖文档、题库两类来源，并带位置信息', async () => {
    const c = await askEnsureCorpus(true);
    expect(c.chunks.length).toBeGreaterThan(2);
    const doc = c.chunks.find(x => x.kind === 'doc');
    expect(doc.doc).toBe('货币政策工具');
    expect(doc.para).toBeGreaterThan(0);
    expect(c.chunks.some(x => x.kind === 'q' && x.qid === 7)).toBe(true);
  });

  test('相关问句命中对应文档，且覆盖率高', async () => {
    const { hits, cover } = await askSearch('公开市场操作 流动性', 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].doc || hits[0].title).toContain('货币政策');
    expect(cover).toBeGreaterThan(0.5);
  });

  test('无关问句覆盖率为 0、无命中（触发联网兜底）', async () => {
    const { hits, cover } = await askSearch('量子纠缠的退相干时间', 5);
    expect(hits.length).toBe(0);
    expect(cover).toBe(0);
  });

  test('同一文档最多贡献 2 个片段，防止长文占满引用', async () => {
    const { hits } = await askSearch('货币政策 工具 流动性 准备金', 6);
    const byDoc = {};
    hits.forEach(h => { if (h.doc) byDoc[h.doc] = (byDoc[h.doc] || 0) + 1; });
    Object.values(byDoc).forEach(n => expect(n).toBeLessThanOrEqual(2));
  });
});

describe('AI 助教：引用与提示词', () => {
  const { askCiteHTML } = loadFns(['askCiteHTML']);

  test('合法编号变成可点击角标，并带上消息索引', () => {
    const out = askCiteHTML('结论一[1]，结论二[2]', 2, 3);
    expect(out).toContain('data-askcite="3:1"');
    expect(out).toContain('data-askcite="3:2"');
  });

  test('越界编号保持原样，不能凭空造引用', () => {
    const out = askCiteHTML('瞎编的[9]', 2, 0);
    expect(out).not.toContain('ask-cite');
    expect(out).toContain('[9]');
  });

  test('提示词强制「只依据资料」，并要求资料不足要说没有', () => {
    expect(HTML).toContain('只依据「参考资料」作答，不使用资料之外的知识');
    expect(HTML).toContain('你的资料里没有相关内容');
  });
});

describe('AI 助教：界面与入口', () => {
  test('知识库板块有 AI 助教入口，路由与板块归属已注册', () => {
    expect(HTML).toContain('data-v="ask"');
    expect(HTML).toContain('AI 助教</span></div>');
    expect(HTML).toContain("ask: 'kb'");
    expect(HTML).toContain('ask: viewAsk');
    expect(HTML).toContain("'dash', 'kbdocs', 'ask', 'kb'");
  });

  test('问答界面具备引用角标、来源卡、存为笔记、联网开关', () => {
    expect(HTML).toContain('class="ask-cite"');
    expect(HTML).toContain('data-asksrc');
    expect(HTML).toContain('askSaveNote');
    expect(HTML).toContain('id="askWebSw"');
    expect(HTML).toContain('askWeb: 1');
  });

  test('点击角标能跳文档并高亮、跳题目详情、跳网页', () => {
    const s = HTML.indexOf('async function askJump');
    const f = HTML.slice(s, s + 900);
    expect(f).toContain("go('kbdocs')");
    expect(f).toContain('kbdOpen(c.doc)');
    expect(f).toContain('viewQuestion(c.qid)');
    expect(f).toContain("window.open(c.url");
    expect(HTML).toContain('function askFlashText');
  });
});

describe('掌握度模型', () => {
  const now = Date.now(), DAY = 86400000;
  const state = {
    questions: [
      { id: 1, knowledge_point: '货币政策' },
      { id: 2, knowledge_point: '货币政策' },
      { id: 3, knowledge_point: '汇率体系' },
      { id: 4, knowledge_point: '国际收支' },
    ],
    practice: [
      { question_id: 1, is_correct: 1, answered_at: now - DAY },
      { question_id: 2, is_correct: 1, answered_at: now - 2 * DAY },
      { question_id: 3, is_correct: 0, answered_at: now - DAY },
      { question_id: 3, is_correct: 0, answered_at: now - 3 * DAY },
    ],
    reviews: [],
  };
  const mk = () => loadFns(
    ['MAS_HALF', 'MAS_WEAK', 'MAS_GOOD', 'masBuild', 'masBand', 'masDist', 'masTodayPlan'],
    { state, splitKP: s => String(s || '').split(/[、,，;；\/|]+/).map(x => x.trim()).filter(Boolean), masCache: { at: 0, map: new Map() }, masLastPlan: [] });

  test('连续答对 → 掌握度高；连续答错 → 掌握度低', () => {
    const { masBuild } = mk();
    const m = masBuild().map;
    expect(m.get('货币政策').score).toBeGreaterThan(0.6);
    expect(m.get('汇率体系').score).toBeLessThan(0.3);
  });

  test('未练过的知识点掌握度为 0，但保留题量信息', () => {
    const { masBuild } = mk();
    const x = masBuild().map.get('国际收支');
    expect(x.n).toBe(0);
    expect(x.qn).toBe(1);
    expect(x.score).toBeCloseTo(0.35, 1);   // 向先验收缩
  });

  test('分档阈值：0.42 以下薄弱，0.7 以上熟练', () => {
    const { masBand } = mk();
    expect(masBand({ n: 0, score: 0 })).toBe('none');
    expect(masBand({ n: 2, score: 0.3 })).toBe('weak');
    expect(masBand({ n: 2, score: 0.55 })).toBe('mid');
    expect(masBand({ n: 2, score: 0.8 })).toBe('good');
  });

  test('分布统计把四档加起来等于知识点总数', () => {
    const { masDist } = mk();
    const d = masDist();
    expect(d.none + d.weak + d.mid + d.good).toBe(d.total);
    expect(d.total).toBe(3);
  });

  test('今日计划把薄弱点排在前面，并给出可执行动作', () => {
    const { masTodayPlan } = mk();
    const plan = masTodayPlan();
    expect(plan.length).toBeGreaterThan(0);
    const weak = plan.find(p => p.cls === 'red');
    expect(weak).toBeTruthy();
    expect(weak.kp).toBe('汇率体系');
    expect(['kp', 'rev']).toContain(weak.act);
  });

  test('首页与统计页都接上了计划/看板', () => {
    expect(HTML).toContain('${masPlanHTML()}');
    expect(HTML).toContain('${masBoardHTML()}');
    expect(HTML).toContain('今日学习计划');
  });
});

describe('掌握度驱动的组卷', () => {
  test('组卷按掌握度分配配额，弱项配额更高，且保留兜底轮转', () => {
    const s = HTML.indexOf('v2.0.0：掌握度配额');
    const f = HTML.slice(s, s + 1200);
    expect(f).toContain('1 + 2 * (1 - sc)');
    expect(f).toContain("quota.set(key, Math.max(1, Math.min(3");
    expect(f).toContain('relax = true');          // 配额不够时放开补齐
    expect(HTML).toContain('cfg.masBalance !== 0');
  });
});
