import assert from 'node:assert/strict';
import test from 'node:test';
import { QUESTION_BANK } from '../src/content/questions.mjs';
import { GameStore } from '../src/game.mjs';
import { createGameServer } from '../src/server.mjs';

const answers = new Map(QUESTION_BANK.map((question) => [question.id, question.correctOptionId]));

async function harness(context, { maxPlayers = 48, seedSecret = 'api-heat-test' } = {}) {
  let now = 0;
  const store = new GameStore({
    now: () => now,
    roundMs: 300_000,
    matchMinWaitMs: 300,
    matchMaxWaitMs: 450,
    gridMs: 100,
    encounterMs: 300,
    minimumExposureMs: 75,
    resultMs: 300,
    maxPlayers,
    seedSecret,
  });
  const server = await createGameServer({ store, publicBaseUrl: 'http://127.0.0.1:18090' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  return {
    store,
    origin: `http://127.0.0.1:${server.address().port}`,
    async setNow(value) {
      now = value;
      await store.tick();
    },
  };
}

async function request(origin, path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await response.json().catch(() => null);
  return { response, value };
}

function selection(deviceId, overrides = {}) {
  return {
    deviceId,
    difficulty: 'BEGINNER',
    crewId: 'red-bull-racing',
    driverId: 'max-verstappen',
    ...overrides,
  };
}

test('HTTP catalog and join contract remove client track choice and preserve reconnect identity', async (context) => {
  const { origin, setNow } = await harness(context);
  const ready = await request(origin, '/readyz');
  assert.equal(ready.response.status, 200);
  assert.deepEqual(ready.value, { ok: true, service: 'nitro-grid' });

  const catalogResult = await request(origin, '/api/catalog');
  assert.equal(catalogResult.response.status, 200);
  assert.equal(catalogResult.response.headers.get('cache-control'), 'no-store');
  const catalog = catalogResult.value;
  assert.equal(catalog.circuits.length, 3);
  assert.equal(Object.hasOwn(catalog, 'tracks'), false);
  assert.deepEqual(catalog.difficulties, ['BEGINNER', 'ADVANCED']);
  assert.equal(catalog.crews.length, 4);
  assert.equal(catalog.drivers.length, 8);
  assert.deepEqual(catalog.match, {
    seats: 4,
    minWaitMs: 300,
    maxWaitMs: 450,
    gridMs: 100,
    encounterMs: 300,
    minimumExposureMs: 75,
    resultMs: 300,
    totalEncounters: 10,
    totalLaps: 2,
  });

  const play = await fetch(`${origin}/play`);
  assert.equal(play.status, 200);
  assert.match(play.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(play.headers.get('cache-control'), 'no-store');
  const car = await fetch(`${origin}${catalog.crews[0].asset}`);
  assert.equal(car.status, 200);
  assert.equal(car.headers.get('cache-control'), 'public, max-age=300');

  const deviceId = '1'.repeat(32);
  const joinResult = await request(origin, '/api/join', {
    method: 'POST',
    body: selection(deviceId, {
      trackId: 'attacker-selected-track',
      circuitId: catalog.circuits[2].id,
      difficulty: 'ADVANCED',
      crewId: 'ferrari',
      driverId: 'charles-leclerc',
    }),
  });
  assert.equal(joinResult.response.status, 201);
  const identity = joinResult.value;
  assert.match(identity.token, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(identity.circuitId, catalog.circuits[0].id, 'server circuit rotation was overridden');
  assert.equal(Object.hasOwn(identity, 'trackId'), false);

  const reconnect = await request(origin, '/api/join', {
    method: 'POST',
    body: selection(deviceId, {
      difficulty: 'BEGINNER', crewId: 'mercedes', driverId: 'george-russell',
    }),
  });
  assert.equal(reconnect.response.status, 201);
  assert.deepEqual(reconnect.value, identity);

  for (const [body, error] of [
    [selection('2'.repeat(32), { difficulty: 'EASY' }), 'invalid_difficulty'],
    [selection('3'.repeat(32), { crewId: 'invented-crew' }), 'invalid_crew'],
    [selection('4'.repeat(32), { driverId: 'invented-driver' }), 'invalid_driver'],
    [selection('5'.repeat(32), { driverId: 'george-russell' }), 'invalid_driver'],
    [selection('bad'), 'invalid_device_id'],
  ]) {
    const invalid = await request(origin, '/api/join', { method: 'POST', body });
    assert.equal(invalid.response.status, 400);
    assert.deepEqual(invalid.value, { error });
  }

  const unauthorized = await request(origin, '/api/state');
  assert.equal(unauthorized.response.status, 401);
  assert.deepEqual(unauthorized.value, { error: 'unauthorized' });

  await setNow(550);
  const stateResult = await request(origin, '/api/state', { token: identity.token });
  assert.equal(stateResult.response.status, 200);
  assert.equal(stateResult.value.match.status, 'RACING');
  assert.equal(stateResult.value.match.circuit.id, catalog.circuits[0].id);
  assert.equal(stateResult.value.tasks.length, 1);
  assert.doesNotMatch(JSON.stringify(stateResult.value.tasks), /correctOptionId|explanation|takeaway/);

  const task = stateResult.value.tasks[0];
  const wrongChoice = task.options.find(({ id }) => id !== answers.get(task.id)).id;
  const actionBody = {
    matchId: identity.matchId,
    task: task.id,
    choice: wrongChoice,
    actionId: 'api_000001',
  };
  const action = await request(origin, '/api/action', {
    token: identity.token, method: 'POST', body: actionBody,
  });
  assert.equal(action.response.status, 200);
  assert.equal(action.value.feedback.correct, false);
  assert.equal(action.value.feedback.correctOptionId, answers.get(task.id));
  assert.match(action.value.feedback.explanation, /\S/);

  const duplicate = await request(origin, '/api/action', {
    token: identity.token, method: 'POST', body: actionBody,
  });
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.value.duplicate, true);
  const conflict = await request(origin, '/api/action', {
    token: identity.token,
    method: 'POST',
    body: { ...actionBody, choice: answers.get(task.id) },
  });
  assert.equal(conflict.response.status, 409);
  assert.deepEqual(conflict.value, { error: 'idempotency_conflict' });

  const screen = await request(origin, '/api/screen-state');
  assert.equal(screen.response.status, 200);
  assert.equal(screen.value.joinUrl, 'http://127.0.0.1:18090/play');
  assert.equal(screen.value.pending.length, 0);
  assert.equal(screen.value.active.length, 1);
  assert.equal(screen.value.active[0].standings.length, 4);
  const qr = await fetch(`${origin}/api/qr.svg`);
  assert.equal(qr.status, 200);
  assert.match(await qr.text(), /^<svg/);
});

test('HTTP heat assignment starts exact four after minimum and puts fifth in next heat', async (context) => {
  const { origin, setNow } = await harness(context, { seedSecret: 'api-grouping' });
  const joins = [];
  for (let index = 0; index < 5; index += 1) {
    const result = await request(origin, '/api/join', {
      method: 'POST', body: selection((index + 10).toString(16).padStart(32, '0')),
    });
    assert.equal(result.response.status, 201);
    joins.push(result.value);
  }
  assert.equal(new Set(joins.slice(0, 4).map(({ matchId }) => matchId)).size, 1);
  assert.notEqual(joins[4].matchId, joins[0].matchId);

  await setNow(299);
  assert.equal((await request(origin, '/api/state', { token: joins[0].token })).value.match.status, 'MATCHING');
  await setNow(300);
  const first = (await request(origin, '/api/state', { token: joins[0].token })).value;
  const fifth = (await request(origin, '/api/state', { token: joins[4].token })).value;
  assert.equal(first.match.status, 'GRID');
  assert.equal(first.match.humanCount, 4);
  assert.equal(first.match.aiCount, 0);
  assert.equal(first.race.racers.length, 4);
  assert.equal(fifth.match.status, 'MATCHING');
});

test('HTTP result exposes four ordered racers and ten review entries, then retry opens a new heat', async (context) => {
  const { store, origin, setNow } = await harness(context, { seedSecret: 'api-result' });
  const deviceId = 'b'.repeat(32);
  const joined = await request(origin, '/api/join', { method: 'POST', body: selection(deviceId) });
  const identity = joined.value;
  await setNow(550);

  for (let index = 0; index < 10; index += 1) {
    const match = store.matches.get(identity.matchId);
    await setNow(match.encounterStartedAt + 75);
    const state = (await request(origin, '/api/state', { token: identity.token })).value;
    const task = state.tasks[0];
    const action = await request(origin, '/api/action', {
      token: identity.token,
      method: 'POST',
      body: {
        matchId: identity.matchId,
        task: task.id,
        choice: answers.get(task.id),
        actionId: `result_${String(index).padStart(4, '0')}`,
      },
    });
    assert.equal(action.response.status, 200);
    await request(origin, '/api/state', { token: identity.token });
  }

  const finished = (await request(origin, '/api/state', { token: identity.token })).value;
  assert.equal(finished.match.status, 'RESULT');
  assert.equal(finished.result.classification.length, 4);
  assert.deepEqual(finished.result.classification.map(({ position }) => position), [1, 2, 3, 4]);
  assert.equal(finished.result.review.length, 10);
  assert.equal(finished.result.correct, 10);

  const match = store.matches.get(identity.matchId);
  await setNow(match.resultEndsAt);
  assert.equal((await request(origin, '/api/state', { token: identity.token })).value.match.status, 'COMPLETE');
  const retry = await request(origin, '/api/join', {
    token: identity.token,
    method: 'POST',
    body: selection(deviceId, { difficulty: 'ADVANCED' }),
  });
  assert.equal(retry.response.status, 201);
  assert.notEqual(retry.value.token, identity.token);
  assert.notEqual(retry.value.matchId, identity.matchId);
});

test('HTTP accepts a 48-human burst as twelve heats and rejects only the 49th for capacity', async (context) => {
  const { origin } = await harness(context, { maxPlayers: 48, seedSecret: 'api-capacity' });
  const burst = await Promise.all(Array.from({ length: 48 }, (_, index) => request(origin, '/api/join', {
    method: 'POST',
    body: selection((index + 100).toString(16).padStart(32, '0')),
  })));
  assert.ok(burst.every(({ response }) => response.status === 201), 'valid burst was rate-limited');
  const groups = Map.groupBy(burst.map(({ value }) => value), ({ matchId }) => matchId);
  assert.equal(groups.size, 12);
  assert.ok([...groups.values()].every((group) => group.length === 4));

  const over = await request(origin, '/api/join', {
    method: 'POST', body: selection('f'.repeat(32)),
  });
  assert.equal(over.response.status, 429);
  assert.deepEqual(over.value, { error: 'capacity' });
  const screen = (await request(origin, '/api/screen-state')).value;
  assert.equal(screen.joinMode, 'FULL');
  assert.equal(screen.pending.length, 12);
});
