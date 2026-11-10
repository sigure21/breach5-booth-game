import assert from 'node:assert/strict';
import { QUESTION_BANK } from '../src/content/questions.mjs';

const target = new URL(process.env.TARGET_URL ?? 'http://127.0.0.1:18091');
const deadline = Date.now() + 30_000;
const answers = new Map(QUESTION_BANK.map((question) => [question.id, question.correctOptionId]));
let deviceSequence = 0;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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
  return { response, value };
}

function nextDeviceId() {
  deviceSequence += 1;
  return deviceSequence.toString(16).padStart(32, '0');
}

function driverFor(catalog, crew) {
  const driver = catalog.drivers.find(({ crewId }) => crewId === crew.id);
  assert.ok(driver, `${crew.id} has no compatible driver`);
  return driver;
}

async function join(catalog, overrides = {}) {
  const crew = overrides.crew ?? catalog.crews[0];
  const driver = overrides.driver ?? driverFor(catalog, crew);
  const deviceId = overrides.deviceId ?? nextDeviceId();
  const body = {
    deviceId,
    difficulty: overrides.difficulty ?? 'BEGINNER',
    crewId: crew.id,
    driverId: driver.id,
    ...(overrides.extra ?? {}),
  };
  const result = await request('/api/join', {
    token: overrides.token, method: 'POST', body,
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.value));
  return { ...result.value, deviceId, selection: body };
}

async function waitForState(player, predicate, label, timeoutMs = 8_000) {
  const stopAt = Math.min(deadline, Date.now() + timeoutMs);
  let last = null;
  while (Date.now() < stopAt) {
    const result = await request('/api/state', { token: player.token });
    assert.equal(result.response.status, 200, JSON.stringify(result.value));
    last = result.value;
    if (predicate(last)) return last;
    await sleep(20);
  }
  assert.fail(`${label} timed out; last=${JSON.stringify(last?.match ?? last)}`);
}

function assertNoPreanswerLeak(task) {
  assert.equal(task.selected, null);
  assert.equal(task.feedback, null);
  for (const forbidden of ['correct', 'correctOptionId', 'answerId', 'answer', 'explanation', 'takeaway']) {
    assert.equal(Object.hasOwn(task, forbidden), false, `${task.id} leaked ${forbidden}`);
  }
  for (const option of task.options ?? []) {
    assert.equal(Object.hasOwn(option, 'correct'), false, `${task.id}/${option.id} leaked correctness`);
    assert.equal(Object.hasOwn(option, 'feedback'), false, `${task.id}/${option.id} leaked feedback`);
  }
}

function assertNoRetiredTelemetry(value) {
  const retired = new Set(['drs', 'ers', 'nitro', 'aeroactive', 'nitrodeploy']);
  const walk = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    for (const [key, child] of Object.entries(entry)) {
      assert.equal(retired.has(key.toLowerCase()), false, `retired field leaked: ${key}`);
      walk(child);
    }
  };
  walk(value);
}

const ready = await request('/readyz');
assert.equal(ready.response.status, 200);
assert.deepEqual(ready.value, { ok: true, service: 'nitro-grid' });

const catalogResult = await request('/api/catalog');
assert.equal(catalogResult.response.status, 200);
const catalog = catalogResult.value;
assert.equal(catalog.circuits.length, 3);
assert.equal(Object.hasOwn(catalog, 'tracks'), false);
assert.equal(catalog.crews.length, 4);
assert.equal(catalog.drivers.length, 8);
assert.deepEqual(catalog.difficulties, ['BEGINNER', 'ADVANCED']);
assert.deepEqual(catalog.match, {
  seats: 4, minWaitMs: 300, maxWaitMs: 450, gridMs: 100,
  encounterMs: 300, minimumExposureMs: 75, resultMs: 300,
  totalEncounters: 10, totalLaps: 2,
});
for (const circuit of catalog.circuits) {
  assert.equal(circuit.laps, 2);
  assert.ok(circuit.minSpeedKph < circuit.maxSpeedKph && circuit.maxSpeedKph <= 360);
  assert.match(circuit.disclaimer, /게임 모델|텔레메트리가 아닙니다/);
}
for (const asset of [
  ...catalog.crews.map(({ asset }) => asset),
  ...catalog.drivers.map(({ media }) => media),
]) {
  const response = await fetch(new URL(asset, target), { signal: AbortSignal.timeout(5_000) });
  assert.equal(response.status, 200, `${asset} is missing`);
  assert.ok((await response.arrayBuffer()).byteLength > 0, `${asset} is empty`);
}

