import assert from 'node:assert/strict';
import test from 'node:test';
import { DeterministicAdjudicator } from '../src/adjudicator.mjs';
import { GameStore } from '../src/game.mjs';

function fixture() {
  let now = 0;
  const store = new GameStore({
    now: () => now,
    adjudicator: new DeterministicAdjudicator(),
    roundMs: 300_000,
    epochMs: 0,
  });
  return { store, setNow: (value) => { now = value; } };
}

test('join balances teams and assigns all six roles', () => {
  const { store } = fixture();
  const players = Array.from({ length: 6 }, () => store.join());
  assert.deepEqual(players.map((player) => player.team), ['RED', 'BLUE', 'RED', 'BLUE', 'RED', 'BLUE']);
  assert.deepEqual(players.filter((player) => player.team === 'RED').map((player) => player.role), ['SCOUT', 'BUILDER', 'RUNNER']);
  assert.deepEqual(players.filter((player) => player.team === 'BLUE').map((player) => player.role), ['MONITOR', 'GATEKEEPER', 'PATCHER']);
});

test('late joins queue for the next round and each round is capped', () => {
  const { store, setNow } = fixture();
  Array.from({ length: 16 }, () => store.join());
  assert.equal(store.join().roundId, 'r1');
  setNow(30_001);
  assert.equal(store.join().roundId, 'r1');
});

test('current-round enrollment closes exactly when the JOIN phase ends', () => {
  const { store, setNow } = fixture();
  setNow(19_999);
  assert.equal(store.join().roundId, 'r0');
  setNow(20_000);
  assert.equal(store.join().roundId, 'r1');
});

test('actions are phase-bound, idempotent, and produce a contained breach', async () => {
  const { store, setNow } = fixture();
  const [redScout, blueMonitor, redBuilder, blueGatekeeper, redRunner, bluePatcher] = Array.from({ length: 6 }, () => store.join());

  setNow(50_000);
  store.submit(redScout.token, { roundId: 'r0', task: 'trust_boundary', choice: 'parser_mismatch', actionId: 'discover_red_01' });
  store.submit(blueMonitor.token, { roundId: 'r0', task: 'anomaly', choice: 'route_views_differ', actionId: 'discover_blue_1' });
  assert.deepEqual(store.submit(redScout.token, { roundId: 'r0', task: 'trust_boundary', choice: 'parser_mismatch', actionId: 'discover_red_01' }), { ok: true, duplicate: true });
  assert.throws(() => store.submit(redScout.token, { roundId: 'r0', task: 'prefix', choice: 'command_substitution', actionId: 'wrong_phase_001' }), /phase_closed/);

  setNow(95_000);
  store.submit(redBuilder.token, { roundId: 'r0', task: 'prefix', choice: 'command_substitution', actionId: 'build_prefix_01' });
  store.submit(redScout.token, { roundId: 'r0', task: 'normalization', choice: 'encoded_parent', actionId: 'build_normal_01' });
  store.submit(redRunner.token, { roundId: 'r0', task: 'sink', choice: 'cold_start', actionId: 'build_sink_0001' });
  store.submit(blueGatekeeper.token, { roundId: 'r0', task: 'guard', choice: 'canonical_once', actionId: 'build_guard_001' });

  setNow(155_000);
  await store.tick();
  assert.equal(store.getRound(0).baseline.proofReached, true);

  setNow(185_000);
  store.submit(redScout.token, { roundId: 'r0', task: 'bypass', choice: 'backtick_variant', actionId: 'duel_bypass_001' });
  store.submit(bluePatcher.token, { roundId: 'r0', task: 'patch', choice: 'canonical_once', actionId: 'duel_patch_0001' });

  setNow(245_000);
  await store.tick();
  assert.equal(store.getRound(0).patch.effective, true);

  setNow(275_000);
  await store.tick();
  const state = store.state(redScout.token);
  assert.equal(state.result.outcome, 'BREACHED_THEN_CONTAINED');
  assert.equal(state.result.redScore, 3);
  assert.equal(state.result.blueScore, 4);
});

test('tokens reconnect without changing identity', () => {
  const { store } = fixture();
  const joined = store.join();
  const rejoined = store.join(joined.token);
  assert.deepEqual(rejoined, joined);
});

test('a stable device id reuses the same anonymous identity', () => {
  const { store } = fixture();
  const deviceId = '0123456789abcdef0123456789abcdef';
  const joined = store.join(null, deviceId);
  const rejoinedWithoutToken = store.join(null, deviceId);
  assert.deepEqual(rejoinedWithoutToken, joined);
  assert.equal(store.getRound(0).players.size, 1);
});

