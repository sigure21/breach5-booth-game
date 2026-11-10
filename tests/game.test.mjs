import assert from 'node:assert/strict';
import test from 'node:test';
import { GameStore } from '../src/game.mjs';
import { buildRaceDeck } from '../src/race/seed.mjs';

const QUESTION_BANK = Array.from({ length: 12 }, (_, index) => ({
  id: `q${index + 1}`,
  category: `category-${index % 7}`,
  question: `Question ${index + 1}`,
  evidence: {
    BEGINNER: [{ label: 'hint', value: `beginner-${index + 1}` }],
    ADVANCED: [{ label: 'log', value: `advanced-${index + 1}` }],
  },
  options: [
    { id: 'safe', label: 'Safe response' },
    { id: 'unsafe', label: 'Unsafe response' },
  ],
  correctOptionId: 'safe',
  explanation: `Why safe ${index + 1}`,
}));

function fixture({ maxPlayers = 48, seedSecret = 'test-seed', sessionTtlMs } = {}) {
  let now = 0;
  let device = 0;
  const store = new GameStore({
    now: () => now,
    roundMs: 30_000,
    epochMs: 0,
    maxPlayers,
    seedSecret,
    sessionTtlMs,
    questionBank: QUESTION_BANK,
    questionBankVersion: 'test-v1',
  });
  const join = (overrides = {}) => {
    device += 1;
    return store.join(
      null,
      device.toString(16).padStart(32, '0'),
      overrides.trackId ?? 'human-firewall',
      overrides.difficulty ?? 'BEGINNER',
      overrides.crewId ?? 'red-bull-racing',
      overrides.driverId ?? 'max-verstappen',
    );
  };
  return { store, join, setNow: (value) => { now = value; }, getNow: () => now };
}

function answerVisible(store, identity, choice = 'safe', counter = { value: 1 }) {
  const state = store.state(identity.token);
  for (const task of state.tasks) {
    const response = store.submit(identity.token, {
      roundId: state.round.roundId,
      task: task.id,
      choice,
      actionId: `action_${String(counter.value).padStart(4, '0')}`,
    });
    counter.value += 1;
    assert.equal(response.feedback.correct, choice === 'safe');
  }
  return state.tasks.length;
}

test('HMAC deck is deterministic, unique, balanced, and phase-quota bound', () => {
  const input = { ordinal: 4, trackId: 'secure-builder', version: 'v1', secret: 'fixed' };
  const first = buildRaceDeck(QUESTION_BANK, input);
  const second = buildRaceDeck(QUESTION_BANK, input);
  assert.deepEqual(first.map(({ id }) => id), second.map(({ id }) => id));
  assert.equal(new Set(first.map(({ id }) => id)).size, 7);
  assert.deepEqual(first.map(({ racePhase }) => racePhase), [
    'LAUNCH', 'SECTOR_1', 'SECTOR_1', 'PIT_STOP', 'SECTOR_2', 'SECTOR_2', 'SPRINT',
  ]);
  assert.ok(new Set(first.map(({ category }) => category)).size >= 5);
});

test('join fields are allowlisted and same-device reconnect is immutable', () => {
  const { store } = fixture();
  const deviceId = '0123456789abcdef0123456789abcdef';
  assert.throws(() => store.join(null, deviceId, 'invented', 'BEGINNER', 'red-bull-racing', 'max-verstappen'),
    (error) => error.code === 'invalid_track');
  assert.throws(() => store.join(null, deviceId, 'human-firewall', 'EASY', 'red-bull-racing', 'max-verstappen'),
    (error) => error.code === 'invalid_difficulty');
  assert.throws(() => store.join(null, deviceId, 'human-firewall', 'BEGINNER', 'formula-one', 'max-verstappen'),
    (error) => error.code === 'invalid_crew');
  assert.throws(() => store.join(null, deviceId, 'human-firewall', 'BEGINNER', 'red-bull-racing', 'real-driver'),
    (error) => error.code === 'invalid_driver');
  assert.throws(() => store.join(null, deviceId, 'human-firewall', 'BEGINNER', 'red-bull-racing', 'charles-leclerc'),
    (error) => error.code === 'invalid_driver');

  const original = store.join(null, deviceId, 'human-firewall', 'BEGINNER', 'red-bull-racing', 'max-verstappen');
  const reconnect = store.join(null, deviceId, 'secure-builder', 'ADVANCED', 'ferrari', 'charles-leclerc');
  assert.deepEqual(reconnect, original);
});

test('capacity is global across tracks and overflow queues to the next race', () => {
  const { join } = fixture({ maxPlayers: 2 });
  assert.match(join({ trackId: 'human-firewall' }).roundId, /^r0-/);
  assert.match(join({ trackId: 'secure-builder' }).roundId, /^r0-/);
  assert.match(join({ trackId: 'human-firewall' }).roundId, /^r1-/);
  assert.match(join({ trackId: 'secure-builder' }).roundId, /^r1-/);
  assert.throws(() => join(), (error) => error.code === 'capacity');
});

test('accelerated sessions cannot renew beyond the retained round lifetime', async () => {
  const { store, join, setNow } = fixture();
  const racer = join();
  const roundKey = '0:human-firewall';
  const player = store.players.get(racer.token);
  const retentionCutoff = 4 * 30_000;

  assert.equal(player.hardExpiresAt, retentionCutoff);
  assert.equal(player.expiresAt, retentionCutoff);
  setNow(retentionCutoff - 1);
  assert.equal(store.state(racer.token).round.phase, 'COMPLETE');
  assert.equal(store.players.get(racer.token).expiresAt, retentionCutoff);
  assert.equal(store.rounds.has(roundKey), true);

  setNow(retentionCutoff);
  await store.tick();
  assert.equal(store.players.has(racer.token), false);
  assert.equal(store.devices.has(player.deviceId), false);
  assert.equal(store.rounds.has(roundKey), false);
  assert.throws(() => store.state(racer.token), (error) => error.code === 'unauthorized');
});

