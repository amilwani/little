// Serves the web app like Apps Script does, with google.script.run bridged to the fake services.
const http = require('http');
const G = require('./gas');
const SHIM = `<script>
window.google = { script: { run: (function make(ok, bad) {
  return new Proxy({}, { get(_, name) {
    if (name === 'withSuccessHandler') return (f) => make(f, bad);
    if (name === 'withFailureHandler') return (f) => make(ok, f);
    return (...args) => { fetch('/rpc', { method: 'POST', headers: { 'content-type': 'application/json', 'x-user': window.__user || '' }, body: JSON.stringify({ fn: name, args }) })
      .then((r) => r.json()).then((d) => { setTimeout(() => d.error ? (bad && bad(new Error(d.error))) : (ok && ok(d.result)), window.__latency || 30); }); };
  } });
})() } };
</script>`;
http.createServer((req, res) => {
  if (req.url.startsWith('/rpc')) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const { fn, args } = JSON.parse(body);
      let out;
      try { out = { result: G.call(fn, args, req.headers['x-user'] || 'aman@example.com') }; }
      catch (e) { out = { error: 'Exception: ' + e.message }; if (!/NEED_KEY|rejected|doesn't look|xoxp|Write|Add|Type|There/.test(e.message)) console.error('RPC', fn, e.stack); }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(out));
    });
    return;
  }
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/top') {
    // Like script.google.com: the app runs in a sandboxed iframe on another origin.
    res.setHeader('content-type', 'text/html');
    return res.end('<!doctype html><body style="margin:0"><iframe id="f" style="border:0;width:100vw;height:100vh" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads" ' + (u.searchParams.get('mic') ? 'allow="microphone"' : '') + ' src="http://127.0.0.1:8787/app"></iframe></body>');
  }
  const html = G.call('doGet', [{ parameter: Object.fromEntries(u.searchParams) }], 'aman@example.com');
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(html.replace('<head>', '<head>' + SHIM));
}).listen(8787, () => console.log('ui on 8787'));
