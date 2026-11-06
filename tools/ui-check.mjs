import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { createDeterministicRegistry } from '../src/adjudicator.mjs';
import { GameStore } from '../src/game.mjs';
import { getScenario } from '../src/scenarios/index.mjs';
import { createGameServer } from '../src/server.mjs';

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
const executablePath = candidates.find((path) => existsSync(path));

if (!executablePath) {
  console.log('UI layout check skipped: set CHROME_PATH to a Chromium-compatible browser.');
  process.exit(0);
}

let now = 0;
const adjudicator = createDeterministicRegistry();
const store = new GameStore({ now: () => now, adjudicators: adjudicator });
const server = await createGameServer({ store, adjudicator, publicBaseUrl: 'http://127.0.0.1:18090' });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;

async function api(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await response.json();
  if (!response.ok) throw new Error(`${path} ${response.status}: ${JSON.stringify(value)}`);
  return value;
}

function safeLabel(value) {
  return value.replaceAll(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 100);
}

async function assertNoNestedOverflow(page, label) {
  const issues = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const ignored = (element) => element.matches([
      '.ambient',
      '.landing-card',
      '.result-card',
      '.identity-card strong',
      '.join-url',
      '.phase-track span',
    ].join(','));
    const selector = (element) => {
      const name = element.tagName.toLowerCase();
      const id = element.id ? `#${element.id}` : '';
      const classes = [...element.classList].slice(0, 3).map((value) => `.${value}`).join('');
      return `${name}${id}${classes}`;
    };
    return [...document.querySelectorAll('body *')].flatMap((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (ignored(element) || rect.width < 1 || rect.height < 1
        || style.display === 'none' || style.visibility === 'hidden') return [];
      const escapesViewport = style.position !== 'fixed'
        && (rect.left < -0.5 || rect.right > viewportWidth + 0.5);
      const hasHorizontalOverflow = element.scrollWidth > element.clientWidth + 1;
      if (!escapesViewport && !hasHorizontalOverflow) return [];
      return [{
        selector: selector(element),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        left: Math.round(rect.left * 10) / 10,
        right: Math.round(rect.right * 10) / 10,
        viewportWidth,
        escapesViewport,
        hasHorizontalOverflow,
        text: (element.textContent ?? '').trim().replaceAll(/\s+/g, ' ').slice(0, 100),
      }];
    });
  });
  if (issues.length === 0) return;
  mkdirSync('test-results/overflow', { recursive: true });
  const screenshot = `test-results/overflow/${safeLabel(label)}.png`;
  await page.screenshot({ path: screenshot, fullPage: true });
  throw new Error(`${label} nested overflow: ${JSON.stringify(issues.slice(0, 12))}; screenshot=${screenshot}`);
}

