import { randomBytes, randomInt } from 'node:crypto';
import { clockAt, clockForOrdinal, phaseBounds, PRODUCTION_ROUND_MS } from './clock.mjs';
import {
  DEFAULT_CHOICES,
  publicTask,
  scenarioExplanation,
  SCENARIO,
  taskIdsFor,
  validateChoice,
} from './scenario.mjs';

const RED_ROLES = ['SCOUT', 'BUILDER', 'RUNNER'];
const BLUE_ROLES = ['MONITOR', 'GATEKEEPER', 'PATCHER'];
const ADJECTIVES = ['NEON', 'SWIFT', 'QUIET', 'BRAVE', 'LUCID', 'NOVA', 'PIXEL', 'SOLAR'];
const ANIMALS = ['OWL', 'FOX', 'OTTER', 'RAVEN', 'TIGER', 'GECKO', 'MANTA', 'LYNX'];

function token() { return randomBytes(24).toString('base64url'); }
function id(prefix) { return `${prefix}_${randomBytes(8).toString('hex')}`; }

function tally(actions, team, task, fallback) {
  const candidates = [...actions.values()].filter((entry) => entry.team === team && entry.task === task);
  if (candidates.length === 0) return fallback;
  const counts = new Map();
  for (const entry of candidates) {
    const current = counts.get(entry.choice) ?? { count: 0, firstAt: entry.at };
    current.count += 1;
    current.firstAt = Math.min(current.firstAt, entry.at);
    counts.set(entry.choice, current);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[1].firstAt - b[1].firstAt || a[0].localeCompare(b[0]))[0][0];
}

function outcomeFor(round) {
  if (round.baselineError || round.patchError) return 'ENGINE_ERROR';
  const breached = round.baseline?.proofReached === true;
  const contained = round.patch?.effective === true;
  if (breached && contained) return 'BREACHED_THEN_CONTAINED';
  if (breached) return 'BREACHED';
  if (contained) return 'BLOCKED';
  return 'STALEMATE';
}

function publicResult(round) {
  if ((!round.baseline && !round.baselineError) || (!round.patch && !round.patchError)) return null;
  const outcome = outcomeFor(round);
  const redScore = (round.baseline?.proofReached ? 2 : 0)
    + (round.patch?.variant?.proofReached ? 1 : 0)
    + (tally(round.actions, 'RED', 'trust_boundary', '') === 'parser_mismatch' ? 1 : 0);
  const blueScore = (tally(round.actions, 'BLUE', 'anomaly', '') === 'route_views_differ' ? 1 : 0)
    + (tally(round.actions, 'BLUE', 'guard', '') === 'canonical_once' ? 1 : 0)
    + (round.patch?.effective ? 2 : 0);
  return {
    outcome,
    redScore,
    blueScore,
    baseline: round.baseline ?? { proofReached: false, reason: 'engine_error' },
    patch: round.patch ?? null,
    explanation: scenarioExplanation(),
  };
}

export class GameStore {
  constructor({
    now = () => Date.now(),
    adjudicator,
    roundMs = PRODUCTION_ROUND_MS,
    epochMs = 0,
    maxPlayers = 16,
    sessionTtlMs = 15 * 60_000,
  } = {}) {
    if (!adjudicator) throw new Error('adjudicator is required');
    this.now = now;
    this.adjudicator = adjudicator;
    this.roundMs = roundMs;
    this.epochMs = epochMs;
    this.maxPlayers = maxPlayers;
    this.sessionTtlMs = sessionTtlMs;
    this.players = new Map();
    this.devices = new Map();
    this.rounds = new Map();
    this.stats = { redWins: 0, blueWins: 0, contained: 0, rounds: 0 };
  }

  currentClock() { return clockAt(this.now(), { roundMs: this.roundMs, epochMs: this.epochMs }); }

  joinCutoffMs() {
    return phaseBounds(this.roundMs).find((phase) => phase.id === 'JOIN').endMs;
  }

  getRound(ordinal) {
    if (!this.rounds.has(ordinal)) {
      this.rounds.set(ordinal, {
        id: `r${ordinal}`,
        ordinal,
        players: new Set(),
        actions: new Map(),
        actionIds: new Set(),
        baseline: null,
        patch: null,
        baselineError: null,
        patchError: null,
        baselineInFlight: false,
        patchInFlight: false,
        finalized: false,
      });
    }
    return this.rounds.get(ordinal);
  }

