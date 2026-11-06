import http from 'node:http';
import { buildAttackPath, rawHttpPreview } from './scenario.mjs';

const MAX_ENGINE_RESPONSE = 16_384;

function boundedPort(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : fallback;
}

function readResponse(response, resolve, reject) {
  const chunks = [];
  let size = 0;
  response.on('data', (chunk) => {
    size += chunk.length;
    if (size <= MAX_ENGINE_RESPONSE) chunks.push(chunk);
  });
  response.on('end', () => {
    if (size > MAX_ENGINE_RESPONSE) return reject(new Error('engine response too large'));
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { body = { error: 'invalid engine response' }; }
    resolve({ status: response.statusCode ?? 502, body });
  });
}

function engineRequest({ host, port, token, path, patch = 'none' }) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host, port, method: 'GET', path, timeout: 2_500,
      headers: { 'X-Engine-Token': token, 'X-Patch-Strategy': patch, Connection: 'close' },
    }, (response) => readResponse(response, resolve, reject));
    request.on('timeout', () => request.destroy(new Error('engine timeout')));
    request.on('error', reject);
    request.end();
  });
}

function sessionRequest({ host, port, token, operation, selection }) {
  const payload = Buffer.from(JSON.stringify({ operation, selection }), 'utf8');
  return new Promise((resolve, reject) => {
    const request = http.request({
      host, port, method: 'POST', path: '/judge', timeout: 3_000,
      headers: {
        'Content-Type': 'application/json', 'Content-Length': String(payload.length),
        'X-Session-Engine-Token': token, Connection: 'close',
      },
    }, (response) => readResponse(response, resolve, reject));
    request.on('timeout', () => request.destroy(new Error('session engine timeout')));
    request.on('error', reject);
    request.end(payload);
  });
}

function sanitizeText(value, limit = 500) {
  if (typeof value !== 'string') return null;
  return value.slice(0, limit).replace(/\b[a-f0-9]{64}\b/gi, '<redacted>');
}

