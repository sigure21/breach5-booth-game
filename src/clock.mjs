export const PRODUCTION_ROUND_MS = 300_000;
export const HEAT_SIZE = 4;
export const TOTAL_ENCOUNTERS = 10;
export const TOTAL_LAPS = 2;

export const PRODUCTION_TIMING = Object.freeze({
  minWaitMs: 30_000,
  maxWaitMs: 45_000,
  gridMs: 5_000,
  encounterMs: 18_000,
  minimumExposureMs: 4_000,
  resultMs: 25_000,
});

export function assertRoundDuration(roundMs) {
  if (!Number.isInteger(roundMs) || roundMs < 30_000 || roundMs > PRODUCTION_ROUND_MS) {
    throw new Error('ROUND_DURATION_MS must be an integer between 30000 and 300000');
  }
  return roundMs;
}

export function scaledMatchTiming(roundMs = PRODUCTION_ROUND_MS) {
  assertRoundDuration(roundMs);
  const scale = roundMs / PRODUCTION_ROUND_MS;
  const scaled = (value, minimum) => Math.max(minimum, Math.round(value * scale));
  const minWaitMs = scaled(PRODUCTION_TIMING.minWaitMs, 250);
  const maxWaitMs = Math.max(minWaitMs, scaled(PRODUCTION_TIMING.maxWaitMs, 400));
  const gridMs = scaled(PRODUCTION_TIMING.gridMs, 100);
  const encounterMs = scaled(PRODUCTION_TIMING.encounterMs, 300);
  const minimumExposureMs = Math.min(encounterMs, scaled(PRODUCTION_TIMING.minimumExposureMs, 75));
  const resultMs = scaled(PRODUCTION_TIMING.resultMs, 300);
  return Object.freeze({
    minWaitMs,
    maxWaitMs,
    gridMs,
    encounterMs,
    minimumExposureMs,
    resultMs,
    totalEncounters: TOTAL_ENCOUNTERS,
    totalLaps: TOTAL_LAPS,
    seats: HEAT_SIZE,
  });
}

export function maximumHeatRuntime(timing) {
  return timing.maxWaitMs + timing.gridMs + timing.encounterMs * timing.totalEncounters + timing.resultMs;
}

// Compatibility helpers retained for operator health output and old imports.
export function clockAt(nowMs, { roundMs = PRODUCTION_ROUND_MS, epochMs = 0 } = {}) {
  assertRoundDuration(roundMs);
  const elapsedMs = Math.max(0, Math.floor(nowMs - epochMs));
  const ordinal = Math.floor(elapsedMs / roundMs);
  const startedAt = epochMs + ordinal * roundMs;
  return {
    roundId: `h${ordinal}`,
    ordinal,
    startedAt,
    endsAt: startedAt + roundMs,
    elapsedMs: nowMs - startedAt,
    remainingMs: Math.max(0, startedAt + roundMs - nowMs),
    phase: 'MATCHING',
    progress: Math.max(0, Math.min(1, (nowMs - startedAt) / roundMs)),
  };
}

export function clockForOrdinal(ordinal, nowMs, { roundMs = PRODUCTION_ROUND_MS, epochMs = 0 } = {}) {
  const startedAt = epochMs + ordinal * roundMs;
  const elapsedMs = nowMs - startedAt;
  if (elapsedMs >= 0 && elapsedMs < roundMs) return clockAt(nowMs, { roundMs, epochMs });
  return {
    roundId: `h${ordinal}`,
    ordinal,
    startedAt,
    endsAt: startedAt + roundMs,
    elapsedMs,
    remainingMs: startedAt + roundMs - nowMs,
    phase: elapsedMs < 0 ? 'QUEUED' : 'COMPLETE',
    progress: elapsedMs < 0 ? 0 : 1,
  };
}

export function phaseBounds(roundMs = PRODUCTION_ROUND_MS) {
  const timing = scaledMatchTiming(roundMs);
  return [
    { id: 'MATCHING', startMs: 0, endMs: timing.maxWaitMs },
    { id: 'GRID', startMs: timing.maxWaitMs, endMs: timing.maxWaitMs + timing.gridMs },
    {
      id: 'RACING',
      startMs: timing.maxWaitMs + timing.gridMs,
      endMs: timing.maxWaitMs + timing.gridMs + timing.encounterMs * timing.totalEncounters,
    },
    {
      id: 'RESULT',
      startMs: timing.maxWaitMs + timing.gridMs + timing.encounterMs * timing.totalEncounters,
      endMs: maximumHeatRuntime(timing),
    },
  ];
}

export function phaseAtElapsed(elapsedMs, roundMs = PRODUCTION_ROUND_MS) {
  const phases = phaseBounds(roundMs);
  return phases.find((phase) => elapsedMs >= phase.startMs && elapsedMs < phase.endMs) ?? phases.at(-1);
}
