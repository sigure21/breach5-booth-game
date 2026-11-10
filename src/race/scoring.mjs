const WEIGHT_BY_TIER = Object.freeze({ FOUNDATION: 6, APPLIED: 8, ANALYST: 10 });
const AI_NON_TIE_OFFSETS = Object.freeze([0.05, 0.04, 0.03]);
const AI_SCORE_BASE_CAP = 98.4;
const HUMAN_SCORE_MIX = Object.freeze({ knowledge: 0.90, crew: 0.05, driver: 0.05 });
const HARD_P4_WRONG_COUNT = 5;
const RETIREMENT_WRONG_COUNT = 7;

// Server-only legacy tier map. New pools may carry serverTier/serverTiers in the server module.
// Neither tiers nor their numeric weights are copied into any public response.
const LEGACY_TIERS = Object.freeze({
  'identity-password-reuse': Object.freeze({ BEGINNER: 'FOUNDATION', ADVANCED: 'APPLIED' }),
  'identity-phishing-resistant-mfa': Object.freeze({ BEGINNER: 'APPLIED', ADVANCED: 'ANALYST' }),
  'identity-oauth-consent': Object.freeze({ BEGINNER: 'APPLIED', ADVANCED: 'ANALYST' }),
  'identity-qr-phishing': Object.freeze({ BEGINNER: 'FOUNDATION', ADVANCED: 'APPLIED' }),
  'identity-stolen-session': Object.freeze({ BEGINNER: 'APPLIED', ADVANCED: 'ANALYST' }),
  'identity-helpdesk-reset': Object.freeze({ BEGINNER: 'APPLIED', ADVANCED: 'ANALYST' }),
  'device-patch-priority': Object.freeze({ BEGINNER: 'FOUNDATION', ADVANCED: 'APPLIED' }),
  'device-backup-restore': Object.freeze({ BEGINNER: 'FOUNDATION', ADVANCED: 'APPLIED' }),
  'device-browser-extension': Object.freeze({ BEGINNER: 'FOUNDATION', ADVANCED: 'APPLIED' }),
  'device-lost-phone': Object.freeze({ BEGINNER: 'FOUNDATION', ADVANCED: 'APPLIED' }),
  'device-ransomware-first': Object.freeze({ BEGINNER: 'APPLIED', ADVANCED: 'ANALYST' }),
  'web-sql-injection': Object.freeze({ BEGINNER: 'APPLIED', ADVANCED: 'ANALYST' }),
  'web-xss-output': Object.freeze({ BEGINNER: 'APPLIED', ADVANCED: 'ANALYST' }),
  'web-csrf': Object.freeze({ BEGINNER: 'APPLIED', ADVANCED: 'ANALYST' }),
  'web-ssrf': Object.freeze({ BEGINNER: 'ANALYST', ADVANCED: 'ANALYST' }),
  'web-idor': Object.freeze({ BEGINNER: 'APPLIED', ADVANCED: 'ANALYST' }),
  'web-frontend-secret': Object.freeze({ BEGINNER: 'FOUNDATION', ADVANCED: 'APPLIED' }),
  'web-unsafe-deserialization': Object.freeze({ BEGINNER: 'ANALYST', ADVANCED: 'ANALYST' }),
  'cloud-public-storage': Object.freeze({ BEGINNER: 'FOUNDATION', ADVANCED: 'APPLIED' }),
  'cloud-ci-credential': Object.freeze({ BEGINNER: 'APPLIED', ADVANCED: 'ANALYST' }),
  'cloud-typosquat-package': Object.freeze({ BEGINNER: 'FOUNDATION', ADVANCED: 'APPLIED' }),
  'cloud-sbom-use': Object.freeze({ BEGINNER: 'APPLIED', ADVANCED: 'ANALYST' }),
  'cloud-sensitive-logs': Object.freeze({ BEGINNER: 'APPLIED', ADVANCED: 'ANALYST' }),
  'cloud-stale-oauth-app': Object.freeze({ BEGINNER: 'APPLIED', ADVANCED: 'ANALYST' }),
  'cloud-share-link': Object.freeze({ BEGINNER: 'FOUNDATION', ADVANCED: 'APPLIED' }),
  'incident-suspicious-attachment': Object.freeze({ BEGINNER: 'FOUNDATION', ADVANCED: 'APPLIED' }),
  'incident-bec-payment': Object.freeze({ BEGINNER: 'APPLIED', ADVANCED: 'ANALYST' }),
  'incident-secret-in-git': Object.freeze({ BEGINNER: 'APPLIED', ADVANCED: 'ANALYST' }),
  'incident-impossible-travel': Object.freeze({ BEGINNER: 'APPLIED', ADVANCED: 'ANALYST' }),
  'incident-https-domain': Object.freeze({ BEGINNER: 'FOUNDATION', ADVANCED: 'APPLIED' }),
});

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function roundTenth(value) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function tierFor(question, difficulty) {
  const tier = question.serverTier
    ?? question.serverWeightTier
    ?? question.serverTiers?.[difficulty]
    ?? LEGACY_TIERS[question.id]?.[difficulty];
  if (!Object.hasOwn(WEIGHT_BY_TIER, tier)) {
    throw new Error(`missing server score tier for ${difficulty}:${question.id}`);
  }
  return tier;
}