test('the first task choice is locked while an identical action id stays idempotent', () => {
  const { store, setNow } = fixture();
  const player = store.join();
  setNow(50_000);
  const first = {
    roundId: 'r0', task: 'trust_boundary', choice: 'parser_mismatch', actionId: 'choice_lock_01',
  };
  assert.deepEqual(store.submit(player.token, first), { ok: true, selected: 'parser_mismatch' });
  assert.deepEqual(store.submit(player.token, first), { ok: true, duplicate: true });
  assert.throws(() => store.submit(player.token, {
    ...first, choice: 'backend_down', actionId: 'choice_lock_02',
  }), (error) => error.code === 'choice_locked');
});

test('queued players receive current-round context and the screen exposes next-round demand', () => {
  const { store, setNow } = fixture();
  store.join(null, '00000000000000000000000000000001');
  setNow(30_001);
  const queued = store.join(null, '00000000000000000000000000000002');
  const queuedState = store.state(queued.token);
  assert.equal(queuedState.round.phase, 'QUEUED');
  assert.equal(queuedState.queue.currentPhase, 'BRIEF');
  assert.equal(queuedState.queue.nextCounts.RED, 1);
  assert.equal(queuedState.queue.nextCounts.BLUE, 0);

  const screen = store.screenState();
  assert.equal(screen.joinMode, 'NEXT');
  assert.equal(screen.nextRound.total, 1);
  assert.equal(screen.nextRound.counts.RED, 1);
  assert.equal(screen.nextRound.startsInMs, screen.round.remainingMs);

  for (let index = 0; index < 15; index += 1) {
    store.join(null, (index + 3).toString(16).padStart(32, '0'));
  }
  assert.equal(store.screenState().joinMode, 'FULL');
});

test('team progress counts each required player response', () => {
  const { store, setNow } = fixture();
  const players = Array.from({ length: 6 }, () => store.join());
  const red = players.find((player) => player.team === 'RED');
  setNow(50_000);
  store.submit(red.token, {
    roundId: 'r0', task: 'trust_boundary', choice: 'parser_mismatch', actionId: 'progress_vote_01',
  });
  const progress = store.screenState().progress;
  assert.equal(progress.RED, 33);
  assert.equal(progress.BLUE, 0);
});

test('engine failures take precedence over apparently blocked or breached outcomes', async () => {
  let now = 0;
  const adjudicator = {
    async ready() { return true; },
    async runBaseline() {
      return {
        status: 503, routeAccepted: true, bootstrapTriggered: true, proofReached: true,
        blocked: false, reason: 'safe_proof_reached', rawHttp: 'GET / HTTP/1.1',
      };
    },
    async runPatch() { throw new Error('patched engine unavailable'); },
  };
  const store = new GameStore({ now: () => now, adjudicator, roundMs: 300_000, epochMs: 0 });
  const player = store.join();
  now = 155_000;
  await store.tick();
  now = 245_000;
  await store.tick();
  now = 275_000;
  await store.tick();
  assert.equal(store.state(player.token).result.outcome, 'ENGINE_ERROR');
});

test('the deterministic engine mirrors the live patch and gateway matrix', async () => {
  const adjudicator = new DeterministicAdjudicator();
  const literalReplay = await adjudicator.runPatch({ patch: 'block_subshell', bypass: 'original' });
  assert.equal(literalReplay.original.blocked, true);
  assert.equal(literalReplay.variant.proofReached, false);
  assert.equal(literalReplay.effective, true);

  const literalBypass = await adjudicator.runPatch({ patch: 'block_subshell', bypass: 'backtick_variant' });
  assert.equal(literalBypass.variant.proofReached, true);
  assert.equal(literalBypass.variant.blocked, false);
  assert.equal(literalBypass.effective, false);

  const gatewayReject = await adjudicator.runPatch({ patch: 'hide_errors', bypass: 'double_encoded' });
  assert.equal(gatewayReject.variant.routeAccepted, false);
  assert.equal(gatewayReject.variant.proofReached, false);
  assert.equal(gatewayReject.variant.blocked, false);
  assert.equal(gatewayReject.effective, false);

  for (const patch of ['canonical_once', 'structured_exec']) {
    const verdict = await adjudicator.runPatch({ patch, bypass: 'backtick_variant' });
    assert.equal(verdict.original.blocked, false);
    assert.equal(verdict.variant.blocked, false);
    assert.equal(verdict.normal.bootstrapTriggered, true);
    assert.equal(verdict.effective, true);
  }
});
