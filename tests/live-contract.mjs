import assert from 'node:assert/strict';

const target = new URL(process.env.TARGET_URL ?? 'http://127.0.0.1:18091');
const deadline = Date.now() + 75_000;
const correct = Object.freeze({
  trust_boundary: 'parser_mismatch',
  anomaly: 'route_views_differ',
  prefix: 'command_substitution',
  normalization: 'encoded_parent',
  sink: 'cold_start',
  guard: 'canonical_once',
  bypass: 'backtick_variant',
  patch: 'canonical_once',
});
const observed = [];

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function observeResponse(response, body = '') {
  observed.push(JSON.stringify({
    headers: Object.fromEntries(response.headers.entries()),
    body,
  }));
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

async function waitForPhase(phase, token = null) {
  while (Date.now() < deadline) {
    const { response, value } = await request(token ? '/api/state' : '/api/screen-state', { token });
    if (response.ok && value.round?.phase === phase) return value;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${phase}`);
}

let deviceSequence = 0;

function nextDeviceId() {
  deviceSequence += 1;
  return deviceSequence.toString(16).padStart(32, '0');
}

async function join(deviceId = nextDeviceId()) {
  const { response, value } = await request('/api/join', { method: 'POST', body: { deviceId } });
  assert.equal(response.status, 201, JSON.stringify(value));
  return { ...value, deviceId };
}

async function submitAll(players, phase) {
  for (const player of players) {
    const state = (await request('/api/state', { token: player.token })).value;
    if (state.round.phase !== phase) continue;
    for (const task of state.tasks) {
      const choice = correct[task.id];
      assert.ok(choice, `missing correct choice for ${task.id}`);
      const action = {
        roundId: state.round.roundId,
        task: task.id,
        choice,
        actionId: `live_${task.id}_${player.token.slice(0, 10)}`,
      };
      const first = await request('/api/action', { token: player.token, method: 'POST', body: action });
      assert.equal(first.response.status, 200, JSON.stringify(first.value));
      const duplicate = await request('/api/action', { token: player.token, method: 'POST', body: action });
      assert.equal(duplicate.value.duplicate, true);
    }
  }
}

const health = await fetch(new URL('/readyz', target), { signal: AbortSignal.timeout(5_000) });
assert.equal(health.status, 200, 'game must be ready');
observeResponse(health, await health.text());

await waitForPhase('JOIN');
const initialScreen = (await request('/api/screen-state')).value;
assert.equal(initialScreen.joinUrl, new URL('/play', target).toString());
const qr = await fetch(new URL('/api/qr.svg', target), { signal: AbortSignal.timeout(5_000) });
assert.equal(qr.status, 200);
const qrBody = await qr.text();
observeResponse(qr, qrBody);
assert.match(qrBody, /^<svg/);
const players = [];
for (let index = 0; index < 6; index += 1) players.push(await join());
assert.deepEqual(players.map((player) => player.team), ['RED', 'BLUE', 'RED', 'BLUE', 'RED', 'BLUE']);

const rejoin = await request('/api/join', {
  token: players[0].token, method: 'POST', body: { deviceId: players[0].deviceId },
});
assert.equal(rejoin.value.callsign, players[0].callsign);

await waitForPhase('DISCOVER', players[0].token);
await submitAll(players, 'DISCOVER');
const late = await join();
assert.notEqual(late.roundId, players[0].roundId, 'late join must queue for the next round');
const queued = (await request('/api/state', { token: late.token })).value;
assert.equal(queued.round.phase, 'QUEUED');
assert.equal(queued.queue.currentPhase, 'DISCOVER');
const queuedScreen = (await request('/api/screen-state')).value;
assert.equal(queuedScreen.joinMode, 'NEXT');
assert.ok(queuedScreen.nextRound.total >= 1);

await waitForPhase('BUILD', players[0].token);
await submitAll(players, 'BUILD');

await waitForPhase('EXECUTE', players[0].token);
let screen = (await request('/api/screen-state')).value;
while (!screen.execution && Date.now() < deadline) {
  await sleep(100);
  screen = (await request('/api/screen-state')).value;
}
assert.equal(screen.execution?.proofReached, true, JSON.stringify(screen));

await waitForPhase('DUEL', players[0].token);
await submitAll(players, 'DUEL');

await waitForPhase('RESULT', players[0].token);
const finalState = (await request('/api/state', { token: players[0].token })).value;
assert.equal(finalState.result?.outcome, 'BREACHED_THEN_CONTAINED', JSON.stringify(finalState));
assert.equal(finalState.result?.baseline?.proofReached, true);
assert.equal(finalState.result?.patch?.effective, true);

const joinedOutput = observed.join('\n');
assert.doesNotMatch(joinedOutput, /proof_[a-f0-9]{48}/, 'proof secret leaked through API');
assert.doesNotMatch(joinedOutput, /"ENGINE_TOKEN"|"WORKER_TOKEN"/, 'engine token label leaked through API');
for (const [name, secret] of Object.entries({
  ENGINE_TOKEN: process.env.AUDIT_ENGINE_TOKEN,
  WORKER_TOKEN: process.env.AUDIT_WORKER_TOKEN,
  BREACH5_PROOF: process.env.AUDIT_BREACH5_PROOF,
})) {
  if (secret) assert.equal(joinedOutput.includes(secret), false, `${name} value leaked through API`);
}

console.log(JSON.stringify({
  ok: true,
  roundId: players[0].roundId,
  outcome: finalState.result.outcome,
  players: players.length,
}, null, 2));