async function auditFullStackFlow(scenarioId, difficulty, width) {
  let auditNow = 0;
  const auditAdjudicator = createDeterministicRegistry();
  const auditStore = new GameStore({ now: () => auditNow, adjudicators: auditAdjudicator });
  const auditServer = await createGameServer({
    store: auditStore, adjudicator: auditAdjudicator, publicBaseUrl: 'http://127.0.0.1',
  });
  await new Promise((resolve) => auditServer.listen(0, '127.0.0.1', resolve));
  const auditOrigin = `http://127.0.0.1:${auditServer.address().port}`;
  const joinResponse = await fetch(`${auditOrigin}/api/join`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: 'd'.repeat(32), scenarioId, difficulty }),
  });
  const player = await joinResponse.json();
  if (!joinResponse.ok) throw new Error(`overflow audit join failed: ${JSON.stringify(player)}`);
  const page = await browser.newPage({ viewport: { width, height: width === 320 ? 568 : 844 } });
  await page.addInitScript((token) => sessionStorage.setItem('breach5-player-token', token), player.token);
  const scenario = getScenario(scenarioId);
  const phases = new Set();
  let actionSequence = 0;
  try {
    auditNow = 15_000;
    await auditStore.tick();
    await page.goto(`${auditOrigin}/play`);
    await page.waitForSelector('.mission-card');
    phases.add(auditStore.state(player.token).round.phase);
    await assertNoNestedOverflow(page, `${scenarioId}-${difficulty}-${width}-brief`);

    auditNow = 18_000;
    await auditStore.tick();
    for (let step = 0; step < 40; step += 1) {
      const state = auditStore.state(player.token);
      phases.add(state.round.phase);
      await page.goto(`${auditOrigin}/play`);
      await page.waitForSelector('.mission-card');
      const stateLabel = `${scenarioId}-${difficulty}-${width}-${state.round.phase}-${step}`;
      await assertNoNestedOverflow(page, `${stateLabel}-base`);
      if (scenarioId === 'session-heist' && ['DISCOVER', 'BUILD'].includes(state.round.phase)) {
        if (state.attackFlow !== null) throw new Error(`RCE flow leaked before execution in ${state.round.phase}`);
        if (await page.locator('.attack-flow').count()) throw new Error(`RCE flow UI leaked before execution in ${state.round.phase}`);
      }
      const task = state.tasks.find((item) => !item.selected);
      if (task) {
        const tabCount = await page.locator('.evidence-tab').count();
        for (let index = 0; index < tabCount; index += 1) {
          await page.locator('.evidence-tab').nth(index).click();
          await assertNoNestedOverflow(page, `${stateLabel}-${task.id}-evidence-${index}`);
        }
        const expected = Array.isArray(scenario.correct[task.id])
          ? scenario.correct[task.id][0] : scenario.correct[task.id];
        const optionIndex = task.options.findIndex((option) => option.id === expected);
        if (optionIndex < 0) throw new Error(`missing correct option for ${task.id}`);
        await page.locator('.option-button').nth(optionIndex).click();
        await page.waitForSelector('#confirm-choice:not([disabled])');
        await assertNoNestedOverflow(page, `${stateLabel}-${task.id}-preview`);
        const previous = state.observations.length;
        await page.locator('#confirm-choice').click();
        for (let wait = 0; wait < 100 && auditStore.state(player.token).observations.length === previous; wait += 1) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        actionSequence += 1;
        continue;
      }
      if (state.round.phase === 'RESULT') {
        const rawDetails = page.locator('.raw-details');
        if (await rawDetails.count()) {
          await rawDetails.locator('summary').click();
          await assertNoNestedOverflow(page, `${stateLabel}-raw-open`);
        }
        if (scenarioId === 'session-heist') {
          await page.getByText('RCE primitive CONFIRMED', { exact: true }).waitFor();
          if (state.attackFlow?.steps?.at(-1)?.status !== 'CONFIRMED') throw new Error('RCE flow did not reach confirmed state');
        }
        await page.goto(`${auditOrigin}/screen`);
        await page.waitForSelector('.lane-card');
        if (scenarioId === 'session-heist') {
          await page.getByText(/RCE PRIMITIVE CONFIRMED/).waitFor();
        }
        await assertNoNestedOverflow(page, `${stateLabel}-spectator-result`);
        break;
      }
      auditNow += 3_000;
      await auditStore.tick();
    }
    for (const phase of ['BRIEF', 'DISCOVER', 'BUILD', 'EXECUTE', 'DUEL', 'REVERIFY', 'RESULT']) {
      if (!phases.has(phase)) throw new Error(`${scenarioId}/${difficulty} missed ${phase} in overflow audit`);
    }
    if (actionSequence !== Object.keys(scenario.tasks).length) {
      throw new Error(`${scenarioId}/${difficulty} audited ${actionSequence} actions, expected ${Object.keys(scenario.tasks).length}`);
    }
  } finally {
    await page.close();
    await new Promise((resolve) => auditServer.close(resolve));
  }
}

