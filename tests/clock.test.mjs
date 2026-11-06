import assert from 'node:assert/strict';
import test from 'node:test';
import { clockAt, phaseAtElapsed, phaseBounds } from '../src/clock.mjs';

test('production phase ceilings cover exactly 180 seconds', () => {
  const expected = [
    ['JOIN', 0, 15_000],
    ['BRIEF', 15_000, 23_000],
    ['DISCOVER', 23_000, 48_000],
    ['BUILD', 48_000, 88_000],
    ['EXECUTE', 88_000, 103_000],
    ['DUEL', 103_000, 138_000],
    ['REVERIFY', 138_000, 163_000],
    ['RESULT', 163_000, 180_000],
  ];
  assert.deepEqual(phaseBounds().map(({ id, startMs, endMs }) => [id, startMs, endMs]), expected);
  for (const [id, start, end] of expected) {
    assert.equal(phaseAtElapsed(start).id, id);
    assert.equal(phaseAtElapsed(end - 1).id, id);
  }
});

test('clock rolls over on the server-owned 180 second boundary', () => {
  assert.equal(clockAt(179_999).roundId, 'r0');
  assert.equal(clockAt(179_999).phase, 'RESULT');
  assert.equal(clockAt(180_000).roundId, 'r1');
  assert.equal(clockAt(180_000).phase, 'JOIN');
  assert.equal(clockAt(540_001).roundId, 'r3');
  assert.equal(clockAt(540_001).phase, 'JOIN');
});

test('accelerated verification duration preserves phase ordering', () => {
  const bounds = phaseBounds(30_000);
  assert.equal(bounds[0].startMs, 0);
  assert.equal(bounds.at(-1).endMs, 30_000);
  assert.deepEqual(bounds.map((entry) => entry.id), [
    'JOIN', 'BRIEF', 'DISCOVER', 'BUILD', 'EXECUTE', 'DUEL', 'REVERIFY', 'RESULT',
  ]);
});
