/**
 * 一次性脚本：给核心工具函数 / 路由 / 关键算法补中文 JSDoc 注释
 * 已存在前置注释的函数自动跳过，可重复执行。
 */
const fs = require('fs');
const path = require('path');
const P = path.join(__dirname, '..', '模拟题库-Web版.html');

const NOTES = {
  clampNavW: '/** 把任意输入夹到 [NAVW_MIN, NAVW_MAX] 并取整；非法值回退默认宽度 */',
  toast: '/** 轻提示：追加到 #toast 容器，3 秒后自动移除；type = \'ok\' 绿 / \'err\' 红 / \'amber\' 黄 */',
  modal: '/** 打开通用弹窗：内容由调用方给整段 HTML；点遮罩或 Esc 关闭（见 modalMaskClose） */',
  closeModal: '/** 关闭弹窗并清空容器，不残留 DOM 与旧的事件监听 */',
  parseJSON: '/** 从 AI 回复里截出第一个 {...} 再解析——模型常带「好的，以下是 JSON」这类前后缀 */',
  sanitizeText: '/** 入库 / 显示前统一清洗：去替换符与控制字符、统一换行、压掉多余空行 */',
  tfBool: '/** 判断题答案归一化：正确/对/是/T/√ → true，错误/错/否/F/× → false，其它 → null */',
  gradeObjective: '/** 客观题判分：判断题走 tfBool 归一；多选题按字母排序后比较（不计顺序）；其余去空格后精确比对 */',
  impOf: '/** 知识点重要度（1~5 星）；缺省或越界一律按 3 星处理 */',
  qNote: '/** 题目笔记正文；没有笔记时返回空串，免得调用方到处判 undefined */',
  go: '/** 路由入口：切 #view 内容 + 侧栏高亮 + 手机标题；跳进板块内视图时自动跟随板块（VIEW_SEC） */',
  mDrawer: '/** 手机抽屉开合：body.m-drawer 驱动 CSS 平移，打开时同步遮罩与板块高亮 */',
  initPwa: '/** 生成 Web App Manifest 与图标（canvas 现画，不依赖外置文件），让手机可「添加到主屏幕」；桌面版直接返回 */',
  pwaInstall: '/** 触发浏览器安装提示（beforeinstallprompt 暂存的事件）；不支持的浏览器给出操作指引 */',
  checkAppUpdate: '/** 检查更新：silent=true 时静默（启动自动查），有结果才提示；失败不打扰用户 */',
};

let src = fs.readFileSync(P, 'utf8');
let added = 0, skipped = [];
for (const [name, note] of Object.entries(NOTES)) {
  const re = new RegExp('^(\\s*)((?:async\\s+)?function\\s+' + name + '\\s*\\()', 'm');
  const m = re.exec(src);
  if (!m) { skipped.push(name + '（未找到定义）'); continue; }
  const lineStart = src.lastIndexOf('\n', m.index) + 1;
  const prevLine = src.slice(src.lastIndexOf('\n', lineStart - 2) + 1, lineStart).trim();
  if (/^(\/\/|\*|\/\*)/.test(prevLine)) { skipped.push(name + '（已有注释）'); continue; }
  const indent = m[1];
  src = src.slice(0, lineStart) + indent + note + '\n' + src.slice(lineStart);
  added++;
}
fs.writeFileSync(P, src);
console.log('已补注释：', added, ' 跳过：', skipped.length ? skipped.join('、') : '无');
