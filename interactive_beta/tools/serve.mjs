import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2' };
let port = Number(process.env.PORT ?? 4173);
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let target = path.resolve(root, `.${pathname}`);
    if (!target.startsWith(path.resolve(root) + path.sep) && target !== path.resolve(root)) {
      response.writeHead(403).end();
      return;
    }
    if ((await stat(target)).isDirectory()) target = path.join(target, 'index.html');
    const content = await readFile(target);
    response.writeHead(200, { 'Content-Type': types[path.extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }).end(content);
  } catch {
    response.writeHead(404).end('Not found');
  }
});
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') server.listen(++port, '127.0.0.1');
  else throw error;
});
server.on('listening', () => console.log(`Interactive reader: http://127.0.0.1:${port}/interactive/`));
server.listen(port, '127.0.0.1');