import assert from 'node:assert/strict';
import test from 'node:test';
import { GameStore } from '../src/game.mjs';
import { CIRCUITS, CREWS, DRIVERS } from '../src/race/catalog.mjs';
import { scoreFromResults } from '../src/race/scoring.mjs';

const QUESTION_BANK = Array.from({ length: 20 }, (_, index) => ({
  id: `q${String(index + 1).padStart(2, '0')}`,
  category: `category-${index % 6}`,
  stages: ['LAUNCH', 'SECTOR', 'PIT', 'SPRINT'],
  question: `Question ${index + 1}`,
  evidence: {
    BEGINNER: [{ label: 'hint', value: `beginner-${index + 1}` }],
    ADVANCED: [{ label: 'log', value: `advanced-${index + 1}` }],
  },
  options: [
    { id: 'safe', label: 'Safe response', feedback: `Safe because ${index + 1}` },
    { id: 'unsafe', label: 'Unsafe response', feedback: `Unsafe because ${index + 1}` },
  ],
  correctOptionId: 'safe',
  explanation: `Why safe ${index + 1}`,
}));

const driversByCrew = new Map(CREWS.map((crew) => [
  crew.id,
  DRIVERS.find((driver) => driver.crewId === crew.id),
]));

function fixture({ maxPlayers = 48, seedSecret = 'heat-test-seed', sessionTtlMs } = {}) {
  let now = 0;
  let sequence = 0;
  const store = new GameStore({
    now: () => now,
    roundMs: 30_000,
    maxPlayers,
    seedSecret,
    sessionTtlMs,
    questionBank: QUESTION_BANK,
    questionBankVersion: 'heat-test-v1',
  });

  function join(overrides = {}) {
    sequence += 1;
    const crew = overrides.crewId
      ? CREWS.find(({ id }) => id === overrides.crewId)
      : CREWS[(sequence - 1) % CREWS.length];
    const driver = overrides.driverId
      ? DRIVERS.find(({ id }) => id === overrides.driverId)
      : driversByCrew.get(crew.id);
    return store.join(
      overrides.token ?? null,
      overrides.deviceId ?? sequence.toString(16).padStart(32, '0'),
      overrides.difficulty ?? 'BEGINNER',
      crew.id,
      driver.id,
    );
  }

  return {
    store,
    join,
    now: () => now,
    async setNow(value) {
      now = value;
      await store.tick();
    },
  };
}

function forbiddenTelemetry(value) {
  const text = JSON.stringify(value);
  for (const field of ['drs', 'ers', 'nitro', 'aeroActive', 'nitroDeploy']) {
    assert.doesNotMatch(text, new RegExp(`"${field}"`, 'i'), `retired telemetry leaked: ${field}`);
  }
}

test('streak uses the observed encounter range instead of the answered count', () => {
  const deck = QUESTION_BANK.slice(0, 10);
  const score = scoreFromResults(
    deck,
    [false, false, true, true, true, true, true, true, true, true],
    8,
    10,
  );
  assert.equal(score.answered, 8);
  assert.equal(score.correct, 8);
  assert.equal(score.streak, 8);
});

test('four humans wait for the minimum and the fifth human enters a new heat', async () => {
  const { store, join, setNow } = fixture();
  const firstHeat = Array.from({ length: 4 }, () => join());
  const fifth = join();
  assert.equal(new Set(firstHeat.map(({ matchId }) => matchId)).size, 1);
  assert.notEqual(fifth.matchId, firstHeat[0].matchId);

  await setNow(2_999);
  assert.equal(store.state(firstHeat[0].token).match.status, 'MATCHING');
  assert.equal(store.state(firstHeat[0].token).match.startsInMs, 1);
  await setNow(3_000);
  const started = store.state(firstHeat[0].token);
  assert.equal(started.match.status, 'GRID');
  assert.equal(started.match.humanCount, 4);
  assert.equal(started.match.aiCount, 0);
  assert.equal(started.race.racers.length, 4);
  assert.ok(started.race.racers.every(({ isAi }) => !isAi));
  assert.equal(store.state(fifth.token).match.status, 'MATCHING');
  assert.equal(store.state(fifth.token).match.humanCount, 1);
});

test('one to three humans receive deterministic AI fill exactly at maximum wait', async () => {
  for (const humans of [1, 2, 3]) {
    const { store, join, setNow } = fixture({ seedSecret: `fill-${humans}` });
    const identities = Array.from({ length: humans }, () => join());
    await setNow(4_499);
    assert.equal(store.state(identities[0].token).match.status, 'MATCHING');
    await setNow(4_500);
    const state = store.state(identities[0].token);
    assert.equal(state.match.status, 'GRID');
    assert.equal(state.match.humanCount, humans);
    assert.equal(state.match.aiCount, 4 - humans);
    assert.equal(state.race.racers.length, 4);
    assert.equal(state.race.racers.filter(({ isAi }) => isAi).length, 4 - humans);
  }
});

