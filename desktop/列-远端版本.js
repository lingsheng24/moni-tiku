/* 只读：列出 GitHub / GitCode 上现有的全部 Release 与 tag
 * 运行：NODE_TLS_REJECT_UNAUTHORIZED=0 node desktop/列-远端版本.js
 */
const GH = { owner: 'lingsheng24', repo: 'moni-tiku' };
const GC = { owner: 'JinFengjian', repo: 'moni-tiku' };
const ghTok = process.env.GH_TOKEN || '';
const gcTok = process.env.GITCODE_TOKEN || '';

async function j(url, headers) {
  const r = await fetch(url, { headers });
  const t = await r.text();
  let d = null;
  try { d = JSON.parse(t); } catch (e) { }
  return { status: r.status, data: d, raw: t.slice(0, 200) };
}

(async () => {
  console.log('══ GitHub Release ══');
  const g = await j(`https://api.github.com/repos/${GH.owner}/${GH.repo}/releases?per_page=100`,
    { Authorization: `Bearer ${ghTok}`, Accept: 'application/vnd.github+json', 'User-Agent': 'mtk' });
  if (!Array.isArray(g.data)) console.log('查询失败', g.status, g.raw);
  else g.data.forEach(r => console.log(`  ${r.tag_name.padEnd(12)} id=${r.id}  draft=${r.draft}  附件 ${r.assets.length} 个  ${(r.assets.map(a => a.name).join(', ')).slice(0, 90)}`));

  console.log('══ GitHub Tag ══');
  const gt = await j(`https://api.github.com/repos/${GH.owner}/${GH.repo}/tags?per_page=100`,
    { Authorization: `Bearer ${ghTok}`, Accept: 'application/vnd.github+json', 'User-Agent': 'mtk' });
  if (Array.isArray(gt.data)) console.log('  ' + gt.data.map(t => t.name).join(', ')); else console.log('  查询失败', gt.status);

  console.log('══ GitCode Release ══');
  const c = await j(`https://api.gitcode.com/api/v5/repos/${GC.owner}/${GC.repo}/releases?per_page=100`,
    { 'PRIVATE-TOKEN': gcTok, 'Content-Type': 'application/json' });
  const list = Array.isArray(c.data) ? c.data : (c.data && (c.data.data || c.data.releases)) || null;
  if (!list) console.log('查询失败', c.status, c.raw);
  else list.forEach(r => {
    const assets = r.assets || r.attachments || [];
    console.log(`  ${(r.tag_name || r.tag || '').padEnd(12)} id=${r.id}  status=${r.release_status || '-'}  附件 ${assets.length} 个  ${(assets.map(a => a.name || a.file_name).join(', ')).slice(0, 80)}`);
  });

  console.log('══ GitCode Tag ══');
  const ct = await j(`https://api.gitcode.com/api/v5/repos/${GC.owner}/${GC.repo}/tags?per_page=100`,
    { 'PRIVATE-TOKEN': gcTok, 'Content-Type': 'application/json' });
  const tl = Array.isArray(ct.data) ? ct.data : (ct.data && ct.data.data) || null;
  console.log(tl ? '  ' + tl.map(t => t.name).join(', ') : `  查询失败 ${ct.status} ${ct.raw}`);
})();
