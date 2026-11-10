import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { CREWS, DRIVERS } from '../src/race/catalog.mjs';

const root = new URL('../', import.meta.url);

test('compose publishes one hardened game service with a 300 second production round', async () => {
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
  assert.match(compose, /ROUND_DURATION_MS:\s*\$\{ROUND_DURATION_MS:-300000\}/);
  assert.match(compose, /NITRO_GRID_SEED_SECRET:\s*\$\{NITRO_GRID_SEED_SECRET:\?/);
  assert.match(compose, /PUBLIC_BASE_URL:/);
  assert.doesNotMatch(compose, /docker\.sock|privileged:\s*true|network_mode:\s*host/);
  assert.doesNotMatch(compose, /(?:gateway|worker|adjudicator|session-engine|session-lab|backplane):/);
  assert.doesNotMatch(compose, /(?:ENGINE|WORKER|SESSION_ENGINE|SESSION_SIGNING|PROOF)_TOKEN/);
});

test('production image contains only the Node game runtime and runs unprivileged', async () => {
  const dockerfile = await readFile(new URL('Dockerfile', root), 'utf8');
  assert.match(dockerfile, /^FROM node:22-alpine$/m);
  assert.match(dockerfile, /npm ci --omit=dev --ignore-scripts/);
  assert.match(dockerfile, /^COPY src \.\/src$/m);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /^CMD \["node", "src\/server\.mjs"\]$/m);
  assert.doesNotMatch(dockerfile, /COPY\s+(?:engine|tests|tools)|python|pip|curl|wget/);
  assert.doesNotMatch(dockerfile, /NITRO_GRID_SEED_SECRET|[a-f0-9]{64}/i);
});

test('catalog exposes four crews, eight compatible drivers, and only local booth media', async () => {
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

test('public rendering remains CSP-safe and cannot contain a generated race secret', async () => {
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
  assert.doesNotMatch(content, /breach5-player-token|proof_[a-f0-9]+|session_proof_/i);
  assert.match(content, /nitro-grid-player-token/);
});

test('HTTP contract omits the retired preview and exploit-engine surfaces', async () => {
  const [server, game] = await Promise.all([
    readFile(new URL('src/server.mjs', root), 'utf8'),
    readFile(new URL('src/game.mjs', root), 'utf8'),
  ]);
  assert.doesNotMatch(server, /\/api\/preview|\/api\/(?:engine|adjudicate|scenario)/);
  assert.doesNotMatch(game, /\bpreview\s*\(|adjudicator|scenarioId|attackFlow/);
});

test('booth verification uses scoped cleanup and audits the seed value in both log streams', async () => {
  const booth = await readFile(new URL('tools/booth.mjs', root), 'utf8');

  assert.match(booth, /randomBytes\(32\)\.toString\('hex'\)/);
  assert.match(booth, /open\(path, 'wx', 0o600\)/);
  assert.match(booth, /roundMs:\s*300_000/);
  assert.match(booth, /roundMs:\s*30_000/);
  assert.match(booth, /log[sR]*Result\.stdout/);
  assert.match(booth, /log[sR]*Result\.stderr/);
  assert.match(booth, /logs\.includes\(values\.NITRO_GRID_SEED_SECRET\)/);
  assert.match(booth, /\['down', '--remove-orphans'\]/);
  assert.match(booth, /composeArgs\(project, envFile, 'port', 'game', '3000'\)/);
  assert.doesNotMatch(booth, /docker\s+system\s+prune|docker\s+container\s+prune|docker\s+volume\s+prune/);
  assert.doesNotMatch(booth, /console\.(?:log|error)\([^)]*NITRO_GRID_SEED_SECRET/);
});
