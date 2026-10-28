/**
 * 发布更新到 Gitee Release
 * ------------------------------------------------------------
 * 用法：node desktop\发布更新到Gitee.js
 *       node desktop\发布更新到Gitee.js --skip-portable   只传安装版
 *       node desktop\发布更新到Gitee.js --notes-only      只建 Release 不传文件
 *
 * Token：GITEE_TOKEN（用户环境变量，勾选 projects 权限）
 *
 * 与 GitHub / GitCode 的差别：
 *   · Gitee 只作「第三个下载站」，不参与应用内自动更新（更新源仍是 GitHub / GitCode）
 *   · 单附件上限 100MB、单仓库附件总量 1GB（普通项目）→ 超限自动跳过，不中断发布
 *   · 不上传 blockmap / latest.yml（Gitee 不做差量更新，省容量）
 * 幂等：Release 已存在时复用，附件同名的跳过，可反复运行。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const OWNER = 'lingsheng24';
const REPO = 'moni-tiku';
const VERSION = require('./package.json').version;
const TAG = 'v' + VERSION;
const ROOT = path.resolve(__dirname, '..');
const PUB = path.join(ROOT, '发布');
const MB = 1024 * 1024;
const MAX_ATTACH = 100 * MB;   // Gitee 普通项目单附件上限 100MB
const API = 'https://gitee.com/api/v5';

const argv = process.argv.slice(2);
const SKIP_PORTABLE = argv.includes('--skip-portable');
const NOTES_ONLY = argv.includes('--notes-only');

const C = { ok: '\x1b[32m', warn: '\x1b[33m', err: '\x1b[31m', dim: '\x1b[90m', off: '\x1b[0m' };
const info = (m) => console.log(m);
const ok = (m) => console.log(`  ${C.ok}✅ ${m}${C.off}`);
const warn = (m) => console.log(`  ${C.warn}⚠️  ${m}${C.off}`);
const step = (m) => console.log(`\n${C.dim}▶ ${m}${C.off}`);
function die(m) { console.error(`\n${C.err}❌ ${m}${C.off}`); process.exit(1); }

// ── Token ──────────────────────────────────────────────────
function readUserEnv(name) {
  try {
    const out = require('child_process').execSync(
      `powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('${name}','User')"`,
      { encoding: 'utf8', windowsHide: true }
    );
    return (out || '').trim();
  } catch (e) { return ''; }
}
const TOKEN = (process.env.GITEE_TOKEN || '').trim() || readUserEnv('GITEE_TOKEN') || (argv.find((a) => /^[0-9a-f]{32}$/i.test(a)) || '');
if (!TOKEN) {
  die('缺少 GITEE_TOKEN。请先执行：\n   setx GITEE_TOKEN <Gitee 个人访问令牌>   (gitee.com → 设置 → 私人令牌，勾选 projects)\n然后重新打开命令行窗口。');
}

// ── 说明文案 ────────────────────────────────────────────────
function loadChangelog(ver) {
  const p = path.join(ROOT, 'CHANGELOG.md');
  if (!fs.existsSync(p)) return null;
  const txt = fs.readFileSync(p, 'utf8');
  const m = txt.match(new RegExp('^##\\s+' + ver.replace(/\./g, '\\.') + '\\s*$', 'm'));
  if (!m) return null;
  const rest = txt.slice(m.index + m[0].length);
  const next = rest.search(/^##\s+/m);
  return (next >= 0 ? rest.slice(0, next) : rest).trim();
}

function buildNotes() {
  const changes = loadChangelog(VERSION);
  if (!changes) warn(`CHANGELOG.md 里没有 v${VERSION} 的条目，Release 说明将显示占位提示`);
  return [
    `## 模拟题库 v${VERSION}`,
    '',
    '### 本次更新',
    '',
    changes || `> ⚠️ CHANGELOG.md 里没有 v${VERSION} 的条目，发布前请先补写。`,
    '',
    '### 下载',
    '',
    '| 平台 | 说明 |',
    '|---|---|',
    '| **Gitee（本页下方附件）** | 安装版 / 便携版，与另两处内容完全一致 |',
    '| [GitCode](https://gitcode.com/JinFengjian/moni-tiku/releases) | 国内下载最快，应用内在线更新首选 |',
    `| [GitHub](https://github.com/${OWNER}/${REPO}/releases/latest) | 国际站点，国内访问可能较慢 |`,
    '',
    '- **安装版**（`MoniTiKu-Setup-' + VERSION + '.exe`）：双击安装，支持应用内「检查更新」',
    '- **便携版**（`模拟题库-' + VERSION + '-portable.exe`）：免安装单文件，不支持在线更新',
    '',
    '> 应用内自动更新的更新源是 GitHub / GitCode，Gitee 仅作第三个下载备份，',
    '> 因此本页不含 `latest.yml` 与 `blockmap`。',
  ].join('\n');
}

// ── HTTP ───────────────────────────────────────────────────
async function api(method, p, body) {
  const url = `${API}${p}${p.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(TOKEN)}`;
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let data;
  try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || txt || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ── 找文件 ─────────────────────────────────────────────────
function resolveFiles() {
  if (!fs.existsSync(PUB)) die('缺少 发布\\ 目录，请先打包并签名');
  const all = fs.readdirSync(PUB);
  const setup = all.find((f) => new RegExp(`^MoniTiKu-Setup-${VERSION.replace(/\./g, '\\.')}\\.exe$`).test(f));
  if (!setup) die(`发布\\ 里没有 MoniTiKu-Setup-${VERSION}.exe，请先打包并签名`);
  const portable = all.find((f) => new RegExp(`^模拟题库-${VERSION.replace(/\./g, '\\.')}-portable\\.exe$`).test(f));
  return {
    setup: { file: setup, upload: setup },
    portable: portable && !SKIP_PORTABLE ? { file: portable, upload: `MoniTiKu-Portable-${VERSION}.exe` } : null,
  };
}

// ── 上传附件（curl 流式上传，避免把 90MB 读进内存）──────────
function uploadAsset(releaseId, localPath, uploadName) {
  const env = { ...process.env };
  for (const k of ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) delete env[k];
  const r = spawnSync('curl', [
    '-sS', '--ssl-no-revoke', '--noproxy', '*',
    '--max-time', '3600', '--retry', '2', '--retry-delay', '3',
    '-X', 'POST',
    '-H', `Authorization: token ${TOKEN}`,
    // ;filename= 让 Gitee 用英文名存盘（否则直链会带一串 %E6%A8%A1 编码）
    '-F', `file=@${localPath};filename=${uploadName}`,
    `${API}/repos/${OWNER}/${REPO}/releases/${releaseId}/attach_files?access_token=${encodeURIComponent(TOKEN)}`,
  ], { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * MB, env });

  if (r.error) return { ok: false, error: r.error.message };
  let data;
  try { data = JSON.parse(r.stdout); } catch (e) { data = null; }
  if (r.status !== 0 || !data || data.message) {
    return { ok: false, error: (data && (data.message || data.error)) || (r.stderr || r.stdout || 'curl 失败').slice(0, 200) };
  }
  return { ok: true, data };
}

// ── 主流程 ─────────────────────────────────────────────────
(async () => {
  info('══════════ 模拟题库 · 发布更新到 Gitee Release ══════════');
  info(`  账号   : ${OWNER}`);
  info(`  仓库   : ${REPO}`);
  info(`  版本   : ${VERSION}（tag ${TAG}）`);

  const files = resolveFiles();
  info(`  安装版 : ${files.setup.file}`);
  info(`  便携版 : ${files.portable ? files.portable.file : '（跳过）'}`);

  step('准备 Release');
  let release = null;
  try {
    // 注意：Gitee 对不存在的 tag 返回 HTTP 200 + body `null`（不是 404），必须判空
    const found = await api('GET', `/repos/${OWNER}/${REPO}/releases/tags/${encodeURIComponent(TAG)}`);
    if (found && found.id) {
      release = found;
      ok(`Release 已存在：#${release.id}`);
    }
  } catch (e) {
    if (e.status !== 404) die(`查询 Release 失败：${e.message}`);
  }

  if (!release) {
    release = await api('POST', `/repos/${OWNER}/${REPO}/releases`, {
      tag_name: TAG,
      name: `模拟题库 v${VERSION}`,
      body: buildNotes(),
      target_commitish: 'main',
      prerelease: false,
    });
    if (!release || !release.id) die('创建 Release 失败：Gitee 返回空结果（检查令牌是否具备 projects 权限）');
    ok(`Release 已创建：#${release.id}（tag ${TAG}）`);
  }

  // 已存在时刷新说明（保持与 CHANGELOG 一致）
  try {
    release = await api('PATCH', `/repos/${OWNER}/${REPO}/releases/${release.id}`, {
      tag_name: TAG,
      name: `模拟题库 v${VERSION}`,
      body: buildNotes(),
      prerelease: false,
    });
    ok('Release 说明已更新');
  } catch (e) {
    warn(`更新说明失败（不影响下载）：${e.message}`);
  }

  if (NOTES_ONLY) {
    info(`\n已跳过附件上传。Release 页面：https://gitee.com/${OWNER}/${REPO}/releases/tag/${TAG}`);
    return;
  }

  step('上传附件');
  let existing = [];
  try {
    existing = await api('GET', `/repos/${OWNER}/${REPO}/releases/${release.id}/attach_files`) || [];
  } catch (e) { warn(`读取已有附件失败（将继续上传）：${e.message}`); }
  const existingNames = new Set(existing.map((a) => a.name));

  const queue = [files.setup, files.portable].filter(Boolean);
  const results = [];
  for (const item of queue) {
    const full = path.join(PUB, item.file);
    const size = fs.statSync(full).size;
    const sizeMB = (size / MB).toFixed(1);

    if (existingNames.has(item.upload)) {
      ok(`${item.upload} 已存在（${sizeMB} MB），跳过`);
      results.push({ name: item.upload, ok: true, skipped: true });
      continue;
    }
    if (size > MAX_ATTACH) {
      warn(`${item.upload} 为 ${sizeMB} MB，超过 Gitee 单附件上限 100MB，已跳过`);
      results.push({ name: item.upload, ok: false, skipped: true, note: '超过 100MB 上限' });
      continue;
    }

    process.stdout.write(`  ⬆  ${item.upload}  (${sizeMB} MB) 上传中…`);
    const r = uploadAsset(release.id, full, item.upload);
    if (r.ok) {
      console.log(' 完成 ✅');
      results.push({ name: item.upload, ok: true, url: r.data && r.data.browser_download_url });
    } else {
      console.log(' 失败 ✘');
      console.log(`     ${r.error}`);
      results.push({ name: item.upload, ok: false, note: r.error });
    }
  }

  step('结果');
  for (const r of results) {
    if (r.skipped) info(`  –  ${r.name}  ${r.ok ? '已存在，跳过' : r.note}`);
    else if (r.ok) info(`  ✔  ${r.name}\n     ${r.url || ''}`);
    else info(`  ✘  ${r.name}  ${r.note || ''}`);
  }
  info(`\nRelease 页面：https://gitee.com/${OWNER}/${REPO}/releases/tag/${TAG}`);
  const hardFail = results.filter((r) => !r.ok && !r.skipped);
  if (hardFail.length) process.exit(1);
})().catch((e) => die(e.message));
