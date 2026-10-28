/**
 * 发布到 GitHub Release
 * ------------------------------------------------------------
 * 用法一（推荐，双击 发布更新到GitHub.cmd，token 输入时不显示）：
 * 用法二：set GH_TOKEN=ghp_xxx && node 发布更新到GitHub.js
 *
 * 会自动完成：创建/复用仓库 → 创建 Release → 上传 4 个文件
 *
 *   ① 在线更新三件套（electron-updater 用，文件名必须与 latest.yml 一致）：
 *        latest.yml / MoniTiKu-Setup-x.y.z.exe / MoniTiKu-Setup-x.y.z.exe.blockmap
 *   ② 绿色便携版（供手动下载，不参与在线更新）：
 *        MoniTiKu-Portable-x.y.z.exe
 *
 * 上传后：用户端点「检查更新」收到新版本；也可直接下载便携版免安装使用。
 *
 * ⚠️ 重要：GitHub 会把 Release 资源名里的非 ASCII 字符（中文）清洗掉，
 *    所以所有上传文件名一律用 ASCII（MoniTiKu-*），本地中文名保持不变。
 *
 * Token 申请：https://github.com/settings/tokens → Generate new token (classic)
 *             勾选 public_repo（仓库已存在时够用）；若要自动建仓库则勾 repo
 */
const fs = require('fs');
const path = require('path');

const TOKEN = (process.env.GH_TOKEN || process.argv[2] || '').trim();
const OWNER = 'lingsheng24';
const REPO = 'moni-tiku';
const VERSION = require('./package.json').version;
const TAG = 'v' + VERSION;
const REL_DIR = path.join(__dirname, 'release');

const API = 'https://api.github.com';
const HDR = {
  Accept: 'application/vnd.github+json',
  Authorization: 'Bearer ' + TOKEN,
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'moni-tiku-publisher',
};

const ok = (m) => console.log('  ✅ ' + m);
const info = (m) => console.log('  ·  ' + m);
const step = (m) => console.log('\n▶ ' + m);
function die(m) { console.error('\n❌ ' + m); process.exit(1); }

async function gh(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { ...HDR, ...(options.headers || {}) } });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!res.ok) {
    const msg = (data && data.message) || text || res.statusText;
    const err = new Error(`HTTP ${res.status} ${msg}`);
    err.status = res.status; err.body = data;
    throw err;
  }
  return data;
}

/* ---------- 1. 仓库 ---------- */
async function ensureRepo() {
  step('检查仓库 ' + OWNER + '/' + REPO);
  try {
    const r = await gh(`${API}/repos/${OWNER}/${REPO}`);
    ok(`仓库已存在：${r.html_url}${r.private ? '  ⚠️ 私有仓库！用户端无法匿名下载更新包，请到 Settings → Danger Zone 改为 Public' : '（公开 ✔）'}`);
    if (r.private) die('仓库是私有的，用户端无法匿名下载更新包。请改为 Public 后重新运行本脚本。');
    return r;
  } catch (e) {
    if (e.status !== 404) throw e;
    info('仓库不存在，正在创建（公开）…');
    const r = await gh(`${API}/user/repos`, {
      method: 'POST',
      body: JSON.stringify({
        name: REPO, description: '模拟题库 - 本地智能出题与练习工具（更新发布）',
        private: false, auto_init: true,
      }),
    });
    ok('仓库已创建：' + r.html_url);
    return r;
  }
}

/* ---------- 2. Release ---------- */
async function getOrCreateRelease() {
  step(`准备 Release ${TAG}`);
  try {
    const r = await gh(`${API}/repos/${OWNER}/${REPO}/releases/tags/${TAG}`);
    ok('Release 已存在，将覆盖其中的更新文件');
    return r;
  } catch (e) {
    if (e.status !== 404) throw e;
    const r = await gh(`${API}/repos/${OWNER}/${REPO}/releases`, {
      method: 'POST',
      body: JSON.stringify({
        tag_name: TAG, name: `模拟题库 v${VERSION}`,
        body: buildReleaseNotes(),
        draft: false, prerelease: false,
      }),
    });
    ok('Release 已创建');
    return r;
  }
}

/**
 * 从 ..\CHANGELOG.md 读取当前版本的变更说明
 * 格式：以「## 版本号」开头，到下一个「## 」之前结束
 */
