import { createHmac, randomBytes, randomInt } from 'node:crypto';
import { clockAt, clockForOrdinal, phaseBounds, PRODUCTION_ROUND_MS } from './clock.mjs';
import { QUESTION_BANK, QUESTION_BANK_VERSION } from './content/questions.mjs';
import { TREND_CARDS } from './content/trends.mjs';
import {
  CREWS, DIFFICULTIES, DRIVERS, TRACKS,
  getCrew, getDriver, getTrack, validateDifficulty,
} from './race/catalog.mjs';
import { buildRaceDeck } from './race/seed.mjs';
import { answerIsCorrect, finishBand, raceScore } from './race/scoring.mjs';

const ACTIVE_PHASES = ['LAUNCH', 'SECTOR_1', 'PIT_STOP', 'SECTOR_2', 'SPRINT', 'RESULT'];
const TASK_PHASES = new Set(['LAUNCH', 'SECTOR_1', 'PIT_STOP', 'SECTOR_2', 'SPRINT']);
const ADJECTIVES = ['NEON', 'SWIFT', 'QUIET', 'BRAVE', 'LUCID', 'NOVA', 'PIXEL', 'SOLAR'];
const ANIMALS = ['OWL', 'FOX', 'OTTER', 'RAVEN', 'TIGER', 'GECKO', 'MANTA', 'LYNX'];

function token() { return randomBytes(24).toString('base64url'); }
function id(prefix) { return `${prefix}_${randomBytes(8).toString('hex')}`; }
function roundKey(ordinal, trackId) { return `${ordinal}:${trackId}`; }
function publicRoundId(ordinal, trackId) { return `r${ordinal}-${trackId}`; }
function safeText(value) { return typeof value === 'string' ? value : ''; }

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
  if (raw && typeof raw === 'object') return Object.entries(raw).map(([label, value]) => ({ type: 'note', label, value }));
  return [];
}

function explanationFor(question, choice = null) {
  const selectedOption = (question.options ?? []).find((option) => optionId(option) === choice);
  return safeText(selectedOption?.feedback ?? question.explanation ?? question.takeaway ?? question.rationale ?? question.feedback);
}

function publicQuestion(question, difficulty, action = null) {
  const feedback = action ? {
    correct: action.correct,
    explanation: explanationFor(question, action.choice),
    correctOptionId: expectedChoice(question),
  } : null;
  return {
    id: question.id,
    category: question.category ?? 'general',
    question: questionPrompt(question),
    evidence: evidenceFor(question, difficulty),
    options: (question.options ?? []).map((option) => ({
      id: optionId(option),
      label: optionLabel(option),
      technical: typeof option === 'object' ? safeText(option.technical ?? option.detail ?? option.description) : '',
    })),
    racePhase: question.racePhase,
    gridPosition: question.gridPosition,
    selected: action?.choice ?? null,
    feedback,
  };
}

function trendRank(secret, namespace, cardId) {
  return createHmac('sha256', secret).update(`${namespace}\u0000${cardId}`).digest('hex');
}

