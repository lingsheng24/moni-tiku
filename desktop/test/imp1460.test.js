/**
 * v1.46.0 题目/知识点重要程度
 * 覆盖：impOf 默认与取值范围、impStarsHTML 渲染契约、setImportance 写盘与回滚、
 * buildGraph 节点取最高星、图谱节点大小/外环/筛选可见性、题库筛选与导出跟随。
 */
import { describe, test, expect } from 'vitest';
const fs = require('fs');
const { loadFns, HTML_PATH } = require('./extract-html.js');

const HTML = fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');
const between = (startFn, endMark) => {
  const s = HTML.indexOf('function ' + startFn);
  const e = HTML.indexOf(endMark, s);
  return s < 0 ? '' : HTML.slice(s, e < 0 ? s + 6000 : e);
};

describe('impOf 取值', () => {
  // impOf 依赖顶层常量 IMP_LABEL/IMP_COLOR —— 把常量声明拼进函数体一起求值
  const evalIn = expr => {
    const s = HTML.indexOf('const IMP_LABEL');
    const e = HTML.indexOf('/** 五颗星 pill', s);   // 头部要含 impOf 函数体本身
    const head = HTML.slice(s, e);
    const fn = new Function(head + 'return ' + expr + ';');
    return fn();
  };
  test('1~5 星常量表齐全', () => {
    const label = evalIn('IMP_LABEL'), color = evalIn('IMP_COLOR');
    expect(Object.keys(label).sort()).toEqual(['1', '2', '3', '4', '5']);
    expect(label[5]).toBe('核心');
    expect(Object.keys(color).length).toBe(5);
  });
  test('未标记默认 3 星，非法值兜底 3，合法值原样返回', () => {
    const impOf2 = evalIn('impOf');
    expect(impOf2({})).toBe(3);
    expect(impOf2(null)).toBe(3);
    expect(impOf2({ importance: 0 })).toBe(3);
    expect(impOf2({ importance: 99 })).toBe(3);
    expect(impOf2({ importance: 5 })).toBe(5);
    expect(impOf2({ importance: '4' })).toBe(4);
    expect(impOf2({ importance: 1 })).toBe(1);
  });
});

describe('impStarsHTML 渲染契约', () => {
  const src = between('impStarsHTML', 'async function setImportance');
  test('五颗星、data-qid 供保存后就地替换、点击调 setImportance', () => {
    expect(src).toContain('data-qid="${q.id}"');
    expect(src).toContain('setImportance(${q.id},${i},event)');
    expect(src).toContain('[1, 2, 3, 4, 5]');
  });
  test('星级颜色按 IMP_COLOR 取当前档位色', () => {
    expect(src).toContain('IMP_COLOR[v]');
    expect(src).toContain('IMP_LABEL[v]');
  });
});

describe('setImportance 写盘与回滚', () => {
  test('写盘前先改内存，失败回滚并就地还原星 pill', () => {
    const s = HTML.indexOf('async function setImportance');
    const e = HTML.indexOf('function qNote(', s);
    const f = HTML.slice(s, e);
    expect(f).toContain('const old = q.importance;');
    expect(f).toContain('q.importance = n;');
    expect(f).toContain('dbPut(\'questions\'');
    // 回滚分支里也要还原界面
    const catchIdx = f.indexOf('catch (e)');
    expect(catchIdx).toBeGreaterThan(-1);
    expect(f.slice(catchIdx)).toContain('q.importance = old;');
    expect(f.slice(catchIdx)).toContain('impStarsHTML(q)');
  });
  test('成功后就地替换星 pill 并联动图谱详情卡', () => {
    const s = HTML.indexOf('async function setImportance');
    const e = HTML.indexOf('function qNote(', s);
    const f = HTML.slice(s, e);
    expect(f).toContain('imp-stars[data-qid=');
    expect(f).toContain("curView === 'kp'");
    expect(f).toContain('renderKPDetail(kpSelected)');
    expect(f).toContain('kpDraw()');
  });
  test('越界星数会被夹到 1~5', () => {
    const s = HTML.indexOf('async function setImportance');
    const f = HTML.slice(s, HTML.indexOf('function qNote(', s));
    expect(f).toContain('Math.max(1, Math.min(5,');
  });
});

describe('buildGraph 节点重要程度 = 其下题目最高星', () => {
  test('节点初始 imp=1，随题目逐题取 max', () => {
    const src = between('buildGraph', '/** 命中检测') || between('buildGraph', 'function sphereLayout');
    expect(src).toContain('ids: new Set(), imp: 1 }');
    expect(src).toContain('nodes[i].imp = Math.max(nodes[i].imp, impOf(q))');
  });
});

