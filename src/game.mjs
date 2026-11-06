import { randomBytes, randomInt } from 'node:crypto';
import { clockAt, clockForOrdinal, phaseBounds, PRODUCTION_ROUND_MS } from './clock.mjs';
import { getScenario, SCENARIOS, validateDifficulty } from './scenarios/index.mjs';

const RED_ROLES = ['SCOUT', 'BUILDER', 'RUNNER'];
const BLUE_ROLES = ['MONITOR', 'GATEKEEPER', 'PATCHER'];
const ACTIVE_PHASES = ['BRIEF', 'DISCOVER', 'BUILD', 'EXECUTE', 'DUEL', 'REVERIFY', 'RESULT'];
const TASK_PHASES = new Set(['DISCOVER', 'BUILD', 'DUEL']);
const ADJECTIVES = ['NEON', 'SWIFT', 'QUIET', 'BRAVE', 'LUCID', 'NOVA', 'PIXEL', 'SOLAR'];
const ANIMALS = ['OWL', 'FOX', 'OTTER', 'RAVEN', 'TIGER', 'GECKO', 'MANTA', 'LYNX'];

function token() { return randomBytes(24).toString('base64url'); }
function id(prefix) { return `${prefix}_${randomBytes(8).toString('hex')}`; }
function roundKey(ordinal, scenarioId) { return `${ordinal}:${scenarioId}`; }
function publicRoundId(ordinal, scenarioId) { return `r${ordinal}-${scenarioId}`; }

function outcomeFor(round) {
  if (round.baselineError || round.patchError) return 'ENGINE_ERROR';
  const breached = round.baseline?.proofReached === true;
  const contained = round.patch?.effective === true;
  if (breached && contained) return 'BREACHED_THEN_CONTAINED';
  if (breached) return 'BREACHED';
  if (contained) return 'BLOCKED';
  return 'STALEMATE';
}

function incompleteBaseline(preview) {
  return {
    status: 409, proofReached: false, blocked: false, reason: 'incomplete_submission',
    rawHttp: preview?.request ?? null, trace: ['필수 공격 단계가 제출되지 않아 실행하지 않았습니다.'], controls: [],
  };
}

function incompletePatch() {
  const rejected = { proofReached: false, blocked: false, reason: 'incomplete_submission' };
  return {
    patch: null, original: rejected, variant: rejected,
    normal: { passed: false, bootstrapTriggered: false, reason: 'not_executed' },
    effective: false, trace: ['필수 패치 단계가 제출되지 않아 회귀 검증을 실행하지 않았습니다.'],
  };
}

export class GameStore {
  constructor({
    now = () => Date.now(), adjudicators, adjudicator,
    roundMs = PRODUCTION_ROUND_MS, epochMs = 0, maxPlayers = 16,
    sessionTtlMs = 15 * 60_000,
  } = {}) {
    const registry = adjudicators ?? adjudicator;
    if (!registry) throw new Error('adjudicators are required');
    this.adjudicators = typeof registry.get === 'function'
      ? registry
      : { get: (scenarioId) => {
        if (scenarioId !== 'proxy-panic') throw new Error(`no adjudicator for ${scenarioId}`);
        return registry;
      } };
    Object.assign(this, { now, roundMs, epochMs, maxPlayers, sessionTtlMs });
    this.players = new Map();
    this.devices = new Map();
    this.rounds = new Map();
    this.stats = { redWins: 0, blueWins: 0, contained: 0, rounds: 0 };
  }

  currentClock() { return clockAt(this.now(), { roundMs: this.roundMs, epochMs: this.epochMs }); }

  phaseSpec(phase) { return phaseBounds(this.roundMs).find((value) => value.id === phase); }
  joinCutoffMs() { return this.phaseSpec('JOIN').endMs; }
  minimumExposureMs() { return Math.max(50, Math.round((3_000 / PRODUCTION_ROUND_MS) * this.roundMs)); }

  getRound(ordinal, scenarioId) {
    const scenario = getScenario(scenarioId);
    const key = roundKey(ordinal, scenarioId);
    if (!this.rounds.has(key)) {
      const startedAt = this.epochMs + ordinal * this.roundMs;
      this.rounds.set(key, {
        key, id: publicRoundId(ordinal, scenarioId), ordinal, scenarioId, scenario,
        players: new Set(), actions: new Map(), actionIds: new Set(), mode: null,
        phase: 'JOIN', phaseStartedAt: startedAt, phaseEndsAt: startedAt + this.joinCutoffMs(),
        baseline: null, patch: null, baselineError: null, patchError: null,
        baselineInFlight: false, patchInFlight: false, finalized: false,
      });
    }
    return this.rounds.get(key);
  }