function sanitizeEngineResult(result, path) {
  return {
    status: result.status,
    routeAccepted: result.body.routeAccepted === true,
    bootstrapTriggered: result.body.bootstrapTriggered === true,
    proofReached: result.body.proofReached === true,
    blocked: result.body.blocked === true,
    reason: sanitizeText(result.body.reason, 80) ?? 'engine_result',
    gatewayView: sanitizeText(result.body.gatewayView, 180),
    workerView: sanitizeText(result.body.workerView, 180),
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

function sanitizeControl(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const status = sanitizeText(value.status, 40);
  return {
    id: sanitizeText(value.id ?? value.case, 40),
    passed: value.passed === true || ['REJECT', 'NORMAL_PATH', 'DELAY_OBSERVED'].includes(status),
    reason: sanitizeText(value.reason, 100) ?? status,
    timingMs: Number.isFinite(value.timingMs) ? Math.max(0, Math.min(2_000, value.timingMs)) : null,
  };
}

function sanitizeSessionCase(value, normal = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid session verdict case');
  if (normal) {
    if (typeof value.passed !== 'boolean' || typeof value.reason !== 'string') throw new Error('invalid session normal verdict');
    return { passed: value.passed, reason: sanitizeText(value.reason, 100) };
  }
  if (typeof value.proofReached !== 'boolean' || typeof value.blocked !== 'boolean' || typeof value.reason !== 'string') {
    throw new Error('invalid session attack verdict');
  }
  return { proofReached: value.proofReached, blocked: value.blocked, reason: sanitizeText(value.reason, 100) };
}

function assertSessionHttp(result) {
  if (result.status !== 200 || !result.body || typeof result.body !== 'object') throw new Error('session engine unavailable');
  return result.body;
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
    Object.assign(this, { host, patchedHost, vulnerablePort, patchedPort, token });
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
    const result = assertEngineVerdict(await engineRequest({ host: this.host, port: this.vulnerablePort, token: this.token, path }));
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
    normalResult.passed = normalResult.bootstrapTriggered && !normalResult.proofReached;
    return {
      patch, bypass, original: originalResult, variant: variantResult, normal: normalResult,
      effective: !originalResult.proofReached && !variantResult.proofReached && normalResult.bootstrapTriggered,
    };
  }
}

export class SessionHeistAdjudicator {
  constructor({
    host = process.env.SESSION_ENGINE_HOST ?? '127.0.0.1',
    port = boundedPort(process.env.SESSION_ENGINE_PORT, 4300),
    token = process.env.SESSION_ENGINE_TOKEN ?? '',
  } = {}) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('SESSION_ENGINE_TOKEN must be 64 lowercase hex characters');
    Object.assign(this, { host, port, token });
  }

  async ready() {
    const result = await new Promise((resolve, reject) => {
      const request = http.request({ host: this.host, port: this.port, method: 'GET', path: '/healthz', timeout: 2_500 },
        (response) => readResponse(response, resolve, reject));
      request.on('timeout', () => request.destroy(new Error('session engine timeout')));
      request.on('error', reject);
      request.end();
    });
    return result.status === 200 && (result.body?.ok === true || result.body?.status === 'ok');
  }

  async runBaseline(selection) {
    const body = assertSessionHttp(await sessionRequest({
      host: this.host, port: this.port, token: this.token, operation: 'baseline', selection,
    }));
    if (typeof body.proofReached !== 'boolean' || typeof body.recoveredSigningKeyUsed !== 'boolean'
      || typeof body.forgedCookieAccepted !== 'boolean' || typeof body.callableInvoked !== 'boolean'
      || typeof body.rcePrimitive !== 'boolean' || typeof body.blocked !== 'boolean'
      || typeof body.reason !== 'string' || typeof body.proofType !== 'string'
      || typeof body.safetyProfile !== 'string') {
      throw new Error('invalid session baseline verdict');
    }
    const wrongKeyControl = Array.isArray(body.controls)
      ? body.controls.find((control) => control?.id === 'wrong_key_signature') : null;
    if (body.proofReached !== body.recoveredSigningKeyUsed
      || body.proofReached !== body.forgedCookieAccepted
      || body.proofReached !== body.callableInvoked || body.proofReached !== body.rcePrimitive
      || (body.rcePrimitive && body.proofType !== 'bounded_python_callable_dispatch')
      || (!body.rcePrimitive && body.proofType !== 'not_reached')
      || body.blocked === body.proofReached
      || (body.proofReached && (wrongKeyControl?.passed !== true || wrongKeyControl?.reason !== 'invalid_session'))
      || body.safetyProfile !== 'server_owned_time_sleep_50ms') {
      throw new Error('inconsistent session RCE verdict');
    }
    return {
      status: 200, proofReached: body.proofReached,
      recoveredSigningKeyUsed: body.recoveredSigningKeyUsed,
      forgedCookieAccepted: body.forgedCookieAccepted, callableInvoked: body.callableInvoked,
      rcePrimitive: body.rcePrimitive, blocked: body.blocked,
      proofType: sanitizeText(body.proofType, 80), safetyProfile: sanitizeText(body.safetyProfile, 80),
      reason: sanitizeText(body.reason, 100), rawHttp: sanitizeText(body.rawHttp, 800),
      trace: Array.isArray(body.trace) ? body.trace.slice(0, 12).map((value) => sanitizeText(value, 240)).filter(Boolean) : [],
      controls: Array.isArray(body.controls) ? body.controls.slice(0, 8).map(sanitizeControl).filter(Boolean) : [],
      timingMs: Number.isFinite(body.timingMs) ? Math.max(0, Math.min(2_000, body.timingMs)) : null,
    };
  }

  async runPatch(selection) {
    const body = assertSessionHttp(await sessionRequest({
      host: this.host, port: this.port, token: this.token, operation: 'patch', selection,
    }));
    if (typeof body.effective !== 'boolean') throw new Error('invalid session patch verdict');
    const original = sanitizeSessionCase(body.original);
    const variant = sanitizeSessionCase(body.variant);
    const normal = sanitizeSessionCase(body.normal, true);
    const regressionPassed = original.blocked && !original.proofReached
      && variant.blocked && !variant.proofReached && normal.passed;
    if (body.effective && !regressionPassed) throw new Error('inconsistent session patch verdict');
    return {
      patch: sanitizeText(body.patch, 60) ?? selection.patch,
      original, variant, normal, effective: body.effective && regressionPassed,
      trace: Array.isArray(body.trace) ? body.trace.slice(0, 12).map((value) => sanitizeText(value, 240)).filter(Boolean) : [],
    };
  }
}

