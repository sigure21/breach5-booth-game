export function answerIsCorrect(question, choice) {
  const expected = question.correctOptionId ?? question.correct ?? question.answer;
  return Array.isArray(expected) ? expected.includes(choice) : expected === choice;
}

export function raceScore(deck, actions, playerId) {
  const answers = deck.map((question) => {
    const action = actions.get(`${playerId}:${question.id}`) ?? null;
    return { question, action, correct: action ? answerIsCorrect(question, action.choice) : false };
  });
  const correctFor = (phase) => answers.filter(({ question, correct }) => question.racePhase === phase && correct).length;
  const answered = answers.filter(({ action }) => action).length;
  const correct = answers.filter((entry) => entry.correct).length;
  const launchBoost = correctFor('LAUNCH') === 1;
  const sectorOne = correctFor('SECTOR_1');
  const pitCorrect = correctFor('PIT_STOP') === 1;
  const sectorTwo = correctFor('SECTOR_2');
  const sprintCorrect = correctFor('SPRINT') === 1;
  return {
    answered,
    possible: deck.length,
    correct,
    accuracy: deck.length === 0 ? 0 : Math.round((correct / deck.length) * 100),
    launchBoost,
    nitro: Math.min(3, sectorOne + (launchBoost ? 1 : 0)),
    aeroActive: sectorTwo === 2,
    pitTimeMs: pitCorrect ? 1_900 : 4_100,
    nitroDeploy: sprintCorrect && (sectorOne > 0 || launchBoost),
  };
}

export function finishBand(score) {
  if (score.correct === score.possible) return 'POLE_POSITION';
  if (score.correct >= 5) return 'PODIUM';
  if (score.correct >= 3) return 'POINTS_FINISH';
  return 'GARAGE_REVIEW';
}
