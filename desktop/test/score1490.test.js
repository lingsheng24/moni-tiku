// @vitest-environment jsdom
/* v1.49.0 题型分值：typeScoreOf 取值规则 + scorePillHTML 渲染 + 与组卷/考试联动 */
import { describe, test, expect } from 'vitest';
const { loadFns, HTML_PATH } = require('./extract-html.js');
const fs = require('fs');

const mk = (typeScores) => loadFns(['DEFAULT_SCORE', 'typeScoreOf'], {
  state: { settings: typeScores ? { typeScores } : {} },
});

describe('typeScoreOf：按题型取值', () => {
  test('未配置时回退 DEFAULT_SCORE（单选3/多选5/判断2/填空4/简答8）', () => {
    const { typeScoreOf } = mk();
    expect(typeScoreOf('single_choice')).toBe(3);
    expect(typeScoreOf('multiple_choice')).toBe(5);
    expect(typeScoreOf('true_false')).toBe(2);
    expect(typeScoreOf('fill_blank')).toBe(4);
    expect(typeScoreOf('short_answer')).toBe(8);
  });

  test('自定义题型未配置时默认 5 分', () => {
    const { typeScoreOf } = mk();
    expect(typeScoreOf('my_custom')).toBe(5);
  });

  test('已配置时用配置值（覆盖默认）', () => {
    const { typeScoreOf } = mk({ single_choice: 10, my_custom: 12 });
    expect(typeScoreOf('single_choice')).toBe(10);
    expect(typeScoreOf('my_custom')).toBe(12);
    expect(typeScoreOf('multiple_choice')).toBe(5);   // 未配置的仍走默认
  });

  test('0 分有效（不计分题型），不被当 falsy 忽略', () => {
    const { typeScoreOf } = mk({ short_answer: 0 });
    expect(typeScoreOf('short_answer')).toBe(0);
  });

  test('越界与脏值收敛到 0~50', () => {
    const { typeScoreOf } = mk({ single_choice: 999, multiple_choice: -5, true_false: 'abc' });
    expect(typeScoreOf('single_choice')).toBe(50);
    expect(typeScoreOf('multiple_choice')).toBe(0);
    expect(typeScoreOf('true_false')).toBe(0);
  });

  test('字符串数字可用（设置页 input 存的是字符串也能算）', () => {
    const { typeScoreOf } = mk({ single_choice: '7' });
    expect(typeScoreOf('single_choice')).toBe(7);
  });
});

describe('scorePillHTML：分值胶囊', () => {
  const { scorePillHTML } = loadFns(['DEFAULT_SCORE', 'typeScoreOf', 'scorePillHTML'], {
    state: { settings: { typeScores: { single_choice: 6 } } },
    TYPES: { single_choice: '单选题' },
  });
  test('显示「N 分」并带 data-score-pill（供就地刷新）', () => {
    const html = scorePillHTML({ id: 42, type: 'single_choice' });
    expect(html).toContain('6 分');
    expect(html).toContain('data-score-pill="42"');
    expect(html).toContain('题型分值');
  });
});

describe('接入检查：分值在关键页面可见', () => {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const between = (a, b) => {
    const i = html.indexOf(a), j = html.indexOf(b);
    if (i < 0 || j < 0) throw new Error(`未找到 ${a} / ${b}`);
    return html.slice(i, i + (j > i ? j - i : 4000));
  };
  test('题库管理、练习、复习会话、卡片管理、看原题都渲染分值胶囊', () => {
    expect(between('function viewBank', 'let timer = null').match(/scorePillHTML\(/g)?.length).toBeGreaterThan(0);
    expect(between('function renderQuiz', 'function renderQuizResult')).toContain('scorePillHTML(it)');
    expect(between('function viewReview', 'function viewStats').match(/scorePillHTML\(/g)?.length).toBeGreaterThan(0);
    expect(between('function kbShowQuestion', 'function kbRenderList')).toContain('scorePillHTML(q)');
  });
  test('复习卡片（src/websearch.js）也带分值', () => {
    const ws = fs.readFileSync(require('path').join(require('path').dirname(HTML_PATH), 'src', 'websearch.js'), 'utf8');
    expect(ws).toContain('scorePillHTML(q)');
  });
  test('设置页有「题型分值」配置卡片与保存/恢复默认', () => {
    expect(html).toContain('📊 题型分值');
    expect(html).toContain('data-ttype=');
    expect(html).toContain('sScoreReset');
    expect(html).toContain('setTypeScore(');
  });
  test('考试判分/组卷/试卷分数统一走 typeScoreOf（不再读 examCfgScore）', () => {
    expect(html).not.toContain('examCfgScore');
    expect(html).toContain('function paperScoreOf(q) { return typeScoreOf(q.type); }');
    expect(html).toContain('const max = typeScoreOf(q.type);');
  });
});
