import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  CIRCUITS, CREWS, DRIVERS, publicRaceCatalog,
} from '../src/race/catalog.mjs';

const root = new URL('../', import.meta.url);

test('compose keeps one hardened service and the production timing default', async () => {
  const compose = await readFile(new URL('compose.yaml', root), 'utf8');
  const servicesBlock = compose.match(/^services:\s*\n([\s\S]*?)(?=^networks:)/m)?.[1] ?? '';
  const services = [...servicesBlock.matchAll(/^  ([a-z0-9-]+):\s*$/gmi)].map((match) => match[1]);

  assert.deepEqual(services, ['game']);
  assert.equal((compose.match(/^\s+ports:\s*$/gm) ?? []).length, 1);
  assert.match(compose, /^\s+user:\s*node\s*$/m);
  assert.match(compose, /^\s+read_only:\s*true\s*$/m);
  assert.match(compose, /^\s+cap_drop:\s*\[ALL\]\s*$/m);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /^\s+pids_limit:\s*\d+\s*$/m);
  assert.match(compose, /\/tmp:size=\d+m,noexec,nosuid,nodev/);
  for (const [name, value] of [
    ['MATCH_MIN_WAIT_MS', 30_000],
    ['MATCH_MAX_WAIT_MS', 45_000],
    ['GRID_COUNTDOWN_MS', 5_000],
    ['ENCOUNTER_DURATION_MS', 18_000],
    ['MIN_ENCOUNTER_MS', 4_000],
    ['RESULT_DURATION_MS', 25_000],
  ]) assert.match(compose, new RegExp(`${name}:\\s*\\$\\{${name}:-${value}\\}`));
  assert.match(compose, /MAX_PLAYERS:\s*\$\{MAX_PLAYERS:-48\}/);
  assert.match(compose, /NITRO_GRID_SEED_SECRET:\s*\$\{NITRO_GRID_SEED_SECRET:\?/);
  assert.doesNotMatch(compose, /docker\.sock|privileged:\s*true|network_mode:\s*host/);
});

test('production image contains only the unprivileged Node game runtime', async () => {
  const dockerfile = await readFile(new URL('Dockerfile', root), 'utf8');
  assert.match(dockerfile, /^FROM node:22-alpine$/m);
  assert.match(dockerfile, /npm ci --omit=dev --ignore-scripts/);
  assert.match(dockerfile, /^COPY src \.\/src$/m);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /^CMD \["node", "src\/server\.mjs"\]$/m);
  assert.doesNotMatch(dockerfile, /COPY\s+(?:engine|tests|tools)|python|pip|curl|wget/);
  assert.doesNotMatch(dockerfile, /NITRO_GRID_SEED_SECRET|[a-f0-9]{64}/i);
});

test('catalog exposes three server-selected two-lap circuits with bounded modeled speed', () => {
  const catalog = publicRaceCatalog();
  assert.equal(CIRCUITS.length, 3);
  assert.equal(catalog.circuits.length, 3);
  assert.equal(Object.hasOwn(catalog, 'tracks'), false, 'retired client track catalog leaked');
  assert.equal(catalog.match.totalLaps, 2);
  assert.equal(catalog.match.totalEncounters, 10);
  assert.equal(catalog.match.seats, 4);
  assert.equal(catalog.match.minWaitMs, 30_000);
  assert.equal(catalog.match.maxWaitMs, 45_000);

  for (const circuit of CIRCUITS) {
    assert.match(circuit.path, /^M\d/);
    assert.equal(circuit.laps, 2);
    assert.ok(circuit.minSpeedKph >= 0 && circuit.minSpeedKph < circuit.maxSpeedKph);
    assert.ok(circuit.maxSpeedKph <= 360, `${circuit.id} modeled speed is unbounded`);
    assert.equal(circuit.speedRangeKph.min, circuit.minSpeedKph);
    assert.equal(circuit.speedRangeKph.max, circuit.maxSpeedKph);
    assert.ok(circuit.speedZones.every((speed) => speed >= circuit.minSpeedKph && speed <= circuit.maxSpeedKph));
    assert.match(circuit.disclaimer, /게임 모델|실제.*텔레메트리가 아닙니다/);
  }
});

