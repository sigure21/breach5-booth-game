import assert from 'node:assert/strict';
import test from 'node:test';
import { GameStore } from '../src/game.mjs';
import {
  CIRCUITS, CREWS, DIFFICULTIES, DRIVERS, SECURITY_CIRCUITS,
} from '../src/race/catalog.mjs';
import { aiNonTieOffsetForOrdinal, scoreFromResults } from '../src/race/scoring.mjs';

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
  serverTiers: { BEGINNER: 'APPLIED', ADVANCED: 'ANALYST' },
}));

const driversByCrew = new Map(CREWS.map((crew) => [
  crew.id,
  DRIVERS.find((driver) => driver.crewId === crew.id),
]));

function fixture({
  maxPlayers = 48,
  seedSecret = 'heat-test-seed',
  sessionTtlMs,
  minEncounters = 10,
  maxEncounters = 10,
  questionBank = QUESTION_BANK,
} = {}) {
  let now = 0;
  let sequence = 0;
  const store = new GameStore({
    now: () => now,
    roundMs: 30_000,
    maxPlayers,
    seedSecret,
    sessionTtlMs,
    questionBank,
    questionBankVersion: 'heat-test-v1',
    minEncounters,
    maxEncounters,
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
      overrides.securityCircuitId ?? 'FULL_STACK',
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

function assertPrivateScoringHidden(value) {
  const forbidden = new Set([
    'servertier', 'servertiers', 'serverweighttier', 'weighttier', 'weight', 'weights',
    'points', 'earned', 'earnedweight', 'possibleweight', 'possibleweighted', 'knowledge',
    'knowledgescore', 'racescore', 'rankingscore', 'internalrankingscore', 'hardp4',
    'rankvalue', 'aiskill', 'aiordinal', 'airesults', 'rawpoints', 'maxpoints',
    'wrongcount', 'threshold', 'thresholds',
  ]);
  const walk = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    for (const [key, child] of Object.entries(entry)) {
      assert.equal(forbidden.has(key.toLowerCase()), false, `private scoring field leaked: ${key}`);
      walk(child);
    }
  };
  walk(value);
}

function setPlayerAnswers(store, identity, correctCount) {
  const player = store.players.get(identity.token);
  const match = store.matches.get(identity.matchId);
  const deck = store.deckFor(match, player.difficulty, player.securityCircuitId);
  deck.forEach((question, index) => {
    const choice = index < correctCount
      ? question.correctOptionId
      : question.options.find(({ id }) => id !== question.correctOptionId).id;
    match.actions.set(`${player.id}:${question.id}`, {
      playerId: player.id,
      task: question.id,
      choice,
      correct: index < correctCount,
      at: store.now(),
    });
  });
}

function weightedHardP4Bank() {
  return Array.from({ length: 15 }, (_, index) => ({
    id: `weighted-${String(index + 1).padStart(2, '0')}`,
    conceptId: `weighted-${String(index + 1).padStart(2, '0')}`,
    topicFamily: `weighted-${String(index + 1).padStart(2, '0')}`,
    category: `weighted-category-${index % 5}`,
    stages: ['LAUNCH', 'SECTOR', 'PIT', 'SPRINT'],
    question: `Weighted question ${index + 1}`,
    evidence: [],
    options: [
      { id: 'safe', label: 'Safe response' },
      { id: 'unsafe', label: 'Unsafe response' },
    ],
    correctOptionId: 'safe',
    serverTiers: {
      BEGINNER: index < 10 ? 'ANALYST' : 'FOUNDATION',
      ADVANCED: index < 10 ? 'ANALYST' : 'FOUNDATION',
    },
  }));
}

function weightedLiveBank() {
  return Array.from({ length: 10 }, (_, index) => ({
    id: `live-weight-${String(index + 1).padStart(2, '0')}`,
    conceptId: `live-weight-${String(index + 1).padStart(2, '0')}`,
    topicFamily: `live-weight-${String(index + 1).padStart(2, '0')}`,
    category: `live-category-${index % 5}`,
    stages: ['LAUNCH', 'SECTOR', 'PIT', 'SPRINT'],
    question: `Live weight question ${index + 1}`,
    evidence: [],
    options: [
      { id: 'safe', label: 'Safe response' },
      { id: 'unsafe', label: 'Unsafe response' },
    ],
    correctOptionId: 'safe',
    serverTiers: {
      BEGINNER: index % 2 === 0 ? 'FOUNDATION' : 'ANALYST',
      ADVANCED: index % 2 === 0 ? 'FOUNDATION' : 'ANALYST',
    },
  }));
}

function setAnswersByTier(store, identity, correctTier) {
  const player = store.players.get(identity.token);
  const match = store.matches.get(identity.matchId);
  const deck = store.deckFor(match, player.difficulty, player.securityCircuitId);
  for (const question of deck) {
    const isCorrect = question.serverTiers?.[player.difficulty] === correctTier
      || question.serverTier === correctTier;
    const choice = isCorrect
      ? question.correctOptionId
      : question.options.find(({ id }) => id !== question.correctOptionId).id;
    match.actions.set(`${player.id}:${question.id}`, {
      playerId: player.id,
      task: question.id,
      choice,
      correct: isCorrect,
      at: store.now(),
    });
  }
}

test('runtime overrides cannot expand a heat beyond five minutes', () => {
  assert.throws(() => new GameStore({
    roundMs: 300_000,
    matchMinWaitMs: 60_000,
    matchMaxWaitMs: 90_000,
    gridMs: 15_000,
    encounterMs: 30_000,
    resultMs: 60_000,
  }), /maximum heat runtime must not exceed 300000ms/);
  assert.doesNotThrow(() => new GameStore({ roundMs: 300_000 }));
});

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

test('server-only tiers normalize weighted knowledge before bounded game-balance ratings', () => {
  const deck = [
    { id: 'foundation', serverTier: 'FOUNDATION', racePhase: 'LAP_1' },
    { id: 'applied', serverTier: 'APPLIED', racePhase: 'LAP_1' },
    { id: 'analyst', serverTier: 'ANALYST', racePhase: 'LAP_2' },
  ];
  const weighted = scoreFromResults(deck, [true, false, true], 3, 3, {
    difficulty: 'BEGINNER', crewPerformance: 88, driverSkill: 90,
  });
  assert.equal(weighted.knowledgeScore, (16 / 24) * 100);
  assert.equal(weighted.raceScore, 68.9);
  assert.equal(weighted.earnedWeight, 16);
  assert.equal(weighted.possibleWeight, 24);

  const weakestPerfect = scoreFromResults(deck, [true, true, true], 3, 3, {
    difficulty: 'BEGINNER', crewPerformance: 86, driverSkill: 85,
  });
  assert.equal(weakestPerfect.raceScore, 98.6);
  const perfectAi = scoreFromResults(deck, [true, true, true], 3, 3, {
    difficulty: 'ADVANCED', crewPerformance: 88, driverSkill: 90, aiOrdinal: 0,
  });
  assert.ok(weakestPerfect.raceScore > perfectAi.raceScore);
  assert.equal(perfectAi.raceScore, 98.45);
  assert.equal(aiNonTieOffsetForOrdinal(0), 0.05);
  assert.equal(aiNonTieOffsetForOrdinal(1), 0.04);
  assert.equal(aiNonTieOffsetForOrdinal(2), 0.03);
});

test('human and AI five-to-seven-miss classification boundaries are explicit', () => {
  const deck = Array.from({ length: 10 }, (_, index) => ({
    id: `retirement-${index}`,
    serverTier: 'FOUNDATION',
    racePhase: index === 9 ? 'SPRINT' : 'LAP_1',
  }));
  const resultsForMisses = (misses) => Array.from({ length: 10 }, (_, index) => index < 10 - misses);
  for (const [misses, hardP4, retired] of [
    [4, false, false], [5, true, false], [6, true, false], [7, false, true],
  ]) {
    const human = scoreFromResults(deck, resultsForMisses(misses), 10, 10, {
      difficulty: 'BEGINNER', crewPerformance: 88, driverSkill: 90,
    });
    assert.equal(human.hardP4, hardP4, `human misses=${misses}`);
    assert.equal(human.retired, retired, `human misses=${misses}`);
  }
  for (const [misses, retired] of [[5, false], [6, false], [7, true]]) {
    const ai = scoreFromResults(deck, resultsForMisses(misses), 10, 10, {
      difficulty: 'ADVANCED', crewPerformance: 88, driverSkill: 90, aiOrdinal: 0,
    });
    assert.equal(ai.hardP4, false, `AI misses=${misses}`);
    assert.equal(ai.retired, retired, `AI misses=${misses}`);
  }
  const fourCorrectAi = scoreFromResults(deck, resultsForMisses(6), 10, 10, {
    difficulty: 'ADVANCED', crewPerformance: 88, driverSkill: 90, aiOrdinal: 0,
  });
  const eightCorrectAi = scoreFromResults(deck, resultsForMisses(2), 10, 10, {
    difficulty: 'ADVANCED', crewPerformance: 86, driverSkill: 85, aiOrdinal: 2,
  });
  assert.ok(eightCorrectAi.raceScore > fourCorrectAi.raceScore);
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

test('one to three humans can immediately fill only the remaining seats with AI', async () => {
  for (const humans of [1, 2, 3]) {
    const { store, join, setNow } = fixture({ seedSecret: `manual-fill-${humans}` });
    const racers = Array.from({ length: humans }, () => join());
    const launched = store.startWithAi(racers[0].token);
    assert.equal(launched.ok, true);
    assert.equal(launched.match.status, 'GRID');
    assert.equal(launched.match.humanCount, humans);
    assert.equal(launched.match.aiCount, 4 - humans);
    assert.equal(launched.match.startsInMs, store.timing.gridMs);

    const state = store.state(racers[0].token);
    assert.equal(state.race.racers.length, 4);
    assert.equal(state.race.racers.filter(({ isAi }) => isAi).length, 4 - humans);
    assert.deepEqual(
      new Set(state.race.racers.filter(({ isAi }) => !isAi).map(({ callsign }) => callsign)),
      new Set(racers.map(({ callsign }) => callsign)),
    );
    assert.equal(store.stats.aiFilledSeats, 4 - humans);
    assert.throws(() => store.startWithAi(racers[0].token),
      (error) => error.code === 'solo_start_unavailable');
    assert.equal(store.stats.aiFilledSeats, 4 - humans, 'duplicate click filled or counted AI twice');

    await setNow(store.timing.gridMs - 1);
    assert.equal(store.state(racers[0].token).match.status, 'GRID');
    await setNow(store.timing.gridMs);
    assert.equal(store.state(racers[0].token).match.status, 'RACING');
  }
});

test('manual AI fill rejects invalid tokens and a full four-human heat', () => {
  const { store, join } = fixture();
  assert.throws(() => store.startWithAi('invalid-token'),
    (error) => error.code === 'unauthorized');
  const racers = Array.from({ length: 4 }, () => join());
  assert.equal(new Set(racers.map(({ matchId }) => matchId)).size, 1);
  assert.throws(() => store.startWithAi(racers[0].token),
    (error) => error.code === 'solo_start_unavailable');
  assert.equal(store.state(racers[0].token).match.status, 'MATCHING');
  assert.equal(store.state(racers[0].token).match.humanCount, 4);
  assert.equal(store.state(racers[0].token).match.aiCount, 0);
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

test('server deterministically chooses ten to fifteen encounters for every heat profile', () => {
  const first = fixture({ seedSecret: 'variable-count', minEncounters: 10, maxEncounters: 15 }).store;
  const second = fixture({ seedSecret: 'variable-count', minEncounters: 10, maxEncounters: 15 }).store;
  const firstCounts = [];
  const secondCounts = [];
  const circuits = ['WHITE', 'RED', 'BLUE', 'FULL_STACK'];
  for (let index = 0; index < 48; index += 1) {
    const difficulty = index % 2 ? 'ADVANCED' : 'BEGINNER';
    const securityCircuitId = circuits[index % circuits.length];
    const left = first.createMatch(difficulty, securityCircuitId);
    const right = second.createMatch(difficulty, securityCircuitId);
    firstCounts.push(left.totalEncounters);
    secondCounts.push(right.totalEncounters);
    assert.ok(left.totalEncounters >= 10 && left.totalEncounters <= 15);
    assert.equal(left.difficulty, difficulty);
    assert.equal(left.securityCircuitId, securityCircuitId);
    assert.equal(left.deck.length, left.totalEncounters);
    assert.equal(new Set(left.deck.map(({ id }) => id)).size, left.totalEncounters);
  }
  assert.deepEqual(firstCounts, secondCounts);
  assert.ok(new Set(firstCounts).size >= 4, 'HMAC encounter count did not meaningfully vary');
});

test('queue isolates exact difficulty and security circuit while preserving same-profile grouping', async () => {
  const { store, join, setNow } = fixture({ seedSecret: 'profile-isolation' });
  const beginnerFull = join({ difficulty: 'BEGINNER', securityCircuitId: 'FULL_STACK' });
  const advancedFull = join({ difficulty: 'ADVANCED', securityCircuitId: 'FULL_STACK' });
  const beginnerRed = join({ difficulty: 'BEGINNER', securityCircuitId: 'RED' });
  const sameAsFirst = join({ difficulty: 'BEGINNER', securityCircuitId: 'FULL_STACK' });
  assert.equal(beginnerFull.matchId, sameAsFirst.matchId);
  assert.notEqual(beginnerFull.matchId, advancedFull.matchId);
  assert.notEqual(beginnerFull.matchId, beginnerRed.matchId);
  assert.notEqual(advancedFull.matchId, beginnerRed.matchId);
  assert.equal(store.matches.size, 3);

  store.startWithAi(beginnerFull.token);
  await setNow(store.timing.gridMs);
  const state = store.state(beginnerFull.token);
  const sameProfileState = store.state(sameAsFirst.token);
  assert.equal(state.match.difficulty, 'BEGINNER');
  assert.equal(state.match.securityCircuitId, 'FULL_STACK');
  assert.equal(state.player.securityCircuitId, 'FULL_STACK');
  assert.ok(state.race.racers.every(({ difficulty, securityCircuitId }) => (
    difficulty === 'BEGINNER' && securityCircuitId === 'FULL_STACK'
  )));
  assert.deepEqual(state.tasks, sameProfileState.tasks);
  assert.equal(store.state(advancedFull.token).match.status, 'MATCHING');
  assert.equal(store.state(beginnerRed.token).match.status, 'MATCHING');
});

test('all difficulty and security-circuit profiles form independent four-seat heats', () => {
  const { store, join } = fixture({ seedSecret: 'all-profile-isolation' });
  const profileMatches = new Map();

  for (const difficulty of DIFFICULTIES) {
    for (const { id: securityCircuitId } of SECURITY_CIRCUITS) {
      const identities = Array.from({ length: 4 }, () => join({
        difficulty,
        securityCircuitId,
      }));
      const matchIds = new Set(identities.map(({ matchId }) => matchId));
      assert.equal(matchIds.size, 1, `${difficulty}/${securityCircuitId} split across heats`);
      profileMatches.set(`${difficulty}:${securityCircuitId}`, identities[0].matchId);
    }
  }

  assert.equal(profileMatches.size, DIFFICULTIES.length * SECURITY_CIRCUITS.length);
  assert.equal(new Set(profileMatches.values()).size, profileMatches.size);
  assert.equal(store.matches.size, profileMatches.size);
  for (const [profile, matchId] of profileMatches) {
    const [difficulty, securityCircuitId] = profile.split(':');
    const match = store.matches.get(matchId);
    assert.equal(match.humanTokens.length, 4);
    assert.equal(match.difficulty, difficulty);
    assert.equal(match.securityCircuitId, securityCircuitId);
  }
});

test('live progress and gaps cannot reveal hidden question weights', () => {
  const { store, join, now } = fixture({
    seedSecret: 'live-weight-side-channel', questionBank: weightedLiveBank(),
  });
  const humans = Array.from({ length: 2 }, () => join({
    crewId: 'red-bull-racing', driverId: 'max-verstappen',
  }));
  store.startWithAi(humans[0].token);
  const match = store.matches.get(humans[0].matchId);
  const deck = store.deckFor(match, 'BEGINNER');
  const context = { difficulty: 'BEGINNER', crewPerformance: 88, driverSkill: 90 };
  const groups = new Map();
  let pair = null;
  for (let mask = 0; mask < 2 ** 9 && !pair; mask += 1) {
    const results = Array.from({ length: 10 }, (_, index) => index < 9 && Boolean(mask & (1 << index)));
    if (results.filter(Boolean).length !== 6) continue;
    const score = scoreFromResults(deck, results, 9, 9, context);
    const publicPaceKey = [
      score.correct, score.streak, score.launchBoost, score.pitTimeMs,
      score.batteryPercent, score.boostMode,
    ].join(':');
    const previous = groups.get(publicPaceKey);
    if (previous && previous.score.raceScore !== score.raceScore) pair = [previous, { results, score }];
    else if (!previous) groups.set(publicPaceKey, { results, score });
  }
  assert.ok(pair, 'fixture could not produce equal public pace with different hidden weights');

  pair.forEach(({ results }, humanIndex) => {
    const player = store.players.get(humans[humanIndex].token);
    deck.slice(0, 9).forEach((question, questionIndex) => {
      const correct = results[questionIndex];
      const choice = correct
        ? question.correctOptionId
        : question.options.find(({ id }) => id !== question.correctOptionId).id;
      match.actions.set(`${player.id}:${question.id}`, {
        playerId: player.id, task: question.id, choice, correct, at: now(),
      });
    });
  });
  match.status = 'RACING';
  match.statusStartedAt = now();
  match.encounterIndex = 9;
  match.encounterStartedAt = now();
  match.encounterEndsAt = now() + store.timing.encounterMs;
  match.phaseEndsAt = match.encounterEndsAt;

  const live = store.state(humans[0].token);
  const playerIds = humans.map(({ token }) => store.players.get(token).id);
  const liveRows = playerIds.map((id) => live.race.racers.find((racer) => racer.id === id));
  assert.notEqual(pair[0].score.raceScore, pair[1].score.raceScore);
  assert.equal(liveRows[0].score.correct, liveRows[1].score.correct);
  assert.equal(liveRows[0].progress, liveRows[1].progress);
  assert.equal(liveRows[0].gapMeters, liveRows[1].gapMeters);
  assert.equal(liveRows[0].batteryPercent, liveRows[1].batteryPercent);
  assertPrivateScoringHidden(live);

  store.enterResult(match, now());
  const finalScores = match.racers.slice(0, 2).map((racer) => store.scoreForRacer(match, racer).raceScore);
  assert.notEqual(finalScores[0], finalScores[1]);
  const result = store.state(humans[0].token).result;
  const finalRows = playerIds.map((id) => result.classification.find((racer) => racer.id === id));
  const higherIndex = finalScores[0] > finalScores[1] ? 0 : 1;
  const lowerIndex = 1 - higherIndex;
  assert.ok(finalRows[higherIndex].position < finalRows[lowerIndex].position);
  for (const row of result.classification) {
    assert.equal(
      row.gapMeters,
      Number.isInteger(row.position) ? Math.max(0, row.position - 1) * 125 : 0,
      'final public gap must encode classification only, not hidden score distance',
    );
  }
  assertPrivateScoringHidden(result);
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
  assert.equal(resultState.result.outcome, 'P1');
  assert.equal(resultState.result.correct, 10);
  assert.equal(resultState.result.classification.length, 4);
  assert.deepEqual(
    resultState.result.classification.filter(({ retired }) => !retired).map(({ position }) => position),
    [1, 2, 3, 4],
  );
  assert.ok(resultState.result.classification.filter(({ retired }) => retired)
    .every(({ position }) => position === null));
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

test('perfect human always beats every AI while five wrong answers hard-finish P4', () => {
  for (const correctCount of [10, 5]) {
    const { store, join, now } = fixture({ seedSecret: `hard-band-${correctCount}` });
    const human = join({ crewId: 'mercedes', driverId: 'kimi-antonelli' });
    store.startWithAi(human.token);
    setPlayerAnswers(store, human, correctCount);
    const match = store.matches.get(human.matchId);
    store.enterResult(match, now());
    const state = store.state(human.token);
    const humanResult = state.result.classification.find(({ id }) => id === state.player.id);
    if (correctCount === 10) {
      assert.equal(humanResult.position, 1);
      assert.equal(state.result.finishBand, 'P1');
      assert.ok(state.result.classification.filter(({ isAi }) => isAi)
        .every(({ position }) => position > 1));
    } else {
      assert.equal(humanResult.position, 4);
      assert.equal(state.result.finishBand, 'P4');
    }
    assertPrivateScoringHidden(state);
    assert.ok(state.result.classification.every(({ performanceRating, skillRating }) => (
      Number.isInteger(performanceRating) && Number.isInteger(skillRating)
    )));
  }
});

test('five low-weight misses force P4 even after ten high-weight correct answers', () => {
  for (const humanCount of [1, 2, 3]) {
    const { store, join, now } = fixture({
      seedSecret: `weighted-hard-p4-${humanCount}`,
      minEncounters: 15,
      maxEncounters: 15,
      questionBank: weightedHardP4Bank(),
    });
    const humans = Array.from({ length: humanCount }, () => join({
      crewId: 'red-bull-racing',
      driverId: 'max-verstappen',
    }));
    store.startWithAi(humans[0].token);
    for (const human of humans) setAnswersByTier(store, human, 'ANALYST');
    const match = store.matches.get(humans[0].matchId);
    store.enterResult(match, now());

    const state = store.state(humans[0].token);
    const humanIds = new Set(humans.map(({ token }) => store.players.get(token).id));
    const humanRows = state.result.classification.filter(({ id }) => humanIds.has(id));
    const aiRows = state.result.classification.filter(({ isAi }) => isAi);
    assert.equal(state.result.correct, 10);
    assert.equal(state.result.possible, 15);
    assert.equal(state.result.finishBand, 'P4');
    assert.ok(humanRows.every(({ position }) => position === 4));
    assert.ok(aiRows.every(({ position }) => position !== 4));
    assert.equal(
      humanRows.some(({ position }) => aiRows.some((ai) => ai.position === position)),
      false,
      'AI and hard-P4 human shared a position',
    );
    assertPrivateScoringHidden(state);
  }
});

test('fifteen-question result keeps six-miss human P4 and removes seven-miss human from rank', () => {
  const { store, join, now } = fixture({
    seedSecret: 'fifteen-retirement-boundary', minEncounters: 15, maxEncounters: 15,
  });
  const hardP4Human = join({ crewId: 'red-bull-racing', driverId: 'max-verstappen' });
  const retiredHuman = join({ crewId: 'ferrari', driverId: 'charles-leclerc' });
  store.startWithAi(hardP4Human.token);
  setPlayerAnswers(store, hardP4Human, 9);
  setPlayerAnswers(store, retiredHuman, 8);
  const match = store.matches.get(hardP4Human.matchId);
  for (const racer of match.racers.filter(({ isAi }) => isAi)) racer.aiResults.fill(true);
  store.enterResult(match, now());

  const hardState = store.state(hardP4Human.token);
  const retiredState = store.state(retiredHuman.token);
  const hardRow = hardState.result.classification.find(({ id }) => id === hardState.player.id);
  const retiredRow = hardState.result.classification.find(({ id }) => id === retiredState.player.id);
  assert.equal(hardRow.position, 4);
  assert.equal(hardRow.retired, false);
  assert.equal(hardRow.classificationStatus, 'CLASSIFIED');
  assert.equal(hardState.result.finishBand, 'P4');
  assert.equal(retiredRow.position, null);
  assert.equal(retiredRow.retired, true);
  assert.equal(retiredRow.classificationStatus, 'RETIRED');
  assert.equal(retiredState.result.position, null);
  assert.equal(retiredState.result.outcome, 'RETIRED');
  assert.equal(retiredState.result.finishBand, 'RETIRED');
  assert.equal(retiredState.result.classificationStatus, 'RETIRED');
  assert.deepEqual(hardState.result.classification.map(({ position }) => position), [1, 2, 4, null]);
  assert.equal(store.stats.humanRetirements, 1);
  assertPrivateScoringHidden(hardState);
  assertPrivateScoringHidden(retiredState);
});

test('retired AI has no position and classified racers are competitively re-ranked', () => {
  const { store, join, now } = fixture({
    seedSecret: 'ai-retirement-ranking', minEncounters: 15, maxEncounters: 15,
  });
  const human = join({ crewId: 'mercedes', driverId: 'kimi-antonelli' });
  store.startWithAi(human.token);
  setPlayerAnswers(store, human, 15);
  const match = store.matches.get(human.matchId);
  const aiRacers = match.racers.filter(({ isAi }) => isAi);
  aiRacers[0].aiResults.fill(false);
  aiRacers[0].aiResults.fill(true, 0, 8);
  aiRacers[1].aiResults.fill(true);
  aiRacers[2].aiResults.fill(true);
  store.enterResult(match, now());

  const state = store.state(human.token);
  const classified = state.result.classification.filter(({ retired }) => !retired);
  const retired = state.result.classification.filter(({ retired }) => retired);
  assert.deepEqual(classified.map(({ position }) => position), [1, 2, 3]);
  assert.equal(retired.length, 1);
  assert.equal(retired[0].isAi, true);
  assert.equal(retired[0].position, null);
  assert.equal(retired[0].classificationStatus, 'RETIRED');
  assert.equal(store.stats.aiRetirements, 1);
  assertPrivateScoringHidden(state);
});

test('equal perfect humans share competition rank without tying the AI', () => {
  const { store, join, now } = fixture({ seedSecret: 'human-tie-with-ai' });
  const humans = Array.from({ length: 3 }, () => join({
    crewId: 'red-bull-racing',
    driverId: 'max-verstappen',
  }));
  store.startWithAi(humans[0].token);
  for (const human of humans) setPlayerAnswers(store, human, 10);
  const match = store.matches.get(humans[0].matchId);
  store.enterResult(match, now());

  const classification = store.state(humans[0].token).result.classification;
  const humanIds = new Set(humans.map(({ token }) => store.players.get(token).id));
  const humanRows = classification.filter(({ id }) => humanIds.has(id));
  const aiRows = classification.filter(({ isAi }) => isAi);
  assert.deepEqual(humanRows.map(({ position }) => position), [1, 1, 1]);
  assert.deepEqual(aiRows.map(({ position }) => position), [4]);
  assert.equal(
    humanRows.some(({ position }) => aiRows.some((ai) => ai.position === position)),
    false,
    'AI and tied humans shared a position',
  );
});

test('equal human race scores use competition ranking while ratings separate perfect humans', () => {
  const { store, join, now } = fixture({ seedSecret: 'human-tie-ranking' });
  const humans = [
    join({ crewId: 'mclaren', driverId: 'lando-norris' }),
    join({ crewId: 'mclaren', driverId: 'lando-norris' }),
    join({ crewId: 'ferrari', driverId: 'charles-leclerc' }),
    join({ crewId: 'mercedes', driverId: 'george-russell' }),
  ];
  const match = store.matches.get(humans[0].matchId);
  store.enterGrid(match, now());
  for (const human of humans) setPlayerAnswers(store, human, 10);
  store.enterResult(match, now());

  const internalScores = match.racers.map((racer) => store.scoreForRacer(match, racer).raceScore);
  assert.equal(internalScores[0], internalScores[1]);
  assert.ok(internalScores[0] > internalScores[2]);
  assert.ok(internalScores[2] > internalScores[3]);
  const result = store.state(humans[0].token).result;
  assert.deepEqual(result.classification.map(({ position }) => position), [1, 1, 3, 4]);
  assertPrivateScoringHidden(result);
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
    await setNow(20_000);
    const state = store.state(racer.token);
    assert.equal(state.match.status, 'RESULT');
    const ai = state.result.classification.filter(({ isAi }) => isAi);
    assert.equal(ai.length, 3);
    assert.ok(ai.some(({ score }) => score.correct >= 5));
    assert.equal(state.result.retired, true);
    assert.equal(state.result.position, null);
    assert.ok(ai.some(({ retired }) => !retired));
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
  const original = join({
    deviceId, crewId: 'ferrari', driverId: 'charles-leclerc', securityCircuitId: 'RED',
  });
  const reconnect = join({
    deviceId,
    difficulty: 'ADVANCED',
    securityCircuitId: 'BLUE',
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
    securityCircuitId: 'BLUE',
    crewId: 'mercedes',
    driverId: 'george-russell',
  });
  assert.notEqual(retry.token, original.token);
  assert.notEqual(retry.matchId, original.matchId);
  assert.equal(retry.difficulty, 'ADVANCED');
  assert.equal(retry.securityCircuitId, 'BLUE');
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
