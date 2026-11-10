import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { GameStore } from './game.mjs';
import { PRODUCTION_ROUND_MS, PRODUCTION_TIMING, scaledMatchTiming } from './clock.mjs';
import { publicRaceCatalog } from './race/catalog.mjs';

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

function environmentInteger(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^[0-9]+$/.test(raw)) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
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
    wrong_match: 409,
    wrong_round: 409,
    idempotency_conflict: 409,
    solo_start_unavailable: 409,
    invalid_security_circuit: 400,
    invalid_choice: 400,
    invalid_circuit: 400,
    invalid_crew: 400,
    invalid_driver: 400,
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
  publicBaseUrl,
} = {}) {
  if (!store) throw new Error('store is required');
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
    ['/assets/cars/red-bull-racing.svg', 'assets/cars/red-bull-racing.svg', 'image/svg+xml; charset=utf-8'],
    ['/assets/cars/ferrari.svg', 'assets/cars/ferrari.svg', 'image/svg+xml; charset=utf-8'],
    ['/assets/cars/mercedes.svg', 'assets/cars/mercedes.svg', 'image/svg+xml; charset=utf-8'],
    ['/assets/cars/mclaren.svg', 'assets/cars/mclaren.svg', 'image/svg+xml; charset=utf-8'],
    ['/assets/team-cars/red-bull-rb22-2026.webp', 'assets/team-cars/red-bull-rb22-2026.webp', 'image/webp'],
    ['/assets/team-cars/ferrari-sf26-2026.webp', 'assets/team-cars/ferrari-sf26-2026.webp', 'image/webp'],
    ['/assets/team-cars/mercedes-w17-2026.webp', 'assets/team-cars/mercedes-w17-2026.webp', 'image/webp'],
    ['/assets/team-cars/mclaren-mcl40-2026.webp', 'assets/team-cars/mclaren-mcl40-2026.webp', 'image/webp'],
    ['/assets/driver-panels/max-verstappen.webp', 'assets/driver-panels/max-verstappen.webp', 'image/webp'],
    ['/assets/driver-panels/isack-hadjar.webp', 'assets/driver-panels/isack-hadjar.webp', 'image/webp'],
    ['/assets/driver-panels/charles-leclerc.webp', 'assets/driver-panels/charles-leclerc.webp', 'image/webp'],
    ['/assets/driver-panels/lewis-hamilton.webp', 'assets/driver-panels/lewis-hamilton.webp', 'image/webp'],
    ['/assets/driver-panels/george-russell.webp', 'assets/driver-panels/george-russell.webp', 'image/webp'],
    ['/assets/driver-panels/kimi-antonelli.webp', 'assets/driver-panels/kimi-antonelli.webp', 'image/webp'],
    ['/assets/driver-panels/lando-norris.webp', 'assets/driver-panels/lando-norris.webp', 'image/webp'],
    ['/assets/driver-panels/oscar-piastri.webp', 'assets/driver-panels/oscar-piastri.webp', 'image/webp'],
  ]) {
    staticFiles.set(path, { body: await readFile(`${PUBLIC_ROOT}${file}`), type });
  }

  const joinBurstLimit = Math.max(96, Math.min(192, (store.maxPlayers ?? 48) * 2));
  let joinWindowStartedAt = 0;
  let joinsInWindow = 0;
  const joinAllowed = () => {
    const now = Date.now();
    if (now - joinWindowStartedAt >= 10_000) {
      joinWindowStartedAt = now;
      joinsInWindow = 0;
    }
    joinsInWindow += 1;
    return joinsInWindow <= joinBurstLimit;
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
        const cache = url.pathname.startsWith('/assets/')
          ? { 'Cache-Control': 'public, max-age=300' }
          : {};
        return send(res, 200, file.type, file.body, cache);
      }
      if (req.method === 'GET' && url.pathname === '/favicon.ico') return send(res, 204, 'image/x-icon', '');
      if (req.method === 'GET' && url.pathname === '/healthz') {
        const clock = store.currentClock();
        return sendJson(res, 200, {
          ok: true,
          service: 'nitro-grid',
          matchId: clock.matchId,
          status: clock.phase,
        });
      }
      if (req.method === 'GET' && url.pathname === '/readyz') {
        return sendJson(res, 200, { ok: true, service: 'nitro-grid' });
      }
      if (req.method === 'GET' && url.pathname === '/api/qr.svg') {
        const svg = await QRCode.toString(joinUrl, {
          type: 'svg', margin: 1, errorCorrectionLevel: 'M',
          color: { dark: '#08121d', light: '#f4fbff' },
        });
        return send(res, 200, 'image/svg+xml; charset=utf-8', svg, { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
      }
      if (req.method === 'GET' && url.pathname === '/api/catalog') {
        return sendJson(res, 200, publicRaceCatalog(store.timing));
      }
      if (req.method === 'POST' && url.pathname === '/api/join') {
        if (!joinAllowed()) return sendJson(res, 429, { error: 'join_rate_limited' });
        const body = await jsonBody(req);
        if (!/^[a-f0-9]{32}$/.test(body.deviceId ?? '')) return sendJson(res, 400, { error: 'invalid_device_id' });
        const identity = store.join(
          bearer(req), body.deviceId, body.difficulty, body.crewId, body.driverId,
          body.securityCircuitId,
        );
        return sendJson(res, 201, identity);
      }
      if (req.method === 'POST' && url.pathname === '/api/start-with-ai') {
        await jsonBody(req);
        return sendJson(res, 200, store.startWithAi(bearer(req)));
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        return sendJson(res, 200, store.state(bearer(req)));
      }
      if (req.method === 'POST' && url.pathname === '/api/action') {
        const body = await jsonBody(req);
        const result = store.submit(bearer(req), body);
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
  const port = environmentInteger('PORT', 3000, 1, 65_535);
  const host = process.env.HOST ?? '0.0.0.0';
  const roundMs = environmentInteger('ROUND_DURATION_MS', PRODUCTION_ROUND_MS, 30_000, PRODUCTION_ROUND_MS);
  const legacyTiming = process.env.ROUND_DURATION_MS
    ? scaledMatchTiming(roundMs)
    : PRODUCTION_TIMING;
  const matchMinWaitMs = environmentInteger('MATCH_MIN_WAIT_MS', legacyTiming.minWaitMs, 250, 60_000);
  const matchMaxWaitMs = environmentInteger('MATCH_MAX_WAIT_MS', legacyTiming.maxWaitMs, 400, 90_000);
  const gridMs = environmentInteger('GRID_COUNTDOWN_MS', legacyTiming.gridMs, 100, 15_000);
  const encounterMs = environmentInteger('ENCOUNTER_DURATION_MS', legacyTiming.encounterMs, 300, 30_000);
  const minimumExposureMs = environmentInteger('MIN_ENCOUNTER_MS', legacyTiming.minimumExposureMs, 75, 30_000);
  const resultMs = environmentInteger('RESULT_DURATION_MS', legacyTiming.resultMs, 300, 60_000);
  const maxPlayers = environmentInteger('MAX_PLAYERS', 48, 4, 48);
  if (matchMaxWaitMs < matchMinWaitMs) {
    throw new Error('MATCH_MAX_WAIT_MS must be greater than or equal to MATCH_MIN_WAIT_MS');
  }
  if (minimumExposureMs > encounterMs) {
    throw new Error('MIN_ENCOUNTER_MS must not exceed ENCOUNTER_DURATION_MS');
  }
  const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? `http://127.0.0.1:${port}`;
  const seedSecret = process.env.NITRO_GRID_SEED_SECRET;
  if (seedSecret && !/^[a-f0-9]{64}$/i.test(seedSecret)) {
    throw new Error('NITRO_GRID_SEED_SECRET must be a 32-byte hexadecimal value');
  }
  const store = new GameStore({
    roundMs,
    matchMinWaitMs,
    matchMaxWaitMs,
    gridMs,
    encounterMs,
    minimumExposureMs,
    resultMs,
    maxPlayers,
    ...(seedSecret ? { seedSecret } : {}),
  });
  const server = await createGameServer({ store, publicBaseUrl });
  const ticker = setInterval(() => {
    store.tick().catch((error) => console.error(`round tick failed: ${error.message}`));
  }, Math.max(50, Math.min(250, Math.round(encounterMs / 20))));

  const shutdown = (signal) => {
    clearInterval(ticker);
    server.close(() => process.exit(signal === 'SIGTERM' ? 0 : 1));
    setTimeout(() => process.exit(1), 4_000).unref();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  server.listen(port, host, () => {
    console.log(`BREACH//5: NITRO GRID heat matchmaker listening on ${host}:${port}`);
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
