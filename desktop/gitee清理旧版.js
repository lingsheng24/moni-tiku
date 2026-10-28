/** 删除 Gitee 上指定版本的 Release（保留 KEEP 指定的最新版） */
const OWNER = 'lingsheng24', REPO = 'moni-tiku';
const TOKEN = (process.env.GITEE_TOKEN || '').trim();
const KEEP = process.env.KEEP_TAG || '';

async function api(path, method = 'GET') {
  const r = await fetch(`https://gitee.com/api/v5${path}${path.includes('?') ? '&' : '?'}access_token=${TOKEN}`,
    { method });
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch (e) {}
  return { status: r.status, json: j, text: txt };
}

(async () => {
  if (!TOKEN) { console.error('❌ 缺少 GITEE_TOKEN'); process.exit(1); }
  const list = (await api(`/repos/${OWNER}/${REPO}/releases?page=1&per_page=100`)).json || [];
  const targets = list.filter(rel => rel.tag_name !== KEEP);
  console.log(`保留：${KEEP}`);
  console.log(`待删：${targets.map(t => t.tag_name).join(', ') || '（无）'}\n`);
  for (const rel of targets) {
    const r = await api(`/repos/${OWNER}/${REPO}/releases/${rel.id}`, 'DELETE');
    console.log(`${r.status === 204 || r.status === 200 ? '✅' : '❌'} 删除 ${rel.tag_name}（id=${rel.id}）HTTP ${r.status}${r.status >= 400 ? ' ' + r.text.slice(0, 120) : ''}`);
  }
  const after = (await api(`/repos/${OWNER}/${REPO}/releases?page=1&per_page=100`)).json || [];
  console.log(`\n剩余 Release：${after.map(a => a.tag_name).join(', ')}`);
})();
