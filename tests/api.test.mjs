import assert from 'node:assert/strict';
import test from 'node:test';
import { GameStore } from '../src/game.mjs';
import { createGameServer } from '../src/server.mjs';

test('HTTP API exposes race catalogs and preserves immutable reconnect identity', async (context) => {
  let now = 0;
  const store = new GameStore({ now: () => now, roundMs: 30_000, seedSecret: 'api-test-seed' });
  const server = await createGameServer({ store, publicBaseUrl: 'http://127.0.0.1:18090' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const catalogResponse = await fetch(`${origin}/api/catalog`);
  assert.equal(catalogResponse.status, 200);
  assert.equal(catalogResponse.headers.get('cache-control'), 'no-store');
  const catalog = await catalogResponse.json();
  assert.deepEqual(catalog.difficulties, ['BEGINNER', 'ADVANCED']);
  assert.deepEqual(catalog.tracks.map(({ id }) => id), ['human-firewall', 'secure-builder']);
  assert.equal(catalog.crews.length, 4);
  assert.equal(catalog.drivers.length, 8);
  for (const crew of catalog.crews) {
    assert.equal(catalog.drivers.filter(({ crewId }) => crewId === crew.id).length, 2);
  }
  const playPage = await fetch(`${origin}/play`);
  assert.equal(playPage.headers.get('cache-control'), 'no-store');
  const carAsset = await fetch(`${origin}${catalog.crews[0].asset}`);
  assert.equal(carAsset.status, 200);
  assert.equal(carAsset.headers.get('cache-control'), 'public, max-age=300');

  const deviceId = '0123456789abcdef0123456789abcdef';
  const selection = {
    deviceId,
    trackId: 'secure-builder',
    difficulty: 'ADVANCED',
    crewId: 'ferrari',
    driverId: 'charles-leclerc',
  };
  const join = await fetch(`${origin}/api/join`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(selection),
  });
  assert.equal(join.status, 201);
  assert.match(join.headers.get('content-security-policy'), /default-src 'self'/);
  const identity = await join.json();
  assert.match(identity.token, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(identity.trackId, 'secure-builder');
  assert.equal(identity.crewId, 'ferrari');
  assert.equal(identity.driverId, 'charles-leclerc');

  const immutable = await fetch(`${origin}/api/join`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceId,
      trackId: 'human-firewall',
      difficulty: 'BEGINNER',
      crewId: 'mercedes',
      driverId: 'george-russell',
    }),
  });
  assert.equal(immutable.status, 201);
  assert.deepEqual(await immutable.json(), identity);

  for (const [body, error] of [
    [{ ...selection, deviceId: '1'.repeat(32), trackId: 'invented' }, 'invalid_track'],
    [{ ...selection, deviceId: '2'.repeat(32), difficulty: 'EASY' }, 'invalid_difficulty'],
    [{ ...selection, deviceId: '3'.repeat(32), crewId: 'real-team' }, 'invalid_crew'],
    [{ ...selection, deviceId: '4'.repeat(32), driverId: 'real-driver' }, 'invalid_driver'],
    [{
      ...selection,
      deviceId: '5'.repeat(32),
      driverId: 'george-russell',
    }, 'invalid_driver'],
    [{ ...selection, deviceId: 'bad' }, 'invalid_device_id'],
  ]) {
    const response = await fetch(`${origin}/api/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error });
  }

  const unauthorized = await fetch(`${origin}/api/state`);
  assert.equal(unauthorized.status, 401);
  now = 3_000; await store.tick();
  const stateResponse = await fetch(`${origin}/api/state`, { headers: { Authorization: `Bearer ${identity.token}` } });
  const state = await stateResponse.json();
  assert.equal(state.track.id, 'secure-builder');
  assert.equal(state.player.difficulty, 'ADVANCED');
  assert.equal(state.round.phase, 'LAUNCH');
  assert.equal(state.tasks.length, 1);
  assert.doesNotMatch(JSON.stringify(state.tasks), /correctOptionId|answerId/);

  const task = state.tasks[0];
  const action = await fetch(`${origin}/api/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${identity.token}` },
    body: JSON.stringify({
      roundId: state.round.roundId,
      task: task.id,
      choice: task.options[0].id,
      actionId: 'api_action_0001',
    }),
  });
  assert.equal(action.status, 200);
  const verdict = await action.json();
  assert.equal(typeof verdict.feedback.correct, 'boolean');
  assert.equal(typeof verdict.feedback.explanation, 'string');
  assert.ok(verdict.feedback.correctOptionId);

  const screen = await fetch(`${origin}/api/screen-state`);
  const screenState = await screen.json();
  assert.equal(screenState.joinUrl, 'http://127.0.0.1:18090/play');
  assert.deepEqual(screenState.lanes.map(({ track }) => track.id), ['human-firewall', 'secure-builder']);
  assert.equal(screenState.lanes.find(({ track }) => track.id === 'secure-builder').difficultyCounts.ADVANCED, 1);

  const qr = await fetch(`${origin}/api/qr.svg`);
  assert.equal(qr.status, 200);
  assert.match(await qr.text(), /^<svg/);

  const burst = await Promise.all(Array.from({ length: 47 }, (_, index) => fetch(`${origin}/api/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...selection,
      deviceId: (index + 16).toString(16).padStart(32, '0'),
    }),
  })));
  assert.ok(burst.every(({ status }) => status === 201), 'a valid 48-player booth burst was rate-limited');
});
