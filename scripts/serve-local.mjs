// Local preview only: node scripts/serve-local.mjs. No credentials are generated.
// Optional browser-visible runtime config: ignored .secrets/web-runtime.json.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';
import { validateRuntimeConfig } from '../webBridge/src/config.mjs';

const root = resolve(import.meta.dirname, '..');
const assets = resolve(root, 'composeApp/build/dist/wasmJs/productionExecutable');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.ttf': 'font/ttf', '.txt': 'text/plain' };
const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/config.json') {
      const config = validateRuntimeConfig(JSON.parse(await readFile(resolve(root, '.secrets/web-runtime.json'), 'utf8')));
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(config)); return;
    }
    const file = resolve(assets, `.${pathname === '/' ? '/index.html' : pathname}`);
    const inside = relative(assets, file);
    if (inside.startsWith('..') || inside.includes(':') || !(await stat(file)).isFile()) throw new Error();
    response.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream');
    response.end(request.method === 'HEAD' ? undefined : await readFile(file));
  } catch { response.writeHead(404).end('Not found'); }
});
server.listen(8081, '127.0.0.1', () => console.log('KumaLingo local preview: http://127.0.0.1:8081'));
