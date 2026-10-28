import fs from 'fs';
import path from 'path';
import os from 'os';
import { atomicWriteJson, rotateBackup, readJsonWithRecovery, backupDir } from '../safeSave.js';

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safesave-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('atomicWriteJson', () => {
  it('原子写入：写入后无 .tmp 残留，内容可读回', () => {
    const f = path.join(dir, 'data.json');
    atomicWriteJson(f, { a: 1, 中文: '题库' });
    expect(fs.existsSync(f + '.tmp')).toBe(false);
    expect(JSON.parse(fs.readFileSync(f, 'utf8'))).toEqual({ a: 1, 中文: '题库' });
  });

  it('覆盖写入已有文件', () => {
    const f = path.join(dir, 'data.json');
    atomicWriteJson(f, { v: 1 });
    atomicWriteJson(f, { v: 2 });
    expect(JSON.parse(fs.readFileSync(f, 'utf8'))).toEqual({ v: 2 });
  });
});

describe('rotateBackup', () => {
  it('生成时间戳备份，且只保留最近 5 份', () => {
    const f = path.join(dir, 'data.json');
    fs.writeFileSync(f, '{}', 'utf8');
    for (let i = 0; i < 7; i++) {
      fs.writeFileSync(f, JSON.stringify({ i }), 'utf8');
      rotateBackup(f, 5);
    }
    const files = fs.readdirSync(backupDir(f)).filter(x => /^data-.*\.json$/.test(x));
    expect(files.length).toBe(5);
  });

  it('数据文件不存在时不产生备份', () => {
    const f = path.join(dir, 'nope.json');
    expect(rotateBackup(f, 5)).toBe(null);
    expect(fs.existsSync(backupDir(f))).toBe(false);
  });
});

describe('readJsonWithRecovery', () => {
  it('文件不存在（ENOENT）→ 返回 null', () => {
    expect(readJsonWithRecovery(path.join(dir, 'none.json'))).toBe(null);
  });

  it('正常文件 → 直接读出', () => {
    const f = path.join(dir, 'data.json');
    atomicWriteJson(f, { ok: true });
    expect(readJsonWithRecovery(f)).toEqual({ ok: true });
  });

  it('主文件损坏 → 从最新可用备份恢复并写回主文件', () => {
    const f = path.join(dir, 'data.json');
    // 造两份备份：新的也坏、旧的好 → 应跳过坏备份用到旧的
    const bd = backupDir(f);
    fs.mkdirSync(bd, { recursive: true });
    fs.writeFileSync(path.join(bd, 'data-2026-01-01T00-00-00-000.json'), JSON.stringify({ from: 'backup' }), 'utf8');
    fs.writeFileSync(path.join(bd, 'data-2026-01-02T00-00-00-000.json'), '{broken', 'utf8');
    fs.writeFileSync(f, '{corrupted-json', 'utf8');

    const data = readJsonWithRecovery(f);
    expect(data).toEqual({ from: 'backup' });
    // 恢复内容已写回主文件
    expect(JSON.parse(fs.readFileSync(f, 'utf8'))).toEqual({ from: 'backup' });
  });

  it('主文件损坏且备份全部不可用 → 返回 null', () => {
    const f = path.join(dir, 'data.json');
    const bd = backupDir(f);
    fs.mkdirSync(bd, { recursive: true });
    fs.writeFileSync(path.join(bd, 'data-2026-01-01T00-00-00-000.json'), '{bad', 'utf8');
    fs.writeFileSync(f, '{also-bad', 'utf8');
    expect(readJsonWithRecovery(f)).toBe(null);
  });
});
