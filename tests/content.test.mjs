import assert from 'node:assert/strict';
import test from 'node:test';
import {
  QUESTIONS,
  QUESTION_BANKS,
  QUESTION_BANK_VERSION,
  getQuestionVariant,
  publicQuestion,
} from '../src/content/questions.mjs';
import { CIRCUIT_QUESTIONS } from '../src/content/circuit-questions.mjs';
import { TREND_CARDS } from '../src/content/trends.mjs';
import { CIRCUITS } from '../src/race/catalog.mjs';
import { buildRaceDeck } from '../src/race/seed.mjs';

test('question banks contain one hundred twenty-eight evidence-backed variants per difficulty', () => {
  assert.equal(QUESTIONS.length, 128);
  assert.equal(new Set(QUESTIONS.map(({ id }) => id)).size, 128);
  for (const level of ['BEGINNER', 'ADVANCED']) {
    const bank = QUESTION_BANKS[level];
    assert.equal(bank.length, 128);
    assert.equal(new Set(bank.map(({ id }) => id)).size, 128);
    assert.equal(new Set(bank.map(({ conceptId }) => conceptId)).size, 128);
    assert.equal(new Set(bank.map(({ question }) => question)).size, 128);
    assert.deepEqual([...new Set(bank.map(({ serverTier }) => serverTier))].sort(), ['ANALYST', 'APPLIED', 'FOUNDATION']);
    assert.deepEqual(
      [...new Set(bank.map((question) => question.options.findIndex(({ id }) => id === question.correctOptionId)))].sort(),
      [0, 1, 2, 3],
    );
    for (const question of bank) {
      assert.match(question.id, /^[a-z0-9-]+--(beginner|advanced)$/);
      assert.ok(['IDENTITY', 'DEVICE', 'WEB_APP', 'CLOUD_SUPPLY', 'INCIDENT'].includes(question.category));
      assert.ok(['WHITE', 'RED', 'BLUE'].includes(question.securityCircuitId));
      assert.ok(Array.isArray(question.authoringStages) && question.authoringStages.length > 0);
      assert.ok(Array.isArray(question.evidence) && question.evidence.length >= 2);
      assert.equal(question.options.length, 4);
      assert.equal(new Set(question.options.map(({ id }) => id)).size, 4);
      assert.equal(new Set(question.options.map(({ label }) => label)).size, 4);
      assert.ok(question.options.some(({ id }) => id === question.correctOptionId));
      assert.ok(question.options.every(({ feedback }) => typeof feedback === 'string' && feedback.length > 10));
      assert.ok(question.references.length > 0);
      assert.ok(question.references.every(({ url }) => url.startsWith('https://')));
    }
  }
});

test('paired levels differ and public serialization omits server-only scoring metadata', () => {
  for (const question of QUESTIONS) {
    const beginner = getQuestionVariant(question.id, 'BEGINNER');
    const advanced = getQuestionVariant(question.id, 'ADVANCED');
    assert.equal(beginner.conceptId, advanced.conceptId);
    assert.notEqual(beginner.id, advanced.id);
    assert.notEqual(beginner.question, advanced.question);
    assert.notDeepEqual(beginner.evidence, advanced.evidence);
    assert.notDeepEqual(beginner.options.map(({ label }) => label), advanced.options.map(({ label }) => label));
    for (const level of ['BEGINNER', 'ADVANCED']) {
      const hidden = publicQuestion(question.id, level);
      const revealed = publicQuestion(question.id, level, { revealAnswer: true });
      assert.doesNotMatch(JSON.stringify(hidden), /serverTier|serverTiers|rawPoints|maxPoints|weight/i);
      assert.doesNotMatch(JSON.stringify(revealed), /serverTier|serverTiers|rawPoints|maxPoints|weight/i);
      assert.equal(Object.hasOwn(hidden, 'answerId'), false);
      assert.ok(revealed.answerId);
    }
  }
});

test('generated option metadata is neutral and does not reveal the correct choice', () => {
  const generated = Object.values(QUESTION_BANKS).flat()
    .filter(({ topicFamily, conceptId }) => topicFamily !== conceptId);
  assert.equal(generated.length, 140);
  const correctIds = new Set();
  for (const question of generated) {
    correctIds.add(question.correctOptionId);
    assert.equal(new Set(question.options.map(({ technical }) => technical)).size, 1);
    for (const option of question.options) {
      assert.doesNotMatch(option.id, /secure|correct|safe|unsafe|decoy|answer/i);
      assert.doesNotMatch(option.technical, /대조 선택|정답|오답/);
    }
  }
  assert.deepEqual([...correctIds].sort(), ['choice-a', 'choice-b', 'choice-c', 'choice-d']);
});