test('server rotates three circuits and every modeled speed stays inside its profile', async () => {
  const { store, join, setNow } = fixture();
  const racers = Array.from({ length: 9 }, () => join());
  const representatives = [racers[0], racers[4], racers[8]];
  assert.deepEqual(representatives.map(({ circuitId }) => circuitId), CIRCUITS.map(({ id }) => id));

  await setNow(5_000);
  for (const identity of representatives) {
    const state = store.state(identity.token);
    assert.equal(state.match.status, 'RACING');
    assert.equal(state.race.lap, 1);
    assert.equal(state.race.totalLaps, 2);
    assert.ok(state.race.speedKph >= state.circuit.minSpeedKph);
    assert.ok(state.race.speedKph <= state.circuit.maxSpeedKph);
    assert.ok(state.race.racers.every(({ speedKph }) => (
      speedKph >= state.circuit.minSpeedKph && speedKph <= state.circuit.maxSpeedKph
    )));
  }

  await setNow(15_000);
  for (const identity of representatives) {
    const state = store.state(identity.token);
    assert.equal(state.race.lap, 2);
    assert.ok(state.race.progress >= 0.5 && state.race.progress < 1);
  }
});

test('ten-question deck is unique and unanswered tasks never disclose the answer', async () => {
  const { store, join, setNow } = fixture();
  const racer = join({ difficulty: 'ADVANCED' });
  const match = store.matches.get(racer.matchId);
  assert.equal(match.deck.length, 10);
  assert.equal(new Set(match.deck.map(({ id }) => id)).size, 10);

  await setNow(5_000);
  const state = store.state(racer.token);
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].feedback, null);
  assert.equal(state.tasks[0].selected, null);
  assert.match(JSON.stringify(state.tasks[0].evidence), /advanced-/);
  assert.doesNotMatch(JSON.stringify(state.tasks[0]), /correctOptionId|Why safe|Safe because/);
  for (const option of state.tasks[0].options) {
    assert.equal(Object.hasOwn(option, 'correct'), false);
    assert.equal(Object.hasOwn(option, 'feedback'), false);
  }
});

test('answer verdict is immediate and action ids are replay-safe and conflict-safe', async () => {
  const { store, join, setNow } = fixture();
  const racer = join();
  await setNow(5_000);
  const state = store.state(racer.token);
  const action = {
    matchId: racer.matchId,
    task: state.tasks[0].id,
    choice: 'unsafe',
    actionId: 'action_000001',
  };
  const first = store.submit(racer.token, action);
  assert.equal(first.selected, 'unsafe');
  assert.equal(first.feedback.correct, false);
  assert.equal(first.feedback.correctOptionId, 'safe');
  assert.match(first.feedback.explanation, /Unsafe because/);
  assert.match(first.feedback.effect, /추가 페이스/);

  const replay = store.submit(racer.token, action);
  assert.equal(replay.duplicate, true);
  const { duplicate, ...replayed } = replay;
  assert.equal(duplicate, true);
  assert.deepEqual(replayed, first);
  assert.throws(() => store.submit(racer.token, { ...action, choice: 'safe' }),
    (error) => error.code === 'idempotency_conflict');
  assert.throws(() => store.submit(racer.token, { ...action, choice: 'safe', actionId: 'action_000002' }),
    (error) => error.code === 'choice_locked');
});

test('ten correct encounters produce a four-racer result and ten-item review', async () => {
  const { store, join, setNow } = fixture();
  const racer = join();
  await setNow(5_000);

  for (let index = 0; index < 10; index += 1) {
    const match = store.matches.get(racer.matchId);
    await setNow(match.encounterStartedAt + store.timing.minimumExposureMs);
    const state = store.state(racer.token);
    assert.equal(state.match.encounterNumber, index + 1);
    assert.equal(state.tasks.length, 1);
    store.submit(racer.token, {
      matchId: racer.matchId,
      task: state.tasks[0].id,
      choice: 'safe',
      actionId: `perfect_${String(index).padStart(4, '0')}`,
    });
    store.state(racer.token);
  }

  const resultState = store.state(racer.token);
  assert.equal(resultState.match.status, 'RESULT');
  assert.equal(resultState.result.outcome, 'POLE_POSITION');
  assert.equal(resultState.result.correct, 10);
  assert.equal(resultState.result.classification.length, 4);
  assert.deepEqual(resultState.result.classification.map(({ position }) => position), [1, 2, 3, 4]);
  assert.equal(resultState.result.review.length, 10);
  assert.ok(resultState.result.review.every((entry) => (
    entry.selected === 'safe'
      && entry.selectedLabel === 'Safe response'
      && entry.correctOptionId === 'safe'
      && entry.correctOptionLabel === 'Safe response'
  )));
  assert.equal(resultState.race.racers.length, 4);
  assert.equal(resultState.race.finished, true);
  assert.equal(resultState.race.totalLaps, 2);
  assert.equal(typeof resultState.race.batteryPercent, 'number');
  assert.equal(typeof resultState.race.boostMode, 'boolean');
  assert.equal(typeof resultState.race.overtakeMode, 'boolean');
  assert.equal(typeof resultState.race.activeAero, 'boolean');
  forbiddenTelemetry(resultState);
});