test('unanswered public tasks do not leak answer keys or explanations', async () => {
  const { store, join, setNow } = fixture();
  const racer = join({ difficulty: 'ADVANCED' });
  setNow(3_000); await store.tick();
  const state = store.state(racer.token);
  assert.equal(state.round.phase, 'LAUNCH');
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].feedback, null);
  assert.doesNotMatch(JSON.stringify(state.tasks), /correctOptionId|Why safe/);
  assert.match(JSON.stringify(state.tasks[0].evidence), /advanced-/);
});

test('accuracy uses the full seven-question deck rather than only submitted answers', async () => {
  const { store, join, setNow } = fixture();
  const racer = join();
  setNow(3_000); await store.tick();
  const state = store.state(racer.token);
  const response = store.submit(racer.token, {
    roundId: state.round.roundId,
    task: state.tasks[0].id,
    choice: 'safe',
    actionId: 'accuracy_01',
  });
  assert.equal(response.race.answered, 1);
  assert.equal(response.race.correct, 1);
  assert.equal(response.race.possible, 7);
  assert.equal(response.race.accuracy, 14);
  assert.equal(store.state(racer.token).race.accuracy, 14);
});

test('actions are phase-bound, idempotent, locked, and return immediate reasoning', async () => {
  const { store, join, setNow } = fixture();
  const racer = join();
  setNow(3_000); await store.tick();
  const state = store.state(racer.token);
  const action = {
    roundId: state.round.roundId,
    task: state.tasks[0].id,
    choice: 'unsafe',
    actionId: 'choice_lock_01',
  };
  const first = store.submit(racer.token, action);
  assert.equal(first.feedback.correct, false);
  assert.equal(first.feedback.correctOptionId, 'safe');
  assert.match(first.feedback.explanation, /Why safe/);
  const replay = store.submit(racer.token, action);
  assert.equal(replay.duplicate, true);
  const { duplicate, ...replayedResponse } = replay;
  assert.equal(duplicate, true);
  assert.deepEqual(replayedResponse, first);
  assert.throws(() => store.submit(racer.token, { ...action, choice: 'safe' }),
    (error) => error.code === 'idempotency_conflict');
  assert.throws(() => store.submit(racer.token, { ...action, choice: 'safe', actionId: 'choice_lock_02' }),
    (error) => error.code === 'choice_locked');
  const sectorQuestion = store.getRound(0, 'human-firewall').deck.find(({ racePhase }) => racePhase === 'SECTOR_1');
  assert.throws(() => store.submit(racer.token, {
    ...action, task: sectorQuestion.id, actionId: 'wrong_phase_01', choice: 'safe',
  }), (error) => error.code === 'phase_closed');
});

test('seven correct responses activate launch, nitro, fast pit, aero and final deploy', async () => {
  const { store, join, setNow } = fixture();
  const racer = join();
  const counter = { value: 1 };
  setNow(3_000); await store.tick();
  for (const [phase, at, expectedCount] of [
    ['LAUNCH', 3_000, 1],
    ['SECTOR_1', 3_300, 2],
    ['PIT_STOP', 3_600, 1],
    ['SECTOR_2', 3_900, 2],
    ['SPRINT', 4_200, 1],
  ]) {
    setNow(at); await store.tick();
    const state = store.state(racer.token);
    assert.equal(state.round.phase, phase);
    assert.equal(answerVisible(store, racer, 'safe', counter), expectedCount);
  }
  setNow(4_500); await store.tick();
  const result = store.state(racer.token);
  assert.equal(result.round.phase, 'RESULT');
  assert.equal(result.result.outcome, 'POLE_POSITION');
  assert.equal(result.race.correct, 7);
  assert.equal(result.race.launchBoost, true);
  assert.equal(result.race.nitro, 3);
  assert.equal(result.race.pitTimeMs, 1_900);
  assert.equal(result.race.aeroActive, true);
  assert.equal(result.race.nitroDeploy, true);
  assert.equal(result.result.review.length, 7);
  assert.ok(result.result.review.every((entry) => (
    entry.selected === 'safe'
    && entry.selectedLabel === 'Safe response'
    && entry.correctOptionId === 'safe'
    && entry.correctOptionLabel === 'Safe response'
  )));
  const reconnected = store.join(racer.token, null, null, null, null, null);
  const restoredResult = store.state(reconnected.token).result;
  assert.ok(restoredResult.review.every((entry) => (
    entry.selectedLabel === 'Safe response'
    && entry.correctOptionLabel === 'Safe response'
  )), 'server labels must survive a reconnect without a browser-side option cache');
  assert.equal(store.stats.perfectLaps, 1);
});

test('different tracks keep actions and seeded decks isolated', async () => {
  const { store, join, setNow } = fixture();
  const human = join({ trackId: 'human-firewall' });
  const builder = join({ trackId: 'secure-builder' });
  setNow(3_000); await store.tick();
  answerVisible(store, human);
  assert.equal(store.state(builder.token).observations.length, 0);
  assert.equal(store.getRound(0, 'secure-builder').actions.size, 0);
});
