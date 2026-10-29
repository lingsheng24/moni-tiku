/* 构建脚本：把 src/ 里的模块注入 模拟题库-Web版.html 的标记区（渐进式拆分，v1.41.0 起）
 *
 * 单文件交付不变：HTML 里用成对注释标记出模块位，
 *   /* ==== BUILD:<名>:START ==== ／ /* ==== BUILD:<名>:END ==== *／
 * 本脚本把 src/ 下对应模块（按 REGIONS 里的顺序拼接）回填进标记区。
 * 直接编辑 HTML 里标记区之间的代码是无效的——下次构建会被 src/ 覆盖；
 * 改这些域请改 src/ 里的文件，然后 node build.js。
 *
 * 用法：
 *   node build.js           构建（写入 HTML）
 *   node build.js --check   只校验：构建结果与当前 HTML 一致（确认 HTML 已是最新）
 */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const HTML_FILE = path.join(ROOT, '模拟题库-Web版.html');

/* 模块注册表：name 对应 HTML 标记名，files 按顺序拼进标记区。
 * 新拆一个域：① HTML 里把代码块换成标记对 ② 代码存入 src/ ③ 在这里登记。 */
const REGIONS = [
  { name: 'db', files: ['src/db.js'] },                 // 运行环境 / 版本常量 / IndexedDB & IPC 数据层
  { name: 'websearch', files: ['src/websearch.js'] },   // 联网查询面板（搜索 / AI 追问 / 收藏夹）
];

const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** 把 REGIONS 里登记的模块注入 html 文本并返回结果（供 build.js 命令行与测试共用） */
function build(html) {
  let out = html;
  for (const r of REGIONS) {
    const start = `/* ==== BUILD:${r.name}:START ==== */`;
    const end = `/* ==== BUILD:${r.name}:END ==== */`;
    if (!out.includes(start) || !out.includes(end)) throw new Error('HTML 缺少标记区：' + r.name);
    const body = r.files
      .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n').trimEnd() + '\n')
      .join('\n');
    const re = new RegExp(escRe(start) + '[\\s\\S]*?' + escRe(end));
    out = out.replace(re, start + '\n' + body + '\n' + end);
    for (const f of r.files) {
      const core = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n').trim().slice(0, 200);
      if (!out.includes(core)) throw new Error('回填校验失败：' + f + ' 未出现在产物中');
    }
  }
  return out;
}

module.exports = { build, REGIONS };

if (require.main === module) {
  const html = fs.readFileSync(HTML_FILE, 'utf8');
  const result = build(html);
  if (process.argv.includes('--check')) {
    if (result === html) { console.log('check OK：HTML 与 src/ 一致'); }
    else { console.error('check 失败：HTML 落后于 src/，请运行 node build.js'); process.exit(1); }
  } else {
    fs.writeFileSync(HTML_FILE, result);
    console.log('构建完成：', REGIONS.map(r => r.files.join('+')).join('，'), '已注入 HTML');
  }
}
