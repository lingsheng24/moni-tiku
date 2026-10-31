import { loadFns } from './extract-html.js';

/* v1.40.0：补核心逻辑测试——SM-2 复习调度 / 组卷 / 错题流转
 * 均从单文件 HTML 提取真实实现，依赖以桩注入。 */

/* ---------------- SM-2 记忆调度 ---------------- */
describe('复习调度：sm2 / cardState', () => {
  const { sm2, cardState, DAY_MS } = loadFns(['sm2', 'cardState', 'DAY_MS']);
  const DAY = DAY_MS;

  it('cardState：新卡 / 学习中 / 年轻 / 成熟', () => {
    expect(cardState({ reps: 0, lapses: 0 })).toBe('fresh');
    expect(cardState({ reps: 1, interval: 0.5 })).toBe('learning');
    expect(cardState({ reps: 2, interval: 7 })).toBe('young');
    expect(cardState({ reps: 5, interval: 21 })).toBe('mature');
  });

  it('忘记（grade 1）：reps 归零、lapses+1、ease-0.2、10 分钟后重现', () => {
    const c = { ease: 2.5, reps: 4, interval: 20, lapses: 0, hist: [] };
    const n = sm2(c, 1);
    expect(n.reps).toBe(0);
    expect(n.lapses).toBe(1);
    expect(n.ease).toBe(2.3);
    expect(n.interval).toBeCloseTo(10 / 1440, 6);
    expect(n.state).toBe('learning');
    expect(n.due).toBeLessThanOrEqual(Date.now() + 11 * 60 * 1000);
  });

  it('ease 下限 1.3：连续忘记不会跌破', () => {
    let c = { ease: 1.35, reps: 2, interval: 3, lapses: 1 };
    c = sm2(c, 1);
    expect(c.ease).toBe(1.3);
  });

  it('新卡首次复习：grade 3 → 1 天；grade 4 → 4 天', () => {
    const g3 = sm2({ ease: 2.5, reps: 0, lapses: 0 }, 3);
    expect(g3.reps).toBe(1);
    expect(g3.interval).toBe(1);
    const g4 = sm2({ ease: 2.5, reps: 0, lapses: 0 }, 4);
    expect(g4.interval).toBe(4);
  });

  it('第二次复习：grade 2 → 2 天；grade 3 → 3 天；grade 4 → 8 天', () => {
    const mk = (g) => sm2(sm2({ ease: 2.5, reps: 0, lapses: 0 }, g), g).interval;
    expect(mk(2)).toBe(2);
    expect(mk(3)).toBe(3);
    expect(mk(4)).toBe(8);
  });

  it('ease 更新公式：良好(3)不变、简单(4)+0.1、困难(2)-0.14，且上限 2.8', () => {
    expect(sm2({ ease: 2.5, reps: 3, interval: 10 }, 3).ease).toBe(2.5);
    expect(sm2({ ease: 2.5, reps: 3, interval: 10 }, 4).ease).toBe(2.6);
    expect(sm2({ ease: 2.5, reps: 3, interval: 10 }, 2).ease).toBe(2.36);
    expect(sm2({ ease: 2.75, reps: 3, interval: 10 }, 4).ease).toBe(2.8);
  });

  it('成熟卡间隔 = 新 ease × 旧间隔（困难收缩 / 简单放大），注意 ease 先更新再算间隔', () => {
    const base = { ease: 2.5, reps: 5, interval: 20 };
    expect(sm2(base, 3).interval).toBe(50);       // ease 不变 2.5 → 20 × 2.5
    expect(sm2(base, 2).interval).toBe(28);       // ease → 2.36 → 20 × 2.36 × 0.6 = 28.32
    expect(sm2(base, 4).interval).toBe(68);       // ease → 2.6 → 20 × 2.6 × 1.3 = 67.6
  });

  it('间隔上限 3 年（1095 天）', () => {
    const n = sm2({ ease: 2.8, reps: 9, interval: 900 }, 4);
    expect(n.interval).toBe(1095);
  });

  it('hist 记录评分历史并截断到最近 60 条', () => {
    let c = { ease: 2.5, reps: 0, lapses: 0, hist: Array.from({ length: 60 }, (_, i) => ({ at: i, g: 3, i: 1 })) };
    const n = sm2(c, 3);
    expect(n.hist.length).toBe(60);
    expect(n.hist[59].g).toBe(3);
  });

  it('due = now + interval 天', () => {
    const before = Date.now();
    const n = sm2({ ease: 2.5, reps: 2, interval: 5 }, 3);
    expect(n.due).toBeGreaterThanOrEqual(before + 13 * DAY);
    expect(n.due).toBeLessThanOrEqual(Date.now() + 13 * DAY + 50);
  });
});

