import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { DeterministicAdjudicator } from '../src/adjudicator.mjs';
import { GameStore } from '../src/game.mjs';
import { createGameServer } from '../src/server.mjs';

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const executablePath = candidates.find((path) => existsSync(path));

if (!executablePath) {
  console.log('UI layout check skipped: set CHROME_PATH to a Chromium-compatible browser.');
  process.exit(0);
}

let now = 0;
const adjudicator = new DeterministicAdjudicator();
const store = new GameStore({ now: () => now, adjudicator });
const server = await createGameServer({ store, adjudicator, publicBaseUrl: 'http://127.0.0.1:18090' });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;

try {
  browser = await chromium.launch({ headless: true, executablePath });
  for (const viewport of [{ width: 360, height: 640 }, { width: 390, height: 844 }, { width: 412, height: 915 }]) {
    const page = await browser.newPage({ viewport });
    await page.goto(`${origin}/play`);
    await page.waitForSelector('.landing-card');
    const metrics = await page.evaluate(() => ({
      viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      cardRight: document.querySelector('.landing-card').getBoundingClientRect().right,
      inputCount: document.querySelectorAll('input, textarea, [contenteditable="true"]').length,
    }));
    if (metrics.documentWidth > metrics.viewport || metrics.cardRight > metrics.viewport + 0.5) {
      throw new Error(`horizontal overflow at ${viewport.width}px: ${JSON.stringify(metrics)}`);
    }
    if (metrics.inputCount !== 0) throw new Error('landing screen unexpectedly requires text input');
    if (viewport.width === 390) {
      await page.waitForTimeout(900);
      const repeatedStatusMutations = await page.evaluate(() => new Promise((resolve) => {
        let mutations = 0;
        const target = document.querySelector('#connection');
        const observer = new MutationObserver((records) => { mutations += records.length; });
        observer.observe(target, { childList: true, characterData: true, subtree: true, attributes: true });
        setTimeout(() => { observer.disconnect(); resolve(mutations); }, 1_700);
      }));
      if (repeatedStatusMutations !== 0) throw new Error('unchanged connection status mutates during polling');
    }
    await page.close();
  }

  const players = [];
  for (let index = 0; index < 6; index += 1) {
    const response = await fetch(`${origin}/api/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: (index + 1).toString(16).padStart(32, '0') }),
    });
    players.push(await response.json());
  }
  now = 95_000;
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.addInitScript((playerToken) => sessionStorage.setItem('breach5-player-token', playerToken), players[2].token);
  await mobile.goto(`${origin}/play`);
  await mobile.waitForSelector('.option-button');
  const taskMetrics = await mobile.evaluate(() => ({
    viewport: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    buttonHeights: [...document.querySelectorAll('button')].map((button) => button.getBoundingClientRect().height),
  }));
  if (taskMetrics.documentWidth > taskMetrics.viewport) throw new Error('task screen has horizontal overflow');
  if (taskMetrics.buttonHeights.some((height) => height < 44)) throw new Error('task screen has a touch target below 44px');
  let abortedAction = false;
  await mobile.route('**/api/action', async (route) => {
    if (!abortedAction) {
      abortedAction = true;
      await route.abort('failed');
    } else {
      await route.continue();
    }
  });
  await mobile.locator('.option-button').first().click();
  await mobile.waitForFunction(() => [...document.querySelectorAll('.option-button')].every((button) => !button.disabled));
  const retryNotice = await mobile.locator('#notice').textContent();
  if (!retryNotice?.includes('다시')) throw new Error('action failure does not leave a retry notice');
  await mobile.locator('.option-button').first().click();
  await mobile.waitForSelector('.task-complete h2');
  await mobile.waitForFunction(() => document.activeElement?.matches('.task-complete h2')
    && document.activeElement.textContent?.includes('반영'));
  await mobile.close();

  const queuedJoin = await fetch(`${origin}/api/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: '00000000000000000000000000000007' }),
  });
  const queuedPlayer = await queuedJoin.json();
  const queuedPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await queuedPage.addInitScript((playerToken) => sessionStorage.setItem('breach5-player-token', playerToken), queuedPlayer.token);
  await queuedPage.goto(`${origin}/play`);
  await queuedPage.waitForSelector('.practice-panel');
  await queuedPage.getByRole('button', { name: '신뢰 경계에서 두 입력을 비교한다.' }).click();
  await queuedPage.waitForSelector('.practice-next');
  await queuedPage.waitForFunction(() => document.activeElement?.matches('.practice-feedback'));
  await queuedPage.locator('.practice-next').click();
  await queuedPage.getByText('PRACTICE 2/3').waitFor();
  await queuedPage.waitForFunction(() => document.activeElement?.matches('.practice-panel h3')
    && document.activeElement.textContent?.includes('문자열 하나'));
  await queuedPage.close();

  const screen = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await screen.goto(`${origin}/screen`);
  await screen.waitForSelector('.attack-graph');
  const screenMetrics = await screen.evaluate(() => ({
    viewport: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    qrReady: document.querySelector('.qr-frame img').naturalWidth > 0,
  }));
  if (screenMetrics.documentWidth > screenMetrics.viewport) throw new Error('spectator screen has horizontal overflow');
  if (!screenMetrics.qrReady) throw new Error('spectator QR did not render');
  await screen.close();

  console.log('UI layout check passed at 360, 390, 412, and 1440px.');
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
