import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import http from 'node:http';
import { isIP } from 'node:net';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtimeDir = join(root, '.runtime');
const composeFile = join(root, 'compose.yaml');
const boothEnv = join(runtimeDir, 'booth.env');
const defaultProject = 'breach5_nitro_grid';
const overrideKeys = new Set([
  'NITRO_GRID_SEED_SECRET', 'ROUND_DURATION_MS',
  'MATCH_MIN_WAIT_MS', 'MATCH_MAX_WAIT_MS', 'GRID_COUNTDOWN_MS',
  'ENCOUNTER_DURATION_MS', 'MIN_ENCOUNTER_MS', 'RESULT_DURATION_MS', 'MAX_PLAYERS',
  'BREACH5_BIND', 'BREACH5_PORT', 'BREACH5_IMAGE', 'PUBLIC_BASE_URL',
]);

const productionTiming = Object.freeze({
  matchMinWaitMs: 30_000,
  matchMaxWaitMs: 45_000,
  gridCountdownMs: 5_000,
  encounterDurationMs: 15_000,
  minEncounterMs: 4_000,
  resultDurationMs: 25_000,
});

const verificationTiming = Object.freeze({
  matchMinWaitMs: 300,
  matchMaxWaitMs: 450,
  gridCountdownMs: 100,
  encounterDurationMs: 300,
  minEncounterMs: 75,
  resultDurationMs: 300,
});

function cleanComposeEnv(source = process.env) {
  const env = { ...source };
  for (const key of Object.keys(env)) {
    const normalized = key.toUpperCase();
    if (overrideKeys.has(normalized) || normalized.startsWith('COMPOSE_')) delete env[key];
  }
  return env;
}

function run(command, args, { capture = false, allowFailure = false, env = process.env } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: command === 'docker' && args[0] === 'compose' ? cleanComposeEnv(env) : { ...env },
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    windowsHide: true,
  });
  if (!allowFailure && result.status !== 0) {
    if (capture) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    throw new Error(`${command} exited with status ${result.status ?? 'unknown'}`);
  }
  return result;
}

