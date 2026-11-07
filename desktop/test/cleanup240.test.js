/**
 * v2.4.0 代码清理回归
 * 覆盖：死函数/CSS/IPC 已移除、设置页「默认出题难度」已接线、字体合规文档存在
 */
import { describe, test, expect } from 'vitest';
const fs = require('fs');
const path = require('path');
const { HTML_PATH } = require('./extract-html.js');

const ROOT = path.join(path.dirname(HTML_PATH));
const HTML = fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n');
const MAIN = fs.readFileSync(path.join(ROOT, 'desktop/main.js'), 'utf8');
const PRELOAD = fs.readFileSync(path.join(ROOT, 'desktop/preload.js'), 'utf8');

describe('v2.4.0 · 死代码清理', () => {
  test('前端未使用函数已删除（pwaInstallable / kpNeighbors）', () => {
    expect(HTML).not.toContain('function pwaInstallable');
    expect(HTML).not.toContain('function kpNeighbors');
    // 相邻的活函数仍在（防止误删）
    expect(HTML).toContain('function pwaInstall()');
    expect(HTML).toContain('function kpNeighborInfo(');
  });

  test('无使用 CSS 规则已删除', () => {
    for (const c of ['.kp-chip-x', '.rev-mask', '.subj-inline', '.toc-sub', '.table-wrap']) {
      expect(HTML).not.toContain(c);
    }
    expect(HTML).not.toContain('.grid.g2');
  });

  test('调试弹窗已换成统一 toast（不再用 alert）', () => {
    expect(HTML).not.toMatch(/(^|[^\w.])alert\(/);
    expect(HTML).toContain("toast(`恢复完成：${r.banks} 个题库已还原，正在重新加载…`, 'ok')");
  });

  test('标题栏题库名不再经 window 中转', () => {
    expect(HTML).not.toContain('window.__bankTitle');
  });

  test('后端废弃接口已删除（app:getUpdateUrl / preload.isDesktop）', () => {
    expect(MAIN).not.toContain("app:getUpdateUrl");
    expect(PRELOAD).not.toContain('getUpdateUrl');
    expect(PRELOAD).not.toContain('isDesktop: true');
  });

  test('IPC 通道注册与 preload 暴露一一对应', () => {
    const ch = [...MAIN.matchAll(/ipcMain\.(?:handle|on)\(\s*'([^']+)'/g)].map(m => m[1]);
    const exposed = [...PRELOAD.matchAll(/\binvoke\(\s*'([^']+)'|ipcRenderer\.(?:send|sendSync)\(\s*'([^']+)'/g)]
      .map(m => m[1] || m[2]);
    const missing = ch.filter(c => !exposed.includes(c));
    expect(missing, '主进程注册但 preload 未暴露：' + missing.join(',')).toEqual([]);
  });
});

describe('v2.4.0 · 设置页接线与文档', () => {
  test('「默认出题难度」改动即保存（原先未绑定）', () => {
    expect(HTML).toContain("const sDiffEl = $('#sDiff');");
    expect(HTML).toContain('sDiffEl.onchange = async () => {');
    expect(HTML).toContain('state.settings.defaultDifficulty = sDiffEl.value;');
    expect(HTML).toContain("await DB.kvSet('settings', state.settings);");
  });

  test('出题页按保存的默认难度预选', () => {
    expect(HTML).toContain('${k === state.settings.defaultDifficulty ? \'selected\' : \'\'}');
  });

  test('字体/第三方资源合规说明存在并含关键结论', () => {
    const doc = fs.readFileSync(path.join(ROOT, '第三方资源与字体说明.md'), 'utf8');
    expect(doc).toContain('SIL Open Font License 1.1');
    expect(doc).toContain('LiberationSans');
    expect(doc).toContain('BSD-3-Clause');
    expect(doc).toContain('Microsoft YaHei');
  });

  test('主进程头部有 IPC 通道索引', () => {
    expect(MAIN).toContain('IPC 通道索引');
    expect(MAIN).toContain('新增通道时必须同步三处');
  });
});
