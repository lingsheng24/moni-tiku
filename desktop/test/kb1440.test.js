/**
 * v1.44.0 笔记归入知识库：题目笔记成为知识库的第四类来源
 * 覆盖 kbAllNotes 的收集规则、kbFilterList 检索、kbStats 统计、clipText 截断，
 * 以及知识库页面是否真的接入了「题目笔记」芯片 / 看原题 / 编辑写回原题。
 */
import { describe, test, expect } from 'vitest';
const fs = require('fs');
const { loadFns, HTML_PATH } = require('./extract-html.js');

const HTML = fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');

function makeCtx(state) {
  return {
    state,
    kbGraphNameCache: null,
    kbNoteCounts: new Map(),
    kpSelected: null,
    kbFilter: { kw: '', kind: '', kp: '' },
  };
}

const baseState = (questions) => ({
  questions,
  mistakes: [],
  kpNotes: {},
  kbNotes: [],
  wsFavs: [],
});

function load(questions) {
  const ctx = makeCtx(baseState(questions));
  return loadFns(['kbAllNotes', 'kbFreeNotes', 'splitKP', 'kbFilterList', 'kbStats', 'kbGraphNames', 'clipText', 'KB_KIND'], ctx);
}

describe('kbAllNotes 收集题目笔记', () => {
  test('带笔记的题目会作为 qn 收录，key/qid/文本/时间都对', () => {
    const { kbAllNotes } = load([
      { id: 7, content: '题干甲', answer: 'A', type: 'single_choice', note: '  易错：环比≠同比  ', note_at: 1700000000000 },
    ]);
    const list = kbAllNotes();
    expect(list.length).toBe(1);
    const n = list[0];
    expect(n.kind).toBe('qn');
    expect(n.key).toBe('qn:7');
    expect(n.qid).toBe(7);
    expect(n.text).toBe('易错：环比≠同比');
    expect(n.at).toBe(1700000000000);
    expect(n.content).toBe('题干甲');
    expect(n.qtype).toBe('single_choice');
  });

  test('没有笔记 / 空白笔记 / 脏数据都不收录', () => {
    const { kbAllNotes } = load([
      { id: 1, content: '无笔记' },
      { id: 2, content: '空串', note: '' },
      { id: 3, content: '纯空格', note: '   \n  ' },
      { id: 4, content: '数字脏数据', note: 123 },
      { id: 5, content: '对象脏数据', note: { a: 1 } },
    ]);
    expect(kbAllNotes().length).toBe(0);
  });

  test('题目的多个知识点会拆开，图谱角标能统计到', () => {
    const { kbAllNotes } = load([
      { id: 9, content: '多知识点题', knowledge_point: '牛顿第二定律、力学', note: '口诀：F=ma' },
    ]);
    const n = kbAllNotes()[0];
    expect(n.kps).toEqual(['牛顿第二定律', '力学']);
    expect(n.kp).toBe('牛顿第二定律');
  });

  test('「未分类」不算知识点', () => {
    const { kbAllNotes } = load([{ id: 10, content: 'x', knowledge_point: '未分类', note: '想法' }]);
    const n = kbAllNotes()[0];
    expect(n.kps).toEqual([]);
    expect(n.kp).toBe('');
  });

  test('五类来源共存时按时间倒序', () => {
    const st = baseState([{ id: 1, content: '题一', note: '题目笔记', note_at: 300 }]);
    st.kpNotes = { 力学: { text: '知识点笔记', at: 100 } };
    st.kbNotes = [{ id: 'f1', text: '手记', at: 200 }];
    const ctx = makeCtx(st);
    const { kbAllNotes } = loadFns(['kbAllNotes', 'kbFreeNotes', 'splitKP'], ctx);
    const list = kbAllNotes();
    expect(list.map(n => n.kind)).toEqual(['qn', 'free', 'kp']);
  });
});

