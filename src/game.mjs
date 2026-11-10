import { createHmac, randomBytes, randomInt } from 'node:crypto';
import {
  HEAT_SIZE,
  MAX_ENCOUNTERS,
  MIN_ENCOUNTERS,
  PRODUCTION_ROUND_MS,
  TOTAL_LAPS,
  maximumHeatRuntime,
  scaledMatchTiming,
} from './clock.mjs';
import * as questionContent from './content/questions.mjs';
import { TREND_CARDS } from './content/trends.mjs';
import {
  CIRCUITS,
  CREWS,
  DIFFICULTIES,
  DRIVERS,
  SECURITY_CIRCUITS,
  getCrew,
  getDriver,
  publicRaceCatalog,
  validateDifficulty,
  validateSecurityCircuit,
} from './race/catalog.mjs';
import { buildRaceDeck, encounterCountForMatch } from './race/seed.mjs';
import { answerIsCorrect, finishBand, raceScore, scoreFromResults } from './race/scoring.mjs';

const DEFAULT_QUESTION_SOURCE = questionContent.QUESTION_BANKS ?? questionContent.QUESTION_BANK;
const DEFAULT_QUESTION_BANK_VERSION = questionContent.QUESTION_BANK_VERSION ?? '1';

const MATCH_STATUSES = Object.freeze(['MATCHING', 'GRID', 'RACING', 'RESULT', 'COMPLETE']);
const ADJECTIVES = Object.freeze(['NEON', 'SWIFT', 'QUIET', 'BRAVE', 'LUCID', 'NOVA', 'PIXEL', 'SOLAR']);
const ANIMALS = Object.freeze(['OWL', 'FOX', 'OTTER', 'RAVEN', 'TIGER', 'GECKO', 'MANTA', 'LYNX']);
const AI_NAMES = Object.freeze(['AI APEX', 'AI VECTOR', 'AI CHICANE']);
const SAFE_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_ACTION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;

function token() { return randomBytes(24).toString('base64url'); }
function randomId(prefix) { return `${prefix}_${randomBytes(8).toString('hex')}`; }
function safeText(value) { return typeof value === 'string' ? value : ''; }
function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }

function expectedChoice(question) {
  return question.correctOptionId ?? question.correct ?? question.answer;
}

function optionId(option) {
  return typeof option === 'string' ? option : option.id;
}

function optionLabel(option) {
  if (typeof option === 'string') return option;
  return option.label ?? option.text ?? option.id;
}

function questionPrompt(question) {
  return question.question ?? question.prompt ?? question.title ?? '';
}

function evidenceFor(question, difficulty) {
  const raw = question.evidence?.[difficulty] ?? question.evidence?.[difficulty.toLowerCase()] ?? question.evidence ?? [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') return [{ type: 'note', label: 'EVIDENCE', value: raw }];
  if (raw && typeof raw === 'object') {
    return Object.entries(raw).map(([label, value]) => ({ type: 'note', label, value }));
  }
  return [];
}

function explanationFor(question, choice = null) {
  const selected = (question.options ?? []).find((option) => optionId(option) === choice);
  return safeText(selected?.feedback ?? question.explanation ?? question.takeaway ?? question.rationale ?? question.feedback);
}

function publicQuestion(question, difficulty, action = null) {
  const generated = question.topicFamily && question.conceptId && question.topicFamily !== question.conceptId;
  const evidence = evidenceFor(question, difficulty).map((item) => (
    generated && item && typeof item === 'object'
      ? Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'annotation'))
      : item
  ));
  const options = (question.options ?? []).map((option) => ({
    id: optionId(option),
    label: optionLabel(option),
    technical: typeof option === 'object'
      ? safeText(option.technical ?? option.detail ?? option.description)
      : '',
  }));
  const technicalValues = [...new Set(options.map(({ technical }) => technical).filter(Boolean))];
  const decisionFrame = technicalValues.length === 1 ? technicalValues[0] : null;
  return {
    id: question.id,
    taskId: question.id,
    category: question.category ?? 'general',
    topic: question.topic ?? null,
    securityCircuitId: question.securityCircuitId,
    securityLane: question.securityLane,
    question: questionPrompt(question),
    evidence,
    decisionFrame,
    options: options.map((option) => ({
      ...option,
      technical: decisionFrame ? '' : option.technical,
    })),
    racePhase: question.racePhase,
    gridPosition: question.gridPosition,
    selected: action?.choice ?? null,
    feedback: action ? {
      correct: action.correct,
      explanation: explanationFor(question, action.choice),
      correctOptionId: expectedChoice(question),
    } : null,
  };
}

function hmacHex(secret, namespace, value) {
  return createHmac('sha256', secret).update(`${namespace}\u0000${value}`).digest('hex');
}

function deterministicUnit(secret, namespace, value) {
  return Number.parseInt(hmacHex(secret, namespace, value).slice(0, 13), 16) / 0xfffffffffffff;
}

function publicTrend(card) {
  if (!card) return null;
  return {
    ...card,
    sourceName: card.sourceName ?? card.source?.publisher ?? null,
    sourceUrl: card.sourceUrl ?? card.source?.url ?? null,
    asOf: card.asOf ?? card.source?.publishedAt ?? card.reviewedAt ?? null,
    takeaway: card.takeaway ?? (Array.isArray(card.actions) ? card.actions.join(' · ') : null),
  };
}

