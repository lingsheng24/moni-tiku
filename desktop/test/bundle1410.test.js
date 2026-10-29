/* v1.41.0：全量备份容器（backupBundle.js）、搜索引擎健康度（engineHealth.js）、
 * 渐进拆分构建一致性（build.js）。 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { FORMAT, stripSecrets, buildBundle, parseBundle } from '../backupBundle.js';
import { createEngineHealth } from '../engineHealth.js';
import { build, REGIONS } from '../../build.js';

describe('全量备份容器：stripSecrets / buildBundle', () => {
  it('stripSecrets 剔除 apiKey / apiKeyEnc，其余字段原样保留', () => {
    const meta = { curBank: 'a', banks: { a: { name: 'X' } }, kv: { settings: { theme: 'green', apiKey: 'sk-abc', apiKeyEnc: 'a1xyz' } }, kv2: 1 };
    const out = stripSecrets(meta);
    expect(out.kv.settings.apiKey).toBeUndefined();
    expect(out.kv.settings.apiKeyEnc).toBeUndefined();
    expect(out.kv.settings.theme).toBe('green');
    expect(out.banks.a.name).toBe('X');
    expect(out.kv2).toBe(1);
    expect(meta.kv.settings.apiKey).toBe('sk-abc');   // 不动原对象
  });
  it('stripSecrets 容忍缺 kv / settings 的畸形元数据', () => {
    expect(stripSecrets({}).kv).toBeUndefined();
    expect(stripSecrets({ kv: {} }).kv.settings).toBeUndefined();
    expect(stripSecrets(null)).toEqual({});
  });
  it('buildBundle 产出标准容器：data.json + banks/<id>.json，id 非法直接抛错', () => {
    const meta = { banks: { default: { name: '我的题库' } }, kv: { settings: { apiKey: 'sk-x' } } };
    const b = buildBundle({ meta, banks: { default: { name: '我的题库', docs: [] } }, appVer: '1.41.0' });
    expect(b.format).toBe(FORMAT);
    expect(b.version).toBe(1);
    expect(b.app_ver).toBe('1.41.0');
    expect(b.files['data.json'].kv.settings.apiKey).toBeUndefined();
    expect(b.files['banks/default.json'].docs).toEqual([]);
    expect(() => buildBundle({ meta, banks: { '../evil': {} } })).toThrow(/非法/);
  });
});

describe('全量备份容器：parseBundle 校验', () => {
  const good = () => buildBundle({
    meta: { curBank: 'a', banks: { a: { name: 'A' } }, kv: {} },
    banks: { a: { name: 'A', questions: [1, 2] } },
    appVer: '1.41.0',
  });
  it('合法容器解析通过，banks 键归一为题库 id', () => {
    const r = parseBundle(good());
    expect(r.ok).toBe(true);
    expect(r.banks.a.questions).toEqual([1, 2]);
    expect(r.meta.banks.a.name).toBe('A');
  });
  it('非容器 / 版本不符 / 缺 files / 缺 data.json 一律拒绝', () => {
    expect(parseBundle(null).ok).toBe(false);
    expect(parseBundle({ foo: 1 }).ok).toBe(false);
    expect(parseBundle({ ...good(), version: 99 }).error).toMatch(/版本/);
    const noFiles = good(); delete noFiles.files;
    expect(parseBundle(noFiles).ok).toBe(false);
    const noMeta = good(); delete noMeta.files['data.json'];
    expect(parseBundle(noMeta).error).toMatch(/元数据/);
  });
  it('不认识的文件名 / 题库数据损坏 / 清单与文件不匹配，整体拒绝（不恢复一半）', () => {
    const stranger = good(); stranger.files['readme.txt'] = {};
    expect(parseBundle(stranger).error).toMatch(/不认识的文件/);
    const broken = good(); broken.files['banks/a.json'] = null;
    expect(parseBundle(broken).error).toMatch(/损坏/);
    const orphan = good(); delete orphan.files['data.json'].banks.a;
    expect(parseBundle(orphan).error).toMatch(/不在备份清单/);
  });
  it('round-trip：build → JSON 字符串 → parse 与原数据一致（含中文）', () => {
    const meta = { curBank: 'b1', banks: { b1: { name: '电工题库' } }, kv: { settings: { theme: 'dark' } } };
    const b1 = { name: '电工题库', questions: [{ id: 'q1', stem: '基尔霍夫电流定律的内容是？' }] };
    const r = parseBundle(JSON.parse(JSON.stringify(buildBundle({ meta, banks: { b1 } }))));
    expect(r.ok).toBe(true);
    expect(r.banks.b1.questions[0].stem).toContain('基尔霍夫');
    expect(r.meta.kv.settings.theme).toBe('dark');
  });
});

describe('搜索引擎健康度：createEngineHealth', () => {
  const nameOf = id => ({ sogou: '搜狗', so360: '360 搜索', bingcn: 'Bing 国内' })[id] || id;
  it('连续失败达到上限才标记失效，成功一次立即清零', () => {
    const h = createEngineHealth({ limit: 5 });
    for (let i = 0; i < 4; i++) h.mark('sogou', false);
    expect(h.degraded('sogou')).toBe(false);          // 4 次 < 5，还给它机会
    h.mark('sogou', false);
    expect(h.degraded('sogou')).toBe(true);
    h.mark('sogou', true);
    expect(h.degraded('sogou')).toBe(false);
  });
  it('orderFirst 稳定排序：健康引擎在前、失效引擎在后，组内相对顺序不变', () => {
    const h = createEngineHealth({ limit: 5 });
    ['so360', 'sogou'].forEach(id => { for (let i = 0; i < 5; i++) h.mark(id, false); });
    const out = h.orderFirst(['sogou', 'bingcn', 'so360']);
    expect(out).toEqual(['bingcn', 'sogou', 'so360']);
  });
  it('degradedNames 输出显示名（供前端提示）', () => {
    const h = createEngineHealth({ limit: 5 });
    for (let i = 0; i < 5; i++) h.mark('so360', false);
    expect(h.degradedNames(['bingcn', 'so360', 'sogou'], nameOf)).toEqual(['360 搜索']);
  });
  it('reset 清空全部标记（重启即重试）', () => {
    const h = createEngineHealth({ limit: 5 });
    for (let i = 0; i < 9; i++) h.mark('sogou', false);
    h.reset();
    expect(h.degraded('sogou')).toBe(false);
  });
});

describe('渐进拆分：build.js 一致性', () => {
  it('REGIONS 已登记 db 与 websearch 两个域', () => {
    expect(REGIONS.map(r => r.name).sort()).toEqual(['db', 'websearch']);
  });
  it('构建产物与仓库中的 HTML 一致（防止改了 src/ 忘了 node build.js）', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', '..', '模拟题库-Web版.html'), 'utf8');
    expect(build(html)).toBe(html);
  });
  it('每个登记的 src 文件都真实存在', () => {
    for (const r of REGIONS) for (const f of r.files) {
      expect(fs.existsSync(path.join(__dirname, '..', '..', f))).toBe(true);
    }
  });
});