test('catalog exposes four crews, eight compatible drivers, and local booth media', async () => {
  assert.equal(CREWS.length, 4);
  assert.equal(DRIVERS.length, 8);
  assert.equal(new Set(CREWS.map(({ id }) => id)).size, 4);
  assert.equal(new Set(DRIVERS.map(({ id }) => id)).size, 8);

  const server = await readFile(new URL('src/server.mjs', root), 'utf8');
  for (const crew of CREWS) {
    assert.match(crew.asset, /^\/assets\/cars\/[a-z0-9-]+\.svg$/);
    assert.equal(DRIVERS.filter(({ crewId }) => crewId === crew.id).length, 2);
    await access(new URL(`src/public/${crew.asset.slice(1)}`, root));
    assert.ok(server.includes(`'${crew.asset}'`), `server does not publish ${crew.asset}`);
  }
  for (const driver of DRIVERS) {
    assert.ok(CREWS.some(({ id }) => id === driver.crewId));
    assert.match(driver.media, /^\/assets\/driver-panels\/[a-z0-9-]+\.webp$/);
    assert.match(driver.sourceUrl, /^https:\/\//);
    await access(new URL(`src/public/${driver.media.slice(1)}`, root));
    assert.ok(server.includes(`'${driver.media}'`), `server does not publish ${driver.media}`);
  }
});

test('public code is CSP-safe, uses Overtake Mode, and cannot regress to DRS', async () => {
  const publicFiles = [
    'src/public/play.html',
    'src/public/screen.html',
    'src/public/play.js',
    'src/public/screen.js',
    'src/public/app.css',
  ];
  const [server, ...sources] = await Promise.all([
    readFile(new URL('src/server.mjs', root), 'utf8'),
    ...publicFiles.map((file) => readFile(new URL(file, root), 'utf8')),
  ]);
  const content = sources.join('\n');

  assert.match(server, /default-src 'self'/);
  assert.match(server, /style-src 'self'/);
  assert.match(server, /script-src 'self'/);
  assert.match(server, /object-src 'none'/);
  assert.doesNotMatch(content, /[a-f0-9]{64}/i);
  assert.doesNotMatch(content, /\b(?:innerHTML|outerHTML)\s*=/);
  assert.doesNotMatch(content, /insertAdjacentHTML|document\.write\s*\(|\beval\s*\(|new\s+Function\s*\(/);
  assert.doesNotMatch(content, /\.style\.[A-Za-z_$][\w$]*\s*=/, 'inline styles would be blocked by the public CSP');
  assert.doesNotMatch(content, /\bdrs\b/i, '2026 experience must call the feature Overtake Mode');
  assert.match(content, /Overtake Mode/i);
  assert.match(content, /nitro-grid-player-token/);
  assert.match(content, /prefers-reduced-motion:\s*reduce/);
});

test('public UI declares all stable mobile and screen test surfaces', async () => {
  const [play, screen] = await Promise.all([
    readFile(new URL('src/public/play.js', root), 'utf8'),
    readFile(new URL('src/public/screen.js', root), 'utf8'),
  ]);
  for (const name of ['garage', 'matching', 'grid', 'racing', 'feedback', 'result']) {
    assert.match(play, new RegExp(`['\"\\x60]${name}['\"\\x60]`));
  }
  for (const testId of [
    'match-grid', 'track-map', 'leaderboard', 'telemetry', 'encounter-card',
    'feedback-card', 'result-review',
  ]) assert.match(play, new RegExp(testId));
  assert.match(screen, /screen-board/);
});

test('HTTP surface omits retired preview, exploit engine, and client track selection', async () => {
  const [server, game] = await Promise.all([
    readFile(new URL('src/server.mjs', root), 'utf8'),
    readFile(new URL('src/game.mjs', root), 'utf8'),
  ]);
  assert.doesNotMatch(server, /\/api\/preview|\/api\/(?:engine|adjudicate|scenario)/);
  assert.doesNotMatch(game, /\bpreview\s*\(|adjudicator|scenarioId|attackFlow/);
  assert.doesNotMatch(server, /body\.trackId|body\.circuitId/);
});

test('booth verification uses scoped cleanup and audits the seed in both log streams', async () => {
  const booth = await readFile(new URL('tools/booth.mjs', root), 'utf8');
  assert.match(booth, /randomBytes\(32\)\.toString\('hex'\)/);
  assert.match(booth, /open\(path, 'wx', 0o600\)/);
  for (const value of ['30_000', '45_000', '5_000', '18_000', '4_000', '25_000']) {
    assert.match(booth, new RegExp(`productionTiming[\\s\\S]*?${value}`));
  }
  for (const value of ['300', '450', '100', '75']) {
    assert.match(booth, new RegExp(`verificationTiming[\\s\\S]*?${value}`));
  }
  assert.match(booth, /tests\/live-contract\.mjs/);
  assert.match(booth, /log[sR]*Result\.stdout/);
  assert.match(booth, /log[sR]*Result\.stderr/);
  assert.match(booth, /logs\.includes\(values\.NITRO_GRID_SEED_SECRET\)/);
  assert.match(booth, /\['down', '--remove-orphans'\]/);
  assert.doesNotMatch(booth, /docker\s+system\s+prune|docker\s+container\s+prune|docker\s+volume\s+prune/);
});
