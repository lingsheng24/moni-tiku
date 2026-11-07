/**
 * v2.3.0 随身刷题 + 学习周报
 * 覆盖：周报统计口径（自然周 / 正确率 / 活跃天数 / 连续学习 / 收获与待补）、
 *      首页周报卡、手机端底部标签栏与抽屉、PWA manifest 生成、设置页安装入口。
 */
import { describe, test, expect } from 'vitest';
const fs = require('fs');
const { loadFns, HTML_PATH } = require('./extract-html.js');

const HTML = fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');

const QUESTIONS = [
  { id: 1, knowledge_point: '三次握手' },
  { id: 2, knowledge_point: '三次握手、拥塞控制' },
  { id: 3, knowledge_point: '拥塞控制' },
  { id: 4, knowledge_point: '' },
];
const splitKP = s => String(s || '').split(/[、,，;；\/|]+/).map(x => x.trim()).filter(x => x && x !== '未分类');
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** 2026-11-04 周三 12:00（本地时间），当周周一 = 2026-11-02 */
const NOW = new Date(2026, 10, 4, 12, 0, 0).getTime();
const D = (m, d, h = 10) => new Date(2026, m - 1, d, h, 0, 0).getTime();

function ctx(over) {
  return Object.assign({
    state: { practice: [], questions: QUESTIONS, mistakes: [], settings: {} },
    splitKP, esc, APP_VER_SHOWN: '2.3.0',
  }, over || {});
}
const NAMES = ['weeklyReportData', 'weekStartOf', 'weekDayKey', 'weekKpAgg', 'weekNow', 'weekCardHTML',
  'WEEK_MS', 'WEEK_DAY_LABEL', 'WEEK_MD'];