const unauthorized = await request('/api/state');
assert.equal(unauthorized.response.status, 401);
assert.deepEqual(unauthorized.value, { error: 'unauthorized' });

const firstCreatedAt = Date.now();
const fourHumans = [];
for (let index = 0; index < 4; index += 1) {
  fourHumans.push(await join(catalog, {
    extra: index === 0 ? { trackId: 'client-track-is-ignored', circuitId: catalog.circuits[2].id } : {},
  }));
}
const fifthCreatedAt = Date.now();
const fifth = await join(catalog, { crew: catalog.crews[1], difficulty: 'ADVANCED' });
assert.equal(new Set(fourHumans.map(({ matchId }) => matchId)).size, 1);
assert.notEqual(fifth.matchId, fourHumans[0].matchId);
assert.equal(fourHumans[0].circuitId, catalog.circuits[0].id);
assert.equal(fifth.circuitId, catalog.circuits[1].id);
assert.equal(Object.hasOwn(fourHumans[0], 'trackId'), false);

const pendingScreen = (await request('/api/screen-state')).value;
assert.equal(pendingScreen.pending.length, 2);
assert.equal(pendingScreen.active.length, 0);
assert.deepEqual(pendingScreen.pending.map(({ humanCount }) => humanCount), [4, 1]);

const firstStarted = await waitForState(
  fourHumans[0], ({ match }) => match.status !== 'MATCHING', 'four-human minimum wait',
);
assert.ok(Date.now() - firstCreatedAt >= catalog.match.minWaitMs - 80, 'four humans started before minimum wait');
assert.equal(firstStarted.match.humanCount, 4);
assert.equal(firstStarted.match.aiCount, 0);
assert.equal(firstStarted.race.racers.length, 4);

const fifthStarted = await waitForState(
  fifth, ({ match }) => match.status !== 'MATCHING', 'AI maximum wait',
);
assert.ok(Date.now() - fifthCreatedAt >= catalog.match.maxWaitMs - 80, 'AI fill started before maximum wait');
assert.equal(fifthStarted.match.humanCount, 1);
assert.equal(fifthStarted.match.aiCount, 3);
assert.equal(fifthStarted.race.racers.length, 4);

const reconnect = await join(catalog, {
  token: fifth.token, deviceId: fifth.deviceId, crew: catalog.crews[2], difficulty: 'BEGINNER',
});
const identityKeys = ['token', 'matchId', 'callsign', 'circuitId', 'difficulty', 'crewId', 'driverId'];
assert.deepEqual(
  Object.fromEntries(identityKeys.map((key) => [key, reconnect[key]])),
  Object.fromEntries(identityKeys.map((key) => [key, fifth[key]])),
);

