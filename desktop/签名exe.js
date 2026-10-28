/**
 * 给打包好的 exe 做 Authenticode 数字签名
 * -----------------------------------------
 * 设计要点：所有交给 PowerShell 的路径都先转成临时 ASCII 路径，
 * 避免中文目录在 -Command / -File 传输过程中被编码弄坏。
 *
 * 用法：node 签名exe.js            （自动签名 release 目录里全部本应用的 exe）
 *      node 签名exe.js "具体路径.exe"
 *
 * 前提：cert\codesign.pfx 与 cert\rootCA.crt 已存在（见 生成签名证书.js）
 * 签名包含 RSA2048 私钥、-sha256 摘要、DigiCert 官方时间戳，
 * 时间戳的作用是：即使证书日后过期，签名依然被视为有效。
 *
 * ⚠️ 关键：签名会改变文件内容，因此签名后必须
 *    ① 把签名后的文件写回 release 目录（覆盖未签名的原件）
 *    ② 重算 latest.yml 里的 sha512 / size（否则 electron-updater 校验失败）
 *    ③ 重新生成 .blockmap（否则差量更新校验失败）
 *    这样发布脚本从 release 目录上传的才是带签名的成品。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const CERT_DIR = path.join(__dirname, '..', 'cert');
const PFX = path.join(CERT_DIR, 'codesign.pfx');
const CA = path.join(CERT_DIR, 'rootCA.crt');
const PFX_PASS = process.env.SIGN_PWD || 'Aa123456';
const REL_DIR = path.join(__dirname, 'release');
const OUT_DIR = path.join(__dirname, '..', '发布');
const VERSION = require('./package.json').version;
const APP_BUILDER = path.join(__dirname, 'node_modules', 'app-builder-bin', 'win', 'x64', 'app-builder.exe');
const SIGNED_MARK = path.join(REL_DIR, '.signed.json');

/* ---------- 已签名标记：避免重复签名导致签名叠加、文件变大 ---------- */
function loadMark() {
  try { return JSON.parse(fs.readFileSync(SIGNED_MARK, 'utf8')); } catch (e) { return {}; }
}
function sha512(file) {
  return crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64');
}
function isAlreadySigned(file) {
  const mark = loadMark();
  const rec = mark[path.basename(file)];
  return !!rec && rec.size === fs.statSync(file).size && rec.sha512 === sha512(file);
}
function markSigned(file) {
  const mark = loadMark();
  mark[path.basename(file)] = { size: fs.statSync(file).size, sha512: sha512(file), at: new Date().toISOString() };
  fs.writeFileSync(SIGNED_MARK, JSON.stringify(mark, null, 2));
}

/**
 * 签名改变了文件，需要同步刷新更新清单与 blockmap
 * —— 否则线上的 sha512/size 与签名后的文件对不上，用户更新会校验失败
 */
function refreshUpdateManifest(setupPath) {
  const ymlPath = path.join(REL_DIR, 'latest.yml');
  if (!fs.existsSync(ymlPath)) { console.log('  ·  未找到 latest.yml，跳过清单同步'); return; }

  const size = fs.statSync(setupPath).size;
  const hash = sha512(setupPath);
  let yml = fs.readFileSync(ymlPath, 'utf8');
  yml = yml.replace(/sha512:\s*\S+/g, 'sha512: ' + hash);
  yml = yml.replace(/size:\s*\d+/g, 'size: ' + size);
  fs.writeFileSync(ymlPath, yml);

  // 重新生成 blockmap（差量更新索引，必须与实际文件一致）
  const bm = setupPath + '.blockmap';
  try {
    execFileSync(APP_BUILDER, ['blockmap', '--input', setupPath, '--output', bm], { stdio: 'pipe' });
    console.log(`  ·  已刷新 latest.yml（size ${size} / sha512 ${hash.slice(0, 16)}…）与 blockmap（${(fs.statSync(bm).size / 1024).toFixed(0)} KB）`);
  } catch (e) {
    // blockmap 缺失只影响差量更新，不影响整包更新，降级即可
    if (fs.existsSync(bm)) fs.rmSync(bm);
    console.log('  ·  blockmap 重新生成失败，已移除（将退化为整包更新，不影响功能）：' + e.message);
  }
}

