// @vitest-environment jsdom
/**
 * v2.2.1 知识库文档列表：表头列宽自由拖动
 * 覆盖：默认/自定义列宽合并与边界、CSS 变量拼装、表头拖拽手柄、拖动过程与落盘、
 *       双击复位单列 / 全部复位、样式与「恢复默认列宽」入口。
 */
import { describe, test, expect, beforeEach } from 'vitest';
const fs = require('fs');
const { loadFns, HTML_PATH } = require('./extract-html.js');

const HTML = fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');

const NAMES = ['kbdColWidths', 'kbdColVars', 'kbdColResize', 'kbdColReset', 'kbdListHeadHTML', 'kbdSortBy',
  'KBD_COL_DEF', 'KBD_COL_MIN', 'KBD_COL_MAX', 'KBD_COL_NAME', 'KBD_SORT_LABEL'];

function makeEnv(opts = {}) {
  const settings = Object.assign({}, opts.settings || {});
  const kv = [];
  const toasts = [];
  const fns = loadFns(NAMES, {
    state: { settings },
    DB: { kvSet: (k, v) => { kv.push([k, v]); return Promise.resolve(); } },
    toast: m => toasts.push(m),
    viewKbDocs: () => { settings.reloaded = (settings.reloaded || 0) + 1; return Promise.resolve(); },
    kbdSort: Object.assign({ by: 'mtime', dir: 'desc' }, opts.sort || {}),
  });
  return { fns, settings, kv, toasts };
}

function mountList() {
  document.body.innerHTML = `
    <div class="kbd-list">
      <div class="kbd-list-head">
        <button type="button" class="kd-col c-name" data-k="name">笔记名称<i class="kd-hd" data-k="name"></i></button>
        <button type="button" class="kd-col c-tags" data-k="tags">标签<i class="kd-hd" data-k="tags"></i></button>
        <button type="button" class="kd-col c-kp" data-k="kp">知识点<i class="kd-hd" data-k="kp"></i></button>
        <button type="button" class="kd-col c-link" data-k="link">链出/被链<i class="kd-hd" data-k="link"></i></button>
        <span class="kd-col c-sum" data-k="sum">摘要<i class="kd-hd" data-k="sum"></i></span>
        <button type="button" class="kd-col c-date" data-k="date">修改日期<i class="kd-hd" data-k="date"></i></button>
      </div>
      <div class="kbd-row"><span class="c-name">某笔记.md</span></div>
    </div>`;
}

const mousedown = x => ({ clientX: x, preventDefault() { }, stopPropagation() { } });

