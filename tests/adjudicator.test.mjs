import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import {
  createDeterministicRegistry,
  DeterministicAdjudicator,
  DeterministicSessionAdjudicator,
  ProxyPanicAdjudicator,
  SessionHeistAdjudicator,
} from '../src/adjudicator.mjs';

async function mockEngine(status, body) {
  const server = http.createServer((request, response) => {
    request.resume();
    const payload = Buffer.from(JSON.stringify(body));
    response.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': String(payload.length),
    });
    response.end(payload);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

test('engine execution failures cannot become trusted blocked verdicts', async (context) => {
  const engine = await mockEngine(500, {
    routeAccepted: true,
    bootstrapTriggered: false,
    proofReached: false,
    blocked: false,
    reason: 'bootstrap_execution_failed',
  });
  context.after(() => new Promise((resolve) => engine.close(resolve)));
  const adjudicator = new ProxyPanicAdjudicator({
    host: '127.0.0.1',
    patchedHost: '127.0.0.1',
    vulnerablePort: engine.address().port,
    patchedPort: engine.address().port,
    token: 'a'.repeat(64),
  });
  await assert.rejects(adjudicator.runBaseline({
    prefix: 'command_substitution', normalization: 'encoded_parent', sink: 'cold_start',
  }), /engine worker unavailable/);
});

test('malformed worker verdicts are rejected instead of coerced to attack failure', async (context) => {
  const engine = await mockEngine(400, { error: 'invalid bootstrap request' });
  context.after(() => new Promise((resolve) => engine.close(resolve)));
  const adjudicator = new ProxyPanicAdjudicator({
    host: '127.0.0.1',
    patchedHost: '127.0.0.1',
    vulnerablePort: engine.address().port,
    patchedPort: engine.address().port,
    token: 'b'.repeat(64),
  });
  await assert.rejects(adjudicator.runBaseline({
    prefix: 'command_substitution', normalization: 'encoded_parent', sink: 'cold_start',
  }), /invalid engine verdict/);
});

test('proxy regression distinguishes a literal blacklist from both semantic fixes', async () => {
  const adjudicator = new DeterministicAdjudicator();
  const bypassed = await adjudicator.runPatch({ patch: 'block_subshell', bypass: 'backtick_variant' });
  assert.equal(bypassed.original.proofReached, false);
  assert.equal(bypassed.variant.proofReached, true);
  assert.equal(bypassed.effective, false);

  for (const patch of ['canonical_once', 'structured_exec']) {
    const verdict = await adjudicator.runPatch({ patch, bypass: 'backtick_variant' });
    assert.equal(verdict.original.proofReached, false);
    assert.equal(verdict.variant.proofReached, false);
    assert.equal(verdict.normal.bootstrapTriggered, true);
    assert.equal(verdict.effective, true);
  }
});

test('session-heist deterministic verdict requires the complete semantic chain', async () => {
  const adjudicator = new DeterministicSessionAdjudicator();
  const correct = await adjudicator.runBaseline({
    surface: 'signed_not_encrypted', decode: 'base64_zlib_tagged_json',
    secret: 'pickle_client_secret', forge: 'matching_state_flow', gadget: 'bounded_sleep_reduce',
  });
  assert.equal(correct.proofReached, true);
  assert.equal(correct.recoveredSigningKeyUsed, true);
  assert.equal(correct.forgedCookieAccepted, true);
  assert.equal(correct.callableInvoked, true);
  assert.equal(correct.rcePrimitive, true);
  assert.equal(correct.proofType, 'bounded_python_callable_dispatch');
  assert.equal(correct.safetyProfile, 'server_owned_time_sleep_50ms');
  assert.match(correct.trace.join('\n'), /RCE primitive confirmed/);
  assert.match(correct.rawHttp, /devsite-lab\.invalid/);
  assert.ok(correct.controls.every(({ passed }) => passed));

  const wrong = await adjudicator.runBaseline({
    surface: 'encrypted_cookie', decode: 'base64_zlib_tagged_json',
    secret: 'pickle_client_secret', forge: 'matching_state_flow', gadget: 'bounded_sleep_reduce',
  });
  assert.equal(wrong.proofReached, false);
  assert.equal(wrong.recoveredSigningKeyUsed, false);
  assert.equal(wrong.forgedCookieAccepted, false);
  assert.equal(wrong.callableInvoked, false);
  assert.equal(wrong.rcePrimitive, false);

  const partial = await adjudicator.runPatch({ patch: 'separate_secret_only', control: 'timing_and_negative_controls' });
  const complete = await adjudicator.runPatch({ patch: 'server_side_json_bundle', control: 'timing_and_negative_controls' });
  assert.equal(partial.effective, false);
  assert.equal(partial.variant.proofReached, true);
  assert.equal(complete.effective, true);
  assert.equal(complete.normal.passed, true);
});

test('session engine cannot claim proof with contradictory chain signals', async (context) => {
  const valid = {
    proofReached: true,
    recoveredSigningKeyUsed: true,
    forgedCookieAccepted: true,
    callableInvoked: true,
    rcePrimitive: true,
    proofType: 'bounded_python_callable_dispatch',
    safetyProfile: 'server_owned_time_sleep_50ms',
    blocked: false,
    reason: 'proof',
    controls: [{ id: 'wrong_key_signature', passed: true, reason: 'invalid_session' }],
  };
  const cases = [
    ['missing recovered-key signer', { recoveredSigningKeyUsed: false }],
    ['forged cookie was not accepted', { forgedCookieAccepted: false }],
    ['callable and RCE disagree', { rcePrimitive: false }],
    ['false proof uses the success proof type', {
      proofReached: false, recoveredSigningKeyUsed: false, forgedCookieAccepted: false,
      callableInvoked: false, rcePrimitive: false, proofType: 'bounded_python_callable_dispatch', blocked: true,
    }],
    ['false proof is not blocked', {
      proofReached: false, recoveredSigningKeyUsed: false, forgedCookieAccepted: false,
      callableInvoked: false, rcePrimitive: false, proofType: 'not_reached', blocked: false,
    }],
    ['successful proof is marked blocked', { blocked: true }],
    ['wrong-key control is missing', { controls: [] }],
  ];
  for (const [name, overrides] of cases) {
    await context.test(name, async (subtest) => {
      const engine = await mockEngine(200, { ...valid, ...overrides });
      subtest.after(() => new Promise((resolve) => engine.close(resolve)));
      const adjudicator = new SessionHeistAdjudicator({
        host: '127.0.0.1', port: engine.address().port, token: 'c'.repeat(64),
      });
      await assert.rejects(adjudicator.runBaseline({
        surface: 'signed_not_encrypted', decode: 'base64_zlib_tagged_json',
        secret: 'pickle_client_secret', forge: 'matching_state_flow', gadget: 'bounded_sleep_reduce',
      }), /inconsistent session RCE verdict/);
    });
  }
});

test('deterministic registry contains a separate adjudicator for each scenario', async () => {
  const registry = createDeterministicRegistry();
  assert.notEqual(registry.get('proxy-panic'), registry.get('session-heist'));
  assert.equal(await registry.ready(), true);
  assert.throws(() => registry.get('unknown'), /no adjudicator/);
});
