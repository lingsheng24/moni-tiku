import { loadFns } from './extract-html.js';

/* 从单文件 HTML 中提取真实实现进行测试（依赖以桩注入） */

describe('判分：normAns / tfBool / gradeObjective', () => {
  const { normAns, tfBool, gradeObjective } = loadFns(['normAns', 'tfBool', 'gradeObjective']);

  it('normAns：去空白标点、全角转半角、统一大写', () => {
    expect(normAns(' a ，。、；')).toBe('A');
    expect(normAns('Ａ')).toBe('A');
    expect(normAns('c a b')).toBe('CAB');
  });

  it('tfBool：中文/英文/符号都能识别', () => {
    expect(tfBool('对')).toBe(true);
    expect(tfBool('正确')).toBe(true);
    expect(tfBool('T')).toBe(true);
    expect(tfBool('√')).toBe(true);
    expect(tfBool('错误')).toBe(false);
    expect(tfBool('×')).toBe(false);
    expect(tfBool('不知道')).toBe(null);
  });

  it('单选：大小写不敏感', () => {
    const q = { type: 'single_choice', answer: 'A' };
    expect(gradeObjective(q, 'a')).toBe(true);
    expect(gradeObjective(q, 'B')).toBe(false);
  });

  it('多选：乱序相等即正确', () => {
    const q = { type: 'multiple_choice', answer: 'ABC' };
    expect(gradeObjective(q, 'cab')).toBe(true);
    expect(gradeObjective(q, 'AB')).toBe(false);
    expect(gradeObjective(q, '')).toBe(false);
  });

  it('判断：「对」≈「正确」，「错」≈「错误」', () => {
    expect(gradeObjective({ type: 'true_false', answer: '正确' }, '对')).toBe(true);
    expect(gradeObjective({ type: 'true_false', answer: '正确' }, '错')).toBe(false);
    expect(gradeObjective({ type: 'true_false', answer: '错误' }, 'F')).toBe(true);
  });
});

describe('文本清洗：sanitizeText', () => {
  const { sanitizeText } = loadFns(['BAD_CHAR_RE', 'sanitizeText']);

  it('去除 U+FFFD 乱码字符', () => {
    expect(sanitizeText('ab\uFFFDcd\uFFFE')).toBe('abcd');
  });
  it('压缩 3+ 连续换行为 2 个', () => {
    expect(sanitizeText('a\n\n\n\nb')).toBe('a\n\nb');
  });
  it('CRLF 归一为 LF、去行尾空格、首尾 trim', () => {
    expect(sanitizeText('  a \r\nb  ')).toBe('a\nb');
  });
});

describe('parseJSON：从散文中提取 JSON', () => {
  const { parseJSON } = loadFns(['parseJSON']);

  it('提取前后带文字的 JSON 对象', () => {
    expect(parseJSON('好的，以下是结果：{"a":1,"b":[2]} 希望对你有帮助')).toEqual({ a: 1, b: [2] });
  });
  it('没有任何 JSON 时抛错', () => {
    expect(() => parseJSON('完全没有结构化内容')).toThrow('无法解析');
  });
});

describe('间隔复习：cardState / sm2', () => {
  const { cardState, sm2 } = loadFns(['DAY_MS', 'cardState', 'sm2']);

  it('cardState 四态划分（21 天为 mature 界）', () => {
    expect(cardState({})).toBe('fresh');
    expect(cardState({ reps: 1, interval: 0.5 })).toBe('learning');
    expect(cardState({ reps: 2, interval: 20 })).toBe('young');
    expect(cardState({ reps: 3, interval: 21 })).toBe('mature');
  });

  it('grade=1（忘记）：lapses+1、reps 归零、10 分钟后重现、ease-0.2', () => {
    const r = sm2({ ease: 2.5, reps: 3, lapses: 0, interval: 10 }, 1);
    expect(r.lapses).toBe(1);
    expect(r.reps).toBe(0);
    expect(r.interval).toBeCloseTo(10 / 1440, 6);
    expect(r.ease).toBeCloseTo(2.3, 5);
  });

  it('grade=3 首答间隔 1 天；grade=4 首答 4 天、二答 8 天', () => {
    const r3 = sm2({}, 3);
    expect(r3.reps).toBe(1);
    expect(r3.interval).toBe(1);
    const r4a = sm2({}, 4);
    expect(r4a.interval).toBe(4);
    const r4b = sm2(r4a, 4);
    expect(r4b.reps).toBe(2);
    expect(r4b.interval).toBe(8);
  });

  it('ease 钳制在 1.3 ~ 2.8', () => {
    expect(sm2({ ease: 1.3, reps: 1, interval: 1 }, 1).ease).toBe(1.3);
    expect(sm2({ ease: 2.8, reps: 1, interval: 1 }, 4).ease).toBe(2.8);
  });

  it('hist 追加评分记录，最多保留 60 条', () => {
    const card = { reps: 5, interval: 10, hist: Array.from({ length: 60 }, (_, i) => ({ at: i, g: 3, i: 1 })) };
    const r = sm2(card, 3);
    expect(r.hist.length).toBe(60);
    expect(r.hist[r.hist.length - 1].g).toBe(3);
  });
});

