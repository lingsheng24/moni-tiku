/**
 * 模拟题库 · 桌面版主进程
 * - 本地 JSON 存储（userData/data.json）
 * - 本地文件解析（PDF / DOCX / TXT / MD）
 * - AI 请求代理（主进程发出，免受浏览器跨域限制）
 * - 文件保存对话框（导出 Word / 备份 JSON）
 */
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

/* ---------------- 启动诊断日志（v1.36.1） ----------------
 * 排查「点了没窗口 / 进程自己退出」这类问题，光看现象没法定位，
 * 所以在主进程关键节点写一份日志到系统临时目录 moni-tiku-boot.log。
 * 只在本地留痕，不联网、不影响正常使用；超过 128KB 自动重建。 */
const BOOT_LOG = path.join(os.tmpdir(), 'moni-tiku-boot.log');
function blog(...args) {
  try {
    if (fs.existsSync(BOOT_LOG) && fs.statSync(BOOT_LOG).size > 128 * 1024) fs.unlinkSync(BOOT_LOG);
    fs.appendFileSync(BOOT_LOG, `[${new Date().toISOString()}] ${args.join(' ')}\n`);
  } catch (_) { /* 日志失败绝不影响启动 */ }
}
process.on('uncaughtException', e => blog('uncaughtException:', (e && e.stack) || e));
process.on('unhandledRejection', e => blog('unhandledRejection:', (e && e.stack) || e));
/* 排障开关：设 MTK_DEBUG_PORT 环境变量可远程调试页面（打包版不透传命令行开关，须在 ready 前 appendSwitch） */
if (process.env.MTK_DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.MTK_DEBUG_PORT);

const { atomicWriteJson, rotateBackup, readJsonWithRecovery } = require('./safeSave');
/* v1.41.0：全量备份容器与搜索引擎健康度（纯函数模块，见各自文件头注释） */
const { buildBundle, parseBundle } = require('./backupBundle');
const { createEngineHealth } = require('./engineHealth');
let JSZip = null;
try { JSZip = require('jszip'); } catch (e) { console.warn('jszip 未安装，试卷 Word 导出将不可用'); }

/* ================= 试卷 .docx 生成（手写 OOXML，不依赖 Word） =================
 * 输入是渲染层给出的「中间表示」blocks，与 PDF 用的 HTML 同源，
 * 因此同一套卷子在 Word 与 PDF 里内容完全一致。 */
const XESC = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** 半磅字号：五号 10.5pt=21，小四 12pt=24，四号 14pt=28，三号 16pt=32 */
function wRPr(o) {
  o = o || {};
  const ea = o.font || '宋体', ascii = o.ascii || (o.font === '黑体' ? 'SimHei' : 'SimSun');
  return `<w:rPr><w:rFonts w:ascii="${ascii}" w:hAnsi="${ascii}" w:eastAsia="${ea}" w:cs="${ea}"/>`
    + (o.b ? '<w:b/>' : '')
    + (o.color ? `<w:color w:val="${o.color}"/>` : '')
    + `<w:sz w:val="${o.sz || 21}"/><w:szCs w:val="${o.sz || 21}"/></w:rPr>`;
}
function wP(inner, pPr) { return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${inner}</w:p>`; }
function wT(t, o) { return `<w:r>${wRPr(o)}<w:t xml:space="preserve">${XESC(t)}</w:t></w:r>`; }
/** 一条空行（下边框 —— 用于填空 / 简答的作答空间） */
function wBlank(n) {
  let s = '';
  for (let i = 0; i < (n || 1); i++) {
    s += wP('', '<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="999999"/></w:pBdr><w:spacing w:after="20"/>');
  }
  return s;
}
function blockToOOXML(b) {
  switch (b.k) {
    case 'h1': return wP(wT(b.t, { sz: 32, b: true, font: '黑体' }), '<w:jc w:val="center"/><w:spacing w:after="60"/>');
    case 'meta': return wP(wT(b.t), '<w:jc w:val="center"/><w:spacing w:after="40"/>');
    case 'info': return wP(wT(b.t), '<w:spacing w:after="40"/>');
    case 'rule': return wP('', '<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="1" w:color="000000"/></w:pBdr><w:spacing w:after="120"/>');
    case 'sec': return wP(wT(b.t, { sz: 22, b: true }), '<w:spacing w:before="160" w:after="60"/>');
    case 'q': return wP(wT(`${b.no}. ${b.t || ''}${b.tail || ''}${b.score ? `（${b.score}分）` : ''}`), '<w:spacing w:after="40"/><w:jc w:val="both"/>');
    case 'opts':
      if (b.inline) return wP(wT(b.arr.join('　　')), '<w:ind w:left="480"/><w:spacing w:after="40"/>');
      return b.arr.map(o => wP(wT(o), '<w:ind w:left="480"/><w:spacing w:after="20"/>')).join('');
    case 'blank': return wBlank(b.n);
    case 'ans': return wP(wT(b.t, { sz: 19, color: 'B91C1C' }), '<w:ind w:left="480"/><w:spacing w:after="60"/>');
    default: return '';
  }
}
/** 节属性：A3 = 16838×23811 twips 分两栏，A4 = 11906×16838 单栏
 *  子元素顺序必须 type → pgSz → pgMar → cols，否则 Word 会报文档损坏 */
function wSect(size, cols, samePage) {
  const A3 = size === 'A3';
  const w = A3 ? 16838 : 11906, h = A3 ? 23811 : 16838, m = A3 ? 1134 : 1440;
  return (samePage ? '<w:type w:val="continuous"/>' : '')
    + `<w:pgSz w:w="${w}" w:h="${h}"/>`
    + `<w:pgMar w:top="${m}" w:right="${m}" w:bottom="${m}" w:left="${m}" w:header="851" w:footer="992" w:gutter="0"/>`
    + `<w:cols w:num="${cols}"${cols > 1 ? ' w:space="1020"' : ''}/>`;
}
const HEAD_KEYS = ['h1', 'meta', 'info', 'rule'];
async function buildDocx(blocks, size) {
  if (!JSZip) throw new Error('缺少 jszip 组件，无法生成 .docx');
  const A3 = size === 'A3';
  const head = blocks.filter(b => HEAD_KEYS.includes(b.k)).map(blockToOOXML).join('');
  const body = blocks.filter(b => !HEAD_KEYS.includes(b.k)).map(blockToOOXML).join('');
  // 抬头独占整幅宽度（第一节单栏）；题目部分按纸张分栏（A3 两栏）
  const document =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${head}<w:p><w:pPr><w:sectPr>${wSect(size, 1, true)}</w:sectPr></w:pPr></w:p>
${body}<w:p><w:pPr><w:sectPr>${wSect(size, A3 ? 2 : 1, false)}</w:sectPr></w:pPr></w:p>
</w:body></w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults>
<w:rPrDefault><w:rPr><w:rFonts w:ascii="SimSun" w:hAnsi="SimSun" w:eastAsia="宋体" w:cs="宋体"/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault>
</w:docDefaults></w:styles>`;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypes);
  zip.file('_rels/.rels', rootRels);
  zip.file('word/document.xml', document);
  zip.file('word/_rels/document.xml.rels', docRels);
  zip.file('word/styles.xml', styles);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

let win = null;
let mammoth = null, pdfjs = null;
try { mammoth = require('mammoth'); } catch (e) { console.warn('mammoth 未安装'); }
/** pdfjs-dist v4 仅提供 ESM，主进程按需动态 import */
async function getPdfjs() {
  if (pdfjs) return pdfjs;
  try {
    /* v1.40.0：legacy → 标准 build（Electron 33 = Node 20，无需旧环境兼容层），
     * 配合 package.json files 排除 legacy/**，安装包减约 10MB。已用 Node 22 实测解析 PDF 正常。 */
    const m = await import('pdfjs-dist/build/pdf.mjs');
    const worker = require('path').join(require('path').dirname(require.resolve('pdfjs-dist/package.json')), 'build', 'pdf.worker.mjs');
    m.GlobalWorkerOptions.workerSrc = require('url').pathToFileURL(worker).href;
    pdfjs = m;
  } catch (e) { console.warn('pdfjs 加载失败:', e.message); pdfjs = null; }
  return pdfjs;
}

