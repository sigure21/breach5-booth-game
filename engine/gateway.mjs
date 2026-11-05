import { randomBytes } from 'node:crypto';
import http from 'node:http';

const HOST = process.env.HOST ?? '0.0.0.0';
const PORT = boundedPort(process.env.PORT, 4100);
const MODE = process.env.ENGINE_MODE === 'patched' ? 'patched' : 'vulnerable';
const ENGINE_TOKEN = process.env.ENGINE_TOKEN ?? '';
const WORKER_TOKEN = process.env.WORKER_TOKEN ?? '';
const WORKER_HOST = process.env.WORKER_HOST ?? '127.0.0.1';
const WORKER_PORT = boundedPort(process.env.WORKER_PORT, 4300);
const PROXY_ROUTE = '/apps/builtin-code/proxy.php';
const PATCHES = new Set(['hide_errors', 'block_subshell', 'canonical_once', 'structured_exec']);

if (!/^[a-f0-9]{64}$/.test(ENGINE_TOKEN)) throw new Error('ENGINE_TOKEN must be 64 lowercase hex characters');
if (!/^[a-f0-9]{64}$/.test(WORKER_TOKEN)) throw new Error('WORKER_TOKEN must be 64 lowercase hex characters');

function boundedPort(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : fallback;
}

function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.length),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function rawPathOf(target) { return (target ?? '/').split('?', 1)[0]; }

export function canonicalRoute(rawPath) {
  let decoded;
  try { decoded = decodeURIComponent(rawPath); } catch { return null; }
  if ([...decoded].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return null;
  const stack = [];
  for (const segment of decoded.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') { stack.pop(); continue; }
    stack.push(segment);
  }
  return `/${stack.join('/')}`;
}

function workerRequest(payload) {
  const body = Buffer.from(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: WORKER_HOST,
      port: WORKER_PORT,
      method: 'POST',
      path: '/internal/bootstrap',
      timeout: 2_000,
      headers: {
        'X-Worker-Token': WORKER_TOKEN,
        'Content-Type': 'application/json',
        'Content-Length': String(body.length),
        Connection: 'close',
      },
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size <= 8_192) chunks.push(chunk);
      });
      response.on('end', () => {
        if (size > 8_192) return reject(new Error('worker response too large'));
        try {
          resolve({ status: response.statusCode ?? 502, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        } catch {
          reject(new Error('invalid worker response'));
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('worker timeout')));
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function workerReady() {
  return new Promise((resolve) => {
    const request = http.request({
      host: WORKER_HOST,
      port: WORKER_PORT,
      method: 'GET',
      path: '/healthz',
      timeout: 1_200,
      headers: { Connection: 'close' },
    }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode === 200));
    });
    request.on('timeout', () => { request.destroy(); resolve(false); });
    request.on('error', () => resolve(false));
    request.end();
  });
}

function validWorkerVerdict(body) {
  return body
    && ['bootstrapTriggered', 'proofReached', 'blocked'].every((field) => typeof body[field] === 'boolean')
    && typeof body.reason === 'string'
    && (body.workerView === null || typeof body.workerView === 'string');
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    const ready = await workerReady();
    return sendJson(res, ready ? 200 : 503, { ok: ready, service: 'breach5-engine-gateway', mode: MODE });
  }
  if (req.headers['x-engine-token'] !== ENGINE_TOKEN) return sendJson(res, 404, { error: 'not found' });
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });

  const rawPath = rawPathOf(req.url);
  if (Buffer.byteLength(rawPath) > 900 || rawPath.includes(String.fromCharCode(0)) || rawPath.includes('\r') || rawPath.includes('\n')) {
    return sendJson(res, 400, { error: 'invalid request target' });
  }
  const route = canonicalRoute(rawPath);
  if (!route) return sendJson(res, 400, { error: 'invalid request target' });
  if (route !== PROXY_ROUTE) {
    return sendJson(res, 404, {
      routeAccepted: false,
      bootstrapTriggered: false,
      proofReached: false,
      blocked: false,
      reason: 'canonical_route_not_allowed',
      gatewayView: route,
      workerView: null,
    });
  }

  const requestedPatch = String(req.headers['x-patch-strategy'] ?? 'none');
  const patchStrategy = MODE === 'patched' && PATCHES.has(requestedPatch) ? requestedPatch : 'none';
  const requestId = randomBytes(8).toString('hex');
  try {
    const worker = await workerRequest({ rawPath, canonicalPath: route, patchStrategy, requestId });
    if (![400, 503].includes(worker.status) || !validWorkerVerdict(worker.body)) {
      throw new Error('invalid worker verdict');
    }
    return sendJson(res, worker.status, {
      routeAccepted: true,
      bootstrapTriggered: worker.body.bootstrapTriggered === true,
      proofReached: worker.body.proofReached === true,
      blocked: worker.body.blocked === true,
      reason: typeof worker.body.reason === 'string' ? worker.body.reason : 'worker_result',
      gatewayView: route,
      workerView: typeof worker.body.workerView === 'string' ? worker.body.workerView : null,
    });
  } catch {
    return sendJson(res, 502, {
      routeAccepted: true,
      bootstrapTriggered: false,
      proofReached: false,
      blocked: false,
      reason: 'worker_unavailable',
      gatewayView: route,
      workerView: null,
    });
  }
});

server.maxHeadersCount = 20;
server.headersTimeout = 4_000;
server.requestTimeout = 4_000;
server.keepAliveTimeout = 2_000;
server.listen(PORT, HOST, () => console.log(`breach5 ${MODE} engine gateway listening on ${HOST}:${PORT}`));
