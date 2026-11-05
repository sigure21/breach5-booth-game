import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { link, mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import http from 'node:http';
import { isIP } from 'node:net';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtimeDir = join(root, '.runtime');
const composeFile = join(root, 'compose.yaml');
const boothEnv = join(runtimeDir, 'booth.env');
const defaultProject = 'breach5_booth';
const VERIFY_HEARTBEAT_STALE_MS = 60_000;
const ATOMIC_TEMP_STALE_MS = 60 * 60_000;
const COMPOSE_OVERRIDE_KEYS = [
  'ENGINE_TOKEN', 'WORKER_TOKEN', 'BREACH5_PROOF', 'ROUND_DURATION_MS', 'MAX_PLAYERS',
  'BREACH5_BIND', 'BREACH5_PORT', 'BREACH5_IMAGE', 'PUBLIC_BASE_URL',
];
const COMPOSE_OVERRIDE_SET = new Set(COMPOSE_OVERRIDE_KEYS);

function run(command, args, { capture = false, allowFailure = false, env = process.env } = {}) {
  const commandEnv = { ...env };
  if (command === 'docker' && args[0] === 'compose') {
    for (const key of Object.keys(commandEnv)) {
      const normalized = key.toUpperCase();
      if (COMPOSE_OVERRIDE_SET.has(normalized) || normalized.startsWith('COMPOSE_')) delete commandEnv[key];
    }
  }
  const result = spawnSync(command, args, {
    cwd: root,
    env: commandEnv,
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
    const child = spawn(command, args, {
      cwd: root,
      env: { ...env },
      stdio: 'inherit',
      windowsHide: true,
    });
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

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function startManifestHeartbeat(path) {
  const script = [
    "const { utimesSync } = require('node:fs');",
    'const path = process.argv[1];',
    "const beat = () => { try { const now = new Date(); utimesSync(path, now, now); } catch { process.exit(2); } };",
    "beat(); process.stdout.write('ready\\n');",
    'const timer = setInterval(beat, 15_000);',
    'process.stdin.resume();',
    "process.stdin.on('end', () => { clearInterval(timer); process.exit(0); });",
  ].join(' ');
  const child = spawn(process.execPath, ['-e', script, path], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true,
  });
  await new Promise((resolve, reject) => {
    let ready = false;
    child.once('error', reject);
    child.once('exit', (code) => {
      if (!ready) reject(new Error(`verification heartbeat exited before ready with status ${code}`));
    });
    child.stdout.once('data', (chunk) => {
      if (!chunk.toString('utf8').includes('ready')) return reject(new Error('verification heartbeat returned an invalid handshake'));
      ready = true;
      resolve();
    });
  });
  return async () => {
    if (child.exitCode !== null) return;
    child.stdin.end();
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        child.kill();
        resolve();
      }, 2_000);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  };
}

async function createEnv(path, { port, roundMs, verifyProject = null, publicBaseUrl = null }) {
  await mkdir(runtimeDir, { recursive: true });
  const createdAt = Date.now();
  const text = [
    `ENGINE_TOKEN=${randomBytes(32).toString('hex')}`,
    `WORKER_TOKEN=${randomBytes(32).toString('hex')}`,
    `BREACH5_PROOF=proof_${randomBytes(24).toString('hex')}`,
    `ROUND_DURATION_MS=${roundMs}`,
    'MAX_PLAYERS=16',
    'BREACH5_BIND=127.0.0.1',
    `BREACH5_PORT=${port}`,
    `BREACH5_IMAGE=${verifyProject ? `breach5-booth-game:${verifyProject}` : 'breach5-booth-game:local'}`,
    `PUBLIC_BASE_URL=${publicBaseUrl ?? (port === 0 ? 'http://127.0.0.1' : `http://127.0.0.1:${port}`)}`,
    ...(verifyProject ? [
      `BREACH5_VERIFY_PROJECT=${verifyProject}`,
      `BREACH5_VERIFY_CREATED_AT=${createdAt}`,
      `BREACH5_VERIFY_OWNER_PID=${process.pid}`,
    ] : []),
    '',
  ].join('\n');
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  let handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(text, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await link(temporary, path);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await rm(temporary, { force: true });
  }
  return path;
}

async function ensureBoothEnv() {
  if (!(await exists(boothEnv))) {
    try {
      await createEnv(boothEnv, { port: 18090, roundMs: 300_000 });
    } catch (error) {
      if (error?.code !== 'EEXIST' || !(await exists(boothEnv))) throw error;
    }
  }
  return boothEnv;
}

async function readEnvFile(path) {
  const values = {};
  for (const line of (await readFile(path, 'utf8')).split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return values;
}

async function runtimeAddresses(envFile) {
  const values = await readEnvFile(envFile);
  const port = Number.parseInt(values.BREACH5_PORT ?? '', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('BREACH5_PORT in the runtime env must be a valid TCP port');
  const bind = values.BREACH5_BIND ?? '127.0.0.1';
  if (isIP(bind) === 0) throw new Error('BREACH5_BIND must be an IP address');
  const readinessHost = bind === '0.0.0.0' ? '127.0.0.1' : bind === '::' ? '::1' : bind;
  const readinessAuthority = isIP(readinessHost) === 6 ? `[${readinessHost}]` : readinessHost;
  let base;
  try {
    base = new URL(values.PUBLIC_BASE_URL ?? '');
  } catch {
    throw new Error('PUBLIC_BASE_URL in the runtime env must be an absolute URL');
  }
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('PUBLIC_BASE_URL must use http or https');
  if (base.username || base.password) throw new Error('PUBLIC_BASE_URL must not contain credentials');
  return {
    readyUrl: `http://${readinessAuthority}:${port}/readyz`,
    participantUrl: new URL('/play', base).toString(),
    screenUrl: new URL('/screen', base).toString(),
  };
}

function checkNode() {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (major < 22) throw new Error(`Node.js 22+ is required; found ${process.versions.node}`);
}

function checkDocker() {
  run('docker', ['version', '--format', '{{.Server.Version}}'], { capture: true });
  run('docker', ['compose', 'version'], { capture: true });
}

async function configCheck(envFile, project = defaultProject) {
  run('docker', composeArgs(project, envFile, 'config', '--quiet'));
}

function offlineCheck() {
  run(process.execPath, ['tools/check.mjs']);
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
  const result = run('docker', composeArgs(project, envFile, ...args), {
    allowFailure: true,
  });
  return result.status === 0;
}

async function createVerificationProxy() {
  let upstream = null;
  const server = http.createServer((request, response) => {
    if (!upstream) {
      const body = Buffer.from('upstream not ready\n');
      response.writeHead(503, { 'Content-Type': 'text/plain', 'Content-Length': String(body.length), Connection: 'close' });
      return response.end(body);
    }
    const target = new URL(request.url ?? '/', upstream);
    const headers = { ...request.headers, host: target.host, connection: 'close' };
    delete headers['proxy-connection'];
    const outgoing = http.request(target, { method: request.method, headers }, (incoming) => {
      response.writeHead(incoming.statusCode ?? 502, { ...incoming.headers, Connection: 'close' });
      incoming.pipe(response);
    });
    outgoing.on('error', () => {
      if (!response.headersSent) response.writeHead(502, { 'Content-Type': 'text/plain', Connection: 'close' });
      response.end('upstream unavailable\n');
    });
    request.pipe(outgoing);
  });
  server.maxHeadersCount = 32;
  server.headersTimeout = 8_000;
  server.requestTimeout = 10_000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('could not create the loopback verification proxy');
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    setUpstream(value) { upstream = new URL(value); },
    async close() { await new Promise((resolve) => server.close(resolve)); },
  };
}

async function recoverStaleVerifications() {
  const entries = await readdir(runtimeDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const temporary = /^verify-.*\.env\..*\.tmp$/.test(entry.name);
    const match = entry.name.match(/^verify-(breach5_verify_[0-9]+_[a-f0-9]{8})(?:\.recover-([0-9]+)-([0-9]+)-[a-f0-9]{8})?\.env$/);
    if (!temporary && !match) continue;
    const path = join(runtimeDir, entry.name);
    const metadata = await stat(path).catch(() => null);
    if (!metadata) continue;
    const ageMs = Date.now() - metadata.mtimeMs;
    if (temporary) {
      if (ageMs >= ATOMIC_TEMP_STALE_MS) await rm(path, { force: true });
      continue;
    }
    const project = match[1];
    const claimantPid = Number.parseInt(match[2] ?? '', 10);
    const claimStartedAt = Number.parseInt(match[3] ?? '', 10);
    if (Number.isInteger(claimantPid) && Number.isInteger(claimStartedAt)
      && processIsAlive(claimantPid)
      && (Date.now() - claimStartedAt < VERIFY_HEARTBEAT_STALE_MS || ageMs < VERIFY_HEARTBEAT_STALE_MS)) {
      continue;
    }
    const values = await readEnvFile(path).catch(() => ({}));
    const ownerPid = Number.parseInt(values.BREACH5_VERIFY_OWNER_PID ?? '', 10);
    const createdAt = Number.parseInt(values.BREACH5_VERIFY_CREATED_AT ?? '', 10);
    if (values.BREACH5_VERIFY_PROJECT !== project
      || values.BREACH5_IMAGE !== `breach5-booth-game:${project}`
      || !Number.isInteger(ownerPid) || ownerPid < 1
      || !Number.isInteger(createdAt) || createdAt < 1) {
      console.warn(`Preserving untrusted stale verification manifest: ${path}`);
      continue;
    }
    if (processIsAlive(ownerPid) && ageMs < VERIFY_HEARTBEAT_STALE_MS) continue;
    const claimed = join(runtimeDir, `verify-${project}.recover-${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}.env`);
    try {
      await rename(path, claimed);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    let stopClaimHeartbeat;
    try {
      stopClaimHeartbeat = await startManifestHeartbeat(claimed);
    } catch (error) {
      await rename(claimed, path).catch(() => {});
      throw error;
    }
    console.log(`Recovering stale verification project ${project}...`);
    const cleaned = cleanupProject(project, claimed, { removeImages: true });
    await stopClaimHeartbeat();
    if (!cleaned) {
      const original = join(runtimeDir, `verify-${project}.env`);
      await rename(claimed, original).catch(() => {});
      throw new Error('stale verification cleanup failed; preserved its manifest for recovery');
    }
    await rm(claimed, { force: true });
  }
}

function publishedTarget(project, envFile) {
  const output = run('docker', composeArgs(project, envFile, 'port', 'game', '3000'), { capture: true }).stdout?.trim() ?? '';
  const match = output.match(/:(\d+)$/);
  const port = Number.parseInt(match?.[1] ?? '', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`could not resolve the verification port from: ${output}`);
  return `http://127.0.0.1:${port}`;
}

async function up() {
  checkNode();
  checkDocker();
  offlineCheck();
  const envFile = await ensureBoothEnv();
  await configCheck(envFile);
  const addresses = await runtimeAddresses(envFile);
  try {
    run('docker', composeArgs(defaultProject, envFile, 'up', '--detach', '--build', '--wait'));
    await waitHttp(addresses.readyUrl);
  } catch (error) {
    run('docker', composeArgs(defaultProject, envFile, 'logs', '--no-color', '--tail', '120'), { allowFailure: true });
    if (!cleanupProject(defaultProject, envFile)) {
      throw new Error(`${error.message}; scoped cleanup also failed, so ${envFile} was preserved`);
    }
    throw error;
  }
  console.log('\nBREACH//5 is ready.');
  console.log(`Participant: ${addresses.participantUrl}`);
  console.log(`Screen:      ${addresses.screenUrl}`);
  console.log('Mobile devices need a reviewed PUBLIC_BASE_URL and bind address; loopback is the safe default.');
}

async function down() {
  if (!(await exists(boothEnv))) {
    console.log('BREACH//5 has no local runtime configuration.');
    return;
  }
  run('docker', composeArgs(defaultProject, boothEnv, 'down', '--remove-orphans'));
}

async function verify() {
  checkNode();
  checkDocker();
  offlineCheck();
  await mkdir(runtimeDir, { recursive: true });
  await recoverStaleVerifications();
  const project = `breach5_verify_${process.pid}_${randomBytes(4).toString('hex')}`;
  const verifyEnv = join(runtimeDir, `verify-${project}.env`);
  const proxy = await createVerificationProxy();
  try {
    await createEnv(verifyEnv, {
      port: 0,
      roundMs: 30_000,
      verifyProject: project,
      publicBaseUrl: proxy.origin,
    });
  } catch (error) {
    await proxy.close();
    throw error;
  }
  let failure = null;
  let stopHeartbeat = null;
  try {
    stopHeartbeat = await startManifestHeartbeat(verifyEnv);
    await configCheck(verifyEnv, project);
    run('docker', composeArgs(project, verifyEnv, 'up', '--detach', '--build', '--wait'));
    proxy.setUpstream(publishedTarget(project, verifyEnv));
    const targetUrl = proxy.origin;
    await waitHttp(`${targetUrl}/readyz`);
    const secrets = Object.fromEntries((await readFile(verifyEnv, 'utf8'))
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.split(/=(.*)/s).slice(0, 2)));
    await runAsync(process.execPath, ['tests/live-contract.mjs'], {
      env: {
        ...process.env,
        TARGET_URL: targetUrl,
        AUDIT_ENGINE_TOKEN: secrets.ENGINE_TOKEN,
        AUDIT_WORKER_TOKEN: secrets.WORKER_TOKEN,
        AUDIT_BREACH5_PROOF: secrets.BREACH5_PROOF,
      },
    });

    const logResult = run('docker', composeArgs(project, verifyEnv, 'logs', '--no-color'), { capture: true });
    const logs = `${logResult.stdout ?? ''}\n${logResult.stderr ?? ''}`;
    for (const key of ['ENGINE_TOKEN', 'WORKER_TOKEN', 'BREACH5_PROOF']) {
      if (secrets[key] && logs.includes(secrets[key])) throw new Error(`${key} leaked into container logs`);
    }
    console.log('BREACH//5 live contract and log audit passed.');
  } catch (error) {
    failure = error;
  } finally {
    await proxy.close();
    if (stopHeartbeat) await stopHeartbeat();
    const cleaned = cleanupProject(project, verifyEnv, { removeImages: true });
    if (cleaned) {
      await rm(verifyEnv, { force: true });
    } else {
      const cleanupError = new Error(`scoped cleanup failed; preserved ${verifyEnv} for recovery`);
      failure = failure ? new Error(`${failure.message}; ${cleanupError.message}`) : cleanupError;
    }
  }
  if (failure) throw failure;
}

async function doctor() {
  checkNode();
  checkDocker();
  const envFile = await ensureBoothEnv();
  await configCheck(envFile);
  console.log(`Node.js ${process.versions.node}`);
  console.log('Docker daemon reachable');
  console.log('Compose configuration valid');
  console.log(`Project directory: ${basename(root)}`);
}

async function status() {
  if (!(await exists(boothEnv))) return console.log('BREACH//5 has not been initialized.');
  run('docker', composeArgs(defaultProject, boothEnv, 'ps'));
}

async function logs() {
  if (!(await exists(boothEnv))) return console.log('BREACH//5 has not been initialized.');
  run('docker', composeArgs(defaultProject, boothEnv, 'logs', '--no-color', '--tail', '200'));
}

async function reset() {
  await down();
  if (await exists(boothEnv)) await rm(boothEnv, { force: true });
  await up();
}

const command = process.argv[2] ?? 'help';
const commands = { up, verify, down, reset, doctor, status, logs, check: async () => offlineCheck() };
if (command === 'help' || !commands[command]) {
  console.log('Usage: node tools/booth.mjs <up|verify|status|logs|down|reset|doctor|check>');
  process.exit(command === 'help' ? 0 : 2);
}

commands[command]().catch((error) => {
  console.error(`BREACH//5 ${command} failed: ${error.message}`);
  process.exit(1);
});