function listTargets() {
  if (process.argv[2]) return [process.argv[2]];
  if (!fs.existsSync(REL_DIR)) throw new Error('release 目录不存在，请先执行打包');
  // 匹配便携版（中文名）与安装版（MoniTiKu-Setup-x.y.z.exe，英文名以便 GitHub Release 分发）
  const isTarget = (f) => f.includes('模拟题库') || /^MoniTiKu-Setup-/.test(f);
  const list = fs.readdirSync(REL_DIR)
    .filter(f => f.endsWith('.exe') && isTarget(f) && !f.includes('uninstalled'))
    .map(f => ({ f, t: fs.statSync(path.join(REL_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (!list.length) throw new Error('release 目录里没有找到 exe，请先打包');
  return list.map(x => path.join(REL_DIR, x.f));
}

function signOne(src) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tikusign-'));
  const tmpExe = path.join(tmpDir, 'target.exe');
  const tmpPfx = path.join(tmpDir, 'codesign.pfx');
  const tmpCa = path.join(tmpDir, 'rootCA.crt');
  fs.copyFileSync(src, tmpExe);
  fs.copyFileSync(PFX, tmpPfx);
  fs.copyFileSync(CA, tmpCa);

  const ps = `
$ErrorActionPreference='Stop'
$cn    = [System.Security.Cryptography.X509Certificates.X509Certificate2]
$flags = [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]
$pwd   = $env:SIGN_PWD
$cert  = $cn::new($env:PFX, $pwd, $flags::PersistKeySet -bor $flags::Exportable)

$my = [System.Security.Cryptography.X509Certificates.X509Store]::new('My','CurrentUser')
$my.Open('ReadWrite'); $my.Add($cert); $my.Close()
$rt = $cn::new($env:CA)
$ro = [System.Security.Cryptography.X509Certificates.X509Store]::new('Root','CurrentUser')
$ro.Open('ReadWrite'); $ro.Add($rt); $ro.Close()

$tsa = @('http://timestamp.digicert.com','http://timestamp.sectigo.com','http://ts.ssl.com')
$res = $null
foreach ($t in $tsa) {
  try {
    $res = Set-AuthenticodeSignature -FilePath $env:TARGET -Certificate $cert -TimestampServer $t -HashAlgorithm SHA256
    if ($res.Status -eq 'Valid') { Write-Output ('TIMESTAMP_SERVER=' + $t); break }
  } catch { Write-Output ('  timestamp failed: ' + $t) }
}
if (-not $res) { $res = Set-AuthenticodeSignature -FilePath $env:TARGET -Certificate $cert -HashAlgorithm SHA256 }
Write-Output ('STATUS=' + $res.Status)
$v = Get-AuthenticodeSignature -FilePath $env:TARGET
Write-Output ('VERIFY=' + $v.Status)
`;
  const psPath = path.join(tmpDir, 'sign.ps1');
  fs.writeFileSync(psPath, '\uFEFF' + ps, 'utf8');

  console.log('签名: ' + path.basename(src));
  const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psPath], {
    encoding: 'utf8',
    env: { ...process.env, TARGET: tmpExe, PFX: tmpPfx, CA: tmpCa, SIGN_PWD: PFX_PASS },
  });
  console.log(out.trim().split(/\r?\n/).map(l => '  ' + l).join('\n'));
  if (!/VERIFY=Valid/.test(out)) { fs.rmSync(tmpDir, { recursive: true, force: true }); throw new Error('签名验证未通过: ' + path.basename(src)); }

  const base = path.basename(src);
  const isSetup = base.includes('安装版') || /^MoniTiKu-Setup-/.test(base);

  // ① 写回 release 目录：让发布脚本上传到 GitHub 的是带签名的成品
  //    （原件已被打包进内部，覆盖不影响任何产物）
  fs.copyFileSync(tmpExe, src);
  markSigned(src);

  // ② 输出到发布目录：安装版保持原名，便携版统一命名
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const dst = path.join(OUT_DIR, isSetup ? base : `模拟题库-${VERSION}-portable.exe`);
  fs.copyFileSync(tmpExe, dst);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('✅ 输出: ' + dst + '  (' + (fs.statSync(dst).size / 1048576).toFixed(1) + ' MB)');

  // ③ 安装版才需要同步更新清单（便携版不参与在线更新）
  if (isSetup) {
    refreshUpdateManifest(src);
    // 刷新后的 latest.yml 与 blockmap 也要同步到发布目录，避免本地与线上两份不一致
    for (const f of ['latest.yml', path.basename(src) + '.blockmap']) {
      const s = path.join(REL_DIR, f);
      if (fs.existsSync(s)) fs.copyFileSync(s, path.join(OUT_DIR, f));
    }
  }
  return dst;
}

function main() {
  if (!fs.existsSync(PFX) || !fs.existsSync(CA)) {
    throw new Error('缺少证书文件，请先运行 生成签名证书.js');
  }
  const targets = listTargets();
  let done = 0;
  for (const src of targets) {
    if (isAlreadySigned(src)) { console.log('·  ' + path.basename(src) + ' 已签名，跳过'); continue; }
    signOne(src); done++;
  }
  console.log(`\n全部完成：本次新签名 ${done} 个，跳过 ${targets.length - done} 个。`);
  console.log('提示：release 目录已同步为签名后文件，可直接执行 发布更新到GitHub.js');
}

try { main(); } catch (e) { console.error('❌ ' + e.message); process.exit(1); }
