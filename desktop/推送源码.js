/**
 * 推送源码到 GitHub / GitCode / Gitee 三个平台
 * ------------------------------------------------------------
 * 用法：双击项目根目录的「推送源码.cmd」，或 node desktop\推送源码.js
 *
 * Token 读取顺序：① 进程环境变量 ② Windows 用户环境变量
 *   GH_TOKEN      → GitHub（勾选 repo）
 *   GITCODE_TOKEN → GitCode（勾选 api）
 *   GITEE_TOKEN   → Gitee（勾选 projects）
 * 某个平台没有 Token 时，退回用本机 git 已保存的凭据推送（可能会弹登录框）。
 *
 * 实测坑（已内置处理）：
 *   1. Windows schannel 证书吊销检查在国内必失败（CRYPT_E_NO_REVOCATION_CHECK）
 *      → 关闭 schannelCheckRevoke
 *   2. 本机若开着代理（如 127.0.0.1:1148），对 GitHub 会返回 502
 *      → 推送时清空 http.proxy 与代理环境变量
 *   3. github.com:443 会被间歇性完全掐断（TCP connect 失败，2026-10-28 实战）
 *      → GitHub 推送失败且报连接类错误时，自动切 SSH 备用通道
 *        （git@github.com → ~/.ssh/config 指到 ssh.github.com:443，公钥需已在 GitHub 注册）
 * 脚本不会把 Token 写入任何文件，只在本进程内存里拼进本次推送的 URL。
 */
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function readUserEnv(name) {
  try {
    const out = require('child_process').execSync(
      `powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('${name}','User')"`,
      { encoding: 'utf8', windowsHide: true }
    );
    return (out || '').trim();
  } catch (e) { return ''; }
}

const pick = (name) => (process.env[name] || '').trim() || readUserEnv(name);

const PLATFORMS = [
  {
    name: 'GitHub',
    remote: 'github',
    host: 'github.com',
    user: 'lingsheng24',
    repo: 'lingsheng24/moni-tiku',
    tokenEnv: 'GH_TOKEN',
    sshUrl: 'git@github.com:lingsheng24/moni-tiku.git',   // HTTPS 被掐时的备用通道（走 ssh.github.com:443）
  },
  {
    name: 'GitCode',
    remote: 'gitcode',
    host: 'gitcode.com',
    user: 'JinFengjian',
    repo: 'JinFengjian/moni-tiku',
    tokenEnv: 'GITCODE_TOKEN',
  },
  {
    name: 'Gitee',
    remote: 'gitee',
    host: 'gitee.com',
    user: 'lingsheng24',
    repo: 'lingsheng24/moni-tiku',
    tokenEnv: 'GITEE_TOKEN',
  },
];

// 干净的 git 环境：无代理、不弹交互
const ENV = { ...process.env };
for (const k of ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) {
  delete ENV[k];
}
ENV.GIT_TERMINAL_PROMPT = '0';
ENV.GCM_INTERACTIVE = 'never';

const GIT_OPTS = [
  '-c', 'http.schannelCheckRevoke=false',
  '-c', 'http.proxy=',
  '-c', 'https.proxy=',
];

function git(args, opts = {}) {
  return spawnSync('git', [...GIT_OPTS, ...args], {
    cwd: ROOT,
    env: ENV,
    encoding: 'utf8',
    windowsHide: true,
    ...opts,
  });
}

// ── 0. 前置检查 ────────────────────────────────────────────
const branch = (git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout || '').trim();
if (!branch) {
  console.error('❌ 当前目录不是 git 仓库：' + ROOT);
  process.exit(1);
}

const dirty = (git(['status', '--porcelain']).stdout || '').trim();
if (dirty) {
  const lines = dirty.split('\n');
  console.log('⚠️  还有未提交的改动（共 ' + lines.length + ' 项）：');
  lines.slice(0, 10).forEach((l) => console.log('   ' + l));
  if (lines.length > 10) console.log('   … 其余 ' + (lines.length - 10) + ' 项省略');
  console.log('\n这些改动不会被推送。请先提交：');
  console.log('   git add -A && git commit -m "说明"\n');
}

const head = (git(['log', '-1', '--oneline']).stdout || '').trim();
console.log('══════════ 模拟题库 · 推送源码到三平台 ══════════');
console.log('  仓库 : ' + ROOT);
console.log('  分支 : ' + branch + ' → main');
console.log('  提交 : ' + head);
console.log('');

// ── 1. 依次推送 ────────────────────────────────────────────
const results = [];
for (const p of PLATFORMS) {
  const token = pick(p.tokenEnv);
  const url = token
    ? `https://${p.user}:${token}@${p.host}/${p.repo}.git`
    : p.remote; // 无 Token 时用 remote 名，走本机已存凭据

  process.stdout.write(`→ ${p.name.padEnd(8)} 推送中…`);
  let r = git(['push', url, `HEAD:main`], { timeout: 180000 });
  let out = ((r.stdout || '') + (r.stderr || '')).trim();

  // GitHub 专属：HTTPS 被间歇性掐断（TCP connect 失败）时，自动切 SSH 备用通道
  // （~/.ssh/config 已把 github.com 指到 ssh.github.com:443，公钥须已在 GitHub 注册）
  if (r.status !== 0 && p.name === 'GitHub'
      && /failed to connect|could not connect|connection timed out|unable to access/i.test(out)
      && p.sshUrl) {
    console.log(' HTTPS 被掐，切 SSH 通道重试…');
    r = git(['push', p.sshUrl, 'HEAD:main'], { timeout: 180000 });
    out = ((r.stdout || '') + (r.stderr || '')).trim();
  }

  // 已经把最新提交顶上去，Git 会输出 Everything up-to-date
  if (r.status === 0) {
    const upToDate = /Everything up-to-date/i.test(out);
    console.log(upToDate ? ' 已是最新 ✔' : ' 成功 ✔');
    results.push({ name: p.name, ok: true, note: upToDate ? '已是最新' : '推送成功' });
  } else {
    console.log(' 失败 ✘');
    const firstErr = out.split('\n').filter((l) => /error|fatal|denied|timeout|unable/i.test(l))[0];
    results.push({ name: p.name, ok: false, note: (firstErr || out.split('\n')[0] || '未知错误').slice(0, 160) });
  }
}

// ── 2. 汇总 ────────────────────────────────────────────────
console.log('\n────────────── 结果汇总 ──────────────');
for (const r of results) {
  console.log(`  ${r.ok ? '✔' : '✘'} ${r.name.padEnd(8)} ${r.note}`);
}
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log('\n部分平台推送失败。常见原因：');
  console.log('  · 缺少或过期的 Token → 重新 setx 后重开命令行窗口');
  console.log('  · GitHub 直连超时 → 换网络或稍后重试（GitCode / Gitee 通常不受影响）');
  console.log('  · 远端有本地没有的提交 → 先 git pull --rebase 再推送');
  process.exit(1);
}
console.log('\n三个平台源码已同步到同一提交。');
