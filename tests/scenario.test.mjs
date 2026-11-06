import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { buildAttackPath } from '../src/scenario.mjs';
import { DIFFICULTIES, getScenario, publicCatalog } from '../src/scenarios/index.mjs';
import { PUBLIC_DEMO_SECRET } from '../src/scenarios/session-heist.mjs';

test('catalog exposes two distinct fictional lab scenarios and two difficulties', () => {
  assert.deepEqual(DIFFICULTIES, ['BEGINNER', 'ADVANCED']);
  const catalog = publicCatalog();
  assert.deepEqual(catalog.map(({ id }) => id), ['proxy-panic', 'session-heist']);
  const heist = catalog.find(({ id }) => id === 'session-heist');
  assert.equal(heist.rewardClaim, '$90,000 reported by the researcher');
  assert.match(heist.sourceUrl, /^https:\/\/simonkoeck\.com\//);
  assert.equal('cve' in heist, false);
});

test('beginner and advanced views share canonical choices but differ in guidance', () => {
  for (const scenarioId of ['proxy-panic', 'session-heist']) {
    const scenario = getScenario(scenarioId);
    const [taskId] = Object.keys(scenario.tasks);
    const beginner = scenario.publicTask(taskId, { difficulty: 'BEGINNER' });
    const advanced = scenario.publicTask(taskId, { difficulty: 'ADVANCED' });
    assert.deepEqual(beginner.options.map(({ id }) => id), advanced.options.map(({ id }) => id));
    assert.ok(beginner.evidence.some(({ annotation }) => typeof annotation === 'string' && annotation.length > 0));
    assert.ok(advanced.evidence.every(({ annotation }) => annotation === null));
    assert.equal(scenario.validateChoice(taskId, beginner.options[0].id), true);
    assert.equal(scenario.validateChoice(taskId, 'arbitrary-user-input'), false);
  }
});

test('proxy evidence builds the literal raw/canonical differential request', () => {
  const scenario = getScenario('proxy-panic');
  const choices = { prefix: 'command_substitution', normalization: 'encoded_parent', sink: 'cold_start' };
  assert.equal(
    buildAttackPath({ ...choices, variant: 'original' }),
    '/x$(printenv${IFS}BREACH5_PROOF)x/%2e%2e/apps/builtin-code/proxy.php?status=1',
  );
  const preview = scenario.preview(choices);
  assert.match(preview.request, /GET \/x\$\(printenv\$\{IFS\}BREACH5_PROOF\)x\/%2e%2e\/apps\/builtin-code\/proxy\.php/);
  assert.match(preview.trace.join('\n'), /CANONICAL \/apps\/builtin-code\/proxy\.php/);
});

test('session-heist evidence is fictional, bounded, and contains no runtime secret', () => {
  const scenario = getScenario('session-heist');
  const serialized = JSON.stringify(scenario.tasks);
  assert.match(serialized, /devsite-lab\.invalid/);
  assert.match(serialized, /BINFLOAT 0\.05/);
  assert.match(serialized, /complete public demo cookie/);
  assert.match(serialized, /SHORT_BINBYTES/);
  assert.ok(serialized.includes(PUBLIC_DEMO_SECRET));
  assert.doesNotMatch(serialized.replaceAll(PUBLIC_DEMO_SECRET, ''), /google\.com|accounts\.google|[a-f0-9]{64}/i);
  assert.doesNotMatch(serialized, /\/bin\/sh/);
  const cookie = scenario.tasks.sh_decode.evidence.find(({ id }) => id === 'cookie-shape').value;
  const [, payload] = cookie.split('.');
  const decoded = JSON.parse(inflateSync(Buffer.from(payload, 'base64url')).toString('utf8'));
  const flow = Buffer.from(decoded['google_oauth2_flow_issued-state'][' b'], 'base64');
  assert.ok(flow.includes(Buffer.from(PUBLIC_DEMO_SECRET)), 'public demo cookie must decode to the shown credential');
  const preview = scenario.preview({
    sh_decode: 'base64_zlib_tagged_json', sh_secret: 'pickle_client_secret',
    sh_forge: 'matching_state_flow', sh_gadget: 'bounded_sleep_reduce',
  });
  assert.match(preview.request, /Host: devsite-lab\.invalid/);
  assert.match(preview.trace.join('\n'), /separate attacker serializer/);
  assert.match(preview.trace.join('\n'), /attacker-chosen/);
  assert.match(preview.trace.join('\n'), /RCE primitive/);

  const flowReady = scenario.attackFlow({
    sh_surface: 'signed_not_encrypted', sh_anomaly: 'secret_reuse',
    sh_decode: 'base64_zlib_tagged_json', sh_secret: 'pickle_client_secret',
    sh_forge: 'matching_state_flow', sh_gadget: 'bounded_sleep_reduce',
  });
  assert.equal(flowReady.classification, 'ENGINE PROOF READY');
  assert.equal(flowReady.steps.at(-1).status, 'READY');
  const flowConfirmed = scenario.attackFlow({
    sh_surface: 'signed_not_encrypted', sh_anomaly: 'secret_reuse',
    sh_decode: 'base64_zlib_tagged_json', sh_secret: 'pickle_client_secret',
    sh_forge: 'matching_state_flow', sh_gadget: 'bounded_sleep_reduce',
  }, {
    proofReached: true, recoveredSigningKeyUsed: true, forgedCookieAccepted: true,
    callableInvoked: true, rcePrimitive: true,
  });
  assert.equal(flowConfirmed.classification, 'RCE primitive CONFIRMED');
  assert.equal(flowConfirmed.steps.at(-1).status, 'CONFIRMED');
  assert.match(flowConfirmed.safetyNote, /OS 명령 실행을 주장하지 않습니다/);

  const controls = scenario.publicTask('sh_control', {
    difficulty: 'ADVANCED',
    execution: {
      timingMs: 50.2,
      controls: [{ id: 'flipped_signature', passed: true, reason: 'invalid_session', timingMs: 0.4 }],
    },
  });
  assert.match(controls.evidence.find(({ id }) => id === 'timings').value, /flipped_signature → PASS/);
  assert.ok(controls.evidence.every(({ annotation }) => annotation === null));
});
