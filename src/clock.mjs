export const PRODUCTION_ROUND_MS = 300_000;

export const PHASES = Object.freeze([
  { id: 'JOIN', start: 0, end: 30 },
  { id: 'LAUNCH', start: 30, end: 55 },
  { id: 'SECTOR_1', start: 55, end: 105 },
  { id: 'PIT_STOP', start: 105, end: 140 },
  { id: 'SECTOR_2', start: 140, end: 195 },
  { id: 'SPRINT', start: 195, end: 250 },
  { id: 'RESULT', start: 250, end: 300 },
]);

export function assertRoundDuration(roundMs) {
  if (!Number.isInteger(roundMs) || roundMs < 3_000 || roundMs > PRODUCTION_ROUND_MS) {
    throw new Error('ROUND_DURATION_MS must be an integer between 3000 and 300000');
  }
  return roundMs;
}

export function phaseBounds(roundMs = PRODUCTION_ROUND_MS) {
  assertRoundDuration(roundMs);
  return PHASES.map((phase, index) => ({
    ...phase,
    startMs: index === 0 ? 0 : Math.round((phase.start / 300) * roundMs),
    endMs: index === PHASES.length - 1 ? roundMs : Math.round((phase.end / 300) * roundMs),
  }));
}

export function phaseAtElapsed(elapsedMs, roundMs = PRODUCTION_ROUND_MS) {
  const normalized = Math.max(0, Math.min(roundMs - 1, Math.floor(elapsedMs)));
  const bounds = phaseBounds(roundMs);
  return bounds.find((phase) => normalized >= phase.startMs && normalized < phase.endMs) ?? bounds.at(-1);
}

export function clockAt(nowMs, { roundMs = PRODUCTION_ROUND_MS, epochMs = 0 } = {}) {
  assertRoundDuration(roundMs);
  if (!Number.isFinite(nowMs) || !Number.isFinite(epochMs)) throw new Error('clock values must be finite');
  const relative = Math.max(0, Math.floor(nowMs - epochMs));
  const ordinal = Math.floor(relative / roundMs);
  const startedAt = epochMs + ordinal * roundMs;
  const elapsedMs = Math.max(0, nowMs - startedAt);
  const phase = phaseAtElapsed(elapsedMs, roundMs);
  return {
    roundId: `r${ordinal}`,
    ordinal,
    startedAt,
    endsAt: startedAt + roundMs,
    elapsedMs,
    remainingMs: Math.max(0, startedAt + roundMs - nowMs),
    phase: phase.id,
    phaseStartedAt: startedAt + phase.startMs,
    phaseEndsAt: startedAt + phase.endMs,
    phaseRemainingMs: Math.max(0, startedAt + phase.endMs - nowMs),
    progress: Math.max(0, Math.min(1, elapsedMs / roundMs)),
  };
}

export function clockForOrdinal(ordinal, nowMs, { roundMs = PRODUCTION_ROUND_MS, epochMs = 0 } = {}) {
  const startedAt = epochMs + ordinal * roundMs;
  const elapsedMs = nowMs - startedAt;
  if (elapsedMs >= 0 && elapsedMs < roundMs) return clockAt(nowMs, { roundMs, epochMs });
  return {
    roundId: `r${ordinal}`,
    ordinal,
    startedAt,
    endsAt: startedAt + roundMs,
    elapsedMs,
    remainingMs: startedAt + roundMs - nowMs,
    phase: elapsedMs < 0 ? 'QUEUED' : 'COMPLETE',
    phaseStartedAt: startedAt,
    phaseEndsAt: elapsedMs < 0 ? startedAt : startedAt + roundMs,
    phaseRemainingMs: elapsedMs < 0 ? -elapsedMs : 0,
    progress: elapsedMs < 0 ? 0 : 1,
  };
}
