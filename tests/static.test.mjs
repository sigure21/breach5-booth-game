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
  assert.match(compose, /session-lab:\s*\{internal:\s*true\}/);
  assert.match(compose, /vulnerable-backplane:\s*\{internal:\s*true\}/);
  assert.doesNotMatch(compose, /docker\.sock|privileged:\s*true|network_mode:\s*host/);
  assert.equal((compose.match(/ports:/g) ?? []).length, 1);
});

test('session engine is internal, least-privileged, and accepts semantic selections only', async () => {
  const [compose, dockerfile, engine] = await Promise.all([
    readFile(new URL('compose.yaml', root), 'utf8'),
    readFile(new URL('engine/session.Dockerfile', root), 'utf8'),
    readFile(new URL('engine/session_engine.py', root), 'utf8'),
  ]);
  const service = compose.split(/\n  game:/, 1)[0].split(/\n  session-engine:/)[1];
  assert.ok(service);
  assert.doesNotMatch(service, /\n\s+ports:/);
  assert.match(service, /read_only:\s*true/);
  assert.match(service, /cap_drop:\s*\[ALL\]/);
  assert.match(service, /no-new-privileges:true/);
  assert.match(dockerfile, /USER sessionlab/);
  assert.match(engine, /set\(body\) != \{"operation", "selection"\}/);
  assert.match(engine, /SLEEP_SECONDS = 0\.05/);
  assert.match(engine, /def _attacker_serializer\(recovered_secret: str\)/);
  assert.match(engine, /attacker_app\.secret_key = recovered_secret/);
  assert.match(engine, /self\._callback\(forged, STATE, server_serializer\)/);
  assert.doesNotMatch(engine, /import subprocess|import socket|os\.system|os\.popen|subprocess\.|socket\.|requests\.|urllib\./);
  assert.doesNotMatch(engine, /[a-f0-9]{64}/i);
});

test('public assets contain no generated proof or worker token', async () => {
  const files = ['src/public/play.html', 'src/public/screen.html', 'src/public/play.js', 'src/public/screen.js', 'src/public/app.css'];
  const content = (await Promise.all(files.map((file) => readFile(new URL(file, root), 'utf8')))).join('\n');
  assert.doesNotMatch(content, /proof_[a-f0-9]{48}/);
  assert.doesNotMatch(content, /[a-f0-9]{64}/);
  assert.doesNotMatch(content, /innerHTML\s*=/);
  assert.doesNotMatch(content, /\.style\.[A-Za-z]+\s*=/, 'inline styles would be blocked by the public CSP');
});

test('verification audits both stdout and stderr logs', async () => {
  const booth = await readFile(new URL('tools/booth.mjs', root), 'utf8');
  assert.match(booth, /logResult\.stdout/);
  assert.match(booth, /logResult\.stderr/);
  for (const name of [
    'SESSION_ENGINE_TOKEN', 'SESSION_LAB_CLIENT_SECRET', 'SESSION_SIGNING_SECRET', 'SESSION_PROOF',
  ]) assert.match(booth, new RegExp(name));
});