describe('列表表头列宽拖动', () => {
  beforeEach(() => { document.body.innerHTML = ''; document.body.className = ''; });

  test('常量：默认值与最小宽度齐备，最小宽度都小于默认值', () => {
    const { KBD_COL_DEF, KBD_COL_MIN, KBD_COL_MAX } = makeEnv().fns;
    expect(Object.keys(KBD_COL_DEF)).toEqual(['name', 'tags', 'kp', 'link', 'sum', 'date']);
    for (const k of Object.keys(KBD_COL_DEF)) {
      expect(KBD_COL_MIN[k]).toBeGreaterThan(0);
      if (k !== 'sum') expect(KBD_COL_MIN[k]).toBeLessThan(KBD_COL_DEF[k]);
    }
    expect(KBD_COL_MAX).toBe(720);
  });

  test('kbdColWidths：没设置用默认，设置了用设置值，过小/非法回默认，过大截断', () => {
    expect(makeEnv().fns.kbdColWidths()).toEqual({ name: 240, tags: 160, kp: 150, link: 92, sum: 0, date: 96 });
    expect(makeEnv({ settings: { kbdColW: { name: 320, tags: 200 } } }).fns.kbdColWidths())
      .toEqual({ name: 320, tags: 200, kp: 150, link: 92, sum: 0, date: 96 });
    expect(makeEnv({ settings: { kbdColW: { name: 20, tags: 'abc', kp: 180.6 } } }).fns.kbdColWidths())
      .toEqual({ name: 240, tags: 160, kp: 181, link: 92, sum: 0, date: 96 });     // 过小/非数字回默认，小数四舍五入
    expect(makeEnv({ settings: { kbdColW: { name: 5000 } } }).fns.kbdColWidths().name).toBe(720);   // 超上限截断
  });

  test('kbdColVars：六列变量齐全，摘要默认弹性、拖过后变固定', () => {
    expect(makeEnv().fns.kbdColVars())
      .toBe('--c-name:240px;--c-tags:160px;--c-kp:150px;--c-link:92px;--c-sum:minmax(140px,1fr);--c-date:96px');
    expect(makeEnv({ settings: { kbdColW: { sum: 300, name: 280 } } }).fns.kbdColVars())
      .toContain('--c-sum:minmax(300px,300px)');
    expect(makeEnv({ settings: { kbdColW: { name: 280 } } }).fns.kbdColVars())
      .toContain('--c-name:280px');
  });

  test('表头六列每列都有拖拽手柄，data-k 一一对应', () => {
    const html = makeEnv().fns.kbdListHeadHTML();
    const keys = [...html.matchAll(/class="kd-hd" data-k="([a-z]+)"/g)].map(m => m[1]);
    expect(keys).toEqual(['name', 'tags', 'kp', 'link', 'sum', 'date']);
    expect((html.match(/onmousedown="kbdColResize\(event,'/g) || []).length).toBe(6);
    expect((html.match(/ondblclick="event\.stopPropagation\(\);kbdColReset\('/g) || []).length).toBe(6);
    // 手柄自身点击不能冒泡触发排序
    expect((html.match(/onclick="event\.stopPropagation\(\)"/g) || []).length).toBe(6);
    // 摘要列不可排序，但仍有手柄
    expect(html).toContain('<span class="kd-col c-sum" data-k="sum">摘要<i class="kd-hd" data-k="sum"');
  });

  test('拖动：按水平位移实时改变量，松手写进设置并提示', async () => {
    mountList();
    const env = makeEnv();
    const listEl = document.querySelector('.kbd-list');
    env.fns.kbdColResize(mousedown(100), 'name');
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 260, bubbles: true }));
    expect(listEl.style.getPropertyValue('--c-name')).toBe('160px');   // jsdom 里 rect 宽 0，起点按 0 算
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 460, bubbles: true }));
    expect(listEl.style.getPropertyValue('--c-name')).toBe('360px');
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    expect(env.settings.kbdColW).toEqual({ name: 360 });
    expect(env.kv[0][0]).toBe('settings');
    expect(env.toasts[0]).toContain('笔记名称');
    expect(env.toasts[0]).toContain('360px');
    expect(document.body.classList.contains('kd-resizing')).toBe(false);
    expect(document.querySelector('.kd-hd').classList.contains('on')).toBe(false);
  });

  test('拖动：不小于最小宽度、不超过上限；没实际移动就不写设置', async () => {
    mountList();
    const env = makeEnv();
    const listEl = document.querySelector('.kbd-list');
    env.fns.kbdColResize(mousedown(100), 'tags');
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: -500, bubbles: true }));
    expect(listEl.style.getPropertyValue('--c-tags')).toBe('72px');    // 最小宽度兜底
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 2000, bubbles: true }));
    expect(listEl.style.getPropertyValue('--c-tags')).toBe('720px');   // 上限兜底
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    expect(env.settings.kbdColW.tags).toBe(720);

    const quiet = makeEnv();
    mountList();
    quiet.fns.kbdColResize(mousedown(100), 'kp');
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));   // 没移动
    await new Promise(r => setTimeout(r, 0));
    expect(quiet.settings.kbdColW).toBeUndefined();
    expect(quiet.kv.length).toBe(0);
  });

  test('摘要列拖动写成固定宽度（minmax(Npx,Npx)），而不是弹性', async () => {
    mountList();
    const env = makeEnv();
    const listEl = document.querySelector('.kbd-list');
    env.fns.kbdColResize(mousedown(0), 'sum');
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 400, bubbles: true }));
    expect(listEl.style.getPropertyValue('--c-sum')).toBe('minmax(400px,400px)');
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    expect(env.settings.kbdColW.sum).toBe(400);
  });

  test('非法列名直接忽略，不会绑事件也不改宽度', () => {
    mountList();
    const env = makeEnv();
    env.fns.kbdColResize(mousedown(10), 'bogus');
    expect(document.body.classList.contains('kd-resizing')).toBe(false);
  });

  test('kbdColReset：删单列 / 全清都落盘并重渲染', async () => {
    const a = makeEnv({ settings: { kbdColW: { name: 300, tags: 200 } } });
    await a.fns.kbdColReset('name');
    expect(a.settings.kbdColW).toEqual({ tags: 200 });
    expect(a.settings.reloaded).toBe(1);
    expect(a.toasts[0]).toContain('笔记名称');

    const b = makeEnv({ settings: { kbdColW: { name: 300, tags: 200 } } });
    await b.fns.kbdColReset();
    expect(b.settings.kbdColW).toEqual({});
    expect(b.settings.reloaded).toBe(1);
    expect(b.toasts[0]).toContain('全部');
  });

  test('渲染入口带上列宽变量，统计行有「恢复默认列宽」', () => {
    expect(HTML).toContain('class="kbd-list" style="${kbdColVars()}"');
    expect(HTML).toContain('↺ 恢复默认列宽');
    expect(HTML).toContain('onclick="kbdColReset()"');
  });

  test('CSS：手柄骑在列边界、拖动期间锁定光标，默认列宽写在 .kbd-list 上', () => {
    expect(HTML).toContain('--c-name:240px;--c-tags:160px;--c-kp:150px;--c-link:92px;--c-sum:minmax(140px,1fr);--c-date:96px');
    expect(HTML).toContain('.kbd-list-head .kd-hd{position:absolute;top:-9px;bottom:-9px;right:-8px;width:15px;cursor:col-resize;z-index:3}');
    expect(HTML).toContain('.kbd-list-head .kd-hd:hover::after,.kbd-list-head .kd-hd.on::after{background:var(--primary);width:2px;left:6px}');
    expect(HTML).toContain('body.kd-resizing{cursor:col-resize!important;user-select:none}');
    expect(HTML).toContain('.kbd-list-head .kd-col{position:relative;');
  });

  test('帮助手册讲清列宽拖动、双击复位与一键恢复', () => {
    expect(HTML).toContain('<div class="help-h4">列宽自由拖动</div>');
    expect(HTML).toMatch(/按住左右拖动/);
    expect(HTML).toMatch(/双击/);
    expect(HTML).toContain('↺ 恢复默认列宽');
    expect(HTML).toMatch(/拖动结果会记住/);
  });
});