function runAsync(command, args, { env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: { ...env }, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with status ${code ?? signal ?? 'unknown'}`));
    });
  });
}

function composeArgs(project, envFile, ...args) {
  return ['compose', '--project-name', project, '--env-file', envFile, '-f', composeFile, ...args];
}

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function createEnv(path, { port, timing, image, publicBaseUrl }) {
  await mkdir(runtimeDir, { recursive: true });
  const text = [
    `NITRO_GRID_SEED_SECRET=${randomBytes(32).toString('hex')}`,
    `MATCH_MIN_WAIT_MS=${timing.matchMinWaitMs}`,
    `MATCH_MAX_WAIT_MS=${timing.matchMaxWaitMs}`,
    `GRID_COUNTDOWN_MS=${timing.gridCountdownMs}`,
    `ENCOUNTER_DURATION_MS=${timing.encounterDurationMs}`,
    `MIN_ENCOUNTER_MS=${timing.minEncounterMs}`,
    `RESULT_DURATION_MS=${timing.resultDurationMs}`,
    'MAX_PLAYERS=48',
    'BREACH5_BIND=127.0.0.1',
    `BREACH5_PORT=${port}`,
    `BREACH5_IMAGE=${image}`,
    `PUBLIC_BASE_URL=${publicBaseUrl}`,
    '',
  ].join('\n');
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(text, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  return path;
}

async function readEnv(path) {
  const values = {};
  for (const line of (await readFile(path, 'utf8')).split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator > 0) values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return values;
}

async function ensureBoothEnv() {
  if (await exists(boothEnv)) {
    const values = await readEnv(boothEnv).catch(() => ({}));
    const valid = /^[a-f0-9]{64}$/i.test(values.NITRO_GRID_SEED_SECRET ?? '')
      && values.MATCH_MIN_WAIT_MS === String(productionTiming.matchMinWaitMs)
      && values.MATCH_MAX_WAIT_MS === String(productionTiming.matchMaxWaitMs)
      && values.GRID_COUNTDOWN_MS === String(productionTiming.gridCountdownMs)
      && values.ENCOUNTER_DURATION_MS === String(productionTiming.encounterDurationMs)
      && values.MIN_ENCOUNTER_MS === String(productionTiming.minEncounterMs)
      && values.RESULT_DURATION_MS === String(productionTiming.resultDurationMs)
      && values.BREACH5_PORT === '18090';
    if (!valid) await rm(boothEnv, { force: true });
  }
  if (!(await exists(boothEnv))) {
    await createEnv(boothEnv, {
      port: 18090,
      timing: productionTiming,
      image: 'breach5-nitro-grid:local',
      publicBaseUrl: 'http://127.0.0.1:18090',
    });
  }
  return boothEnv;
}

function checkNode() {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (major < 22) throw new Error(`Node.js 22+ is required; found ${process.versions.node}`);
}

function checkDocker() {
  run('docker', ['version', '--format', '{{.Server.Version}}'], { capture: true });
  run('docker', ['compose', 'version'], { capture: true });
}

function offlineCheck() {
  run(process.execPath, ['tools/check.mjs']);
}

function configCheck(envFile, project = defaultProject) {
  run('docker', composeArgs(project, envFile, 'config', '--quiet'));
}

async function runtimeAddresses(envFile) {
  const values = await readEnv(envFile);
  const port = Number.parseInt(values.BREACH5_PORT ?? '', 10);
  const bind = values.BREACH5_BIND ?? '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('BREACH5_PORT must be a valid TCP port');
  if (isIP(bind) === 0) throw new Error('BREACH5_BIND must be an IP address');
  const host = bind === '0.0.0.0' ? '127.0.0.1' : bind === '::' ? '::1' : bind;
  const authority = isIP(host) === 6 ? `[${host}]` : host;
  const base = new URL(values.PUBLIC_BASE_URL);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error('PUBLIC_BASE_URL must be a credential-free HTTP(S) URL');
  return {
    readyUrl: `http://${authority}:${port}/readyz`,
    participantUrl: new URL('/play', base).toString(),
    screenUrl: new URL('/screen', base).toString(),
  };
}

async function waitHttp(url, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`timed out waiting for ${url}`);
}

function cleanupProject(project, envFile, { removeImages = false } = {}) {
  const args = ['down', '--remove-orphans'];
  if (removeImages) args.push('--rmi', 'all');
  return run('docker', composeArgs(project, envFile, ...args), { allowFailure: true }).status === 0;
}

function publishedTarget(project, envFile) {
  const output = run('docker', composeArgs(project, envFile, 'port', 'game', '3000'), { capture: true }).stdout?.trim() ?? '';
  const match = output.match(/:(\d+)$/);
  const port = Number.parseInt(match?.[1] ?? '', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`could not resolve verification port from: ${output}`);
  return `http://127.0.0.1:${port}`;
}