export class AdjudicatorRegistry {
  constructor(entries) { this.entries = entries instanceof Map ? entries : new Map(Object.entries(entries ?? {})); }

  get(scenarioId) {
    const adjudicator = this.entries.get(scenarioId);
    if (!adjudicator) throw new Error(`no adjudicator for ${scenarioId}`);
    return adjudicator;
  }

  async ready() {
    const values = await Promise.all([...this.entries.values()].map((adjudicator) => adjudicator.ready()));
    return values.length > 0 && values.every(Boolean);
  }
}

export class DeterministicAdjudicator {
  async ready() { return true; }

  async runBaseline(selection) {
    const proofReached = selection.prefix === 'command_substitution'
      && selection.normalization === 'encoded_parent' && selection.sink === 'cold_start';
    const path = buildAttackPath({ ...selection, variant: 'original' });
    return {
      status: proofReached ? 503 : 404, routeAccepted: proofReached, bootstrapTriggered: proofReached,
      proofReached, blocked: false, reason: proofReached ? 'safe_proof_reached' : 'request_rejected',
      gatewayView: proofReached ? '/apps/builtin-code/proxy.php' : null,
      workerView: proofReached ? '/[mount-prefix]/%2e%2e/apps/builtin-code/proxy.php' : null,
      rawHttp: rawHttpPreview(path),
    };
  }

  async runPatch({ patch, bypass }) {
    const make = (variant) => {
      const path = buildAttackPath({ prefix: 'command_substitution', normalization: 'encoded_parent', sink: 'cold_start', variant });
      if (variant === 'double_encoded') return {
        status: 404, routeAccepted: false, bootstrapTriggered: false, proofReached: false, blocked: false,
        reason: 'canonical_route_not_allowed', gatewayView: '/x$(printenv${IFS}BREACH5_PROOF)x/%2e%2e/apps/builtin-code/proxy.php',
        workerView: null, rawHttp: rawHttpPreview(path),
      };
      const semanticFix = patch === 'canonical_once' || patch === 'structured_exec';
      const literalBlock = patch === 'block_subshell' && variant !== 'backtick_variant';
      const proofReached = !semanticFix && !literalBlock;
      return {
        status: proofReached ? 503 : 400, routeAccepted: true, bootstrapTriggered: proofReached,
        proofReached, blocked: !proofReached, reason: proofReached ? 'safe_proof_reached' : 'attack_blocked',
        gatewayView: '/apps/builtin-code/proxy.php', workerView: proofReached ? 'raw prefix reached proof' : 'safe data flow',
        rawHttp: rawHttpPreview(path),
      };
    };
    const original = make('original');
    const variant = make(bypass);
    const normal = {
      status: 503, routeAccepted: true, bootstrapTriggered: true, proofReached: false, blocked: false,
      reason: 'bootstrap_completed_without_proof', gatewayView: '/apps/builtin-code/proxy.php',
      workerView: 'normal bootstrap', rawHttp: rawHttpPreview('/apps/builtin-code/proxy.php?status=1'),
    };
    normal.passed = true;
    return { patch, bypass, original, variant, normal, effective: !original.proofReached && !variant.proofReached && normal.bootstrapTriggered };
  }
}

