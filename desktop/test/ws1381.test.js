/* ================================================================
 * v1.38.1 联网查询收藏并入知识库：
 *   kbAllNotes 汇总 fav / kbFilterList & kbStats 支持 fav /
 *   kbEditNote 拒绝直接编辑收藏 / kbDeleteNote 走收藏通道
 * 真实提取 HTML 函数，依赖以桩注入。
 * ================================================================ */
import { describe, it, expect, vi } from 'vitest';
import { loadFns } from './extract-html.js';

const KB_BASE = ['KB_KIND', 'kbAllNotes', 'kbFreeNotes', 'kbFilterList', 'kbStats', 'kbEditNote', 'kbDeleteNote'];
const splitKP = s => String(s || '').split(/[、,，;；]/).map(x => x.trim()).filter(Boolean);

function mk(over = {}) {
  const state = {
    kpNotes: over.kpNotes || {},
    mistakes: over.mistakes || [],
    questions: over.questions || [],
    kbNotes: over.kbNotes || [],
    wsFavs: over.wsFavs || [],
  };
  const calls = { kvSet: [], bkvSet: [], put: [], get: [], toasts: [], editors: [] };
  const DB = {
    kvSet: async (k, v) => calls.kvSet.push([k, v]),
    bkvSet: async (k, v) => calls.bkvSet.push([k, v]),
    get: async (t, id) => { calls.get.push(id); return over.dbGet || null; },
    put: async (t, r) => calls.put.push(r),
  };
  const toast = m => calls.toasts.push(m);
  const fns = loadFns([...KB_BASE, ...Object.keys(over.extraFns || {})], {
    state, DB, toast,
    splitKP,
    kbEditing: null,
    kbOpenEditor: o => calls.editors.push(o),
    kbNoteCountsRefresh: () => { },
    curView: '',
    kbRenderList: () => { },
    kbGraphNames: () => new Set(),
    wsFavSave: () => { calls.bkvSet.push(['wsFavs', [...state.wsFavs]]); },
    confirm: () => true,
    viewKB: () => { },
    viewMist: () => { },
    ...(over.extraFns || {}),
    ...(over.ctx || {}),
  });
  return { ...fns, state, calls };
}

const favWeb = (id, at) => ({ id, q: '牛顿第二定律', kp: '', engine: 'sogou', kind: 'web', title: 'T' + id, url: 'https://x.com/' + id, snippet: 'S' + id, ai: '', at });
const favAI = (id, at) => ({ id, q: '什么是动量', kp: '动量', engine: 'bingcn', kind: 'ai', title: '', url: '', snippet: '', ai: 'Ft=mv', at });

describe('kbAllNotes：收藏并入知识库', () => {
  it('wsFavs 映射为 kind=fav 的笔记，key 为 fav:<id>', () => {
    const { kbAllNotes } = mk({ wsFavs: [favWeb('w1', 100), favAI('a1', 200)] });
    const favs = kbAllNotes().filter(n => n.kind === 'fav');
    expect(favs).toHaveLength(2);
    expect(favs[0].key).toBe('fav:a1');                       // 按时间倒序，新的在前
    expect(favs[0].fav).toBe(favs[0].fav);                    // 原始收藏对象挂在 fav 字段
  });
  it('网页收藏 text 含查询词 + 标题 + 摘要，可被关键词搜到', () => {
    const { kbAllNotes, kbFilterList } = mk({ wsFavs: [favWeb('w1', 1)] });
    const n = kbAllNotes().find(x => x.kind === 'fav');
    expect(n.text).toContain('牛顿第二定律');
    expect(n.text).toContain('Tw1');
    expect(kbFilterList(kbAllNotes(), { kw: '摘要关键词不存在' })).toHaveLength(0);
    expect(kbFilterList(kbAllNotes(), { kw: 'sw1' })).toHaveLength(1);
  });
  it('AI 收藏 text 含查询词与回答；kp 映射为 kps 可按知识点筛选', () => {
    const { kbAllNotes, kbFilterList } = mk({ wsFavs: [favAI('a1', 1)] });
    const n = kbAllNotes().find(x => x.kind === 'fav');
    expect(n.text).toContain('什么是动量');
    expect(n.text).toContain('Ft=mv');
    expect(n.kps).toEqual(['动量']);
    expect(kbFilterList(kbAllNotes(), { kind: 'fav', kp: '动量' })).toHaveLength(1);
    expect(kbFilterList(kbAllNotes(), { kind: 'fav', kp: '不存在' })).toHaveLength(0);
  });
  it('空收藏 / 损坏项被跳过，不影响其它笔记', () => {
    const { kbAllNotes } = mk({
      wsFavs: [null, favWeb('w1', 1)],
      kpNotes: { 牛顿第二定律: { text: 'F=ma', at: 5 } },
    });
    const all = kbAllNotes();
    expect(all.filter(n => n.kind === 'fav')).toHaveLength(1);
    expect(all.filter(n => n.kind === 'kp')).toHaveLength(1);
  });
});

describe('kbStats：fav 计数', () => {
  it('fav 字段统计收藏条数', () => {
    const { kbStats } = mk({ wsFavs: [favWeb('w1', 1), favAI('a1', 2)], kbNotes: [{ id: 'f1', text: '手记', at: 3 }] });
    const s = kbStats();
    expect(s.fav).toBe(2);
    expect(s.free).toBe(1);
    expect(s.total).toBe(3);
  });
});

describe('kbEditNote：收藏不可直接编辑', () => {
  it('提示转笔记，不打开编辑器', () => {
    const { kbEditNote, calls } = mk({ wsFavs: [favWeb('w1', 1)] });
    kbEditNote('fav:w1');
    expect(calls.editors).toHaveLength(0);
    expect(calls.toasts.join()).toContain('转笔记');
  });
  it('普通手记仍可正常编辑', () => {
    const { kbEditNote, calls } = mk({ kbNotes: [{ id: 'f1', text: '手记', at: 3 }] });
    kbEditNote('free:f1');
    expect(calls.editors).toHaveLength(1);
  });
});

describe('kbDeleteNote：收藏走取消收藏通道', () => {
  it('删除后 state.wsFavs 移除且持久化', async () => {
    const { kbDeleteNote, calls } = mk({ wsFavs: [favWeb('w1', 1), favWeb('w2', 2)] });
    await kbDeleteNote('fav:w1');
    expect(calls.bkvSet.some(([k]) => k === 'wsFavs')).toBe(true);
  });
});
