// @vitest-environment jsdom
/* v1.48.2 出题模板导入：TSV 解析 + 行映射纯函数测试 */
import { describe, it, expect } from 'vitest';
const { loadFns } = require('./extract-html');

const TYPES = {
  single_choice: '单选题', multiple_choice: '多选题', true_false: '判断题',
  fill_blank: '填空题', short_answer: '简答题',
};

function load() {
  return loadFns(['qTplParseTSV', 'qTplRowToQ'], { TYPES });
}

describe('qTplParseTSV（Excel 复制格式）', () => {
  it('普通 TSV：按制表符与换行切分', () => {
    const { qTplParseTSV } = load();
    const rows = qTplParseTSV('1\t单选题\t简单\tKP\t3\t题干\tA\tB\tC\tD\tB\t解析\n');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(12);
    expect(rows[0][1]).toBe('单选题');
  });
  it('引号内换行与制表符不被切分；空行跳过', () => {
    const { qTplParseTSV } = load();
    const rows = qTplParseTSV('1\t填空题\t\t\t\t"多行\n题干\t含制表符"\t\t\t\t答案\t\n\n');
    expect(rows).toHaveLength(1);
    expect(rows[0][5]).toBe('多行\n题干\t含制表符');
  });
  it('CRLF 与结尾无换行都能完整收尾', () => {
    const { qTplParseTSV } = load();
    const rows = qTplParseTSV('1\t判断题\t简单\tK\t2\t题干\r\n\t\t\t\t\t\t\t\t\t\t\t\r\n9\t单选题\t\t\t\t题干2\t\t\t\t\tB\t');
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe('9');
  });
});

describe('qTplRowToQ（行 → 题目对象映射）', () => {
  it('单选题：选项带字母前缀、答案/难度/重要度正确', () => {
    const { qTplRowToQ } = load();
    const q = qTplRowToQ(['1', '单选题', '简单', '光合作用', '5', '氧气由什么产生？', '水', '二氧化碳', '光', '土壤', 'A', '光反应释放氧气']);
    expect(q.type).toBe('single_choice');
    expect(q.difficulty).toBe('easy');
    expect(q.importance).toBe(5);
    expect(q.knowledge_point).toBe('光合作用');
    expect(q.options).toEqual(['A. 水', 'B. 二氧化碳', 'C. 光', 'D. 土壤']);
    expect(q.answer).toBe('A');
    expect(q.content).toBe('氧气由什么产生？');
  });
  it('判断题：对/错 映射为 正确/错误', () => {
    const { qTplRowToQ } = load();
    expect(qTplRowToQ(['2', '判断题', '中等', 'K', '', '题干', '', '', '', '', '错', '']).answer).toBe('错误');
    expect(qTplRowToQ(['3', '判断题', '', '', '', '题干', '', '', '', '', '对', '']).answer).toBe('正确');
    expect(qTplRowToQ(['4', '判断题', '', '', '', '题干', '', '', '', '', '正确', '']).answer).toBe('正确');
  });
  it('空选项列 → options 为 null；难度留空默认中等；重要度留空默认 3', () => {
    const { qTplRowToQ } = load();
    const q = qTplRowToQ(['5', '填空题', '', '', '', '水的化学式是____。', '', '', '', '', 'H₂O', '']);
    expect(q.options).toBeNull();
    expect(q.difficulty).toBe('medium');
    expect(q.importance).toBe(3);
    expect(q.answer).toBe('H₂O');
  });
  it('困难难度识别；重要度越界收敛到 1~5；非法数字按默认', () => {
    const { qTplRowToQ } = load();
    expect(qTplRowToQ(['6', '简答题', '困难', '', '', '题', '', '', '', '', '答案', '']).difficulty).toBe('hard');
    expect(qTplRowToQ(['7', '单选题', '', '', '9', '题', 'A', '', '', '', 'A', '']).importance).toBe(5);
    expect(qTplRowToQ(['8', '单选题', '', '', 'abc', '题', 'A', '', '', '', 'A', '']).importance).toBe(3);
  });
  it('题型按中文名反查；未知题型回退单选；&nbsp; 清理；题干为空返回 null', () => {
    const { qTplRowToQ } = load();
    expect(qTplRowToQ(['9', '简答题', '', '', '', '题', '', '', '', '', '答', '']).type).toBe('short_answer');
    expect(qTplRowToQ(['10', '奇怪题型', '', '', '', '题', '', '', '', '', '答', '']).type).toBe('single_choice');
    expect(qTplRowToQ(['11', '单选题', '', '&nbsp;', '', '&nbsp;题干', '', '', '', '', 'A', '']).content).toBe('题干');
    expect(qTplRowToQ(['12', '单选题', '', '', '', '', 'A', 'B', '', '', 'A', ''])).toBeNull();
  });
  it('自定义题型（key 直接填入）也能识别', () => {
    const { qTplRowToQ } = load();
    const t2 = { ...TYPES, my_custom: '案例分析' };
    const m = loadFns(['qTplRowToQ'], { TYPES: t2 });
    expect(m.qTplRowToQ(['13', '案例分析', '', '', '', '题', '', '', '', '', '答', '']).type).toBe('my_custom');
  });
  it('导入的题目不挂文档（document_id 为 null），字段齐全', () => {
    const { qTplRowToQ } = load();
    const q = qTplRowToQ(['1', '单选题', '中等', 'K', '3', '题', 'A', 'B', '', '', 'A', '解析']);
    expect(q.document_id).toBeNull();
    expect(q.subject_id).toBeNull();
    expect(q).toHaveProperty('explanation', '解析');
    expect(q).toHaveProperty('created_at');
    expect(q).toHaveProperty('importance');
  });
});