function assertTiming(timing) {
  const positive = ['minWaitMs', 'maxWaitMs', 'gridMs', 'encounterMs', 'minimumExposureMs', 'resultMs'];
  for (const field of positive) {
    if (!Number.isInteger(timing[field]) || timing[field] <= 0) throw new Error(`${field} must be a positive integer`);
  }
  if (timing.maxWaitMs < timing.minWaitMs) throw new Error('maxWaitMs must be greater than or equal to minWaitMs');
  if (timing.minimumExposureMs > timing.encounterMs) {
    throw new Error('minimumExposureMs must not exceed encounterMs');
  }
  if (!Number.isInteger(timing.minEncounters) || !Number.isInteger(timing.maxEncounters)
    || timing.minEncounters < MIN_ENCOUNTERS || timing.maxEncounters > MAX_ENCOUNTERS
    || timing.minEncounters > timing.maxEncounters) {
    throw new Error(`encounter range must be between ${MIN_ENCOUNTERS} and ${MAX_ENCOUNTERS}`);
  }
  if (maximumHeatRuntime(timing) > PRODUCTION_ROUND_MS) {
    throw new Error(`maximum heat runtime must not exceed ${PRODUCTION_ROUND_MS}ms`);
  }
}

function raceEffect(question, correct, score) {
  if (!correct) return '추가 페이스가 적용되지 않았습니다. 근거를 복기하고 다음 구간을 준비하세요.';
  if (question.racePhase === 'LAUNCH') return 'LAUNCH BOOST 활성화';
  if (question.racePhase === 'PIT_STOP') return `FAST PIT ${(score.pitTimeMs / 1_000).toFixed(2)}초`;
  if (question.racePhase === 'SPRINT') return 'FINAL ATTACK 준비 완료';
  return score.boostMode
    ? `BATTERY ${score.batteryPercent}% · BOOST 준비`
    : `BATTERY ${score.batteryPercent}% · RECHARGE`;
}

function publicLiveScore(score) {
  return {
    answered: score.answered,
    possible: score.possible,
    correct: score.correct,
    accuracy: score.accuracy,
    streak: score.streak,
    launchBoost: score.launchBoost,
    batteryPercent: score.batteryPercent,
    boostMode: score.boostMode,
    overtakeMode: false,
    activeAero: score.activeAero,
    pitTimeMs: score.pitTimeMs,
    cleanCorners: score.cleanCorners,
    finalAttack: score.finalAttack,
  };
}

export class GameStore {
  constructor({
    now = () => Date.now(),
    roundMs = PRODUCTION_ROUND_MS,
    matchMinWaitMs,
    matchMaxWaitMs,
    gridMs,
    encounterMs,
    minimumExposureMs,
    resultMs,
    minEncounters,
    maxEncounters,
    maxPlayers = 48,
    sessionTtlMs = 15 * 60_000,
    seedSecret = randomBytes(32).toString('hex'),
    questionBank = DEFAULT_QUESTION_SOURCE,
    questionBankVersion = DEFAULT_QUESTION_BANK_VERSION,
  } = {}) {
    const scaled = scaledMatchTiming(roundMs);
    const timing = Object.freeze({
      ...scaled,
      minWaitMs: matchMinWaitMs ?? scaled.minWaitMs,
      maxWaitMs: matchMaxWaitMs ?? scaled.maxWaitMs,
      gridMs: gridMs ?? scaled.gridMs,
      encounterMs: encounterMs ?? scaled.encounterMs,
      minimumExposureMs: minimumExposureMs ?? scaled.minimumExposureMs,
      resultMs: resultMs ?? scaled.resultMs,
      seats: HEAT_SIZE,
      minEncounters: minEncounters ?? scaled.minEncounters,
      maxEncounters: maxEncounters ?? scaled.maxEncounters,
      totalLaps: TOTAL_LAPS,
    });
    assertTiming(timing);
    if (!Number.isInteger(maxPlayers) || maxPlayers < HEAT_SIZE || maxPlayers > 48) {
      throw new Error('maxPlayers must be an integer between 4 and 48');
    }
    if (!Array.isArray(questionBank) && (!questionBank || typeof questionBank !== 'object')) {
      throw new Error('question bank must be an array or difficulty-keyed object');
    }
    if (!Array.isArray(TREND_CARDS) || TREND_CARDS.length < 2) throw new Error('trend card bank is incomplete');
    Object.assign(this, {
      now,
      roundMs,
      timing,
      maxPlayers,
      sessionTtlMs,
      seedSecret,
      questionBank,
      questionBankVersion,
    });
    this.players = new Map();
    this.devices = new Map();
    this.matches = new Map();
    this.nextMatchIndex = 1;
    this.stats = {
      heats: 0,
      humanFinishes: 0,
      humanRetirements: 0,
      aiRetirements: 0,
      aiFilledSeats: 0,
      perfectLaps: 0,
      totalCorrect: 0,
      totalAnswers: 0,
    };
  }

  fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }

  currentClock() {
    const active = [...this.matches.values()]
      .filter(({ status }) => status !== 'COMPLETE')
      .sort((left, right) => left.index - right.index)[0] ?? null;
    return {
      roundId: active?.id ?? null,
      matchId: active?.id ?? null,
      phase: active?.status ?? 'IDLE',
    };
  }

  makeCallsign() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const value = `${ADJECTIVES[randomInt(ADJECTIVES.length)]}-${ANIMALS[randomInt(ANIMALS.length)]}-${randomInt(10, 100)}`;
      if (![...this.players.values()].some((player) => player.callsign === value)) return value;
    }
    return `RACER-${randomBytes(3).toString('hex').toUpperCase()}`;
  }

  createMatch(difficulty = 'BEGINNER', securityCircuitId = 'FULL_STACK') {
    validateDifficulty(difficulty);
    validateSecurityCircuit(securityCircuitId);
    const index = this.nextMatchIndex;
    this.nextMatchIndex += 1;
    const circuit = CIRCUITS[(index - 1) % CIRCUITS.length];
    const createdAt = this.now();
    const matchId = `heat_${String(index).padStart(4, '0')}`;
    const trendCards = [...TREND_CARDS]
      .map((card) => ({ card, rank: hmacHex(this.seedSecret, `trend:${matchId}`, card.id) }))
      .sort((left, right) => left.rank.localeCompare(right.rank))
      .slice(0, 2)
      .map(({ card }) => card);
    const totalEncounters = encounterCountForMatch({
      matchId,
      circuitId: circuit.id,
      minEncounters: this.timing.minEncounters,
      maxEncounters: this.timing.maxEncounters,
      version: this.questionBankVersion,
      secret: this.seedSecret,
    });
    const deck = Object.freeze(buildRaceDeck(this.questionBank, {
      matchId,
      circuitId: circuit.id,
      difficulty,
      securityCircuitId,
      encounterCount: totalEncounters,
      version: this.questionBankVersion,
      secret: this.seedSecret,
    }));
    const decks = Object.freeze({ [`${securityCircuitId}:${difficulty}`]: deck });
    const match = {
      id: matchId,
      index,
      circuit,
      difficulty,
      securityCircuitId,
      createdAt,
      minStartAt: createdAt + this.timing.minWaitMs,
      maxStartAt: createdAt + this.timing.maxWaitMs,
      filledAt: null,
      status: 'MATCHING',
      statusStartedAt: createdAt,
      phaseEndsAt: createdAt + this.timing.maxWaitMs,
      humanTokens: [],
      racers: [],
      totalEncounters,
      decks,
      // Internal compatibility alias; player-facing logic always selects the difficulty deck.
      deck,
      trendCards,
      actions: new Map(),
      actionIds: new Map(),
      encounterIndex: -1,
      encounterStartedAt: null,
      encounterEndsAt: null,
      resultEndsAt: null,
      completedAt: null,
      finalized: false,
    };
    this.matches.set(match.id, match);
    return match;
  }

  matchForPlayer(player) {
    const match = this.matches.get(player.matchId);
    if (!match) this.fail('unauthorized');
    return match;
  }

  playersIn(match) {
    return match.humanTokens.map((playerToken) => this.players.get(playerToken)).filter(Boolean);
  }

  deckFor(match, difficulty, securityCircuitId = 'FULL_STACK') {
    return match.decks[`${securityCircuitId}:${difficulty}`]
      ?? match.deck;
  }

  scoreContextForRacer(racer) {
    if (racer.isAi) {
      return {
        difficulty: racer.difficulty,
        crewPerformance: getCrew(racer.crewId).performanceRating,
        driverSkill: getDriver(racer.driverId).skillRating,
        aiOrdinal: racer.aiOrdinal,
      };
    }
    return {
      difficulty: racer.difficulty,
      crewPerformance: getCrew(racer.crewId).performanceRating,
      driverSkill: getDriver(racer.driverId).skillRating,
    };
  }

  scoreForPlayer(match, player) {
    const deck = this.deckFor(match, player.difficulty, player.securityCircuitId);
    return raceScore(
      deck,
      match.actions,
      player.id,
      this.scoreContextForRacer(this.humanRacer(player, 0)),
    );
  }

  activeHumanCount() {
    return [...this.matches.values()]
      .filter(({ status }) => status !== 'COMPLETE')
      .reduce((total, match) => total + match.humanTokens.length, 0);
  }

  openMatch(difficulty, securityCircuitId) {
    return [...this.matches.values()]
      .filter((match) => match.status === 'MATCHING'
        && match.humanTokens.length < HEAT_SIZE
        && match.difficulty === difficulty
        && match.securityCircuitId === securityCircuitId)
      .sort((left, right) => left.index - right.index)[0] ?? null;
  }

  renewPlayer(player) {
    const at = this.now();
    player.lastSeen = at;
    player.expiresAt = Math.min(at + this.sessionTtlMs, player.hardExpiresAt);
  }

  identity(player) {
    const match = this.matchForPlayer(player);
    return {
      token: player.token,
      matchId: match.id,
      roundId: match.id,
      callsign: player.callsign,
      circuitId: match.circuit.id,
      difficulty: player.difficulty,
      securityCircuitId: player.securityCircuitId,
      crewId: player.crewId,
      driverId: player.driverId,
    };
  }

  join(
    existingToken = null,
    requestedDeviceId = null,
    difficulty = null,
    crewId = null,
    driverId = null,
    securityCircuitId = null,
  ) {
    this.advanceAll();
    this.cleanup();
    const at = this.now();
    const existing = existingToken ? this.players.get(existingToken) : null;
    if (existing && existing.hardExpiresAt > at && this.matchForPlayer(existing).status !== 'COMPLETE') {
      this.renewPlayer(existing);
      return this.identity(existing);
    }

    const deviceId = requestedDeviceId ?? randomId('device');
    const remembered = this.players.get(this.devices.get(deviceId));
    if (remembered && remembered.hardExpiresAt > at && this.matchForPlayer(remembered).status !== 'COMPLETE') {
      this.renewPlayer(remembered);
      return this.identity(remembered);
    }

    const selectedDifficulty = validateDifficulty(difficulty);
    const selectedSecurityCircuit = validateSecurityCircuit(securityCircuitId);
    const crew = getCrew(crewId);
    const driver = getDriver(driverId);
    if (driver.crewId !== crew.id) this.fail('invalid_driver');
    if (this.activeHumanCount() >= this.maxPlayers) this.fail('capacity');

    const match = this.openMatch(selectedDifficulty, selectedSecurityCircuit)
      ?? this.createMatch(selectedDifficulty, selectedSecurityCircuit);
    const playerToken = token();
    const retentionMs = Math.max(this.sessionTtlMs, this.roundMs * 3);
    const hardExpiresAt = match.createdAt + maximumHeatRuntime(this.timing) + retentionMs;
    const player = {
      id: randomId('p'),
      token: playerToken,
      callsign: this.makeCallsign(),
      matchId: match.id,
      difficulty: selectedDifficulty,
      securityCircuitId: selectedSecurityCircuit,
      crewId: crew.id,
      driverId: driver.id,
      deviceId,
      createdAt: at,
      lastSeen: at,
      expiresAt: Math.min(at + this.sessionTtlMs, hardExpiresAt),
      hardExpiresAt,
    };
    this.players.set(playerToken, player);
    this.devices.set(deviceId, playerToken);
    match.humanTokens.push(playerToken);
    if (match.humanTokens.length === HEAT_SIZE) {
      match.filledAt = at;
      if (at >= match.minStartAt) this.enterGrid(match, at);
    }
    return this.identity(player);
  }

  startWithAi(playerToken) {
    this.advanceAll();
    this.cleanup();
    const player = this.requirePlayer(playerToken);
    const match = this.matchForPlayer(player);
    if (match.status !== 'MATCHING'
      || match.humanTokens.length < 1
      || match.humanTokens.length >= HEAT_SIZE) {
      this.fail('solo_start_unavailable');
    }
    this.enterGrid(match, this.now());
    return {
      ok: true,
      match: this.publicMatchState(match),
    };
  }

  requirePlayer(playerToken) {
    const player = this.players.get(playerToken);
    if (!player || player.expiresAt <= this.now() || player.hardExpiresAt <= this.now()) this.fail('unauthorized');
    this.renewPlayer(player);
    return player;
  }

  humanRacer(player, seat) {
    return {
      id: player.id,
      playerId: player.id,
      callsign: player.callsign,
      isAi: false,
      difficulty: player.difficulty,
      securityCircuitId: player.securityCircuitId,
      crewId: player.crewId,
      driverId: player.driverId,
      seat,
      aiResults: null,
      aiSkill: null,
    };
  }

  aiRacer(match, seat, usedDriverIds) {
    const rankedDrivers = DRIVERS
      .filter(({ id }) => !usedDriverIds.has(id))
      .map((driver) => ({
        driver,
        rank: hmacHex(this.seedSecret, `ai-driver:${match.id}:${seat}`, driver.id),
      }))
      .sort((left, right) => left.rank.localeCompare(right.rank));
    const driver = rankedDrivers[0]?.driver ?? DRIVERS[seat % DRIVERS.length];
    usedDriverIds.add(driver.id);
    const aiOrdinal = seat - match.humanTokens.length;
    const skill = 0.58 + deterministicUnit(this.seedSecret, 'ai-skill', `${match.id}:${seat}`) * 0.24;
    const aiDeck = this.deckFor(match, match.difficulty, match.securityCircuitId);
    return {
      id: `ai_${String(match.index).padStart(4, '0')}_${seat + 1}`,
      playerId: null,
      callsign: `${AI_NAMES[aiOrdinal % AI_NAMES.length]}-${String(match.index).padStart(2, '0')}`,
      isAi: true,
      difficulty: match.difficulty,
      securityCircuitId: match.securityCircuitId,
      crewId: driver.crewId,
      driverId: driver.id,
      seat,
      aiSkill: Math.round(skill * 100) / 100,
      aiOrdinal,
      aiResults: aiDeck.map((question, questionIndex) => (
        deterministicUnit(this.seedSecret, 'ai-answer', `${match.id}:${seat}:${question.id}:${questionIndex}`) < skill
      )),
    };
  }

  enterGrid(match, startedAt) {
    if (match.status !== 'MATCHING') return;
    const humans = this.playersIn(match).map((player, seat) => this.humanRacer(player, seat));
    const usedDriverIds = new Set(humans.map(({ driverId }) => driverId));
    const racers = [...humans];
    while (racers.length < HEAT_SIZE) racers.push(this.aiRacer(match, racers.length, usedDriverIds));
    match.racers = racers;
    match.status = 'GRID';
    match.statusStartedAt = startedAt;
    match.phaseEndsAt = startedAt + this.timing.gridMs;
    this.stats.aiFilledSeats += racers.filter(({ isAi }) => isAi).length;
  }

  enterRace(match, startedAt) {
    match.status = 'RACING';
    match.statusStartedAt = startedAt;
    match.encounterIndex = 0;
    match.encounterStartedAt = startedAt;
    match.encounterEndsAt = startedAt + this.timing.encounterMs;
    match.phaseEndsAt = match.encounterEndsAt;
  }

  enterResult(match, startedAt) {
    match.status = 'RESULT';
    match.statusStartedAt = startedAt;
    match.encounterIndex = match.totalEncounters;
    match.encounterStartedAt = null;
    match.encounterEndsAt = null;
    match.resultEndsAt = startedAt + this.timing.resultMs;
    match.phaseEndsAt = match.resultEndsAt;
    this.finalize(match);
  }

  completeMatch(match, completedAt) {
    match.status = 'COMPLETE';
    match.statusStartedAt = completedAt;
    match.phaseEndsAt = completedAt;
    match.completedAt = completedAt;
  }

  currentQuestion(match, difficulty = 'BEGINNER', securityCircuitId = 'FULL_STACK') {
    return match.status === 'RACING'
      ? this.deckFor(match, difficulty, securityCircuitId)[match.encounterIndex] ?? null
      : null;
  }

  allHumansAnswered(match) {
    return match.racers
      .filter(({ isAi }) => !isAi)
      .every((racer) => {
        const question = this.currentQuestion(match, racer.difficulty, racer.securityCircuitId);
        return question && match.actions.has(`${racer.playerId}:${question.id}`);
      });
  }

  advanceMatch(match) {
    const at = this.now();
    if (match.status === 'MATCHING') {
      if (match.humanTokens.length === HEAT_SIZE && at >= match.minStartAt) {
        this.enterGrid(match, Math.max(match.minStartAt, match.filledAt ?? match.minStartAt));
        return true;
      }
      if (at >= match.maxStartAt) {
        this.enterGrid(match, match.maxStartAt);
        return true;
      }
      return false;
    }
    if (match.status === 'GRID') {
      if (at < match.phaseEndsAt) return false;
      this.enterRace(match, match.phaseEndsAt);
      return true;
    }
    if (match.status === 'RACING') {
      const exposed = at >= match.encounterStartedAt + this.timing.minimumExposureMs;
      const deadline = at >= match.encounterEndsAt;
      const completedEarly = exposed && this.allHumansAnswered(match);
      if (!deadline && !completedEarly) return false;
      const nextStartedAt = deadline ? match.encounterEndsAt : at;
      if (match.encounterIndex >= match.totalEncounters - 1) {
        this.enterResult(match, nextStartedAt);
      } else {
        match.encounterIndex += 1;
        match.encounterStartedAt = nextStartedAt;
        match.encounterEndsAt = nextStartedAt + this.timing.encounterMs;
        match.phaseEndsAt = match.encounterEndsAt;
      }
      return true;
    }
    if (match.status === 'RESULT') {
      if (at < match.resultEndsAt) return false;
      this.completeMatch(match, match.resultEndsAt);
      return true;
    }
    return false;
  }

  advanceAll() {
    for (const match of this.matches.values()) {
      for (let step = 0; step < 32; step += 1) {
        if (!this.advanceMatch(match)) break;
      }
    }
  }

  async tick() {
    this.advanceAll();
    this.cleanup();
  }

  scoreForRacer(match, racer, completedCount = match.totalEncounters) {
    const deck = this.deckFor(
      match,
      racer.difficulty,
      racer.securityCircuitId,
    );
    const revealed = clamp(completedCount, 0, deck.length);
    if (racer.isAi) {
      const results = deck.map((_, index) => index < revealed && racer.aiResults[index] === true);
      return scoreFromResults(
        deck,
        results,
        revealed,
        revealed,
        this.scoreContextForRacer(racer),
      );
    }
    const results = deck.map((question, index) => {
      if (index >= revealed) return false;
      return match.actions.get(`${racer.playerId}:${question.id}`)?.correct === true;
    });
    const answered = deck.slice(0, revealed)
      .filter((question) => match.actions.has(`${racer.playerId}:${question.id}`)).length;
    return scoreFromResults(
      deck,
      results,
      answered,
      revealed,
      this.scoreContextForRacer(racer),
    );
  }

  provisionalRacers(match) {
    return match.racers.length > 0
      ? match.racers
      : this.playersIn(match).map((player, seat) => this.humanRacer(player, seat));
  }

  raceSnapshot(match) {
    const at = this.now();
    const completedCount = match.status === 'RACING'
      ? match.encounterIndex
      : ['RESULT', 'COMPLETE'].includes(match.status) ? match.totalEncounters : 0;
    const fraction = match.status === 'RACING'
      ? clamp((at - match.encounterStartedAt) / this.timing.encounterMs, 0, 1)
      : 0;
    const baseProgress = match.status === 'RACING'
      ? ((match.encounterIndex + fraction) / match.totalEncounters) * 0.94
      : ['RESULT', 'COMPLETE'].includes(match.status) ? 1 : 0;
    const finished = ['RESULT', 'COMPLETE'].includes(match.status);
    const modeled = this.provisionalRacers(match).map((racer) => {
      const score = this.scoreForRacer(match, racer, completedCount);
      const ratingPace = completedCount === 0
        ? 0
        : racer.isAi
          ? 0.0008
          : ((getCrew(racer.crewId).performanceRating - 84)
            + (getDriver(racer.driverId).skillRating - 84)) * 0.0001;
      // Live telemetry uses only public, unweighted outcomes. Server-only tier weights
      // are reserved for RESULT ranking so progress/gaps cannot become a weight oracle.
      const observedAccuracy = completedCount === 0 ? 0 : score.correct / completedCount;
      const performance = observedAccuracy * 0.042
        + score.streak * 0.0004
        + (score.launchBoost ? 0.003 : 0)
        + (completedCount > 5 && score.pitTimeMs <= 2_100 ? 0.003 : 0)
        + ratingPace;
      const progress = finished ? 1 : clamp(baseProgress + performance, 0, 0.995);
      const retired = finished && score.retired;
      const hardP4 = finished && score.hardP4;
      const rankValue = retired ? -2 : hardP4 ? -1 : finished ? score.rankingScore / 100 : progress;
      return {
        racer, score, progress, rankValue, retired, hardP4,
      };
    }).sort((left, right) => {
      const rankDifference = right.rankValue - left.rankValue;
      if (Math.abs(rankDifference) > Number.EPSILON) return rankDifference;
      // AI-human equality is never a shared rank even if a future score model converges numerically.
      if (left.racer.isAi !== right.racer.isAi) return left.racer.isAi ? 1 : -1;
      return left.racer.seat - right.racer.seat;
    });

    const leader = modeled[0] ?? null;
    let previousEntry = null;
    let previousPosition = null;
    return modeled.map((entry, index) => {
      const {
        racer, score, progress, rankValue, retired, hardP4,
      } = entry;
      const humanTie = previousEntry
        && finished
        && !retired
        && !previousEntry.retired
        && !racer.isAi
        && !previousEntry.racer.isAi
        && score.raceScore === previousEntry.score.raceScore
        && hardP4 === previousEntry.hardP4;
      const position = retired ? null : hardP4 ? 4 : humanTie ? previousPosition : index + 1;
      const gapProgress = leader ? clamp(leader.rankValue - rankValue, 0, 1) : 0;
      const lap = finished ? TOTAL_LAPS : progress >= 0.5 ? 2 : 1;
      const trackProgress = finished ? 1 : (progress * TOTAL_LAPS) % 1;
      const zoneIndex = Math.min(
        match.circuit.speedZones.length - 1,
        Math.floor(trackProgress * match.circuit.speedZones.length),
      );
      const baseSpeed = match.circuit.speedZones[zoneIndex] ?? match.circuit.speedRangeKph.min;
      const batteryPercent = clamp(
        Math.round(score.batteryPercent - progress * 14 + score.correct * 2),
        0,
        100,
      );
      const boostMode = match.status === 'RACING' && score.boostMode && batteryPercent >= 25;
      const oneSecondProgressGap = clamp(
        1_000 / (this.timing.encounterMs * match.totalEncounters),
        0.004,
        0.02,
      );
      const overtakeMode = match.status === 'RACING'
        && position > 1
        && progress >= 0.45
        && gapProgress <= oneSecondProgressGap
        && batteryPercent >= 20;
      const speedKph = match.status === 'RACING'
        ? Math.round(clamp(
          baseSpeed + (boostMode ? 8 : 0) + (overtakeMode ? 7 : 0),
          match.circuit.speedRangeKph.min,
          match.circuit.speedRangeKph.max,
        ))
        : 0;
      const activeAero = match.status === 'RACING'
        && speedKph >= match.circuit.speedRangeKph.min
          + (match.circuit.speedRangeKph.max - match.circuit.speedRangeKph.min) * 0.62;
      // RESULT gaps are presentation-only classification markers. Using the final
      // ranking-score delta here would turn the public distance into a score oracle.
      const gapMeters = finished
        ? (Number.isInteger(position) ? Math.max(0, position - 1) * 125 : 0)
        : index === 0 ? 0 : Math.round(
          gapProgress * match.circuit.officialLengthKm * 1_000 * TOTAL_LAPS,
        );
      const crew = getCrew(racer.crewId);
      const driver = getDriver(racer.driverId);
      const publicRacer = {
        id: racer.id,
        callsign: racer.callsign,
        isAi: racer.isAi,
        difficulty: racer.difficulty,
        securityCircuitId: racer.securityCircuitId,
        crewId: racer.crewId,
        crewName: crew.name,
        performanceRating: crew.performanceRating,
        driverId: racer.driverId,
        driverName: driver.name,
        skillRating: driver.skillRating,
        position,
        retired,
        classificationStatus: retired ? 'RETIRED' : finished ? 'CLASSIFIED' : 'RUNNING',
        lap,
        totalLaps: TOTAL_LAPS,
        progress: Math.round(progress * 10_000) / 10_000,
        trackProgress: Math.round(trackProgress * 10_000) / 10_000,
        speedKph,
        gapMeters,
        batteryPercent,
        boostMode,
        overtakeMode,
        activeAero,
        pitTimeMs: completedCount > 5 ? score.pitTimeMs : null,
        pit: {
          completed: completedCount > 5,
          timeMs: completedCount > 5 ? score.pitTimeMs : null,
        },
        finished,
        score: {
          answered: score.answered,
          correct: score.correct,
          possible: score.possible,
          accuracy: score.accuracy,
          streak: score.streak,
        },
      };
      previousEntry = entry;
      previousPosition = position;
      return publicRacer;
    });
  }

  trendFor(match) {
    if (['RESULT', 'COMPLETE'].includes(match.status)) return publicTrend(match.trendCards[1]);
    if (match.status === 'RACING' && match.encounterIndex >= 5) return publicTrend(match.trendCards[0]);
    return null;
  }

  publicMatchState(match) {
    const at = this.now();
    const humanCount = match.humanTokens.length;
    const aiCount = match.racers.filter(({ isAi }) => isAi).length;
    const startsInMs = match.status === 'MATCHING'
      ? Math.max(0, (humanCount === HEAT_SIZE ? match.minStartAt : match.maxStartAt) - at)
      : match.status === 'GRID' ? Math.max(0, match.phaseEndsAt - at) : 0;
    return {
      id: match.id,
      matchId: match.id,
      status: match.status,
      difficulty: match.difficulty,
      securityCircuitId: match.securityCircuitId,
      humanCount,
      aiCount,
      seats: HEAT_SIZE,
      minWaitRemainingMs: match.status === 'MATCHING' ? Math.max(0, match.minStartAt - at) : 0,
      maxWaitRemainingMs: match.status === 'MATCHING' ? Math.max(0, match.maxStartAt - at) : 0,
      startsInMs,
      encounterIndex: match.status === 'RACING'
        ? match.encounterIndex
        : ['MATCHING', 'GRID'].includes(match.status) ? -1 : match.totalEncounters,
      encounterNumber: match.status === 'RACING' ? match.encounterIndex + 1 : 0,
      totalEncounters: match.totalEncounters,
      encounterRemainingMs: match.status === 'RACING' ? Math.max(0, match.encounterEndsAt - at) : 0,
      minimumExposureMs: this.timing.minimumExposureMs,
      circuit: match.circuit,
    };
  }

  roundAlias(match) {
    const state = this.publicMatchState(match);
    const remainingMs = state.status === 'MATCHING'
      ? state.maxWaitRemainingMs
      : state.status === 'GRID' ? state.startsInMs
        : state.status === 'RACING' ? state.encounterRemainingMs
          : state.status === 'RESULT' ? Math.max(0, match.resultEndsAt - this.now()) : 0;
    const raceProgress = state.status === 'RACING'
      ? (match.encounterIndex + clamp((this.now() - match.encounterStartedAt) / this.timing.encounterMs, 0, 1)) / match.totalEncounters
      : ['RESULT', 'COMPLETE'].includes(state.status) ? 1 : 0;
    return {
      roundId: match.id,
      matchId: match.id,
      phase: match.status,
      phaseRemainingMs: remainingMs,
      remainingMs,
      progress: Math.round(raceProgress * 10_000) / 10_000,
      counts: { total: HEAT_SIZE, human: state.humanCount, ai: state.aiCount },
      maxPlayers: HEAT_SIZE,
    };
  }

  observationsFor(match, player) {
    return this.deckFor(match, player.difficulty, player.securityCircuitId).flatMap((question) => {
      const action = match.actions.get(`${player.id}:${question.id}`);
      if (!action) return [];
      const selected = (question.options ?? []).find((option) => optionId(option) === action.choice);
      return [{
        taskId: question.id,
        phase: question.racePhase,
        choice: action.choice,
        label: selected ? optionLabel(selected) : action.choice,
        correct: action.correct,
        explanation: explanationFor(question, action.choice),
      }];
    });
  }

  state(playerToken) {
    this.advanceAll();
    this.cleanup();
    const player = this.requirePlayer(playerToken);
    const match = this.matchForPlayer(player);
    const currentQuestion = this.currentQuestion(match, player.difficulty, player.securityCircuitId);
    const currentAction = currentQuestion
      ? match.actions.get(`${player.id}:${currentQuestion.id}`) ?? null
      : null;
    const tasks = currentQuestion ? [publicQuestion(currentQuestion, player.difficulty, currentAction)] : [];
    const racers = this.raceSnapshot(match).map((racer) => ({
      ...racer,
      isPlayer: racer.id === player.id,
    }));
    const playerRace = racers.find(({ id }) => id === player.id) ?? null;
    const score = this.scoreForPlayer(match, player);
    const matchState = this.publicMatchState(match);
    return {
      circuit: match.circuit,
      player: {
        id: player.id,
        racerId: player.id,
        callsign: player.callsign,
        difficulty: player.difficulty,
        securityCircuitId: player.securityCircuitId,
        crewId: player.crewId,
        driverId: player.driverId,
        crew: getCrew(player.crewId),
        driver: getDriver(player.driverId),
      },
      match: matchState,
      round: this.roundAlias(match),
      tasks,
      observations: this.observationsFor(match, player),
      trend: this.trendFor(match),
      race: {
        ...(playerRace ?? {
          id: player.id,
          callsign: player.callsign,
          isAi: false,
          securityCircuitId: player.securityCircuitId,
          position: 1,
          retired: false,
          classificationStatus: 'RUNNING',
          lap: 1,
          totalLaps: TOTAL_LAPS,
          progress: 0,
          trackProgress: 0,
          speedKph: 0,
          gapMeters: 0,
          batteryPercent: score.batteryPercent,
          boostMode: false,
          overtakeMode: false,
          activeAero: false,
          pitTimeMs: score.pitTimeMs,
          pit: { completed: false, timeMs: null },
          finished: false,
        }),
        answered: score.answered,
        correct: score.correct,
        possible: score.possible,
        accuracy: score.accuracy,
        streak: score.streak,
        racers,
      },
      result: ['RESULT', 'COMPLETE'].includes(match.status) ? this.publicResult(match, player, racers) : null,
    };
  }

  submit(playerToken, payload = {}) {
    this.advanceAll();
    this.cleanup();
    const player = this.requirePlayer(playerToken);
    const match = this.matchForPlayer(player);
    const requestedMatchId = safeText(payload.matchId) || safeText(payload.roundId);
    const task = safeText(payload.task);
    const choice = safeText(payload.choice);
    const actionId = safeText(payload.actionId);
    if (requestedMatchId !== match.id) this.fail('wrong_match');
    if (!SAFE_ACTION_ID.test(actionId)) this.fail('invalid_action_id');
    if (!SAFE_VALUE.test(task) || !SAFE_VALUE.test(choice)) this.fail('invalid_choice');

    const idempotencyKey = `${player.id}:${actionId}`;
    const replay = match.actionIds.get(idempotencyKey);
    if (replay) {
      if (replay.task !== task || replay.choice !== choice) this.fail('idempotency_conflict');
      return { ...replay.response, duplicate: true };
    }

    const question = this.currentQuestion(match, player.difficulty, player.securityCircuitId);
    if (!question || question.id !== task) this.fail('phase_closed');
    if (!(question.options ?? []).some((option) => optionId(option) === choice)) this.fail('invalid_choice');
    const actionKey = `${player.id}:${task}`;
    if (match.actions.has(actionKey)) this.fail('choice_locked');
    const correct = answerIsCorrect(question, choice);
    const action = { playerId: player.id, task, choice, correct, at: this.now() };
    match.actions.set(actionKey, action);
    const score = this.scoreForPlayer(match, player);
    const response = {
      ok: true,
      selected: choice,
      feedback: {
        correct,
        explanation: explanationFor(question, choice),
        correctOptionId: expectedChoice(question),
        effect: raceEffect(question, correct, score),
      },
      race: publicLiveScore(score),
    };
    match.actionIds.set(idempotencyKey, { task, choice, response });
    return response;
  }

  publicResult(match, player, racers = this.raceSnapshot(match)) {
    const deck = this.deckFor(match, player.difficulty, player.securityCircuitId);
    const score = this.scoreForPlayer(match, player);
    const playerRace = racers.find(({ id }) => id === player.id);
    const position = playerRace ? playerRace.position : score.retired ? null : HEAT_SIZE;
    const outcome = finishBand(score, position);
    return {
      outcome,
      finishBand: outcome,
      position,
      securityCircuitId: player.securityCircuitId,
      retired: outcome === 'RETIRED',
      classificationStatus: outcome === 'RETIRED' ? 'RETIRED' : 'CLASSIFIED',
      circuit: match.circuit,
      classification: racers,
      answered: score.answered,
      possible: score.possible,
      correct: score.correct,
      accuracy: score.accuracy,
      streak: score.streak,
      batteryPercent: playerRace?.batteryPercent ?? score.batteryPercent,
      boostMode: playerRace?.boostMode ?? false,
      overtakeMode: playerRace?.overtakeMode ?? false,
      activeAero: playerRace?.activeAero ?? false,
      pitTimeMs: score.pitTimeMs,
      review: deck.map((question) => {
        const action = match.actions.get(`${player.id}:${question.id}`) ?? null;
        const selected = (question.options ?? []).find((option) => optionId(option) === action?.choice);
        const correct = (question.options ?? []).find((option) => optionId(option) === expectedChoice(question));
        return {
          id: question.id,
          taskId: question.id,
          category: question.category ?? 'general',
          securityCircuitId: question.securityCircuitId,
          securityLane: question.securityLane,
          question: questionPrompt(question),
          selected: action?.choice ?? null,
          selectedLabel: selected ? optionLabel(selected) : null,
          correct: action?.correct ?? false,
          correctOptionId: expectedChoice(question),
          correctOptionLabel: correct ? optionLabel(correct) : null,
          explanation: explanationFor(question, action?.choice),
        };
      }),
    };
  }

  finalize(match) {
    if (match.finalized) return;
    this.stats.heats += 1;
    for (const racer of match.racers) {
      const score = this.scoreForRacer(match, racer);
      if (racer.isAi) {
        if (score.retired) this.stats.aiRetirements += 1;
        continue;
      }
      const player = this.playersIn(match).find(({ id }) => id === racer.playerId);
      if (!player) continue;
      this.stats.humanFinishes += 1;
      if (score.retired) this.stats.humanRetirements += 1;
      this.stats.totalCorrect += score.correct;
      this.stats.totalAnswers += score.answered;
      if (score.correct === score.possible) this.stats.perfectLaps += 1;
    }
    match.finalized = true;
  }

  difficultyCounts(match) {
    const counts = Object.fromEntries(DIFFICULTIES.map((difficulty) => [difficulty, 0]));
    for (const player of this.playersIn(match)) counts[player.difficulty] += 1;
    return counts;
  }

  securityCircuitCounts(match) {
    const counts = Object.fromEntries(SECURITY_CIRCUITS.map(({ id }) => [id, 0]));
    for (const player of this.playersIn(match)) counts[player.securityCircuitId] += 1;
    return counts;
  }

  heatSummary(match) {
    const state = this.publicMatchState(match);
    const standings = this.raceSnapshot(match);
    return {
      ...state,
      difficultyCounts: this.difficultyCounts(match),
      securityCircuitCounts: this.securityCircuitCounts(match),
      standings,
      racers: standings,
      trend: this.trendFor(match),
    };
  }

  screenState() {
    this.advanceAll();
    this.cleanup();
    const ordered = [...this.matches.values()].sort((left, right) => left.index - right.index);
    const pending = ordered.filter(({ status }) => status === 'MATCHING').map((match) => this.heatSummary(match));
    const active = ordered
      .filter(({ status }) => ['GRID', 'RACING', 'RESULT'].includes(status))
      .map((match) => this.heatSummary(match));
    const recent = ordered
      .filter(({ status }) => status === 'COMPLETE')
      .sort((left, right) => (right.completedAt ?? 0) - (left.completedAt ?? 0))
      .slice(0, 6)
      .map((match) => this.heatSummary(match));
    return {
      pending,
      active,
      recent,
      joinMode: this.activeHumanCount() < this.maxPlayers ? 'OPEN' : 'FULL',
      stats: {
        ...this.stats,
        activeHumans: this.activeHumanCount(),
        pendingHeats: pending.length,
        activeHeats: active.length,
        polePositions: this.stats.perfectLaps,
      },
      catalogs: publicRaceCatalog(this.timing),
    };
  }

  cleanup() {
    const at = this.now();
    const retentionMs = Math.max(this.sessionTtlMs, this.roundMs * 3);
    for (const [matchId, match] of this.matches) {
      if (match.status === 'COMPLETE' && match.completedAt + retentionMs <= at) {
        this.matches.delete(matchId);
      }
    }
    for (const [playerToken, player] of this.players) {
      if (player.hardExpiresAt <= at || !this.matches.has(player.matchId)) {
        this.players.delete(playerToken);
        if (this.devices.get(player.deviceId) === playerToken) this.devices.delete(player.deviceId);
      }
    }
  }
}

export { MATCH_STATUSES };
