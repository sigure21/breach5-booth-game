import assert from 'node:assert/strict';

const target = new URL(process.env.TARGET_URL ?? 'http://127.0.0.1:18091');
const deadline = Date.now() + 90_000;
const correct = Object.freeze({
  trust_boundary: 'parser_mismatch', anomaly: 'route_views_differ',
  prefix: 'command_substitution', normalization: 'encoded_parent', sink: 'cold_start',
  guard: 'canonical_once', bypass: 'backtick_variant', patch: 'canonical_once',
  sh_surface: 'signed_not_encrypted', sh_anomaly: 'secret_reuse',
  sh_decode: 'base64_zlib_tagged_json', sh_secret: 'pickle_client_secret',
  sh_forge: 'matching_state_flow', sh_gadget: 'bounded_sleep_reduce',
  sh_guard: 'separate_session_key', sh_control: 'timing_and_negative_controls',
  sh_patch: 'server_side_json_bundle',
});
const observed = [];
let deviceSequence = 0;
let actionSequence = 0;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function observeResponse(response, body = '') {
  observed.push(JSON.stringify({ headers: Object.fromEntries(response.headers.entries()), body }));
}

async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(new URL(path, target), {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(5_000),
  });
  const value = await response.json().catch(() => ({ error: 'invalid_json' }));
  observeResponse(response, value);
  return { response, value };
}

function nextDeviceId() {
  deviceSequence += 1;
  return deviceSequence.toString(16).padStart(32, '0');
}

async function join(scenarioId, difficulty, deviceId = nextDeviceId()) {
  const { response, value } = await request('/api/join', {
    method: 'POST', body: { deviceId, scenarioId, difficulty },
  });
  assert.equal(response.status, 201, JSON.stringify(value));
  return { ...value, deviceId };
}

async function submitVisible(player, state) {
  for (const task of state.tasks ?? []) {
    if (task.selected) continue;
    const choice = correct[task.id];
    assert.ok(choice, `missing correct choice for ${task.id}`);
    actionSequence += 1;
    const action = {
      roundId: state.round.roundId,
      task: task.id,
      choice,
      actionId: `live_${String(actionSequence).padStart(6, '0')}_${task.id}`,
    };
    const first = await request('/api/action', { token: player.token, method: 'POST', body: action });
    assert.equal(first.response.status, 200, JSON.stringify(first.value));
    const duplicate = await request('/api/action', { token: player.token, method: 'POST', body: action });
    assert.equal(duplicate.value.duplicate, true);
  }
}

const ready = await fetch(new URL('/readyz', target), { signal: AbortSignal.timeout(5_000) });
assert.equal(ready.status, 200, 'all adjudication engines must be ready');
observeResponse(ready, await ready.text());

const catalogResponse = await request('/api/catalog');
assert.equal(catalogResponse.response.status, 200);
assert.deepEqual(catalogResponse.value.difficulties, ['BEGINNER', 'ADVANCED']);
assert.deepEqual(catalogResponse.value.scenarios.map((entry) => entry.id), ['proxy-panic', 'session-heist']);
const sessionCatalog = catalogResponse.value.scenarios.find((entry) => entry.id === 'session-heist');
assert.match(sessionCatalog.rewardClaim, /90,000/);
assert.equal('cve' in sessionCatalog, false);

const missingSelection = await request('/api/join', {
  method: 'POST', body: { deviceId: 'f'.repeat(32) },
});
assert.equal(missingSelection.response.status, 400);
assert.equal(missingSelection.value.error, 'invalid_scenario');

const initialScreen = (await request('/api/screen-state')).value;
assert.equal(initialScreen.joinUrl, new URL('/play', target).toString());
assert.equal(initialScreen.lanes.length, 2);
const qr = await fetch(new URL('/api/qr.svg', target), { signal: AbortSignal.timeout(5_000) });
assert.equal(qr.status, 200);
const qrBody = await qr.text();
observeResponse(qr, qrBody);
assert.match(qrBody, /^<svg/);

const players = [
  await join('proxy-panic', 'BEGINNER'),
  await join('proxy-panic', 'ADVANCED'),
  await join('session-heist', 'BEGINNER'),
  await join('session-heist', 'ADVANCED'),
];
assert.deepEqual(players.map((player) => player.team), ['RED', 'BLUE', 'RED', 'BLUE']);

const immutable = await request('/api/join', {
  token: players[0].token,
  method: 'POST',
  body: { deviceId: players[0].deviceId, scenarioId: 'session-heist', difficulty: 'ADVANCED' },
});
assert.equal(immutable.value.scenarioId, 'proxy-panic');
assert.equal(immutable.value.difficulty, 'BEGINNER');
assert.equal(immutable.value.callsign, players[0].callsign);