describe('kbFilterList 能按题目笔记检索', () => {
  const questions = [
    { id: 1, content: '关于同比的说法正确的是', knowledge_point: '统计指标', type: 'single_choice', note: '和环比容易混', note_at: 1 },
    { id: 2, content: '牛顿第二定律的表达式', knowledge_point: '力学', type: 'fill_blank', note: 'F=ma', note_at: 2 },
  ];

  test('按笔记内容搜索', () => {
    const { kbAllNotes, kbFilterList } = load(questions);
    const r = kbFilterList(kbAllNotes(), { kw: '环比' });
    expect(r.length).toBe(1);
    expect(r[0].qid).toBe(1);
  });

  test('按题干搜索也能命中题目笔记', () => {
    const { kbAllNotes, kbFilterList } = load(questions);
    const r = kbFilterList(kbAllNotes(), { kw: '牛顿' });
    expect(r.length).toBe(1);
    expect(r[0].qid).toBe(2);
  });

  test('按知识点筛选 + 按类型筛选', () => {
    const { kbAllNotes, kbFilterList } = load(questions);
    const all = kbAllNotes();
    expect(kbFilterList(all, { kp: '力学' }).length).toBe(1);
    expect(kbFilterList(all, { kind: 'qn' }).length).toBe(2);
    expect(kbFilterList(all, { kind: 'mist' }).length).toBe(0);
  });
});

describe('kbStats 统计', () => {
  test('题目笔记单独计数，并计入总数与知识点覆盖', () => {
    const { kbAllNotes, kbStats } = load([
      { id: 1, content: 'a', knowledge_point: '力学', note: 'x' },
      { id: 2, content: 'b', knowledge_point: '力学', note: 'y' },
      { id: 3, content: 'c', knowledge_point: '光学', note: 'z' },
      { id: 4, content: 'd', knowledge_point: '力学' },
    ]);
    const s = kbStats(kbAllNotes());
    expect(s.total).toBe(3);
    expect(s.qn).toBe(3);
    expect(s.kpCount).toBe(2);
    expect(s.covered).toBe(2);
    expect(s.graphTotal).toBe(2);
  });
});

describe('clipText 截断', () => {
  const { clipText } = load([]);
  test('短文本原样返回并压缩空白', () => {
    expect(clipText('  多行\n  文本 ', 50)).toBe('多行 文本');
  });
  test('超长截断并加省略号', () => {
    const out = clipText('一'.repeat(200), 130);
    expect(out.length).toBe(131);
    expect(out.endsWith('…')).toBe(true);
  });
  test('空值返回空串', () => {
    expect(clipText(null, 10)).toBe('');
    expect(clipText(undefined, 10)).toBe('');
  });
});

describe('知识库界面接入', () => {
  test('KB_KIND 里有题目笔记这一类且带独立配色', () => {
    const { KB_KIND } = load([]);
    expect(KB_KIND.qn).toBeTruthy();
    expect(KB_KIND.qn.label).toBe('题目笔记');
    expect(KB_KIND.qn.cls).toBe('violet');
  });
  test('页面有统计卡与「看原题」入口', () => {
    expect(HTML).toContain('<div class="lbl">题目笔记</div>');
    expect(HTML).toContain('function kbShowQuestion(');
    expect(HTML).toContain('📖 看原题');
  });
  test('编辑题目笔记写回原题，删除等于清空原题笔记', () => {
    expect(HTML).toContain("} else if (editing.kind === 'qn') {");
    expect(HTML).toContain("if (!await saveQNote(editing.qid, text)) return;");
    expect(HTML).toContain("} else if (n.kind === 'qn') {");
    expect(HTML).toContain("if (!await saveQNote(n.qid, '')) return;");
  });
  test('题目笔记的知识点在编辑器里只读（归属来自题目本身）', () => {
    expect(HTML).toContain("${isQN ? 'disabled' : ''}");
  });
  test('知识库副标题与空状态都提到题目笔记', () => {
    expect(HTML).toContain('题目笔记、知识点笔记、错题笔记、手记、联网查询收藏都收在这里');
    expect(HTML).toContain('复习或答题练习时在题目下方写「📝 我的笔记」');
  });
  test('帮助手册知识库章列出五类来源', () => {
    expect(HTML).toContain('<tr><td>✏️ 题目笔记</td>');
    expect(HTML).toContain('五类内容统一检索');
  });
});
