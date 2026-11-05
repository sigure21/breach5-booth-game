import http from 'node:http';
import { buildAttackPath, rawHttpPreview } from './scenario.mjs';

const MAX_ENGINE_RESPONSE = 8_192;

function boundedPort(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : fallback;
}

function engineRequest({ host, port, token, path, patch = 'none' }) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host,
      port,
      method: 'GET',
      path,
      timeout: 2_500,
      headers: {
        'X-Engine-Token': token,
        'X-Patch-Strategy': patch,
        Connection: 'close',
      },
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size <= MAX_ENGINE_RESPONSE) chunks.push(chunk);
      });
      response.on('end', () => {
        if (size > MAX_ENGINE_RESPONSE) return reject(new Error('engine response too large'));
        const text = Buffer.concat(chunks).toString('utf8');
        let body = {};
        try { body = JSON.parse(text); } catch { body = { error: 'invalid engine response' }; }
        resolve({ status: response.statusCode ?? 502, body });
      });
    });
    request.on('timeout', () => request.destroy(new Error('engine timeout')));
    request.on('error', reject);
    request.end();
  });
}

function sanitizeEngineResult(result, path) {
  return {
    status: result.status,
    routeAccepted: result.body.routeAccepted === true,
    bootstrapTriggered: result.body.bootstrapTriggered === true,
    proofReached: result.body.proofReached === true,
    blocked: result.body.blocked === true,
    reason: typeof result.body.reason === 'string' ? result.body.reason.slice(0, 80) : 'engine_result',
    gatewayView: typeof result.body.gatewayView === 'string' ? result.body.gatewayView.slice(0, 180) : null,
    workerView: typeof result.body.workerView === 'string' ? result.body.workerView.slice(0, 180) : null,
    rawHttp: rawHttpPreview(path),
  };
}

function assertEngineVerdict(result) {
  if ([500, 502, 504].includes(result.status)
    || ['worker_unavailable', 'bootstrap_execution_failed'].includes(result.body?.reason)) {
    throw new Error('engine worker unavailable');
  }
  for (const field of ['routeAccepted', 'bootstrapTriggered', 'proofReached', 'blocked']) {
    if (typeof result.body?.[field] !== 'boolean') throw new Error(`invalid engine verdict: ${field}`);
  }
  if (typeof result.body.reason !== 'string') throw new Error('invalid engine verdict: reason');
  return result;
}

export class ProxyPanicAdjudicator {
  constructor({
    host = process.env.ENGINE_HOST ?? '127.0.0.1',
    patchedHost = process.env.PATCHED_ENGINE_HOST ?? host,
    vulnerablePort = boundedPort(process.env.VULNERABLE_ENGINE_PORT, 4100),
    patchedPort = boundedPort(process.env.PATCHED_ENGINE_PORT, 4200),
    token = process.env.ENGINE_TOKEN ?? '',
  } = {}) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('ENGINE_TOKEN must be 64 lowercase hex characters');
    this.host = host;
    this.patchedHost = patchedHost;
    this.vulnerablePort = vulnerablePort;
    this.patchedPort = patchedPort;
    this.token = token;
  }

  async ready() {
    const [vulnerable, patched] = await Promise.all([
      engineRequest({ host: this.host, port: this.vulnerablePort, token: this.token, path: '/healthz' }),
      engineRequest({ host: this.patchedHost, port: this.patchedPort, token: this.token, path: '/healthz' }),
    ]);
    return vulnerable.status === 200 && patched.status === 200;
  }

  async runBaseline(selection) {
    const path = buildAttackPath({ ...selection, variant: 'original' });
    const result = assertEngineVerdict(await engineRequest({
      host: this.host,
      port: this.vulnerablePort,
      token: this.token,
      path,
    }));
    return sanitizeEngineResult(result, path);
  }

  async runPatch({ patch, bypass }) {
    const intended = { prefix: 'command_substitution', normalization: 'encoded_parent', sink: 'cold_start' };
    const originalPath = buildAttackPath({ ...intended, variant: 'original' });
    const variantPath = buildAttackPath({ ...intended, variant: bypass });
    const normalPath = '/apps/builtin-code/proxy.php?status=1';
    const [original, variant, normal] = await Promise.all([
      engineRequest({ host: this.patchedHost, port: this.patchedPort, token: this.token, path: originalPath, patch }),
      engineRequest({ host: this.patchedHost, port: this.patchedPort, token: this.token, path: variantPath, patch }),
      engineRequest({ host: this.patchedHost, port: this.patchedPort, token: this.token, path: normalPath, patch }),
    ]);
    const originalResult = sanitizeEngineResult(assertEngineVerdict(original), originalPath);
    const variantResult = sanitizeEngineResult(assertEngineVerdict(variant), variantPath);
    const normalResult = sanitizeEngineResult(assertEngineVerdict(normal), normalPath);
    return {
      patch,
      bypass,
      original: originalResult,
      variant: variantResult,
      normal: normalResult,
      effective: !originalResult.proofReached && !variantResult.proofReached && normalResult.bootstrapTriggered,
    };
  }
}

