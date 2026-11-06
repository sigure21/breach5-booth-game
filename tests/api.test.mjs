import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeterministicRegistry } from '../src/adjudicator.mjs';
import { GameStore } from '../src/game.mjs';
import { createGameServer } from '../src/server.mjs';

test('HTTP API requires explicit case and difficulty while preserving reconnect identity', async (context) => {
  let now = 0;
  const adjudicator = createDeterministicRegistry();
  const store = new GameStore({ now: () => now, adjudicators: adjudicator });
  const server = await createGameServer({ store, adjudicator, publicBaseUrl: 'http://127.0.0.1:18090' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const catalogResponse = await fetch(`${origin}/api/catalog`);
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json();
  assert.deepEqual(catalog.difficulties, ['BEGINNER', 'ADVANCED']);
  assert.deepEqual(catalog.scenarios.map(({ id }) => id), ['proxy-panic', 'session-heist']);

  const deviceId = '0123456789abcdef0123456789abcdef';
  const join = await fetch(`${origin}/api/join`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, scenarioId: 'session-heist', difficulty: 'ADVANCED' }),
  });
  assert.equal(join.status, 201);
  assert.match(join.headers.get('content-security-policy'), /default-src 'self'/);
  const identity = await join.json();
  assert.match(identity.token, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(identity.scenarioId, 'session-heist');
  assert.equal(identity.difficulty, 'ADVANCED');

  const immutable = await fetch(`${origin}/api/join`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, scenarioId: 'proxy-panic', difficulty: 'BEGINNER' }),
  });
  assert.equal(immutable.status, 201);
  assert.deepEqual(await immutable.json(), identity);

  for (const [body, error] of [
    [{ deviceId: '1'.repeat(32), difficulty: 'BEGINNER' }, 'invalid_scenario'],
    [{ deviceId: '2'.repeat(32), scenarioId: 'proxy-panic', difficulty: 'EASY' }, 'invalid_difficulty'],
    [{ deviceId: 'bad', scenarioId: 'proxy-panic', difficulty: 'BEGINNER' }, 'invalid_device_id'],
  ]) {
    const response = await fetch(`${origin}/api/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error });
  }

  const unauthorized = await fetch(`${origin}/api/state`);
  assert.equal(unauthorized.status, 401);
  const stateResponse = await fetch(`${origin}/api/state`, { headers: { Authorization: `Bearer ${identity.token}` } });
  const state = await stateResponse.json();
  assert.equal(state.scenario.id, 'session-heist');
  assert.equal(state.player.difficulty, 'ADVANCED');
  assert.equal(state.round.phase, 'JOIN');

  now = 15_000; await store.tick();
  now = 18_000; await store.tick();
  const discover = await fetch(`${origin}/api/state`, { headers: { Authorization: `Bearer ${identity.token}` } });
  const discoverState = await discover.json();
  assert.equal(discoverState.round.phase, 'DISCOVER');
  assert.ok(discoverState.tasks.every((task) => task.evidence.every(({ annotation }) => annotation === null)));

  const screen = await fetch(`${origin}/api/screen-state`);
  const screenState = await screen.json();
  assert.equal(screenState.joinUrl, 'http://127.0.0.1:18090/play');
  assert.deepEqual(screenState.lanes.map(({ scenario }) => scenario.id), ['proxy-panic', 'session-heist']);
  assert.equal(screenState.lanes.find(({ scenario }) => scenario.id === 'session-heist').difficultyCounts.ADVANCED, 1);

  const qr = await fetch(`${origin}/api/qr.svg`);
  assert.equal(qr.status, 200);
  assert.match(await qr.text(), /^<svg/);
});
