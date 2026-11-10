import assert from 'node:assert/strict';
import test from 'node:test';
import { QUESTION_BANK, QUESTION_BANK_VERSION } from '../src/content/questions.mjs';
import { TREND_CARDS } from '../src/content/trends.mjs';
import { CIRCUITS } from '../src/race/catalog.mjs';
import { buildRaceDeck } from '../src/race/seed.mjs';

test('question bank contains 30 unambiguous, evidence-backed items', () => {
  assert.equal(QUESTION_BANK.length, 30);
  assert.equal(new Set(QUESTION_BANK.map(({ id }) => id)).size, QUESTION_BANK.length);
  for (const question of QUESTION_BANK) {
    assert.match(question.id, /^[a-z0-9-]+$/);
    assert.ok(['IDENTITY', 'DEVICE', 'WEB_APP', 'CLOUD_SUPPLY', 'INCIDENT'].includes(question.category));
    assert.ok(Array.isArray(question.stages) && question.stages.length > 0);
    assert.ok(question.evidence.BEGINNER.length > 0);
    assert.ok(question.evidence.ADVANCED.length > 0);
    assert.equal(question.options.length, 4);
    assert.equal(new Set(question.options.map(({ id }) => id)).size, 4);
    assert.ok(question.options.some(({ id }) => id === question.correctOptionId));
    assert.ok(question.options.every(({ feedback }) => typeof feedback === 'string' && feedback.length > 10));
  }
});

test('every circuit can fill ten balanced encounter slots without duplicates', () => {
  const expectedPhases = ['LAUNCH', 'LAP_1', 'LAP_1', 'LAP_1', 'LAP_1', 'PIT_STOP', 'LAP_2', 'LAP_2', 'LAP_2', 'SPRINT'];
  for (const circuit of CIRCUITS) {
    for (let ordinal = 0; ordinal < 100; ordinal += 1) {
      const deck = buildRaceDeck(QUESTION_BANK, {
        matchId: `test-${ordinal}`,
        circuitId: circuit.id,
        version: QUESTION_BANK_VERSION,
        secret: 'a'.repeat(64),
      });
      assert.equal(deck.length, 10);
      assert.equal(new Set(deck.map(({ id }) => id)).size, 10);
      assert.deepEqual(deck.map(({ racePhase }) => racePhase), expectedPhases);
      assert.ok(new Set(deck.map(({ category }) => category)).size >= 4);
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
