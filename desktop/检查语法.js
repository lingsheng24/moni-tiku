const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', '模拟题库-Web版.html');
const s = fs.readFileSync(p, 'utf8');
const scripts = [...s.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
let bad = 0;
scripts.forEach((c, i) => {
  try { new Function(c); } catch (e) {
    bad++;
    const lines = c.split('\n');
    console.log('script#' + i + ' 语法错误: ' + e.message);
    const m = String(e.stack || '').match(/<anonymous>:(\d+)/);
    if (m) {
      const ln = +m[1];
      for (let k = Math.max(0, ln - 3); k < Math.min(lines.length, ln + 2); k++) console.log('  ' + (k + 1) + ' | ' + lines[k].slice(0, 160));
    }
  }
});
console.log('共 ' + scripts.length + ' 段脚本，' + (bad ? bad + ' 段有语法错误' : '语法全部通过'));
