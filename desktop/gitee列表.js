/** 列出 Gitee 仓库全部 Release 与附件 */
const OWNER = 'lingsheng24', REPO = 'moni-tiku';
const TOKEN = (process.env.GITEE_TOKEN || '').trim();

async function api(path, method = 'GET') {
  const r = await fetch(`https://gitee.com/api/v5${path}${path.includes('?') ? '&' : '?'}access_token=${TOKEN}`,
    { method, headers: { 'Content-Type': 'application/json' } });
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch (e) {}
  return { status: r.status, json: j, text: txt };
}

(async () => {
  if (!TOKEN) { console.error('❌ 缺少 GITEE_TOKEN'); process.exit(1); }
  const r = await api(`/repos/${OWNER}/${REPO}/releases?page=1&per_page=100&direction=desc`);
  if (r.status !== 200) { console.error('❌ 查询失败', r.status, r.text.slice(0, 200)); process.exit(1); }
  const list = r.json || [];
  console.log(`共 ${list.length} 个 Release：\n`);
  let total = 0;
  list.forEach(rel => {
    const sz = (rel.assets || []).reduce((s, a) => s + (a.size || 0), 0);
    total += sz;
    console.log(`· ${rel.tag_name}  id=${rel.id}  ${rel.name || ''}`);
    console.log(`  创建 ${rel.created_at}  附件 ${(rel.assets || []).length} 个  共 ${(sz / 1048576).toFixed(1)}MB`);
    (rel.assets || []).forEach(a => {
      const n = a.name || (a.browser_download_url || '').split('/').pop();
      console.log(`    - ${decodeURIComponent(n)}  ${((a.size || 0) / 1048576).toFixed(1)}MB`);
    });
    console.log('');
  });
  console.log(`合计占用：${(total / 1073741824 * 100).toFixed(1)}% (${(total / 1048576).toFixed(0)}MB / 1024MB)`);
})();
