/**
 * 从「模拟题库-Web版.html」中提取纯函数/常量用于单元测试。
 * 网页版必须保持单文件离线可用，无法拆模块，
 * 因此测试通过提取源码 + new Function 注入依赖的方式来测真实代码。
 */
const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, '..', '..', '模拟题库-Web版.html');

function readHTML() {
  /* 统一成 LF：源码文件在 Windows 上是 CRLF，下面的 `\n}\n` 与 `^const` 都按单字节换行写的，
   * 不归一化会整片提取失败（与业务代码无关的测试基建问题）。 */
  return fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');
}

/** 提取顶层函数源码：以 `(async )?function NAME` 起、以行首 `}` 终 */
function extractFn(name) {
  const src = readHTML();
  const re = new RegExp('(?:^|\\n)(async )?function ' + name + '\\b');
  const m = src.match(re);
  if (!m) throw new Error(`未找到函数 ${name}`);
  let start = m.index;
  if (src[start] === '\n') start++;
  const end = src.indexOf('\n}\n', start);
  if (end < 0) throw new Error(`未找到函数 ${name} 的结束`);
  return src.slice(start, end + 2);   // 含结尾的 '}'
}

/** 提取 const（单行或多行数组/Set），如 shuffle / KP_STOP_W */
function extractConst(name) {
  const src = readHTML();
  const re = new RegExp('^const ' + name + ' = ', 'm');
  const m = src.match(re);
  if (!m) throw new Error(`未找到常量 ${name}`);
  const start = m.index;
  const lineEnd = src.indexOf('\n', start);
  const first = src.slice(start, lineEnd);
  // ① 单行：以 ; 结尾（可带注释）
  if (/;\s*(\/\/.*)?$/.test(first)) return first.replace(/\s*\/\/.*$/, '');
  // ② 多行：括号配平，找到与开头配对的右括号后再吃到分号
  let i = start + m[0].length, depth = 0, quote = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) { i = src.indexOf(';', i); break; }
    }
  }
  if (i < 0) throw new Error(`常量 ${name} 未正确结束`);
  return src.slice(start, i + 1);
}

/**
 * 提取一组名字（函数或单行 const），用 new Function 注入依赖后返回 { name: fn }。
 * @param {string[]} names  要提取的函数/常量名
 * @param {object}   ctx    注入的外部依赖（如 state / DB / toast / matchSubject）
 */
function loadFns(names, ctx = {}) {
  const parts = names.map(n => {
    try { return extractFn(n); } catch (e) { return extractConst(n); }
  });
  const body = parts.join('\n') + '\nreturn { ' + names.join(', ') + ' };';
  const keys = Object.keys(ctx);
  // eslint-disable-next-line no-new-func
  const factory = new Function(...keys, body);
  return factory(...keys.map(k => ctx[k]));
}

module.exports = { extractFn, extractConst, loadFns, HTML_PATH };
