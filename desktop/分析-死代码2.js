/**
 * 第二轮死代码分析：主进程/后端模块函数、无引用 DOM id、注释掉的代码块
 * 用法：node desktop/分析-死代码2.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, '模拟题库-Web版.html'), 'utf8');
const files = {
  'main.js': fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8'),
  'preload.js': fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8'),
  'src/db.js': fs.readFileSync(path.join(ROOT, 'src/db.js'), 'utf8'),
  'src/websearch.js': fs.readFileSync(path.join(ROOT, 'src/websearch.js'), 'utf8'),
};

const count = (name, text) => (text.match(new RegExp('(?<![\\w$])' + name.replace(/\$/g, '\\$') + '(?![\\w$])', 'g')) || []).length;

console.log('══ A) 主进程 / 后端模块中疑似未使用的函数 ══');
for (const [f, text] of Object.entries(files)) {
  const defs = [...text.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]);
  const uniq = [...new Set(defs)];
  const dead = uniq.filter(n => count(n, text) <= 1);
  console.log(`  ${f}: 函数 ${uniq.length} 个，疑似未使用 ${dead.length} 个  ${dead.join('  ')}`);
}

console.log('\n══ B) HTML 中定义了但全文只出现一次的 id ══');
const ids = [...HTML.matchAll(/\sid="([A-Za-z][\w-]*)"/g)].map(m => m[1]);
const uniqIds = [...new Set(ids)];
const deadIds = uniqIds.filter(id => count(id, HTML) <= 1);
console.log(`  id 总数 ${uniqIds.length}，疑似无引用 ${deadIds.length} 个`);
console.log('  ' + deadIds.join('  '));

console.log('\n══ C) 连续的「注释掉的代码」块（>=3 行 // 且含 = { ; ）══');
const ls = HTML.split('\n');
let run = [];
const flush = () => {
  if (run.length >= 3) console.log(`  L${run[0].n}-${run[run.length - 1].n}  ${run[0].t.slice(0, 90)}`);
  run = [];
};
ls.forEach((ln, i) => {
  const t = ln.trim();
  const isCommentedCode = /^\/\/\s*(?:if|for|const|let|var|function|return|document\.|\$\(|[A-Za-z_$][\w$.]*\s*[=(])/.test(t) && /[;{=]/.test(t);
  if (isCommentedCode) run.push({ n: i + 1, t });
  else flush();
});
flush();
