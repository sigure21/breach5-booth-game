import { execFile } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const HOST = process.env.HOST ?? '0.0.0.0';
const PORT = boundedPort(process.env.PORT, 4300);
const MODE = process.env.ENGINE_MODE === 'patched' ? 'patched' : 'vulnerable';
const WORKER_TOKEN = process.env.WORKER_TOKEN ?? '';
const PROOF = process.env.BREACH5_PROOF ?? '';
const PROXY_ROUTE = '/apps/builtin-code/proxy.php';

if (!/^[a-f0-9]{64}$/.test(WORKER_TOKEN)) throw new Error('WORKER_TOKEN must be 64 lowercase hex characters');
if (!/^proof_[a-f0-9]{48}$/.test(PROOF)) throw new Error('BREACH5_PROOF must match proof_<48 hex>');

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

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4_096) throw new Error('request too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function validateBody(body) {
  if (!body || typeof body.rawPath !== 'string' || typeof body.canonicalPath !== 'string') return false;
  if (!/^[a-f0-9]{16}$/.test(body.requestId ?? '')) return false;
  if (!['none', 'hide_errors', 'block_subshell', 'canonical_once', 'structured_exec'].includes(body.patchStrategy)) return false;
  if (Buffer.byteLength(body.rawPath) > 900 || body.rawPath.includes(String.fromCharCode(0)) || body.rawPath.includes('\r') || body.rawPath.includes('\n')) return false;
  return body.canonicalPath === PROXY_ROUTE;
}

function prefixFrom(path) {
  const marker = path.lastIndexOf(PROXY_ROUTE);
  if (marker === -1) throw new Error('proxy marker missing');
  return path.slice(0, marker);
}

async function executeBootstrap({ rawPath, canonicalPath, patchStrategy, requestId }) {
  if (MODE === 'patched' && patchStrategy === 'block_subshell' && rawPath.includes('$(')) {
    return {
      bootstrapTriggered: false,
      proofReached: false,
      blocked: true,
      reason: 'literal_subshell_pattern_blocked',
      workerView: 'raw request rejected by a literal pattern',
    };
  }

  const sourcePath = MODE === 'patched' && patchStrategy === 'canonical_once' ? canonicalPath : rawPath;
  const mountPrefix = prefixFrom(sourcePath);
  const logPath = `/tmp/bootstrap-${requestId}.log`;
  let trace = '';
  try {
    if (MODE === 'patched' && patchStrategy === 'structured_exec') {
      await writeFile(logPath, `${mountPrefix}\n`, { mode: 0o600, flag: 'wx' });
    } else {
      const command = `printf '%s\\n' "${mountPrefix}" > ${logPath}`;
      await execFileAsync('/bin/sh', ['-c', command], {
        cwd: '/tmp',
        env: {
          PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
          BREACH5_PROOF: PROOF,
        },
        timeout: 1_200,
        maxBuffer: 4_096,
        windowsHide: true,
      });
    }
    trace = await readFile(logPath, 'utf8');
  } finally {
    await rm(logPath, { force: true }).catch(() => {});
  }

  const proofReached = trace.includes(PROOF);
  return {
    bootstrapTriggered: true,
    proofReached,
    blocked: false,
    reason: proofReached ? 'safe_proof_reached' : 'bootstrap_completed_without_proof',
    workerView: proofReached
      ? 'raw mount prefix expanded the isolated proof value'
      : (sourcePath === canonicalPath ? 'shared canonical route reached the worker' : 'raw mount prefix was recorded without proof'),
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    return sendJson(res, 200, { ok: true, service: 'breach5-engine-worker', mode: MODE });
  }
  if (req.headers['x-worker-token'] !== WORKER_TOKEN) return sendJson(res, 404, { error: 'not found' });
  if (req.method !== 'POST' || req.url !== '/internal/bootstrap') return sendJson(res, 404, { error: 'not found' });
  let body;
  try {
    body = await readJson(req);
  } catch {
    return sendJson(res, 400, { error: 'invalid bootstrap request' });
  }
  if (!validateBody(body)) return sendJson(res, 400, { error: 'invalid bootstrap request' });
  try {
    const result = await executeBootstrap(body);
    return sendJson(res, result.blocked ? 400 : 503, result);
  } catch {
    return sendJson(res, 500, {
      bootstrapTriggered: false,
      proofReached: false,
      blocked: false,
      reason: 'bootstrap_execution_failed',
      workerView: null,
    });
  }
});

server.maxHeadersCount = 16;
server.headersTimeout = 4_000;
server.requestTimeout = 4_000;
server.keepAliveTimeout = 2_000;
server.listen(PORT, HOST, () => console.log(`breach5 ${MODE} engine worker listening on ${HOST}:${PORT}`));
