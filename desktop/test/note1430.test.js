/**
 * v1.43.0 题目笔记：复习时给每道题记笔记
 * 覆盖 qNote / saveQNote 的写入、去重、清空、失败回滚，以及三个界面是否真的渲染了笔记框。
 */
import { describe, test, expect } from 'vitest';
const fs = require('fs');
const { loadFns, HTML_PATH } = require('./extract-html.js');

const HTML = fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');

function makeCtx(questions, opts = {}) {
  const writes = [];
  const toasts = [];
  const ctx = {
    state: { questions },
    DB_TIMEOUT: Symbol('db-timeout'),
    dbPut: async (store, val) => { writes.push({ store, val }); return opts.fail || true; },
    toast: (msg) => toasts.push(msg),
  };
  const fns = loadFns(['qNote', 'saveQNote'], ctx);
  return { ...fns, writes, toasts, questions };
}

describe('qNote', () => {
  const { qNote } = makeCtx([]);
  test('没有笔记或是脏数据时返回空串', () => {
    expect(qNote(null)).toBe('');
    expect(qNote(undefined)).toBe('');
    expect(qNote({})).toBe('');
    expect(qNote({ note: null })).toBe('');
    expect(qNote({ note: 123 })).toBe('');
  });
  test('有笔记时原样返回', () => {
    expect(qNote({ note: '易错：把环比当成同比' })).toBe('易错：把环比当成同比');
  });
});

describe('saveQNote', () => {
  test('写入时 trim 并带上 note_at，其他字段不丢', async () => {
    const q = { id: 7, content: '题干', answer: 'A', type: 'single_choice', explanation: '解析' };
    const { saveQNote, writes } = makeCtx([q]);
    expect(await saveQNote(7, '  口诀：先总后分  ')).toBe(true);
    expect(writes.length).toBe(1);
    expect(writes[0].store).toBe('questions');
    expect(writes[0].val.note).toBe('口诀：先总后分');
    expect(writes[0].val.note_at).toBeGreaterThan(0);
    expect(writes[0].val.answer).toBe('A');
    expect(writes[0].val.explanation).toBe('解析');
    expect(q.note).toBe('口诀：先总后分');
  });

  test('内容没变不重复写盘', async () => {
    const q = { id: 1, note: '已有的笔记' };
    const { saveQNote, writes } = makeCtx([q]);
    expect(await saveQNote(1, '已有的笔记')).toBe(true);
    expect(writes.length).toBe(0);
  });

  test('清空笔记：note 为空串、note_at 归零', async () => {
    const q = { id: 2, note: '旧笔记', note_at: 111 };
    const { saveQNote, writes } = makeCtx([q]);
    expect(await saveQNote(2, '   ')).toBe(true);
    expect(writes[0].val.note).toBe('');
    expect(writes[0].val.note_at).toBe(0);
    expect(q.note).toBe('');
  });

  test('题目不存在：返回 false，非静默时提示', async () => {
    const { saveQNote, toasts, writes } = makeCtx([]);
    expect(await saveQNote(999, '笔记')).toBe(false);
    expect(writes.length).toBe(0);
    expect(toasts.join()).toContain('原题已删除');
  });

  test('写盘抛错：内存值回滚，返回 false', async () => {
    const q = { id: 3, note: '旧值', note_at: 222 };
    const ctx = { state: { questions: [q] }, DB_TIMEOUT: Symbol('t'), dbPut: async () => { throw new Error('磁盘忙'); }, toast: () => { } };
    const { saveQNote } = loadFns(['qNote', 'saveQNote'], ctx);
    expect(await saveQNote(3, '新值')).toBe(false);
    expect(q.note).toBe('旧值');
    expect(q.note_at).toBe(222);
  });

  test('写盘超时同样回滚', async () => {
    const TO = Symbol('timeout');
    const q = { id: 4, note: '旧值', note_at: 333 };
    const { saveQNote } = loadFns(['qNote', 'saveQNote'], {
      state: { questions: [q] }, DB_TIMEOUT: TO, dbPut: async () => TO, toast: () => { },
    });
    expect(await saveQNote(4, '新值')).toBe(false);
    expect(q.note).toBe('旧值');
  });

  test('静默模式下失败不弹 toast（自动保存路径）', async () => {
    const toasts = [];
    const { saveQNote } = loadFns(['qNote', 'saveQNote'], {
      state: { questions: [] }, DB_TIMEOUT: Symbol('t'),
      dbPut: async () => true, toast: (m) => toasts.push(m),
    });
    expect(await saveQNote(404, 'x', true)).toBe(false);
    expect(toasts.length).toBe(0);
  });
});

describe('界面接入', () => {
  const between = (startFn, endMark) => {
    const s = HTML.indexOf('function ' + startFn);
    const e = HTML.indexOf(endMark, s);
    return s < 0 ? '' : HTML.slice(s, e < 0 ? s + 4000 : e);
  };

  test('复习会话渲染笔记框并且在评分前强制落盘', () => {
    const sess = between('renderRevCard', 'function revealRevAns');
    expect(sess).toContain('qNoteHTML(q');
    expect(sess).toContain('bindQNotes(');
    const rate = between('rateRev', 'function renderRevResult');
    expect(rate).toContain('revNoteFlush');
  });

  test('卡片管理行内答题区带笔记框', () => {
    const v = between('viewReview', 'function revPage');
    expect(v).toContain('qNoteHTML(q');
    expect(v).toContain('bindQNotes(');
  });

  test('答题练习渲染笔记框，切题与提交前强制落盘', () => {
    expect(HTML).toContain("qNoteHTML(it, 'quiz'");
    const rq = between('renderQuiz', 'async function goQuestion');
    expect(rq).toContain('bindQNotes(');
    expect(between('goQuestion', 'async function nextQuestion')).toContain('quizNoteFlush');
    expect(between('submitAnswer', 'if (it.options &&')).toContain('quizNoteFlush');
  });

  test('题库管理可查看与编辑笔记', () => {
    expect(HTML).toContain('function editQNote(');
    expect(HTML).toContain('onclick="editQNote(');
    expect(HTML).toContain('q-note-show');
  });

  test('笔记写盘失败不会卡住界面（全部走 dbPut 超时兜底）', () => {
    expect(HTML).toContain("const dbPut = (store, val, ms = 12000) => withTimeoutP(DB.put(store, val), ms, DB_TIMEOUT)");
    const save = between('saveQNote', 'function qNoteHTML');
    expect(save).toContain('DB_TIMEOUT');
  });
});
