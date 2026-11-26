// Local server: `npm run dev`. Serves the page and runs api/room.js the way Vercel
// does, so you can play without deploying. Phones on the same Wi-Fi can join using
// the network address it prints. With Redis keys in .env.local (get them with
// `npx vercel env pull .env.local`) it uses that database; without them it keeps
// rooms in memory, which needs no setup but forgets them when it stops.

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

// Load .env.local before the handler reads process.env.
const envFile = join(root, '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
// Same names api/room.js looks for.
const hasRedis = ['URL', 'TOKEN'].every((end) =>
  Object.keys(process.env).some((k) => k.endsWith(`KV_REST_API_${end}`) || k.endsWith(`REDIS_REST_${end}`)));
if (!hasRedis) process.env.NOGGIN_MEMORY = '1';

const { default: handler } = await import('../api/room.js');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const PUBLIC = new Set(['index.html', 'app.js', 'decks.js', 'style.css']);

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/api/room') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
    // The two helpers Vercel adds to res that the handler uses.
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (data) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); return res; };
    try {
      await handler(req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.status(500).json({ error: 'Local server error. See the terminal.' });
    }
    return;
  }

  const file = normalize(url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
  const path = join(root, file);
  if (!PUBLIC.has(file) || !existsSync(path) || !statSync(path).isFile()) {
    res.statusCode = 404;
    return res.end('Not found');
  }
  res.setHeader('Content-Type', TYPES[extname(path)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.end(readFileSync(path));
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Noggin is running:\n  this computer:  http://localhost:${PORT}`);
  for (const nets of Object.values(networkInterfaces())) {
    for (const n of nets || []) {
      if (n.family === 'IPv4' && !n.internal) console.log(`  phones (Wi-Fi): http://${n.address}:${PORT}`);
    }
  }
  console.log(hasRedis
    ? 'Rooms are stored in your Redis database.'
    : 'Rooms are kept in memory: no setup needed, and they\'re gone when this stops.');
  console.log('Press Ctrl+C to stop.');
});
