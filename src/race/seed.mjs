import { createHmac } from 'node:crypto';

export const DECK_SLOTS = Object.freeze([
  Object.freeze({ racePhase: 'LAUNCH', contentStage: 'LAUNCH' }),
  Object.freeze({ racePhase: 'LAP_1', contentStage: 'SECTOR' }),
  Object.freeze({ racePhase: 'LAP_1', contentStage: 'SECTOR' }),
  Object.freeze({ racePhase: 'LAP_1', contentStage: 'SECTOR' }),
  Object.freeze({ racePhase: 'LAP_1', contentStage: 'SECTOR' }),
  Object.freeze({ racePhase: 'PIT_STOP', contentStage: 'PIT' }),
  Object.freeze({ racePhase: 'LAP_2', contentStage: 'SECTOR' }),
  Object.freeze({ racePhase: 'LAP_2', contentStage: 'SECTOR' }),
  Object.freeze({ racePhase: 'LAP_2', contentStage: 'SECTOR' }),
  Object.freeze({ racePhase: 'SPRINT', contentStage: 'SPRINT' }),
]);

export const DECK_PHASES = Object.freeze(DECK_SLOTS.map(({ racePhase }) => racePhase));

function digest(secret, namespace, value) {
  return createHmac('sha256', secret).update(`${namespace}\u0000${value}`).digest('hex');
}

export function deckSeed({ matchId, circuitId, version = '1', secret }) {
  if (typeof secret !== 'string' && !Buffer.isBuffer(secret)) throw new Error('deck secret is required');
  return digest(secret, 'nitro-grid-heat-deck', `${version}:${matchId}:${circuitId}`);
}

export function buildRaceDeck(questionBank, {
  matchId,
  circuitId,
  version = '1',
  secret,
} = {}) {
  if (!Array.isArray(questionBank) || questionBank.length < DECK_SLOTS.length) {
    throw new Error('question bank must contain at least ten questions');
  }
  const seed = deckSeed({ matchId, circuitId, version, secret });
  const ranked = questionBank
    .map((question) => ({ question, rank: digest(seed, circuitId, question.id) }))
    .sort((left, right) => left.rank.localeCompare(right.rank));
  const categoryUse = new Map();
  const used = new Set();
  const selected = [];

  for (const slot of DECK_SLOTS) {
    const candidates = ranked
      .filter(({ question }) => !used.has(question.id)
        && (!Array.isArray(question.stages) || question.stages.includes(slot.contentStage)))
      .sort((left, right) => {
        const leftUse = categoryUse.get(left.question.category ?? 'general') ?? 0;
        const rightUse = categoryUse.get(right.question.category ?? 'general') ?? 0;
        return leftUse - rightUse || left.rank.localeCompare(right.rank);
      });
    const chosen = candidates[0]?.question;
    if (!chosen) throw new Error(`question bank has no unused question for ${slot.racePhase}`);
    used.add(chosen.id);
    categoryUse.set(chosen.category ?? 'general', (categoryUse.get(chosen.category ?? 'general') ?? 0) + 1);
    selected.push({ question: chosen, slot });
  }

  return selected.map(({ question, slot }, index) => Object.freeze({
    ...question,
    racePhase: slot.racePhase,
    gridPosition: index + 1,
  }));
}