try {
  browser = await chromium.launch({ headless: true, executablePath });
  for (const viewport of [{ width: 320, height: 568 }, { width: 360, height: 640 }, { width: 390, height: 844 }, { width: 412, height: 915 }]) {
    const page = await browser.newPage({ viewport });
    await page.goto(`${origin}/play`);
    await page.waitForSelector('.lobby-card');
    const before = await page.evaluate(() => ({
      viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      inputCount: document.querySelectorAll('input, textarea, [contenteditable="true"]').length,
      joinDisabled: document.querySelector('#join-button')?.disabled,
      scenarioCount: document.querySelectorAll('.case-card').length,
      difficultyCount: document.querySelectorAll('.difficulty-card').length,
      minButtonHeight: Math.min(...[...document.querySelectorAll('button')].map((button) => button.getBoundingClientRect().height)),
    }));
    if (before.documentWidth > before.viewport) throw new Error(`lobby horizontal overflow at ${viewport.width}px`);
    await assertNoNestedOverflow(page, `lobby-${viewport.width}`);
    if (before.inputCount !== 0) throw new Error('lobby unexpectedly requires free-form input');
    if (!before.joinDisabled || before.scenarioCount !== 2 || before.difficultyCount !== 2) throw new Error('lobby selection gate is incomplete');
    if (before.minButtonHeight < 44) throw new Error(`lobby touch target below 44px at ${viewport.width}px`);
    await page.locator('[data-scenario-id="proxy-panic"]').click();
    if (!(await page.locator('#join-button').isDisabled())) throw new Error('join enabled before difficulty selection');
    await page.locator('[data-difficulty="BEGINNER"]').click();
    if (await page.locator('#join-button').isDisabled()) throw new Error('join stayed disabled after both selections');
    await page.close();
  }

  const red = await api('/api/join', {
    method: 'POST', body: { deviceId: '1'.repeat(32), scenarioId: 'proxy-panic', difficulty: 'BEGINNER' },
  });
  const blue = await api('/api/join', {
    method: 'POST', body: { deviceId: '2'.repeat(32), scenarioId: 'proxy-panic', difficulty: 'ADVANCED' },
  });
  now = 15_000;
  await store.tick();
  now = 18_000;
  await store.tick();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.addInitScript((playerToken) => sessionStorage.setItem('breach5-player-token', playerToken), red.token);
  let actionRequests = 0;
  let previewRequests = 0;
  let abortNextAction = true;
  await mobile.route('**/api/preview', async (route) => {
    previewRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.continue();
  });
  await mobile.route('**/api/action', async (route) => {
    actionRequests += 1;
    if (abortNextAction) {
      abortNextAction = false;
      await route.abort('failed');
    } else await route.continue();
  });
  await mobile.goto(`${origin}/play`);
  await mobile.waitForSelector('.option-button');
  const taskMetrics = await mobile.evaluate(() => ({
    viewport: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    annotations: document.querySelectorAll('.evidence-annotation').length,
    codePaneCount: document.querySelectorAll('.code-pane').length,
    minButtonHeight: Math.min(...[...document.querySelectorAll('button')].map((button) => button.getBoundingClientRect().height)),
    codePanesWrapped: [...document.querySelectorAll('.code-pane')].every((pane) => {
      const style = getComputedStyle(pane);
      return style.whiteSpace === 'pre-wrap' && pane.scrollWidth <= pane.clientWidth + 1;
    }),
  }));
  if (taskMetrics.documentWidth > taskMetrics.viewport) throw new Error('task screen has horizontal overflow');
  if (taskMetrics.annotations < 1 || taskMetrics.codePaneCount < 1) throw new Error('beginner evidence deck is incomplete');
  if (taskMetrics.minButtonHeight < 44 || !taskMetrics.codePanesWrapped) throw new Error('task touch/wrapping contract failed');
  await assertNoNestedOverflow(mobile, 'proxy-beginner-first-task-390');

  await mobile.locator('.option-button').first().click();
  if (!(await mobile.locator('#confirm-choice').isDisabled())) throw new Error('confirm enabled before the server preview completed');
  if (previewRequests !== 1 || actionRequests !== 0) throw new Error('preview gate sent the wrong request sequence');
  await mobile.waitForSelector('#confirm-choice:not([disabled])');
  if (actionRequests !== 0) throw new Error('first option tap submitted instead of staging a preview');
  await mobile.locator('#confirm-choice').click();
  await mobile.waitForFunction(() => document.querySelector('#notice')?.textContent?.includes('다시'));
  await mobile.waitForSelector('.option-button:not([disabled])');
  await mobile.locator('.option-button').first().click();
  await mobile.locator('#confirm-choice').click();
  await mobile.waitForSelector('.task-complete h2');
  await mobile.waitForSelector('.observation-recap');
  await mobile.waitForFunction(() => document.activeElement?.matches('.task-complete h2'));
  await mobile.close();

  const analyst = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await analyst.addInitScript((playerToken) => sessionStorage.setItem('breach5-player-token', playerToken), blue.token);
  await analyst.goto(`${origin}/play`);
  await analyst.waitForSelector('.option-button');
  if (await analyst.locator('.evidence-annotation').count()) throw new Error('advanced mode leaked guided annotations');
  if (!(await analyst.locator('.advanced-note').count())) throw new Error('advanced mode did not render raw-evidence instruction');
  await analyst.close();

  for (const viewport of [
    { width: 320, height: 568 }, { width: 360, height: 640 }, { width: 760, height: 900 },
    { width: 900, height: 900 }, { width: 901, height: 900 }, { width: 1440, height: 900 },
  ]) {
    const screen = await browser.newPage({ viewport });
    await screen.goto(`${origin}/screen`);
    await screen.waitForSelector('.lane-card');
    const screenMetrics = await screen.evaluate(() => ({
      viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      lanes: document.querySelectorAll('.lane-card').length,
      qrReady: document.querySelector('.qr-frame img')?.naturalWidth > 0,
    }));
    if (screenMetrics.documentWidth > screenMetrics.viewport) throw new Error(`spectator screen has horizontal overflow at ${viewport.width}px`);
    if (screenMetrics.lanes !== 2 || !screenMetrics.qrReady) throw new Error('spectator lane or QR rendering failed');
    await assertNoNestedOverflow(screen, `spectator-${viewport.width}`);
    await screen.close();
  }

  for (const scenarioId of ['proxy-panic', 'session-heist']) {
    for (const difficulty of ['BEGINNER', 'ADVANCED']) {
      await auditFullStackFlow(scenarioId, difficulty, 320);
    }
  }

  console.log('UI layout, wrapping, and full-flow interaction checks passed at 320-1440px.');
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
