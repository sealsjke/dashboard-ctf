import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const port = Number(process.env.PORT || 3000);
const source = (process.env.SOURCE_URL || 'https://board-academy.ad.omctf.ru').replace(/\/$/, '');
const pollMs = Math.max(2000, Number(process.env.POLL_MS || 5000));
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const clients = new Set();
const sessions = new Map();
const authUser = process.env.AUTH_USER || 'smd';
const authPassword = process.env.AUTH_PASSWORD || 'kapusta666';
const sessionLifetime = 12 * 60 * 60 * 1000;
let state = { scoreboard: null, attacks: [], updatedAt: null, error: 'Ожидание данных' };
let polling = false;

function sessionToken(req) {
  return /(?:^|;\s*)omctf_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
}
function authenticated(req) {
  const token = sessionToken(req);
  const expires = token && sessions.get(token);
  if (!expires) return false;
  if (expires < Date.now()) { sessions.delete(token); return false; }
  return true;
}
function sameSecret(a, b) {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}
async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 4096) throw new Error('Слишком большой запрос');
  }
  return JSON.parse(body);
}
function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

async function getJson(route) {
  const response = await fetch(`${source}${route}`, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
  return response.json();
}

function broadcast() {
  const message = `data: ${JSON.stringify(state)}\n\n`;
  for (const client of clients) {
    if (!authenticated(client.req)) { client.end(); clients.delete(client); continue; }
    try { client.write(message); } catch { clients.delete(client); }
  }
}

async function poll() {
  if (polling) return;
  polling = true;
  try {
    const scoreboard = await getJson('/scoreboard');
    const round = scoreboard.game?.real_round || 0;
    const result = await getJson(`/public/attacks?since_round=${Math.max(0, round - 29)}&limit=5000`);
    if (!Array.isArray(scoreboard.teams) || !Array.isArray(result.attacks)) throw new Error('Неожиданный формат данных');
    state = { scoreboard, attacks: result.attacks, updatedAt: new Date().toISOString(), error: null };
  } catch (error) {
    state = { ...state, error: error.message };
    console.error('Source error:', error.message);
  } finally {
    polling = false;
    broadcast();
  }
}

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/api/login' && req.method === 'POST') {
    try {
      const { username, password } = await readBody(req);
      if (typeof username !== 'string' || typeof password !== 'string' || !sameSecret(username, authUser) || !sameSecret(password, authPassword)) {
        json(res, 401, { error: 'Неверный логин или пароль' }); return;
      }
      const token = randomBytes(32).toString('hex');
      sessions.set(token, Date.now() + sessionLifetime);
      const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      json(res, 200, { ok: true }, { 'Set-Cookie': `omctf_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}` });
    } catch { json(res, 400, { error: 'Неверный формат запроса' }); }
    return;
  }
  if (pathname === '/api/logout' && req.method === 'POST') {
    sessions.delete(sessionToken(req));
    json(res, 200, { ok: true }, { 'Set-Cookie': 'omctf_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    return;
  }
  if (pathname === '/login' || pathname === '/login.html' || pathname === '/login.js' || pathname === '/style.css' || pathname === '/login.css') {
    if (pathname === '/login' && authenticated(req)) { res.writeHead(302, { Location: '/' }); res.end(); return; }
    const file = pathname === '/login' ? '/login.html' : pathname;
    try {
      const data = await readFile(path.join(root, file));
      res.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Cache-Control': 'no-store' });
      res.end(data);
    } catch { res.writeHead(404); res.end('Not found'); }
    return;
  }
  if (!authenticated(req)) {
    if (pathname.startsWith('/api/')) json(res, 401, { error: 'Требуется вход' });
    else { res.writeHead(302, { Location: '/login' }); res.end(); }
    return;
  }
  if (pathname === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(state));
    return;
  }
  if (pathname === '/api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(state)}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  const file = pathname === '/' ? '/index.html' : pathname;
  if (!['/index.html', '/app.js', '/style.css'].includes(file)) {
    res.writeHead(404); res.end('Not found'); return;
  }
  try {
    const data = await readFile(path.join(root, file));
    res.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}).listen(port, '0.0.0.0', () => console.log(`Dashboard: http://localhost:${port}; source: ${source}`));

poll();
setInterval(poll, pollMs);
