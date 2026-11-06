export const PRODUCTION_ROUND_MS = 180_000;

export const PHASES = Object.freeze([
  { id: 'JOIN', start: 0, end: 15 },
  { id: 'BRIEF', start: 15, end: 23 },
  { id: 'DISCOVER', start: 23, end: 48 },
  { id: 'BUILD', start: 48, end: 88 },
  { id: 'EXECUTE', start: 88, end: 103 },
  { id: 'DUEL', start: 103, end: 138 },
  { id: 'REVERIFY', start: 138, end: 163 },
  { id: 'RESULT', start: 163, end: 180 },
]);

export function assertRoundDuration(roundMs) {
  if (!Number.isInteger(roundMs) || roundMs < 3_000 || roundMs > PRODUCTION_ROUND_MS) {
    throw new Error('ROUND_DURATION_MS must be an integer between 3000 and 180000');
  }
  return roundMs;
}

export function phaseBounds(roundMs = PRODUCTION_ROUND_MS) {
  assertRoundDuration(roundMs);
  return PHASES.map((phase, index) => ({
    ...phase,
    startMs: index === 0 ? 0 : Math.round((phase.start / 180) * roundMs),
    endMs: index === PHASES.length - 1 ? roundMs : Math.round((phase.end / 180) * roundMs),
  }));
}

export function phaseAtElapsed(elapsedMs, roundMs = PRODUCTION_ROUND_MS) {
  const normalized = Math.max(0, Math.min(roundMs - 1, Math.floor(elapsedMs)));
  return phaseBounds(roundMs).find((phase) => normalized >= phase.startMs && normalized < phase.endMs) ?? phaseBounds(roundMs).at(-1);
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
