/* v1.42.1：判分链路加固（超时 / 熔断 / 写库失败不阻塞）
 * 背景：AI 判分接口或数据写入卡住时，旧版按钮永久停在「判分中…」，一场考试/复习做不完。
 */
const { loadFns } = require('./extract-html');
/* describe/it/expect 由 vitest 全局注入 */

describe('withTimeoutP：硬超时兜底', () => {
  const { withTimeoutP } = loadFns(['withTimeoutP']);

  it('任务超时返回 fallback', async () => {
    const t0 = Date.now();
    const r = await withTimeoutP(new Promise(() => { }), 60, 'FB');
    expect(r).toBe('FB');
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('任务先完成返回真实结果', async () => {
    const r = await withTimeoutP(Promise.resolve('OK'), 1000, 'FB');
    expect(r).toBe('OK');
  });

  it('任务抛错照常向上传递（不被超时吞掉）', async () => {
    await expect(withTimeoutP(Promise.reject(new Error('boom')), 1000, 'FB')).rejects.toThrow('boom');
  });

  it('同步值也能被包裹', async () => {
    expect(await withTimeoutP(42, 1000, 'FB')).toBe(42);
  });
});

describe('dbWrite：数据写入卡住时不拖死界面', () => {
  const DB_TIMEOUT = Symbol('db-timeout');
  it('写库超时返回超时标记', async () => {
    const { dbWrite } = loadFns(['dbWrite'], {
      DB: { add: () => new Promise(() => { }) }, DB_TIMEOUT, withTimeoutP: loadFns(['withTimeoutP']).withTimeoutP,
    });
    expect(await dbWrite('practice', {}, 60)).toBe(DB_TIMEOUT);
  });

  it('正常写入返回主键', async () => {
    const { dbWrite } = loadFns(['dbWrite'], {
      DB: { add: async () => 17 }, DB_TIMEOUT, withTimeoutP: loadFns(['withTimeoutP']).withTimeoutP,
    });
    expect(await dbWrite('practice', {}, 500)).toBe(17);
  });
});

describe('gradeSubjective：自评 / 熔断 / 超时降级', () => {
  const baseCtx = () => ({
    state: { settings: { grading: 'ai' } },
    chat: async () => '{"correct":true,"reason":"ok"}',
    parseJSON: t => JSON.parse(t),
    toast: () => { },
    TYPES: { short_answer: '简答题' },
    AI_GRADE_TIMEOUT_MS: 80,
    AI_GRADE_COOLDOWN_MS: 5 * 60000,
    aiGradeDownUntil: 0,
  });

  it('设置为自评时直接返回 null（不调 AI）', async () => {
    const ctx = baseCtx();
    ctx.state.settings.grading = 'self';
    let called = false;
    ctx.chat = async () => { called = true; return '{}'; };
    const { gradeSubjective } = loadFns(['withTimeoutP', 'gradeSubjective'], ctx);
    const r = await gradeSubjective({ type: 'short_answer', answer: 'A' }, 'A');
    expect(r.correct).toBeNull();
    expect(called).toBe(false);
  });

  it('AI 正常返回：解析出 correct 与点评', async () => {
    const { gradeSubjective } = loadFns(['withTimeoutP', 'gradeSubjective'], baseCtx());
    const r = await gradeSubjective({ type: 'short_answer', answer: 'A' }, 'A');
    expect(r.correct).toBe(true);
    expect(r.aiNote).toBe('ok');
  });

  it('AI 卡住：超时后转自评，不再无限等待', async () => {
    const ctx = baseCtx();
    ctx.chat = () => new Promise(() => { });
    const { gradeSubjective } = loadFns(['withTimeoutP', 'gradeSubjective'], ctx);
    const t0 = Date.now();
    const r = await gradeSubjective({ type: 'short_answer', answer: 'A' }, 'A');
    expect(r.correct).toBeNull();
    expect(r.timeout).toBe(true);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('AI 出错：转自评并给出错误标记', async () => {
    const ctx = baseCtx();
    ctx.chat = async () => { throw new Error('401 未授权'); };
    const { gradeSubjective } = loadFns(['withTimeoutP', 'gradeSubjective'], ctx);
    const r = await gradeSubjective({ type: 'short_answer', answer: 'A' }, 'A');
    expect(r.correct).toBeNull();
    expect(r.error).toBe(true);
  });

  it('熔断期内（5 分钟）直接走自评，不再发请求', async () => {
    const ctx = baseCtx();
    ctx.aiGradeDownUntil = Date.now() + 60000;
    let called = false;
    ctx.chat = async () => { called = true; return '{}'; };
    const { gradeSubjective } = loadFns(['withTimeoutP', 'gradeSubjective'], ctx);
    const r = await gradeSubjective({ type: 'short_answer', answer: 'A' }, 'A');
    expect(r.correct).toBeNull();
    expect(r.circuit).toBe(true);
    expect(called).toBe(false);
  });
});
