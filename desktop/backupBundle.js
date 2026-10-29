/* v1.41.0 全量备份容器（纯函数，不依赖 Electron，便于 vitest 直接测试）
 *
 * 单一 JSON 文件装下整个数据目录（data.json + banks/*.json），格式：
 * {
 *   format: 'moni-tiku-full-backup',
 *   version: 1,
 *   exported_at: ISO 时间,
 *   app_ver: '1.41.0',
 *   files: { 'data.json': <元数据对象>, 'banks/<id>.json': <题库数据对象>, ... }
 * }
 *
 * 与「导出当前题库」的区别：全量备份包含**所有题库**与全局设置，用于换机迁移 / 整目录恢复。
 * 安全约定：导出时剔除 settings.apiKey / apiKeyEnc（备份文件外泄不带走密钥）；
 * 恢复时由调用方把本机现有密钥回填进新 data.json（换机后密钥本来就要重填）。
 */

const FORMAT = 'moni-tiku-full-backup';
const VERSION = 1;
const BANK_FILE_RE = /^banks\/([a-z0-9]+)\.json$/i;

/** 剔除元数据里的密钥字段（浅克隆 kv.settings，不动原对象） */
function stripSecrets(meta) {
  const out = JSON.parse(JSON.stringify(meta || {}));
  if (out.kv && out.kv.settings && typeof out.kv.settings === 'object') {
    delete out.kv.settings.apiKey;
    delete out.kv.settings.apiKeyEnc;
  }
  return out;
}

/** 组装备份容器。banks: { '<id>': <题库对象> } */
function buildBundle({ meta, banks = {}, appVer = '' } = {}) {
  const files = { 'data.json': stripSecrets(meta) };
  for (const id of Object.keys(banks)) {
    if (!/^[a-z0-9]+$/i.test(id)) throw new Error('题库 id 非法：' + id);
    files['banks/' + id + '.json'] = banks[id];
  }
  return { format: FORMAT, version: VERSION, exported_at: new Date().toISOString(), app_ver: String(appVer || ''), files };
}

/** 校验并解析备份容器。返回 { ok:true, meta, banks } 或 { ok:false, error }。
 *  banks 键已归一为题库 id；非法条目（坏 id / 非对象）整体拒绝，避免恢复一半。 */
function parseBundle(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, error: '备份文件不是有效的 JSON 对象' };
  if (obj.format !== FORMAT) return { ok: false, error: '不是全量备份文件（缺少备份格式标识）' };
  if (obj.version !== VERSION) return { ok: false, error: '备份格式版本不受支持：' + obj.version };
  const files = obj.files;
  if (!files || typeof files !== 'object') return { ok: false, error: '备份内容缺失（files）' };
  const meta = files['data.json'];
  if (!meta || typeof meta !== 'object' || !meta.banks || typeof meta.banks !== 'object') {
    return { ok: false, error: '备份缺少元数据（data.json）或题库清单为空' };
  }
  const banks = {};
  for (const key of Object.keys(files)) {
    if (key === 'data.json') continue;
    const m = BANK_FILE_RE.exec(key);
    if (!m) return { ok: false, error: '备份里出现了不认识的文件：' + key };
    const body = files[key];
    if (!body || typeof body !== 'object') return { ok: false, error: '题库数据损坏：' + key };
    banks[m[1].toLowerCase()] = body;
  }
  /* 容器里的题库文件必须能对上 meta.banks 清单（多出的清单项视为空题库，允许） */
  for (const id of Object.keys(banks)) {
    if (!meta.banks[id]) return { ok: false, error: '题库文件 ' + id + ' 不在备份清单中，备份可能不完整' };
  }
  return { ok: true, meta, banks };
}

module.exports = { FORMAT, VERSION, stripSecrets, buildBundle, parseBundle };
