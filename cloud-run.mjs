import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const assetRoot = join(root, 'dist', 'client');
const handler = (await import('./dist/server/index.js')).default;
const types = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

async function assetResponse(request) {
  const pathname = new URL(request.url).pathname;
  const target = normalize(join(assetRoot, pathname.replace(/^\/+/, '')));
  if (!target.startsWith(assetRoot) || target === assetRoot) return null;
  try {
    const body = await readFile(target);
    return new Response(request.method === 'HEAD' ? null : body, { headers: { 'content-type': types[extname(target)] ?? 'application/octet-stream', 'cache-control': pathname.startsWith('/_next/static/') ? 'public,max-age=31536000,immutable' : 'public,max-age=300' } });
  } catch { return null; }
}

const assets = { fetch: assetResponse };
async function writeResponse(response, outgoing) {
  outgoing.statusCode = response.status;
  response.headers.forEach((value, key) => outgoing.setHeader(key, value));
  if (!response.body) return outgoing.end();
  const reader = response.body.getReader();
  while (true) { const chunk = await reader.read(); if (chunk.done) break; outgoing.write(Buffer.from(chunk.value)); }
  outgoing.end();
}

const server = createServer(async (incoming, outgoing) => {
  try {
    const host = incoming.headers.host ?? `127.0.0.1:${process.env.PORT ?? 8080}`;
    const request = new Request(`http://${host}${incoming.url ?? '/'}`, { method: incoming.method, headers: incoming.headers, body: ['GET', 'HEAD'].includes(incoming.method ?? 'GET') ? undefined : incoming, duplex: 'half' });
    const staticAsset = await assetResponse(request);
    if (staticAsset) return writeResponse(staticAsset, outgoing);
    const response = await handler.fetch(request, { ASSETS: assets }, {});
    await writeResponse(response, outgoing);
  } catch (error) {
    console.error(error);
    outgoing.statusCode = 500;
    outgoing.end('Internal server error');
  }
});
server.listen(Number(process.env.PORT ?? 8080), '0.0.0.0', () => console.log(`Gamba League listening on ${process.env.PORT ?? 8080}`));
