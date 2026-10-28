/**
 * 发布到 GitCode Release（第二个更新源，国内直连）
 * ------------------------------------------------------------
 * 用法：双击 一键发布.cmd 会自动调用；也可单独执行：
 *       set GITCODE_TOKEN=xxx && node 发布更新到GitCode.js
 *
 * 与 GitHub 发布内容完全一致，两者互为备份：
 *   ① 在线更新三件套：latest.yml / MoniTiKu-Setup-x.y.z.exe / *.blockmap
 *   ② 绿色便携版：MoniTiKu-Portable-x.y.z.exe
 *
 * 上传流程（GitCode 与 GitHub 不同，是「预签名地址 + PUT」两段式）：
 *   1) GET /repos/:owner/:repo/releases/:tag/upload_url?file_name=xxx
 *      → 返回 { url, headers }（华为云 OBS 预签名）
 *   2) 用返回的 headers 原样 PUT 文件字节到该 url
 *      headers 里的 x-obs-callback 会让 OBS 回调 GitCode，把附件挂到 Release 上
 *
 * Token 申请：gitcode.com → 头像 → 设置 → 访问令牌（勾 api / read_user / write_repository）
 *            也可存到本机用户环境变量 GITCODE_TOKEN（脚本会自动读取）
 */
const fs = require('fs');
const path = require('path');

/** Windows 用户环境变量兜底：命令行窗口在 setx 之前打开时读不到新变量 */
function readUserEnv(name) {
  try {
    return (require('child_process').execSync(
      `powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('${name}','User')"`,
      { encoding: 'utf8', windowsHide: true }) || '').trim();
  } catch (e) { return ''; }
}
const TOKEN = (process.env.GITCODE_TOKEN || '').trim() || readUserEnv('GITCODE_TOKEN') || (process.argv[2] || '').trim();
const OWNER = 'JinFengjian';
const REPO = 'moni-tiku';
const BRANCH = 'main';
const VERSION = require('./package.json').version;
const TAG = 'v' + VERSION;
const REL_DIR = path.join(__dirname, 'release');

const API = 'https://api.gitcode.com/api/v5';
/* ⚠️ 别用 `-/releases/latest/downloads/`（那是网页不是文件） */
const DOWNLOAD_BASE = `https://gitcode.com/${OWNER}/${REPO}/releases/download/latest/`;

const ok = (m) => console.log('  ✅ ' + m);
const info = (m) => console.log('  ·  ' + m);
const step = (m) => console.log('\n▶ ' + m);
function die(m) { console.error('\n❌ ' + m); process.exit(1); }

/** GitCode v5 API：token 走 query 参数（也可 PRIVATE-TOKEN 头，query 最稳） */
async function gc(p, options = {}) {
  const url = API + p + (p.includes('?') ? '&' : '?') + 'access_token=' + encodeURIComponent(TOKEN);
  const res = await fetch(url, {
    ...options,
    // ⚠️ 必须显式声明 Content-Type: application/json —— 否则 GitCode 不解析请求体，
    //    会报「tag_name不能为空」（实测：无该头 400，有该头 200）
    headers: {
      Accept: 'application/json', 'Content-Type': 'application/json',
      'User-Agent': 'moni-tiku-publisher', ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!res.ok) {
    const msg = (data && (data.error_message || data.message)) || text || res.statusText;
    const err = new Error(`HTTP ${res.status} ${msg}`);
    err.status = res.status; err.body = data;
    throw err;
  }
  return data;
}

/* ---------- 1. 仓库 ---------- */
async function ensureRepo() {
  step(`检查仓库 ${OWNER}/${REPO}`);
  try {
    const r = await gc(`/repos/${OWNER}/${REPO}`);
    const isPublic = r.public === true || r.visibility === 'public' || r.private === false;
    ok(`仓库已存在：https://gitcode.com/${OWNER}/${REPO}${isPublic ? '（公开 ✔）' : '  ⚠️ 非公开！用户端无法匿名下载更新包'}`);
    if (!isPublic) die('仓库不是公开的，用户端无法匿名下载更新包。请到仓库设置改为公开后重新运行。');
    return r;
  } catch (e) {
    if (e.status !== 404) throw e;
    info('仓库不存在，正在创建（公开）…');
    const r = await gc('/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name: REPO, description: '模拟题库 - 本地智能出题与练习工具（更新发布）',
        private: false, auto_init: true,
      }),
    });
    ok('仓库已创建：https://gitcode.com/' + (r.full_name || `${OWNER}/${REPO}`));
    return r;
  }
}

