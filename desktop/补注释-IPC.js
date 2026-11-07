/**
 * 一次性脚本：给主进程每个 IPC 通道补一行中文说明（接口备注）
 * 已有前置注释的自动跳过，可重复执行。
 */
const fs = require('fs');
const path = require('path');
const P = path.join(__dirname, 'main.js');

const NOTES = {
  'data:get': '取单条记录：按 id 在当前题库的 store 里查，找不到返回 null',
  'data:add': '新增记录：自增 id = max(现有最大 id, seq) + 1，写完立即落盘，返回新 id',
  'data:put': '覆盖整条记录（按 id 定位；不存在则追加），用于编辑题目/文档',
  'data:del': '按 id 删除单条记录',
  'data:clear': '清空某个 store（危险操作，前端必须二次确认）',
  'kv:get': '读全局 kv；settings 会自动解密其中的 apiKey（safeStorage / DPAPI）',
  'kv:set': '写全局 kv；settings 落盘前把 apiKey 加密，渲染层无感知',
  'bankkv:set': '写题库私有 kv（subjects 等随题库隔离的数据）',
  'bank:list': '题库列表 + 各库计数（文档/题目/试卷/练习/错题/复习），供题库管理页渲染',
  'bank:current': '当前题库 id',
  'bank:create': '新建题库：名称去空格限 20 字、重名校验，初始化空数据结构',
  'bank:switch': '切换当前题库：先 flush 旧库缓存再载入新库，返回新库数据',
  'bank:rename': '重命名题库（改名不影响数据文件与其内容）',
  'bank:del': '删除题库及其数据文件；删的是当前库时自动切回默认库',
  'app:openDataDir': '在资源管理器中定位当前题库的数据文件',
  'kbdoc:dir': '知识库目录绝对路径（不存在则自动创建）',
  'kbdoc:list': '列出 knowledge/*.md：name / size / mtime / ctime，按修改时间倒序',
  'kbdoc:read': '读单个 MD 文档正文（入参 name 不带 .md 后缀）',
  'kbdoc:write': '写 MD 文档：自动补 .md、替换 Windows 非法字符，返回 mtime',
  'kbdoc:del': '删除文档：移到 knowledge/.trash/（带时间戳），可手工找回',
  'kbdoc:rename': '重命名文档；目标同名时拒绝并返回错误',
  'app:importAll': '全量恢复：用备份文件覆盖所有题库与全局设置，恢复前自动留底到 backups/before-restore-*',
  'data:choosePath': '选择新的数据目录（可指向同步盘 / 移动硬盘），必要时把现有数据迁过去',
  'data:resetPath': '数据目录恢复默认位置（userData）',
  'file:import': '弹文件选择框并解析 PDF / DOCX / TXT / MD，返回每份的纯文本与页数',
  'file:save': '弹保存对话框写文件：导出 JSON 备份 / 题库包 / Anki 卡片 / 模板等都走这里',
  'ai:chat': 'AI 请求代理（主进程发出，绕过浏览器跨域）：429/5xx/网络错误指数退避重试，4xx 直接失败',
  'web:search': '联网查询：抓搜索结果页并解析为 [{title,url,snippet,site}]',
  'app:version': '当前应用版本号（安装包实际版本，用于标题栏与更新判断）',
  'win:min': '自绘标题栏：最小化窗口',
  'win:maxToggle': '自绘标题栏：最大化 / 还原切换',
  'win:close': '自绘标题栏：关闭窗口（按 settings.closeAction 决定最小化到托盘还是退出）',
};

let src = fs.readFileSync(P, 'utf8');
const lines = src.split('\n');
const out = [];
let added = 0, skipped = [];
for (let i = 0; i < lines.length; i++) {
  const ln = lines[i];
  const m = /^(\s*)ipcMain\.(handle|on)\(\s*'([^']+)'/.exec(ln);
  if (m && NOTES[m[3]]) {
    const prev = (out[out.length - 1] || '').trim();
    const hasNote = /^(\/\/|\*|\/\*\*)/.test(prev) || prev.endsWith('*/');
    if (hasNote) skipped.push(m[3]);
    else { out.push(m[1] + '/** ' + NOTES[m[3]] + ' */'); added++; }
  }
  out.push(ln);
}
fs.writeFileSync(P, out.join('\n'));
console.log('IPC 注释已补：', added, ' 已有注释跳过：', skipped.length ? skipped.join('、') : '无');
