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
};