  playersIn(round, team = null) {
    return [...round.players]
      .map((playerId) => this.players.get(playerId))
      .filter((player) => player && (!team || player.team === team));
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

  join(existingToken = null, requestedDeviceId = null) {
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
      const existingClock = clockForOrdinal(existing.roundOrdinal, this.now(), { roundMs: this.roundMs, epochMs: this.epochMs });
      if (!['RESULT', 'COMPLETE'].includes(existingClock.phase)) {
        existing.lastSeen = this.now();
        existing.expiresAt = this.now() + this.sessionTtlMs;
        return this.identity(existing);
      }
    }

    const current = this.currentClock();
    const cutoff = this.joinCutoffMs();
    let ordinal = current.elapsedMs < cutoff ? current.ordinal : current.ordinal + 1;
    let round = this.getRound(ordinal);
    if (round.players.size >= this.maxPlayers) {
      ordinal = current.ordinal + 1;
      round = this.getRound(ordinal);
    }
    if (round.players.size >= this.maxPlayers) {
      const error = new Error('next round is full');
      error.code = 'capacity';
      throw error;
    }

    const team = this.assignTeam(round);
    const playerToken = token();
    const player = {
      id: id('p'), token: playerToken, callsign: this.makeCallsign(), team,
      role: this.assignRole(round, team), roundOrdinal: ordinal,
      deviceId,
      createdAt: this.now(), lastSeen: this.now(), expiresAt: this.now() + this.sessionTtlMs,
    };
    this.players.set(playerToken, player);
    this.devices.set(deviceId, playerToken);
    round.players.add(playerToken);
    return this.identity(player);
  }

  identity(player) {
    return {
      token: player.token,
      roundId: `r${player.roundOrdinal}`,
      callsign: player.callsign,
      team: player.team,
      role: player.role,
    };
  }

  requirePlayer(playerToken) {
    const player = this.players.get(playerToken);
    if (!player || player.expiresAt <= this.now()) {
      const error = new Error('session expired');
      error.code = 'unauthorized';
      throw error;
    }
    player.lastSeen = this.now();
    player.expiresAt = this.now() + this.sessionTtlMs;
    return player;
  }

  state(playerToken) {
    const player = this.requirePlayer(playerToken);
    const round = this.getRound(player.roundOrdinal);
    const clock = clockForOrdinal(player.roundOrdinal, this.now(), { roundMs: this.roundMs, epochMs: this.epochMs });
    const teamSize = this.playersIn(round, player.team).length;
    const taskIds = ['QUEUED', 'COMPLETE', 'BRIEF', 'JOIN', 'EXECUTE', 'REVERIFY', 'RESULT'].includes(clock.phase)
      ? [] : taskIdsFor({ phase: clock.phase, team: player.team, role: player.role, teamSize });
    const tasks = taskIds.map((taskId) => {
      const selected = round.actions.get(`${player.id}:${taskId}`)?.choice ?? null;
      return publicTask(taskId, selected);
    });
    const counts = this.teamCounts(round);
    const current = this.currentClock();
    return {
      scenario: SCENARIO,
      player: { callsign: player.callsign, team: player.team, role: player.role },
      round: { ...clock, counts, maxPlayers: this.maxPlayers },
      tasks,
      queue: clock.phase === 'QUEUED' ? {
        currentPhase: current.phase,
        currentRemainingMs: current.remainingMs,
        nextCounts: counts,
      } : null,
      result: clock.phase === 'RESULT' || clock.phase === 'COMPLETE' ? publicResult(round) : null,
    };
  }

