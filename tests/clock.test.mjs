import assert from 'node:assert/strict';
import test from 'node:test';
import { clockAt, phaseAtElapsed, phaseBounds } from '../src/clock.mjs';

test('production race phases cover exactly five minutes', () => {
  const expected = [
    ['JOIN', 0, 30_000],
    ['LAUNCH', 30_000, 55_000],
    ['SECTOR_1', 55_000, 105_000],
    ['PIT_STOP', 105_000, 140_000],
    ['SECTOR_2', 140_000, 195_000],
    ['SPRINT', 195_000, 250_000],
    ['RESULT', 250_000, 300_000],
  ];
  assert.deepEqual(phaseBounds().map(({ id, startMs, endMs }) => [id, startMs, endMs]), expected);
  for (const [id, start, end] of expected) {
    assert.equal(phaseAtElapsed(start).id, id);
    assert.equal(phaseAtElapsed(end - 1).id, id);
  }
});

test('clock rolls over on the server-owned 300 second boundary', () => {
  assert.equal(clockAt(299_999).roundId, 'r0');
  assert.equal(clockAt(299_999).phase, 'RESULT');
  assert.equal(clockAt(300_000).roundId, 'r1');
  assert.equal(clockAt(300_000).phase, 'JOIN');
  assert.equal(clockAt(900_001).roundId, 'r3');
});

test('accelerated verification duration preserves race phase ordering', () => {
  const bounds = phaseBounds(30_000);
  assert.equal(bounds[0].startMs, 0);
  assert.equal(bounds.at(-1).endMs, 30_000);
  assert.deepEqual(bounds.map((entry) => entry.id), [
    'JOIN', 'LAUNCH', 'SECTOR_1', 'PIT_STOP', 'SECTOR_2', 'SPRINT', 'RESULT',
  ]);
});
