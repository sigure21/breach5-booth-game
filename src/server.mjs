import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import {
  AdjudicatorRegistry,
  ProxyPanicAdjudicator,
  SessionHeistAdjudicator,
} from './adjudicator.mjs';
import { GameStore } from './game.mjs';
import { DIFFICULTIES, publicCatalog } from './scenarios/index.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PUBLIC_ROOT = fileURLToPath(new URL('./public/', import.meta.url));
const SECURITY_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
});

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function bearer(req) {
  const value = req.headers.authorization ?? '';
  return value.startsWith('Bearer ') ? value.slice(7) : null;
}

async function jsonBody(req, maxBytes = 4_096) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('request too large'), { code: 'too_large' });
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('invalid json'), { code: 'invalid_json' }); }
}

function send(res, status, type, value, extra = {}) {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(value ?? '', 'utf8');
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': type,
    'Content-Length': String(body.length),
    ...extra,
  });
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(value));
}

function statusFor(error) {
  return {
    unauthorized: 401,
    capacity: 429,
    phase_closed: 409,
    choice_locked: 409,
    wrong_round: 409,
    invalid_choice: 400,
    invalid_scenario: 400,
    invalid_difficulty: 400,
    invalid_action_id: 400,
    invalid_json: 400,
    too_large: 413,
  }[error?.code] ?? 500;
}

function publicError(error) {
  const status = statusFor(error);
  return { status, body: { error: status === 500 ? 'internal_error' : error.code } };
}

export async function createGameServer({
  store,
  adjudicator,
  publicBaseUrl,
} = {}) {
  if (!store || !adjudicator) throw new Error('store and adjudicator are required');
  const publicBase = new URL(publicBaseUrl);
  if (!['http:', 'https:'].includes(publicBase.protocol) || publicBase.username || publicBase.password) {
    throw new Error('publicBaseUrl must be an http(s) URL without credentials');
  }
  const joinUrl = new URL('/play', publicBase).toString();
  const staticFiles = new Map();
  for (const [path, file, type] of [
    ['/play', 'play.html', 'text/html; charset=utf-8'],
    ['/join', 'play.html', 'text/html; charset=utf-8'],
    ['/screen', 'screen.html', 'text/html; charset=utf-8'],
    ['/assets/app.css', 'app.css', 'text/css; charset=utf-8'],
    ['/assets/play.js', 'play.js', 'application/javascript; charset=utf-8'],
    ['/assets/screen.js', 'screen.js', 'application/javascript; charset=utf-8'],
  ]) {
    staticFiles.set(path, { body: await readFile(`${PUBLIC_ROOT}${file}`), type });
  }

  let joinWindowStartedAt = 0;
  let joinsInWindow = 0;
  const joinAllowed = () => {
    const now = Date.now();
    if (now - joinWindowStartedAt >= 10_000) {
      joinWindowStartedAt = now;
      joinsInWindow = 0;
    }
    joinsInWindow += 1;
    return joinsInWindow <= 24;
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://local.invalid');
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(302, { ...SECURITY_HEADERS, Location: '/screen', 'Content-Length': '0' });
        return res.end();
      }
      if (req.method === 'GET' && staticFiles.has(url.pathname)) {
        const file = staticFiles.get(url.pathname);
        return send(res, 200, file.type, file.body);
      }
      if (req.method === 'GET' && url.pathname === '/favicon.ico') return send(res, 204, 'image/x-icon', '');
      if (req.method === 'GET' && url.pathname === '/healthz') {
        return sendJson(res, 200, { ok: true, service: 'breach5-game', round: store.currentClock().roundId });
      }
      if (req.method === 'GET' && url.pathname === '/readyz') {
        const ready = await adjudicator.ready().catch(() => false);
        return sendJson(res, ready ? 200 : 503, { ok: ready, service: 'breach5-game' });
      }
      if (req.method === 'GET' && url.pathname === '/api/qr.svg') {
        const svg = await QRCode.toString(joinUrl, {
          type: 'svg', margin: 1, errorCorrectionLevel: 'M',
          color: { dark: '#08121d', light: '#f4fbff' },
        });
        return send(res, 200, 'image/svg+xml; charset=utf-8', svg, { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
      }
      if (req.method === 'GET' && url.pathname === '/api/catalog') {
        return sendJson(res, 200, { scenarios: publicCatalog(), difficulties: DIFFICULTIES });
      }
      if (req.method === 'POST' && url.pathname === '/api/join') {
        if (!joinAllowed()) return sendJson(res, 429, { error: 'join_rate_limited' });
        const body = await jsonBody(req);
        if (!/^[a-f0-9]{32}$/.test(body.deviceId ?? '')) return sendJson(res, 400, { error: 'invalid_device_id' });
        const identity = store.join(bearer(req), body.deviceId, body.scenarioId, body.difficulty);
        return sendJson(res, 201, identity);
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        return sendJson(res, 200, store.state(bearer(req)));
      }
      if (req.method === 'POST' && url.pathname === '/api/action') {
        const body = await jsonBody(req);
        const result = store.submit(bearer(req), body);
        return sendJson(res, 200, result);
      }
      if (req.method === 'POST' && url.pathname === '/api/preview') {
        const body = await jsonBody(req);
        const result = store.preview(bearer(req), body);
        return sendJson(res, 200, result);
      }
      if (req.method === 'GET' && url.pathname === '/api/screen-state') {
        return sendJson(res, 200, { ...store.screenState(), joinUrl });
      }
      return sendJson(res, 404, { error: 'not_found' });
    } catch (error) {
      const safe = publicError(error);
      return sendJson(res, safe.status, safe.body);
    }
  });

  server.maxHeadersCount = 32;
  server.headersTimeout = 6_000;
  server.requestTimeout = 8_000;
  server.keepAliveTimeout = 4_000;
  return server;
}

async function main() {
  const port = boundedInteger(process.env.PORT, 3000, 1, 65_535);
  const host = process.env.HOST ?? '0.0.0.0';
  const roundMs = boundedInteger(process.env.ROUND_DURATION_MS, 180_000, 3_000, 180_000);
  const maxPlayers = boundedInteger(process.env.MAX_PLAYERS, 16, 1, 16);
  const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? `http://127.0.0.1:${port}`;
  const adjudicator = new AdjudicatorRegistry(new Map([
    ['proxy-panic', new ProxyPanicAdjudicator()],
    ['session-heist', new SessionHeistAdjudicator()],
  ]));
  const store = new GameStore({ adjudicators: adjudicator, roundMs, maxPlayers, epochMs: Date.now() });
  const server = await createGameServer({ store, adjudicator, publicBaseUrl });
  const ticker = setInterval(() => {
    store.tick().catch((error) => console.error(`round tick failed: ${error.message}`));
  }, Math.max(100, Math.min(500, Math.round(roundMs / 600))));

  const shutdown = (signal) => {
    clearInterval(ticker);
    server.close(() => process.exit(signal === 'SIGTERM' ? 0 : 1));
    setTimeout(() => process.exit(1), 4_000).unref();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  server.listen(port, host, () => {
    console.log(`BREACH//5 coordinator listening on ${host}:${port}`);
    console.log(`participant: ${publicBaseUrl.replace(/\/$/, '')}/play`);
    console.log(`screen:      ${publicBaseUrl.replace(/\/$/, '')}/screen`);
  });
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`startup failed in ${ROOT}: ${error.message}`);
    process.exit(1);
  });
}
