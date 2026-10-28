/**
 * 一键发布更新到 GitHub + GitCode + Gitee
 * ------------------------------------------------------------
 * 用法：双击「一键发布.cmd」，或 node 一键发布.js
 *
 * Token 读取顺序：① 进程环境变量 ② Windows 用户环境变量 ③ 命令行参数
 *   本机已保存过的话全程免输入。
 * 脚本会顺序执行：发布更新到GitHub.js → 发布更新到GitCode.js → 发布更新到Gitee.js
 * GitHub / GitCode 是应用内更新源，任一失败即视为失败；
 * Gitee 只是第三个下载站，未配置 Token 会跳过，失败也不影响在线更新。
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
const GT = pick('GITEE_TOKEN', 4);

console.log('══════════ 模拟题库 · 一键发布更新（GitHub + GitCode + Gitee）══════════');
console.log(`  版本      : v${require('./package.json').version}`);
console.log(`  GitHub    : ${GH ? 'Token 已就绪 ✔' : '❌ 缺少 GH_TOKEN'}`);
console.log(`  GitCode   : ${GC ? 'Token 已就绪 ✔' : '❌ 缺少 GITCODE_TOKEN'}`);
console.log(`  Gitee     : ${GT ? 'Token 已就绪 ✔（第三个下载站）' : '— 未配置 GITEE_TOKEN，将跳过'}`);
if (!GH || !GC) {
  console.error('\n缺少 Token。请先设置到本机用户环境变量（一次设置，永久生效）：');
  if (!GH) console.error('  setx GH_TOKEN       <GitHub 个人访问令牌>      https://github.com/settings/tokens');
  if (!GC) console.error('  setx GITCODE_TOKEN  <GitCode 个人访问令牌>     gitcode.com → 设置 → 访问令牌');
  console.error('\n设置后请重新打开命令行窗口再运行本脚本。');
  console.error('（GITEE_TOKEN 为可选项：不设置则跳过 Gitee 下载站，不影响两个更新源发布）');
  process.exit(1);
}

function run(script, label) {
  console.log(`\n${'═'.repeat(60)}\n  ${label}\n${'═'.repeat(60)}`);
  const r = spawnSync(process.execPath, [path.join(__dirname, script)], {
    stdio: 'inherit',
    env: { ...process.env, GH_TOKEN: GH, GITCODE_TOKEN: GC, GITEE_TOKEN: GT },
  });
  return r.status === 0;
}

const results = [];
results.push(['GitHub ', true, run('发布更新到GitHub.js', '①/③  发布到 GitHub Release')]);
results.push(['GitCode', true, run('发布更新到GitCode.js', '②/③  发布到 GitCode Release')]);
if (GT) {
  results.push(['Gitee  ', false, run('发布更新到Gitee.js', '③/③  发布到 Gitee Release（第三个下载站）')]);
} else {
  console.log('\n（未配置 GITEE_TOKEN，跳过 Gitee）');
}

console.log('\n══════════════════ 汇总 ══════════════════');
for (const [n, required, okFlag] of results) {
  const mark = okFlag ? '✅' : (required ? '❌' : '⚠️ ');
  console.log(`  ${mark} ${n}${okFlag ? '' : (required ? '  发布失败' : '  失败（不影响在线更新，仅少一个下载站）')}`);
}
const allRequiredOk = results.filter(r => r[1]).every(r => r[2]);
const giteeOk = results.filter(r => !r[1]).every(r => r[2]);
if (allRequiredOk) {
  console.log('\n  两个更新源已发布完成，用户端「检查更新」会自动测速选最快的线路。');
  if (!giteeOk) console.log('  ⚠️ Gitee 下载站未成功（多半是 Token 过期或附件超 100MB），可稍后单独重跑：node desktop\\发布更新到Gitee.js');
  else if (GT) console.log('  三个平台下载均已就绪。');
  console.log('');
} else {
  console.log('\n  ⚠️ 更新源发布失败，请查看上方报错。已成功的平台无需重复发布。\n');
}
process.exit(allRequiredOk ? 0 : 1);