test('two missed encounters followed by eight correct answers produce an eight-answer streak', async () => {
  const { store, join, setNow } = fixture();
  const racer = join();
  await setNow(8_600);

  for (let index = 2; index < 10; index += 1) {
    const match = store.matches.get(racer.matchId);
    await setNow(match.encounterStartedAt + store.timing.minimumExposureMs);
    const state = store.state(racer.token);
    assert.equal(state.match.encounterNumber, index + 1);
    store.submit(racer.token, {
      matchId: racer.matchId,
      task: state.tasks[0].id,
      choice: 'safe',
      actionId: `late_streak_${String(index).padStart(4, '0')}`,
    });
    store.state(racer.token);
  }

  const result = store.state(racer.token).result;
  assert.equal(result.answered, 8);
  assert.equal(result.correct, 8);
  assert.equal(result.streak, 8);
});

test('AI field is repeatable for a seed and remains competitive with an idle human', async () => {
  const snapshots = [];
  for (let run = 0; run < 2; run += 1) {
    const { store, join, setNow } = fixture({ seedSecret: 'repeatable-ai' });
    const racer = join();
    await setNow(23_000);
    const state = store.state(racer.token);
    assert.equal(state.match.status, 'RESULT');
    const ai = state.result.classification.filter(({ isAi }) => isAi);
    assert.equal(ai.length, 3);
    assert.ok(ai.some(({ score }) => score.correct >= 5));
    assert.ok(ai.some(({ position }) => position < state.result.position));
    snapshots.push(ai.map((entry) => ({
      id: entry.id,
      driverId: entry.driverId,
      crewId: entry.crewId,
      position: entry.position,
      correct: entry.score.correct,
      pitTimeMs: entry.pitTimeMs,
    })));
  }
  assert.deepEqual(snapshots[0], snapshots[1]);
});

test('reconnect preserves identity and retry after completion creates a new heat', async () => {
  const { store, join, setNow } = fixture();
  const deviceId = 'a'.repeat(32);
  const original = join({ deviceId, crewId: 'ferrari', driverId: 'charles-leclerc' });
  const reconnect = join({
    deviceId,
    difficulty: 'ADVANCED',
    crewId: 'mercedes',
    driverId: 'george-russell',
  });
  assert.deepEqual(reconnect, original);
  assert.deepEqual(store.join(original.token, null, null, null, null), original);

  await setNow(25_500);
  assert.equal(store.state(original.token).match.status, 'COMPLETE');
  const retry = join({
    token: original.token,
    deviceId,
    difficulty: 'ADVANCED',
    crewId: 'mercedes',
    driverId: 'george-russell',
  });
  assert.notEqual(retry.token, original.token);
  assert.notEqual(retry.matchId, original.matchId);
  assert.equal(retry.difficulty, 'ADVANCED');
  assert.equal(retry.crewId, 'mercedes');
});

test('screen state separates pending and active heats', async () => {
  const { store, join, setNow } = fixture();
  const racer = join();
  const pending = store.screenState();
  assert.equal(pending.pending.length, 1);
  assert.equal(pending.active.length, 0);
  assert.equal(pending.pending[0].status, 'MATCHING');
  assert.equal(pending.pending[0].humanCount, 1);
  assert.equal(pending.pending[0].seats, 4);

  await setNow(4_500);
  const active = store.screenState();
  assert.equal(active.pending.length, 0);
  assert.equal(active.active.length, 1);
  assert.equal(active.active[0].status, 'GRID');
  assert.equal(active.active[0].standings.length, 4);
  assert.equal(store.state(racer.token).match.aiCount, 3);
});

test('forty-eight humans form twelve exact heats and capacity rejects the forty-ninth', () => {
  const { store, join } = fixture({ maxPlayers: 48 });
  const identities = Array.from({ length: 48 }, () => join());
  const groups = Map.groupBy(identities, ({ matchId }) => matchId);
  assert.equal(groups.size, 12);
  assert.ok([...groups.values()].every((group) => group.length === 4));
  assert.equal(store.activeHumanCount(), 48);
  assert.equal(store.screenState().joinMode, 'FULL');
  assert.throws(() => join(), (error) => error.code === 'capacity');
});
