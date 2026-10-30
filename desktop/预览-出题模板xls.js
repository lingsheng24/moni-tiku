/* 生成出题模板 Excel 版示例文件（与 exportQTemplate xls 分支同构）——给军哥预览格式用 */
const fs = require('fs');
const path = require('path');
const TYPES = { single_choice: '单选题', multiple_choice: '多选题', true_false: '判断题', fill_blank: '填空题', short_answer: '简答题' };
const types = Object.keys(TYPES);
const rows = 10;
const exRows = [
  { type: '单选题', diff: '简单', kp: '示例知识点', imp: 3, content: '空气中含量最多的气体是？', opts: ['氧', '氮', '碳', '氢'], ans: 'B', exp: '空气中氮气约占 78%' },
  { type: '多选题', diff: '中等', kp: '示例知识点', imp: 4, content: '下列属于可再生能源的是？', opts: ['太阳能', '风能', '煤炭', '水能'], ans: 'ABD', exp: '煤炭是不可再生能源' },
  { type: '判断题', diff: '简单', kp: '示例知识点', imp: 2, content: '空气中氧气含量高于氮气。', opts: [], ans: '错', exp: '氮气约 78%，氧气约 21%' },
  { type: '填空题', diff: '中等', kp: '示例知识点', imp: 3, content: '水的化学式是____。', opts: [], ans: 'H₂O', exp: '两个氢原子、一个氧原子' },
  { type: '简答题', diff: '困难', kp: '示例知识点', imp: 5, content: '简述光合作用的意义。', opts: [], ans: '（此处填写参考答案文字）', exp: '把光能转化为化学能，维持大气氧气含量' },
];
const th = 'border:1px solid #999;padding:4px 6px;background:#f0f0f0;font-weight:bold;text-align:center';
const td = 'border:1px solid #999;padding:4px 6px;vertical-align:top';
const tdC = td + ';text-align:center';
const tdEx = td + ';background:#FAEEDA';
const tdExC = tdC + ';background:#FAEEDA';
const head = ['序号', '题型', '难度', '知识点', '重要程度', '题干', '选项A', '选项B', '选项C', '选项D', '答案', '解析'];
let body = `<tr>${head.map(h => `<td style="${th}">${h}</td>`).join('')}</tr>`;
exRows.forEach((r, i) => {
  body += `<tr><td style="${tdExC}">${i + 1}</td>`
    + `<td style="${tdEx}">${r.type}</td><td style="${tdEx}">${r.diff}</td>`
    + `<td style="${tdEx}">${r.kp}</td><td style="${tdExC}">${r.imp}</td>`
    + `<td style="${tdEx}">${r.content}</td>`
    + [0, 1, 2, 3].map(k => `<td style="${tdEx}">${r.opts[k] || ''}</td>`).join('')
    + `<td style="${tdExC}">${r.ans}</td><td style="${tdEx}">${r.exp}</td></tr>`;
});
for (let i = 0; i < rows; i++) {
  body += `<tr><td style="${tdC}">${exRows.length + i + 1}</td>`
    + Array(11).fill(0).map(() => `<td style="${td}">&nbsp;</td>`).join('') + '</tr>';
}
const typeNames = types.map(t => TYPES[t]).join(' / ');
const headXml = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><title>出题模板</title>
      <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
        <x:Name>题目模板</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
      </x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
    </head><body>`;
const html = headXml + `
    <h2 style="text-align:center">模拟题库 · 题目批量录入模板</h2>
    <p style="font-size:12px;color:#555;line-height:1.8">
      <b>填写说明：</b><br>
      ① <b>题型</b>填：${typeNames}；<b>难度</b>填：简单 / 中等 / 困难（留空按「中等」处理）。<br>
      ② <b>重要程度</b>填 1~5：1 了解 · 2 一般 · 3 较重要 · 4 重要 · 5 核心（留空按 3 处理）。<br>
      ③ <b>答案</b>：单选题填字母（如 B）；多选题连填（如 ABD）；判断题填「对 / 错」；填空、简答题直接填文字答案。<br>
      ④ <b>选项列</b>：判断题、填空题、简答题留空即可；单选 / 多选题按 A~D 顺序填写（不足四项留空）。<br>
      ⑤ <b>知识点</b>填该题归属的知识点名称，可留空；<b>解析</b>建议填写，便于复习。
    </p>
    <table style="border-collapse:collapse;width:100%;font-size:12px">${body}</table>
    <p style="font-size:12px;color:#888">浅黄底行为格式示例，正式使用时可覆盖或删除；「&nbsp;」占位空单元格可正常填写。</p>
  </body></html>`;
const dir = path.join(__dirname, '..');
fs.writeFileSync(path.join(dir, '出题模板_预览.xls'), '\ufeff' + html);
fs.writeFileSync(path.join(dir, '出题模板_预览_excel.html'), html.replace(/<html[^>]*>/, '<html><body style="font-family:sans-serif;max-width:1000px;margin:20px auto">').replace('<![endif]-->', ''));
console.log('已生成：出题模板_预览.xls / 出题模板_预览_excel.html');
