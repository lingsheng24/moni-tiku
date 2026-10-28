/* 最小复现：真实 electron-updater 从 GitCode 下载更新 */
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

app.disableHardwareAcceleration();   // 无界面环境 GPU 进程崩溃，禁用硬件加速

app.whenReady().then(() => {
  autoUpdater.autoDownload = false;
  autoUpdater.forceDevUpdateConfig = true;   // 开发模式（未打包）下也允许检查
  autoUpdater.logger = console;
  autoUpdater.on('checking-for-update', () => console.log('EV: checking'));
  autoUpdater.on('update-available', i => {
    console.log('EV: available', i.version);
    autoUpdater.downloadUpdate().catch(e => { console.log('EV: dl-error:', e.message); app.exit(1); });
  });
  autoUpdater.on('update-not-available', () => { console.log('EV: not-available'); app.exit(0); });
  let lastPct = -1;
  autoUpdater.on('download-progress', p => {
    const pct = Math.round(p.percent);
    if (pct >= lastPct + 20) { lastPct = pct; console.log('EV: progress', pct + '%', (p.bytesPerSecond / 1048576).toFixed(2) + 'MB/s'); }
  });
  autoUpdater.on('update-downloaded', () => { console.log('EV: downloaded OK'); app.exit(0); });
  autoUpdater.on('error', e => { console.log('EV: error:', e && e.message || e); app.exit(1); });

  /* 开发模式下 app.version 是 Electron 自身版本 → 永远「已是最新」。
     强制把当前版本改成 1.0.0，走完整的「有更新 → 下载」链路 */
  try { autoUpdater.currentVersion = '1.0.0'; } catch (e) { console.log('currentVersion 设置失败:', e.message); }

  /* 与 main.js 相同的 GitCode noCache 剥离补丁 */
  const ex = autoUpdater.httpExecutor;
  if (ex && !ex.__gitcodePatched) {
    const orig = ex.request.bind(ex);
    ex.request = function (options, ...rest) {
      try {
        if (options && /(^|\.)gitcode\.com$/.test(options.hostname || '') && options.path && options.path.includes('noCache=')) {
          const [p, q] = options.path.split('?');
          if (q) {
            const sp = new URLSearchParams(q);
            if (sp.has('noCache')) {
              console.log('PATCH-STRIP: 剥离 noCache，原 path:', options.path);
              sp.delete('noCache');
              options = { ...options, path: p + (sp.toString() ? '?' + sp.toString() : '') };
            }
          }
        }
      } catch (e) { }
      return orig(options, ...rest);
    };
    ex.__gitcodePatched = true;
  }

  autoUpdater.setFeedURL({
    provider: 'generic',
    url: 'https://gitcode.com/JinFengjian/moni-tiku/releases/download/latest/',
    channel: 'latest',
    forceDevUpdateConfig: true,   // 开发模式（未打包）下也允许检查
  });
  autoUpdater.checkForUpdates().catch(e => { console.log('EV: check-error:', e.message); app.exit(1); });
  setTimeout(() => { console.log('EV: 超时（4 分钟）退出'); app.exit(2); }, 240000);
});
