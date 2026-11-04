/**
 * v2.1.1 数据说明搬家：
 * 侧栏底部那行「数据保存在本机浏览器（IndexedDB）…」删掉，
 * 改到「设置 → 软件更新」卡片末尾（灰底 .upd-data-note），桌面版与网页版各说各的存放位置。
 * 覆盖：侧栏清理、卡片两环境渲染、文案、帮助手册同步。
 */
import { describe, test, expect } from 'vitest';
const fs = require('fs');
const path = require('path');
const { HTML_PATH } = require('./extract-html.js');

const HTML = fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');

function between(a, b) {
  const s = HTML.indexOf(a);
  if (s < 0) return '';
  const e = HTML.indexOf(b, s + a.length);
  return e < 0 ? '' : HTML.slice(s, e);
}

const SIDEBAR = between('<aside class="sidebar">', '</aside>');
const _i0 = HTML.indexOf('async function renderUpdateCard()');
const CARD = HTML.slice(_i0, _i0 + 12000);

describe('v2.1.1 数据说明移入设置·软件更新卡片', () => {
  test('侧栏不再有底部灰字说明', () => {
    expect(SIDEBAR).not.toContain('class="foot"');
    expect(SIDEBAR).not.toContain('数据保存在本机');
    expect(HTML).not.toContain('.sidebar .foot{');
    expect(HTML).not.toContain('body.nav-collapsed .sidebar .foot{display:none}');
  });

  test('设置页无条件渲染更新卡片宿主（网页版也有）', () => {
    expect(HTML).toContain('<div id="updCardHost"></div>`;');
    expect(HTML).not.toContain("${IS_DESKTOP ? '<div id=\"updCardHost\"></div>' : ''}");
  });

  test('renderUpdateCard 不再对网页版直接返回', () => {
    const head = CARD.slice(0, 900);
    expect(head).toContain('if (!host) return;');
    expect(head).not.toContain('if (!host || !IS_DESKTOP) return;');
    expect(head).toContain('if (!IS_DESKTOP) {');
  });

  test('网页版卡片：版本号 + 刷新按钮 + IndexedDB 数据说明', () => {
    const web = CARD.slice(CARD.indexOf('if (!IS_DESKTOP) {'), CARD.indexOf('const ver = await window.electronAPI.getAppVersion()'));
    expect(web).toContain('当前版本 v${APP_VER_SHOWN}');
    expect(web).toContain('刷新到最新');
    expect(web).toContain('upd-data-note');
    expect(web).toContain('浏览器 IndexedDB');
    expect(web).toContain('不会上传到任何服务器');
  });

  test('桌面版卡片：数据文件 + 不上传 + 更新不丢数据', () => {
    const desk = CARD.slice(CARD.indexOf('const ver = await'));
    expect(desk).toContain('upd-data-note');
    expect(desk).toContain('<b>💾 数据只存在本机</b>');
    expect(desk).toContain('数据文件');
    expect(desk).toContain('不会上传到任何服务器');
    expect(desk).toContain('更新或重装都不会动它');
  });

  test('说明块有独立样式（灰底块，不挤占卡片正文）', () => {
    expect(HTML).toContain('.upd-data-note{margin-top:12px;padding:10px 12px;border-radius:9px;background:var(--panel2);border:1px solid var(--border);font-size:12px;color:var(--muted);line-height:1.75}');
    expect(HTML).toContain('.upd-data-note b{color:var(--text)}');
  });

  test('renderUpdateCard 在桌面版 if 之外调用（两种环境都渲染）', () => {
    const i = HTML.indexOf('renderUpdateCard();');
    expect(i).toBeGreaterThan(0);
    const before = HTML.slice(Math.max(0, i - 400), i);
    // 调用点前应当是 if 块的收尾 `}`，而不是仍在 if (IS_DESKTOP) { … 内部
    expect(before).toMatch(/renderBankMgr\(\);\s*\/\/[^\n]*\n\s*\}\s*\n\s*$/);
    expect(HTML).toContain('renderUpdateCard();   // v2.1.1：网页版也显示');
  });

  test('帮助手册：安装章写清数据说明在软件更新卡片末尾', () => {
    expect(HTML).toContain('「设置 → 软件更新」卡片末尾');
    expect(HTML).toContain('检查更新 / 版本与数据');
  });

  test('帮助手册：设置章有「软件更新 / 版本与数据」小节', () => {
    expect(HTML).toContain('<div class="help-h4">软件更新 / 版本与数据</div>');
    expect(HTML).toContain('就是原来挂在侧栏最底部的那行小字');
    expect(HTML).toContain('同一张卡片显示当前版本 + 「🔄 刷新到最新」');
  });
});