test('every security circuit and level fills ten to fifteen visual race slots without family repeats', () => {
  for (const circuit of CIRCUITS) {
    for (const difficulty of ['BEGINNER', 'ADVANCED']) {
      for (const securityCircuitId of ['WHITE', 'RED', 'BLUE', 'FULL_STACK']) {
        for (let encounterCount = 10; encounterCount <= 15; encounterCount += 1) {
          const deck = buildRaceDeck(QUESTION_BANKS, {
            matchId: `test-${circuit.id}-${difficulty}-${securityCircuitId}-${encounterCount}`,
            circuitId: circuit.id,
            difficulty,
            securityCircuitId,
            encounterCount,
            version: QUESTION_BANK_VERSION,
            secret: 'a'.repeat(64),
          });
          assert.equal(deck.length, encounterCount);
          assert.equal(new Set(deck.map(({ id }) => id)).size, encounterCount);
          assert.equal(deck[0].racePhase, 'LAUNCH');
          assert.equal(deck.at(-1).racePhase, 'SPRINT');
          assert.equal(deck.filter(({ racePhase }) => racePhase === 'PIT_STOP').length, 1);
          assert.equal(new Set(deck.map(({ topicFamily, conceptId, id }) => topicFamily ?? conceptId ?? id)).size, encounterCount);
          assert.ok(deck.every(({ securityLane }) => ['RED', 'BLUE'].includes(securityLane)
            || securityLane === securityCircuitId));
          if (securityCircuitId === 'FULL_STACK') {
            const red = deck.filter(({ securityLane }) => securityLane === 'RED').length;
            const blue = deck.filter(({ securityLane }) => securityLane === 'BLUE').length;
            assert.ok(Math.abs(red - blue) <= 1);
          } else {
            assert.ok(deck.every(({ securityLane }) => securityLane === securityCircuitId));
          }
        }
      }
    }
  }
});

test('HMAC decks avoid family repeats and shuffle options without mutating source questions', () => {
  const originalOptions = JSON.stringify(QUESTION_BANKS);
  const correctPositions = new Set();
  for (let ordinal = 0; ordinal < 150; ordinal += 1) {
    const parameters = {
      matchId: `shuffle-${ordinal}`,
      circuitId: CIRCUITS[ordinal % CIRCUITS.length].id,
      difficulty: ordinal % 2 ? 'ADVANCED' : 'BEGINNER',
      securityCircuitId: ['WHITE', 'RED', 'BLUE', 'FULL_STACK'][ordinal % 4],
      encounterCount: 15,
      version: QUESTION_BANK_VERSION,
      secret: 'b'.repeat(64),
    };
    const deck = buildRaceDeck(QUESTION_BANKS, parameters);
    const repeated = buildRaceDeck(QUESTION_BANKS, parameters);
    assert.deepEqual(deck.map(({ options }) => options.map(({ id }) => id)),
      repeated.map(({ options }) => options.map(({ id }) => id)));
    assert.equal(new Set(deck.map(({ topicFamily, conceptId, id }) => topicFamily ?? conceptId ?? id)).size, 15);
    for (const question of deck) {
      correctPositions.add(question.options.findIndex(({ id }) => id === question.correctOptionId));
    }
  }
  assert.ok(correctPositions.size >= 3, `correct options only appeared at ${[...correctPositions]}`);
  assert.equal(JSON.stringify(QUESTION_BANKS), originalOptions);
});

test('authoring stages do not constrain visual race phase assignment', () => {
  const visualStage = {
    LAUNCH: 'LAUNCH', LAP_1: 'SECTOR', PIT_STOP: 'PIT', LAP_2: 'SECTOR', SPRINT: 'SPRINT',
  };
  let observedIndependentAssignment = false;
  for (let ordinal = 0; ordinal < 40 && !observedIndependentAssignment; ordinal += 1) {
    const deck = buildRaceDeck(QUESTION_BANKS, {
      matchId: `visual-phase-${ordinal}`,
      circuitId: CIRCUITS[ordinal % CIRCUITS.length].id,
      difficulty: 'BEGINNER',
      securityCircuitId: ['WHITE', 'RED', 'BLUE', 'FULL_STACK'][ordinal % 4],
      encounterCount: 15,
      version: QUESTION_BANK_VERSION,
      secret: 'd'.repeat(64),
    });
    observedIndependentAssignment = deck.some((question) => (
      !question.authoringStages.includes(visualStage[question.racePhase])
    ));
  }
  assert.equal(observedIndependentAssignment, true);
});