  submit(playerToken, { roundId, task, choice, actionId }) {
    const player = this.requirePlayer(playerToken);
    if (roundId !== `r${player.roundOrdinal}`) return this.fail('wrong_round');
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(actionId ?? '')) return this.fail('invalid_action_id');
    if (!validateChoice(task, choice)) return this.fail('invalid_choice');
    const round = this.getRound(player.roundOrdinal);
    if (round.actionIds.has(actionId)) return { ok: true, duplicate: true };
    const clock = clockForOrdinal(player.roundOrdinal, this.now(), { roundMs: this.roundMs, epochMs: this.epochMs });
    const teamSize = this.playersIn(round, player.team).length;
    const allowed = taskIdsFor({ phase: clock.phase, team: player.team, role: player.role, teamSize });
    if (!allowed.includes(task)) return this.fail('phase_closed');
    if (round.actions.has(`${player.id}:${task}`)) return this.fail('choice_locked');
    round.actionIds.add(actionId);
    round.actions.set(`${player.id}:${task}`, {
      playerId: player.id, team: player.team, role: player.role, task, choice, at: this.now(),
    });
    return { ok: true, selected: choice };
  }

  fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }

  teamCounts(round) {
    return { RED: this.playersIn(round, 'RED').length, BLUE: this.playersIn(round, 'BLUE').length };
  }

  aggregate(round) {
    return {
      trust_boundary: tally(round.actions, 'RED', 'trust_boundary', DEFAULT_CHOICES.trust_boundary),
      anomaly: tally(round.actions, 'BLUE', 'anomaly', DEFAULT_CHOICES.anomaly),
      prefix: tally(round.actions, 'RED', 'prefix', DEFAULT_CHOICES.prefix),
      normalization: tally(round.actions, 'RED', 'normalization', DEFAULT_CHOICES.normalization),
      sink: tally(round.actions, 'RED', 'sink', DEFAULT_CHOICES.sink),
      guard: tally(round.actions, 'BLUE', 'guard', DEFAULT_CHOICES.guard),
      bypass: tally(round.actions, 'RED', 'bypass', DEFAULT_CHOICES.bypass),
      patch: tally(round.actions, 'BLUE', 'patch', DEFAULT_CHOICES.patch),
    };
  }

  async executeBaseline(round) {
    if (round.baseline || round.baselineInFlight || round.baselineError) return;
    round.baselineInFlight = true;
    const choices = this.aggregate(round);
    try {
      round.baseline = await this.adjudicator.runBaseline({
        prefix: choices.prefix, normalization: choices.normalization, sink: choices.sink,
      });
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
    const choices = this.aggregate(round);
    try {
      round.patch = await this.adjudicator.runPatch({ patch: choices.patch, bypass: choices.bypass });
    } catch (error) {
      round.patchError = error instanceof Error ? error.message.slice(0, 100) : 'engine error';
    } finally {
      round.patchInFlight = false;
    }
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

  async tick() {
    const now = this.now();
    const bounds = phaseBounds(this.roundMs);
    const executeAt = bounds.find((phase) => phase.id === 'EXECUTE').startMs;
    const reverifyAt = bounds.find((phase) => phase.id === 'REVERIFY').startMs;
    const resultAt = bounds.find((phase) => phase.id === 'RESULT').startMs;
    for (const round of this.rounds.values()) {
      const elapsed = now - (this.epochMs + round.ordinal * this.roundMs);
      if (elapsed >= executeAt && elapsed < this.roundMs) await this.executeBaseline(round);
      if (elapsed >= reverifyAt && elapsed < this.roundMs) await this.executePatch(round);
      if (elapsed >= resultAt) this.finalize(round);
    }
    this.cleanup();
  }

  screenState() {
    const current = this.currentClock();
    const round = this.getRound(current.ordinal);
    const choices = this.aggregate(round);
    const resultVisible = current.phase === 'RESULT';
    const nextRound = this.getRound(current.ordinal + 1);
    const cutoff = this.joinCutoffMs();
    return {
      scenario: SCENARIO,
      round: { ...current, counts: this.teamCounts(round), maxPlayers: this.maxPlayers },
      progress: this.teamProgress(round, current.phase),
      nextRound: {
        counts: this.teamCounts(nextRound),
        total: nextRound.players.size,
        startsInMs: current.remainingMs,
      },
      joinMode: current.elapsedMs < cutoff && round.players.size < this.maxPlayers
        ? 'CURRENT'
        : nextRound.players.size < this.maxPlayers ? 'NEXT' : 'FULL',
      execution: ['EXECUTE', 'DUEL', 'REVERIFY', 'RESULT'].includes(current.phase) && round.baseline
        ? { proofReached: round.baseline.proofReached, routeAccepted: round.baseline.routeAccepted }
        : null,
      result: resultVisible ? publicResult(round) : null,
      choices: resultVisible ? choices : null,
      stats: { ...this.stats },
    };
  }

  teamProgress(round, phase) {
    const result = { RED: null, BLUE: null };
    for (const team of ['RED', 'BLUE']) {
      const players = this.playersIn(round, team);
      if (players.length === 0) continue;
      const required = players.flatMap((player) => taskIdsFor({
        phase, team, role: player.role, teamSize: players.length,
      }).map((task) => `${player.id}:${task}`));
      if (required.length === 0) continue;
      const completed = required.filter((key) => round.actions.has(key)).length;
      result[team] = Math.round((completed / required.length) * 100);
    }
    return result;
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
    for (const [ordinal] of this.rounds) {
      if (ordinal < currentOrdinal - 3 || ordinal > currentOrdinal + 1) this.rounds.delete(ordinal);
    }
  }
}
