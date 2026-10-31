/* 生成「题型说明」效果预览：一份含两个题型的试卷 HTML，每个题型开头带说明 */
const fs = require('fs');
const path = require('path');
const { loadFns } = require('./test/extract-html.js');

const names = ['DEFAULT_TYPE_NOTE', 'typeNoteOf', 'renderTypeNote', 'CN_NUM', 'HEAD_KEYS',
  'blockHTML', 'paperHTML', 'paperBlocks'];
const fns = loadFns(names, {
  state: { settings: {} },
  isTextType: () => false,
  esc: s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
});

const q = (id, type, content, answer, options, explanation) => ({
  id, type, content, answer, difficulty: 'medium', knowledge_point: '气候类型', options, explanation,
});

const paper = {
  name: '地理单元测验（题型说明效果）',
  subject: '地理',
  duration: 45,
  total: 3 * 3 + 2 * 2,
  count: 5,
  groups: [
    {
      type: 'single_choice', title: '单项选择题', score: 3,
      items: [
        q(1, 'single_choice', '我国面积最大的省级行政区是（　　）', 'B',
          ['A. 西藏自治区', 'B. 新疆维吾尔自治区', 'C. 内蒙古自治区', 'D. 青海省'], '新疆面积约 166 万平方公里。'),
        q(2, 'single_choice', '下列气候类型中，全年高温多雨的是（　　）', 'A',
          ['A. 热带雨林气候', 'B. 地中海气候', 'C. 温带季风气候', 'D. 高原山地气候'], '热带雨林气候终年高温多雨。'),
        q(3, 'single_choice', '长江发源于（　　）', 'C',
          ['A. 祁连山', 'B. 昆仑山', 'C. 唐古拉山', 'D. 巴颜喀拉山'], '长江正源沱沱河发源于唐古拉山。'),
      ],
    },
    {
      type: 'true_false', title: '判断题', score: 2,
      items: [
        q(4, 'true_false', '我国地势西高东低，呈三级阶梯分布。', '正确', undefined, '西高东低三级阶梯是我国地势基本特征。'),
        q(5, 'true_false', '秦岭—淮河一线是我国 800mm 等降水量线经过的地方。', '正确', undefined, '该线大致与 800mm 年等降水量线重合。'),
      ],
    },
  ],
};

const html = fns.paperHTML(fns.paperBlocks(paper, 'student'), 'A4');
const out = path.join(__dirname, '..', '试卷_题型说明预览.html');
fs.writeFileSync(out, html, 'utf8');

// 打印每个题型开头那句，便于肉眼核对
const bs = fns.paperBlocks(paper, 'student');
for (const b of bs) {
  if (b.k === 'sec') console.log('\n【大题标题】' + b.t);
  if (b.k === 'secnote') console.log('【题型说明】' + b.t);
}
console.log('\n已生成：' + out);
