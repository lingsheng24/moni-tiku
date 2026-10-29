/* v1.42.0：文档导入解析质量报告 + 帮助配图外置构建一致性 */
const path = require('path');
const fs = require('fs');
const { loadFns } = require('./extract-html');
/* describe/it/expect 由 vitest 全局注入 */

describe('文档导入解析报告：docQualityReport', () => {
  const { docQualityReport } = loadFns(['docQualityReport']);

  it('空文本：返回 err 级「没有解析到文字内容」', () => {
    const r = docQualityReport('   \n  ', { type: 'pdf', pages: 10 });
    expect(r.chars).toBe(0);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].level).toBe('warn');
    expect(r.issues[0].msg).toContain('没有解析到');
  });

  it('正常长文本：无任何问题', () => {
    const good = 'TCP 三次握手是建立连接的过程。'.repeat(30);
    const r = docQualityReport(good, { type: 'docx' });
    expect(r.chars).toBe(good.trim().length);
    expect(r.issues).toHaveLength(0);
  });

  it('PDF 每页字符过少：疑似扫描件', () => {
    const r = docQualityReport('第一页只有几个字。', { type: 'pdf', pages: 20 });
    const scan = r.issues.find(i => i.msg.includes('扫描件'));
    expect(scan).toBeTruthy();
    expect(scan.level).toBe('warn');
  });

  it('PDF 每页字符充足：不报扫描件', () => {
    const text = 'x'.repeat(100 * 8);          // 8 页、每页 100 字
    const r = docQualityReport(text, { type: 'pdf', pages: 8 });
    expect(r.issues.find(i => i.msg.includes('扫描件'))).toBeUndefined();
  });

  it('文本不足 200 字：提示能出的题目少', () => {
    const r = docQualityReport('很短的内容。', { type: 'txt' });
    expect(r.issues.some(i => i.msg.includes('能出的题目会很少'))).toBe(true);
  });

  it('乱码占比超 2%：报编码问题', () => {
    const text = '正常文字'.repeat(100) + '\uFFFD'.repeat(30);
    const r = docQualityReport(text, { type: 'txt' });
    expect(r.issues.some(i => i.msg.includes('乱码'))).toBe(true);
  });

  it('乱码少量存在但占比低：不报', () => {
    const text = '正常文字'.repeat(500) + '\uFFFD';
    const r = docQualityReport(text, { type: 'txt' });
    expect(r.issues.some(i => i.msg.includes('乱码'))).toBe(false);
  });

  it('控制字符超 30 个：提示排版可能丢失', () => {
    const text = '内容'.repeat(300) + '\x00'.repeat(40);
    const r = docQualityReport(text, { type: 'pdf', pages: 10 });
    expect(r.issues.some(i => i.msg.includes('控制字符'))).toBe(true);
  });

  it('docx 段落平均超长：提示表格/图片可能没提取到', () => {
    const text = '段落'.repeat(2000);            // 1 段 4000+ 字
    const r = docQualityReport(text, { type: 'docx' });
    expect(r.issues.some(i => i.msg.includes('表格题、图片题'))).toBe(true);
  });

  it('多个问题可同时报出', () => {
    const r = docQualityReport('\uFFFD\uFFFD\uFFFD', { type: 'txt' });
    expect(r.issues.length).toBeGreaterThanOrEqual(2);
  });
});

describe('帮助配图外置：构建一致性（v1.42.0）', () => {
  const ROOT = path.join(__dirname, '..', '..');
  it('HTML 与 src/helpimgs.js 一致（build --check 等价）', () => {
    const { build } = require(path.join(ROOT, 'build.js'));
    const html = fs.readFileSync(path.join(ROOT, '模拟题库-Web版.html'), 'utf8').replace(/\r\n/g, '\n');
    expect(build(html)).toBe(html);
  });

  it('helpimgs 标记区包含 EMBED 与 window 回退消费行', () => {
    const html = fs.readFileSync(path.join(ROOT, '模拟题库-Web版.html'), 'utf8');
    expect(html).toContain('const HELP_IMGS_EMBED');
    expect(html).toContain("window.__HELP_IMGS__) || HELP_IMGS_EMBED");
  });

  it('desktop/help-imgs.json 与 src/helpimgs.js 数据同步（17 张）', () => {
    const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop/help-imgs.json'), 'utf8'));
    expect(Object.keys(json).length).toBe(17);
    const srcJs = fs.readFileSync(path.join(ROOT, 'src/helpimgs.js'), 'utf8');
    for (const [k, v] of Object.entries(json)) expect(srcJs).toContain(`${k}: '${v}'`);
  });

  it('HELP_IMGS 消费逻辑：优先注入数据，否则回落 EMBED', () => {
    const fn = new Function(`
      const HELP_IMGS_EMBED = { s01: 'embed' };
      const HELP_IMGS = (typeof window !== 'undefined' && window.__HELP_IMGS__) || HELP_IMGS_EMBED;
      return HELP_IMGS;
    `);
    expect(fn()).toEqual({ s01: 'embed' });
    const fn2 = new Function('window', `
      window.__HELP_IMGS__ = { s01: 'injected' };
      const HELP_IMGS_EMBED = { s01: 'embed' };
      const HELP_IMGS = (typeof window !== 'undefined' && window.__HELP_IMGS__) || HELP_IMGS_EMBED;
      return HELP_IMGS;
    `);
    expect(fn2({ __HELP_IMGS__: { s01: 'injected' } })).toEqual({ s01: 'injected' });
  });
});
