/**
 * 第三轮：剔除 BUILD 注入区后，核查「src 里的候选死函数」是否真被 HTML 调用
 * 用法：node desktop/分析-死代码3.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let H = fs.readFileSync(path.join(ROOT, '模拟题库-Web版.html'), 'utf8');
H = H.replace(/\/\* ==== BUILD:[\s\S]*?BUILD:\w+:END ==== \*\//g, '');

const names = [
  'initSelBar', 'practiceKPMist', 'practiceKP', 'aiTagKP', 'dueLabel',
  'revForecast', 'reviewDueOnly', 'autoEnqueueIds',
  'pwaInstallable', 'kpNeighbors',
];
for (const n of names) {
  const re = new RegExp('(?<![\\w$])' + n + '(?![\\w$])', 'g');
  const hits = [...H.matchAll(re)];
  const lines = hits.map(m => H.slice(0, m.index).split('\n').length);
  const ctx = hits.map(m => {
    const ls = H.slice(0, m.index).split('\n');
    return (ls[ls.length - 1] || '').trim().slice(0, 80);
  });
  console.log(n.padEnd(18), 'HTML 自身引用:', String(hits.length).padStart(2));
  ctx.forEach(c => console.log('      ' + c));
}

/* 同时列出这些函数在 src/websearch.js 中的定义行，便于人工复核 */
const W = fs.readFileSync(path.join(ROOT, 'src/websearch.js'), 'utf8').split('\n');
console.log('\n定义位置：');
W.forEach((ln, i) => {
  for (const n of names) {
    if (new RegExp('^\\s*(?:async\\s+)?function\\s+' + n + '\\s*\\(').test(ln)) console.log(`  L${i + 1}  ${n}`);
  }
});
