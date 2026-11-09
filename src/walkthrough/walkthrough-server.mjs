// The storyboard server, started detached by `ai1 walkthrough serve`:
//   node walkthrough-server.mjs <storyboard folder> <port> <host> <ttl milliseconds>
// Serves only the files inside the folder, writes server.json once it listens, and removes it when it
// stops (SIGTERM from `ai1 walkthrough stop` or a finished worktree, or the TTL running out).

import { createServer } from 'node:http';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';

const [storyboardPath, portText, listenHost, ttlText] = process.argv.slice(2);
const serverInfoPath = join(storyboardPath, 'server.json');
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.pdf': 'application/pdf',
};

const storyboardServer = createServer((request, response) => {
  const requestPath = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const filePath = normalize(join(storyboardPath, requestPath === '/' ? 'index.html' : requestPath));
  const isInside = filePath.startsWith(normalize(storyboardPath) + sep);
  if (!isInside || filePath.endsWith('server.json') || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    return;
  }
  response.writeHead(200, { 'content-type': CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  response.end(readFileSync(filePath));
});

function shutDown() {
  if (existsSync(serverInfoPath)) {
    try {
      if (JSON.parse(readFileSync(serverInfoPath, 'utf8')).pid === process.pid) rmSync(serverInfoPath, { force: true });
    } catch { /* a broken server.json is replaced by the next serve */ }
  }
  process.exit(0);
}

process.on('SIGTERM', shutDown);
process.on('SIGINT', shutDown);
storyboardServer.listen(Number(portText), listenHost, () => {
  const ttlMilliseconds = Number(ttlText);
  const urlHost = listenHost === '0.0.0.0' || listenHost === '::' ? 'localhost' : listenHost;
  writeFileSync(serverInfoPath, `${JSON.stringify({
    pid: process.pid, port: Number(portText), host: listenHost, url: `http://${urlHost}:${portText}/`,
    started_at: new Date().toISOString(), expires_at: new Date(Date.now() + ttlMilliseconds).toISOString(),
  }, null, 2)}\n`);
  setTimeout(shutDown, ttlMilliseconds);
});
