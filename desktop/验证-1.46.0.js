/** 发布后独立验证：GitHub / GitCode / Gitee 三平台 */
const https = require('https');
const fs = require('fs');
const path = require('path');

function req(url, opts = {}, depth = 0) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const r = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: opts.method || 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 verify', ...(opts.headers || {}) }, timeout: 30000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && depth < 6) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return resolve(req(next, opts, depth + 1));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', e => resolve({ status: 0, error: e.message }));
    r.on('timeout', () => { r.destroy(); resolve({ status: 0, error: 'timeout' }); });
    r.end();
  });
}
const mb = n => (n / 1048576).toFixed(1) + 'MB';
const yml = fs.readFileSync(path.join(__dirname, 'release', 'latest.yml'), 'utf8');
const ymlSize = Number((yml.match(/size:\s*(\d+)/) || [])[1]);
const ymlVer = (yml.match(/version:\s*([\d.]+)/) || [])[1];

(async () => {
  console.log('本地 latest.yml 版本:', ymlVer, '| 安装包字节:', ymlSize, `(${mb(ymlSize)})`);

  // ── GitHub ──
  console.log('\n── GitHub ──');
  const gh = await req('https://api.github.com/repos/lingsheng24/moni-tiku/releases/latest',
    { headers: { Accept: 'application/vnd.github+json' } });
  if (gh.status === 200) {
    const j = JSON.parse(gh.body.toString());
    console.log('latest tag:', j.tag_name);
    j.assets.forEach(a => console.log('  ·', a.name, mb(a.size), '(downloads:' + a.download_count + ')'));
  } else console.log('❌ API', gh.status, gh.error || '');
  const ghYml = await req('https://github.com/lingsheng24/moni-tiku/releases/latest/download/latest.yml');
  console.log('latest.yml 直链:', ghYml.status, ghYml.status === 200 ? /version:\s*([\d.]+)/.exec(ghYml.body.toString())[1] : '');

  // ── GitCode ──
  console.log('\n── GitCode ──');
  const gcYml = await req('https://gitcode.com/JinFengjian/moni-tiku/releases/download/latest/latest.yml');
  const gcBody = gcYml.body.toString();
  const gcVer = gcYml.status === 200 ? (/version:\s*([\d.]+)/.exec(gcBody) || [])[1] : '';
  const gcLimited = gcYml.status === 429 || /TOO_MANY_REQUESTS/.test(gcBody);
  console.log('latest.yml:', gcYml.status, gcVer || (gcLimited ? '限流(稍后重试)' : '-'),
    gcVer === ymlVer ? '✅' : gcLimited ? '⚠️ 请求过密被限流，非版本问题' : '❌');
  const gcExe = await req('https://gitcode.com/JinFengjian/moni-tiku/releases/download/latest/MoniTiKu-Setup-1.46.0.exe',
    { headers: { Range: 'bytes=0-1023' } });
  const cr = gcExe.headers && gcExe.headers['content-range'];
  console.log('安装包 Range GET:', gcExe.status, cr || '', gcExe.status === 206 ? '✅' : '⚠️');

  // ── Gitee ──
  console.log('\n── Gitee ──');
  for (const [name, expect] of [
    ['MoniTiKu-Setup-1.46.0.exe', ymlSize],
    ['MoniTiKu-Portable-1.46.0.exe', 0],
  ]) {
    const u = `https://gitee.com/lingsheng24/moni-tiku/releases/download/v1.46.0/${name}`;
    const r = await req(u, { headers: { Range: 'bytes=0-1023' } });
    const len = r.headers && r.headers['content-range']
      ? Number((r.headers['content-range'].match(/\/(\d+)/) || [])[1])
      : Number(r.headers && r.headers['content-length'] || 0);
    const ok = (r.status === 200 || r.status === 206) && (!expect || len === expect);
    console.log(`  ${ok ? '✅' : '❌'} ${name}  HTTP ${r.status}  ${mb(len)}`);
  }
})();
