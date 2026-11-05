import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { ProxyPanicAdjudicator } from '../src/adjudicator.mjs';

async function mockEngine(status, body) {
  const server = http.createServer((request, response) => {
    request.resume();
    const payload = Buffer.from(JSON.stringify(body));
    response.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': String(payload.length),
    });
    response.end(payload);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

test('engine execution failures cannot become trusted blocked verdicts', async (context) => {
  const engine = await mockEngine(500, {
    routeAccepted: true,
    bootstrapTriggered: false,
    proofReached: false,
    blocked: false,
    reason: 'bootstrap_execution_failed',
  });
  context.after(() => new Promise((resolve) => engine.close(resolve)));
  const adjudicator = new ProxyPanicAdjudicator({
    host: '127.0.0.1',
    patchedHost: '127.0.0.1',
    vulnerablePort: engine.address().port,
    patchedPort: engine.address().port,
    token: 'a'.repeat(64),
  });
  await assert.rejects(adjudicator.runBaseline({
    prefix: 'command_substitution', normalization: 'encoded_parent', sink: 'cold_start',
  }), /engine worker unavailable/);
});

test('malformed worker verdicts are rejected instead of coerced to attack failure', async (context) => {
  const engine = await mockEngine(400, { error: 'invalid bootstrap request' });
  context.after(() => new Promise((resolve) => engine.close(resolve)));
  const adjudicator = new ProxyPanicAdjudicator({
    host: '127.0.0.1',
    patchedHost: '127.0.0.1',
    vulnerablePort: engine.address().port,
    patchedPort: engine.address().port,
    token: 'b'.repeat(64),
  });
  await assert.rejects(adjudicator.runBaseline({
    prefix: 'command_substitution', normalization: 'encoded_parent', sink: 'cold_start',
  }), /invalid engine verdict/);
});
