// Model relay — runs INSIDE the AppContainer (started by evals/tools/run-in-job.ps1 as a second
// contained process). The contained agent cannot reach any host endpoint: the container's only usable
// network path is loopback to another process of the same container (and to nothing else). So the agent
// talks HTTP to 127.0.0.1:<port> here, and every byte is pumped to the trusted side's named pipe.
//
//   node model-relay.mjs <port> <pipeName> [logFile]
//
// No upstream address is accepted from the client and none is configured here: the pipe is connected to
// exactly one fixed upstream by the broker on the trusted side. This process cannot choose a destination.
import net from 'node:net';
import fs from 'node:fs';

const port = Number(process.argv[2]);
const pipeName = process.argv[3];
const logFile = process.argv[4];
if (!Number.isInteger(port) || port <= 0 || port > 65535) { console.error('relay: bad port'); process.exit(2); }
if (!pipeName) { console.error('relay: no pipe name'); process.exit(2); }
const pipePath = `\\\\.\\pipe\\${pipeName}`;
const note = (m) => { const l = `[model-relay ${Date.now()}] ${m}`; try { console.error(l); } catch { /* */ } if (logFile) { try { fs.appendFileSync(logFile, l + '\n'); } catch { /* */ } } };

let n = 0;
const server = net.createServer({ allowHalfOpen: true }, (conn) => {
  const id = ++n;
  const up = net.connect({ path: pipePath, allowHalfOpen: true });
  up.on('connect', () => note(`conn#${id} tcp -> pipe`));
  // Let pipe() propagate each side's EOF as end() on the other, so buffered bytes are flushed and a client
  // half-close still receives the full response. Tear down only on error or once a side is fully closed.
  up.on('error', (e) => { note(`conn#${id} pipe error: ${e.message}`); conn.destroy(); });
  conn.on('error', (e) => { note(`conn#${id} tcp error: ${e.message}`); up.destroy(); });
  conn.pipe(up); up.pipe(conn);
  // Client gone: nothing more can be delivered. Pipe gone: if pipe() already called conn.end(), let it flush.
  conn.on('close', () => up.destroy());
  up.on('close', () => { if (!conn.writableEnded) conn.destroy(); });
});
server.on('error', (e) => { note(`listen failed: ${e.message}`); process.exit(3); });
// 127.0.0.1 only: same-container reachability. Binding any other address would widen the surface.
server.listen(port, '127.0.0.1', () => note(`listening 127.0.0.1:${port} -> pipe ${pipePath}`));
