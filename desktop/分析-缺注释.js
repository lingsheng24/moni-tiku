/**
 * 注释覆盖率检查：列出「定义前没有任何注释」的函数
 * 用法：node desktop/分析-缺注释.js [文件]
 * 默认检查 模拟题库-Web版.html（剔除 BUILD 注入区，避免统计 src 副本）
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const target = process.argv[2] || '模拟题库-Web版.html';
let src = fs.readFileSync(path.join(ROOT, target), 'utf8');
if (target.endsWith('.html')) src = src.replace(/\/\* ==== BUILD:[\s\S]*?BUILD:\w+:END ==== \*\//g, '');

const lines = src.split('\n');
const defRe = /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/;
const out = [];
lines.forEach((ln, i) => {
  const m = defRe.exec(ln);
  if (!m) return;
  // 向上最多 3 行找注释（跳过空行与）{ 之类）
  let has = false;
  for (let k = i - 1; k >= Math.max(0, i - 3); k--) {
    const t = lines[k].trim();
    if (!t) continue;
    if (t.startsWith('//') || t.endsWith('*/') || t.startsWith('/*') || t.startsWith('*')) { has = true; break; }
    break;
  }
  if (!has) out.push({ line: i + 1, name: m[1], text: ln.trim().slice(0, 70) });
});

console.log(`文件：${target}`);
console.log(`函数总数：${lines.filter(l => defRe.test(l)).length}  无前置注释：${out.length}\n`);
out.forEach(o => console.log(`  L${String(o.line).padStart(5)}  ${o.name.padEnd(26)} ${o.text.slice(0, 60)}`));