describe('学习周报 · 统计口径', () => {
  test('weekStartOf：周三归到本周一 00:00，周一归自己', () => {
    const f = loadFns(['weekStartOf'], ctx());
    const mon = new Date(2026, 10, 2).getTime();
    expect(f.weekStartOf(NOW)).toBe(mon);
    expect(f.weekStartOf(D(11, 2, 0))).toBe(mon);
    expect(f.weekStartOf(D(11, 9, 23))).toBe(new Date(2026, 10, 9).getTime());
  });

  test('空数据：0 题、正确率 0、给出开始练习的提示，不报错', () => {
    const f = loadFns(NAMES, ctx());
    const w = f.weeklyReportData({ now: NOW });
    expect(w.total).toBe(0);
    expect(w.acc).toBe(0);
    expect(w.activeDays).toBe(0);
    expect(w.days.length).toBe(7);
    expect(w.tone).toContain('还没有练习记录');
    expect(w.label).toBe('11/2 - 11/8');
  });

  test('只统计本周：上周日记录进 prevTotal，不进本周', () => {
    const practice = [
      { question_id: 1, is_correct: 1, answered_at: D(11, 1, 20) },   // 上周日
      { question_id: 1, is_correct: 1, answered_at: D(11, 2, 9) },    // 本周一
      { question_id: 1, is_correct: 0, answered_at: D(11, 3, 9) },    // 本周二
      { question_id: 3, is_correct: 0, answered_at: D(11, 4, 9) },    // 今天
    ];
    const f = loadFns(NAMES, ctx({ state: { practice, questions: QUESTIONS, mistakes: [], settings: {} } }));
    const w = f.weeklyReportData({ now: NOW, practice, questions: QUESTIONS });
    expect(w.total).toBe(3);
    expect(w.correct).toBe(1);
    expect(w.acc).toBe(33);
    expect(w.prevTotal).toBe(1);
    expect(w.prevAcc).toBe(100);
    expect(w.changed).toBe(2);
    expect(w.activeDays).toBe(3);
    expect(w.days[0].n).toBe(1);
    expect(w.days[6].n).toBe(0);
    expect(w.days[2].today).toBe(true);
  });

  test('连续学习：今天没练不算断，从昨天往前数', () => {
    const practice = [1, 2, 3].map(d => ({ question_id: 1, is_correct: 1, answered_at: D(11, d, 9) }));
    const f = loadFns(NAMES, ctx());
    expect(f.weeklyReportData({ now: NOW, practice }).streak).toBe(3);     // 11/1~11/3
    const withToday = practice.concat([{ question_id: 1, is_correct: 1, answered_at: D(11, 4, 9) }]);
    expect(f.weeklyReportData({ now: NOW, practice: withToday }).streak).toBe(4);
  });

  test('跨周断档：上周练过、本周没练 → 连续天数从上周起算但本周为 0', () => {
    const practice = [{ question_id: 1, is_correct: 1, answered_at: D(10, 30, 9) }];
    const f = loadFns(NAMES, ctx());
    const w = f.weeklyReportData({ now: NOW, practice });
    expect(w.total).toBe(0);
    expect(w.streak).toBe(0);
  });

  test('收获榜：本周同知识点 ≥2 题且正确率 ≥60%，比上周提升的排前面', () => {
    const practice = [
      // 三次握手：上周 0/2，本周 3/3 → 提升 100%
      { question_id: 1, is_correct: 0, answered_at: D(10, 28, 9) },
      { question_id: 1, is_correct: 0, answered_at: D(10, 29, 9) },
      { question_id: 1, is_correct: 1, answered_at: D(11, 2, 9) },
      { question_id: 1, is_correct: 1, answered_at: D(11, 3, 9) },
      { question_id: 1, is_correct: 1, answered_at: D(11, 4, 9) },
      // 拥塞控制：本周 2 题 1 对（50%）→ 不进收获榜
      { question_id: 3, is_correct: 1, answered_at: D(11, 2, 10) },
      { question_id: 3, is_correct: 0, answered_at: D(11, 3, 10) },
    ];
    const f = loadFns(NAMES, ctx());
    const w = f.weeklyReportData({ now: NOW, practice, questions: QUESTIONS });
    expect(w.gains.length).toBe(1);
    expect(w.gains[0].kp).toBe('三次握手');
    expect(w.gains[0].n).toBe(3);
    expect(w.gains[0].rate).toBe(1);
    expect(w.gains[0].prevRate).toBe(0);
    expect(w.gains[0].delta).toBe(1);
  });

  test('收获榜：本周新开练（上周无数据）也能上榜，delta 为 null', () => {
    const practice = [
      { question_id: 3, is_correct: 1, answered_at: D(11, 2, 9) },
      { question_id: 3, is_correct: 1, answered_at: D(11, 3, 9) },
    ];
    const f = loadFns(NAMES, ctx());
    const w = f.weeklyReportData({ now: NOW, practice, questions: QUESTIONS });
    expect(w.gains.length).toBe(1);
    expect(w.gains[0].kp).toBe('拥塞控制');
    expect(w.gains[0].prevRate).toBe(null);
    expect(w.gains[0].delta).toBe(null);
  });

  test('待补榜：按本周答错次数排序，取前 3；多知识点题目两边都记', () => {
    const practice = [
      { question_id: 2, is_correct: 0, answered_at: D(11, 2, 9) },   // 三次握手 + 拥塞控制
      { question_id: 3, is_correct: 0, answered_at: D(11, 3, 9) },
      { question_id: 3, is_correct: 0, answered_at: D(11, 4, 9) },
      { question_id: 1, is_correct: 1, answered_at: D(11, 4, 10) },
    ];
    const f = loadFns(NAMES, ctx());
    const w = f.weeklyReportData({ now: NOW, practice, questions: QUESTIONS });
    expect(w.weak[0].kp).toBe('拥塞控制');
    expect(w.weak[0].wrong).toBe(3);
    expect(w.weak[0].n).toBe(3);
    expect(w.weak[1].kp).toBe('三次握手');
    expect(w.weak[1].wrong).toBe(1);
  });

  test('新增错题只数本周创建的', () => {
    const mistakes = [
      { created_at: D(11, 2, 9) }, { created_at: D(11, 4, 9) }, { created_at: D(10, 20, 9) },
    ];
    const f = loadFns(NAMES, ctx());
    const w = f.weeklyReportData({ now: NOW, mistakes });
    expect(w.newMistakes).toBe(2);
  });

  test('正确率变化写进评语；days 的标签从周一到周日', () => {
    const practice = [
      { question_id: 1, is_correct: 0, answered_at: D(10, 28, 9) },
      { question_id: 1, is_correct: 0, answered_at: D(10, 29, 9) },
      { question_id: 1, is_correct: 1, answered_at: D(11, 2, 9) },
      { question_id: 1, is_correct: 1, answered_at: D(11, 3, 9) },
    ];
    const f = loadFns(NAMES, ctx());
    const w = f.weeklyReportData({ now: NOW, practice });
    expect(w.days.map(d => d.label)).toEqual(['周一', '周二', '周三', '周四', '周五', '周六', '周日']);
    expect(w.tone).toContain('比上周高');
  });
});

