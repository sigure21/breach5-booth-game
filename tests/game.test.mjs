import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeterministicRegistry } from '../src/adjudicator.mjs';
import { GameStore } from '../src/game.mjs';
import { getScenario } from '../src/scenarios/index.mjs';

function fixture({ maxPlayers = 16 } = {}) {
  let now = 0;
  let device = 0;
  const adjudicators = createDeterministicRegistry();
  const store = new GameStore({
    now: () => now, adjudicators, roundMs: 18_000, epochMs: 0, maxPlayers,
  });
  const join = (scenarioId = 'proxy-panic', difficulty = 'BEGINNER') => {
    device += 1;
    return store.join(null, device.toString(16).padStart(32, '0'), scenarioId, difficulty);
  };
  return { store, adjudicators, join, setNow: (value) => { now = value; }, getNow: () => now };
}

function submitVisible(store, player, scenario, counter) {
  const state = store.state(player.token);
  for (const task of state.tasks) {
    const expected = scenario.correct[task.id];
    const choice = Array.isArray(expected) ? expected[0] : expected;
    store.submit(player.token, {
      roundId: state.round.roundId,
      task: task.id,
      choice,
      actionId: `action_${String(counter.value).padStart(4, '0')}`,
    });
    counter.value += 1;
  }
  return state.tasks.map(({ id }) => id);
}

async function solveFullStack(scenarioId) {
  const context = fixture();
  const { store, join, setNow } = context;
  const player = join(scenarioId, 'ADVANCED');
  const scenario = getScenario(scenarioId);
  const counter = { value: 1 };

  setNow(1_500); await store.tick();
  setNow(1_800); await store.tick();
  assert.equal(store.state(player.token).round.phase, 'DISCOVER');
  assert.equal(store.state(player.token).attackFlow, null, 'attack flow must not reveal answers before execution');
  submitVisible(store, player, scenario, counter);

  setNow(2_100); await store.tick();
  assert.equal(store.state(player.token).round.phase, 'BUILD');
  assert.equal(store.state(player.token).attackFlow, null, 'attack flow must stay hidden until a baseline exists');
  submitVisible(store, player, scenario, counter);

  setNow(2_400); await store.tick();
  assert.equal(store.state(player.token).round.phase, 'EXECUTE');
  assert.equal(store.state(player.token).execution.proofReached, true);
  if (scenarioId === 'session-heist') {
    assert.equal(store.state(player.token).attackFlow?.confirmed, true);
    assert.equal(store.state(player.token).attackFlow?.steps.at(-1)?.status, 'CONFIRMED');
  } else {
    assert.equal(store.state(player.token).attackFlow, null);
  }

  setNow(2_700); await store.tick();
  assert.equal(store.state(player.token).round.phase, 'DUEL');
  submitVisible(store, player, scenario, counter);

  setNow(3_000); await store.tick();
  assert.equal(store.state(player.token).round.phase, 'REVERIFY');
  setNow(3_300); await store.tick();
  const state = store.state(player.token);
  assert.equal(state.round.phase, 'RESULT');
  return { ...context, player, state };
}

test('new joins require allowlisted scenario and difficulty values', () => {
  const { store } = fixture();
  assert.throws(() => store.join(null, '0'.repeat(32), null, 'BEGINNER'), (error) => error.code === 'invalid_scenario');
  assert.throws(() => store.join(null, '1'.repeat(32), 'proxy-panic', 'EASY'), (error) => error.code === 'invalid_difficulty');
  assert.throws(() => store.join(null, '2'.repeat(32), 'invented', 'BEGINNER'), (error) => error.code === 'invalid_scenario');
});

test('same device reconnect preserves its original scenario and difficulty', () => {
  const { store } = fixture();
  const deviceId = '0123456789abcdef0123456789abcdef';
  const original = store.join(null, deviceId, 'proxy-panic', 'BEGINNER');
  const attemptedChange = store.join(null, deviceId, 'session-heist', 'ADVANCED');
  assert.deepEqual(attemptedChange, original);
  assert.equal(original.scenarioId, 'proxy-panic');
  assert.equal(original.difficulty, 'BEGINNER');
  assert.equal(store.getRound(0, 'proxy-panic').players.size, 1);
  assert.equal(store.getRound(0, 'session-heist').players.size, 0);
});

