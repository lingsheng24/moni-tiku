/**
 * electron-builder afterPack 钩子
 * 在应用目录（win-unpacked）打包完成后，用 rcedit 把正式图标和版本信息写进主程序 exe。
 * 放在这里做是因为宿主机器无法解压 winCodeSign 缓存包（需要管理员权限创建符号链接），
 * 所以关闭了 electron-builder 自带的 signAndEditExecutable，改由本钩子完成资源嵌入。
 */
const path = require('path');
const fs = require('fs');
const { rcedit } = require('rcedit');
const pkg = require('./package.json');

exports.default = async function afterPack(context) {
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  if (!fs.existsSync(exe)) return;
  const icon = path.join(__dirname, 'icons', 'icon.ico');
  if (!fs.existsSync(icon)) { console.warn('[afterPack] 缺少 icons/icon.ico，跳过图标嵌入'); return; }
  console.log(`[afterPack] 嵌入图标与版本信息 -> ${path.basename(exe)}`);
  await rcedit(exe, {
    icon,
    'version-string': {
      FileDescription: pkg.description || '模拟题库',
      ProductName: pkg.build.productName,
      CompanyName: 'JunGe Dev',
      LegalCopyright: pkg.build.copyright,
      FileVersion: pkg.version,
      ProductVersion: pkg.version,
      OriginalFilename: path.basename(exe),
    },
    'file-version': pkg.version,
    'product-version': pkg.version,
  });
  console.log('[afterPack] 图标嵌入完成');

  /* v1.42.0：帮助配图外置——app.html 里 1.7MB base64 内嵌换成存根，
   * 数据放 resources/help-imgs.json，由 preload（help:imgs）注入 window.__HELP_IMGS__。 */
  const htmlPath = path.join(context.appOutDir, 'resources', 'app.html');
  const jsonSrc = path.join(__dirname, 'help-imgs.json');
  if (!fs.existsSync(htmlPath)) { console.warn('[afterPack] 未找到 app.html，跳过配图外置'); return; }
  if (!fs.existsSync(jsonSrc)) { console.warn('[afterPack] 缺少 help-imgs.json，保留内嵌配图'); return; }
  const START = '/* ==== BUILD:helpimgs:START ==== */';
  const END = '/* ==== BUILD:helpimgs:END ==== */';
  let appHtml = fs.readFileSync(htmlPath, 'utf8');
  const si = appHtml.indexOf(START), ei = appHtml.indexOf(END);
  if (si < 0 || ei < 0) { console.warn('[afterPack] app.html 无 helpimgs 标记区，保留内嵌配图'); return; }
  const stub = START + '\n'
    + "const HELP_IMGS_EMBED = {};\n"
    + "const HELP_IMGS = (typeof window !== 'undefined' && window.__HELP_IMGS__) || HELP_IMGS_EMBED;\n"
    + END;
  appHtml = appHtml.slice(0, si) + stub + appHtml.slice(ei + END.length);
  fs.writeFileSync(htmlPath, appHtml);
  fs.copyFileSync(jsonSrc, path.join(context.appOutDir, 'resources', 'help-imgs.json'));
  console.log(`[afterPack] 帮助配图外置完成：app.html ${(fs.statSync(htmlPath).size / 1048576).toFixed(2)}MB + help-imgs.json`);
};
