/**
 * 一键发布更新到 GitHub + GitCode（两个更新源同时发布）
 * ------------------------------------------------------------
 * 用法：双击「一键发布.cmd」，或 node 一键发布.js
 *
 * Token 读取顺序：① 进程环境变量 ② Windows 用户环境变量 ③ 命令行参数
 *   本机已保存过的话全程免输入。
 * 脚本会顺序执行：发布更新到GitHub.js → 发布更新到GitCode.js
 * 任一平台失败不会中断另一个，最后汇总结果。
 */
const { spawnSync } = require('child_process');
const path = require('path');

function readUserEnv(name) {
  try {
    const out = require('child_process').execSync(
      `powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('${name}','User')"`,
      { encoding: 'utf8', windowsHide: true }
    );
    return (out || '').trim();
  } catch (e) { return ''; }
}
const pick = (name, argIdx) =>
  (process.env[name] || '').trim() || readUserEnv(name) || (process.argv[argIdx] || '').trim();

const GH = pick('GH_TOKEN', 2);
const GC = pick('GITCODE_TOKEN', 3);

console.log('══════════ 模拟题库 · 一键发布更新（GitHub + GitCode）══════════');
console.log(`  版本      : v${require('./package.json').version}`);
console.log(`  GitHub    : ${GH ? 'Token 已就绪 ✔' : '❌ 缺少 GH_TOKEN'}`);
console.log(`  GitCode   : ${GC ? 'Token 已就绪 ✔' : '❌ 缺少 GITCODE_TOKEN'}`);
if (!GH || !GC) {
  console.error('\n缺少 Token。请先设置到本机用户环境变量（一次设置，永久生效）：');
  if (!GH) console.error('  setx GH_TOKEN       <GitHub 个人访问令牌>      https://github.com/settings/tokens');
  if (!GC) console.error('  setx GITCODE_TOKEN  <GitCode 个人访问令牌>     gitcode.com → 设置 → 访问令牌');
  console.error('\n设置后请重新打开命令行窗口再运行本脚本。');
  process.exit(1);
}

function run(script, label) {
  console.log(`\n${'═'.repeat(60)}\n  ${label}\n${'═'.repeat(60)}`);
  const r = spawnSync(process.execPath, [path.join(__dirname, script)], {
    stdio: 'inherit',
    env: { ...process.env, GH_TOKEN: GH, GITCODE_TOKEN: GC },
  });
  return r.status === 0;
}

const results = [];
results.push(['GitHub ', run('发布更新到GitHub.js', '①/②  发布到 GitHub Release')]);
results.push(['GitCode', run('发布更新到GitCode.js', '②/②  发布到 GitCode Release')]);

console.log('\n══════════════════ 汇总 ══════════════════');
for (const [n, okFlag] of results) console.log(`  ${okFlag ? '✅' : '❌'} ${n}`);
const allOk = results.every(r => r[1]);
console.log(allOk
  ? '\n  两个更新源均已发布完成。用户端「检查更新」会自动测速选最快的线路。\n'
  : '\n  ⚠️ 有平台发布失败，请查看上方报错。已成功的平台无需重复发布。\n');
process.exit(allOk ? 0 : 1);
