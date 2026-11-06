import { scenario as proxyPanic } from './proxy-panic.mjs';
import { scenario as sessionHeist } from './session-heist.mjs';
import { DIFFICULTIES } from './shared.mjs';

export { DIFFICULTIES } from './shared.mjs';

export const SCENARIOS = Object.freeze(new Map([
  [proxyPanic.id, proxyPanic],
  [sessionHeist.id, sessionHeist],
]));

export function getScenario(id) {
  const scenario = SCENARIOS.get(id);
  if (!scenario) {
    const error = new Error('invalid scenario');
    error.code = 'invalid_scenario';
    throw error;
  }
  return scenario;
}

export function validateDifficulty(value) {
  if (!DIFFICULTIES.includes(value)) {
    const error = new Error('invalid difficulty');
    error.code = 'invalid_difficulty';
    throw error;
  }
  return value;
}

export function publicCatalog() {
  return [...SCENARIOS.values()].map((scenario) => ({
    id: scenario.id,
    title: scenario.title,
    subtitle: scenario.subtitle,
    shortLabel: scenario.shortLabel,
    category: scenario.category,
    briefing: scenario.briefing,
    source: scenario.source,
    sourceUrl: scenario.sourceUrl ?? null,
    rewardClaim: scenario.rewardClaim ?? null,
  }));
}
