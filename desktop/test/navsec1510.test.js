/**
 * v1.51.0 两大板块切换工作区：
 * 侧栏顶部「知识库 / 模拟题库」两块切换卡，点谁只显示谁的子功能；
 * 跳到板块内视图自动跟随切换并持久化；首页/统计/设置为通用项。
 * 覆盖：视图归属映射、HTML 结构、CSS 显隐与折叠态、go() 跟随、启动恢复、默认顺序。
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

describe('v1.51.0 两大板块切换工作区', () => {
  test('视图归属映射：知识库 3 项 / 模拟题库 6 项，通用项不在映射内', () => {
    const m = between('const VIEW_SEC', 'const SEC_HOME_VIEW');
    expect(m).toContain("kbdocs: 'kb'");
    expect(m).toContain("kb: 'kb'");
    expect(m).toContain("kp: 'kb'");
    expect(m).toContain("docs: 'tik'");
    expect(m).toContain("gen: 'tik'");
    expect(m).toContain("bank: 'tik'");
    expect(m).toContain("practice: 'tik'");
    expect(m).toContain("exam: 'tik'");
    expect(m).toContain("mist: 'tik'");
    expect(m).toContain("review: 'tik'");
    expect(m).not.toMatch(/dash:\s*'/);
    expect(m).not.toMatch(/stats:\s*'/);
    expect(m).not.toMatch(/set:\s*'/);
    expect(m).not.toMatch(/help:\s*'/);
  });

  test('板块首页映射：知识库→知识库文档，模拟题库→AI 生成题目', () => {
    const m = between('const SEC_HOME_VIEW', '/** 应用板块');
    expect(m).toContain("kb: 'kbdocs'");
    expect(m).toContain("tik: 'gen'");
  });

  test('applySection：写 body[data-sec]、save 时持久化 navSection（高亮交给 CSS）', () => {
    const f = between('function applySection', '/** 期望顺序 = 用户拖过的');
    expect(f).toContain("document.body.dataset.sec = sec");
    expect(f).not.toContain('classList.toggle');            // v2.4.0：指示条显隐由 body[data-sec] 驱动
    expect(f).toContain("state.settings.navSection = sec");
    expect(f).toContain("DB.kvSet('settings', state.settings)");
    expect(f).toContain("if (sec !== 'kb' && sec !== 'tik') sec = 'kb'");
  });

  test('侧栏结构：顶部只显示当前工作区指示条（含单字折叠态 知/题），内容按板块归组', () => {
    expect(HTML).toMatch(/<div class="nav-sec-now"[\s\S]*?data-s="kb"[\s\S]*?data-s="tik"/);
    expect(HTML).not.toContain('nav-sec-card');
    expect(HTML).toContain('<span class="sec-mini">知</span>');
    expect(HTML).toContain('<span class="sec-mini">题</span>');
    const kbGroup = between('<div class="nav-group" data-g="sec-kb" data-sec="kb">', '<!-- 模拟题库板块');
    ['data-v="kbdocs"', 'data-v="kb"', 'data-v="kp"'].forEach(v => expect(kbGroup).toContain(v));
    ['data-v="docs"', 'data-v="gen"', 'data-v="bank"', 'data-v="mist"', 'data-v="stats"', 'data-v="set"'].forEach(v => expect(kbGroup).not.toContain(v));
    const tikGroup = between('<div class="nav-group" data-g="sec-tik" data-sec="tik">', '<!-- 通用：统计分析');
    ['data-v="docs"', 'data-v="gen"', 'data-v="bank"', 'data-v="practice"', 'data-v="exam"', 'data-v="mist"', 'data-v="review"'].forEach(v => expect(tikGroup).toContain(v));
    ['data-v="kbdocs"', 'data-v="kb"', 'data-v="kp"'].forEach(v => expect(tikGroup).not.toContain(v));
    expect(HTML).toContain('<span class="txt">出题资料</span>');
    expect(HTML).toContain('<span class="txt">笔记聚合</span>');
    const common2 = between('<div class="nav-group" data-g="common2">', '<!-- v2.1.1：底部行');
    expect(common2).toContain('data-v="stats"');
    expect(common2).not.toContain('data-v="set"');     // v2.1.1：设置移到底部固定行
    expect(common2).toContain('通用');
  });

  test('CSS：板块组按 body[data-sec] 显隐，板块卡样式与激活态齐备', () => {
    expect(HTML).toContain('.nav-group[data-sec]{display:none}');
    expect(HTML).toContain('body[data-sec="kb"] .nav-group[data-sec="kb"]{display:flex}');
    expect(HTML).toContain('body[data-sec="tik"] .nav-group[data-sec="tik"]{display:flex}');
    expect(HTML).toContain('body[data-sec="kb"] .nsn-set[data-s="kb"]');
    expect(HTML).toMatch(/\.nsn-set \.sec-meta small\{font-size:10px/);
  });

  test('折叠/窄屏：卡竖排、副标题隐藏、单字显示', () => {
    expect(HTML).toContain('body.nav-collapsed .nsn-set .sec-meta{display:none}');
    expect(HTML).toContain('body.nav-collapsed .nsn-set .sec-mini{display:block}');
    expect(HTML).toContain('body.nav-collapsed .nav-sec-now{width:44px;padding:8px 0;margin-left:auto;margin-right:auto}');
    const media = between('@media(max-width:900px){.main{padding:16px}', '/* ---------- 自绘标题栏');
    expect(media).toContain('.nsn-set .sec-mini{display:block}');
    expect(media).toContain('.nsn-set .sec-meta{display:none}');
  });

  test('go()：跳到板块内视图自动切板块并持久化', () => {
    const f = between('function go(v)', 'document.querySelectorAll(\'.nav-item\')');
    expect(f).toContain('const sec = VIEW_SEC[v]');
    expect(f).toContain("if (sec && document.body.dataset.sec !== sec) applySection(sec, true)");
  });

  test('启动流程：settings 加载后恢复上次板块（不落盘）', () => {
    const boot = between('initNavDragSort();', 'initSelBar();');
    expect(boot).toContain("applySection(state.settings.navSection === 'tik' ? 'tik' : 'kb', false)");
  });

  test('v2.4.0：侧栏指示条纯展示，切换集中在首页顶部；手机顶栏仍保留知/题切换', () => {
    expect(HTML).not.toContain("querySelectorAll('.nav-sec-card')");
    expect(between('function dashSec(sec)', 'async function viewDash')).toContain('applySection(sec, true);');
    expect(HTML).toContain("document.querySelectorAll('#mTopbar .m-sec-btn')");
  });

  test('settings 默认值含 navSection，body 初始 data-sec="kb"', () => {
    expect(HTML).toContain("navSection: 'kb'");
    expect(HTML).toContain('<body data-sec="kb">');
  });

  test('默认导航顺序按新板块结构排列，帮助说明已同步两大板块说法', () => {
    expect(HTML).toContain("const NAV_DEFAULT_ORDER = ['dash', 'kbdocs', 'ask', 'kb', 'kp', 'docs', 'gen', 'bank', 'practice', 'exam', 'mist', 'review', 'stats', 'set', 'help'];");
    expect(HTML).toContain('导航按<b>两大板块</b>组织');
    expect(HTML).not.toContain('内容与资料</b>（文档、出题');
  });
});