async function createVerificationProxy() {
  let upstream = null;
  const server = http.createServer((request, response) => {
    if (!upstream) {
      response.writeHead(503, { Connection: 'close' });
      return response.end('upstream not ready\n');
    }
    const target = new URL(request.url ?? '/', upstream);
    const outgoing = http.request(target, {
      method: request.method,
      headers: { ...request.headers, host: target.host, connection: 'close' },
    }, (incoming) => {
      response.writeHead(incoming.statusCode ?? 502, { ...incoming.headers, Connection: 'close' });
      incoming.pipe(response);
    });
    outgoing.on('error', () => {
      if (!response.headersSent) response.writeHead(502, { Connection: 'close' });
      response.end('upstream unavailable\n');
    });
    request.pipe(outgoing);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('could not create verification proxy');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    setUpstream(value) { upstream = new URL(value); },
    async close() { await new Promise((resolve) => server.close(resolve)); },
  };
}

async function up() {
  checkNode();
  checkDocker();
  offlineCheck();
  const envFile = await ensureBoothEnv();
  configCheck(envFile);
  const addresses = await runtimeAddresses(envFile);
  try {
    run('docker', composeArgs(defaultProject, envFile, 'up', '--detach', '--build', '--wait'));
    await waitHttp(addresses.readyUrl);
  } catch (error) {
    run('docker', composeArgs(defaultProject, envFile, 'logs', '--no-color', '--tail', '120'), { allowFailure: true });
    cleanupProject(defaultProject, envFile);
    throw error;
  }
  console.log('\nBREACH//5: NITRO GRID is ready.');
  console.log(`Participant: ${addresses.participantUrl}`);
  console.log(`Screen:      ${addresses.screenUrl}`);
  console.log('Mobile devices require a reviewed bind address and PUBLIC_BASE_URL; loopback is the safe default.');
}

async function down() {
  if (!(await exists(boothEnv))) return console.log('NITRO GRID has no local runtime configuration.');
  cleanupProject(defaultProject, boothEnv);
}

async function verify() {
  checkNode();
  checkDocker();
  offlineCheck();
  await mkdir(runtimeDir, { recursive: true });
  const project = `nitro_grid_verify_${process.pid}_${randomBytes(4).toString('hex')}`;
  const envFile = join(runtimeDir, `${project}.env`);
  const proxy = await createVerificationProxy();
  await createEnv(envFile, {
    port: 0,
    timing: verificationTiming,
    image: `breach5-nitro-grid:${project}`,
    publicBaseUrl: proxy.origin,
  });
  let failure = null;
  try {
    configCheck(envFile, project);
    run('docker', composeArgs(project, envFile, 'up', '--detach', '--build', '--wait'));
    proxy.setUpstream(publishedTarget(project, envFile));
    await waitHttp(`${proxy.origin}/readyz`);
    await runAsync(process.execPath, ['tests/live-contract.mjs'], { env: { ...process.env, TARGET_URL: proxy.origin } });
    const values = await readEnv(envFile);
    const logsResult = run('docker', composeArgs(project, envFile, 'logs', '--no-color'), { capture: true });
    const logs = `${logsResult.stdout ?? ''}\n${logsResult.stderr ?? ''}`;
    if (logs.includes(values.NITRO_GRID_SEED_SECRET)) throw new Error('NITRO_GRID_SEED_SECRET leaked into container logs');
    console.log('NITRO GRID live contract and runtime-secret log audit passed.');
  } catch (error) {
    failure = error;
  } finally {
    await proxy.close();
    const cleaned = cleanupProject(project, envFile, { removeImages: true });
    if (cleaned) await rm(envFile, { force: true });
    else failure = new Error(`${failure?.message ?? 'verification failed'}; scoped cleanup failed and ${envFile} was preserved`);
  }
  if (failure) throw failure;
}

async function doctor() {
  checkNode();
  checkDocker();
  const envFile = await ensureBoothEnv();
  configCheck(envFile);
  console.log(`Node.js ${process.versions.node}`);
  console.log('Docker daemon reachable');
  console.log('Compose configuration valid');
  console.log(`Project directory: ${basename(root)}`);
}

async function status() {
  if (!(await exists(boothEnv))) return console.log('NITRO GRID has not been initialized.');
  run('docker', composeArgs(defaultProject, boothEnv, 'ps'));
}

async function logs() {
  if (!(await exists(boothEnv))) return console.log('NITRO GRID has not been initialized.');
  run('docker', composeArgs(defaultProject, boothEnv, 'logs', '--no-color', '--tail', '200'));
}

async function reset() {
  await down();
  await rm(boothEnv, { force: true });
  await up();
}

const command = process.argv[2] ?? 'help';
const commands = { up, verify, down, reset, doctor, status, logs, check: async () => offlineCheck() };
if (command === 'help' || !commands[command]) {
  console.log('Usage: node tools/booth.mjs <up|verify|status|logs|down|reset|doctor|check>');
  process.exit(command === 'help' ? 0 : 2);
}

commands[command]().catch((error) => {
  console.error(`NITRO GRID ${command} failed: ${error.message}`);
  process.exit(1);
});