  roundsForOrdinal(ordinal) {
    return [...SCENARIOS.keys()].map((scenarioId) => this.getRound(ordinal, scenarioId));
  }

  playersIn(round, team = null) {
    return [...round.players]
      .map((playerToken) => this.players.get(playerToken))
      .filter((player) => player && (!team || player.team === team));
  }

  ordinalPlayerCount(ordinal) {
    return this.roundsForOrdinal(ordinal).reduce((count, round) => count + round.players.size, 0);
  }

  makeCallsign() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const value = `${ADJECTIVES[randomInt(ADJECTIVES.length)]}-${ANIMALS[randomInt(ANIMALS.length)]}-${randomInt(10, 100)}`;
      if (![...this.players.values()].some((player) => player.callsign === value)) return value;
    }
    return `AGENT-${randomBytes(3).toString('hex').toUpperCase()}`;
  }

  assignTeam(round) {
    const red = this.playersIn(round, 'RED').length;
    const blue = this.playersIn(round, 'BLUE').length;
    return red <= blue ? 'RED' : 'BLUE';
  }

  assignRole(round, team) {
    const roles = team === 'RED' ? RED_ROLES : BLUE_ROLES;
    const counts = new Map(roles.map((role) => [role, 0]));
    for (const player of this.playersIn(round, team)) counts.set(player.role, (counts.get(player.role) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[1] - b[1] || roles.indexOf(a[0]) - roles.indexOf(b[0]))[0][0];
  }

  join(existingToken = null, requestedDeviceId = null, scenarioId = null, difficulty = null) {
    this.cleanup();
    if (existingToken && this.players.has(existingToken)) {
      const existing = this.players.get(existingToken);
      existing.lastSeen = this.now();
      existing.expiresAt = this.now() + this.sessionTtlMs;
      return this.identity(existing);
    }

    const deviceId = requestedDeviceId ?? id('device');
    const deviceToken = this.devices.get(deviceId);
    if (deviceToken && this.players.has(deviceToken)) {
      const existing = this.players.get(deviceToken);
      const existingRound = this.getRound(existing.roundOrdinal, existing.scenarioId);
      const clock = clockForOrdinal(existing.roundOrdinal, this.now(), {
        roundMs: this.roundMs, epochMs: this.epochMs,
      });
      if (clock.phase !== 'COMPLETE' && existingRound.phase !== 'RESULT') {
        existing.lastSeen = this.now();
        existing.expiresAt = this.now() + this.sessionTtlMs;
        return this.identity(existing);
      }
    }

    const scenario = getScenario(scenarioId);
    const selectedDifficulty = validateDifficulty(difficulty);
    const current = this.currentClock();
    let ordinal = current.elapsedMs < this.joinCutoffMs() ? current.ordinal : current.ordinal + 1;
    if (this.ordinalPlayerCount(ordinal) >= this.maxPlayers) ordinal = current.ordinal + 1;
    if (this.ordinalPlayerCount(ordinal) >= this.maxPlayers) this.fail('capacity');

    const round = this.getRound(ordinal, scenario.id);
    const team = this.assignTeam(round);
    const playerToken = token();
    const player = {
      id: id('p'), token: playerToken, callsign: this.makeCallsign(), team,
      role: this.assignRole(round, team), roundOrdinal: ordinal,
      scenarioId: scenario.id, difficulty: selectedDifficulty, deviceId,
      createdAt: this.now(), lastSeen: this.now(), expiresAt: this.now() + this.sessionTtlMs,
    };
    this.players.set(playerToken, player);
    this.devices.set(deviceId, playerToken);
    round.players.add(playerToken);
    return this.identity(player);
  }

  identity(player) {
    const round = this.getRound(player.roundOrdinal, player.scenarioId);
    return {
      token: player.token, roundId: round.id, callsign: player.callsign,
      team: round.mode === 'FULL_STACK' ? 'FULL' : player.team,
      role: player.role, scenarioId: player.scenarioId, difficulty: player.difficulty,
      mode: round.mode ?? 'PENDING',
    };
  }

  requirePlayer(playerToken) {
    const player = this.players.get(playerToken);
    if (!player || player.expiresAt <= this.now()) this.fail('unauthorized');
    player.lastSeen = this.now();
    player.expiresAt = this.now() + this.sessionTtlMs;
    return player;
  }

  assignment(round, phase) {
    const assigned = new Map([...round.players].map((playerToken) => [playerToken, []]));
    if (!TASK_PHASES.has(phase) || round.players.size === 0) return assigned;
    if (round.mode === 'FULL_STACK') {
      const only = [...round.players][0];
      assigned.set(only, [
        ...round.scenario.taskIdsFor(phase, 'RED'), ...round.scenario.taskIdsFor(phase, 'BLUE'),
      ]);
      return assigned;
    }
    for (const team of ['RED', 'BLUE']) {
      const teamPlayers = this.playersIn(round, team);
      if (teamPlayers.length === 0) continue;
      round.scenario.taskIdsFor(phase, team).forEach((taskId, index) => {
        assigned.get(teamPlayers[index % teamPlayers.length].token).push(taskId);
      });
    }
    return assigned;
  }

  requiredKeys(round, phase) {
    const assignment = this.assignment(round, phase);
    return [...assignment.entries()].flatMap(([playerToken, taskIds]) => {
      const player = this.players.get(playerToken);
      return taskIds.map((taskId) => `${player.id}:${taskId}`);
    });
  }

  phaseComplete(round) {
    const required = this.requiredKeys(round, round.phase);
    return required.length > 0 && required.every((key) => round.actions.has(key));
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
      mayAdvanceEarly: ['BRIEF', 'DISCOVER', 'BUILD', 'EXECUTE', 'DUEL', 'REVERIFY'].includes(round.phase),
    };
  }

  scenarioPublic(scenario) {
    return {
      id: scenario.id, title: scenario.title, subtitle: scenario.subtitle,
      shortLabel: scenario.shortLabel, category: scenario.category, briefing: scenario.briefing,
      source: scenario.source, sourceUrl: scenario.sourceUrl ?? null, rewardClaim: scenario.rewardClaim ?? null,
    };
  }

  state(playerToken) {
    const player = this.requirePlayer(playerToken);
    const round = this.getRound(player.roundOrdinal, player.scenarioId);
    const clock = this.roundClock(round);
    const assigned = this.assignment(round, clock.phase).get(player.token) ?? [];
    const tasks = assigned.map((taskId) => {
      const selected = round.actions.get(`${player.id}:${taskId}`)?.choice ?? null;
      return round.scenario.publicTask(taskId, {
        difficulty: player.difficulty,
        selected,
        execution: round.baseline,
      });
    });
    const choices = round.scenario.aggregate(round.actions);
    const current = this.currentClock();
    const observations = [...round.actions.values()]
      .filter((action) => action.playerId === player.id)
      .sort((a, b) => a.at - b.at)
      .map((action) => {
        const task = round.scenario.publicTask(action.task, {
          difficulty: player.difficulty,
          selected: action.choice,
          execution: round.baseline,
        });
        return {
          taskId: task.id,
          phase: task.phase,
          choice: action.choice,
          label: task.options.find((option) => option.id === action.choice)?.label ?? action.choice,
          observation: task.selectedObservation,
        };
      });
    return {
      scenario: this.scenarioPublic(round.scenario),
      player: {
        callsign: player.callsign, team: round.mode === 'FULL_STACK' ? 'FULL' : player.team,
        role: player.role, scenarioId: player.scenarioId, difficulty: player.difficulty,
        mode: round.mode ?? 'PENDING',
      },
      round: { ...clock, counts: this.teamCounts(round), maxPlayers: this.maxPlayers, mode: round.mode ?? 'PENDING' },
      tasks,
      observations,
      labPreview: ['BUILD', 'EXECUTE', 'DUEL', 'REVERIFY', 'RESULT'].includes(clock.phase)
        ? round.scenario.preview(choices) : null,
      execution: round.baseline,
      queue: clock.phase === 'QUEUED' ? {
        currentPhase: current.phase, currentRemainingMs: current.remainingMs,
        selectedScenario: player.scenarioId, nextCounts: this.teamCounts(round),
      } : null,
      result: ['RESULT', 'COMPLETE'].includes(clock.phase) ? this.publicResult(round) : null,
    };
  }

  submit(playerToken, { roundId, task, choice, actionId }) {
    const player = this.requirePlayer(playerToken);
    const round = this.getRound(player.roundOrdinal, player.scenarioId);
    if (roundId !== round.id) this.fail('wrong_round');
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(actionId ?? '')) this.fail('invalid_action_id');
    if (!round.scenario.validateChoice(task, choice)) this.fail('invalid_choice');
    const idempotencyKey = `${player.id}:${actionId}`;
    if (round.actionIds.has(idempotencyKey)) return { ok: true, duplicate: true };
    const clock = this.roundClock(round);
    const allowed = this.assignment(round, clock.phase).get(player.token) ?? [];
    if (!allowed.includes(task)) this.fail('phase_closed');
    const actionKey = `${player.id}:${task}`;
    if (round.actions.has(actionKey)) this.fail('choice_locked');
    const taskTeam = round.scenario.tasks[task].team;
    round.actionIds.add(idempotencyKey);
    round.actions.set(actionKey, {
      playerId: player.id, team: taskTeam, role: player.role, task, choice, at: this.now(),
    });
    return { ok: true, selected: choice };
  }

  preview(playerToken, { roundId, task, choice }) {
    const player = this.requirePlayer(playerToken);
    const round = this.getRound(player.roundOrdinal, player.scenarioId);
    if (roundId !== round.id) this.fail('wrong_round');
    if (!round.scenario.validateChoice(task, choice)) this.fail('invalid_choice');
    const clock = this.roundClock(round);
    const allowed = this.assignment(round, clock.phase).get(player.token) ?? [];
    if (!allowed.includes(task)) this.fail('phase_closed');
    const tentative = new Map(round.actions);
    tentative.set(`${player.id}:${task}`, {
      playerId: player.id,
      team: round.scenario.tasks[task].team,
      role: player.role,
      task,
      choice,
      at: this.now(),
    });
    return { ok: true, task, choice, preview: round.scenario.preview(round.scenario.aggregate(tentative)) };
  }

  fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }

  teamCounts(round) {
    return {
      RED: this.playersIn(round, 'RED').length,
      BLUE: this.playersIn(round, 'BLUE').length,
      total: round.players.size,
    };
  }

  difficultyCounts(round) {
    const result = { BEGINNER: 0, ADVANCED: 0 };
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

  seal(round, at) {
    if (round.mode || round.players.size === 0) return;
    round.mode = round.players.size === 1 ? 'FULL_STACK' : 'TEAMS';
    this.enterPhase(round, 'BRIEF', at);
  }

  async executeBaseline(round) {
    if (round.baseline || round.baselineInFlight || round.baselineError) return;
    round.baselineInFlight = true;
    const choices = round.scenario.aggregate(round.actions);
    const input = round.scenario.baselineInput(choices);
    try {
      round.baseline = Object.values(input).every((value) => typeof value === 'string')
        ? await this.adjudicators.get(round.scenarioId).runBaseline(input)
        : incompleteBaseline(round.scenario.preview(choices));
    } catch (error) {
      round.baselineError = error instanceof Error ? error.message.slice(0, 100) : 'engine error';
    } finally {
      round.baselineInFlight = false;
    }
  }

  async executePatch(round) {
    if (round.patch || round.patchInFlight || round.patchError) return;
    if (!round.baseline && !round.baselineError) await this.executeBaseline(round);
    round.patchInFlight = true;
    const choices = round.scenario.aggregate(round.actions);
    const input = round.scenario.patchInput(choices);
    try {
      round.patch = Object.values(input).every((value) => typeof value === 'string')
        ? await this.adjudicators.get(round.scenarioId).runPatch(input)
        : incompletePatch();
    } catch (error) {
      round.patchError = error instanceof Error ? error.message.slice(0, 100) : 'engine error';
    } finally {
      round.patchInFlight = false;
    }
  }

  publicResult(round) {
    if ((!round.baseline && !round.baselineError) || (!round.patch && !round.patchError)) return null;
    const choices = round.scenario.aggregate(round.actions);
    const scores = round.scenario.scores(choices);
    const missingTasks = Object.entries(choices).filter(([, value]) => value === null).map(([taskId]) => taskId);
    return {
      outcome: outcomeFor(round),
      redScore: scores.RED.score, redPossible: scores.RED.possible,
      blueScore: scores.BLUE.score, bluePossible: scores.BLUE.possible,
      baseline: round.baseline ?? { proofReached: false, reason: 'engine_error' },
      patch: round.patch ?? null,
      incompleteTasks: missingTasks,
      explanation: round.scenario.explanation(),
    };
  }

  finalize(round) {
    if (round.finalized || (!round.patch && !round.patchError)) return;
    const outcome = outcomeFor(round);
    this.stats.rounds += 1;
    if (outcome === 'BREACHED') this.stats.redWins += 1;
    if (outcome === 'BLOCKED') this.stats.blueWins += 1;
    if (outcome === 'BREACHED_THEN_CONTAINED') this.stats.contained += 1;
    round.finalized = true;
  }

  transitionAt(round, completed) {
    return completed ? this.now() : round.phaseEndsAt;
  }

  async advanceRound(round) {
    const globalStart = this.epochMs + round.ordinal * this.roundMs;
    const joinEndsAt = globalStart + this.joinCutoffMs();
    if (round.phase === 'JOIN') {
      if (this.now() < joinEndsAt || round.players.size === 0) return false;
      this.seal(round, joinEndsAt);
      return true;
    }
    if (!round.mode || round.phase === 'RESULT') return false;

    const exposed = this.now() >= round.phaseStartedAt + this.minimumExposureMs();
    const deadline = this.now() >= round.phaseEndsAt;
    if (round.phase === 'BRIEF' && (exposed || deadline)) {
      this.enterPhase(round, 'DISCOVER', this.transitionAt(round, exposed));
      return true;
    }
    if (TASK_PHASES.has(round.phase) && ((exposed && this.phaseComplete(round)) || deadline)) {
      const next = round.phase === 'DISCOVER' ? 'BUILD' : round.phase === 'BUILD' ? 'EXECUTE' : 'REVERIFY';
      this.enterPhase(round, next, this.transitionAt(round, exposed && this.phaseComplete(round)));
      return true;
    }
    if (round.phase === 'EXECUTE') {
      await this.executeBaseline(round);
      if (exposed && (round.baseline || round.baselineError)) {
        this.enterPhase(round, 'DUEL', this.now());
        return true;
      }
    }
    if (round.phase === 'REVERIFY') {
      await this.executePatch(round);
      if (exposed && (round.patch || round.patchError)) {
        this.enterPhase(round, 'RESULT', this.now());
        this.finalize(round);
        return true;
      }
    }
    return false;
  }

  async tick() {
    for (const round of this.rounds.values()) {
      const clock = clockForOrdinal(round.ordinal, this.now(), { roundMs: this.roundMs, epochMs: this.epochMs });
      if (clock.phase === 'QUEUED') continue;
      for (let step = 0; step < 10; step += 1) {
        if (!(await this.advanceRound(round))) break;
      }
    }
    this.cleanup();
  }

  teamProgress(round, phase) {
    const result = { RED: null, BLUE: null };
    const assigned = this.assignment(round, phase);
    for (const team of ['RED', 'BLUE']) {
      const keys = [];
      for (const [playerToken, tasks] of assigned) {
        const player = this.players.get(playerToken);
        for (const task of tasks) {
          if (round.scenario.tasks[task].team === team) keys.push(`${player.id}:${task}`);
        }
      }
      if (keys.length > 0) result[team] = Math.round((keys.filter((key) => round.actions.has(key)).length / keys.length) * 100);
    }
    return result;
  }

  screenState() {
    const current = this.currentClock();
    const lanes = [...SCENARIOS.values()].map((scenario) => {
      const round = this.getRound(current.ordinal, scenario.id);
      const clock = this.roundClock(round);
      const publicClock = round.players.size === 0 && current.elapsedMs >= this.joinCutoffMs()
        ? { ...clock, phase: 'IDLE', phaseRemainingMs: current.remainingMs, mayAdvanceEarly: false }
        : clock;
      return {
        scenario: this.scenarioPublic(scenario), round: { ...publicClock, counts: this.teamCounts(round), mode: round.mode ?? 'PENDING' },
        difficultyCounts: this.difficultyCounts(round), progress: this.teamProgress(round, clock.phase),
        execution: ['EXECUTE', 'DUEL', 'REVERIFY', 'RESULT'].includes(clock.phase) && round.baseline
          ? { proofReached: round.baseline.proofReached, reason: round.baseline.reason } : null,
        result: clock.phase === 'RESULT' ? this.publicResult(round) : null,
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
      stats: { ...this.stats },
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