/* ---------------- 汉化应用菜单 ---------------- */
function setupChineseMenu() {
  const send = action => () => { if (win && !win.isDestroyed()) win.webContents.send('menu', action); };
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '导入文档…', accelerator: 'CmdOrCtrl+O', click: send('import') },
        { type: 'separator' },
        { label: '系统设置', accelerator: 'CmdOrCtrl+,', click: send('settings') },
        { label: '退出', accelerator: 'Alt+F4', role: 'quit' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' }, { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' }, { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' }, { label: '全选', role: 'selectAll' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '刷新页面', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: '强制刷新', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
        { type: 'separator' },
        { label: '放大', accelerator: 'CmdOrCtrl+=', role: 'zoomIn' },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: '重置缩放', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { type: 'separator' },
        { label: '全屏', accelerator: 'F11', role: 'togglefullscreen' },
        { label: '开发者工具', accelerator: 'CmdOrCtrl+Shift+I', role: 'toggleDevTools' },
      ],
    },
    {
      label: '数据',
      submenu: [
        { label: '打开数据文件夹', click: send('open-data-dir') },
        { label: '修改数据文件路径…', click: send('set-data-path') },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { label: '最小化', role: 'minimize' },
        { label: '关闭窗口', role: 'close' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '检查更新', click: send('check-update') },
        {
          label: '关于 模拟题库',
          click: () => dialog.showMessageBox(win, {
            type: 'info', title: '关于',
            message: '模拟题库 桌面版',
            detail: `版本 ${require('./package.json').version}\n本地文档出题 · AI 判分 · 间隔复习 · 模拟考试\n\n数据保存在本机，不会上传服务器。`,
            buttons: ['确定'],
          }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------------- 本地数据存储 ---------------- */
/** 数据文件路径配置（允许用户把 data.json 挪到任意位置，如同步盘/移动硬盘） */
const pathCfgFile = () => path.join(app.getPath('userData'), 'data-path.json');
function readPathCfg() {
  try {
    const c = JSON.parse(fs.readFileSync(pathCfgFile(), 'utf8'));
    return c && typeof c.customPath === 'string' ? c : {};
  } catch (e) { return {}; }
}
function dataFile() {
  const cfg = readPathCfg();
  if (cfg.customPath) return cfg.customPath;
  return path.join(app.getPath('userData'), 'data.json');
}
let cache = null;        // 主文件 data.json（元数据）：{ curBank, kv(全局), banks:{id:{name,createdAt}} }
let bankCache = null;    // 当前题库数据文件 banks/<id>.json：{ name, docs…, seq, kv(题库私有，如 subjects) }
/* ---------------- 多题库 · 每题库独立数据文件（v1.32.0） ----------------
 * 布局：<数据目录>/data.json（题库清单 + 全局配置）+ <数据目录>/banks/<id>.json（各题库全部数据）。
 * 新建题库 = 立即创建独立 JSON 文件；切换 = 主进程换载文件，秒级完成；
 * 备份 / 同步 / 迁移可以按题库文件粒度进行。
 * 自动迁移（幂等）：① v1.30- 扁平结构 → 「我的题库」；② v1.31 单文件内嵌 banks → 拆分为独立文件。
 * 注意：迁移后的 data.json 旧版本软件读不到题库数据（数据完好，用 v1.32.0+ 打开即恢复）。 */
const DEFAULT_BANK = 'default';
const BANK_ID_RE = /[^a-z0-9]/gi;   // id 只允许字母数字，防路径穿越
function normBank(b) {
  for (const s of STORE_KEYS) if (!Array.isArray(b[s])) b[s] = [];
  if (!b.seq || typeof b.seq !== 'object') b.seq = {};
  if (!b.kv || typeof b.kv !== 'object') b.kv = {};
  return b;
}
function banksDir() { return path.join(path.dirname(dataFile()), 'banks'); }
function bankFile(id) { return path.join(banksDir(), String(id).replace(BANK_ID_RE, '') + '.json'); }
function loadMeta() {
  if (cache) return cache;
  // 主文件损坏时自动从 backups/ 里最近的可用备份恢复（读不出则返回 null）
  cache = readJsonWithRecovery(dataFile());
  if (!cache || typeof cache !== 'object') cache = {};
  if (!cache.kv || typeof cache.kv !== 'object') cache.kv = {};
  if (!cache.banks || typeof cache.banks !== 'object') cache.banks = {};
  let migrated = false;
  /* ① v1.30- 扁平结构：顶层 docs/questions/… + seq + kv.subjects → 内嵌「我的题库」 */
  if (Array.isArray(cache.docs)) {
    const bank = { name: '我的题库', createdAt: new Date().toISOString() };
    for (const s of STORE_KEYS) bank[s] = cache[s];
    bank.seq = cache.seq && typeof cache.seq === 'object' ? cache.seq : {};
    bank.kv = {};
    if (Array.isArray(cache.kv.subjects)) bank.kv.subjects = cache.kv.subjects;   // 科目随题库隔离
    delete cache.kv.subjects;
    for (const s of STORE_KEYS) delete cache[s];
    delete cache.seq;
    cache.banks[DEFAULT_BANK] = normBank(bank);
    migrated = true;
    console.log('[数据] 已迁移 v1.30- 扁平数据 → 多题库结构（原数据 → 「我的题库」）');
  }
  /* ② v1.31 单文件内嵌 banks（条目含 docs 数组）→ 拆分为 banks/<id>.json 独立文件 */
  for (const id of Object.keys(cache.banks)) {
    const b = cache.banks[id];
    if (!b || typeof b !== 'object') { delete cache.banks[id]; migrated = true; continue; }
    if (Array.isArray(b.docs)) {
      try {
        const data = normBank({
          name: b.name, createdAt: b.createdAt,
          docs: b.docs, questions: b.questions, mistakes: b.mistakes,
          practice: b.practice, exams: b.exams, review: b.review, seq: b.seq, kv: b.kv,
        });
        fs.mkdirSync(banksDir(), { recursive: true });
        atomicWriteJson(bankFile(id), data);
        cache.banks[id] = { name: b.name || '未命名题库', createdAt: b.createdAt };
        migrated = true;
      } catch (e) { console.error('[数据] 题库拆分失败（保留内嵌数据，下次再试）:', id, e); }
    }
  }
  if (!cache.banks[DEFAULT_BANK]) {
    cache.banks[DEFAULT_BANK] = { name: '我的题库', createdAt: new Date().toISOString() };
    try { createBankFile(DEFAULT_BANK); } catch (e) { console.error('[数据] 默认题库文件创建失败:', e); }
  }
  if (typeof cache.curBank !== 'string' || !cache.banks[cache.curBank]) cache.curBank = DEFAULT_BANK;
  if (migrated) saveMeta();
  return cache;
}
function createBankFile(id) {
  const e = loadMeta().banks[id] || {};
  fs.mkdirSync(banksDir(), { recursive: true });
  atomicWriteJson(bankFile(id), normBank({ name: e.name || '未命名题库', createdAt: e.createdAt || new Date().toISOString() }));
}
/* 当前题库数据（data:xx 系列操作的实际目标），惰性换载 */
function loadCur() {
  if (bankCache) return bankCache;
  const meta = loadMeta();
  let data = readJsonWithRecovery(bankFile(meta.curBank));
  if (!data || typeof data !== 'object') data = {};
  if (!data.name) data.name = (meta.banks[meta.curBank] || {}).name || '我的题库';
  bankCache = normBank(data);
  return bankCache;
}
function cur() { return loadCur(); }
/* 滚动备份节流：距上次备份超过 1 小时才再做一份，避免每次保存都写备份 */
const BACKUP_INTERVAL_MS = 60 * 60 * 1000;
let lastBackupAt = 0;
function saveMeta() {
  try {
    const f = dataFile();
    /* v1.40.0：meta 也进滚动备份（与题库共用 1 小时节流），损坏时 readJsonWithRecovery 才有真备份可恢复 */
    if (fs.existsSync(f) && Date.now() - lastBackupAt > BACKUP_INTERVAL_MS) {
      try { rotateBackup(f, 5); lastBackupAt = Date.now(); }
      catch (e) { console.error('[数据] 元数据备份失败（不影响保存）', e); }
    }
    atomicWriteJson(f, cache || loadMeta());
    return true;
  }
  catch (e) { console.error('[数据] 元数据保存失败', e); return false; }
}
function saveBank() {
  try {
    const f = bankFile(loadMeta().curBank);
    fs.mkdirSync(banksDir(), { recursive: true });
    if (fs.existsSync(f) && Date.now() - lastBackupAt > BACKUP_INTERVAL_MS) {
      try { rotateBackup(f, 5); lastBackupAt = Date.now(); }
      catch (e) { console.error('[数据] 备份失败（不影响保存）', e); }
    }
    atomicWriteJson(f, bankCache || loadCur());
    return true;
  } catch (e) { console.error('[数据] 题库保存失败', e); return false; }
}
const STORES = ['docs', 'questions', 'mistakes', 'practice', 'exams', 'review'];
const STORE_KEYS = STORES;   // 别名：数据层规范化用

/* ---------------- 每日全量快照（v1.40.0） ----------------
 * 每天首次启动把 data.json + banks/*.json 完整复制到 backups/daily/YYYY-MM-DD/，
 * 保留最近 7 天（目录名即日期，超出自动删最旧）。
 * 与 rotateBackup 的差别：滚动备份只留最近几小时，每日快照保证「至少能回到昨天」。 */
const DAILY_SNAPSHOT_KEEP = 7;
function dailySnapshot() {
  try {
    const dataPath = path.dirname(dataFile());
    const dailyRoot = path.join(dataPath, 'backups', 'daily');
    const today = new Date().toISOString().slice(0, 10);
    const dest = path.join(dailyRoot, today);
    if (fs.existsSync(dest)) return;   // 今天已经快照过
    fs.mkdirSync(dest, { recursive: true });
    let n = 0;
    const files = [dataFile()];
    try {
      for (const f of fs.readdirSync(banksDir())) {
        if (f.endsWith('.json')) files.push(path.join(banksDir(), f));
      }
    } catch (_) { /* banks 目录不存在（首次运行）就只快照 meta */ }
    for (const f of files) {
      if (fs.existsSync(f)) { fs.copyFileSync(f, path.join(dest, path.basename(f))); n++; }
    }
    if (n === 0) { fs.rmSync(dest, { recursive: true, force: true }); return; }   // 首次运行无数据，不留空快照
    // 清理超过保留天数的旧快照
    const days = fs.readdirSync(dailyRoot).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
    for (const d of days.slice(DAILY_SNAPSHOT_KEEP)) {
      try { fs.rmSync(path.join(dailyRoot, d), { recursive: true, force: true }); } catch (_) { }
    }
    console.log(`[数据] 每日快照完成：${today}（${n} 个文件，保留最近 ${DAILY_SNAPSHOT_KEEP} 天）`);
  } catch (e) {
    console.error('[数据] 每日快照失败（不影响使用）:', e && e.message);
  }
}
function regData() {
  /* v1.31.0 起 data:xx 系列全部作用于「当前题库」（cur()），多题库间数据完全隔离 */
  ipcMain.handle('data:all', (e, store) => { if (!STORES.includes(store)) return []; return cur()[store]; });
  ipcMain.handle('data:get', (e, store, id) => cur()[store].find(x => x.id === id) || null);
  ipcMain.handle('data:add', (e, store, item) => {
    const d = cur();
    const maxId = d[store].reduce((m, x) => Math.max(m, x.id || 0), 0);
    const next = Math.max(maxId, d.seq[store] || 0) + 1;
    item.id = next; d.seq[store] = next;
    d[store].push(item); saveBank(); return next;
  });
  ipcMain.handle('data:put', (e, store, item) => {
    const d = cur(); const i = d[store].findIndex(x => x.id === item.id);
    if (i >= 0) d[store][i] = item; else d[store].push(item);
    saveBank(); return true;
  });
  ipcMain.handle('data:del', (e, store, id) => {
    const d = cur(); d[store] = d[store].filter(x => x.id !== id); saveBank(); return true;
  });
  ipcMain.handle('data:clear', (e, store) => { const d = cur(); d[store] = []; saveBank(); return true; });
  /* ---- settings 透明加解密（v1.40.0）----
   * apiKey 原来明文躺在 meta.json 里，现在用 safeStorage（Windows DPAPI，绑定当前用户）加密。
   * 渲染进程无感知：kv:get('settings') 返回时已解密；kv:set('settings', …) 落盘前已加密。
   * safeStorage 不可用（极少数环境）时回落明文，行为与旧版一致。 */
  const sealSettings = (s) => {
    try {
      const out = { ...s };
      if (typeof out.apiKey === 'string' && out.apiKey && safeStorage.isEncryptionAvailable()) {
        out.apiKeyEnc = safeStorage.encryptString(out.apiKey).toString('base64');
      }
      delete out.apiKey;   // 无论是否加密成功，落盘都不留明文
      return out;
    } catch (e) { console.error('[设置] apiKey 加密失败，本次按明文兜底:', e && e.message); return { ...s, apiKey: (s && s.apiKey) || '' }; }
  };
  const unsealSettings = (s) => {
    const out = { ...s };
    delete out.apiKey;                          // 历史明文不外泄
    if (out.apiKeyEnc) {
      try {
        out.apiKey = safeStorage.decryptString(Buffer.from(out.apiKeyEnc, 'base64'));
      } catch (e) {
        // 换机器 / 重装系统后 DPAPI 解不开：清掉密文让用户重填，绝不把乱码当 Key 用
        console.error('[设置] apiKey 解密失败（换机或系统变更？），已清空待重填:', e && e.message);
        delete out.apiKeyEnc; delete out.apiKey;
      }
    }
    return out;
  };
  ipcMain.handle('kv:get', (e, k) => {
    const v = loadMeta().kv[k] ?? null;
    return (k === 'settings' && v && typeof v === 'object') ? unsealSettings(v) : v;
  });
  ipcMain.handle('kv:set', (e, k, v) => {
    loadMeta().kv[k] = (k === 'settings' && v && typeof v === 'object') ? sealSettings(v) : v;
    saveMeta(); return true;
  });
  /* 题库私有 kv（v1.31.0）：目前存 subjects——科目随题库隔离 */
  ipcMain.handle('bankkv:get', (e, k) => cur().kv[k] ?? null);
  ipcMain.handle('bankkv:set', (e, k, v) => { cur().kv[k] = v; saveBank(); return true; });

  /* ---- 题库管理（v1.31.0；v1.32.0 起每题库一个独立数据文件） ---- */
  const bankCounts = (id) => {
    const b = (id === loadMeta().curBank) ? cur() : readJsonWithRecovery(bankFile(id)) || {};
    return {
      docs: (b.docs || []).length, questions: (b.questions || []).length, exams: (b.exams || []).length,
      practice: (b.practice || []).length, mistakes: (b.mistakes || []).length, review: (b.review || []).length,
    };
  };
  const bankList = () => Object.entries(loadMeta().banks).map(([id, b]) => ({ id, name: b.name, createdAt: b.createdAt, counts: bankCounts(id) }));
  ipcMain.handle('bank:list', () => bankList());
  ipcMain.handle('bank:current', () => loadMeta().curBank);
  ipcMain.handle('bank:create', (e, name) => {
    name = String(name || '').trim().slice(0, 20);
    if (!name) return { ok: false, error: '题库名不能为空' };
    const d = loadMeta();
    if (Object.values(d.banks).some(b => b.name === name)) return { ok: false, error: '已有同名题库' };
    const id = 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    d.banks[id] = { name, createdAt: new Date().toISOString() };
    try {
      createBankFile(id);        // v1.32.0：新建题库即创建独立数据文件
    } catch (err) {
      delete d.banks[id];
      return { ok: false, error: '创建数据文件失败：' + err.message };
    }
    saveMeta();
    return { ok: true, id, list: bankList() };
  });
  ipcMain.handle('bank:switch', (e, id) => {
    const d = loadMeta();
    if (!d.banks[id]) return { ok: false, error: '题库不存在' };
    if (d.curBank !== id) {
      saveBank();                // 保险：切走前把当前题库落盘
      d.curBank = id;
      bankCache = null;          // 换载目标题库文件
      loadCur();
      saveMeta();
    }
    return { ok: true, id };
  });
  ipcMain.handle('bank:rename', (e, id, name) => {
    const d = loadMeta();
    name = String(name || '').trim().slice(0, 20);
    if (!name) return { ok: false, error: '题库名不能为空' };
    if (!d.banks[id]) return { ok: false, error: '题库不存在' };
    if (Object.entries(d.banks).some(([k, b]) => k !== id && b.name === name)) return { ok: false, error: '已有同名题库' };
    d.banks[id].name = name;
    if (id === d.curBank && bankCache) bankCache.name = name;   // 当前库：数据文件里的名字同步
    saveMeta();
    if (id === d.curBank) saveBank();
    return { ok: true, list: bankList() };
  });
  ipcMain.handle('bank:del', (e, id) => {
    const d = loadMeta();
    if (id === DEFAULT_BANK) return { ok: false, error: '默认题库不可删除' };
    if (!d.banks[id]) return { ok: false, error: '题库不存在' };
    const n = bankCounts(id).questions;
    fs.rmSync(bankFile(id), { force: true });   // 删除该题库的独立数据文件
    delete d.banks[id];
    if (d.curBank === id) { d.curBank = DEFAULT_BANK; bankCache = null; loadCur(); }   // 删的是当前题库 → 自动切回默认
    saveMeta();
    return { ok: true, removedQuestions: n, curBank: d.curBank, list: bankList() };
  });
  ipcMain.handle('app:openDataDir', () => { shell.showItemInFolder(dataFile()); return true; });
  /* v1.40.0：打开每日快照目录（存在才打开，否则打开数据目录） */
  ipcMain.handle('app:openBackupDir', () => {
    const daily = path.join(path.dirname(dataFile()), 'backups', 'daily');
    try {
      if (fs.existsSync(daily)) { shell.openPath(daily); return true; }
    } catch (_) { }
    shell.showItemInFolder(dataFile());
    return true;
  });

  /* ---- v1.41.0 全量备份 / 恢复：所有题库 + 全局设置打进一个 JSON 文件 ----
   * 与「导出当前题库」互补：全量备份用于换机迁移 / 整目录恢复。
   * 备份文件不含 API Key（见 backupBundle.js）；恢复前自动把当前数据留一份可回退。 */
  ipcMain.handle('app:exportAll', async () => {
    try {
      saveBank();   // 当前题库先落盘，保证导出的是最新数据
      const meta = loadMeta();
      const banks = {};
      const dir = banksDir();
      if (fs.existsSync(dir)) {
        for (const f of fs.readdirSync(dir)) {
          if (!/^[a-z0-9]+\.json$/i.test(f)) continue;
          banks[f.replace(/\.json$/i, '')] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        }
      }
      const bundle = buildBundle({ meta, banks, appVer: app.getVersion() });
      const res = await dialog.showSaveDialog(win, {
        title: '导出全部数据（含所有题库）',
        defaultPath: '模拟题库全量备份_' + new Date().toISOString().slice(0, 10) + '.json',
        filters: [{ name: 'JSON 全量备份', extensions: ['json'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      if (res.canceled || !res.filePath) return { ok: false, canceled: true };
      let target = res.filePath;
      if (!target.toLowerCase().endsWith('.json')) target += '.json';
      atomicWriteJson(target, bundle);
      return { ok: true, path: target, banks: Object.keys(banks).length };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('app:importAll', async () => {
    try {
      const res = await dialog.showOpenDialog(win, {
        title: '从全量备份恢复（将覆盖当前全部数据）',
        filters: [{ name: 'JSON 全量备份', extensions: ['json'] }],
        properties: ['openFile'],
      });
      if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, canceled: true };
      let parsed;
      try { parsed = parseBundle(JSON.parse(fs.readFileSync(res.filePaths[0], 'utf8'))); }
      catch (e) { return { ok: false, error: '备份文件解析失败：' + e.message }; }
      if (!parsed.ok) return { ok: false, error: parsed.error };
      /* 恢复前先把当前数据完整留一份（backups/before-restore-时间戳/），可回退 */
      const before = path.join(path.dirname(dataFile()), 'backups',
        'before-restore-' + new Date().toISOString().replace(/[:.]/g, '-'));
      fs.mkdirSync(path.join(before, 'banks'), { recursive: true });
      if (fs.existsSync(dataFile())) fs.copyFileSync(dataFile(), path.join(before, 'data.json'));
      const srcBanks = banksDir();
      if (fs.existsSync(srcBanks)) {
        for (const f of fs.readdirSync(srcBanks)) {
          if (/^[a-z0-9]+\.json$/i.test(f)) fs.copyFileSync(path.join(srcBanks, f), path.join(before, 'banks', f));
        }
      }
      /* 保留本机已填的 API Key（备份文件不带密钥；换机恢复时这里自然为空，重填即可） */
      try {
        const curSettings = (loadMeta().kv || {}).settings || {};
        if (curSettings.apiKeyEnc || curSettings.apiKey) {
          if (!parsed.meta.kv || typeof parsed.meta.kv !== 'object') parsed.meta.kv = {};
          parsed.meta.kv.settings = {
            ...(parsed.meta.kv && parsed.meta.kv.settings || {}),
            ...(curSettings.apiKeyEnc ? { apiKeyEnc: curSettings.apiKeyEnc } : { apiKey: curSettings.apiKey }),
          };
        }
      } catch (_) { }
      fs.mkdirSync(banksDir(), { recursive: true });
      atomicWriteJson(dataFile(), parsed.meta);
      for (const id of Object.keys(parsed.banks)) atomicWriteJson(bankFile(id), parsed.banks[id]);
      cache = null; bankCache = null; loadMeta(); loadCur();
      blog('[数据] 全量恢复完成：', Object.keys(parsed.banks).length, '个题库；恢复前数据已留到 ', before);
      return { ok: true, banks: Object.keys(parsed.banks).length };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  /* ---- 数据文件路径管理 ---- */
  ipcMain.handle('data:getPath', () => {
    const cfg = readPathCfg();
    return { path: dataFile(), custom: !!cfg.customPath, defaultPath: path.join(app.getPath('userData'), 'data.json') };
  });
  ipcMain.handle('data:choosePath', async () => {
    const res = await dialog.showSaveDialog(win, {
      title: '选择数据文件的新位置',
      defaultPath: 'data.json',
      filters: [{ name: 'JSON 数据文件', extensions: ['json'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (res.canceled || !res.filePath) return { ok: false };
    let target = res.filePath;
    if (!target.toLowerCase().endsWith('.json')) target += '.json';
    try {
      const d = loadMeta();                                   // 确保元数据已从当前位置读出
      saveBank();                                             // 当前题库先落盘
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(d, null, 2), 'utf8');   // 迁移：元数据写入新位置
      /* v1.32.0：各题库数据文件（banks/ 目录）一并复制到新位置同目录下 */
      const srcBanks = banksDir();
      if (fs.existsSync(srcBanks)) {
        const dstBanks = path.join(path.dirname(target), 'banks');
        fs.mkdirSync(dstBanks, { recursive: true });
        for (const f of fs.readdirSync(srcBanks)) {
          if (/^[a-z0-9]+\.json$/i.test(f)) fs.copyFileSync(path.join(srcBanks, f), path.join(dstBanks, f));
        }
      }
      fs.writeFileSync(pathCfgFile(), JSON.stringify({ customPath: target }, null, 2), 'utf8');
      cache = null; bankCache = null; loadMeta(); loadCur();  // 切换到新位置继续读写
      return { ok: true, path: target };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('data:resetPath', async () => {
    try {
      const old = readPathCfg().customPath;
      if (old && fs.existsSync(old)) {
        // 恢复默认前，把元数据 + 各题库数据文件都搬回默认位置，避免丢数据
        const d = loadMeta();
        saveBank();
        fs.writeFileSync(path.join(app.getPath('userData'), 'data.json'), JSON.stringify(d, null, 2), 'utf8');
        const srcBanks = path.join(path.dirname(old), 'banks');
        if (fs.existsSync(srcBanks)) {
          const dstBanks = path.join(app.getPath('userData'), 'banks');
          fs.mkdirSync(dstBanks, { recursive: true });
          for (const f of fs.readdirSync(srcBanks)) {
            if (/^[a-z0-9]+\.json$/i.test(f)) fs.copyFileSync(path.join(srcBanks, f), path.join(dstBanks, f));
          }
        }
      }
      fs.rmSync(pathCfgFile(), { force: true });
      cache = null; bankCache = null; loadMeta(); loadCur();
      return { ok: true, path: dataFile() };
    } catch (err) { return { ok: false, error: err.message }; }
  });
}

/* ---------------- 文档解析 ---------------- */
async function parseDocx(filePath) {
  if (!mammoth) throw new Error('DOCX 解析组件未安装');
  const r = await mammoth.extractRawText({ path: filePath });
  return r.value || '';
}
async function parsePdf(filePath) {
  const pdfjsLib = await getPdfjs();
  if (!pdfjsLib) throw new Error('PDF 解析组件未安装');
  const data = new Uint8Array(fs.readFileSync(filePath));
  const pdf = await pdfjs.getDocument({ data }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const c = await page.getTextContent();
    text += c.items.map(it => it.str).join(' ') + '\n';
  }
  return { text, pages: pdf.numPages };
}
function regFile() {
  ipcMain.handle('file:import', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: '选择要导入的文档',
      filters: [{ name: '文档', extensions: ['pdf', 'docx', 'txt', 'md'] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (res.canceled || !res.filePaths.length) return [];
    const out = [];
    for (const p of res.filePaths) {
      const lower = p.toLowerCase();
      try {
        let text = '', type = 'txt', pages = null;
        if (lower.endsWith('.docx')) { text = await parseDocx(p); type = 'docx'; }
        else if (lower.endsWith('.pdf')) { const r = await parsePdf(p); text = r.text; pages = r.pages; type = 'pdf'; }
        else { text = fs.readFileSync(p, 'utf8'); type = 'txt'; }
        out.push({
          title: path.basename(p).replace(/\.[^.]+$/, ''),
          name: path.basename(p), text, type, pages,
          size: fs.statSync(p).size,
        });
      } catch (e) {
        out.push({ error: e.message, name: path.basename(p) });
      }
    }
    return out;
  });
  ipcMain.handle('file:save', async (e, { name, content, filters }) => {
    const res = await dialog.showSaveDialog(win, {
      title: '保存文件', defaultPath: name,
      filters: filters || [{ name: '所有文件', extensions: ['*'] }],
    });
    if (res.canceled || !res.filePath) return false;
    try { fs.writeFileSync(res.filePath, content, 'utf8'); return res.filePath; }
    catch (err) { dialog.showErrorBox('保存失败', err.message); return false; }
  });

  /* ================= 试卷导出：Word(.docx) / PDF ================= */

  /** 试卷中间表示（blocks）→ 真 .docx 二进制
   *  手写 OOXML，不依赖 Word：页面大小与分栏直接在 sectPr 里指定，
   *  A3 走两栏（标准试卷版式），A4 单栏。 */
  ipcMain.handle('paper:saveDocx', async (e, { blocks, size, name }) => {
    try {
      const buf = await buildDocx(blocks, size === 'A3' ? 'A3' : 'A4');
      const res = await dialog.showSaveDialog(win, {
        title: '导出试卷（Word）', defaultPath: name,
        filters: [{ name: 'Word 文档', extensions: ['docx'] }],
      });
      if (res.canceled || !res.filePath) return null;
      fs.writeFileSync(res.filePath, buf);
      return res.filePath;
    } catch (err) {
      dialog.showErrorBox('导出 Word 失败', err && err.message || String(err));
      return null;
    }
  });

  /** 试卷 HTML → PDF：用 Chromium 打印引擎，pageSize 直接给 A3 / A4 */
  ipcMain.handle('paper:savePdf', async (e, { html, size, name }) => {
    let w = null;
    try {
      const res = await dialog.showSaveDialog(win, {
        title: '导出试卷（PDF）', defaultPath: name,
        filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
      });
      if (res.canceled || !res.filePath) return null;
      w = new BrowserWindow({
        show: false, width: 900, height: 1200,
        webPreferences: { offscreen: false, javascript: false, images: false },
      });
      await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      await w.webContents.executeJavaScript('document.fonts.ready.then(()=>1)').catch(() => { });
      const buf = await w.webContents.printToPDF({
        pageSize: size === 'A3' ? 'A3' : 'A4',
        printBackground: false,
        margins: { marginType: 'default' },
      });
      fs.writeFileSync(res.filePath, buf);
      return res.filePath;
    } catch (err) {
      dialog.showErrorBox('导出 PDF 失败', err && err.message || String(err));
      return null;
    } finally { if (w && !w.isDestroyed()) w.destroy(); }
  });
}

/* ---------------- AI 代理请求 ---------------- */
const zlib = require('zlib');
/** 按 Content-Encoding 解压；解压失败时回退原始字节，宁可报错也不产出乱码 */
function decodeBody(buf, enc) {
  const e = String(enc || '').toLowerCase();
  try {
    if (e === 'gzip') return zlib.gunzipSync(buf);
    if (e === 'deflate') return zlib.inflateSync(buf);
    if (e === 'br') return zlib.brotliDecompressSync(buf);
  } catch (err) { /* 解压异常就用原字节 */ }
  return buf;
}
function httpsPost(urlStr, bodyStr, headers, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const http = url.protocol === 'https:' ? require('https') : require('http');
    const req = http.request({
      hostname: url.hostname, port: url.port || undefined, path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'Accept-Encoding': 'gzip, deflate',
        ...headers, 'Content-Length': Buffer.byteLength(bodyStr),
      },
      timeout: timeoutMs,
    }, res => {
      // ⚠️ 必须 Buffer 收集后一次性转 utf8：逐块 toString 会在 chunk 边界
      //    把多字节汉字拦腰截断，产生乱码（U+FFFD），存库后无法恢复
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = decodeBody(Buffer.concat(chunks), res.headers['content-encoding']);
        resolve({ status: res.statusCode, text: buf.toString('utf8') });
      });
    });
    req.on('timeout', () => { req.destroy(new Error('请求超时')); });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}
/** SSE 流式 POST：按字节 0x0A 切行（0x0A 不会出现在 UTF-8 多字节序列内部，切行安全），
 *  gzip/deflate 边收边解压。每收到一行调用 onLine(line)，行内容仍是原始字节串。 */
function httpsPostStream(urlStr, bodyStr, headers, { onLine, timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const http = url.protocol === 'https:' ? require('https') : require('http');
    const req = http.request({
      hostname: url.hostname, port: url.port || undefined, path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'Accept': 'text/event-stream',
        'Accept-Encoding': 'gzip, deflate',
        ...headers, 'Content-Length': Buffer.byteLength(bodyStr),
      },
      timeout: timeoutMs,
    }, res => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        // 非 2xx：收集错误正文后 reject（附上状态码，供上层判断 400 回退）
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const buf = decodeBody(Buffer.concat(chunks), res.headers['content-encoding']);
          const err = new Error(`AI 接口请求失败 (${res.statusCode}) ${buf.toString('utf8').slice(0, 300)}`);
          err.status = res.statusCode;
          reject(err);
        });
        return;
      }
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      let stream = res;
      if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      let tail = Buffer.alloc(0);
      stream.on('data', chunk => {
        const buf = tail.length ? Buffer.concat([tail, chunk]) : chunk;
        let start = 0;
        for (let i = 0; i < buf.length; i++) {
          if (buf[i] === 0x0A) {   // '\n'
            onLine(buf.subarray(start, i).toString('utf8'));
            start = i + 1;
          }
        }
        tail = buf.subarray(start);
      });
      stream.on('end', () => {
        if (tail.length) onLine(tail.toString('utf8'));
        resolve();
      });
      stream.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(new Error('请求超时')); });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}
/** 429 / 5xx / 网络错误指数退避重试（1s、2s、4s，共 3 次重试）；其余 4xx 直接抛 */
async function withRetry(fn, retries = 3) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      const st = e && e.status;
      const retryable = st === 429 || st >= 500 || st == null;   // 无状态码 = 网络层错误
      if (!retryable || i === retries) throw e;
      const wait = 1000 * Math.pow(2, i);
      console.warn(`[AI] 请求失败${st ? ' (' + st + ')' : ''}，${wait / 1000}s 后重试（第 ${i + 1}/${retries} 次）`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}
function regAI() {
  ipcMain.handle('ai:chat', async (e, { apiBase, apiKey, model, messages, jsonMode, temperature }) => {
    const url = String(apiBase || '').replace(/\/+$/, '') + '/chat/completions';
    const body = JSON.stringify({
      model, messages, temperature: temperature ?? 0.6,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    });
    return withRetry(async () => {
      const r = await httpsPost(url, body, { Authorization: 'Bearer ' + (apiKey || '') });
      if (r.status < 200 || r.status >= 300) {
        const err = new Error(`AI 接口请求失败 (${r.status}) ${String(r.text).slice(0, 300)}`);
        err.status = r.status;
        throw err;
      }
      const data = JSON.parse(r.text);
      return data.choices?.[0]?.message?.content ?? '';
    });
  });
  /** 流式生成：SSE delta 经 'ai:stream' 事件实时推给渲染层，invoke 最终返回完整文本 */
  ipcMain.handle('ai:chatStream', async (e, { apiBase, apiKey, model, messages, jsonMode, temperature, streamId }) => {
    const url = String(apiBase || '').replace(/\/+$/, '') + '/chat/completions';
    const body = JSON.stringify({
      model, messages, temperature: temperature ?? 0.6, stream: true,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    });
    let full = '';
    await withRetry(() => {
      full = '';
      return httpsPostStream(url, body, { Authorization: 'Bearer ' + (apiKey || '') }, {
        onLine: line => {
          line = line.trim();
          if (!line.startsWith('data:')) return;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') return;
          try {
            const j = JSON.parse(payload);
            const delta = j.choices?.[0]?.delta?.content || '';
            if (delta) {
              full += delta;
              if (win && !win.isDestroyed()) {
                win.webContents.send('ai:stream', { id: streamId, type: 'chunk', delta, len: full.length });
              }
            }
          } catch (_) { /* 半包 JSON 或注释行，跳过 */ }
        },
      });
    });
    return full;
  });
}

/* ---------------- 联网查询（Bing 搜索结果抓取） ----------------
 * 为什么不直接内嵌网页：主流搜索引擎都会发 X-Frame-Options / CSP frame-ancestors，
 * iframe / webview 里加载会被浏览器拦掉（白屏或跳出去）。所以改成「主进程抓结果页 →
 * 解析成结构化数据 → 渲染层本地画卡片」。这样观感统一、可点击打开原文，
 * 摘要还能作为参考资料喂给 AI 做综合解答（相当于搜索 + 总结）。 */
const SEARCH_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
/* v1.38.0：引擎扩为 4 个 + 智能聚合；每个引擎自带解析函数，哪个被拦就自动换下一个 */
const SEARCH_ENGINES = {
  bingcn: { name: 'Bing 国内', build: q => `https://cn.bing.com/search?q=${encodeURIComponent(q)}&setlang=zh-CN&ensearch=0`, parse: parseBingResults },
  bing: { name: 'Bing 国际', build: q => `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=zh-CN`, parse: parseBingResults },
  sogou: { name: '搜狗', build: q => `https://www.sogou.com/web?query=${encodeURIComponent(q)}`, parse: parseSogouResults },
  so360: { name: '360 搜索', build: q => `https://www.so.com/s?q=${encodeURIComponent(q)}`, parse: parseSoResults },
};
/* 智能聚合的并发引擎（都是国内直连快的），三路各取一批后交替合并去重 */
const AGG_ORDER = ['bingcn', 'sogou', 'so360'];
function httpsGet(urlStr, headers = {}, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const http = url.protocol === 'https:' ? require('https') : require('http');
    const req = http.request({
      hostname: url.hostname, port: url.port || undefined, path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'User-Agent': SEARCH_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
        'Accept-Encoding': 'gzip, deflate',
        ...headers,
      },
      timeout: timeoutMs,
    }, res => {
      /* 跟随一次 301/302（搜索引擎偶尔跳区域站点） */
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && !res.__hopped) {
        const next = new URL(res.headers.location, urlStr).toString();
        res.resume();
        return resolve(httpsGet(next, headers, timeoutMs));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = decodeBody(Buffer.concat(chunks), res.headers['content-encoding']);
        resolve({ status: res.statusCode, text: buf.toString('utf8'), url: urlStr });
      });
    });
    req.on('timeout', () => req.destroy(new Error('联网查询超时（网络不通或被拦截）')));
    req.on('error', reject);
    req.end();
  });
}
const HTML_ENT = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  middot: '·', hellip: '…', mdash: '—', ndash: '–', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', deg: '°',
};
function decodeEnt(s) {
  return String(s).replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return HTML_ENT[e] != null ? HTML_ENT[e] : m;
  });
}
function stripTags(s) {
  /* 块级标签换空格（保留分词），行内标签（<strong> 高亮等）直接删掉，避免「牛顿第二 运动 定律」这种断裂 */
  return decodeEnt(String(s)
    .replace(/<\s*\/?\s*(br|p|div|li|ul|ol|h[1-6]|tr|td|table|section)\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ').trim();
}
/** Bing 的跳转链接（/ck/a?…&u=a1<base64url>）还原成真实地址，方便复制/收藏 */
function unwrapBingUrl(u) {
  try {
    if (!/\/ck\/a/i.test(u)) return u;
    const raw = new URL(u).searchParams.get('u') || '';
    if (!/^a1/.test(raw)) return u;
    const b = Buffer.from(raw.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return /^https?:\/\//i.test(b) ? b : u;
  } catch (_) { return u; }
}
/** 解析 Bing 结果页：每条 <li class="b_algo"> 取标题 / 链接 / 摘要 */
function parseBingResults(html, limit = 10) {
  const out = [];
  const parts = String(html || '').split(/<li class="b_algo[^"]*"/);
  for (let i = 1; i < parts.length && out.length < limit; i++) {
    const blk = parts[i];
    const h = blk.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!h) continue;
    const url = unwrapBingUrl(decodeEnt(h[1]));
    const title = stripTags(h[2]);
    if (!title || !/^https?:\/\//i.test(url)) continue;
    let snippet = '';
    const cap = blk.match(/<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
      || blk.match(/<div[^>]*class="[^"]*b_caption[^"]*"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i)
      || blk.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    if (cap) snippet = stripTags(cap[1]).replace(/\s*[·…]{1,}\s*$/, '');
    let site = '';
    try { site = new URL(url).hostname.replace(/^www\./, ''); } catch (_) { }
    if (out.some(x => x.url === url)) continue;   // 同一页重复出现（如站内多结果）只留一条
    out.push({ title, url, snippet: snippet.slice(0, 400), site });
  }
  return out;
}
/** 搜狗跳转链接（/link?url=…）拼成绝对地址；其它情况要求是合法 http(s) */
function unwrapSogouUrl(u) {
  const s = decodeEnt(String(u || '').trim());
  if (/^\/link\?/i.test(s)) return 'https://www.sogou.com' + s;
  return /^https?:\/\//i.test(s) ? s : '';
}
/** 解析搜狗结果页：每个 <div class="vrwrap"> 里取 h3.vr-title 的标题链接 + space-txt/str_info 摘要
 *  来源域名从块内的真实链接（cite 区或第一个非搜狗链接）提取，跳转链接保留原样（浏览器会自动 302 到原文） */
function parseSogouResults(html, limit = 10) {
  const out = [];
  const clean = String(html || '').replace(/<!--[\s\S]*?-->/g, '');
  const parts = clean.split(/<div[^>]+class="vrwrap[" ]/);
  for (let i = 1; i < parts.length && out.length < limit; i++) {
    const blk = parts[i];
    const h = blk.match(/<h3[^>]*class="[^"]*vr-title[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
      || blk.match(/<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!h) continue;
    const url = unwrapSogouUrl(h[1]);
    const title = stripTags(h[2]);
    if (!title || !/^https?:\/\//i.test(url)) continue;
    const cap = blk.match(/<p[^>]*class="[^"]*space-txt[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
      || blk.match(/<div[^>]*class="[^"]*str_info[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
      || blk.match(/<div[^>]*class="[^"]*text-layout[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
      || blk.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = cap ? stripTags(cap[1]) : '';
    let site = '';
    const cite = blk.match(/<a[^>]*class="[^"]*citeLinkClass[^"]*"[^>]*href="(https?:\/\/[^"]+)"/i)
      || blk.match(/href="(https?:\/\/(?!www\.sogou\.com)[^"]+)"/i);
    if (cite) { try { site = new URL(decodeEnt(cite[1])).hostname.replace(/^www\./, ''); } catch (_) { } }
    if (!site) { try { site = new URL(url).hostname.replace(/^www\./, ''); } catch (_) { } }
    if (/^(www\.)?sogou\.com$/.test(site)) site = '';   // 拿不到真实来源时宁可不显示，也不显示搜狗自己
    if (out.some(x => x.url === url)) continue;
    out.push({ title, url, snippet: snippet.slice(0, 400), site });
  }
  return out;
}
/** 360 搜索：h3.res-title 里的 a 带 data-mdurl（真实地址），摘要 res-desc / data-result-summary */
function parseSoResults(html, limit = 10) {
  const out = [];
  const clean = String(html || '').replace(/<!--[\s\S]*?-->/g, '');
  const re = /<h3[^>]*class="[^"]*res-title[^"]*"[^>]*>([\s\S]*?)<\/h3>/gi;
  let m;
  while ((m = re.exec(clean)) && out.length < limit) {
    const a = m[1].match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    let url = decodeEnt(a[1]).trim();
    if (!/^https?:\/\//i.test(url) || /www\.so\.com\/link/i.test(url)) {
      const md = (m[0] + m[1]).match(/data-mdurl="([^"]+)"/i);
      url = md ? decodeEnt(md[1]).trim() : (/^\/link/i.test(url) ? 'https://www.so.com' + url : url);
    }
    const title = stripTags(a[2]);
    if (!title || !/^https?:\/\//i.test(url)) continue;
    /* 摘要在 h3 之后、下一个 h3 之前的正文区里 */
    const nextH = clean.indexOf('<h3', m.index + m[0].length);
    const rest = clean.slice(m.index + m[0].length, nextH < 0 ? m.index + 4000 : Math.min(nextH, m.index + 4000));
    const cap = rest.match(/<p[^>]*class="[^"]*res-desc[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
      || rest.match(/<span[^>]*data-result-summary[^>]*>([\s\S]*?)<\/span>/i)
      || rest.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = cap ? stripTags(cap[1]) : '';
    let site = '';
    try { site = new URL(url).hostname.replace(/^www\./, ''); } catch (_) { }
    if (out.some(x => x.url === url)) continue;
    out.push({ title, url, snippet: snippet.slice(0, 400), site });
  }
  return out;
}
/** 单引擎抓取 + 解析，失败抛错（由上层决定回落/聚合） */
/* v1.41.0 引擎健康度：某引擎连续 5 次「取回页面但解析 0 条」（多半是对方改版），
 * 本次启动内标记失效——聚合与自动回落跳过它，省掉无效超时；重启自动重试。 */
const engineHealth = createEngineHealth({ limit: 5 });
async function fetchEngine(id, q, limit) {
  const eng = SEARCH_ENGINES[id];
  if (!eng) throw new Error('未知引擎 ' + id);
  const searchUrl = eng.build(q);
  const r = await httpsGet(searchUrl);
  if (r.status !== 200) throw new Error(`${eng.name} 返回 ${r.status}`);
  const results = eng.parse(r.text, limit);
  engineHealth.mark(id, results.length > 0);
  if (!results.length) throw new Error(`${eng.name} 没有解析到结果`);
  return { ok: true, engine: id, engineName: eng.name, query: q, searchUrl, results };
}
/** 智能聚合：三路并发各取一批，交替合并去重（同 URL 或同标题前 24 字视为重复） */
async function searchAggregate(q, limit) {
  /* v1.41.0：失效引擎不参与聚合（若全部失效则照旧全上，保底能搜） */
  const healthy = AGG_ORDER.filter(id => !engineHealth.degraded(id));
  const ids = healthy.length ? healthy : AGG_ORDER;
  const settled = await Promise.allSettled(ids.map(id => fetchEngine(id, q, limit)));
  const goods = settled.filter(s => s.status === 'fulfilled').map(s => s.value);
  const errors = settled.filter(s => s.status === 'rejected')
    .map(s => String((s.reason && s.reason.message) || s.reason));
  if (!goods.length) {
    const eng = SEARCH_ENGINES.bingcn;
    return { ok: false, query: q, engine: 'aggregate', engineName: '智能聚合', searchUrl: eng.build(q), results: [], error: errors.join('；') || '联网查询失败' };
  }
  const seen = new Set();
  const merged = [];
  outer:
  for (let i = 0; i < limit; i++) {
    for (const g of goods) {
      const r = g.results[i];
      if (!r) continue;
      const key = (r.url || '').replace(/[?#].*$/, '') + '|' + (r.title || '').slice(0, 24);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(r);
      if (merged.length >= limit + 4) break outer;
    }
  }
  return {
    ok: true, engine: 'aggregate', query: q,
    engineName: '智能聚合（' + goods.map(g => g.engineName).join(' + ') + '）',
    searchUrl: goods[0].searchUrl, results: merged,
  };
}
/** 联网搜索：用户选「智能聚合」走三路合并；选单引擎时失败/零结果按「国内优先」自动回落其它引擎 */
async function searchWeb(q, engine = 'bingcn', limit = 10) {
  if (engine === 'aggregate') return searchAggregate(q, limit);
  const ids = Object.keys(SEARCH_ENGINES).filter(k => k !== 'aggregate');
  /* v1.41.0：失效引擎排到队尾；用户显式选中的引擎仍最先尝试（尊重选择） */
  const order = ids.includes(engine)
    ? [engine, ...engineHealth.orderFirst(ids.filter(k => k !== engine))]
    : engineHealth.orderFirst(['bingcn', 'sogou', 'so360', 'bing']);
  const errors = [];
  for (const id of order) {
    try {
      return await fetchEngine(id, q, limit);
    } catch (e) {
      errors.push(String((e && e.message) || e));
    }
  }
  const eng = SEARCH_ENGINES[engine] || SEARCH_ENGINES.bingcn;
  return { ok: false, query: q, engine, engineName: eng.name, searchUrl: eng.build(q), results: [], error: errors.join('；') || '联网查询失败' };
}
function registerWebSearch() {
  ipcMain.handle('web:search', async (e, { q, engine, limit } = {}) => {
    const query = String(q || '').trim();
    if (!query) return { ok: false, error: '查询内容为空', results: [] };
    const r = await searchWeb(query, engine, Math.min(Math.max(Number(limit) || 10, 1), 10));
    /* v1.41.0：把本次启动内失效的引擎名带给前端，面板提示「xx源暂不可用，已自动切换」 */
    r.degraded = engineHealth.degradedNames(
      Object.keys(SEARCH_ENGINES).filter(k => k !== 'aggregate'),
      id => SEARCH_ENGINES[id].name);
    return r;
  });
  /* 搜索联想词（Bing 开放接口，返回 JSON 数组；失败静默返回空，不弹错） */
  ipcMain.handle('web:suggest', async (e, { q } = {}) => {
    const query = String(q || '').trim();
    if (!query || query.length > 60) return { ok: true, items: [] };
    try {
      const r = await httpsGet(`https://api.bing.com/osjson.aspx?query=${encodeURIComponent(query)}`, {}, 6000);
      if (r.status !== 200) return { ok: true, items: [] };
      const j = JSON.parse(r.text);
      const items = (Array.isArray(j) && Array.isArray(j[1]) ? j[1] : [])
        .filter(x => typeof x === 'string' && x.trim() && x.trim() !== query)
        .slice(0, 8);
      return { ok: true, items };
    } catch (err) {
      return { ok: true, items: [] };
    }
  });
  /* 只允许 http/https，避免被网页内容诱导去打开本地程序 */
  ipcMain.handle('app:openExternal', async (e, { url } = {}) => {
    const u = String(url || '');
    if (!/^https?:\/\//i.test(u)) return false;
    await shell.openExternal(u);
    return true;
  });
}

/* ---------------- 自动更新（electron-updater） ---------------- */
/* 下载源与测速
 * GitHub Release 在国内常常只有几十 KB/s（本机实测 0.06 MB/s，94MB 要 25 分钟），
 * 公开加速镜像同一文件能到 5 MB/s。因此检查更新时并行探测各源，自动选最快的；
 * 下载中途失败自动切到次快源重试一次；用户也可在系统设置里手动锁定某个源。 */
const GH_BASE = 'https://github.com/lingsheng24/moni-tiku/releases/latest/download/';
/* ⚠️ GitCode 的附件直链是「releases/download/<tag 或 latest>/<文件名>」。
 * 只有这一种写法能拿到真实文件（会 302 到 file-cdn.gitcode.com）。
 * 官方文档示例里的 `-/releases/latest/downloads/` 以及 GitHub 风格的
 * `releases/latest/download/` 返回的都是 HTML 页面（HTTP 200 但内容是网页），
 * 不能直接当更新源 —— 这点已实测确认。 */
const GC_BASE = 'https://gitcode.com/JinFengjian/moni-tiku/releases/download/latest/';
/* base = 该源自己的更新目录；prefix = 镜像前缀（拼在 base 前面做代理加速）。
 * 每个版本会同时发布到 GitHub 与 GitCode，两边文件完全一致，
 * GitCode 走华为云 OBS、国内直连，通常比 GitHub 快得多。 */
const UPDATE_SOURCES = [
  { id: 'gitcode', name: 'GitCode 官方仓库（国内直连）', base: GC_BASE },
  { id: 'github', name: 'GitHub 官方仓库（不经过第三方）', base: GH_BASE },
  { id: 'gh-proxy', name: 'GitHub 加速镜像 ① gh-proxy.com', base: GH_BASE, prefix: 'https://gh-proxy.com/' },
  { id: 'ghproxy', name: 'GitHub 加速镜像 ② ghproxy.net', base: GH_BASE, prefix: 'https://ghproxy.net/' },
  { id: 'ghproxylk', name: 'GitHub 加速镜像 ③ ghproxy.link', base: GH_BASE, prefix: 'https://ghproxy.link/' },
];
const srcUrl = id => {
  const s = UPDATE_SOURCES.find(x => x.id === id) || UPDATE_SOURCES[0];
  return (s.prefix || '') + s.base;
};
let curSourceId = 'gitcode';     // 当前生效的下载源（国内优先 GitCode）
let lockedSourceId = '';         // 用户手动锁定（非空则不再自动测速）
let srcRanking = [];             // 最近一次测速结果
let wantsDownload = false;       // 用户是否已确认要下载（用于失败后自动重试）
let wantCancel = false;          // 用户主动取消下载（error 处理器据此不自动换源重试）
let curToken = null;             // 当前下载的 CancellationToken（取消下载时调用其 cancel）

/** 取一个 URL 开头一小段数据用来测速，返回 {ok, ms(首字节耗时), mbps}
 *  ① 速率从「收到第一个字节」起算 —— 否则连接慢的源会被误判成带宽 0
 *  ② headersOnly=true 时只等响应头（用于探活），不读正文
 *  ③ 硬超时从发起请求算起 —— 否则一个字节都不吐的慢源会一直挂到 timeout，拖垮总耗时 */
function sampleDownload(url, sampleMs, timeoutMs, headersOnly) {
  return new Promise(resolve => {
    const lib = url.startsWith('https') ? require('https') : require('http');
    const t0 = Date.now();
    let bytes = 0, ttfb = 0, tFirst = 0, done = false;
    const end = () => {
      if (done) return; done = true;
      const dur = ((tFirst || t0) ? Date.now() - (tFirst || t0) : 0) / 1000;
      resolve({ ok: ttfb > 0, ms: ttfb || (Date.now() - t0), mbps: dur > 0.05 ? (bytes / 1048576) / dur : 0 });
    };
    let req;
    try {
      req = lib.get(url, { headers: { 'User-Agent': 'moni-tiku-updater' }, timeout: timeoutMs }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(sampleDownload(new URL(res.headers.location, url).href, sampleMs, timeoutMs, headersOnly));
        }
        if (res.statusCode !== 200) { res.resume(); return end(); }
        ttfb = Date.now() - t0;
        if (headersOnly) { res.resume(); return end(); }
        res.on('data', c => {
          if (!tFirst) tFirst = Date.now();
          bytes += c.length;
          if (Date.now() - tFirst >= sampleMs) { req.destroy(); end(); }
        });
        res.on('end', () => end());
      });
    } catch (e) { return end(); }
    req.on('error', () => end());
    req.on('timeout', () => { req.destroy(); end(); });
    setTimeout(() => { if (!done) { req.destroy(); end(); } }, Math.min(timeoutMs, 2500));
  });
}
/** 读取一个 URL 的完整文本 */
function fetchText(url, timeoutMs = 8000) {
  return new Promise(resolve => {
    const lib = url.startsWith('https') ? require('https') : require('http');
    const req = lib.get(url, { headers: { 'User-Agent': 'moni-tiku-updater' }, timeout: timeoutMs }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetchText(new URL(res.headers.location, url).href, timeoutMs));
      }
      if (res.statusCode !== 200) { res.resume(); return resolve(''); }
      const bufs = [];
      res.on('data', c => bufs.push(c));
      res.on('end', () => resolve(Buffer.concat(bufs).toString('utf8')));
    });
    req.on('error', () => resolve(''));
    req.on('timeout', () => { req.destroy(); resolve(''); });
  });
}
/** 测速排序：先并行探活，再「串行」采样真实带宽
 *  ⚠️ 带宽采样必须串行 —— 并行会让几个源互相抢带宽，测出来的全都不是真实速度 */
async function rankSources() {
  const t0 = Date.now();
  // ① 探活：只取响应头，并行
  const alive = await Promise.all(UPDATE_SOURCES.map(async s => ({ ...s, ...(await sampleDownload(srcUrl(s.id) + 'latest.yml', 0, 6000, true)) })));
  // 连响应头都拿不到、或耗时超过 3s 的直接淘汰（太慢不值得用）
  const ok = alive.filter(a => a.ok && a.ms < 3000);
  if (!ok.length) return [];
  // 从 latest.yml 里取真实更新包文件名，拿大文件测速才准
  let file = '';
  for (const a of ok) {
    const yml = await fetchText(srcUrl(a.id) + 'latest.yml', 6000);
    const m = yml.match(/^\s*-\s*url:\s*(\S+)/m) || yml.match(/url:\s*(\S+\.exe)/);
    if (m) { file = m[1]; break; }
  }
  const probe = file || 'latest.yml';
  // ② 串行采样带宽，每个源最多 0.8s（硬超时 2.5s 兜底）
  const rank = [];
  for (const s of ok) {
    const r = await sampleDownload(srcUrl(s.id) + probe, 800, 6000);
    rank.push({ id: s.id, name: s.name, ms: s.ms, mbps: r.ok ? r.mbps : 0 });
  }
  rank.sort((a, b) => b.mbps - a.mbps || a.ms - b.ms);
  console.log('[更新] 测速 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's →',
    rank.map(r => `${r.id} ${r.mbps.toFixed(2)}MB/s`).join(' | '));
  return rank;
}
/** 测速结果在 5 分钟内复用，避免每次检查更新都干等好几秒 */
const RANK_TTL = 5 * 60 * 1000;
let srcRankedAt = 0;
const rankFresh = () => srcRanking.length > 0 && (Date.now() - srcRankedAt) < RANK_TTL;
let quickNotified = '';        // 已快速告知过用户的版本号（抑制 electron-updater 的重复通知）
let updChecked = false;        // electron-updater 是否已拿到 updateInfo（下载前必须为真）
/** 语义化版本比较：a > b 返回 true（忽略预发布后缀，逐段数值比较） */
function verGreater(a, b) {
  const pa = String(a || '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}
/** 并发向各源要 latest.yml，取最先返回的那个。
 *  旧流程每次检查都要串行测速 5 秒、用户只能干等；改成谁先回来用谁，
 *  响应速度最快的源通常也是下载最快的源，顺带把选源也做完了。 */
async function quickProbe(ids) {
  const list = ids && ids.length ? ids : UPDATE_SOURCES.map(s => s.id);
  return new Promise(resolve => {
    let done = false;
    const fin = v => { if (done) return; done = true; resolve(v); };
    for (const id of list) {
      fetchText(srcUrl(id) + 'latest.yml', 5000).then(yml => {
        if (yml && /^\s*version:/m.test(yml)) fin({ id, yml });
      });
    }
    // 必须给个结果：连不上也要在 5.5 秒后明确失败，绝不无限等待
    setTimeout(() => fin(null), 5500);
  });
}
/** 给 Promise 套硬超时，任何环节卡住都能继续往下走 */
function withTimeout(p, ms) {
  return Promise.race([p, new Promise(r => setTimeout(() => r('__timeout__'), ms))]);
}
/** 绿色便携版（electron-builder portable）不支持在线更新，直接说清楚，免得白等 */
const isPortableApp = () => !!process.env.PORTABLE_EXECUTABLE_DIR;
/** 让 electron-updater 用指定源（运行时可切换） */
function applySource(id) {
  curSourceId = id;
  try {
    autoUpdater.setFeedURL({ provider: 'generic', url: srcUrl(id), channel: 'latest' });
  } catch (e) { console.warn('[更新] 切换下载源失败:', e.message); }
}
let autoUpdater = null;
/** CancellationToken：下载取消用。
 *  ⚠️ 不要直接 require('builder-util-runtime')：它只是 electron-updater 的传递依赖，
 *  当版本未被提升到 node_modules 顶层时，打包后的 asar 里只在
 *  node_modules/electron-updater/node_modules/ 下有一份，顶层 require 会拿到 undefined
 *  → new CancellationToken() 报 "CancellationToken is not a constructor"。
 *  正确做法：优先用 electron-updater 依赖的那一份（与它的版本严格匹配），逐级兜底。 */
let CancellationToken = null;
function resolveCancellationToken() {
  const tries = [
    () => require('builder-util-runtime').CancellationToken,                                      // 顶层已提升（package.json 已显式声明）
    () => require('electron-updater/node_modules/builder-util-runtime').CancellationToken,        // 未提升，嵌套在 electron-updater 下
    () => {
      const p = require.resolve('electron-updater/package.json');
      return require(require('path').join(require('path').dirname(p), 'node_modules', 'builder-util-runtime')).CancellationToken;
    },
  ];
  for (const fn of tries) {
    try {
      const T = fn();
      if (typeof T === 'function') return T;
    } catch (e) { /* 试下一条 */ }
  }
  return null;
}
/** 向渲染层推送更新事件（模块级：setupUpdater 与 regUpdate 的 IPC 处理器都要用）。
 *  ⚠️ 此前 send 定义在 setupUpdater 内部，regUpdate 里调用会 ReferenceError，
 *  导致「检查更新」只要一有结果就变成「检查失败：send is not defined」。 */
function send(type, data = {}) {
  if (win && !win.isDestroyed()) win.webContents.send('update', { type, ...data });
}
/** GitCode 下载直链不接受任何查询参数（latest.yml?noCache=xxx → 404，实测 latest 与版本 tag 路径均如此），
 *  而 electron-updater 检查频道文件时会自动附加 ?noCache= 防缓存 → 从 GitCode 检查/下载更新必失败。
 *  修复：包一层 httpExecutor.request。注意 electron-updater 的请求选项不带 url 字段，
 *  而是把地址拆成 hostname + path（path 含 ?查询串），因此从这里剥离 noCache。
 *  其余域名（GitHub 及其镜像）不受影响，查询参数原样保留。 */
function patchExecutorForGitCode() {
  const ex = autoUpdater.httpExecutor;
  if (!ex || ex.__gitcodePatched) return;
  const orig = ex.request.bind(ex);
  ex.request = function (options, ...rest) {
    try {
      if (options && /(^|\.)gitcode\.com$/.test(options.hostname || '') && options.path && options.path.includes('noCache=')) {
        const [p, q] = options.path.split('?');
        if (q) {
          const sp = new URLSearchParams(q);
          if (sp.has('noCache')) {
            sp.delete('noCache');
            options = { ...options, path: p + (sp.toString() ? '?' + sp.toString() : '') };
          }
        }
      }
    } catch (e) { /* 剥离失败则原样放行 */ }
    return orig(options, ...rest);
  };
  ex.__gitcodePatched = true;
}
function setupUpdater() {
  if (!app.isPackaged) return;   // 开发模式不支持自动更新
  try {
    autoUpdater = require('electron-updater').autoUpdater;
    CancellationToken = resolveCancellationToken();
    if (!CancellationToken) console.warn('[更新] CancellationToken 解析失败，取消下载功能将不可用');
  } catch (e) { console.warn('electron-updater 加载失败:', e.message); return; }
  patchExecutorForGitCode();
  autoUpdater.autoDownload = false;            // 检测到更新后由用户确认再下载
  /* 关掉「退出时自动安装」：军哥要求下载完必须由用户手动确认安装，
     否则用户叉掉窗口时会被静默装上，不符合「不要静默安装」的要求 */
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('checking-for-update', () => send('checking'));
  autoUpdater.on('update-available', i => {
    updChecked = true;
    // 已用快速探测告知过用户 → 这里只补发更新说明，不再弹第二次提示
    if (quickNotified && quickNotified === i.version) {
      const notes = typeof i.releaseNotes === 'string' ? i.releaseNotes : '';
      if (notes) send('notes', { notes });
      return;
    }
    send('available', {
      version: i.version, notes: typeof i.releaseNotes === 'string' ? i.releaseNotes : '',
      source: curSourceId,
    });
  });
  autoUpdater.on('update-not-available', i => send('none', { version: i && i.version }));
  // 下载进度限流：download-progress 触发极频繁（每秒可达数十次），
  // 原样转发会让渲染层疯狂重建 DOM 导致界面闪烁。这里压到 5 次/秒。
  let lastProgressAt = 0;
  autoUpdater.on('download-progress', p => {
    const percent = Math.round(p.percent || 0);
    const now = Date.now();
    if (percent < 100 && now - lastProgressAt < 200) return;
    lastProgressAt = now;
    const bps = p.bytesPerSecond || 0;
    const left = (p.total || 0) - (p.transferred || 0);
    send('progress', {
      percent,
      mb: ((p.transferred || 0) / 1048576).toFixed(1),
      totalMb: ((p.total || 0) / 1048576).toFixed(1),
      speed: (bps / 1048576).toFixed(2),              // MB/s
      eta: bps > 1024 ? Math.round(left / bps) : 0,   // 剩余秒数
    });
  });
  autoUpdater.on('update-downloaded', i => { wantsDownload = false; wantCancel = false; curToken = null; send('downloaded', { version: i.version }); });
  /* 用户主动取消下载：electron-updater 在 CancellationError 时会发这个事件 */
  autoUpdater.on('update-cancelled', () => {
    wantsDownload = false; wantCancel = false; curToken = null;
    send('canceled', { ok: true, byUser: true });
  });
  autoUpdater.on('error', err => {
    // 用户点了「取消下载」→ 这是预期内的中断，不报错、不换源重试
    if (wantCancel) {
      wantCancel = false; wantsDownload = false; curToken = null;
      console.log('[更新] 下载已被用户取消');
      return;
    }
    // 下载途中出错且还有备用源 → 自动换一个源重试一次
    const alt = srcRanking.filter(r => r.id !== curSourceId && r.mbps > 0);
    if (wantsDownload && alt.length) {
      const next = alt[0];
      console.warn('[更新] 当前源失败，切换到', next.id, err && err.message);
      applySource(next.id);
      wantsDownload = false;   // 这次重试不再自动兜底，避免死循环
      send('switch', { source: next.id, name: next.name });
      curToken = CancellationToken ? new CancellationToken() : null;
      autoUpdater.checkForUpdates().then(() => autoUpdater.downloadUpdate(curToken || undefined)).catch(() => { });
      return;
    }
    wantsDownload = false; curToken = null;
    send('error', { message: (err && err.message) || String(err), source: curSourceId });
  });
}
/** 更新功能不可用时的明确原因（便携版 / 组件缺失 / 开发模式） */
function updUnavailable() {
  if (isPortableApp()) return '绿色便携版不支持在线更新，请到发布页下载新版后手动替换文件';
  if (!autoUpdater) return app.isPackaged ? '更新组件不可用' : '开发模式不支持自动更新';
  return '';
}
function regUpdate() {
  ipcMain.handle('app:version', () => app.getVersion());
  /** 检查更新：
   *  结果由「自己并发探测 latest.yml」给出（通常 1 秒内就有答案），
   *  electron-updater 只在后台准备下载所需的 updateInfo —— 它卡住也不影响用户看到结果。 */
  ipcMain.handle('app:checkUpdate', async () => {
    const bad = updUnavailable();
    if (bad) return { ok: false, message: bad };
    const ids = lockedSourceId ? [lockedSourceId] : null;
    const probe = await quickProbe(ids);
    if (!probe) {
      // 连 latest.yml 都拿不到 → 明确报错，不再让用户对着转圈干等
      send('error', { message: '检查超时：连不上更新服务器，请检查网络后重试' });
      return { ok: false, message: '检查超时，请检查网络' };
    }
    curSourceId = probe.id;
    applySource(probe.id);
    send('source', {
      source: probe.id, name: (UPDATE_SOURCES.find(s => s.id === probe.id) || {}).name, ranking: srcRanking,
    });
    const ver = ((probe.yml || '').match(/^\s*version:\s*(\S+)/m) || [])[1] || '';
    const cur = app.getVersion();
    console.log('[更新] 探测 ' + probe.id + ' → 最新 ' + ver + '，当前 ' + cur);
    if (!ver || !verGreater(ver, cur)) {
      updChecked = false; quickNotified = '';
      send('none', { version: ver || cur });   // 已是最新，不用再劳驾 electron-updater
      return { ok: true, version: ver || cur, upToDate: true };
    }
    // 有新版本：立刻告诉用户，同时让 electron-updater 在后台备好下载信息
    quickNotified = ver; updChecked = false;
    send('available', { version: ver, notes: '', source: probe.id });
    autoUpdater.checkForUpdates().then(() => { updChecked = true; }).catch(() => { });
    return { ok: true, version: ver, hasUpdate: true };
  });
  /** 下载更新：下载前才做带宽测速（用户已决定要下，值得等这几秒） */
  ipcMain.handle('app:downloadUpdate', async () => {
    const bad = updUnavailable();
    if (bad) return { ok: false, message: bad };
    wantsDownload = true;
    wantCancel = false;
    curToken = CancellationToken ? new CancellationToken() : null;   // 供「取消下载」使用（解析失败时退化为不可取消）
    // ① 未锁定源时才测速，选真正的带宽最快者（探测选的是响应最快，未必带宽最高）
    if (!lockedSourceId && !rankFresh()) {
      send('probing', {});
      srcRanking = await rankSources();
      srcRankedAt = Date.now();
      if (wantCancel) return { ok: false, canceled: true };   // 测速期间用户已取消
    }
    const top = (lockedSourceId ? null : srcRanking.filter(r => r.mbps > 0)[0]);
    if (top && top.id !== curSourceId) {
      curSourceId = top.id; applySource(top.id); updChecked = false;
      send('source', { source: top.id, name: top.name, ranking: srcRanking });
    }
    // ② 必须先让 electron-updater 拿到 updateInfo，否则 downloadUpdate 会空转
    if (!updChecked) {
      const r = await withTimeout(autoUpdater.checkForUpdates(), 20000).catch(() => '__timeout__');
      updChecked = (r !== '__timeout__');
      if (r === '__timeout__') console.warn('[更新] 准备下载超时，仍尝试直接下载');
      if (wantCancel) return { ok: false, canceled: true };   // 准备阶段用户已取消
    }
    autoUpdater.downloadUpdate(curToken || undefined).catch(() => { });
    return { ok: true, source: curSourceId };
  });
  /** 取消下载：electron-updater 的 downloadUpdate 接受 CancellationToken，
   *  cancel() 会让底层请求中断、抛 CancellationError 并触发 update-cancelled 事件。
   *  先把 wantCancel 置位，error 处理器看到它就当作「用户取消」，不再自动换源重试。 */
  ipcMain.handle('app:cancelDownload', () => {
    const tok = curToken;
    wantCancel = true;
    wantsDownload = false;
    curToken = null;
    try { if (tok) tok.cancel(); } catch (e) { console.warn('[更新] 取消下载失败:', e.message); }
    send('canceled', { ok: !!tok });
    return { ok: true, aborted: !!tok };
  });
  /** 列出可选下载源 + 最近测速结果 */
  ipcMain.handle('app:updateSources', () => ({
    ok: true, current: curSourceId, locked: lockedSourceId,
    list: UPDATE_SOURCES, ranking: srcRanking,
  }));
  /** 手动指定下载源（传空字符串=恢复自动选择） */
  ipcMain.handle('app:setUpdateSource', async (e, id) => {
    lockedSourceId = id || '';
    if (id) { curSourceId = id; applySource(id); }
    return { ok: true, current: curSourceId, locked: lockedSourceId };
  });
  /**
   * 安装更新：显示安装向导，由用户点「下一步 / 安装」完成，**不静默安装**。
   * quitAndInstall(isSilent=false, isForceRunAfter=true)
   *   isSilent=false      → 不传 /S，正常弹出 NSIS 安装向导，用户能看到进度与完成页
   *   isForceRunAfter=true → 装完自动拉起新版本（免去用户再找图标）
   * 安装目录沿用上次的（NSIS 会记住），数据目录不受影响，题目数据不会丢。
   */
  ipcMain.handle('app:installUpdate', () => {
    if (!autoUpdater) return { ok: false, message: '更新组件不可用' };
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  });
  /** 当前生效的更新源（打包时由 package.json → build.publish.url 写入） */
  ipcMain.handle('app:getUpdateUrl', () => {
    try {
      const f = path.join(app.isPackaged ? process.resourcesPath : __dirname, 'app-update.yml');
      const yml = fs.readFileSync(f, 'utf8');
      const m = yml.match(/url:\s*['"]?([^'"\n]+)/);
      return { ok: true, url: m ? m[1].trim() : '' };
    } catch (e) { return { ok: false, url: '' }; }
  });
}

/* ---------------- 系统托盘 + 关闭行为（v1.30.0） ---------------- */
/** 关闭主窗口的行为由渲染层设置 settings.closeAction 决定（存在 data.json 的 kv.settings 里，
 *  渲染层每次保存设置都会经 kv:set 更新主进程的同一份内存缓存，因此这里读到的总是最新值）：
 *  'tray'（默认）= 点关闭后隐藏到系统托盘，后台继续运行；'quit' = 直接退出。 */
let tray = null;
let trayHintShown = false;   // 「已最小化到托盘」气泡只提示一次
let quitting = false;        // 真正退出（托盘菜单 / Alt+F4 / app.quit）时不拦截 close
function closeAction() {
  try {
    const s = loadMeta().kv.settings;
    return (s && typeof s === 'object' && s.closeAction === 'quit') ? 'quit' : 'tray';
  } catch (e) { return 'tray'; }
}
function showMainWindow() {
  if (!win || win.isDestroyed()) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}
function createTray() {
  try {
    tray = new Tray(path.join(__dirname, 'icons', 'icon.ico'));
    tray.setToolTip('模拟题库');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示主窗口', click: showMainWindow },
      { type: 'separator' },
      { label: '退出', click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on('click', showMainWindow);          // 单击直接恢复窗口
    tray.on('double-click', showMainWindow);   // 双击同样恢复（兼容不同系统的习惯）
  } catch (e) { blog('托盘创建失败:', e && e.message); console.warn('[托盘] 创建失败:', e && e.message); tray = null; }
}

/* ---------------- 窗口 ---------------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 860, minWidth: 1024, minHeight: 700,
    title: '模拟题库',
    backgroundColor: '#f4f6fa',
    icon: path.join(__dirname, 'icons', 'icon.ico'),
    frame: false,           // 无边框窗口：由页面自绘标题栏（含主题切换 / 最小化 / 最大化 / 关闭）
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });
  /* v1.36.1 兜底：GPU 异常或页面加载卡住时 ready-to-show 可能迟迟不触发，
   * 窗口会一直隐藏，用户看到的就是「进程在跑、桌面没窗口」。10 秒后强制显示。 */
  const showTimer = setTimeout(() => {
    blog('ready-to-show 超时 10s，强制显示窗口');
    if (win && !win.isDestroyed() && !win.isVisible()) win.show();
  }, 10000);
  win.once('ready-to-show', () => { clearTimeout(showTimer); win.show(); blog('ready-to-show → win.show()'); });
  win.on('show', () => blog('窗口已显示 visible=' + win.isVisible()));
  win.on('hide', () => blog('窗口被隐藏'));
  win.on('closed', () => blog('窗口已 closed'));
  /* 最大化状态变化时通知渲染层，用于切换标题栏的「最大化 / 还原」图标 */
  const sendWinState = () => {
    if (win && !win.isDestroyed()) win.webContents.send('win-state', { max: win.isMaximized() });
  };
  win.on('maximize', sendWinState);
  win.on('unmaximize', sendWinState);
  /* 关闭拦截（v1.30.0）：设置「最小化到托盘」时点 ✕ 只隐藏窗口，进程常驻托盘。
   * 托盘创建失败时绝不拦截 —— 否则窗口藏起来就再也找不回来了。 */
  win.on('close', e => {
    blog('win close 事件 · quitting=' + quitting + ' · action=' + closeAction() + ' · tray=' + !!tray);
    if (quitting) return;
    if (closeAction() !== 'tray' || !tray) return;
    e.preventDefault();
    win.hide();
    if (!trayHintShown) {
      trayHintShown = true;
      try {
        tray.displayBalloon({
          iconType: 'info', title: '模拟题库仍在运行',
          content: '已最小化到系统托盘，点击托盘图标可恢复窗口；右键托盘图标可选择退出。',
        });
      } catch (_) { /* 非 Windows 平台无气泡，忽略 */ }
    }
  });
  const htmlPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.html')
    : path.join(__dirname, '..', '模拟题库-Web版.html');
  blog('开始加载页面:', htmlPath, '存在=' + fs.existsSync(htmlPath));
  win.loadFile(htmlPath).then(() => blog('页面加载成功')).catch(err => {
    blog('页面加载失败:', err && err.message);
    dialog.showErrorBox('加载失败', String(err && err.message || err));
  });
  win.on('closed', () => { win = null; blog('closed 处理：win = null'); });
}

/* ---------------- 旧版数据迁移 ---------------- */
/**
 * 应用改名为「模拟题库」后，内部标识变为 moni-tiku，userData 目录随之更换。
 * 若新目录还没有数据、而旧目录存在，自动把 data.json / 路径配置搬过来，
 * 避免老用户升级后看不到历史题目。旧目录文件保留不动，可随时回退。
 */
function migrateLegacyData() {
  if (!app.isPackaged) return;   // 开发态目录未变，无需迁移
  const dest = app.getPath('userData');
  const exists = (p) => { try { fs.accessSync(p); return true; } catch (e) { return false; } };
  if (exists(path.join(dest, 'data.json')) || exists(path.join(dest, 'data-path.json'))) return;
  for (const legacyName of ['question-bank-generator', '智能题库生成器']) {
    const oldDir = path.join(app.getPath('appData'), legacyName);
    if (!exists(oldDir)) continue;
    let moved = 0;
    try {
      fs.mkdirSync(dest, { recursive: true });
      for (const f of ['data.json', 'data-path.json']) {
        const src = path.join(oldDir, f);
        if (exists(src)) { fs.copyFileSync(src, path.join(dest, f)); moved++; }
      }
      if (moved) console.log(`[数据迁移] 已从 ${oldDir} 迁入 ${moved} 个数据文件 → ${dest}`);
      return;
    } catch (e) {
      console.warn('[数据迁移] 失败：', e && e.message);
    }
  }
}

/* ---------------- 自绘标题栏：窗口控制 ---------------- */
function regWindow() {
  ipcMain.on('win:min', () => { if (win && !win.isDestroyed()) win.minimize(); });
  ipcMain.on('win:maxToggle', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMaximized()) win.unmaximize(); else win.maximize();
  });
  ipcMain.on('win:close', () => { if (win && !win.isDestroyed()) win.close(); });
  /* v1.42.0：帮助手册配图数据（preload 同步取，见 preload.js 顶部）。
   * 打包版在 resources/help-imgs.json（afterPack 放置），开发模式在 desktop/ 下。 */
  ipcMain.on('help:imgs', (e) => {
    try {
      const p = app.isPackaged
        ? path.join(process.resourcesPath, 'help-imgs.json')
        : path.join(__dirname, 'help-imgs.json');
      e.returnValue = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
    } catch (err) { console.warn('[帮助配图] 读取失败', err.message); e.returnValue = null; }
  });
}

/** 启动流程独立成函数：任何一步抛错都要让用户看见，而不是「进程在跑、桌面没窗口」 */
function bootstrap() {
  blog('bootstrap start · packaged=' + app.isPackaged + ' · ver=' + app.getVersion() + ' · argv=' + JSON.stringify(process.argv.slice(1)));
  try { migrateLegacyData(); } catch (e) { blog('migrateLegacyData 失败:', e && e.message); }
  try { dailySnapshot(); } catch (e) { blog('dailySnapshot 失败:', e && e.message); }   // v1.40.0：每日全量快照
  regData(); regFile(); regAI(); regUpdate(); regWindow(); registerWebSearch();
  setupUpdater();
  setupChineseMenu();
  createTray();
  createWindow();
  blog('bootstrap done · 窗口已创建');
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) { setupChineseMenu(); createWindow(); } });
}

/* 单实例（v1.36.1）：重复双击时只把已有窗口叫到前台，
 * 避免多份进程同时写同一个数据文件，也避免托盘里挂一堆图标 */
const gotLock = app.requestSingleInstanceLock();
blog('singleInstanceLock =', gotLock);
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { blog('second-instance → showMainWindow'); showMainWindow(); });
  app.whenReady().then(bootstrap).catch(err => {
    const msg = (err && err.stack) || String(err);
    blog('bootstrap 抛错:', msg);
    console.error('[启动失败]', msg);
    try {
      dialog.showErrorBox('模拟题库启动失败',
        `程序初始化时出错，未能打开主窗口。\n\n${msg}\n\n请把这段信息反馈给开发者。`);
    } catch (_) { /* 弹窗失败则至少留在控制台 */ }
  });
}
app.on('before-quit', () => { blog('before-quit'); quitting = true; });
app.on('will-quit', () => blog('will-quit'));
app.on('window-all-closed', () => { blog('window-all-closed → quit'); if (process.platform !== 'darwin') app.quit(); });