function maximumStreak(results) {
  let current = 0;
  let maximum = 0;
  for (const correct of results) {
    current = correct ? current + 1 : 0;
    maximum = Math.max(maximum, current);
  }
  return maximum;
}

export function answerIsCorrect(question, choice) {
  const expected = question.correctOptionId ?? question.correct ?? question.answer;
  return Array.isArray(expected) ? expected.includes(choice) : expected === choice;
}

export function aiNonTieOffsetForOrdinal(ordinal) {
  if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= AI_NON_TIE_OFFSETS.length) {
    throw new Error('AI ordinal must be between 0 and 2');
  }
  return AI_NON_TIE_OFFSETS[ordinal];
}

export function scoreFromResults(
  deck,
  results,
  answered = results.length,
  observedCount = results.length,
  {
    difficulty = deck[0]?.difficulty ?? 'BEGINNER',
    crewPerformance = 100,
    driverSkill = 100,
    aiOrdinal = null,
  } = {},
) {
  const observed = clamp(
    Number.isInteger(observedCount) ? observedCount : results.length,
    0,
    deck.length,
  );
  const answeredCount = clamp(
    Number.isInteger(answered) ? answered : results.length,
    0,
    observed,
  );
  const normalized = deck.map((_, index) => index < observed && results[index] === true);
  const correct = normalized.filter(Boolean).length;
  const wrongCount = observed - correct;
  const observedDeck = deck.slice(0, observed);
  const possibleWeight = observedDeck.reduce(
    (total, question) => total + WEIGHT_BY_TIER[tierFor(question, difficulty)],
    0,
  );
  const earnedWeight = observedDeck.reduce((total, question, index) => (
    total + (normalized[index] ? WEIGHT_BY_TIER[tierFor(question, difficulty)] : 0)
  ), 0);
  const knowledgeScore = possibleWeight === 0 ? 0 : (earnedWeight / possibleWeight) * 100;
  const isAi = Number.isInteger(aiOrdinal);
  const balancedScore = roundTenth(clamp(
    HUMAN_SCORE_MIX.knowledge * knowledgeScore
      + HUMAN_SCORE_MIX.crew * crewPerformance
      + HUMAN_SCORE_MIX.driver * driverSkill,
    0,
    100,
  ));
  // Human totals are tenths. AI gets a small hundredths offset and a cap below the
  // weakest perfect human, preventing cross-class ties without overriding knowledge.
  // Knowledge remains dominant while public game-balance ratings have a bounded 10% influence.
  const raceScore = isAi
    ? Math.min(
      AI_SCORE_BASE_CAP + aiNonTieOffsetForOrdinal(aiOrdinal),
      balancedScore + aiNonTieOffsetForOrdinal(aiOrdinal),
    )
    : balancedScore;
  const retired = wrongCount >= RETIREMENT_WRONG_COUNT;
  const hardP4 = !retired && !isAi && wrongCount >= HARD_P4_WRONG_COUNT;
  const correctFor = (phase) => deck.reduce((count, question, index) => (
    question.racePhase === phase && normalized[index] ? count + 1 : count
  ), 0);
  const launchBoost = normalized[0] === true;
  const pitIndex = deck.findIndex(({ racePhase }) => racePhase === 'PIT_STOP');
  const pitCorrect = pitIndex >= 0 && normalized[pitIndex];
  const streak = maximumStreak(normalized.slice(0, observed));
  const batteryPercent = Math.min(100, 28 + correct * 6 + streak * 3 + (launchBoost ? 6 : 0));
  const secondLapCorrect = correctFor('LAP_2') + correctFor('SPRINT');
  const boostMode = streak >= 2 && batteryPercent >= 45;
  return {
    answered: answeredCount,
    possible: deck.length,
    correct,
    wrongCount,
    accuracy: deck.length === 0 ? 0 : Math.round((correct / deck.length) * 100),
    streak,
    launchBoost,
    batteryPercent,
    boostMode,
    overtakeMode: false,
    activeAero: secondLapCorrect >= 2,
    pitTimeMs: pitCorrect ? 2_050 : 4_350,
    cleanCorners: correctFor('LAP_1') + correctFor('LAP_2'),
    finalAttack: correctFor('SPRINT') === 1,
    // Internal scoring fields. Callers must explicitly project public response objects.
    raceScore,
    rankingScore: raceScore,
    hardP4,
    retired,
    knowledgeScore,
    earnedWeight,
    possibleWeight,
  };
}

export function raceScore(deck, actions, playerId, context = {}) {
  const entries = deck.map((question) => {
    const action = actions.get(`${playerId}:${question.id}`) ?? null;
    return { action, correct: action ? answerIsCorrect(question, action.choice) : false };
  });
  return scoreFromResults(
    deck,
    entries.map(({ correct }) => correct),
    entries.filter(({ action }) => action).length,
    deck.length,
    context,
  );
}

export function finishBand(score, position = null) {
  if (score.retired) return 'RETIRED';
  if (score.hardP4) return 'P4';
  if (Number.isInteger(position) && position >= 1 && position <= 4) return `P${position}`;
  return 'P4';
}