export class DeterministicSessionAdjudicator {
  async ready() { return true; }

  async runBaseline(selection) {
    const proofReached = selection.surface === 'signed_not_encrypted'
      && selection.decode === 'base64_zlib_tagged_json' && selection.secret === 'pickle_client_secret'
      && selection.forge === 'matching_state_flow' && selection.gadget === 'bounded_sleep_reduce';
    return {
      status: 200, proofReached, recoveredSigningKeyUsed: proofReached,
      forgedCookieAccepted: proofReached, callableInvoked: proofReached,
      rcePrimitive: proofReached, blocked: !proofReached,
      proofType: proofReached ? 'bounded_python_callable_dispatch' : 'not_reached',
      safetyProfile: 'server_owned_time_sleep_50ms',
      reason: proofReached ? 'rce_primitive_confirmed_with_bounded_callable' : 'chain_incomplete',
      rawHttp: 'GET /oauth2callback?state=attacker-chosen&code=demo HTTP/1.1\nHost: devsite-lab.invalid\nCookie: session=<server-owned-forged-cookie>',
      trace: proofReached ? [
        'COOKIE compressed payload decoded',
        'CREDENTIAL client_secret recovered statically from pickle opcodes',
        'SIGNER separate attacker serializer initialized only from recovered client_secret',
        'SIGNATURE attacker-signed forged session accepted by vulnerable server serializer',
        'LOOKUP vulnerable callback selected the lab-safe payload at attacker-chosen state/flow position',
        'UNPICKLE STACK_GLOBAL + REDUCE invoked time.sleep(0.05)',
        'MODELED_CONTROL original vulnerability allows attacker-controlled pickle; lab substitutes server-owned safe bytes',
        'CLASSIFICATION RCE primitive confirmed; shell/file/network disabled in lab',
      ] : ['one or more choices contradicted the evidence'],
      controls: proofReached ? [
        { id: 'no_cookie', passed: true, reason: 'invalid_session', timingMs: 0.2 },
        { id: 'flipped_signature', passed: true, reason: 'invalid_session', timingMs: 0.3 },
        { id: 'wrong_key_signature', passed: true, reason: 'invalid_session', timingMs: 0.3 },
        { id: 'wrong_state', passed: true, reason: 'invalid_state', timingMs: 0.3 },
        { id: 'missing_flow', passed: true, reason: 'missing_flow', timingMs: 0.3 },
        { id: 'real_flow', passed: true, reason: 'fictional_oauth_exchange_reached', timingMs: 0.5 },
        { id: 'bounded_sleep', passed: true, reason: 'bounded_timing_proof_observed', timingMs: 50 },
      ] : [], timingMs: proofReached ? 50 : 1,
    };
  }

  async runPatch({ patch }) {
    const effective = patch === 'server_side_json_bundle';
    const separate = patch === 'separate_secret_only';
    return {
      patch,
      original: {
        proofReached: !effective && !separate,
        blocked: effective || separate,
        reason: effective || separate ? 'independent_key_rejected' : 'forgery_reaches_sink',
      },
      variant: { proofReached: !effective, blocked: effective, reason: effective ? 'client_pickle_inert' : 'valid_key_pickle_reaches_sink' },
      normal: { passed: true, reason: 'fictional_oauth_exchange_reached' },
      effective, trace: effective ? ['independent signing key', 'server-side flow record', 'schema-only decode'] : ['regression failed'],
    };
  }
}

export function createDeterministicRegistry() {
  return new AdjudicatorRegistry(new Map([
    ['proxy-panic', new DeterministicAdjudicator()],
    ['session-heist', new DeterministicSessionAdjudicator()],
  ]));
}
