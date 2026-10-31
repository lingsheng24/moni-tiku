// @vitest-environment jsdom
/* v1.49.0 题型说明：typeNoteOf 取值 + renderTypeNote 占位符替换 + 试卷每个题型开头显示 */
import { describe, test, expect } from 'vitest';
const { loadFns, HTML_PATH } = require('./extract-html.js');
const fs = require('fs');

const mk = (typeNotes) => loadFns(['DEFAULT_TYPE_NOTE', 'typeNoteOf', 'renderTypeNote'], {
  state: { settings: typeNotes ? { typeNotes } : {} },
});

describe('typeNoteOf：题型说明取值', () => {
  test('未配置时回退默认文案，且默认单选文案含题数/分值/总分占位符', () => {
    const { typeNoteOf } = mk();
    const n = typeNoteOf('single_choice');
    expect(n).toContain('{n}');
    expect(n).toContain('{score}');
    expect(n).toContain('{total}');
    expect(n).toContain('只有一个正确答案');
  });

  test('未配置的自定义题型有兜底文案（不返回空）', () => {
    const { typeNoteOf } = mk();
    expect(typeNoteOf('my_custom')).toContain('{score}');
  });

  test('默认文案都带作答指引收尾（括号内 / 横线上 / 空白处）', () => {
    const { typeNoteOf } = mk();
    expect(typeNoteOf('single_choice')).toContain('题后括号内');
    expect(typeNoteOf('multiple_choice')).toContain('题后括号内');
    expect(typeNoteOf('true_false')).toContain('题后括号内');
    expect(typeNoteOf('fill_blank')).toContain('横线上');
    expect(typeNoteOf('short_answer')).toContain('空白处');
  });

  test('已配置时用自定义文案（覆盖默认）', () => {
    const { typeNoteOf } = mk({ single_choice: '本题型每题 4 分，答错倒扣 1 分。' });
    expect(typeNoteOf('single_choice')).toBe('本题型每题 4 分，答错倒扣 1 分。');
    expect(typeNoteOf('multiple_choice')).toContain('两个或以上');   // 其余仍走默认
  });

  test('空串/纯空格视为未配置，回退默认（避免卷面出现空白说明）', () => {
    const { typeNoteOf } = mk({ single_choice: '   ', multiple_choice: '' });
    expect(typeNoteOf('single_choice')).toContain('只有一个正确答案');
    expect(typeNoteOf('multiple_choice')).toContain('两个或以上');
  });
});

describe('renderTypeNote：按本大题实际情况替换占位符', () => {
  test('{n}/{score}/{total} 正确替换', () => {
    const { renderTypeNote } = mk();
    const s = renderTypeNote('single_choice', 10, 3);
    expect(s).toContain('共 10 小题');
    expect(s).toContain('每小题 3 分');
    expect(s).toContain('共 30 分');
    expect(s).not.toContain('{');
  });

  test('自定义文案里的占位符同样替换，普通文字原样保留', () => {
    const { renderTypeNote } = mk({ true_false: '本大题 {n} 道判断题，每题 {score} 分，满分 {total} 分，对的打√。' });
    expect(renderTypeNote('true_false', 5, 2)).toBe('本大题 5 道判断题，每题 2 分，满分 10 分，对的打√。');
  });

  test('分值为 0 时总分算出 0，不出现 NaN', () => {
    const { renderTypeNote } = mk();
    const s = renderTypeNote('fill_blank', 4, 0);
    expect(s).toContain('每小题 0 分');
    expect(s).toContain('共 0 分');
    expect(s).not.toContain('NaN');
  });
});

describe('试卷：每个题型开头带说明', () => {
  const { paperBlocks } = loadFns(['DEFAULT_TYPE_NOTE', 'typeNoteOf', 'renderTypeNote', 'paperBlocks', 'CN_NUM'], {
    state: { settings: {} },
    isTextType: () => false,
  });
  const q = (id, type, extra) => ({ id, type, content: '题干' + id, answer: 'A', options: ['A. 甲', 'B. 乙'], ...extra });
  const paper = {
    name: '单元测', subject: '地理', duration: 60, total: 17, count: 4,
    groups: [
      { type: 'single_choice', title: '单项选择题', score: 3, items: [q(1, 'single_choice'), q(2, 'single_choice')] },
      { type: 'true_false', title: '判断题', score: 2, items: [q(3, 'true_false')] },
    ],
  };

  test('每个题型标题后紧跟 secnote，且含该题型的题数与分值', () => {
    const bs = paperBlocks(paper, 'student');
    const idx = bs.findIndex(b => b.k === 'sec' && b.t === '一、单项选择题');
    expect(idx).toBeGreaterThan(-1);
    expect(bs[idx + 1].k).toBe('secnote');
    expect(bs[idx + 1].t).toContain('共 2 小题');
    expect(bs[idx + 1].t).toContain('每小题 3 分');
    expect(bs[idx + 1].t).toContain('共 6 分');
  });

  test('大题标题不再重复拼「每小题 X 分」（分值信息统一由说明承载）', () => {
    const sec = paperBlocks(paper, 'student').filter(b => b.k === 'sec').map(b => b.t);
    expect(sec.join('|')).not.toContain('每小题');
    expect(sec).toContain('二、判断题');
  });

  test('教师卷同样带说明（两种卷种都显示）', () => {
    const bs = paperBlocks(paper, 'teacher');
    expect(bs.filter(b => b.k === 'secnote').length).toBe(2);
  });
});

describe('接入检查：说明能配置、能渲染', () => {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  test('设置页有说明输入框与「恢复默认说明」按钮', () => {
    expect(html).toContain('📊 题型分值与说明');
    expect(html).toContain('data-tnote=');
    expect(html).toContain('sNoteReset');
    expect(html).toContain('function setTypeNote(');
    expect(html).toContain("inp.onchange = save");   // 失焦保存绑定
  });
  test('试卷 HTML 渲染与桌面 Word 渲染都支持 secnote', () => {
    expect(html).toContain("case 'secnote': return `<div class=\"secnote\">");
    expect(html).toContain('.secnote{');
    const mainJs = fs.readFileSync(require('path').join(require('path').dirname(HTML_PATH), 'desktop', 'main.js'), 'utf8');
    expect(mainJs).toContain("case 'secnote':");
  });
});