/* ---------------- 今日统计 / 预测 / 队列 ---------------- */
describe('复习统计与队列：revTodayStat / revForecast / buildRevQueue', () => {
  const base = loadFns(['todayStart', 'DAY_MS', 'cardState', 'isFreshCard', 'shuffle']);
  const { todayStart, DAY_MS, isFreshCard } = base;
  const t0 = todayStart();
  const H = 3600 * 1000;

  it('revTodayStat：只统计今天的历史，区分答对/忘记与新卡', () => {
    const state = { reviews: [
      { hist: [{ at: t0 + 1 * H, g: 3, i: 1 }, { at: t0 + 2 * H, g: 1, i: 0.007 }] },          // 今天 2 次：1 对 1 忘
      { hist: [{ at: t0 + 1 * H, g: 4, i: 4 }] },                                               // 今天首答 → 新卡
      { hist: [{ at: t0 - DAY_MS, g: 3, i: 3 }] },                                              // 只有昨天 → 全不计
      { hist: [{ at: t0 - DAY_MS, g: 3, i: 3 }, { at: t0 + 3 * H, g: 3, i: 3 }] },              // 今天续答 → 计但非新卡
    ] };
    const { revTodayStat: f } = loadFns(['revTodayStat'], { state, todayStart, cardState: base.cardState, isFreshCard: base.isFreshCard });
    const r = f();
    expect(r.done).toBe(4);          // 卡1两次 + 卡2一次 + 卡4一次
    expect(r.again).toBe(1);
    expect(r.ok).toBe(3);
    expect(r.fresh).toBe(2);         // 卡1、卡2 都是今天首次学习（首答在今天的都算新卡）
    expect(r.keep).toBe(75);         // 3/4 = 75%
  });

  it('revForecast：按到期日分桶，新卡不计入', () => {
    const state = { reviews: [
      { due: t0 + 2 * H, reps: 1, interval: 3 },                 // 今天
      { due: t0 + DAY_MS + 2 * H, reps: 1, interval: 3 },        // 明天
      { due: t0 + 3 * DAY_MS + 2 * H, reps: 1, interval: 3 },    // 3 天后
      { due: t0 + DAY_MS, reps: 0, interval: 0 },                // 新卡 → 不计
      { due: t0 - DAY_MS, reps: 1, interval: 3 },                // 逾期 → 归入第 0 桶
    ] };
    const { revForecast: f } = loadFns(['revForecast'], { state, todayStart, DAY_MS, isFreshCard });
    const b = f(14);
    expect(b.length).toBe(14);
    expect(b[0].n).toBe(2);   // 今天 + 逾期
    expect(b[1].n).toBe(1);
    expect(b[3].n).toBe(1);
  });

  it('buildRevQueue：逾期卡优先，新卡随机补位，受每日上限约束', () => {
    const state = {
      settings: { revLimit: 100, revNewLimit: 2 },
      reviews: [
        { due: t0 - DAY_MS, reps: 2, interval: 3 },
        { due: t0 + 1 * H, reps: 2, interval: 3 },
        { reps: 0, interval: 0 }, { reps: 0, interval: 0 }, { reps: 0, interval: 0 },   // 3 张新卡
      ],
    };
    const deps = loadFns(['todayStart', 'cardState', 'isFreshCard', 'shuffle']);
    const { revTodayStat } = loadFns(['revTodayStat'], { state, todayStart, cardState: deps.cardState, isFreshCard: deps.isFreshCard });
    const { buildRevQueue: f } = loadFns(['buildRevQueue'], { state, ...deps, revTodayStat });
    const q = f();
    expect(q.due).toBe(2);
    expect(q.fresh).toBe(2);                       // revNewLimit=2，只放 2 张新卡
    expect(q.list.length).toBe(4);
    expect(q.list.slice(0, 2).every(c => !isFreshCard(c))).toBe(true);   // 前 2 张是复习卡
    expect(q.reviewLeft).toBe(100);   // 队列里的卡都无 hist，今日 done=0
    expect(q.newLeft).toBe(2);        // 新卡上限 2，今日 fresh=0 → 剩 2
  });
});