test('five thousand HMAC seeds reach every playable variant with bounded per-question exposure', () => {
  const reached = new Set();
  const questionFrequency = new Map();
  const securityCircuits = ['WHITE', 'RED', 'BLUE', 'FULL_STACK'];
  for (let ordinal = 0; ordinal < 5_000; ordinal += 1) {
    const difficulty = ordinal % 2 ? 'ADVANCED' : 'BEGINNER';
    const securityCircuitId = securityCircuits[Math.floor(ordinal / 2) % securityCircuits.length];
    const deck = buildRaceDeck(QUESTION_BANKS, {
      matchId: `reachability-${ordinal}`,
      circuitId: CIRCUITS[ordinal % CIRCUITS.length].id,
      difficulty,
      securityCircuitId,
      encounterCount: 15,
      version: QUESTION_BANK_VERSION,
      secret: 'c'.repeat(64),
    });
    for (const question of deck) {
      reached.add(question.id);
      if (securityCircuitId === 'FULL_STACK') continue;
      const groupKey = `${difficulty}:${securityCircuitId}`;
      if (!questionFrequency.has(groupKey)) questionFrequency.set(groupKey, new Map());
      const group = questionFrequency.get(groupKey);
      group.set(question.id, (group.get(question.id) ?? 0) + 1);
    }
  }
  const allIds = Object.values(QUESTION_BANKS).flat().map(({ id }) => id);
  assert.equal(reached.size, 256,
    `unreachable variants: ${allIds.filter((id) => !reached.has(id)).join(', ')}`);
  for (const [key, group] of questionFrequency) {
    const [difficulty, securityCircuitId] = key.split(':');
    const expectedIds = QUESTION_BANKS[difficulty]
      .filter((question) => question.securityCircuitId === securityCircuitId)
      .map(({ id }) => id);
    assert.equal(group.size, expectedIds.length, `${key} left questions unreachable`);
    const values = [...group.values()];
    assert.ok(Math.max(...values) / Math.min(...values) < 2.5,
      `${key} question exposure is biased: ${Math.max(...values)}/${Math.min(...values)}`);
  }
});

test('WHITE pool contains explicit authorization, scope, stop, and remediation validation practice', () => {
  const white = QUESTION_BANKS.BEGINNER.filter(({ securityCircuitId }) => securityCircuitId === 'WHITE');
  const whiteIds = white.map(({ id }) => id);
  for (const marker of ['authorization-roe', 'scope-boundary', 'stop-condition', 'remediation-validation']) {
    assert.ok(whiteIds.some((id) => id.includes(marker)), `missing WHITE practice: ${marker}`);
  }
  assert.ok(new Set(white.map(({ topicFamily }) => topicFamily)).size >= 30);
});

test('primary circuit taxonomy keeps legacy identity in BLUE and RED independently viable', () => {
  const beginner = QUESTION_BANKS.BEGINNER;
  assert.ok(beginner.filter(({ conceptId }) => conceptId.startsWith('identity-'))
    .every(({ securityCircuitId }) => securityCircuitId === 'BLUE'));
  assert.ok(new Set(beginner.filter(({ securityCircuitId }) => securityCircuitId === 'RED')
    .map(({ topicFamily }) => topicFamily)).size >= 30);
  assert.ok(beginner.every(({ securityCircuitId }) => ['WHITE', 'RED', 'BLUE'].includes(securityCircuitId)));
});

test('new WHITE and RED extension has distinct paired content and neutral option metadata', () => {
  assert.equal(CIRCUIT_QUESTIONS.length, 24);
  assert.deepEqual(
    Object.fromEntries(Object.entries(Object.groupBy(CIRCUIT_QUESTIONS, ({ securityCircuitId }) => securityCircuitId))
      .map(([circuit, questions]) => [circuit, questions.length])),
    { WHITE: 12, RED: 12 },
  );
  assert.equal(new Set(CIRCUIT_QUESTIONS.map(({ topicFamily }) => topicFamily)).size, 24);
  for (const question of CIRCUIT_QUESTIONS) {
    const beginner = question.variants.BEGINNER;
    const advanced = question.variants.ADVANCED;
    assert.notEqual(beginner.question, advanced.question);
    assert.notDeepEqual(beginner.evidence, advanced.evidence);
    assert.notDeepEqual(beginner.options.map(({ label }) => label), advanced.options.map(({ label }) => label));
    for (const variant of [beginner, advanced]) {
      assert.deepEqual(variant.options.map(({ id }) => id), ['choice-a', 'choice-b', 'choice-c', 'choice-d']);
      assert.equal(new Set(variant.options.map(({ technical }) => technical)).size, 1);
      assert.doesNotMatch(JSON.stringify(variant.options), /secure|correct|unsafe|decoy|answer/i);
      assert.ok(variant.options.some(({ id }) => id === variant.answerId));
    }
  }
});

test('trend cards are non-scored, dated, and linked to HTTPS sources', () => {
  assert.ok(TREND_CARDS.length >= 8);
  assert.equal(new Set(TREND_CARDS.map(({ id }) => id)).size, TREND_CARDS.length);
  for (const card of TREND_CARDS) {
    assert.equal(card.scoring, false);
    assert.match(card.source?.url ?? '', /^https:\/\//);
    assert.match(card.source?.publisher ?? '', /\S/);
    assert.match(card.reviewedAt ?? '', /^20\d\d-\d\d-\d\d$/);
  }
});
