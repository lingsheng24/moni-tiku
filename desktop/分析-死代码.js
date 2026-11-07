/**
 * 死代码静态分析（前端单文件 + Electron 主进程）
 * ------------------------------------------------------------
 * 不修改任何文件，只输出报告：
 *   1) 前端函数：定义次数 vs 引用次数，找出只在定义处出现一次的
 *   2) CSS 类：定义了但 HTML/JS 里从未出现的类名
 *   3) 后端 IPC：main.js 注册的 channel vs preload/前端实际调用的 channel
 *   4) 调试残留：console.* / debugger / TODO / alert 等
 * 用法：node desktop/分析-死代码.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, '模拟题库-Web版.html'), 'utf8');
const MAIN = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const PRELOAD = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
const SRC = ['db.js', 'websearch.js', 'helpimgs.js']
  .map(f => [f, fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')]);

/* ---------- 1) 前端函数 ---------- */
// 只取 <script> 里的内容（样式里不会有 function 定义，但模板字符串里可能出现示例代码）
const scripts = [...HTML.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
const defRe = /(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
const constFnRe = /(?:^|\n)\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g;

const defs = new Map();   // name -> { count, line }
const lines = scripts.split('\n');
lines.forEach((ln, i) => {
  for (const re of [defRe, constFnRe]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(ln))) {
      const name = m[1];
      const cur = defs.get(name) || { count: 0, line: i + 1 };
      cur.count++; defs.set(name, cur);
    }
  }
});

const countRefs = (name, text) => {
  const re = new RegExp('(?<![\\w$])' + name.replace(/\$/g, '\\$') + '(?![\\w$])', 'g');
  return (text.match(re) || []).length;
};

const unusedFns = [];
for (const [name, info] of defs) {
  // 定义 1 次 + 全文引用 1 次（即仅定义处）视为疑似未使用；onclick="name(...)" 也算引用
  const refs = countRefs(name, scripts);
  const htmlRefs = countRefs(name, HTML);
  if (refs <= info.count && htmlRefs <= info.count) unusedFns.push({ name, ...info, refs, htmlRefs });
}

/* ---------- 2) CSS 类 ---------- */
const styles = [...HTML.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
const classDefRe = /\.([A-Za-z][\w-]*)/g;
const definedClasses = new Set();
let m;
while ((m = classDefRe.exec(styles))) definedClasses.add(m[1]);

const bodyNoStyle = HTML.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '');
const unusedClasses = [...definedClasses].filter(c => {
  // class="a b"、classList.add('a')、模板字符串里的 class 都算使用
  const re = new RegExp('(?<![\\w-])' + c.replace(/[-]/g, '\\-') + '(?![\\w-])', 'g');
  return !re.test(bodyNoStyle);
}).sort();

/* ---------- 3) IPC ---------- */
const mainChannels = new Set();
for (const re of [/ipcMain\.handle\(\s*'([^']+)'/g, /ipcMain\.on\(\s*'([^']+)'/g]) {
  re.lastIndex = 0;
  while ((m = re.exec(MAIN))) mainChannels.add(m[1]);
}
const preloadChannels = new Set();
// preload 用 const invoke = (ch, ...) => ipcRenderer.invoke(ch, ...) 封装，故同时匹配 invoke('x')
for (const re of [/\binvoke\(\s*'([^']+)'/g, /ipcRenderer\.invoke\(\s*'([^']+)'/g,
  /ipcRenderer\.send\(\s*'([^']+)'/g, /ipcRenderer\.sendSync\(\s*'([^']+)'/g]) {
  re.lastIndex = 0;
  while ((m = re.exec(PRELOAD))) preloadChannels.add(m[1]);
}
const deadMain = [...mainChannels].filter(c => !preloadChannels.has(c));

/* ---------- 4) 调试残留 ---------- */
const debugHits = [];
for (const [label, text] of [['HTML', HTML], ...SRC.map(([f, t]) => ['src/' + f, t]), ['main.js', MAIN], ['preload.js', PRELOAD]]) {
  const ls = text.split('\n');
  ls.forEach((ln, i) => {
    if (/data:image/.test(ln)) return;   // base64 图片里可能恰好含 XXX，跳过
    if (/console\.(log|debug)\(|debugger;|\bTODO\b|\bFIXME\b|\bXXX\b|\balert\(|window\.__debug/.test(ln)) {
      debugHits.push({ file: label, line: i + 1, text: ln.trim().slice(0, 110) });
    }
  });
}

/* ---------- 输出 ---------- */
console.log('══ 1) 疑似未使用的前端函数（定义处之外无引用） ══');
console.log('函数总数：', defs.size, ' 疑似未使用：', unusedFns.length);
unusedFns.sort((a, b) => a.line - b.line).forEach(f => console.log(`  L${f.line}  ${f.name}   defs=${f.count} refs=${f.refs} html=${f.htmlRefs}`));

console.log('\n══ 2) CSS 中定义但正文未出现的类 ══');
console.log('类总数：', definedClasses.size, ' 未使用：', unusedClasses.length);
console.log('  ' + unusedClasses.join('  '));

console.log('\n══ 3) 主进程 IPC 注册但 preload 未暴露 ══');
console.log('main 注册：', mainChannels.size, ' preload 暴露：', preloadChannels.size, ' 疑似废弃：', deadMain.length);
console.log('  ' + deadMain.join('\n  '));

console.log('\n══ 4) 调试残留 / TODO ══');
console.log('命中：', debugHits.length);
debugHits.forEach(h => console.log(`  ${h.file}:${h.line}  ${h.text}`));
