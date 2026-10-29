/**
 * v1.45.0 题目笔记自动挂进知识点图谱
 * 覆盖：题目笔记按 knowledge_point 归到知识点、计数并入图谱角标、详情卡渲染题目笔记区、写完笔记即时同步。
 */
import { describe, test, expect } from 'vitest';
const fs = require('fs');
const { loadFns, HTML_PATH } = require('./extract-html.js');

const HTML = fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');

function makeCtx(questions, opts = {}) {
  const ctx = {
    state: {
      questions,
      mistakes: opts.mistakes || [],
      kpNotes: opts.kpNotes || {},
      kbNotes: opts.kbNotes || [],
      wsFavs: opts.wsFavs || [],
    },
    splitKP: s => String(s || '').split(/[、,，;；\/|]+/).map(x => x.trim()).filter(x => x && x !== '未分类'),
    kbFreeNotes: () => (opts.freeNotes || []),
  };
  const fns = loadFns(['kbAllNotes', 'kbNoteCountsRefresh'], ctx);
  return { ...fns, state: ctx.state };
}

const Q = (id, kp, note, at) => ({
  id, content: '题目' + id, type: 'single_choice', difficulty: 'easy',
  knowledge_point: kp, note: note || '', note_at: at || 0,
});

describe('题目笔记归属知识点', () => {
  test('题目笔记按 knowledge_point 归到知识点，多知识点全部挂上', () => {
    const { kbAllNotes } = makeCtx([
      Q(1, '需求价格弹性', '弹性 = 需求量变动% ÷ 价格变动%', 1000),
      Q(2, '需求价格弹性、供给弹性', '区分点弹性与弧弹性', 2000),
      Q(3, '市场失灵', '', 0),
    ]);
    const list = kbAllNotes().filter(n => n.kind === 'qn');
    expect(list.length).toBe(2);
    const a = list.find(n => n.qid === 1);
    expect(a.kps).toEqual(['需求价格弹性']);
    expect(a.kp).toBe('需求价格弹性');
    const b = list.find(n => n.qid === 2);
    expect(b.kps).toEqual(['需求价格弹性', '供给弹性']);
    expect(b.kp).toBe('需求价格弹性');
  });

  test('没有笔记的题目不进知识库，空白笔记也不算', () => {
    const { kbAllNotes } = makeCtx([Q(1, 'X', '   ', 0), Q(2, 'X', '', 0)]);
    expect(kbAllNotes().filter(n => n.kind === 'qn').length).toBe(0);
  });

  test('题目没有知识点时 kps 为空（不会凭空挂到图谱）', () => {
    const { kbAllNotes } = makeCtx([Q(9, '未分类', '随便记一句', 100)]);
    const n = kbAllNotes().find(x => x.kind === 'qn');
    expect(n.kps).toEqual([]);
    expect(n.kp).toBe('');
  });

  test('「未分类」不会被当成知识点', () => {
    const { kbAllNotes } = makeCtx([Q(9, '未分类、 供给弹性', '笔记', 100)]);
    expect(kbAllNotes().find(x => x.kind === 'qn').kps).toEqual(['供给弹性']);
  });
});

describe('图谱节点笔记计数', () => {
  test('知识点笔记 + 题目笔记一起计入该知识点', () => {
    const { kbNoteCountsRefresh } = makeCtx(
      [Q(1, '市场失灵', '外部性要区分正负', 3000), Q(2, '市场失灵', '公共品非排他', 2000)],
      { kpNotes: { '市场失灵': { text: '四大表现：垄断、外部性、公共品、信息不对称', at: 1000 } } }
    );
    const m = kbNoteCountsRefresh();
    expect(m.get('市场失灵')).toBe(3);
  });

  test('一条题目笔记挂多个知识点时，每个知识点都 +1', () => {
    const { kbNoteCountsRefresh } = makeCtx([Q(1, 'A、B', '跨知识点笔记', 5000)]);
    const m = kbNoteCountsRefresh();
    expect(m.get('A')).toBe(1);
    expect(m.get('B')).toBe(1);
  });

  test('错题笔记与手记也按知识点计入（不回归）', () => {
    const { kbNoteCountsRefresh } = makeCtx(
      [Q(1, 'C', '题目笔记', 100), Q(2, 'C')],
      {
        mistakes: [{ id: 1, question_id: 2, note: '错因：忘了限价', note_at: 200 }],
        freeNotes: [{ id: 1, kp: 'C', text: '手记', updatedAt: 300 }],
      }
    );
    const m = kbNoteCountsRefresh();
    expect(m.get('C')).toBe(3);
  });
});

describe('图谱详情卡渲染题目笔记（源码契约）', () => {
  const between = (startFn, endMark) => {
    const s = HTML.indexOf('function ' + startFn);
    const e = HTML.indexOf(endMark, s);
    return s < 0 ? '' : HTML.slice(s, e < 0 ? s + 6000 : e);
  };

  test('详情卡收集并倒序列出该知识点的题目笔记', () => {
    const d = between('renderKPDetail', 'function scrollKPNotes');
    expect(d).toContain('const qNotes = qs.filter(q => qNote(q))');
    expect(d).toContain('b.note_at || 0) - (a.note_at || 0)');
    expect(d).toContain('id="kpQNotes"');
    expect(d).toContain('✏️ 题目笔记（');
    expect(d).toContain('📖 看原题');
  });

  test('顶部有「题目笔记 N 条」胶囊，点击滚动到笔记区', () => {
    const d = between('renderKPDetail', 'function scrollKPNotes');
    expect(d).toContain('onclick="scrollKPNotes()"');
    expect(HTML).toContain('function scrollKPNotes()');
    expect(HTML).toContain("document.getElementById('kpQNotes')");
  });

  test('题目列表里每题也直接带出笔记', () => {
    const d = between('renderKPDetail', 'function scrollKPNotes');
    expect(d).toContain('<span class="pill violet">📝 有笔记</span>');
    expect(d).toContain('📝 <b>我的笔记</b>：');
  });

  test('没有题目笔记时不渲染空区块', () => {
    const d = between('renderKPDetail', 'function scrollKPNotes');
    expect(d).toContain("${qNotes.length ? `<div id=\"kpQNotes\"");
  });
});

describe('写完题目笔记即时同步图谱', () => {
  test('saveQNote 成功后有同步钩子，且在写盘之后', () => {
    const s = HTML.indexOf('async function saveQNote');
    const e = HTML.indexOf('function qNoteHTML', s);
    const src = HTML.slice(s, e);
    const put = src.indexOf('dbPut(');
    const sync = src.indexOf('kbNoteCountsRefresh()');
    expect(put).toBeGreaterThan(-1);
    expect(sync).toBeGreaterThan(put);
    expect(src).toContain("curView === 'kp'");
    expect(src).toContain('renderKPDetail(kpSelected)');
  });

  test('同步失败不影响保存结果（不吞异常到外层）', () => {
    const s = HTML.indexOf('async function saveQNote');
    const e = HTML.indexOf('function qNoteHTML', s);
    const src = HTML.slice(s, e);
    // 同步代码位于成功分支、最终 return true 之前（开头的「内容没变直接返回」不算）
    const ret = src.lastIndexOf('return true;');
    expect(src.indexOf('kbNoteCountsRefresh()')).toBeLessThan(ret);
  });
});
