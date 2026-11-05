import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('compose keeps engines internal and containers hardened', async () => {
  const compose = await readFile(new URL('compose.yaml', root), 'utf8');
  assert.match(compose, /read_only:\s*true/);
  assert.match(compose, /cap_drop:\s*\[ALL\]/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /engine:\s*\{internal:\s*true\}/);
  assert.match(compose, /vulnerable-backplane:\s*\{internal:\s*true\}/);
  assert.doesNotMatch(compose, /docker\.sock|privileged:\s*true|network_mode:\s*host/);
  assert.equal((compose.match(/ports:/g) ?? []).length, 1);
});

test('public assets contain no generated proof or worker token', async () => {
  const files = ['src/public/play.html', 'src/public/screen.html', 'src/public/play.js', 'src/public/screen.js', 'src/public/app.css'];
  const content = (await Promise.all(files.map((file) => readFile(new URL(file, root), 'utf8')))).join('\n');
  assert.doesNotMatch(content, /proof_[a-f0-9]{48}/);
  assert.doesNotMatch(content, /[a-f0-9]{64}/);
  assert.doesNotMatch(content, /innerHTML\s*=/);
});

test('verification audits both stdout and stderr logs', async () => {
  const booth = await readFile(new URL('tools/booth.mjs', root), 'utf8');
  assert.match(booth, /logResult\.stdout/);
  assert.match(booth, /logResult\.stderr/);
});