test('capacity is global across scenario lanes and late participants queue', () => {
  const { store, join } = fixture({ maxPlayers: 2 });
  assert.match(join('proxy-panic').roundId, /^r0-/);
  assert.match(join('session-heist').roundId, /^r0-/);
  assert.match(join('proxy-panic').roundId, /^r1-/);
  assert.match(join('session-heist').roundId, /^r1-/);
  assert.throws(() => join('proxy-panic'), (error) => error.code === 'capacity');
});

test('one participant seals as FULL_STACK and receives both teams tasks once', async () => {
  const { store, join, setNow } = fixture();
  const player = join('session-heist');
  setNow(1_500); await store.tick();
  setNow(1_800); await store.tick();
  const state = store.state(player.token);
  assert.equal(state.player.mode, 'FULL_STACK');
  assert.equal(state.player.team, 'FULL');
  assert.deepEqual(state.tasks.map(({ id }) => id), ['sh_surface', 'sh_anomaly']);
  assert.equal(store.requiredKeys(store.getRound(0, 'session-heist'), 'DISCOVER').length, 2);
});

test('two participants seal into RED and BLUE with team-specific work', async () => {
  const { store, join, setNow } = fixture();
  const red = join('proxy-panic');
  const blue = join('proxy-panic', 'ADVANCED');
  setNow(1_500); await store.tick();
  setNow(1_800); await store.tick();
  assert.equal(store.state(red.token).player.mode, 'TEAMS');
  assert.equal(store.state(red.token).player.team, 'RED');
  assert.equal(store.state(blue.token).player.team, 'BLUE');
  assert.deepEqual(store.state(red.token).tasks.map(({ id }) => id), ['trust_boundary']);
  assert.deepEqual(store.state(blue.token).tasks.map(({ id }) => id), ['anomaly']);
});

test('scenario cohorts do not leak actions or previews into one another', async () => {
  const { store, join, setNow } = fixture();
  const proxy = join('proxy-panic');
  const session = join('session-heist');
  setNow(1_500); await store.tick();
  setNow(1_800); await store.tick();
  store.submit(proxy.token, {
    roundId: 'r0-proxy-panic', task: 'trust_boundary', choice: 'parser_mismatch', actionId: 'isolated_action_01',
  });
  const sessionState = store.state(session.token);
  assert.equal(sessionState.scenario.id, 'session-heist');
  assert.ok(sessionState.tasks.every(({ selected }) => selected === null));
  assert.equal(store.getRound(0, 'session-heist').actions.size, 0);
});

test('completed evidence responses advance before the phase ceiling', async () => {
  const { store, join, setNow } = fixture();
  const player = join('proxy-panic');
  const scenario = getScenario('proxy-panic');
  const counter = { value: 1 };
  setNow(1_500); await store.tick();
  setNow(1_800); await store.tick();
  const deadline = store.state(player.token).round.phaseEndsAt;
  submitVisible(store, player, scenario, counter);
  setNow(2_100); await store.tick();
  const state = store.state(player.token);
  assert.equal(state.round.phase, 'BUILD');
  assert.ok(2_100 < deadline, 'DISCOVER should finish before its maximum deadline');
});

test('missing responses never become hidden default choices', async () => {
  const { store, join, setNow } = fixture();
  const player = join('proxy-panic');
  setNow(1_500); await store.tick();
  setNow(1_800); await store.tick();
  setNow(4_300); await store.tick();
  assert.equal(store.state(player.token).round.phase, 'BUILD');
  setNow(8_300); await store.tick();
  const execution = store.state(player.token).execution;
  assert.equal(execution.proofReached, false);
  assert.equal(execution.reason, 'incomplete_submission');
  assert.ok(Object.values(store.getRound(0, 'proxy-panic').scenario.aggregate(new Map())).every((value) => value === null));
});

