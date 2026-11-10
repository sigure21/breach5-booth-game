import { createHmac } from 'node:crypto';
import { MAX_ENCOUNTERS, MIN_ENCOUNTERS } from '../clock.mjs';

const SECURITY_CIRCUIT_IDS = Object.freeze(['WHITE', 'RED', 'BLUE', 'FULL_STACK']);

function digest(secret, namespace, value) {
  return createHmac('sha256', secret).update(`${namespace}\u0000${value}`).digest('hex');
}

function assertEncounterRange(minEncounters, maxEncounters) {
  if (!Number.isInteger(minEncounters) || !Number.isInteger(maxEncounters)
    || minEncounters < MIN_ENCOUNTERS || maxEncounters > MAX_ENCOUNTERS
    || minEncounters > maxEncounters) {
    throw new Error(`encounter range must be between ${MIN_ENCOUNTERS} and ${MAX_ENCOUNTERS}`);
  }
}

export function buildDeckSlots(encounterCount) {
  if (!Number.isInteger(encounterCount)
    || encounterCount < MIN_ENCOUNTERS || encounterCount > MAX_ENCOUNTERS) {
    throw new Error(`encounter count must be between ${MIN_ENCOUNTERS} and ${MAX_ENCOUNTERS}`);
  }
  const pitIndex = Math.floor(encounterCount / 2);
  return Object.freeze(Array.from({ length: encounterCount }, (_, index) => {
    if (index === 0) return Object.freeze({ racePhase: 'LAUNCH', contentStage: 'LAUNCH' });
    if (index === pitIndex) return Object.freeze({ racePhase: 'PIT_STOP', contentStage: 'PIT' });
    if (index === encounterCount - 1) return Object.freeze({ racePhase: 'SPRINT', contentStage: 'SPRINT' });
    return Object.freeze({
      racePhase: index < pitIndex ? 'LAP_1' : 'LAP_2',
      contentStage: 'SECTOR',
    });
  }));
}

// Compatibility exports describe the minimum-size heat. Each match carries its actual slots/count.
export const DECK_SLOTS = buildDeckSlots(MIN_ENCOUNTERS);
export const DECK_PHASES = Object.freeze(DECK_SLOTS.map(({ racePhase }) => racePhase));

export function deckSeed({
  matchId,
  circuitId,
  difficulty = 'BEGINNER',
  securityCircuitId = 'FULL_STACK',
  encounterCount = MIN_ENCOUNTERS,
  version = '1',
  secret,
}) {
  if (typeof secret !== 'string' && !Buffer.isBuffer(secret)) throw new Error('deck secret is required');
  return digest(
    secret,
    'nitro-grid-heat-deck',
    `${version}:${matchId}:${circuitId}:${difficulty}:${securityCircuitId}:${encounterCount}`,
  );
}

export function encounterCountForMatch({
  matchId,
  circuitId,
  minEncounters = MIN_ENCOUNTERS,
  maxEncounters = MAX_ENCOUNTERS,
  version = '1',
  secret,
}) {
  assertEncounterRange(minEncounters, maxEncounters);
  if (typeof secret !== 'string' && !Buffer.isBuffer(secret)) throw new Error('deck secret is required');
  const value = Number.parseInt(
    digest(secret, 'nitro-grid-encounter-count', `${version}:${matchId}:${circuitId}`).slice(0, 8),
    16,
  );
  return minEncounters + (value % (maxEncounters - minEncounters + 1));
}

function variantFromConcept(question, difficulty) {
  const variant = question?.variants?.[difficulty] ?? question?.[difficulty];
  if (!variant || typeof variant !== 'object' || Array.isArray(variant)) return null;
  return {
    ...question,
    ...variant,
    id: variant.id ?? `${question.id}-${difficulty.toLowerCase()}`,
    difficulty,
    variants: undefined,
    BEGINNER: undefined,
    ADVANCED: undefined,
    serverTier: variant.serverTier
      ?? variant.serverWeightTier
      ?? question.serverTiers?.[difficulty]
      ?? question.serverTier
      ?? question.serverWeightTier,
  };
}

