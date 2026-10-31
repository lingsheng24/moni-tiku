/* ---------- 运行环境：网页版用 IndexedDB，桌面版走 Electron IPC ---------- */
const IS_DESKTOP = !!window.electronAPI;
/* 应用版本号：窗口标题、侧边栏、首页都用它。
 * 桌面版启动后会被安装包的真实版本覆盖；发版时与 desktop/package.json 的 version 一起改。 */
const APP_VER = '1.49.0';
/* 界面实际显示的版本号：桌面版启动后会被安装包真实版本覆盖（applyAppTitle） */
let APP_VER_SHOWN = APP_VER;
/* 背景主题清单（与 CSS 里 html[data-theme=...] 一一对应）
 * 护眼原则：背景低饱和、低刺激；文字用暖深色而非纯黑，降低对比刺眼度 */
const THEMES = [
  { id: 'light', name: '默认浅色', bg: '#f4f6fa', panel: '#ffffff' },
  { id: 'eye-green', name: '护眼豆沙绿', bg: '#c8e6c9', panel: '#f0f7f0' },
  { id: 'parchment', name: '羊皮纸', bg: '#f1e6cd', panel: '#faf4e6' },
  { id: 'linen', name: '米白亚麻', bg: '#efe8dc', panel: '#faf6ef' },
  { id: 'mist', name: '浅灰蓝', bg: '#e4eaf0', panel: '#f5f8fb' },
  { id: 'dark', name: '深夜模式', bg: '#0f1420', panel: '#171e2e' },
];
/* ---------- IndexedDB 驱动（网页版） ---------- */
const idbDriver = (() => {
  let db = null;
  function open() {
    return new Promise((res, rej) => {
      const rq = indexedDB.open('tiku-web', 3);
      rq.onupgradeneeded = e => {
        const d = e.target.result;
        for (const s of ['docs', 'questions', 'mistakes', 'practice']) {
          if (!d.objectStoreNames.contains(s)) {
            d.createObjectStore(s, { keyPath: 'id', autoIncrement: true });
          }
        }
        // v2 新增：考试记录
        if (!d.objectStoreNames.contains('exams')) {
          d.createObjectStore('exams', { keyPath: 'id', autoIncrement: true });
        }
        // v3 新增：间隔复习卡片（SM-2 记忆调度）
        if (!d.objectStoreNames.contains('review')) {
          d.createObjectStore('review', { keyPath: 'id', autoIncrement: true });
        }
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      };
      rq.onsuccess = e => { db = e.target.result; res(db); };
      rq.onerror = rej;
    });
  }
  const tx = (store, mode, fn) => new Promise((res, rej) => {
    const t = db.transaction(store, mode), s = t.objectStore(store);
    const r = fn(s);
    t.oncomplete = () => res(r && r.result !== undefined ? r.result : r);
    t.onerror = rej;
  });
  return {
    open,
    all: (store) => tx(store, 'readonly', s => s.getAll()),
    get: (store, id) => tx(store, 'readonly', s => s.get(id)),
    add: (store, val) => tx(store, 'readwrite', s => s.add(val)),
    put: (store, val) => tx(store, 'readwrite', s => s.put(val)),
    del: (store, id) => tx(store, 'readwrite', s => s.delete(id)),
    clear: (store) => tx(store, 'readwrite', s => s.clear()),
    kvGet: (k) => new Promise(res => {
      const t = db.transaction('kv','readonly').objectStore('kv').get(k);
      t.onsuccess = () => res(t.result); t.onerror = () => res(null);
    }),
    kvSet: (k, v) => tx('kv', 'readwrite', s => s.put(v, k)),
  };
})();
const DB = IS_DESKTOP ? window.electronAPI.db : idbDriver;
/* 题库私有 kv（subjects 等）：桌面版走 bankkv 通道随题库隔离，网页版无多题库 → 同 kv */
if (IS_DESKTOP) { DB.bkvGet = window.electronAPI.db.bkvGet; DB.bkvSet = window.electronAPI.db.bkvSet; }
else { DB.bkvGet = idbDriver.kvGet; DB.bkvSet = idbDriver.kvSet; }
/* 兜底：极老的 preload / 精简运行环境没有题库私有 kv 时退回全局 kv，至少不报错（v1.35.0） */
if (!DB.bkvGet) DB.bkvGet = DB.kvGet;
if (!DB.bkvSet) DB.bkvSet = DB.kvSet;
