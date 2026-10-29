/* 只读分析：军哥真实题库的题目笔记与知识点分布 */
const fs = require('fs');
const P = 'D:/模拟题库/banks/default.json';
const d = JSON.parse(fs.readFileSync(P, 'utf8'));
const qs = d.questions || [];
const splitKP = s => String(s || '').split(/[、,，;；\/|]+/).map(x => x.trim()).filter(x => x && x !== '未分类');

const noted = qs.filter(q => typeof q.note === 'string' && q.note.trim());
const kpAll = new Set();
qs.forEach(q => splitKP(q.knowledge_point).forEach(k => kpAll.add(k)));

console.log('题目总数:', qs.length);
console.log('有笔记的题:', noted.length);
console.log('知识点去重数:', kpAll.size);
console.log('知识点为空的题:', qs.filter(q => !splitKP(q.knowledge_point).length).length);
console.log('字段名清单:', Object.keys(qs[0] || {}).join(','));
console.log('\n--- 有笔记的题（前 10）---');
noted.slice(0, 10).forEach(q => {
  console.log(`#${q.id} kp="${q.knowledge_point || ''}" note="${String(q.note).slice(0, 40)}" content="${String(q.content || '').slice(0, 30)}"`);
});
console.log('\n--- 笔记题的知识点分布 ---');
const dist = {};
noted.forEach(q => {
  const ks = splitKP(q.knowledge_point);
  if (!ks.length) dist['(空/未分类)'] = (dist['(空/未分类)'] || 0) + 1;
  ks.forEach(k => dist[k] = (dist[k] || 0) + 1);
});
Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([k, n]) => console.log(`  ${k}: ${n}`));
console.log('\n知识点样例（前 15）:', [...kpAll].slice(0, 15).join(' | '));
console.log('复习卡:', (d.review || []).length, ' 错题:', (d.mistakes || []).length, ' 练习记录:', (d.practice || []).length);
console.log('kpNotes 键:', Object.keys(d.kv && d.kv.kpNotes ? d.kv.kpNotes : {}).slice(0, 10).join(' | ') || '(无)');