function loadChangelog(ver) {
  const v = ver || VERSION;
  const p = path.join(__dirname, '..', 'CHANGELOG.md');
  if (!fs.existsSync(p)) return null;
  const txt = fs.readFileSync(p, 'utf8');
  const m = txt.match(new RegExp('^##\\s+' + v.replace(/\./g, '\\.') + '\\s*$', 'm'));
  if (!m) return null;
  const rest = txt.slice(m.index + m[0].length);
  const next = rest.search(/^##\s+/m);
  return (next >= 0 ? rest.slice(0, next) : rest).trim();
}

/**
 * Release 说明文案（Markdown）：变更内容 + 下载表格 + 更新说明
 * @param ver    版本号，默认当前版本
 * @param assets 已有资源列表（回填历史版本时用线上的真实文件；常态发布时为 null，用本次待上传的文件）
 */
function buildReleaseNotes(ver, assets) {
  const v = ver || VERSION, tag = 'v' + v;
  const changes = loadChangelog(v);
  let setupRow, portableRow;
  if (assets && assets.length) {
    const su = assets.find(a => /Setup-/.test(a.name)), po = assets.find(a => /Portable-/.test(a.name));
    setupRow = su ? `| [**${su.name}**](${su.browser_download_url}) | 安装版（NSIS）。双击安装，支持**应用内在线更新**，推荐 |` : null;
    portableRow = po ? `| [**${po.name}**](${po.browser_download_url}) | 绿色便携版。免安装，双击即用，**不支持在线更新**（需手动下载替换） |` : null;
  } else {
    setupRow = `| [**${files[1]}**](https://github.com/${OWNER}/${REPO}/releases/download/${tag}/${files[1]}) | 安装版（NSIS）。双击安装，支持**应用内在线更新**，推荐 |`;
    portableRow = portableFile
      ? `| [**${portableFile.upload}**](https://github.com/${OWNER}/${REPO}/releases/download/${tag}/${portableFile.upload}) | 绿色便携版。免安装，双击即用，**不支持在线更新**（需手动下载替换） |`
      : null;
  }
  return [
    `## 模拟题库 v${v}`,
    '',
    '### 本次更新',
    '',
    changes || `> ⚠️ CHANGELOG.md 里没有 v${v} 的条目，发布前请先补写。`,
    '',
    '### 下载',
    '',
    '| 文件 | 说明 |',
    '|---|---|',
    setupRow,
    portableRow,
    '',
    '> 两者功能完全一致，数据存在本地，互不影响。便携版适合 U 盘随身携带或无法安装软件的电脑。',
    '',
    '### 在线更新',
    '',
    '安装版用户在应用内「系统设置 → 软件更新 → 检查更新」即可收到新版本；',
    '发现新版后需本人确认才下载，下载完成再确认一次才覆盖安装。',
    '便携版请重新下载本页面的便携版文件替换。',
    '',
    '---',
    '',
    `<sub>本仓库仅用于软件分发。更新源地址：<code>https://github.com/${OWNER}/${REPO}/releases/latest/download/</code></sub>`,
  ].join('\n');
}

/**
 * 只更新 Release 说明，不上传文件。
 * 用途：给已发布的历史版本补写变更内容（按 CHANGELOG.md 里出现的版本号逐一回填）。
 */
async function backfillNotes() {
  const p = path.join(__dirname, '..', 'CHANGELOG.md');
  if (!fs.existsSync(p)) die('缺少 ..\\CHANGELOG.md');
  const vers = [...fs.readFileSync(p, 'utf8').matchAll(/^##\s+([\d]+\.[\d]+\.[\d]+)\s*$/gm)].map(m => m[1]);
  if (!vers.length) die('CHANGELOG.md 里没有找到任何版本号条目');
  info(`CHANGELOG 中的版本: ${vers.join('、')}`);
  for (const v of vers) {
    let rel = null;
    try { rel = await gh(`${API}/repos/${OWNER}/${REPO}/releases/tags/v${v}`); } catch (e) { /* 404 未发布 */ }
    if (!rel) { info(`v${v} 尚无已发布的 Release，跳过`); continue; }
    const assets = (rel.assets || []).filter(a => a.name.endsWith('.exe'));
    await gh(`${API}/repos/${OWNER}/${REPO}/releases/${rel.id}`, {
      method: 'PATCH', body: JSON.stringify({ body: buildReleaseNotes(v, assets) }),
    });
    ok(`v${v} 说明已更新（${assets.length} 个安装包）`);
  }
}

/** 删除同名旧资源，避免重复上传报 422 */
async function removeOldAssets(release, names) {
  const old = (release.assets || []).filter(a => names.includes(a.name));
  if (!old.length) return;
  info(`清理 ${old.length} 个同名旧文件…`);
  for (const a of old) {
    await fetch(`${API}/repos/${OWNER}/${REPO}/releases/assets/${a.id}`, { method: 'DELETE', headers: HDR });
  }
}

/* ---------- 3. 上传 ---------- */
/** uploadName 为 GitHub 上显示/下载用的文件名（必须是 ASCII） */
async function uploadAsset(release, file, uploadName) {
  const full = path.join(REL_DIR, file);
  if (!fs.existsSync(full)) die(`缺少文件：${full}\n请先执行打包exe.cmd 完成打包`);
  const name = uploadName || file;
  const buf = fs.readFileSync(full);
  const url = `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...HDR, 'Content-Type': 'application/octet-stream', 'Content-Length': String(buf.length) },
    body: buf,
    signal: AbortSignal.timeout(900000),   // 95MB，给足 15 分钟
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) die(`上传 ${name} 失败：HTTP ${res.status} ${data.message || ''}`);
  ok(`${name}  (${(buf.length / 1048576).toFixed(1)} MB)` + (name !== file ? `   ← ${file}` : ''));
  return data;
}

/** 从 latest.yml 读取真实安装包名，与 electron-updater 实际请求的文件保持一致 */
function resolveFiles() {
  const ymlPath = path.join(REL_DIR, 'latest.yml');
  if (!fs.existsSync(ymlPath)) die('缺少 release\\latest.yml，请先执行打包');
  const yml = fs.readFileSync(ymlPath, 'utf8');
  const m = yml.match(/^path:[ \t]*(.+)$/m);
  if (!m) die('latest.yml 里找不到 path 字段');
  return ['latest.yml', m[1].trim(), m[1].trim() + '.blockmap'];
}
let files = [];         // 模块级，供 Release 说明文案引用（在线更新三件套）
let portableFile = null; // 模块级：便携版 { local, upload }

/**
 * 便携版（绿色免安装，仅手动下载，不参与在线更新）
 * electron-builder 的 portable 产物默认名为「<productName> <version>.exe」，
 * 含中文，上传时统一改名为 ASCII。
 */
function resolvePortable() {
  const cands = [`${require('./package.json').build.productName} ${VERSION}.exe`, `模拟题库 ${VERSION}.exe`];
  const hit = [...new Set(cands)].find(f => fs.existsSync(path.join(REL_DIR, f)));
  if (!hit) {
    // 兜底：release 目录下非 Setup / 非卸载器的 exe
    const fallback = fs.readdirSync(REL_DIR).find(f =>
      f.endsWith('.exe') && !/Setup|Uninstall|卸载/i.test(f));
    if (!fallback) return null;
    return { local: fallback, upload: `MoniTiKu-Portable-${VERSION}.exe` };
  }
  return { local: hit, upload: `MoniTiKu-Portable-${VERSION}.exe` };
}

/* ---------- 主流程 ---------- */
(async () => {
  console.log('══════════ 模拟题库 · 发布更新到 GitHub Release ══════════');
  if (!TOKEN) die('未获取到 GitHub Token。\n请双击 发布更新到GitHub.cmd 输入，或执行：set GH_TOKEN=你的token && node 发布更新到GitHub.js');

  // 只更新说明，不上传文件：node 发布更新到GitHub.js --backfill
  if (process.argv.includes('--backfill')) {
    step('回填历史版本说明（按 CHANGELOG.md）');
    await backfillNotes();
    console.log('\n✅ 历史版本说明回填完成\n');
    return;
  }

  files = resolveFiles();
  portableFile = resolvePortable();
  console.log(`  账号   : ${OWNER}`);
  console.log(`  仓库   : ${REPO}`);
  console.log(`  版本   : ${VERSION}（tag ${TAG}）`);
  console.log(`  更新三件套: ${files.join('、')}`);
  console.log(`  便携版    : ${portableFile ? portableFile.local + '  →  ' + portableFile.upload : '未找到（跳过）'}`);
  if (!loadChangelog()) info(`⚠️  CHANGELOG.md 里没有 v${VERSION} 的条目，Release 说明将显示占位提示`);

  await ensureRepo();
  const release = await getOrCreateRelease();
  const uploadNames = [...files, portableFile && portableFile.upload].filter(Boolean);
  await removeOldAssets(release, uploadNames);

  step(`上传文件（共 ${uploadNames.length} 个，约 ${(uploadNames.length * 95).toFixed(0)} MB，请耐心等待）`);
  for (const f of files) await uploadAsset(release, f);
  if (portableFile) await uploadAsset(release, portableFile.local, portableFile.upload);

  step('同步 Release 说明（变更内容 + 下载表格）');
  await gh(`${API}/repos/${OWNER}/${REPO}/releases/${release.id}`, {
    method: 'PATCH', body: JSON.stringify({ body: buildReleaseNotes() }),
  });
  ok('说明已更新');

  step('校验线上文件');
  const final = await gh(`${API}/repos/${OWNER}/${REPO}/releases/tags/${TAG}`);
  for (const a of final.assets) info(`${a.name}  ${(a.size / 1048576).toFixed(1)} MB`);

  const base = `https://github.com/${OWNER}/${REPO}/releases/latest/download/`;
  console.log('\n══════════════════ 发布完成 ══════════════════');
  console.log('  Release 页面: ' + final.html_url);
  console.log('  更新源地址  : ' + base);
  console.log('\n  验证（应能下载到文件）:');
  console.log('    ' + base + 'latest.yml');
  console.log('    ' + base + encodeURIComponent(files[1]));
  if (portableFile) console.log('    ' + base + encodeURIComponent(portableFile.upload));
  console.log('\n  用户端点「系统设置 → 软件更新 → 检查更新」即可收到本次更新；');
  console.log('  也可直接下载便携版免安装使用。');
  console.log('══════════════════════════════════════════════\n');
})().catch(e => die(e.message || String(e)));