const finalStates = new Map();
let latePlayer = null;
let checkedBeginnerEvidence = false;
let checkedAdvancedEvidence = false;
while (Date.now() < deadline && finalStates.size < players.length) {
  for (const player of players) {
    const stateResponse = await request('/api/state', { token: player.token });
    assert.equal(stateResponse.response.status, 200, JSON.stringify(stateResponse.value));
    const state = stateResponse.value;
    assert.equal(state.player.scenarioId, player.scenarioId);
    assert.equal(state.player.difficulty, player.difficulty);
    if ((state.tasks ?? []).length > 0) {
      const annotations = state.tasks.flatMap((task) => task.evidence ?? []).map((item) => item.annotation);
      if (player.difficulty === 'BEGINNER') {
        assert.ok(annotations.some((value) => typeof value === 'string' && value.length > 0));
        checkedBeginnerEvidence = true;
      } else {
        assert.ok(annotations.every((value) => value === null));
        checkedAdvancedEvidence = true;
      }
      await submitVisible(player, state);
    }
    if (!latePlayer && state.round.phase === 'DISCOVER') {
      latePlayer = await join('session-heist', 'BEGINNER');
      assert.notEqual(latePlayer.roundId, player.roundId);
      const queued = (await request('/api/state', { token: latePlayer.token })).value;
      assert.equal(queued.round.phase, 'QUEUED');
      assert.equal(queued.queue.selectedScenario, 'session-heist');
    }
    if (state.result) finalStates.set(player.token, state);
  }
  if (finalStates.size < players.length) await sleep(100);
}

assert.equal(finalStates.size, players.length, 'both scenario lanes must complete within the accelerated round');
assert.equal(checkedBeginnerEvidence, true);
assert.equal(checkedAdvancedEvidence, true);
assert.ok(latePlayer, 'late-join queue control was not exercised');

for (const player of players) {
  const state = finalStates.get(player.token);
  assert.equal(state.result.outcome, 'BREACHED_THEN_CONTAINED', JSON.stringify(state));
  assert.equal(state.result.baseline.proofReached, true);
  assert.equal(state.result.patch.effective, true);
  assert.deepEqual(state.result.incompleteTasks, []);
}
const sessionFinal = finalStates.get(players[2].token);
assert.match(sessionFinal.result.baseline.rawHttp, /devsite-lab\.invalid/);
assert.ok(sessionFinal.result.baseline.controls.length >= 5);
assert.ok(sessionFinal.result.baseline.timingMs >= 35 && sessionFinal.result.baseline.timingMs <= 2_000);
const proxyFinal = finalStates.get(players[0].token);
assert.match(proxyFinal.result.baseline.rawHttp, /%2e%2e/);

const finalScreen = (await request('/api/screen-state')).value;
assert.equal(finalScreen.lanes.length, 2);
assert.equal(finalScreen.lanes.filter((lane) => lane.result?.outcome === 'BREACHED_THEN_CONTAINED').length, 2);
assert.equal(finalScreen.joinMode, 'NEXT');
assert.ok(finalScreen.nextRound.total >= 1);

const joinedOutput = observed.join('\n');
assert.doesNotMatch(joinedOutput, /proof_[a-f0-9]{48}/, 'proxy proof secret leaked through API');
assert.doesNotMatch(joinedOutput, /session_proof_[a-f0-9]{48}/, 'session proof secret leaked through API');
assert.doesNotMatch(joinedOutput, /"(?:ENGINE|WORKER|SESSION_ENGINE)_TOKEN"/, 'engine token label leaked through API');
for (const [name, secret] of Object.entries({
  ENGINE_TOKEN: process.env.AUDIT_ENGINE_TOKEN,
  WORKER_TOKEN: process.env.AUDIT_WORKER_TOKEN,
  BREACH5_PROOF: process.env.AUDIT_BREACH5_PROOF,
  SESSION_ENGINE_TOKEN: process.env.AUDIT_SESSION_ENGINE_TOKEN,
  SESSION_LAB_CLIENT_SECRET: process.env.AUDIT_SESSION_LAB_CLIENT_SECRET,
  SESSION_SIGNING_SECRET: process.env.AUDIT_SESSION_SIGNING_SECRET,
  SESSION_PROOF: process.env.AUDIT_SESSION_PROOF,
})) {
  if (secret) assert.equal(joinedOutput.includes(secret), false, `${name} value leaked through API`);
}

console.log(JSON.stringify({
  ok: true,
  scenarios: [...new Set(players.map((player) => player.scenarioId))],
  outcomes: [...finalStates.values()].map((state) => state.result.outcome),
  queuedRound: latePlayer.roundId,
}, null, 2));
