import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { createDeterministicRegistry } from '../src/adjudicator.mjs';
import { GameStore } from '../src/game.mjs';
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

try {
  browser = await chromium.launch({ headless: true, executablePath });
  for (const viewport of [{ width: 360, height: 640 }, { width: 390, height: 844 }, { width: 412, height: 915 }]) {
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
    codePanesContained: [...document.querySelectorAll('.code-pane')].every((pane) => getComputedStyle(pane).overflowX === 'auto'),
  }));
  if (taskMetrics.documentWidth > taskMetrics.viewport) throw new Error('task screen has horizontal overflow');
  if (taskMetrics.annotations < 1 || taskMetrics.codePaneCount < 1) throw new Error('beginner evidence deck is incomplete');
  if (taskMetrics.minButtonHeight < 44 || !taskMetrics.codePanesContained) throw new Error('task touch/overflow contract failed');

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

  const screen = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await screen.goto(`${origin}/screen`);
  await screen.waitForSelector('.lane-card');
  const screenMetrics = await screen.evaluate(() => ({
    viewport: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    lanes: document.querySelectorAll('.lane-card').length,
    qrReady: document.querySelector('.qr-frame img')?.naturalWidth > 0,
  }));
  if (screenMetrics.documentWidth > screenMetrics.viewport) throw new Error('spectator screen has horizontal overflow');
  if (screenMetrics.lanes !== 2 || !screenMetrics.qrReady) throw new Error('spectator lane or QR rendering failed');
  await screen.close();

  console.log('UI layout and interaction check passed at 360, 390, 412, and 1440px.');
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
