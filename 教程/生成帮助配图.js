/* 把 教程/截图精简/*.jpg 生成帮助手册配图（v1.42.0 起三产物，幂等可重复运行）：
 *   ① src/helpimgs.js      —— 网页版内嵌数据（经 build.js 注入 HTML 标记区）
 *   ② desktop/help-imgs.json —— 纯数据，打包时进 resources/，preload 注入桌面版
 *   ③ 触发 node build.js 回填 HTML
 * 用法：node 教程/生成帮助配图.js */
const fs = require('fs');
const path = require('path');

const ROOT = 'D:/AI/WorkBuddy/模拟题库软件';
const SRC = path.join(ROOT, '教程/截图精简');
const SKIP = ['14-帮助手册'];   // 帮助页自身截图不需要

const files = fs.readdirSync(SRC).filter(f => f.endsWith('.jpg'))
  .filter(f => !SKIP.some(s => f.startsWith(s))).sort();
const data = {};
for (const f of files) {
  const key = 's' + f.replace(/\.jpg$/, '').split('-')[0];
  data[key] = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(SRC, f)).toString('base64');
}
const lines = Object.entries(data).map(([k, v]) => `  ${k}: '${v}',`);

/* ① src/helpimgs.js */
fs.writeFileSync(path.join(ROOT, 'src/helpimgs.js'), `/* 帮助手册配图（由 教程/生成帮助配图.js 自动生成，勿手改；改图后运行 node build.js）
 * 网页版：HELP_IMGS_EMBED 内嵌 base64，单文件即用；
 * 桌面版：打包时 afterPack 钩子把本标记区裁剪成存根，数据由 preload
 *         从 resources/help-imgs.json 注入 window.__HELP_IMGS__，启动少解析 1.7MB。 */
const HELP_IMGS_EMBED = {
${lines.join('\n')}
};
const HELP_IMGS = (typeof window !== 'undefined' && window.__HELP_IMGS__) || HELP_IMGS_EMBED;
`);

/* ② desktop/help-imgs.json */
fs.writeFileSync(path.join(ROOT, 'desktop/help-imgs.json'), JSON.stringify(data));

/* ③ 回填 HTML */
const { build } = require(path.join(ROOT, 'build.js'));
const HTML = path.join(ROOT, '模拟题库-Web版.html');
fs.writeFileSync(HTML, build(fs.readFileSync(HTML, 'utf8')));

const total = Object.values(data).reduce((s, v) => s + v.length, 0);
console.log(`✓ ${files.length} 张配图 → src/helpimgs.js + desktop/help-imgs.json（共 ${(total / 1048576).toFixed(2)}MB），HTML 已回填 ${(fs.statSync(HTML).size / 1048576).toFixed(2)}MB`);