describe('组卷：pickExamItems / examTotalScore', () => {
  const state = {
    questions: [
      { id: 1, document_id: 1, type: 'single_choice', difficulty: 'easy', knowledge_point: '数学、加法' },
      { id: 2, document_id: 1, type: 'multiple_choice', difficulty: 'hard', knowledge_point: '数学' },
      { id: 3, document_id: 2, type: 'single_choice', difficulty: 'easy', knowledge_point: '语文' },
    ],
  };
  // v1.29.0：组卷加了去重与知识点均衡，依赖切词与若干常量
  const pickDeps = {
    state, matchSubject: () => true,
    examPickCache: { key: '', at: 0, res: null },
  };
  const PICK_FNS = ['KP_STOP_CH', 'KP_STOP_W', 'kpTokenize', 'splitKP', 'shuffle',
    'EXAM_DUP_SIM', 'EXAM_DUP_MIN_SHARED', 'EXAM_PICK_TTL',
    'examNormStem', 'examStemTokens', 'examQuality', 'examSeenMap', 'examDedupe', 'examPick', 'examPickCached', 'pickExamItems'];
  const { pickExamItems } = loadFns(PICK_FNS, pickDeps);

  it('按文档过滤（docId 为字符串比较）', () => {
    const r = pickExamItems({ docId: '1', count: 10 });
    expect(r.map(q => q.id).sort()).toEqual([1, 2]);
  });
  it('按题型与难度过滤', () => {
    expect(pickExamItems({ types: new Set(['single_choice']), count: 10 }).map(q => q.id).sort()).toEqual([1, 3]);
    expect(pickExamItems({ diffs: new Set(['easy']), count: 10 }).map(q => q.id).sort()).toEqual([1, 3]);
  });
  it('按知识点过滤（知识点串会被切分匹配）', () => {
    expect(pickExamItems({ kp: '数学', count: 10 }).map(q => q.id).sort()).toEqual([1, 2]);
  });
  it('count 限制返回数量', () => {
    expect(pickExamItems({ count: 1 }).length).toBe(1);
    expect(pickExamItems({ count: 99 }).length).toBe(3);
  });

  it('examTotalScore：按题型分值求和，自定义题型默认 5 分', () => {
    const { examTotalScore } = loadFns(['examTotalScore'], {
      /* v1.49.0：分值来源改为 typeScoreOf（按题型持久化配置），此处用桩等价原 examCfgScore */
      typeScoreOf: t => ({ single_choice: 2, multiple_choice: 5 })[t] ?? (t.startsWith('custom_') ? 5 : 0),
      isCustomType: t => t.startsWith('custom_'),
    });
    const items = [{ type: 'single_choice' }, { type: 'multiple_choice' }, { type: 'custom_x' }, { type: 'unknown' }];
    expect(examTotalScore(items)).toBe(2 + 5 + 5 + 0);
  });
});