describe('学习周报 · 首页卡与文本', () => {
  test('weekCardHTML：四个数字 + 7 根迷你柱 + 查看入口', () => {
    const practice = [{ question_id: 1, is_correct: 1, answered_at: D(11, 2, 9) }];
    const f = loadFns(NAMES, ctx({ state: { practice, questions: QUESTIONS, mistakes: [], settings: {} } }));
    const html = f.weekCardHTML();
    expect(html).toContain('本周学习');
    expect(html).toContain('openWeeklyReport()');
    expect((html.match(/wk-spark-bar/g) || []).length).toBe(7);
    expect(html).toContain('连续学习');
  });

  test('首页 viewDash 里挂了周报卡，且在今日计划之后', () => {
    const dash = HTML.slice(HTML.indexOf('async function viewDash'), HTML.indexOf('async function viewDash') + 2600);
    expect(dash).toContain('${masPlanHTML()}');
    expect(dash).toContain('${weekCardHTML()}');
    expect(dash.indexOf('${weekCardHTML()}')).toBeGreaterThan(dash.indexOf('${masPlanHTML()}'));
  });

  test('weeklyReportText：包含区间、每日明细、收获与待补，且不只是标题', () => {
    const practice = [
      { question_id: 1, is_correct: 1, answered_at: D(11, 2, 9) },
      { question_id: 1, is_correct: 1, answered_at: D(11, 3, 9) },
      { question_id: 3, is_correct: 0, answered_at: D(11, 4, 9) },
    ];
    const f = loadFns(NAMES, ctx({ state: { practice, questions: QUESTIONS, mistakes: [], settings: {} } }));
    // weeklyReportText 不在 NAMES 里，单独抽
    const g = loadFns(['weeklyReportText', 'weekNow', 'weeklyReportData', 'weekStartOf', 'weekDayKey', 'weekKpAgg',
      'WEEK_MS', 'WEEK_DAY_LABEL', 'WEEK_MD'],
      ctx({ state: { practice, questions: QUESTIONS, mistakes: [], settings: {} } }));
    const txt = g.weeklyReportText(NOW);
    expect(txt).toContain('学习周报');
    expect(txt).toContain('11/2 - 11/8');
    expect(txt).toContain('本周练习');
    expect(txt).toContain('周一 1 题');
    expect(txt).toContain('本周收获');
    expect(txt).toContain('下周待补');
  });
});

describe('随身模式 · 手机端结构', () => {
  test('底部标签栏 6 格：首页 / 练习 / 错题 / 复习 / 统计 / 更多', () => {
    const bar = HTML.slice(HTML.indexOf('<div id="mTabbar">'), HTML.indexOf('</div>', HTML.indexOf('<div id="mTabbar">')));
    const tabs = [...bar.matchAll(/data-t="([a-z]+)"/g)].map(m => m[1]);
    expect(tabs).toEqual(['dash', 'practice', 'mist', 'review', 'stats', 'more']);
  });

  test('顶栏有汉堡与板块切换；抽屉遮罩独立一层', () => {
    expect(HTML).toContain('id="mMenuBtn"');
    expect(HTML).toContain('id="mScrim"');
    expect(HTML).toContain('data-sec="kb"');
    expect(HTML).toContain('data-sec="tik"');
  });

  test('手机布局只在 ≤680px 且非桌面版生效，主区取消左边距', () => {
    const css = HTML.slice(HTML.indexOf('v2.3.0 随身模式'), HTML.indexOf('</style>'));
    expect(css).toContain('@media (max-width:680px)');
    expect(css).toContain('body:not(.is-desktop)');
    expect(css).toContain('margin-left:0!important');
    expect(css).toContain('#mTabbar');
  });

  test('答题选项在手机上放大到 46px 高，提交按钮吸底', () => {
    const css = HTML.slice(HTML.indexOf('v2.3.0 随身模式'), HTML.indexOf('</style>'));
    expect(css).toContain('.q-opt');
    expect(css).toContain('min-height:46px');
    expect(css).toContain('#submitBtn');
  });

  test('go() 会同步手机端标题与标签高亮', () => {
    const s = HTML.indexOf('function go(v)');
    const body = HTML.slice(s, HTML.indexOf('\n}', s));
    expect(body).toContain('mSyncNav(v)');
  });

  test('导航折叠按钮在手机上改为收起抽屉', () => {
    const s = HTML.indexOf("tBtn.onclick = () => {");
    const body = HTML.slice(s, s + 200);
    expect(body).toContain('mMobile()');
    expect(body).toContain('mDrawer(false)');
  });

  test('启动流程初始化手机导航与 PWA', () => {
    const boot = HTML.slice(HTML.indexOf('(async () => {\n  await DB.open()'));
    const head = boot.slice(0, 1400);
    expect(head).toContain('initMobileNav()');
    expect(head).toContain('initPwa()');
    expect(head).toContain('maybeShowWeeklyReport()');
  });
});

