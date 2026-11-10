export function answerIsCorrect(question, choice) {
  const expected = question.correctOptionId ?? question.correct ?? question.answer;
  return Array.isArray(expected) ? expected.includes(choice) : expected === choice;
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

export function scoreFromResults(
  deck,
  results,
  answered = results.length,
  observedCount = results.length,
) {
  const observed = Math.max(0, Math.min(
    deck.length,
    Number.isInteger(observedCount) ? observedCount : results.length,
  ));
  const answeredCount = Math.max(0, Math.min(
    observed,
    Number.isInteger(answered) ? answered : results.length,
  ));
  const normalized = deck.map((_, index) => index < observed && results[index] === true);
  const correct = normalized.filter(Boolean).length;
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
    accuracy: deck.length === 0 ? 0 : Math.round((correct / deck.length) * 100),
    streak,
    launchBoost,
    batteryPercent,
    boostMode,
    // Competitor gap is applied by the race model; these are safe defaults for score-only responses.
    overtakeMode: false,
    activeAero: secondLapCorrect >= 2,
    pitTimeMs: pitCorrect ? 2_050 : 4_350,
    cleanCorners: correctFor('LAP_1') + correctFor('LAP_2'),
    finalAttack: correctFor('SPRINT') === 1,
  };
}

export function raceScore(deck, actions, playerId) {
  const entries = deck.map((question) => {
    const action = actions.get(`${playerId}:${question.id}`) ?? null;
    return { action, correct: action ? answerIsCorrect(question, action.choice) : false };
  });
  return scoreFromResults(
    deck,
    entries.map(({ correct }) => correct),
    entries.filter(({ action }) => action).length,
    deck.length,
  );
}

export function finishBand(score) {
  if (score.correct === score.possible) return 'POLE_POSITION';
  if (score.correct >= 8) return 'PODIUM';
  if (score.correct >= 6) return 'POINTS_FINISH';
  return 'GARAGE_REVIEW';
}