/* ---------------- 组卷 buildPaper ---------------- */
describe('组卷：buildPaper', () => {
  const examCfgScore = { single_choice: 2, multiple_choice: 4, true_false: 2, fill_blank: 3, short_answer: 6 };
  const TYPES = { essay_custom: '论述题' };
  /* v1.49.0：paperScoreOf 改为调 typeScoreOf（按题型取值），测试用桩保持原分值语义 */
  const typeScoreOf = t => examCfgScore[t] ?? (t === 'essay_custom' ? 5 : 0);
  const { buildPaper } = loadFns(['buildPaper', 'paperScoreOf', 'PAPER_ORDER', 'GROUP_TITLE'],
    { typeScoreOf, TYPES, isCustomType: t => t === 'essay_custom' });

  const qs = [
    { id: 'q1', type: 'fill_blank', answer: 'TCP' },
    { id: 'q2', type: 'single_choice', answer: 'A' },
    { id: 'q3', type: 'single_choice', answer: 'B' },
    { id: 'q4', type: 'short_answer', answer: '略' },
    { id: 'q5', type: 'essay_custom', answer: '自由发挥' },
  ];

  it('按固定题型顺序分组（单选→填空→简答→自定义），同题型连续编号', () => {
    const p = buildPaper(qs, { paperName: '期末卷', subjectName: '计算机网络', minutes: 90 });
    expect(p.groups.map(g => g.type)).toEqual(['single_choice', 'fill_blank', 'short_answer', 'essay_custom']);
    expect(p.groups[0].items.map(i => i.no)).toEqual([1, 2]);
    expect(p.groups[1].items[0].no).toBe(3);
  });

  it('总分 = 各题分数之和（含自定义题 5 分兜底）', () => {
    const p = buildPaper(qs, {});
    // 2×2 + 3 + 6 + 5 = 18
    expect(p.total).toBe(18);
  });

  it('试卷元信息：卷名 / 科目 / 时长 / 题数', () => {
    const p = buildPaper(qs, { paperName: '期末卷', subjectName: '计算机网络', minutes: 90 });
    expect(p.name).toBe('期末卷');
    expect(p.subject).toBe('计算机网络');
    expect(p.duration).toBe(90);
    expect(p.count).toBe(5);
  });

  it('空列表：groups 为空、total 0', () => {
    const p = buildPaper([], {});
    expect(p.groups).toEqual([]);
    expect(p.total).toBe(0);
    expect(p.count).toBe(0);
  });
});

/* ---------------- 错题流转：finishSubmit ---------------- */
describe('错题流转：finishSubmit', () => {
  function mkCtx({ autoRemove = true, existing = [] } = {}) {
    const calls = { add: [], del: [], practice: [] };
    const state = { mistakes: existing, settings: { autoRemove } };
    const quiz = { correct: 0 };
    const DB = {
      add: async (store, item) => { calls[store === 'practice' ? 'practice' : 'add'].push(item); },
      del: async (store, id) => { calls.del.push(id); },
    };
    const deps = { quiz, state, DB, autoEnqueueIds: async () => {}, refreshData: async () => {}, renderQuiz: () => {} };
    const { finishSubmit } = loadFns(['finishSubmit'], deps);
    return { finishSubmit, calls, state, quiz };
  }
  const Q = { id: 'q9', content: 'TCP 属于哪一层？', answer: '传输层', type: 'fill_blank', difficulty: '中' };

  it('答错且错题本没有 → 新增错题记录（含题干/题型/难度快照）', async () => {
    const { finishSubmit, calls } = mkCtx();
    await finishSubmit(Q, { correct: false, user: '网络层' });
    expect(calls.add.length).toBe(1);
    expect(calls.add[0]).toMatchObject({
      question_id: 'q9', user_answer: '网络层', correct_answer: '传输层',
      question_content: 'TCP 属于哪一层？', type: 'fill_blank', difficulty: '中',
    });
    expect(calls.practice[0].is_correct).toBe(0);
  });

  it('答错但已在错题本 → 不重复添加', async () => {
    const { finishSubmit, calls } = mkCtx({ existing: [{ id: 'm1', question_id: 'q9' }] });
    await finishSubmit(Q, { correct: false, user: 'x' });
    expect(calls.add.length).toBe(0);
  });

  it('答对 + autoRemove 开 → 自动移出错题本并标记 mastered', async () => {
    const { finishSubmit, calls } = mkCtx({ autoRemove: true, existing: [{ id: 'm1', question_id: 'q9' }, { id: 'm2', question_id: 'q9' }] });
    const saved = { correct: true, user: '传输层' };
    await finishSubmit(Q, saved);
    expect(calls.del.sort()).toEqual(['m1', 'm2']);
    expect(saved.mastered).toBe(true);
    expect(calls.practice[0].is_correct).toBe(1);
  });

  it('答对 + autoRemove 关 → 不动错题本', async () => {
    const { finishSubmit, calls } = mkCtx({ autoRemove: false, existing: [{ id: 'm1', question_id: 'q9' }] });
    const saved = { correct: true, user: '传输层' };
    await finishSubmit(Q, saved);
    expect(calls.del.length).toBe(0);
    expect(saved.mastered).toBeUndefined();
  });

  it('答对且错题本无此题 → 不触发删除', async () => {
    const { finishSubmit, calls } = mkCtx();
    await finishSubmit(Q, { correct: true, user: '传输层' });
    expect(calls.del.length).toBe(0);
  });
});
