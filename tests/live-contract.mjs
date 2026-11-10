import assert from 'node:assert/strict';
import { QUESTION_BANK } from '../src/content/questions.mjs';

const target = new URL(process.env.TARGET_URL ?? 'http://127.0.0.1:18091');
const deadline = Date.now() + 120_000;
const answerByQuestion = new Map(QUESTION_BANK.map((question) => [question.id, question.correctOptionId]));
const observed = [];
let deviceSequence = 0;
let actionSequence = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function observeResponse(response, body = '') {
  observed.push(JSON.stringify({
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body,
  }));
}

async function request(path, {
  token, method = 'GET', body, record = true,
} = {}) {
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
  if (record) observeResponse(response, value);
  return { response, value };
}

function nextDeviceId() {
  deviceSequence += 1;
  return deviceSequence.toString(16).padStart(32, '0');
}

function driverFor(catalog, crewId) {
  const driver = catalog.drivers.find((entry) => entry.crewId === crewId);
  assert.ok(driver, `crew ${crewId} has no compatible driver`);
  return driver;
}

async function join(catalog, {
  track, difficulty, crew, driver = driverFor(catalog, crew.id), deviceId = nextDeviceId(),
}) {
  const selection = {
    deviceId,
    trackId: track.id,
    difficulty,
    crewId: crew.id,
    driverId: driver.id,
  };
  const { response, value } = await request('/api/join', { method: 'POST', body: selection });
  assert.equal(response.status, 201, JSON.stringify(value));
  assert.deepEqual({
    trackId: value.trackId,
    difficulty: value.difficulty,
    crewId: value.crewId,
    driverId: value.driverId,
  }, {
    trackId: selection.trackId,
    difficulty: selection.difficulty,
    crewId: selection.crewId,
    driverId: selection.driverId,
  });
  return { ...value, selection };
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

function publicTaskShape(state) {
  return (state.tasks ?? []).map((task) => ({
    id: task.id,
    phase: task.racePhase,
    gridPosition: task.gridPosition,
    options: task.options.map(({ id, label, technical }) => ({ id, label, technical })),
  }));
}

async function waitForSafeJoinWindow() {
  while (Date.now() < deadline) {
    const { value } = await request('/api/screen-state', { record: false });
    const elapsed = Number(value.round?.elapsedMs);
    if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= 1_500) return value;
    await sleep(100);
  }
  assert.fail('could not reach a stable join window');
}

async function submitVisible(player, state) {
  for (const task of state.tasks ?? []) {
    if (task.selected) continue;
    assertNoPreanswerLeak(task);
    const choice = answerByQuestion.get(task.id);
    assert.ok(choice, `no source answer for ${task.id}`);
    assert.ok(task.options.some(({ id }) => id === choice), `${task.id} omitted its answer option`);

    actionSequence += 1;
    const action = {
      roundId: state.round.roundId,
      task: task.id,
      choice,
      actionId: `live_${String(actionSequence).padStart(6, '0')}_${task.id}`,
    };
    const first = await request('/api/action', {
      token: player.token,
      method: 'POST',
      body: action,
    });
    assert.equal(first.response.status, 200, JSON.stringify(first.value));
    assert.equal(first.value.selected, choice);
    assert.equal(first.value.feedback.correct, true);
    assert.equal(first.value.feedback.correctOptionId, choice);
    assert.match(first.value.feedback.explanation, /\S/);
    assert.match(first.value.feedback.effect, /\S/);
    assert.equal(typeof first.value.race.correct, 'number');

    const duplicate = await request('/api/action', {
      token: player.token,
      method: 'POST',
      body: action,
    });
    assert.equal(duplicate.response.status, 200, JSON.stringify(duplicate.value));
    assert.equal(duplicate.value.duplicate, true);
    const { duplicate: replayed, ...replayedResponse } = duplicate.value;
    assert.equal(replayed, true);
    assert.deepEqual(replayedResponse, first.value);

    const otherChoice = task.options.find(({ id }) => id !== choice)?.id;
    assert.ok(otherChoice);
    const conflict = await request('/api/action', {
      token: player.token,
      method: 'POST',
      body: { ...action, choice: otherChoice },
    });
    assert.equal(conflict.response.status, 409);
    assert.deepEqual(conflict.value, { error: 'idempotency_conflict' });

    const persisted = await request('/api/state', { token: player.token });
    assert.equal(persisted.response.status, 200);
    const saved = persisted.value.tasks?.find(({ id }) => id === task.id);
    if (saved) {
      assert.equal(saved.selected, choice);
      assert.equal(saved.feedback.correct, true);
      assert.equal(saved.feedback.correctOptionId, choice);
      assert.match(saved.feedback.explanation, /\S/);
    }
  }
}