/* ---------- 2. Release ---------- */
async function getRelease() {
  try { return await gc(`/repos/${OWNER}/${REPO}/releases/${TAG}`); } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}
async function getOrCreateRelease() {
  step(`准备 Release ${TAG}`);
  let r = await getRelease();
  if (r) { ok('Release 已存在，将覆盖其中的更新文件'); return r; }
  info('Release 不存在，正在创建…');
  r = await gc(`/repos/${OWNER}/${REPO}/releases`, {
    method: 'POST',
    body: JSON.stringify({
      tag_name: TAG, name: `模拟题库 v${VERSION}`,
      body: buildReleaseNotes(),
      target_commitish: BRANCH,   // tag 不存在时用默认分支尖部创建
      release_status: 'latest',   // 关键：让 /releases/latest/downloads/ 指向本版本
    }),
  });
  ok('Release 已创建');
  return r;
}

/* ---------- 3. 说明文案 ---------- */
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

function buildReleaseNotes(ver) {
  const v = ver || VERSION;
  const changes = loadChangelog(v);
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
    files[1] ? `| [**${files[1]}**](https://gitcode.com/${OWNER}/${REPO}/releases/download/v${v}/${files[1]}) | 安装版（NSIS）。双击安装，支持**应用内在线更新**，推荐 |` : null,
    portableFile ? `| [**${portableFile.upload}**](https://gitcode.com/${OWNER}/${REPO}/releases/download/v${v}/${portableFile.upload}) | 绿色便携版。免安装，双击即用，**不支持在线更新**（需手动下载替换） |` : null,
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
    `<sub>本仓库仅用于软件分发。同一版本同时发布于 [GitHub](https://github.com/lingsheng24/moni-tiku/releases/tag/v${v}) 与 GitCode，两边文件完全一致。更新源地址：<code>${DOWNLOAD_BASE}</code></sub>`,
  ].filter(Boolean).join('\n');
}

