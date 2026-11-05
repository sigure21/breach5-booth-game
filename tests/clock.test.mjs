import assert from 'node:assert/strict';
import test from 'node:test';
import { clockAt, phaseAtElapsed, phaseBounds } from '../src/clock.mjs';

test('production phase boundaries cover exactly 300 seconds', () => {
  const expected = [
    ['JOIN', 0, 20_000],
    ['BRIEF', 20_000, 50_000],
    ['DISCOVER', 50_000, 95_000],
    ['BUILD', 95_000, 155_000],
    ['EXECUTE', 155_000, 185_000],
    ['DUEL', 185_000, 245_000],
    ['REVERIFY', 245_000, 275_000],
    ['RESULT', 275_000, 300_000],
  ];
  assert.deepEqual(phaseBounds().map(({ id, startMs, endMs }) => [id, startMs, endMs]), expected);
  for (const [id, start, end] of expected) {
    assert.equal(phaseAtElapsed(start).id, id);
    assert.equal(phaseAtElapsed(end - 1).id, id);
  }
});

test('clock rolls over without client-side drift', () => {
  assert.equal(clockAt(299_999).roundId, 'r0');
  assert.equal(clockAt(299_999).phase, 'RESULT');
  assert.equal(clockAt(300_000).roundId, 'r1');
  assert.equal(clockAt(300_000).phase, 'JOIN');
  assert.equal(clockAt(900_001).roundId, 'r3');
  assert.equal(clockAt(900_001).phase, 'JOIN');
});

test('accelerated test duration preserves phase ordering', () => {
  const bounds = phaseBounds(30_000);
  assert.equal(bounds[0].startMs, 0);
  assert.equal(bounds.at(-1).endMs, 30_000);
  assert.deepEqual(bounds.map((entry) => entry.id), ['JOIN', 'BRIEF', 'DISCOVER', 'BUILD', 'EXECUTE', 'DUEL', 'REVERIFY', 'RESULT']);
});