const ready = await fetch(new URL('/readyz', target), {
  cache: 'no-store',
  signal: AbortSignal.timeout(5_000),
});
assert.equal(ready.status, 200);
const readyBody = await ready.json();
observeResponse(ready, readyBody);
assert.deepEqual(readyBody, { ok: true, service: 'nitro-grid' });

const catalogResponse = await request('/api/catalog');
assert.equal(catalogResponse.response.status, 200);
const catalog = catalogResponse.value;
assert.deepEqual(catalog.difficulties, ['BEGINNER', 'ADVANCED']);
assert.deepEqual(catalog.tracks.map(({ id }) => id), ['human-firewall', 'secure-builder']);
assert.equal(catalog.crews.length, 4);
assert.equal(catalog.drivers.length, 8);
assert.equal(new Set(catalog.crews.map(({ id }) => id)).size, 4);
assert.equal(new Set(catalog.drivers.map(({ id }) => id)).size, 8);
for (const crew of catalog.crews) {
  assert.equal(catalog.drivers.filter(({ crewId }) => crewId === crew.id).length, 2);
  assert.match(crew.asset, /^\/assets\/cars\/[a-z0-9-]+\.svg$/);
}
for (const driver of catalog.drivers) {
  assert.ok(catalog.crews.some(({ id }) => id === driver.crewId));
  assert.match(driver.media, /^\/assets\/driver-panels\/[a-z0-9-]+\.webp$/);
  assert.match(driver.sourceUrl, /^https:\/\//);
}

for (const asset of [
  ...catalog.crews.map(({ asset }) => asset),
  ...catalog.drivers.map(({ media }) => media),
]) {
  const response = await fetch(new URL(asset, target), {
    cache: 'no-store',
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(response.status, 200, `${asset} is not published`);
  assert.match(response.headers.get('content-type') ?? '', asset.endsWith('.webp') ? /^image\/webp/ : /^image\/svg\+xml/);
  observeResponse(response, { asset, bytes: (await response.arrayBuffer()).byteLength });
}

const baseSelection = {
  deviceId: nextDeviceId(),
  trackId: catalog.tracks[0].id,
  difficulty: 'BEGINNER',
  crewId: catalog.crews[0].id,
  driverId: driverFor(catalog, catalog.crews[0].id).id,
};
for (const [body, error] of [
  [{ ...baseSelection, deviceId: nextDeviceId(), trackId: 'invented-track' }, 'invalid_track'],
  [{ ...baseSelection, deviceId: nextDeviceId(), difficulty: 'EASY' }, 'invalid_difficulty'],
  [{ ...baseSelection, deviceId: nextDeviceId(), crewId: 'invented-crew' }, 'invalid_crew'],
  [{ ...baseSelection, deviceId: nextDeviceId(), driverId: 'invented-driver' }, 'invalid_driver'],
  [{
    ...baseSelection,
    deviceId: nextDeviceId(),
    driverId: driverFor(catalog, catalog.crews[1].id).id,
  }, 'invalid_driver'],
  [{ ...baseSelection, deviceId: 'bad' }, 'invalid_device_id'],
]) {
  const invalid = await request('/api/join', { method: 'POST', body });
  assert.equal(invalid.response.status, 400, JSON.stringify(invalid.value));
  assert.deepEqual(invalid.value, { error });
}

const unauthorized = await request('/api/state');
assert.equal(unauthorized.response.status, 401);
assert.deepEqual(unauthorized.value, { error: 'unauthorized' });

const initialScreen = (await request('/api/screen-state')).value;
assert.equal(initialScreen.joinUrl, new URL('/play', target).toString());
assert.equal(initialScreen.lanes.length, 2);
assert.deepEqual(initialScreen.lanes.map(({ track }) => track.id), catalog.tracks.map(({ id }) => id));
const qr = await fetch(new URL('/api/qr.svg', target), {
  cache: 'no-store',
  signal: AbortSignal.timeout(5_000),
});
assert.equal(qr.status, 200);
const qrBody = await qr.text();
observeResponse(qr, qrBody.slice(0, 200));
assert.match(qrBody, /^<svg/);

await waitForSafeJoinWindow();
const players = [
  await join(catalog, {
    track: catalog.tracks[0],
    difficulty: 'BEGINNER',
    crew: catalog.crews[0],
  }),
  await join(catalog, {
    track: catalog.tracks[0],
    difficulty: 'ADVANCED',
    crew: catalog.crews[1],
  }),
  await join(catalog, {
    track: catalog.tracks[1],
    difficulty: 'BEGINNER',
    crew: catalog.crews[2],
  }),
  await join(catalog, {
    track: catalog.tracks[1],
    difficulty: 'ADVANCED',
    crew: catalog.crews[3],
  }),
];
assert.equal(new Set(players.map(({ roundId }) => roundId.split('-').at(0))).size, 1);

const immutable = await request('/api/join', {
  token: players[0].token,
  method: 'POST',
  body: {
    deviceId: players[0].selection.deviceId,
    trackId: catalog.tracks[1].id,
    difficulty: 'ADVANCED',
    crewId: catalog.crews[3].id,
    driverId: driverFor(catalog, catalog.crews[3].id).id,
  },
});
assert.equal(immutable.response.status, 201);
assert.deepEqual(immutable.value, {
  token: players[0].token,
  roundId: players[0].roundId,
  callsign: players[0].callsign,
  trackId: players[0].trackId,
  difficulty: players[0].difficulty,
  crewId: players[0].crewId,
  driverId: players[0].driverId,
});

const decks = new Map(players.map(({ token }) => [token, []]));
const seen = new Map(players.map(({ token }) => [token, new Set()]));
const comparableTrackDecks = new Set();
const finalStates = new Map();
let latePlayer = null;
let beginnerEvidenceSeen = false;
let advancedEvidenceSeen = false;

while (Date.now() < deadline && finalStates.size < players.length) {
  const snapshots = [];
  for (const player of players) {
    const stateResponse = await request('/api/state', { token: player.token, record: false });
    assert.equal(stateResponse.response.status, 200, JSON.stringify(stateResponse.value));
    const state = stateResponse.value;
    assert.equal(state.player.trackId, player.trackId);
    assert.equal(state.player.difficulty, player.difficulty);
    assert.equal(state.player.crewId, player.crewId);
    assert.equal(state.player.driverId, player.driverId);
    snapshots.push({ player, state });

    for (const task of state.tasks ?? []) {
      if (!seen.get(player.token).has(task.id)) {
        seen.get(player.token).add(task.id);
        decks.get(player.token).push(task.id);
      }
      if (!task.selected) assertNoPreanswerLeak(task);
    }
    const annotations = (state.tasks ?? [])
      .flatMap((task) => task.evidence ?? [])
      .map((item) => item.annotation);
    if (state.tasks?.length && player.difficulty === 'BEGINNER') {
      assert.ok(annotations.some((value) => typeof value === 'string' && value.length > 0));
      beginnerEvidenceSeen = true;
    }
    if (state.tasks?.length && player.difficulty === 'ADVANCED') {
      assert.ok(annotations.every((value) => value == null));
      advancedEvidenceSeen = true;
    }
    if (state.result) finalStates.set(player.token, state);
  }

  for (const track of catalog.tracks) {
    const sameTrack = snapshots.filter(({ player }) => player.trackId === track.id);
    const active = sameTrack.filter(({ state }) => state.tasks?.length);
    if (active.length === 2 && active[0].state.round.phase === active[1].state.round.phase) {
      assert.deepEqual(publicTaskShape(active[0].state), publicTaskShape(active[1].state));
      comparableTrackDecks.add(track.id);
    }
  }

  if (!latePlayer) {
    const active = snapshots.find(({ state }) => ['LAUNCH', 'SECTOR_1', 'PIT_STOP', 'SECTOR_2', 'SPRINT'].includes(state.round.phase));
    if (active) {
      latePlayer = await join(catalog, {
        track: catalog.tracks[1],
        difficulty: 'BEGINNER',
        crew: catalog.crews[0],
      });
      assert.notEqual(latePlayer.roundId, active.player.roundId);
      const queued = await request('/api/state', { token: latePlayer.token });
      assert.equal(queued.response.status, 200);
      assert.equal(queued.value.round.phase, 'QUEUED');
      assert.equal(queued.value.queue.selectedTrack, catalog.tracks[1].id);
    }
  }

  for (const { player, state } of snapshots) {
    if (!state.result) await submitVisible(player, state);
  }
  if (finalStates.size < players.length) await sleep(50);
}

assert.equal(finalStates.size, players.length, 'both tracks and both difficulties must finish');
assert.deepEqual(comparableTrackDecks, new Set(catalog.tracks.map(({ id }) => id)), 'each track must expose a comparable same-phase deck');
assert.equal(beginnerEvidenceSeen, true);
assert.equal(advancedEvidenceSeen, true);
assert.ok(latePlayer, 'late-join queue was not exercised');

for (const player of players) {
  const state = finalStates.get(player.token);
  assert.deepEqual(decks.get(player.token).length, 7);
  assert.equal(new Set(decks.get(player.token)).size, 7);
  assert.equal(state.race.answered, 7);
  assert.equal(state.race.possible, 7);
  assert.equal(state.race.correct, 7);
  assert.equal(state.race.accuracy, 100);
  assert.equal(state.race.launchBoost, true);
  assert.equal(state.race.nitro, 3);
  assert.equal(state.race.pitTimeMs, 1_900);
  assert.equal(state.race.aeroActive, true);
  assert.equal(state.race.nitroDeploy, true);
  assert.equal(state.result.outcome, 'POLE_POSITION');
  assert.equal(state.result.finishBand, 'POLE_POSITION');
  assert.equal(state.result.review.length, 7);
  assert.ok(state.result.review.every((entry) => (
    entry.correct
    && entry.correctOptionId === answerByQuestion.get(entry.id)
    && typeof entry.selectedLabel === 'string'
    && entry.selectedLabel.length > 0
    && entry.selectedLabel === entry.correctOptionLabel
    && entry.selectedLabel !== entry.selected
  )));
  const restored = (await request('/api/state', { token: player.token })).value;
  assert.deepEqual(
    restored.result.review.map(({ selectedLabel, correctOptionLabel }) => ({ selectedLabel, correctOptionLabel })),
    state.result.review.map(({ selectedLabel, correctOptionLabel }) => ({ selectedLabel, correctOptionLabel })),
    'result labels changed after reconnect',
  );
}
for (const track of catalog.tracks) {
  const pair = players.filter((player) => player.trackId === track.id);
  assert.deepEqual(decks.get(pair[0].token), decks.get(pair[1].token), `${track.id} deck changed by difficulty`);
}

const finalScreen = (await request('/api/screen-state')).value;
assert.equal(finalScreen.lanes.length, 2);
assert.equal(finalScreen.nextRound.total >= 1, true);
assert.equal(finalScreen.joinMode, 'NEXT');
assert.equal(finalScreen.stats.finishes, 4);
assert.equal(finalScreen.stats.perfectLaps, 4);
assert.equal(finalScreen.stats.polePositions, 4);
for (const lane of finalScreen.lanes) {
  assert.equal(lane.leaderboard.length, 2);
  assert.ok(lane.leaderboard.every((entry) => entry.correct === 7 && entry.possible === 7));
}
assert.doesNotMatch(JSON.stringify(finalScreen), /correctOptionId|answerId|explanation/);

const joinedOutput = observed.join('\n');
assert.doesNotMatch(joinedOutput, /NITRO_GRID_SEED_SECRET|seedSecret/);
assert.doesNotMatch(joinedOutput, /[a-f0-9]{64}/i, 'a 32-byte hexadecimal secret leaked through a public response');
assert.doesNotMatch(joinedOutput, /(?:ENGINE|WORKER|SESSION_ENGINE|SESSION_SIGNING|PROOF)_TOKEN/);

console.log(JSON.stringify({
  ok: true,
  tracks: catalog.tracks.map(({ id }) => id),
  difficulties: catalog.difficulties,
  drivers: catalog.drivers.length,
  answersPerPlayer: 7,
  queuedRound: latePlayer.roundId,
}, null, 2));