let state = await waitForState(fifth, ({ match }) => match.status === 'RACING', 'race start');
const seenQuestions = new Set();
const seenLaps = new Set();
for (let encounter = 1; encounter <= 10; encounter += 1) {
  state = await waitForState(
    fifth,
    (value) => value.match.status === 'RACING'
      && value.match.encounterNumber === encounter && value.tasks.length === 1,
    `encounter ${encounter}`,
  );
  const task = state.tasks[0];
  assertNoPreanswerLeak(task);
  assert.equal(seenQuestions.has(task.id), false, `duplicate task ${task.id}`);
  seenQuestions.add(task.id);
  seenLaps.add(state.race.lap);
  assert.equal(state.race.racers.length, 4);
  assert.ok(state.race.racers.every(({ speedKph }) => (
    speedKph >= state.circuit.minSpeedKph && speedKph <= state.circuit.maxSpeedKph
  )));
  assert.equal(typeof state.race.batteryPercent, 'number');
  assert.equal(typeof state.race.boostMode, 'boolean');
  assert.equal(typeof state.race.overtakeMode, 'boolean');
  assert.equal(typeof state.race.activeAero, 'boolean');
  assertNoRetiredTelemetry(state);

  const correctChoice = answers.get(task.id);
  assert.ok(correctChoice && task.options.some(({ id }) => id === correctChoice));
  const choice = encounter === 1
    ? task.options.find(({ id }) => id !== correctChoice).id
    : correctChoice;
  const action = {
    matchId: fifth.matchId,
    task: task.id,
    choice,
    actionId: `live_${String(encounter).padStart(4, '0')}`,
  };
  const verdict = await request('/api/action', { token: fifth.token, method: 'POST', body: action });
  assert.equal(verdict.response.status, 200, JSON.stringify(verdict.value));
  assert.equal(verdict.value.feedback.correct, encounter !== 1);
  assert.match(verdict.value.feedback.explanation, /\S/);
  assert.match(verdict.value.feedback.effect, /\S/);

  if (encounter === 1) {
    const replay = await request('/api/action', { token: fifth.token, method: 'POST', body: action });
    assert.equal(replay.response.status, 200);
    assert.equal(replay.value.duplicate, true);
    const conflict = await request('/api/action', {
      token: fifth.token, method: 'POST', body: { ...action, choice: correctChoice },
    });
    assert.equal(conflict.response.status, 409);
    assert.deepEqual(conflict.value, { error: 'idempotency_conflict' });
  }

  await waitForState(
    fifth,
    (value) => value.match.status === 'RESULT'
      || (value.match.status === 'RACING' && value.match.encounterNumber > encounter),
    `advance after encounter ${encounter}`,
  );
}

assert.equal(seenQuestions.size, 10);
assert.deepEqual([...seenLaps].sort(), [1, 2]);
const resultState = await waitForState(fifth, ({ match }) => match.status === 'RESULT', 'result');
assert.equal(resultState.result.classification.length, 4);
assert.deepEqual(resultState.result.classification.map(({ position }) => position), [1, 2, 3, 4]);
assert.equal(resultState.result.review.length, 10);
assert.equal(resultState.result.answered, 10);
assert.equal(resultState.result.correct, 9);
assertNoRetiredTelemetry(resultState);
const resultScreen = (await request('/api/screen-state')).value;
assert.ok(resultScreen.active.some(({ id, status }) => id === fifth.matchId && status === 'RESULT'));

await waitForState(fifth, ({ match }) => match.status === 'COMPLETE', 'completion');
const retry = await join(catalog, {
  token: fifth.token, deviceId: fifth.deviceId, crew: catalog.crews[2], difficulty: 'ADVANCED',
});
assert.notEqual(retry.token, fifth.token);
assert.notEqual(retry.matchId, fifth.matchId);
assert.equal(retry.circuitId, catalog.circuits[2].id);
await waitForState(retry, ({ match }) => match.status === 'COMPLETE', 'retry heat completion', 6_000);

while (Date.now() < deadline) {
  const screen = (await request('/api/screen-state')).value;
  if (screen.pending.length === 0 && screen.active.length === 0) break;
  await sleep(25);
}
const clearScreen = (await request('/api/screen-state')).value;
assert.equal(clearScreen.pending.length, 0);
assert.equal(clearScreen.active.length, 0);

const burst = await Promise.all(Array.from({ length: 48 }, () => join(catalog)));
const groups = Map.groupBy(burst, ({ matchId }) => matchId);
assert.equal(groups.size, 12);
assert.ok([...groups.values()].every((group) => group.length === 4));
const capacity = await request('/api/join', {
  method: 'POST',
  body: {
    deviceId: nextDeviceId(),
    difficulty: 'BEGINNER',
    crewId: catalog.crews[0].id,
    driverId: driverFor(catalog, catalog.crews[0]).id,
  },
});
assert.equal(capacity.response.status, 429);
assert.deepEqual(capacity.value, { error: 'capacity' });
const fullScreen = (await request('/api/screen-state')).value;
assert.equal(fullScreen.joinMode, 'FULL');
assert.equal(fullScreen.pending.length + fullScreen.active.length, 12);
assert.ok([...fullScreen.pending, ...fullScreen.active]
  .every(({ humanCount, seats }) => humanCount === 4 && seats === 4));

console.log('NITRO GRID live heat contract passed.');