test('actions are phase-bound, allowlisted, idempotent, and first choice locked', async () => {
  const { store, join, setNow } = fixture();
  const player = join('proxy-panic');
  setNow(1_500); await store.tick();
  setNow(1_800); await store.tick();
  const action = {
    roundId: 'r0-proxy-panic', task: 'trust_boundary', choice: 'parser_mismatch', actionId: 'choice_lock_01',
  };
  assert.deepEqual(store.submit(player.token, action), { ok: true, selected: 'parser_mismatch' });
  assert.deepEqual(store.submit(player.token, action), { ok: true, duplicate: true });
  assert.match(store.state(player.token).observations[0].observation, /경로 표현/);
  assert.throws(() => store.submit(player.token, { ...action, choice: 'backend_down', actionId: 'choice_lock_02' }),
    (error) => error.code === 'choice_locked');
  assert.throws(() => store.submit(player.token, {
    roundId: 'r0-proxy-panic', task: 'prefix', choice: 'command_substitution', actionId: 'wrong_phase_001',
  }), (error) => error.code === 'phase_closed');
  assert.throws(() => store.submit(player.token, {
    roundId: 'r0-proxy-panic', task: 'trust_boundary', choice: 'arbitrary', actionId: 'bad_choice_0001',
  }), (error) => error.code === 'invalid_choice');
});

test('tentative preview uses allowlisted choices without mutating the round', async () => {
  const { store, join, setNow } = fixture();
  const player = join('proxy-panic');
  const scenario = getScenario('proxy-panic');
  const counter = { value: 1 };
  setNow(1_500); await store.tick();
  setNow(1_800); await store.tick();
  submitVisible(store, player, scenario, counter);
  setNow(2_100); await store.tick();
  const before = store.getRound(0, 'proxy-panic').actions.size;
  const preview = store.preview(player.token, {
    roundId: 'r0-proxy-panic', task: 'prefix', choice: 'command_substitution',
  });
  assert.match(preview.preview.request, /x\$\(printenv\$\{IFS\}BREACH5_PROOF\)x/);
  assert.equal(store.getRound(0, 'proxy-panic').actions.size, before);
  assert.throws(() => store.preview(player.token, {
    roundId: 'r0-proxy-panic', task: 'prefix', choice: 'free-form-command',
  }), (error) => error.code === 'invalid_choice');
});

test('idempotency keys are scoped per participant and empty lanes become IDLE', async () => {
  const { store, join, setNow } = fixture();
  const red = join('proxy-panic');
  const blue = join('proxy-panic');
  setNow(1_500); await store.tick();
  setNow(1_800); await store.tick();
  store.submit(red.token, {
    roundId: 'r0-proxy-panic', task: 'trust_boundary', choice: 'parser_mismatch', actionId: 'shared_action_01',
  });
  store.submit(blue.token, {
    roundId: 'r0-proxy-panic', task: 'anomaly', choice: 'route_views_differ', actionId: 'shared_action_01',
  });
  assert.equal(store.getRound(0, 'proxy-panic').actions.size, 2);
  const idle = store.screenState().lanes.find(({ scenario }) => scenario.id === 'session-heist');
  assert.equal(idle.round.phase, 'IDLE');
});

for (const scenarioId of ['proxy-panic', 'session-heist']) {
  test(`${scenarioId} reaches a real breach then an effective regression-tested patch`, async () => {
    const { state } = await solveFullStack(scenarioId);
    assert.equal(state.result.outcome, 'BREACHED_THEN_CONTAINED');
    assert.equal(state.result.baseline.proofReached, true);
    assert.equal(state.result.patch.effective, true);
    assert.deepEqual(state.result.incompleteTasks, []);
    assert.equal(state.result.redScore, state.result.redPossible);
    assert.equal(state.result.blueScore, state.result.bluePossible);
  });
}
