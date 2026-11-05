import assert from 'node:assert/strict';
import test from 'node:test';
import { DeterministicAdjudicator } from '../src/adjudicator.mjs';
import { GameStore } from '../src/game.mjs';
import { createGameServer } from '../src/server.mjs';

test('HTTP API joins anonymously and protects player state', async (context) => {
  let now = 0;
  const adjudicator = new DeterministicAdjudicator();
  const store = new GameStore({ now: () => now, adjudicator });
  const server = await createGameServer({ store, adjudicator, publicBaseUrl: 'http://127.0.0.1:18090' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  const deviceId = '0123456789abcdef0123456789abcdef';
  const join = await fetch(`${origin}/api/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId }),
  });
  assert.equal(join.status, 201);
  assert.match(join.headers.get('content-security-policy'), /default-src 'self'/);
  const identity = await join.json();
  assert.match(identity.token, /^[A-Za-z0-9_-]{32}$/);
  assert.match(identity.callsign, /^[A-Z]+-[A-Z]+-[0-9]{2}$/);

  const deviceRejoin = await fetch(`${origin}/api/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId }),
  });
  assert.equal(deviceRejoin.status, 201);
  assert.deepEqual(await deviceRejoin.json(), identity);

  const invalidDevice = await fetch(`${origin}/api/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: 'not-a-device-id' }),
  });
  assert.equal(invalidDevice.status, 400);
  assert.deepEqual(await invalidDevice.json(), { error: 'invalid_device_id' });

  const unauthorized = await fetch(`${origin}/api/state`);
  assert.equal(unauthorized.status, 401);

  const stateResponse = await fetch(`${origin}/api/state`, { headers: { Authorization: `Bearer ${identity.token}` } });
  assert.equal(stateResponse.status, 200);
  const state = await stateResponse.json();
  assert.equal(state.player.callsign, identity.callsign);
  assert.equal(state.round.phase, 'JOIN');

  const qr = await fetch(`${origin}/api/qr.svg`);
  assert.equal(qr.status, 200);
  assert.match(await qr.text(), /^<svg/);

  const screen = await fetch(`${origin}/api/screen-state`);
  assert.equal(screen.status, 200);
  const screenState = await screen.json();
  assert.equal(screenState.joinUrl, 'http://127.0.0.1:18090/play');
  assert.equal(screenState.joinMode, 'CURRENT');
  assert.equal(screenState.nextRound.total, 0);

  now = 50_000;
  const refreshed = await fetch(`${origin}/api/state`, { headers: { Authorization: `Bearer ${identity.token}` } });
  assert.equal((await refreshed.json()).round.phase, 'DISCOVER');
});
