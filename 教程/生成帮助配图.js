/* 把 教程/截图精简/*.jpg 以 base64 注入 模拟题库-Web版.html 的 HELP_IMGS 常量（幂等，可重复运行）
 * 用法：node 教程/生成帮助配图.js */
const fs = require('fs');
const path = require('path');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const SRC = path.join(ROOT, '教程/截图精简');
const HTML = path.join(ROOT, '模拟题库-Web版.html');
const SKIP = ['14-帮助手册'];   // 帮助页自身截图不需要

const MARK = '/* 帮助手册配图（由 教程/生成帮助配图.js 自动生成，勿手改） */';
const ANCHOR = 'const HELP_SECTIONS = [';

const files = fs.readdirSync(SRC).filter(f => f.endsWith('.jpg'))
  .filter(f => !SKIP.some(s => f.startsWith(s))).sort();
const entries = files.map(f => {
  const key = 's' + f.replace(/\.jpg$/, '').split('-')[0];
  const b64 = fs.readFileSync(path.join(SRC, f)).toString('base64');
  return `  ${key}: 'data:image/jpeg;base64,${b64}',`;
});
const block = `${MARK}\nconst HELP_IMGS = {\n${entries.join('\n')}\n};\n\n`;

let html = fs.readFileSync(HTML, 'utf8');
if (!html.includes(ANCHOR)) { console.error('找不到插入锚点'); process.exit(1); }
/* 幂等：先移除旧块 */
const mi = html.indexOf(MARK);
if (mi >= 0) {
  const ai = html.indexOf(ANCHOR, mi);
  html = html.slice(0, mi) + html.slice(ai);
}
html = html.replace(ANCHOR, block + ANCHOR);
fs.writeFileSync(HTML, html, 'utf8');
const total = entries.reduce((s, e) => s + e.length, 0);
console.log(`✓ 注入 ${files.length} 张配图，HTML 现 ${(fs.statSync(HTML).size / 1024 / 1024).toFixed(2)} MB`);