describe('图谱节点显示重要程度', () => {
  test('节点半径随星级缩放，命中检测用同一公式', () => {
    const draw = between('kpDraw', '/** 命中检测');
    expect(draw).toContain('(0.85 + (imp - 3) * 0.12)');
    const pick = between('kpPick', 'function kpTick');
    expect(pick).toContain('(0.85 + ((p.n.imp || 3) - 3) * 0.12)');
  });
  test('≥4 星节点画彩色外环，颜色取 IMP_COLOR', () => {
    const draw = between('kpDraw', '/** 命中检测');
    expect(draw).toContain('if (imp >= 4)');
    expect(draw).toContain('kpAlpha(IMP_COLOR[imp]');
  });
  test('悬停提示显示重要程度星与档位名', () => {
    const tip = between('kpTipShow', '/** 双击知识点');
    expect(tip).toContain('重要程度');
    expect(tip).toContain("IMP_LABEL[nd.imp || 3]");
  });
});

describe('图谱「只看重要」筛选', () => {
  test('kpNodeVisible 有重要筛选分支', () => {
    const v = between('kpNodeVisible', '/** 图谱工具栏「📝 有笔记」开关');
    expect(v).toContain('kpImpOnlyOn()');
    expect(v).toContain('(nd.imp || 3) < 4');
  });
  test('开关持久化到 settings 并重绘', () => {
    const f = between('setKPImpOnly', '/* ---------- 知识库页面');
    expect(f).toContain('state.settings.kpImpOnly');
    expect(f).toContain("DB.kvSet('settings'");
    expect(f).toContain('kpSyncLegend(); kpDraw();');
  });
  test('工具栏有开关与计数，筛选浮标入栈', () => {
    expect(HTML).toContain('id="kpImpChk"');
    expect(HTML).toContain('id="kpImpN"');
    expect(HTML).toContain("id=\"kpImpChip\"");
    expect(HTML).toContain("'kpNoteChip', 'kpImpChip']");
  });
  test('全部筛空时给出指引文案', () => {
    expect(HTML).toContain("还没有重要程度 ≥4 星的知识点");
    expect(HTML).toContain('在题目上点星级标记 ⭐');
  });
});

describe('题目列表接入重要程度', () => {
  test('答题练习 / 题库管理 / 复习卡 / 卡片管理 / 详情卡 / 双链弹窗都渲染星 pill', () => {
    expect(between('renderQuiz', 'async function goQuestion')).toContain('impStarsHTML(it)');
    expect(between('viewBank', '/* ---------- 导出 Word')).toContain('impStarsHTML(q)');
    expect(between('renderKPDetail', 'function scrollKPNotes')).toContain('impStarsHTML(q)');
    expect(between('kpRelModal', 'async function viewKP')).toContain('impStarsHTML(q)');
    expect(between('viewQuestion', 'async function showDoc')).toContain('impStarsHTML(q)');
    expect(between('kbShowQuestion', '/** 只重渲染笔记列表')).toContain('impStarsHTML(q)');
  });
  test('复习会话（src/websearch.js）与卡片管理行内答题也带星', () => {
    const ws = fs.readFileSync(require('path').join(require('path').dirname(HTML_PATH), 'src', 'websearch.js'), 'utf8');
    expect(ws).toContain('impStarsHTML(q)');
    const rv = HTML.indexOf("impStarsHTML(q)}<span style=\"color:var(--muted);font-size:12px\">点击星级标记重要程度");
    expect(rv).toBeGreaterThan(-1);
  });
  test('详情弹窗 kv 显示重要程度行', () => {
    expect(between('viewQuestion', 'async function showDoc')).toContain('<dt>重要程度</dt>');
  });
});

describe('题库筛选与导出跟随重要程度', () => {
  test('bankFilter 有 imp 字段，列表与导出共用同一筛选', () => {
    expect(HTML).toContain("let bankFilter = { doc: '', type: '', diff: '', kw: '', subj: '', imp: '' };");
    const n = HTML.split('(!bankFilter.imp || impOf(q) === +bankFilter.imp)').length - 1;
    expect(n).toBe(2);   // viewBank + filteredQuestions（导出 Word / 打印）
    expect(HTML).toContain("$('#fImp').onchange");
    expect(HTML).toContain("id=\"fImp\"");
  });
});