export class DeterministicAdjudicator {
  async ready() { return true; }

  async runBaseline(selection) {
    const proofReached = selection.prefix === 'command_substitution'
      && selection.normalization === 'encoded_parent'
      && selection.sink === 'cold_start';
    const path = buildAttackPath({ ...selection, variant: 'original' });
    return {
      status: proofReached ? 503 : 404,
      routeAccepted: proofReached,
      bootstrapTriggered: proofReached,
      proofReached,
      blocked: false,
      reason: proofReached ? 'safe_proof_reached' : 'request_rejected',
      gatewayView: proofReached ? '/apps/builtin-code/proxy.php' : null,
      workerView: proofReached ? '/[mount-prefix]/%2e%2e/apps/builtin-code/proxy.php' : null,
      rawHttp: rawHttpPreview(path),
    };
  }

  async runPatch({ patch, bypass }) {
    const make = (variant) => {
      const path = buildAttackPath({
        prefix: 'command_substitution', normalization: 'encoded_parent', sink: 'cold_start', variant,
      });
      if (variant === 'double_encoded') {
        return {
          status: 404,
          routeAccepted: false,
          bootstrapTriggered: false,
          proofReached: false,
          blocked: false,
          reason: 'canonical_route_not_allowed',
          gatewayView: '/x$(printenv${IFS}BREACH5_PROOF)x/%2e%2e/apps/builtin-code/proxy.php',
          workerView: null,
          rawHttp: rawHttpPreview(path),
        };
      }
      if (patch === 'block_subshell' && variant !== 'backtick_variant') {
        return {
          status: 400,
          routeAccepted: true,
          bootstrapTriggered: false,
          proofReached: false,
          blocked: true,
          reason: 'literal_subshell_pattern_blocked',
          gatewayView: '/apps/builtin-code/proxy.php',
          workerView: 'raw request rejected by a literal pattern',
          rawHttp: rawHttpPreview(path),
        };
      }
      const proofReached = patch === 'hide_errors' || patch === 'block_subshell';
      return {
        status: 503,
        routeAccepted: true,
        bootstrapTriggered: true,
        proofReached,
        blocked: false,
        reason: proofReached ? 'safe_proof_reached' : 'bootstrap_completed_without_proof',
        gatewayView: '/apps/builtin-code/proxy.php',
        workerView: proofReached ? 'raw mount prefix expanded the isolated proof value' : 'shared or structured path reached the worker',
        rawHttp: rawHttpPreview(path),
      };
    };
    const original = make('original');
    const variant = make(bypass);
    const normal = {
      status: 503,
      routeAccepted: true,
      bootstrapTriggered: true,
      proofReached: false,
      blocked: false,
      reason: 'bootstrap_completed_without_proof',
      gatewayView: '/apps/builtin-code/proxy.php',
      workerView: 'raw mount prefix was recorded without proof',
      rawHttp: rawHttpPreview('/apps/builtin-code/proxy.php?status=1'),
    };
    return {
      patch,
      bypass,
      original,
      variant,
      normal,
      effective: !original.proofReached && !variant.proofReached && normal.bootstrapTriggered,
    };
  }
}
