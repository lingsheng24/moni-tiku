/* 验证 v1.42.0 帮助配图外置链路：连打包版 CDP，检查注入数据与帮助页图片渲染
 * 用法：先以 MTK_DEBUG_PORT=9344 启动打包版，再 node desktop/验证-配图注入.js
 * 注意：用 http 直连 127.0.0.1（环境有 HTTP_PROXY，fetch 会走代理导致失败）。 */
const http = require('http');
const PORT = 9344;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = path => new Promise((resolve, reject) => {
  http.get({ hostname: '127.0.0.1', port: PORT, path, timeout: 5000 }, res => {
    let b = ''; res.on('data', c => b += c);
    res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
  }).on('error', reject).on('timeout', function () { this.destroy(); reject(new Error('timeout')); });
});
(async () => {
  let list = null;
  for (let i = 0; i < 20; i++) {
    try { list = await getJson('/json/list'); if (list && list.length) break; } catch (e) { }
    await sleep(500);
  }
  const page = (list || []).find(t => t.type === 'page');
  if (!page) throw new Error('找不到页面（调试端口未就绪）');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id;
    const h = ev => {
      const m = JSON.parse(ev.data);
      if (m.id === i) { ws.removeEventListener('message', h); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); }
    };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evalJs = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '页面脚本异常');
    return r.result && r.result.value;
  };
  await send('Runtime.enable');
  const inject = await evalJs(`({ injected: !!(window.__HELP_IMGS__), keys: window.__HELP_IMGS__ ? Object.keys(window.__HELP_IMGS__).length : 0 })`);
  console.log('preload 注入:', JSON.stringify(inject));
  console.log('页面版本:', await evalJs(`APP_VER`));
  await evalJs(`go('help')`);
  await sleep(2500);
  const imgs = await evalJs(`[...document.querySelectorAll('.help-shot img')].map(i => i.complete && i.naturalWidth > 0)`);
  console.log('帮助页配图渲染:', imgs.filter(Boolean).length + '/' + imgs.length);
  ws.close();
  const ok = inject.injected && inject.keys === 17 && imgs.length > 0 && imgs.every(Boolean);
  console.log(ok ? '✅ 链路正常（注入 17 张 + 页面全渲染）' : '❌ 链路异常');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