function questionFamilyKey(question) {
  return question.topicFamily ?? question.conceptId ?? question.id;
}

function questionEligibleForLane(question, lane) {
  return question.securityCircuitId === undefined || question.securityCircuitId === lane;
}

export function questionsForDifficulty(questionSource, difficulty) {
  const source = Array.isArray(questionSource)
    ? questionSource
    : questionSource?.[difficulty] ?? [];
  if (!Array.isArray(source)) throw new Error(`question pool for ${difficulty} must be an array`);
  return source.flatMap((question) => {
    const variant = variantFromConcept(question, difficulty);
    if (variant) return [variant];
    if (question?.difficulty && question.difficulty !== difficulty) return [];
    if (Array.isArray(question?.difficulties) && !question.difficulties.includes(difficulty)) return [];
    return [{ ...question, difficulty: question.difficulty ?? difficulty }];
  });
}

export function buildRaceDeck(questionSource, {
  matchId,
  circuitId,
  difficulty = 'BEGINNER',
  securityCircuitId = 'FULL_STACK',
  encounterCount = MIN_ENCOUNTERS,
  version = '1',
  secret,
} = {}) {
  if (!SECURITY_CIRCUIT_IDS.includes(securityCircuitId)) {
    throw new Error(`invalid security circuit: ${securityCircuitId}`);
  }
  const slots = buildDeckSlots(encounterCount);
  const questionBank = questionsForDifficulty(questionSource, difficulty);
  if (questionBank.length < slots.length) {
    throw new Error(`${difficulty} question bank must contain at least ${slots.length} questions`);
  }
  const seed = deckSeed({
    matchId, circuitId, difficulty, securityCircuitId, encounterCount, version, secret,
  });
  const fullStackStartsWithRed = Number.parseInt(
    digest(seed, 'full-stack-start', `${matchId}:${difficulty}`).slice(0, 8),
    16,
  ) % 2 === 0;
  const securityLanes = slots.map((_, index) => {
    if (securityCircuitId !== 'FULL_STACK') return securityCircuitId;
    const redTurn = index % 2 === 0 ? fullStackStartsWithRed : !fullStackStartsWithRed;
    return redTurn ? 'RED' : 'BLUE';
  });
  const ranked = questionBank
    .map((question) => ({ question, rank: digest(seed, difficulty, question.id) }))
    .sort((left, right) => left.rank.localeCompare(right.rank));
  const used = new Set();
  const selected = [];

  for (const [slotIndex, slot] of slots.entries()) {
    const securityLane = securityLanes[slotIndex];
    const eligibleQuestions = ranked
      .filter(({ question }) => questionEligibleForLane(question, securityLane)
        && !used.has(questionFamilyKey(question)));
    const familyCandidates = new Map();
    for (const candidate of eligibleQuestions) {
      const family = questionFamilyKey(candidate.question);
      const current = familyCandidates.get(family);
      if (!current || candidate.rank < current.rank) familyCandidates.set(family, candidate);
    }
    const candidates = [...familyCandidates.entries()]
      .map(([, candidate]) => candidate)
      // The family's rank is its best per-variant HMAC rank. This keeps one item per
      // topic family while giving each playable variant comparable exposure.
      .sort((left, right) => left.rank.localeCompare(right.rank));
    const chosen = candidates[0]?.question;
    if (!chosen) {
      throw new Error(`${difficulty}/${securityCircuitId} question bank has no unused question for ${slot.racePhase}`);
    }
    used.add(questionFamilyKey(chosen));
    selected.push({ question: chosen, slot, securityLane });
  }

  return selected.map(({ question, slot, securityLane }, index) => Object.freeze({
    ...question,
    options: Object.freeze([...(question.options ?? [])]
      .map((option) => ({
        option,
        rank: digest(
          seed,
          `option:${question.id}`,
          typeof option === 'string' ? option : option.id,
        ),
      }))
      .sort((left, right) => left.rank.localeCompare(right.rank))
      .map(({ option }) => option)),
    racePhase: slot.racePhase,
    securityCircuitId,
    securityLane,
    gridPosition: index + 1,
  }));
}
