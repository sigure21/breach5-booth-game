import { createHmac } from 'node:crypto';

export const DECK_PHASES = Object.freeze([
  'LAUNCH',
  'SECTOR_1', 'SECTOR_1',
  'PIT_STOP',
  'SECTOR_2', 'SECTOR_2',
  'SPRINT',
]);

function digest(secret, namespace, value) {
  return createHmac('sha256', secret).update(`${namespace}\u0000${value}`).digest('hex');
}

export function deckSeed({ ordinal, trackId, version, secret }) {
  return digest(secret, 'nitro-grid-deck', `${version}:${ordinal}:${trackId}`);
}

export function buildRaceDeck(questionBank, {
  ordinal,
  trackId,
  version = '1',
  secret,
} = {}) {
  if (!Array.isArray(questionBank) || questionBank.length < DECK_PHASES.length) {
    throw new Error('question bank must contain at least seven questions');
  }
  if (typeof secret !== 'string' && !Buffer.isBuffer(secret)) throw new Error('deck secret is required');
  const seed = deckSeed({ ordinal, trackId, version, secret });
  const ranked = questionBank
    .map((question) => ({ question, rank: digest(seed, trackId, question.id) }))
    .sort((left, right) => left.rank.localeCompare(right.rank));
  const contentStage = (phase) => ({
    LAUNCH: 'LAUNCH',
    SECTOR_1: 'SECTOR',
    PIT_STOP: 'PIT',
    SECTOR_2: 'SECTOR',
    SPRINT: 'SPRINT',
  })[phase];
  const supports = (question, phase) => !Array.isArray(question.stages)
    || question.stages.includes(contentStage(phase));
  const categoryUse = new Map();
  const used = new Set();
  const selected = [];
  for (const phase of DECK_PHASES) {
    const candidates = ranked
      .filter(({ question }) => !used.has(question.id) && supports(question, phase))
      .sort((left, right) => {
        const leftUse = categoryUse.get(left.question.category ?? 'general') ?? 0;
        const rightUse = categoryUse.get(right.question.category ?? 'general') ?? 0;
        return leftUse - rightUse || left.rank.localeCompare(right.rank);
      });
    const chosen = candidates[0]?.question;
    if (!chosen) throw new Error(`question bank has no unused question for ${phase}`);
    used.add(chosen.id);
    categoryUse.set(chosen.category ?? 'general', (categoryUse.get(chosen.category ?? 'general') ?? 0) + 1);
    selected.push(chosen);
  }
  return selected.map((question, index) => Object.freeze({
    ...question,
    racePhase: DECK_PHASES[index],
    gridPosition: index + 1,
  }));
}
