import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HEAT_SIZE, MAX_ENCOUNTERS, MIN_ENCOUNTERS, PRODUCTION_TIMING, TOTAL_LAPS,
  maximumHeatRuntime, phaseBounds, scaledMatchTiming,
} from '../src/clock.mjs';

test('production heat uses a 30-45 second four-car matchmaking window', () => {
  assert.equal(HEAT_SIZE, 4);
  assert.equal(MIN_ENCOUNTERS, 10);
  assert.equal(MAX_ENCOUNTERS, 15);
  assert.equal(TOTAL_LAPS, 2);
  assert.deepEqual(PRODUCTION_TIMING, {
    minWaitMs: 30_000,
    maxWaitMs: 45_000,
    gridMs: 5_000,
    encounterMs: 15_000,
    minimumExposureMs: 4_000,
    resultMs: 25_000,
  });
  const timing = scaledMatchTiming();
  assert.equal(maximumHeatRuntime(timing), 300_000);
  assert.ok(timing.minWaitMs >= 30_000 && timing.maxWaitMs <= 60_000);
});

test('30 second verification timing preserves every heat boundary', () => {
  const timing = scaledMatchTiming(30_000);
  assert.deepEqual(timing, {
    minWaitMs: 3_000,
    maxWaitMs: 4_500,
    gridMs: 500,
    encounterMs: 1_500,
    minimumExposureMs: 400,
    resultMs: 2_500,
    minEncounters: 10,
    maxEncounters: 15,
    totalLaps: 2,
    seats: 4,
  });
  assert.equal(maximumHeatRuntime(timing), 30_000);
  assert.deepEqual(phaseBounds(30_000).map(({ id }) => id), ['MATCHING', 'GRID', 'RACING', 'RESULT']);
  assert.equal(phaseBounds(30_000).at(-1).endMs, 30_000);
});
