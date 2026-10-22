// 안드로이드 앱의 웹뷰(디버그 빌드)에 연결해 자바스크립트 식을 실행하고 결과를 JSON으로 출력한다.
// 사용: adb forward tcp:9222 localabstract:webview_devtools_remote_<pid> 한 뒤  node tests/cdp.mjs "window.__app.state()"
const expr = process.argv[2];
const port = process.env.CDP_PORT || 9222;
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = list.find((t) => t.type === 'page' && /^https?:\/\/localhost/.test(t.url)) || list.find((t) => t.type === 'page');
if (!page) { console.error('웹뷰 페이지를 찾지 못했어요'); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('websocket error')); });
const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('timeout')), 120000);
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id === 1) { clearTimeout(timer); resolve(d); }
  };
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: { expression: `(async () => JSON.stringify(await (${expr})))()`, awaitPromise: true, returnByValue: true },
  }));
});
ws.close();
if (result.result.exceptionDetails) {
  console.error(JSON.stringify(result.result.exceptionDetails).slice(0, 500));
  process.exit(1);
}
console.log(result.result.result.value);
