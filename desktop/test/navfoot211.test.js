/**
 * v2.1.1 导航栏底部固定项：
 * 「使用帮助」更名「帮助」、「系统设置」更名「设置」，两项都从功能分组移到底部固定行，
 * 与折叠按钮排成一行；底部项不参与拖动排序、不参与板块切换，但照样受 go() 与 active 高亮控制。
 * 覆盖：HTML 结构、文案、CSS 布局（展开 / 折叠 / 窄屏）、视图标题、帮助章节标题、旧文案残留。
 */
import { describe, test, expect } from 'vitest';
const fs = require('fs');
const { HTML_PATH } = require('./extract-html.js');

const HTML = fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');

function between(a, b) {
  const s = HTML.indexOf(a);
  if (s < 0) return '';
  const e = HTML.indexOf(b, s + a.length);
  return e < 0 ? '' : HTML.slice(s, e);
}

/** 底部固定行的 HTML 片段（nav-footrow 到侧栏结束） */
const FOOT = between('<div class="nav-footrow">', '</aside>');

describe('v2.1.1 导航栏底部固定项（帮助 / 设置）', () => {
  test('底部行同时有「帮助」和「设置」两个导航项', () => {
    expect(FOOT).toContain('data-v="help"');
    expect(FOOT).toContain('data-v="set"');
    expect(FOOT).toContain('<span class="txt">帮助</span>');
    expect(FOOT).toContain('<span class="txt">设置</span>');
  });

  test('两项用统一的 nav-foot 类，不再有旧的 nav-help 类', () => {
    expect((FOOT.match(/class="nav-item nav-foot"/g) || []).length).toBe(2);
    expect(FOOT).not.toContain('nav-help');
    expect(HTML).not.toContain('.nav-footrow .nav-help{');
  });

  test('底部行仍保留折叠按钮，且顺序是 帮助 → 设置 → 折叠按钮', () => {
    const iHelp = FOOT.indexOf('data-v="help"');
    const iSet = FOOT.indexOf('data-v="set"');
    const iTog = FOOT.indexOf('id="navToggle"');
    expect(iHelp).toBeGreaterThan(-1);
    expect(iSet).toBeGreaterThan(iHelp);
    expect(iTog).toBeGreaterThan(iSet);
  });

  test('功能分组里不再有设置项，统计分析仍是通用项', () => {
    const groups = between('<div class="nav-group" data-g="common">', '<div class="nav-footrow">');
    expect(groups).not.toContain('data-v="set"');
    expect(groups).not.toContain('data-v="help"');
    expect(groups).toContain('data-v="stats"');
  });

  test('CSS：帮助、设置各占一行（竖排），折叠按钮右下角', () => {
    expect(HTML).toContain('.sidebar .nav-footrow{margin-top:auto;padding-top:8px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:2px}');
    expect(HTML).toMatch(/\.nav-footrow \.nav-foot\{width:100%;flex:none;padding:8px 10px;gap:8px;justify-content:flex-start;font-size:13px;cursor:pointer\}/);
    expect(HTML).toMatch(/\.nav-footrow \.nav-tool-btn\{flex:none;align-self:flex-end;width:30px;height:28px/);
  });

  test('CSS：折叠态与 900px 窄屏都竖排成图标条（44px）', () => {
    expect(HTML).toContain('body.nav-collapsed .sidebar .nav-footrow{gap:4px;width:44px}');
    expect(HTML).toContain('body.nav-collapsed .sidebar .nav-footrow .nav-foot{width:44px;flex:none;justify-content:center;padding:10px 0;gap:0}');
    const media = between('@media(max-width:900px){.main{padding:16px}', '/* ---------- 自绘标题栏');
    expect(media).toContain('.sidebar .nav-footrow .nav-foot{width:44px;flex:none;padding:10px 0;gap:0}');
    expect(media).toContain('.sidebar .nav-footrow .nav-tool-btn{width:44px;height:32px;flex:none;align-self:center;margin-top:4px}');
  });

  test('拖动排序只认功能分组内的项，底部固定项不参与', () => {
    expect(HTML).toContain("sidebar.querySelectorAll('.nav-group .nav-item')");
    expect(HTML).toContain("document.querySelectorAll('.sidebar .nav-group .nav-item')");
  });

  test('文案：视图标题改为「帮助」与「设置」', () => {
    expect(HTML).toContain('<h1>帮助</h1><div class="sub">模拟题库 v${APP_VER_SHOWN} 完整操作说明');
    expect(HTML).toContain('<h1>设置</h1><div class="sub">配置 AI 接口、界面与数据管理</div>');
    expect(HTML).not.toContain('<h1>帮助手册</h1>');
    expect(HTML).not.toContain('<h1>系统设置</h1>');
  });

  test('帮助章节标题同步为「设置」', () => {
    expect(HTML).toContain("id: 'set', ico: '⚙️', title: '设置'");
    expect(HTML).not.toContain("title: '系统设置'");
  });

  test('全站不再残留旧名称（帮助手册仅作为代码注释区名保留）', () => {
    expect(HTML).not.toContain('系统设置');
    expect(HTML).not.toContain('使用帮助');
    const ws = fs.readFileSync(require('path').join(__dirname, '..', '..', 'src', 'websearch.js'), 'utf8');
    expect(ws).not.toContain('系统设置');
  });

  test('帮助正文说明底部固定项：两大板块 + 帮助/设置在最底部', () => {
    expect(HTML).toContain('<b>帮助</b>与<b>设置</b>固定在导航栏最底部');
    expect(HTML).toContain('导航栏最底部一行固定放 <b>帮助</b>、<b>设置</b>');
    expect(HTML).toContain('最底部一行固定是 <b>帮助</b> 和 <b>设置</b>');
  });

  test('底部项仍走统一的高亮与点击逻辑（遍历所有 .nav-item）', () => {
    expect(HTML).toContain("document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.v === v));");
    expect(HTML).toContain("document.querySelectorAll('.nav-item').forEach(n => {");
    expect(HTML).toMatch(/set: viewSet, help: viewHelp/);
  });
});
