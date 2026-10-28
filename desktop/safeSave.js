/**
 * 数据文件安全写入：原子替换 + 滚动备份 + 损坏自恢复
 * 背景：旧实现每次变更都直接 writeFileSync 全量覆盖 data.json，
 * 断电 / 崩溃时文件只写了一半，整个题库就损坏了。
 */
const fs = require('fs');
const path = require('path');

/** 原子写 JSON：先写同目录 .tmp 再 rename（同卷 rename 是原子操作） */
function atomicWriteJson(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/** 备份目录：与数据文件同级的 backups/ */
function backupDir(file) {
  return path.join(path.dirname(file), 'backups');
}

/** 把当前数据文件复制进 backups/（时间戳命名，精确到毫秒防重名），只保留最近 keep 份 */
function rotateBackup(file, keep = 5) {
  if (!fs.existsSync(file)) return null;
  const dir = backupDir(file);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T.]/g, '-').slice(0, 23);
  const dest = path.join(dir, `data-${stamp}.json`);
  fs.copyFileSync(file, dest);
  // 清理旧备份：文件名即时间戳，倒序后保留前 keep 份
  const all = fs.readdirSync(dir).filter(f => /^data-.*\.json$/.test(f)).sort().reverse();
  for (const f of all.slice(keep)) fs.rmSync(path.join(dir, f), { force: true });
  return dest;
}

/** 读取 JSON；主文件损坏时按备份从新到旧自动恢复，并把恢复内容写回主文件 */
function readJsonWithRecovery(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;   // 首次运行，无文件
    console.error('[数据] 主数据文件读取失败：', e.message);
  }
  // 主文件损坏 → 依次尝试备份
  let backups = [];
  try {
    backups = fs.readdirSync(backupDir(file)).filter(f => /^data-.*\.json$/.test(f)).sort().reverse();
  } catch (_) { }
  for (const b of backups) {
    const p = path.join(backupDir(file), b);
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      fs.copyFileSync(p, file);   // 用备份覆盖回主文件
      console.warn(`[数据] 已从备份 ${b} 恢复`);
      return data;
    } catch (_) { /* 这份备份也坏了，试下一份 */ }
  }
  return null;
}

module.exports = { atomicWriteJson, rotateBackup, readJsonWithRecovery, backupDir };