function selectTrendCards(secret, ordinal, trackId) {
  return [...TREND_CARDS]
    .map((card) => ({ card, rank: trendRank(secret, `${ordinal}:${trackId}`, card.id) }))
    .sort((left, right) => left.rank.localeCompare(right.rank))
    .slice(0, 2)
    .map(({ card }) => card);
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

function raceEffect(phase, correct, score) {
  if (!correct) return '보너스가 적용되지 않았습니다. 근거를 복기하고 다음 구간을 준비하세요.';
  if (phase === 'LAUNCH') return 'LAUNCH BOOST 활성화';
  if (phase === 'SECTOR_1') return `NITRO ${score.nitro}/3 충전`;
  if (phase === 'PIT_STOP') return `FAST PIT ${(score.pitTimeMs / 1_000).toFixed(1)}초`;
  if (phase === 'SECTOR_2') return score.aeroActive ? 'AERO BOOST 활성화' : 'AERO 검증 1/2 통과';
  if (phase === 'SPRINT') return score.nitroDeploy ? 'NITRO DEPLOY 활성화' : '스프린트 판단 통과';
  return '보안 판단 보너스 적용';
}

export class GameStore {
  constructor({
    now = () => Date.now(), roundMs = PRODUCTION_ROUND_MS, epochMs = 0, maxPlayers = 48,
    sessionTtlMs = 15 * 60_000, seedSecret = randomBytes(32).toString('hex'),
    questionBank = QUESTION_BANK, questionBankVersion = QUESTION_BANK_VERSION ?? '1',
  } = {}) {
    if (!Array.isArray(questionBank) || questionBank.length < 7) throw new Error('question bank is incomplete');
    if (!Array.isArray(TREND_CARDS) || TREND_CARDS.length < 2) throw new Error('trend card bank is incomplete');
    Object.assign(this, {
      now, roundMs, epochMs, maxPlayers, sessionTtlMs, seedSecret,
      questionBank, questionBankVersion,
    });
    this.players = new Map();
    this.devices = new Map();
    this.rounds = new Map();
    this.stats = { races: 0, finishes: 0, perfectLaps: 0, totalCorrect: 0, totalAnswers: 0 };
  }

  currentClock() { return clockAt(this.now(), { roundMs: this.roundMs, epochMs: this.epochMs }); }
  phaseSpec(phase) { return phaseBounds(this.roundMs).find((value) => value.id === phase); }
  joinCutoffMs() { return this.phaseSpec('JOIN').endMs; }
  minimumExposureMs() { return Math.max(50, Math.round((3_000 / PRODUCTION_ROUND_MS) * this.roundMs)); }

  renewPlayer(player) {
    const now = this.now();
    player.lastSeen = now;
    player.expiresAt = Math.min(now + this.sessionTtlMs, player.hardExpiresAt ?? Number.POSITIVE_INFINITY);
  }

  getRound(ordinal, trackId) {
    const track = getTrack(trackId);
    const key = roundKey(ordinal, track.id);
    if (!this.rounds.has(key)) {
      const startedAt = this.epochMs + ordinal * this.roundMs;
      this.rounds.set(key, {
        key,
        id: publicRoundId(ordinal, track.id),
        ordinal,
        trackId: track.id,
        track,
        deck: buildRaceDeck(
          this.questionBank.filter((question) => !Array.isArray(question.tracks) || question.tracks.includes(track.id)),
          {
          ordinal,
          trackId: track.id,
          version: this.questionBankVersion,
          secret: this.seedSecret,
          },
        ),
        trendCards: selectTrendCards(this.seedSecret, ordinal, track.id),
        players: new Set(),
        actions: new Map(),
        actionIds: new Map(),
        phase: 'JOIN',
        phaseStartedAt: startedAt,
        phaseEndsAt: startedAt + this.joinCutoffMs(),
        finalized: false,
      });
    }
    return this.rounds.get(key);
  }

  roundsForOrdinal(ordinal) { return TRACKS.map(({ id: trackId }) => this.getRound(ordinal, trackId)); }

  playersIn(round) {
    return [...round.players].map((playerToken) => this.players.get(playerToken)).filter(Boolean);
  }

  ordinalPlayerCount(ordinal) {
    return this.roundsForOrdinal(ordinal).reduce((count, round) => count + round.players.size, 0);
  }

  makeCallsign() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const value = `${ADJECTIVES[randomInt(ADJECTIVES.length)]}-${ANIMALS[randomInt(ANIMALS.length)]}-${randomInt(10, 100)}`;
      if (![...this.players.values()].some((player) => player.callsign === value)) return value;
    }
    return `RACER-${randomBytes(3).toString('hex').toUpperCase()}`;
  }

  join(existingToken = null, requestedDeviceId = null, trackId = null, difficulty = null, crewId = null, driverId = null) {
    this.cleanup();
    if (existingToken && this.players.has(existingToken)) {
      const existing = this.players.get(existingToken);
      this.renewPlayer(existing);
      return this.identity(existing);
    }

    const deviceId = requestedDeviceId ?? id('device');
    const deviceToken = this.devices.get(deviceId);
    if (deviceToken && this.players.has(deviceToken)) {
      const existing = this.players.get(deviceToken);
      const clock = clockForOrdinal(existing.roundOrdinal, this.now(), {
        roundMs: this.roundMs, epochMs: this.epochMs,
      });
      if (clock.phase !== 'COMPLETE') {
        this.renewPlayer(existing);
        return this.identity(existing);
      }
    }

    const track = getTrack(trackId);
    const selectedDifficulty = validateDifficulty(difficulty);
    const crew = getCrew(crewId);
    const driver = getDriver(driverId);
    if (driver.crewId !== crew.id) this.fail('invalid_driver');
    const current = this.currentClock();
    let ordinal = current.elapsedMs < this.joinCutoffMs() ? current.ordinal : current.ordinal + 1;
    if (this.ordinalPlayerCount(ordinal) >= this.maxPlayers) ordinal = current.ordinal + 1;
    if (this.ordinalPlayerCount(ordinal) >= this.maxPlayers) this.fail('capacity');

    const round = this.getRound(ordinal, track.id);
    const playerToken = token();
    const createdAt = this.now();
    const roundEndsAt = this.epochMs + (ordinal + 1) * this.roundMs;
    const hardExpiresAt = roundEndsAt + Math.min(this.sessionTtlMs, this.roundMs * 3);
    const player = {
      id: id('p'),
      token: playerToken,
      callsign: this.makeCallsign(),
      roundOrdinal: ordinal,
      trackId: track.id,
      difficulty: selectedDifficulty,
      crewId: crew.id,
      driverId: driver.id,
      deviceId,
      createdAt,
      lastSeen: createdAt,
      expiresAt: Math.min(createdAt + this.sessionTtlMs, hardExpiresAt),
      hardExpiresAt,
    };
    this.players.set(playerToken, player);
    this.devices.set(deviceId, playerToken);
    round.players.add(playerToken);
    return this.identity(player);
  }

  identity(player) {
    const round = this.getRound(player.roundOrdinal, player.trackId);
    return {
      token: player.token,
      roundId: round.id,
      callsign: player.callsign,
      trackId: player.trackId,
      difficulty: player.difficulty,
      crewId: player.crewId,
      driverId: player.driverId,
    };
  }

  requirePlayer(playerToken) {
    const player = this.players.get(playerToken);
    if (!player || player.expiresAt <= this.now()) this.fail('unauthorized');
    this.renewPlayer(player);
    return player;
  }

  questionsForPhase(round, phase) {
    return TASK_PHASES.has(phase) ? round.deck.filter((question) => question.racePhase === phase) : [];
  }

  requiredKeys(round, phase) {
    const questions = this.questionsForPhase(round, phase);
    return this.playersIn(round).flatMap((player) => questions.map((question) => `${player.id}:${question.id}`));
  }

  phaseComplete(round) {
    const keys = this.requiredKeys(round, round.phase);
    return keys.length > 0 && keys.every((key) => round.actions.has(key));
  }

  roundClock(round) {
    const global = clockForOrdinal(round.ordinal, this.now(), { roundMs: this.roundMs, epochMs: this.epochMs });
    if (global.phase === 'QUEUED' || global.phase === 'COMPLETE') return global;
    const phaseIndex = Math.max(0, ACTIVE_PHASES.indexOf(round.phase));
    return {
      ...global,
      roundId: round.id,
      phase: round.phase,
      phaseStartedAt: round.phaseStartedAt,
      phaseEndsAt: round.phaseEndsAt,
      phaseRemainingMs: Math.max(0, round.phaseEndsAt - this.now()),
      progress: round.phase === 'RESULT' ? 1 : Math.max(global.progress, (phaseIndex + 1) / (ACTIVE_PHASES.length + 1)),
      mayAdvanceEarly: TASK_PHASES.has(round.phase),
    };
  }

  trendFor(round, phase) {
    if (phase === 'PIT_STOP') return publicTrend(round.trendCards[0]);
    if (phase === 'RESULT' || phase === 'COMPLETE') return publicTrend(round.trendCards[1]);
    return null;
  }

  state(playerToken) {
    const player = this.requirePlayer(playerToken);
    const round = this.getRound(player.roundOrdinal, player.trackId);
    const clock = this.roundClock(round);
    const tasks = this.questionsForPhase(round, clock.phase).map((question) => {
      const action = round.actions.get(`${player.id}:${question.id}`) ?? null;
      return publicQuestion(question, player.difficulty, action);
    });
    const observations = round.deck
      .map((question) => ({ question, action: round.actions.get(`${player.id}:${question.id}`) ?? null }))
      .filter(({ action }) => action)
      .map(({ question, action }) => ({
        taskId: question.id,
        phase: question.racePhase,
        choice: action.choice,
        label: optionLabel((question.options ?? []).find((option) => optionId(option) === action.choice) ?? action.choice),
        correct: action.correct,
        explanation: explanationFor(question, action.choice),
      }));
    const score = raceScore(round.deck, round.actions, player.id);
    const current = this.currentClock();
    return {
      track: round.track,
      player: {
        callsign: player.callsign,
        trackId: player.trackId,
        difficulty: player.difficulty,
        crewId: player.crewId,
        driverId: player.driverId,
        crew: getCrew(player.crewId),
        driver: getDriver(player.driverId),
      },
      round: {
        ...clock,
        counts: { total: round.players.size },
        maxPlayers: this.maxPlayers,
      },
      tasks,
      observations,
      race: score,
      trend: this.trendFor(round, clock.phase),
      queue: clock.phase === 'QUEUED' ? {
        currentPhase: current.phase,
        currentRemainingMs: current.remainingMs,
        selectedTrack: player.trackId,
        nextCounts: { total: round.players.size },
      } : null,
      result: ['RESULT', 'COMPLETE'].includes(clock.phase) ? this.publicResult(round, player) : null,
    };
  }

  submit(playerToken, { roundId, task, choice, actionId }) {
    const player = this.requirePlayer(playerToken);
    const round = this.getRound(player.roundOrdinal, player.trackId);
    if (roundId !== round.id) this.fail('wrong_round');
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(actionId ?? '')) this.fail('invalid_action_id');
    const idempotencyKey = `${player.id}:${actionId}`;
    const replay = round.actionIds.get(idempotencyKey);
    if (replay) {
      if (replay.task !== task || replay.choice !== choice) this.fail('idempotency_conflict');
      return { ...replay.response, duplicate: true };
    }
    const question = round.deck.find(({ id: questionId }) => questionId === task);
    if (!question || !(question.options ?? []).some((option) => optionId(option) === choice)) this.fail('invalid_choice');
    const clock = this.roundClock(round);
    if (!this.questionsForPhase(round, clock.phase).some(({ id: questionId }) => questionId === task)) this.fail('phase_closed');
    const actionKey = `${player.id}:${task}`;
    if (round.actions.has(actionKey)) this.fail('choice_locked');
    const correct = answerIsCorrect(question, choice);
    const action = { playerId: player.id, task, choice, correct, at: this.now() };
    round.actions.set(actionKey, action);
    const score = raceScore(round.deck, round.actions, player.id);
    const response = {
      ok: true,
      selected: choice,
      feedback: {
        correct,
        explanation: explanationFor(question, choice),
        correctOptionId: expectedChoice(question),
        effect: raceEffect(question.racePhase, correct, score),
      },
      race: score,
    };
    round.actionIds.set(idempotencyKey, { task, choice, response });
    return response;
  }

  publicResult(round, player) {
    const score = raceScore(round.deck, round.actions, player.id);
    return {
      outcome: finishBand(score),
      finishBand: finishBand(score),
      ...score,
      review: round.deck.map((question) => {
        const action = round.actions.get(`${player.id}:${question.id}`) ?? null;
        const selectedOption = (question.options ?? []).find((option) => optionId(option) === action?.choice);
        const correctOption = (question.options ?? []).find((option) => optionId(option) === expectedChoice(question));
        return {
          id: question.id,
          category: question.category ?? 'general',
          question: questionPrompt(question),
          selected: action?.choice ?? null,
          selectedLabel: selectedOption ? optionLabel(selectedOption) : null,
          correct: action?.correct ?? false,
          correctOptionId: expectedChoice(question),
          correctOptionLabel: correctOption ? optionLabel(correctOption) : null,
          explanation: explanationFor(question, action?.choice),
        };
      }),
    };
  }

  fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }

  difficultyCounts(round) {
    const result = Object.fromEntries(DIFFICULTIES.map((difficulty) => [difficulty, 0]));
    for (const player of this.playersIn(round)) result[player.difficulty] += 1;
    return result;
  }

  enterPhase(round, phase, startedAt = this.now()) {
    const spec = this.phaseSpec(phase);
    round.phase = phase;
    round.phaseStartedAt = startedAt;
    round.phaseEndsAt = phase === 'RESULT'
      ? this.epochMs + (round.ordinal + 1) * this.roundMs
      : startedAt + (spec.endMs - spec.startMs);
  }

  finalize(round) {
    if (round.finalized) return;
    this.stats.races += 1;
    for (const player of this.playersIn(round)) {
      const score = raceScore(round.deck, round.actions, player.id);
      this.stats.finishes += 1;
      this.stats.totalCorrect += score.correct;
      this.stats.totalAnswers += score.answered;
      if (score.correct === score.possible) this.stats.perfectLaps += 1;
    }
    round.finalized = true;
  }

  transitionAt(round, completed) { return completed ? this.now() : round.phaseEndsAt; }

  advanceRound(round) {
    const globalStart = this.epochMs + round.ordinal * this.roundMs;
    const joinEndsAt = globalStart + this.joinCutoffMs();
    if (round.phase === 'JOIN') {
      if (this.now() < joinEndsAt || round.players.size === 0) return false;
      this.enterPhase(round, 'LAUNCH', joinEndsAt);
      return true;
    }
    if (round.phase === 'RESULT') return false;
    const exposed = this.now() >= round.phaseStartedAt + this.minimumExposureMs();
    const deadline = this.now() >= round.phaseEndsAt;
    if (TASK_PHASES.has(round.phase) && ((exposed && this.phaseComplete(round)) || deadline)) {
      const next = {
        LAUNCH: 'SECTOR_1',
        SECTOR_1: 'PIT_STOP',
        PIT_STOP: 'SECTOR_2',
        SECTOR_2: 'SPRINT',
        SPRINT: 'RESULT',
      }[round.phase];
      this.enterPhase(round, next, this.transitionAt(round, exposed && this.phaseComplete(round)));
      if (next === 'RESULT') this.finalize(round);
      return true;
    }
    return false;
  }

  async tick() {
    for (const round of this.rounds.values()) {
      const clock = clockForOrdinal(round.ordinal, this.now(), { roundMs: this.roundMs, epochMs: this.epochMs });
      if (clock.phase === 'QUEUED') continue;
      for (let step = 0; step < 10; step += 1) {
        if (!this.advanceRound(round)) break;
      }
    }
    this.cleanup();
  }

  leaderboard(round) {
    return this.playersIn(round)
      .map((player) => ({
        callsign: player.callsign,
        crewId: player.crewId,
        crewName: getCrew(player.crewId).name,
        driverId: player.driverId,
        difficulty: player.difficulty,
        ...raceScore(round.deck, round.actions, player.id),
      }))
      .sort((left, right) => right.correct - left.correct || left.pitTimeMs - right.pitTimeMs || left.callsign.localeCompare(right.callsign));
  }

  screenState() {
    const current = this.currentClock();
    const lanes = TRACKS.map((track) => {
      const round = this.getRound(current.ordinal, track.id);
      const clock = this.roundClock(round);
      const publicClock = round.players.size === 0 && current.elapsedMs >= this.joinCutoffMs()
        ? { ...clock, phase: 'IDLE', phaseRemainingMs: current.remainingMs, mayAdvanceEarly: false }
        : clock;
      return {
        track,
        round: { ...publicClock, counts: { total: round.players.size } },
        difficultyCounts: this.difficultyCounts(round),
        leaderboard: this.leaderboard(round),
        trend: this.trendFor(round, clock.phase),
      };
    });
    const nextTotal = this.ordinalPlayerCount(current.ordinal + 1);
    const currentTotal = this.ordinalPlayerCount(current.ordinal);
    return {
      round: current,
      lanes,
      nextRound: { total: nextTotal, startsInMs: current.remainingMs },
      joinMode: current.elapsedMs < this.joinCutoffMs() && currentTotal < this.maxPlayers
        ? 'CURRENT' : nextTotal < this.maxPlayers ? 'NEXT' : 'FULL',
      stats: {
        ...this.stats,
        activePlayers: currentTotal,
        polePositions: this.stats.perfectLaps,
      },
      catalogs: { crews: CREWS, drivers: DRIVERS },
    };
  }

  cleanup() {
    const now = this.now();
    for (const [playerToken, player] of this.players) {
      if (player.expiresAt <= now) {
        this.players.delete(playerToken);
        if (this.devices.get(player.deviceId) === playerToken) this.devices.delete(player.deviceId);
      }
    }
    const currentOrdinal = this.currentClock().ordinal;
    for (const [key, round] of this.rounds) {
      if (round.ordinal < currentOrdinal - 3 || round.ordinal > currentOrdinal + 1) this.rounds.delete(key);
    }
  }
}