describe('组卷去重：examDedupe / examPick（v1.29.0）', () => {
  const DEDUP_FNS = ['KP_STOP_CH', 'KP_STOP_W', 'kpTokenize', 'splitKP', 'shuffle',
    'EXAM_DUP_SIM', 'EXAM_DUP_MIN_SHARED', 'EXAM_PICK_TTL',
    'examNormStem', 'examStemTokens', 'examQuality', 'examSeenMap', 'examDedupe', 'examPick', 'examPickCached', 'pickExamItems'];
  const mk = qs => {
    const state = { questions: qs };
    return { state, ...loadFns(DEDUP_FNS, { state, matchSubject: () => true, examPickCache: { key: '', at: 0, res: null } }) };
  };

  it('题干归一化：空白、标点、全角半角都不影响判定', () => {
    const { examNormStem } = mk([]);
    expect(examNormStem('关于（甲）的说法，下列 正确的是？')).toBe(examNormStem('关于(甲)的说法下列正确的是'));
  });

  it('一字不差的重复只留一道，且留有解析的那道', () => {
    const qs = [
      { id: 1, content: '采矿权出让应当采用招标拍卖挂牌方式。', explanation: '' },
      { id: 2, content: '采矿权出让应当采用招标拍卖挂牌方式', explanation: '解析：依据矿产资源法第 X 条。' },
      { id: 3, content: '采矿权出让应当采用招标拍卖挂牌方式！' },
    ];
    const { examDedupe } = mk(qs);
    const r = examDedupe(qs);
    expect(r.kept.length).toBe(1);
    expect(r.kept[0].id).toBe(2);
    expect(r.droppedExact.length).toBe(2);
  });

  it('换说法的近似题合并成一道', () => {
    const qs = [
      { id: 1, content: '根据矿产资源法的规定，关于采矿权出让方式的说法，下列正确的是？' },
      { id: 2, content: '依据矿产资源法规定，下列关于采矿权出让方式的表述，哪一项正确？' },
      { id: 3, content: '矿山企业必须对从业人员进行安全生产教育培训，未经培训不得上岗作业。' },
      { id: 4, content: '地质灾害危险性评估应当在建设项目可行性研究阶段完成。' },
    ];
    const { examDedupe } = mk(qs);
    const r = examDedupe(qs);
    expect(r.kept.length).toBe(3);
    expect(r.droppedNear.length).toBe(1);
  });

  it('同知识点不同考点的题不会被误删', () => {
    const qs = [
      { id: 1, content: '采矿权出让方式包括招标、拍卖、挂牌与协议出让，协议出让适用于哪些情形？' },
      { id: 2, content: '采矿权出让收益应当如何缴纳，分期缴纳的期限如何确定？' },
    ];
    const { examDedupe } = mk(qs);
    expect(examDedupe(qs).kept.length).toBe(2);
  });

  it('按知识点轮转：题数够时覆盖尽量多的知识点', () => {
    const STEMS = [
      '采矿权出让应当采用招标拍卖挂牌方式，具体程序由管理机关确定。',
      '采矿权转让须经管理机关批准，转让合同自批准之日起生效。',
      '探矿权人完成最低勘查投入的，可以申请探矿权保留并办理登记。',
      '采矿许可证有效期届满需要继续采矿的，应当在届满前申请延续登记。',
      '未取得采矿许可证擅自采矿的，责令停止开采、赔偿损失并处罚款。',
      '建设项目压覆重要矿产资源的，建设单位应当与矿业权人协商补偿。',
      '矿山企业应当对从业人员进行安全生产教育培训并建立培训档案。',
      '地质灾害危险性评估应当在建设项目可行性研究阶段完成。',
    ];
    const qs = STEMS.map((s, i) => ({ id: i + 1, content: s, knowledge_point: '知识点' + (i % 4) }));
    const { examPick } = mk(qs);
    const r = examPick({ count: 4 });
    expect(r.items.length).toBe(4);
    expect(new Set(r.items.map(q => q.knowledge_point)).size).toBe(4);
  });

  it('不够时用近似题补足，并标记 approx', () => {
    const qs = [
      { id: 1, content: '根据矿产资源法的规定，关于采矿权出让方式的说法，下列正确的是？' },
      { id: 2, content: '依据矿产资源法规定，下列关于采矿权出让方式的表述，哪一项正确？' },
      { id: 3, content: '矿产资源属于国家所有，由国务院行使国家对矿产资源的所有权。' },
    ];
    const { examPick } = mk(qs);
    const r = examPick({ count: 3 });
    expect(r.items.length).toBe(3);
    expect(r.stats.approx).toBe(1);
  });
});

describe('去重：dedupQuestions', () => {
  function makeCtx(questions, mistakes, confirmRet) {
    const deleted = [];
    const toasts = [];
    return {
      deleted, toasts,
      ctx: {
        state: { questions, mistakes },
        DB: { del: async (store, id) => { deleted.push([store, id]); } },
        confirm: () => confirmRet,
        toast: (msg) => { toasts.push(msg); },
        refreshData: async () => { },
      },
    };
  }
  // state.questions 按 created_at 倒序（同 refreshData），首次出现 = 最新一条
  const qs = () => [
    { id: 3, content: '题一', answer: 'A', created_at: 300 },
    { id: 2, content: '题一', answer: 'a', created_at: 200 },   // 与 id3 同 key（大小写不敏感）
    { id: 1, content: '题二', answer: 'B', created_at: 100 },
  ];

  it('保留最新一条，删除旧重复题并清理其关联错题', async () => {
    const { deleted, ctx } = makeCtx(qs(), [{ id: 10, question_id: 2 }], true);
    const { dedupQuestions } = loadFns(['dedupQuestions'], ctx);
    await dedupQuestions();
    expect(deleted).toEqual([['questions', 2], ['mistakes', 10]]);
  });

  it('用户取消确认 → 不删任何数据', async () => {
    const { deleted, ctx } = makeCtx(qs(), [], false);
    const { dedupQuestions } = loadFns(['dedupQuestions'], ctx);
    await dedupQuestions();
    expect(deleted).toEqual([]);
  });

  it('无重复 → 提示且不调用删除', async () => {
    const { deleted, toasts, ctx } = makeCtx([{ id: 1, content: 'A', answer: '1' }], [], true);
    const { dedupQuestions } = loadFns(['dedupQuestions'], ctx);
    await dedupQuestions();
    expect(deleted).toEqual([]);
    expect(toasts[0]).toContain('没有发现重复');
  });
});
