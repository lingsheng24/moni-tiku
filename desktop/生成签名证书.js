/**
 * 生成代码签名所需的证书（自签名根 CA + 叶证书）
 * ------------------------------------------------
 * 产出 cert/ 目录下：
 *   rootCA.crt / rootCA.key   自签名根证书（需要被加入「受信任的根证书颁发机构」）
 *   codesign.crt / .key       代码签名叶证书
 *   codesign.pfx              含私钥的打包文件（签名脚本使用，密码见 SIGN_PWD）
 *
 * 依赖：openssl（Git Bash / OpenSSL for Windows 均可）
 *
 * ⚠️ 说明：自签名证书只能让你自己（任何导入了 rootCA.crt 的机器）看到
 * 「发布者已验证」，不会让 Windows SmartScreen 公网信誉放行。
 * 若要对外发布给不特定用户，请购买 OV / EV 代码签名证书（见 README）。
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DIR = path.join(__dirname, '..', 'cert');
const CERT_PASSWORD = process.env.SIGN_PWD || 'Aa123456';
const SUBJ_CA = '/C=CN/O=JunGe Dev/CN=JunGe Development Root CA';
const SUBJ_CODE = '/C=CN/O=JunGe Dev/CN=JunGe Development';

function openssl() {
  try { execSync('openssl version', { stdio: 'ignore' }); return 'openssl'; }
  catch (e) { return null; }
}

function main() {
  const exe = openssl();
  if (!exe) throw new Error('未检测到 openssl，请安装后重试（Git Bash 自带）');
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

  const ext = path.join(DIR, 'codesign.ext');
  fs.writeFileSync(ext, [
    'extendedKeyUsage=critical,codeSigning,timeStamping',
    'keyUsage=critical,digitalSignature',
    'basicConstraints=critical,CA:FALSE',
  ].join('\n'), 'utf8');

  const run = cmd => execSync(cmd, { cwd: DIR, stdio: ['ignore', 'ignore', 'pipe'] });

  console.log('· 生成根证书 rootCA（有效期 10 年）…');
  run(`openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -nodes -keyout rootCA.key -out rootCA.crt -subj "${SUBJ_CA}" -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"`);

  console.log('· 生成代码签名证书（有效期 5 年）…');
  run(`openssl req -newkey rsa:2048 -sha256 -nodes -keyout codesign.key -out codesign.csr -subj "${SUBJ_CODE}"`);
  run('openssl x509 -req -in codesign.csr -CA rootCA.crt -CAkey rootCA.key -CAcreateserial -out codesign.crt -days 1825 -sha256 -extfile codesign.ext');

  console.log('· 打包 PFX…');
  run(`openssl pkcs12 -export -macalg sha256 -out codesign.pfx -inkey codesign.key -in codesign.crt -certfile rootCA.crt -passout pass:${CERT_PASSWORD}`);

  console.log('\n✅ 证书已生成于 ' + DIR);
  console.log('   PFX 密码：' + CERT_PASSWORD + '（可用环境变量 SIGN_PWD 覆盖）');
  console.log('   下一步：Generate → node 签名exe.js');
}

try { main(); } catch (e) { console.error('❌ ' + e.message); process.exit(1); }
