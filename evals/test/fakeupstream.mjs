// fakeupstream.mjs - a stand-in model upstream for suite.sh lifecycle tests (evals/test/suite-midrun.sh). Not a model:
// it lets a REAL contained suite run (meter, watchdog, broker, wrapper, pinned jcode) proceed without Ollama inference.
//   node evals/test/fakeupstream.mjs <port> <mode> [<pidfile>]
// Listens on 127.0.0.1:<port> only. /api/generate (suite.sh's warm-up) -> {"response":"ok","done":true}.
// /v1/chat/completions: mode "hang" = 200 + headers, then nothing (the agent waits on the model);
//                       mode "done" = one short complete answer with no tool call (the agent ends; the task FAILs).
// Everything else 404. Each request is logged to stdout as one line.
import http from 'node:http';
import fs from 'node:fs';
const [port, mode, pidfile] = [Number(process.argv[2]), process.argv[3], process.argv[4]];
if (!port || !['hang', 'done'].includes(mode)) { console.error('usage: fakeupstream.mjs <port> <hang|done> [pidfile]'); process.exit(2); }
const chunk = (delta, finish = null) => `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', model: 'hermes-local-32k', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
const held = new Set();
http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => { body += d; });
  req.on('end', () => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url} ${body.length}B`);
    if (req.url.startsWith('/api/generate')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"model":"hermes-local-32k","response":"ok","done":true}'); return; }
    if (req.url.startsWith('/v1/chat/completions')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (mode === 'hang') { held.add(res); res.on('close', () => held.delete(res)); return; }
      res.end(chunk({ role: 'assistant', content: 'I cannot do this task.' }) + chunk({}, 'stop') + 'data: [DONE]\n\n'); return;
    }
    res.writeHead(404); res.end();
  });
}).listen(port, '127.0.0.1', () => { if (pidfile) fs.writeFileSync(pidfile, String(process.pid)); console.log(`fakeupstream ${mode} on 127.0.0.1:${port}`); });