/* ---------- 4. 上传（预签名 + PUT） ---------- */
/** 幂等：已存在同名且大小一致的附件就跳过，重复运行脚本不会重复传 90MB */
function alreadyUploaded(name, size, exist) {
  return (exist || []).some(a => a.name === name && (!a.size || !size || a.size === size));
}
async function uploadAsset(file, uploadName, exist) {
  const full = path.join(REL_DIR, file);
  if (!fs.existsSync(full)) die(`缺少文件：${full}\n请先完成打包`);
  const name = uploadName || file;
  const size = fs.statSync(full).size;
  if (alreadyUploaded(name, size, exist)) { ok(`${name}  已存在且大小一致，跳过`); return; }
  const buf = fs.readFileSync(full);

  // ① 取预签名上传地址
  const up = await gc(`/repos/${OWNER}/${REPO}/releases/${TAG}/upload_url?file_name=${encodeURIComponent(name)}`);
  if (!up || !up.url) die(`获取 ${name} 上传地址失败：${JSON.stringify(up).slice(0, 200)}`);

  // ② PUT 上传，headers 必须原样带上（x-obs-* 是 OBS 校验与回调所需）
  const h = { ...(up.headers || {}) };
  h['Content-Length'] = String(buf.length);
  const res = await fetch(up.url, {
    method: 'PUT', headers: h, body: buf,
    signal: AbortSignal.timeout(900000),   // 95MB，给足 15 分钟
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    die(`上传 ${name} 失败：HTTP ${res.status} ${t.slice(0, 200)}`);
  }
  ok(`${name}  (${(buf.length / 1048576).toFixed(1)} MB)` + (name !== file ? `   ← ${file}` : ''));
}

/** 清理同名旧附件，避免重复。接口不确定时静默跳过（不阻断发布） */
async function removeOldAssets(names) {
  const rel = await getRelease();
  const old = ((rel && rel.assets) || []).filter(a => names.includes(a.name));
  if (!old.length) return;
  info(`清理 ${old.length} 个同名旧附件…`);
  for (const a of old) {
    const paths = [
      `/repos/${OWNER}/${REPO}/releases/${TAG}/assets/${a.id}`,
      `/repos/${OWNER}/${REPO}/releases/${TAG}/attachments/${a.id}`,
    ];
    for (const p of paths) {
      try { await gc(p, { method: 'DELETE' }); ok(`已删除 ${a.name}`); break; }
      catch (e) { /* 换下一个路径试 */ }
    }
  }
}

/* ---------- 5. 文件清单 ---------- */
function resolveFiles() {
  const ymlPath = path.join(REL_DIR, 'latest.yml');
  if (!fs.existsSync(ymlPath)) die('缺少 release\\latest.yml，请先执行打包');
  const yml = fs.readFileSync(ymlPath, 'utf8');
  const m = yml.match(/^path:[ \t]*(.+)$/m);
  if (!m) die('latest.yml 里找不到 path 字段');
  return ['latest.yml', m[1].trim(), m[1].trim() + '.blockmap'];
}
function resolvePortable() {
  const cands = [`${require('./package.json').build.productName} ${VERSION}.exe`, `模拟题库 ${VERSION}.exe`];
  const hit = [...new Set(cands)].find(f => fs.existsSync(path.join(REL_DIR, f)));
  if (hit) return { local: hit, upload: `MoniTiKu-Portable-${VERSION}.exe` };
  const fallback = fs.readdirSync(REL_DIR).find(f => f.endsWith('.exe') && !/Setup|Uninstall|卸载/i.test(f));
  return fallback ? { local: fallback, upload: `MoniTiKu-Portable-${VERSION}.exe` } : null;
}
let files = [];
let portableFile = null;

/* ---------- 主流程 ---------- */
(async () => {
  console.log('══════════ 模拟题库 · 发布更新到 GitCode Release ══════════');
  if (!TOKEN) die('未获取到 GitCode Token。\n请双击 一键发布.cmd，或执行：set GITCODE_TOKEN=你的token && node 发布更新到GitCode.js');

  files = resolveFiles();
  portableFile = resolvePortable();
  console.log(`  账号   : ${OWNER}`);
  console.log(`  仓库   : ${REPO}`);
  console.log(`  版本   : ${VERSION}（tag ${TAG}）`);
  console.log(`  更新三件套: ${files.join('、')}`);
  console.log(`  便携版    : ${portableFile ? portableFile.local + '  →  ' + portableFile.upload : '未找到（跳过）'}`);
  if (!loadChangelog()) info(`⚠️  CHANGELOG.md 里没有 v${VERSION} 的条目，Release 说明将显示占位提示`);

  await ensureRepo();
  await getOrCreateRelease();

  const uploadNames = [...files, portableFile && portableFile.upload].filter(Boolean);
  await removeOldAssets(uploadNames);

  step(`上传文件（共 ${uploadNames.length} 个，约 ${(uploadNames.length * 95).toFixed(0)} MB，请耐心等待）`);
  const exist = ((await getRelease()) || {}).assets || [];
  for (const f of files) await uploadAsset(f, null, exist);
  if (portableFile) await uploadAsset(portableFile.local, portableFile.upload, exist);

  step('同步 Release 说明（变更内容 + 下载表格）');
  try {
    await gc(`/repos/${OWNER}/${REPO}/releases/${TAG}`, {
      method: 'PATCH', body: JSON.stringify({ tag_name: TAG, name: `模拟题库 v${VERSION}`, body: buildReleaseNotes() }),
    });
    ok('说明已更新');
  } catch (e) { info('说明更新失败（不影响下载）：' + e.message); }

  step('校验线上文件（匿名可下载才算成功）');
  const final = await getRelease();
  for (const a of ((final && final.assets) || [])) {
    info(`${a.name}${a.size ? '  ' + (a.size / 1048576).toFixed(1) + ' MB' : ''}`);
  }
  /* ⚠️ 只判断状态码不够：GitCode 的某些路径对任意文件名都返回 200，
     但内容是 HTML 页面。必须真的读一段字节来确认拿到的是文件本身。 */
  for (const f of [files[0], files[1]]) {
    const u = DOWNLOAD_BASE + f;
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'moni-tiku-check' } });
      const buf = Buffer.from(await r.arrayBuffer());
      const isHtml = /^\s*<(!doctype|html)/i.test(buf.slice(0, 200).toString('utf8'));
      if (!r.ok) console.log(`  ❌ HTTP ${r.status} ${f}`);
      else if (isHtml) console.log(`  ❌ ${f} 拿到的是 HTML 页面（路径不对，不是文件）`);
      else console.log(`  ✅ ${r.status} ${f}  ${(buf.length / 1048576).toFixed(1)} MB 内容正常`);
    } catch (e) { console.log(`  ❌ ${f} ${e.message}`); }
  }

  console.log('\n══════════════════ 发布完成 ══════════════════');
  console.log('  Release 页面: https://gitcode.com/' + OWNER + '/' + REPO + '/releases/tag/' + TAG);
  console.log('  更新源地址  : ' + DOWNLOAD_BASE);
  console.log('  验证：' + DOWNLOAD_BASE + 'latest.yml');
  console.log('══════════════════════════════════════════════\n');
})().catch(e => die(e.message || String(e)));
