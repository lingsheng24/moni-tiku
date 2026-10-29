const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch, ...args) => ipcRenderer.invoke(ch, ...args);

/* v1.42.0：帮助手册配图外置——数据在 resources/help-imgs.json（打包由 afterPack 放置），
 * 主进程同步读出后经 contextBridge 注入；网页版则用 HTML 内嵌的 HELP_IMGS_EMBED。 */
try {
  const imgs = ipcRenderer.sendSync('help:imgs');
  if (imgs && Object.keys(imgs).length) contextBridge.exposeInMainWorld('__HELP_IMGS__', imgs);
} catch (e) { console.warn('[preload] 帮助配图注入失败', e); }

contextBridge.exposeInMainWorld('electronAPI', {
  /** 是否桌面版 */
  isDesktop: true,
  /** 与网页版 IndexedDB 驱动同名的存储接口 */
  db: {
    open: () => Promise.resolve(true),
    all: (store) => invoke('data:all', store),
    get: (store, id) => invoke('data:get', store, id),
    add: (store, item) => invoke('data:add', store, item),
    put: (store, item) => invoke('data:put', store, item),
    del: (store, id) => invoke('data:del', store, id),
    clear: (store) => invoke('data:clear', store),
    kvGet: (k) => invoke('kv:get', k),
    kvSet: (k, v) => invoke('kv:set', k, v),
    /** 题库私有 kv（subjects 等随题库隔离的数据）；网页版回退到同一 IndexedDB kv */
    bkvGet: (k) => invoke('bankkv:get', k),
    bkvSet: (k, v) => invoke('bankkv:set', k, v),
  },
  /** ---- 多题库管理（桌面版 v1.31.0）----
   *  list 返回 [{id,name,createdAt,counts:{docs,questions,exams,practice,mistakes,review}}] */
  banks: {
    list: () => invoke('bank:list'),
    current: () => invoke('bank:current'),
    create: (name) => invoke('bank:create', name),
    switchTo: (id) => invoke('bank:switch', id),
    rename: (id, name) => invoke('bank:rename', id, name),
    del: (id) => invoke('bank:del', id),
  },
  /** 打开本地文件选择并解析，返回 [{title,name,text,type,pages,size,error}] */
  pickFiles: () => invoke('file:import'),
  /** 保存文件到本机，返回保存路径或 false */
  saveFile: ({ name, content, filters }) => invoke('file:save', { name, content, filters }),
  /** 导出试卷为 Word（.docx）：主进程生成 OOXML 后弹保存对话框 */
  savePaperDocx: ({ blocks, size, name }) => invoke('paper:saveDocx', { blocks, size, name }),
  /** 导出试卷为 PDF：主进程用 Chromium 打印引擎输出，pageSize = A3 / A4 */
  savePaperPdf: ({ html, size, name }) => invoke('paper:savePdf', { html, size, name }),
  /** AI 代理请求，返回模型回复文本 */
  chat: (payload) => invoke('ai:chat', payload),
  /** AI 流式请求：生成中通过 onChunk(delta, receivedLen) 实时回调，最终返回完整文本 */
  chatStream: (payload, onChunk) => {
    const streamId = 's' + Date.now() + '-' + Math.random().toString(36).slice(2);
    const listener = (e, d) => { if (d && d.id === streamId) onChunk && onChunk(d.delta, d.len); };
    ipcRenderer.on('ai:stream', listener);
    return invoke('ai:chatStream', { ...payload, streamId })
      .finally(() => ipcRenderer.removeListener('ai:stream', listener));
  },
  /** 打开数据所在文件夹 */
  openDataDir: () => invoke('app:openDataDir'),
  openBackupDir: () => invoke('app:openBackupDir'),
  /** v1.41.0 全量备份 / 恢复（所有题库 + 全局设置，单 JSON 文件，主进程出对话框） */
  exportAll: () => invoke('app:exportAll'),
  importAll: () => invoke('app:importAll'),
  /** 联网查询：抓取搜索引擎结果并解析为 {title,url,snippet,site} 列表 */
  webSearch: (payload) => invoke('web:search', payload),
  /** 搜索联想词（v1.38.0）：输入提示，失败静默返回 { ok:true, items:[] } */
  webSuggest: (q) => invoke('web:suggest', { q }),
  /** 用系统默认浏览器打开链接（仅 http/https） */
  openExternal: (url) => invoke('app:openExternal', { url }),
  /** 数据文件路径管理 */
  getDataPath: () => invoke('data:getPath'),
  chooseDataPath: () => invoke('data:choosePath'),
  resetDataPath: () => invoke('data:resetPath'),
  /** 应用菜单事件（汉化菜单里的「导入文档 / 系统设置 / 数据」等入口） */
  onMenu: (cb) => ipcRenderer.on('menu', (e, action) => cb(action)),
  /** ---- 自动更新 ---- */
  /** 当前应用版本 */
  getAppVersion: () => invoke('app:version'),
  /** 检查更新，返回 {ok, message?}；结果通过 onUpdate 事件推送 */
  checkUpdate: () => invoke('app:checkUpdate'),
  /** 下载更新包 */
  downloadUpdate: () => invoke('app:downloadUpdate'),
  /** 取消正在进行的下载 */
  cancelDownload: () => invoke('app:cancelDownload'),
  /** 退出并安装已下载的更新（弹安装向导，非静默） */
  installUpdate: () => invoke('app:installUpdate'),
  /** 读取内置更新源地址（只读，打包时已固定） */
  getUpdateUrl: () => invoke('app:getUpdateUrl'),
  /** 可选下载源列表 + 最近测速结果 + 当前/锁定源 */
  getUpdateSources: () => invoke('app:updateSources'),
  /** 手动指定下载源；传 '' 恢复「自动选最快」 */
  setUpdateSource: (id) => invoke('app:setUpdateSource', id),
  /** 订阅更新事件：
   *  type = checking | probing | source | available | none | progress | switch | downloaded | canceled | error */
  onUpdate: (cb) => ipcRenderer.on('update', (e, data) => cb(data)),
  /** ---- 自绘标题栏：窗口控制 ---- */
  winMin: () => ipcRenderer.send('win:min'),
  winMaxToggle: () => ipcRenderer.send('win:maxToggle'),
  winClose: () => ipcRenderer.send('win:close'),
  /** 最大化状态变化（用于切换最大化/还原图标） */
  onWinState: (cb) => ipcRenderer.on('win-state', (e, data) => cb(data)),
});
