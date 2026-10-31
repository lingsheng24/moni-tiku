/* 只保留最新版 v1.49.1：GitHub 删其余 Release + tag；GitCode 删其余 tag（Release 随 tag 消失）
 * 运行：NODE_TLS_REJECT_UNAUTHORIZED=0 node desktop/清理历史版本.js
 * 加 --dry 只列出不删除
 */
const KEEP = 'v1.49.1';
const DRY = process.argv.includes('--dry');
const GH = { owner: 'lingsheng24', repo: 'moni-tiku' };
const GC = { owner: 'JinFengjian', repo: 'moni-tiku' };
const ghH = { Authorization: `Bearer ${process.env.GH_TOKEN || ''}`, Accept: 'application/vnd.github+json', 'User-Agent': 'mtk' };
const gcH = { 'PRIVATE-TOKEN': process.env.GITCODE_TOKEN || '', 'Content-Type': 'application/json' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function call(url, headers, method = 'GET') {
  const r = await fetch(url, { method, headers });
  const t = await r.text();
  let d = null; try { d = JSON.parse(t); } catch (e) { }
  return { s: r.status, d, t: t.slice(0, 140).replace(/\s+/g, ' ') };
}

(async () => {
  let ghRel = 0, ghTag = 0, gcTag = 0, fail = [];

  /* ── GitHub：Release ── */
  const rel = await call(`https://api.github.com/repos/${GH.owner}/${GH.repo}/releases?per_page=100`, ghH);
  const rels = (rel.d || []).filter(r => r.tag_name !== KEEP);
  console.log(`══ GitHub Release：现有 ${(rel.d || []).length} 个，待删 ${rels.length} 个`);
  for (const r of rels) {
    if (DRY) { console.log(`  · [dry] 删 Release ${r.tag_name} (id=${r.id}, 附件 ${r.assets.length})`); continue; }
    const x = await call(`https://api.github.com/repos/${GH.owner}/${GH.repo}/releases/${r.id}`, ghH, 'DELETE');
    if (x.s === 204) { ghRel++; process.stdout.write(`\r  已删 Release ${ghRel}/${rels.length}  ${r.tag_name}        `); }
    else fail.push(`GitHub Release ${r.tag_name}: ${x.s} ${x.t}`);
    await sleep(120);
  }
  console.log('');

  /* ── GitHub：tag ── */
  const tg = await call(`https://api.github.com/repos/${GH.owner}/${GH.repo}/tags?per_page=100`, ghH);
  const tags = (tg.d || []).filter(t => t.name !== KEEP);
  console.log(`══ GitHub Tag：现有 ${(tg.d || []).length} 个，待删 ${tags.length} 个`);
  for (const t of tags) {
    if (DRY) { console.log(`  · [dry] 删 tag ${t.name}`); continue; }
    const x = await call(`https://api.github.com/repos/${GH.owner}/${GH.repo}/git/refs/tags/${t.name}`, ghH, 'DELETE');
    if (x.s === 204) { ghTag++; process.stdout.write(`\r  已删 tag ${ghTag}/${tags.length}  ${t.name}        `); }
    else fail.push(`GitHub tag ${t.name}: ${x.s} ${x.t}`);
    await sleep(120);
  }
  console.log('');

  /* ── GitCode：tag（Release 随 tag 一起消失）── */
  const ct = await call(`https://api.gitcode.com/api/v5/repos/${GC.owner}/${GC.repo}/tags?per_page=100`, gcH);
  const ctg = (Array.isArray(ct.d) ? ct.d : (ct.d && ct.d.data) || []).filter(t => t.name !== KEEP);
  console.log(`══ GitCode Tag：现有 ${(ct.d && (ct.d.length || (ct.d.data || []).length)) || 0} 个，待删 ${ctg.length} 个`);
  for (const t of ctg) {
    if (DRY) { console.log(`  · [dry] 删 tag ${t.name}`); continue; }
    const x = await call(`https://api.gitcode.com/api/v5/repos/${GC.owner}/${GC.repo}/tags/${t.name}`, gcH, 'DELETE');
    if (x.s >= 200 && x.s < 300) { gcTag++; process.stdout.write(`\r  已删 tag ${gcTag}/${ctg.length}  ${t.name}        `); }
    else fail.push(`GitCode tag ${t.name}: ${x.s} ${x.t}`);
    await sleep(350);
  }
  console.log('');

  console.log('\n══ 汇总 ══');
  console.log(`  GitHub Release 删除 ${ghRel} 个 / tag 删除 ${ghTag} 个 / GitCode tag 删除 ${gcTag} 个`);
  if (fail.length) { console.log(`  ⚠ 失败 ${fail.length} 项：`); fail.slice(0, 10).forEach(f => console.log('    ' + f)); }
  else console.log('  全部成功 ✅');
})();