describe('PWA · 可安装', () => {
  test('initPwa 生成 blob manifest，含 192/512 与 maskable 图标', () => {
    const s = HTML.indexOf('function initPwa()');
    const body = HTML.slice(s, HTML.indexOf('\n}', s));
    expect(body).toContain("URL.createObjectURL(new Blob");
    expect(body).toContain('manifest+json');
    expect(body).toContain("rel = 'manifest'");
    expect(HTML).toContain("purpose: 'maskable'");
    expect(body).toContain('apple-touch-icon');
  });

  test('pwaIcon 用 canvas 画图标，尺寸可配', () => {
    const s = HTML.indexOf('function pwaIcon(');
    const body = HTML.slice(s, HTML.indexOf('\n}', s));
    expect(body).toContain('createElement(\'canvas\')');
    expect(body).toContain('toDataURL');
    expect(body).toContain('fillText');
  });

  test('桌面版跳过 PWA（本身就是安装包）', () => {
    const s = HTML.indexOf('function initPwa()');
    const body = HTML.slice(s, HTML.indexOf('\n}', s));
    expect(body).toContain('if (IS_DESKTOP) return;');
  });

  test('设置页有安装入口（仅网页版）', () => {
    const set = HTML.slice(HTML.indexOf('async function viewSet'));
    expect(set.slice(0, 12000)).toContain('pwaInstall()');
    expect(set.slice(0, 12000)).toContain('pwaInstallBtn');
  });
});

describe('v2.3.0 · 数据管理卡片分区', () => {
  const s = HTML.indexOf('<h3>💾 数据管理</h3>');
  const card = HTML.slice(s, HTML.indexOf('<div id="updCardHost">', s));

  test('按功能分区：备份与恢复 / 分享与迁移 / 批量录入 / 危险操作', () => {
    for (const h of ['备份与恢复', '分享与迁移', '批量录入', '危险操作']) expect(card).toContain(h);
    expect(card.match(/class="dm-sec/g).length).toBeGreaterThanOrEqual(5);
  });

  test('按钮为「图标 + 文字」样式，关键 id 保留', () => {
    expect(card.match(/class="dm-btn/g).length).toBeGreaterThanOrEqual(8);
    for (const id of ['id="sBackup"', 'id="sRestore"', 'id="sReset"', 'id="restoreIn"']) expect(card).toContain(id);
  });

  test('危险操作单独成区且带备份提醒', () => {
    const danger = card.slice(card.indexOf('危险操作'));
    expect(danger).toContain('dm-btn danger');
    expect(danger).toContain('先做一次备份');
  });

  test('平台差异：数据文件位置仅桌面、手机/平板仅网页', () => {
    expect(card).toContain("IS_DESKTOP ? `<div class=\"dm-sec\">\n      <div class=\"dm-sec-h\">数据文件位置");
    expect(card).toContain("!IS_DESKTOP ? `<div class=\"dm-sec\">\n      <div class=\"dm-sec-h\">手机 / 平板");
  });
});

describe('v2.4.0 · 首页顶部板块切换条', () => {
  test('切换条渲染函数与点击处理存在', () => {
    expect(HTML).toContain('function dashSecSwitchHTML()');
    expect(HTML).toContain('function dashSec(sec)');
    expect(HTML).toContain("applySection(sec, true);\n  viewDash();");
  });

  test('两个板块按钮 + 选中态 + 首页调用', () => {
    const s = HTML.indexOf('function dashSecSwitchHTML()');
    const body = HTML.slice(s, HTML.indexOf('\n}', s));
    expect(body.match(/k: '(kb|tik)'/g).length).toBe(2);
    expect(body).toContain("class=\"dsec${it.k === on ? ' active' : ''}\"");
    expect(HTML.slice(HTML.indexOf('async function viewDash'))).toContain('${dashSecSwitchHTML()}');
  });

  test('快速开始随板块分支：知识库 4 项 / 题库 6 项', () => {
    const s = HTML.indexOf('const quick = secNow');
    const body = HTML.slice(s, HTML.indexOf('];', s + 200));
    expect(body).toContain("'kbdocs'"); expect(body).toContain("'ask'"); expect(body).toContain("'kp'");
    expect(body).toContain("'docs'"); expect(body).toContain("'gen'"); expect(body).toContain("'practice'");
  });

  test('手机端隐藏（顶栏已有知/题切换），侧栏切换卡保留', () => {
    expect(HTML).toContain('@media (max-width:680px){body:not(.is-desktop) .dsec-switch{display:none}}');
    expect(HTML).toContain('<div class="nav-sec-now"');
  });
});
