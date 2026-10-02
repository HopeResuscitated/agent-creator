// Fake model upstream: answers every HTTP request with a deterministic body, then closes (Connection: close).
import net from 'node:net';
const port = Number(process.argv[2]);
const SIZE = Number(process.argv[3] ?? 3_000_000);
const body = Buffer.alloc(SIZE); for (let i = 0; i < SIZE; i++) body[i] = (i * 31 + 7) & 0xff;
net.createServer({ allowHalfOpen: true }, (s) => {
  let got = '';
  s.on('data', (c) => {
    got += c.toString('latin1');
    if (got.includes('\r\n\r\n')) {
      got = '\0';
      s.write(`HTTP/1.1 200 OK\r\nContent-Length: ${SIZE}\r\nConnection: close\r\n\r\n`);
      s.end(body);
    }
  });
  s.on('error', () => {});
}).listen(port, '127.0.0.1', () => console.log(`upstream ready ${port}`));
