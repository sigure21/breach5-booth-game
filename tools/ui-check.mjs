import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { QUESTION_BANK } from '../src/content/questions.mjs';
import { GameStore } from '../src/game.mjs';
import {
  CREWS, DIFFICULTIES, DRIVERS, TRACKS,
} from '../src/race/catalog.mjs';
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

const questions = new Map(QUESTION_BANK.map((question) => [question.id, question]));
let browser;

function safeLabel(value) {
  return value.replaceAll(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 120);
}

async function assertNoHorizontalOverflow(page, label) {
  const issues = await page.evaluate(() => {
    const root = document.documentElement;
    const viewportWidth = root.clientWidth;
    const result = [];
    if (root.scrollWidth > viewportWidth + 1 || document.body.scrollWidth > viewportWidth + 1) {
      result.push({
        selector: 'document',
        viewportWidth,
        documentWidth: root.scrollWidth,
        bodyWidth: document.body.scrollWidth,
      });
    }

    const selector = (element) => {
      const name = element.tagName.toLowerCase();
      const id = element.id ? `#${element.id}` : '';
      const classes = [...element.classList].slice(0, 3).map((value) => `.${value}`).join('');
      return `${name}${id}${classes}`;
    };
    const clippedByAncestor = (element, rect) => {
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (!['hidden', 'clip'].includes(style.overflowX)) continue;
        const parentRect = parent.getBoundingClientRect();
        if (rect.left < parentRect.left - 1 || rect.right > parentRect.right + 1) return true;
      }
      return false;
    };

    for (const element of document.querySelectorAll('body *')) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1 || style.display === 'none' || style.visibility === 'hidden') continue;
      const nestedScroller = ['auto', 'scroll'].includes(style.overflowX)
        && element.scrollWidth > element.clientWidth + 1;
      const outsideViewport = style.position !== 'fixed'
        && (rect.left < -1 || rect.right > viewportWidth + 1)
        && !clippedByAncestor(element, rect);
      if (!nestedScroller && !outsideViewport) continue;
      result.push({
        selector: selector(element),
        overflowX: style.overflowX,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        left: Math.round(rect.left * 10) / 10,
        right: Math.round(rect.right * 10) / 10,
        viewportWidth,
        nestedScroller,
        outsideViewport,
        text: (element.textContent ?? '').trim().replaceAll(/\s+/g, ' ').slice(0, 100),
      });
    }
    return result;
  });

  if (issues.length === 0) return;
  mkdirSync('test-results/overflow', { recursive: true });
  const screenshot = `test-results/overflow/${safeLabel(label)}.png`;
  await page.screenshot({ path: screenshot, fullPage: true });
  throw new Error(`${label} horizontal overflow: ${JSON.stringify(issues.slice(0, 12))}; screenshot=${screenshot}`);
}

async function assertTouchTargets(page, selector, label) {
  const tooSmall = await page.locator(selector).evaluateAll((elements) => elements
    .filter((element) => {
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && !element.disabled;
    })
    .map((element) => ({
      text: (element.textContent ?? '').trim().slice(0, 60),
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
    }))
    .filter(({ height }) => height < 44));
  if (tooSmall.length) throw new Error(`${label} touch targets below 44px: ${JSON.stringify(tooSmall)}`);
}

async function createHarness(label) {
  let now = 0;
  const store = new GameStore({
    now: () => now,
    roundMs: 300_000,
    seedSecret: `ui-${label}-${'a'.repeat(64)}`.slice(0, 64),
  });
  const server = await createGameServer({
    store,
    publicBaseUrl: 'http://127.0.0.1:18090',
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    store,
    origin,
    setNow(value) { now = value; },
    async advance(milliseconds) {
      now += milliseconds;
      await store.tick();
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function api(origin, path, { token, method = 'GET', body } = {}) {
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

async function newMobilePage(origin, token = null) {
  const context = await browser.newContext({
    viewport: { width: 320, height: 568 },
    reducedMotion: 'reduce',
  });
  if (token) {
    await context.addInitScript((value) => {
      sessionStorage.setItem('nitro-grid-player-token', value);
    }, token);
  }
  const page = await context.newPage();
  await page.goto(`${origin}/play`);
  return { context, page };
}

async function auditLobby() {
  const harness = await createHarness('lobby');
  let context;
  try {
    ({ context } = await newMobilePage(harness.origin));
    const page = context.pages()[0];
    await page.waitForSelector('.garage-card');
    assert.equal(await page.locator('.track-card').count(), 2);
    assert.equal(await page.locator('.crew-card').count(), 4);
    assert.equal(await page.locator('.driver-card').count(), 0, 'drivers must wait for a crew selection');
    assert.equal(await page.locator('.difficulty-card').count(), 2);
    assert.equal(await page.locator('#join-button').isDisabled(), true);
    await assertNoHorizontalOverflow(page, 'lobby-320-initial');
    await assertTouchTargets(page, 'button', 'lobby');

    await page.locator('.track-card').first().click();
    await page.locator('.crew-card').first().click();
    await page.waitForFunction(() => document.querySelectorAll('.driver-card').length === 2);
    const firstPair = await page.locator('.driver-card strong').allTextContents();
    assert.equal(firstPair.length, 2);
    await page.locator('.crew-card').nth(1).click();
    await page.waitForFunction(
      (previous) => {
        const current = [...document.querySelectorAll('.driver-card strong')].map((node) => node.textContent);
        return current.length === 2 && current.join('|') !== previous.join('|');
      },
      firstPair,
    );
    assert.equal(await page.locator('.driver-card').count(), 2);
    await page.locator('.driver-card').first().click();
    await page.locator('.difficulty-card').first().click();
    assert.equal(await page.locator('#join-button').isDisabled(), false);
    await page.locator('.driver-card').first().scrollIntoViewIfNeeded();
    await page.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0));
    await assertNoHorizontalOverflow(page, 'lobby-320-selected');

    await page.locator('#join-button').click();
    await page.waitForSelector('.waiting-card, .race-hero');
    await assertNoHorizontalOverflow(page, 'lobby-320-joined');
  } finally {
    if (context) await context.close();
    await harness.close();
  }
}

async function auditCompletePollingStops() {
  const harness = await createHarness('complete-polling');
  let context;
  try {
    const identity = await api(harness.origin, '/api/join', {
      method: 'POST',
      body: {
        deviceId: 'c'.repeat(32),
        trackId: TRACKS[0].id,
        difficulty: DIFFICULTIES[0],
        crewId: CREWS[0].id,
        driverId: DRIVERS.find(({ crewId }) => crewId === CREWS[0].id).id,
      },
    });
    harness.setNow(300_000);
    await harness.store.tick();

    context = await browser.newContext({
      viewport: { width: 320, height: 568 },
      reducedMotion: 'reduce',
    });
    await context.addInitScript((token) => {
      sessionStorage.setItem('nitro-grid-player-token', token);
    }, identity.token);
    const page = await context.newPage();
    let stateRequests = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/state') stateRequests += 1;
    });
    await page.goto(`${harness.origin}/play`);
    await page.waitForSelector('.result-card');
    assert.equal(await page.locator('.race-timer span').textContent(), 'RACE COMPLETE');
    const requestsAtComplete = stateRequests;
    assert.equal(requestsAtComplete, 1);
    await page.waitForTimeout(2_000);
    assert.equal(stateRequests, requestsAtComplete, 'COMPLETE kept polling /api/state every 750ms');
    await assertNoHorizontalOverflow(page, 'complete-polling-stopped-320');
  } finally {
    if (context) await context.close();
    await harness.close();
  }
}

async function auditRaceFlow(track, difficulty, crew, flowIndex) {
  const harness = await createHarness(`${track.id}-${difficulty}`);
  let context;
  let screenContext;
  const driver = DRIVERS.find(({ crewId }) => crew.id === crewId);
  const injectWrongAnswer = flowIndex === 0;
  const originalDeviceId = String(flowIndex + 1).padStart(32, '0');
  assert.ok(driver);
  try {
    const identity = await api(harness.origin, '/api/join', {
      method: 'POST',
      body: {
        deviceId: originalDeviceId,
        trackId: track.id,
        difficulty,
        crewId: crew.id,
        driverId: driver.id,
      },
    });
    harness.setNow(30_000);
    await harness.store.tick();

    ({ context } = await newMobilePage(harness.origin, identity.token));
    const page = context.pages()[0];
    await page.evaluate((value) => localStorage.setItem('nitro-grid-device-id', value), originalDeviceId);
    const phases = [];
    const expectedCorrectness = new Map();
    let answered = 0;

    for (let phaseIndex = 0; phaseIndex < 5; phaseIndex += 1) {
      const state = harness.store.state(identity.token);
      phases.push(state.round.phase);
      assert.ok(['LAUNCH', 'SECTOR_1', 'PIT_STOP', 'SECTOR_2', 'SPRINT'].includes(state.round.phase));
      assert.ok(state.tasks.length > 0);
      await page.reload();
      await page.waitForSelector('.race-hero');
      await page.waitForSelector('.answer-card');
      await assertNoHorizontalOverflow(page, `${track.id}-${difficulty}-${state.round.phase}-base`);
      await assertTouchTargets(page, '.answer-card, .confirm-button', `${track.id}/${difficulty}/${state.round.phase}`);

      const annotations = await page.locator('.evidence-note').count();
      if (difficulty === 'BEGINNER') assert.ok(annotations > 0, `${state.round.phase} lacks guided evidence`);
      else assert.equal(annotations, 0, `${state.round.phase} leaked guided evidence`);
      if (state.round.phase === 'PIT_STOP') assert.equal(await page.locator('.trend-card').count(), 1);

      for (const task of state.tasks) {
        const source = questions.get(task.id);
        assert.ok(source, `missing source question ${task.id}`);
        const correct = source.correctOptionId;
        const submitWrong = injectWrongAnswer && answered === 0;
        const selectedOption = submitWrong
          ? task.options.find(({ id }) => id !== correct)
          : task.options.find(({ id }) => id === correct);
        assert.ok(selectedOption, `${task.id} has no ${submitWrong ? 'wrong' : 'correct'} option`);
        const optionIndex = task.options.findIndex(({ id }) => id === selectedOption.id);
        assert.ok(optionIndex >= 0, `${task.id} omitted its correct option`);
        const sourceOption = source.options.find(({ id }) => id === selectedOption.id);
        const correctOption = source.options.find(({ id }) => id === correct);
        assert.ok(sourceOption?.feedback);
        assert.ok(correctOption?.label);
        expectedCorrectness.set(task.id, !submitWrong);

        const card = page.locator(`#confirm-${task.id}`).locator('..');
        await card.locator('.answer-card').nth(optionIndex).click();
        const confirm = page.locator(`#confirm-${task.id}`);
        await confirm.waitFor({ state: 'visible' });
        assert.equal(await confirm.isDisabled(), false);
        await assertNoHorizontalOverflow(page, `${track.id}-${difficulty}-${state.round.phase}-${task.id}-preview`);
        await confirm.click();

        const feedback = page.locator('.feedback-card');
        await feedback.waitFor({ state: 'visible' });
        assert.equal(await feedback.evaluate(
          (element, expectedClass) => element.classList.contains(expectedClass),
          submitWrong ? 'wrong' : 'correct',
        ), true);
        assert.equal(
          await feedback.locator('.feedback-flag').textContent(),
          submitWrong ? '× TIME PENALTY' : '✓ CLEAN LINE',
        );
        assert.equal((await feedback.locator('.selected-answer strong').textContent())?.trim(), selectedOption.label);
        assert.equal((await feedback.locator('.feedback-explanation').textContent())?.trim(), sourceOption.feedback);
        if (submitWrong) {
          assert.equal(await feedback.locator('.correct-answer').count(), 1);
          assert.equal((await feedback.locator('.correct-answer strong').textContent())?.trim(), correctOption.label);
        } else {
          assert.equal(await feedback.locator('.correct-answer').count(), 0);
        }
        assert.match((await feedback.locator('.race-effect b').textContent()) ?? '', /\S/);
        await assertNoHorizontalOverflow(page, `${track.id}-${difficulty}-${state.round.phase}-${task.id}-feedback`);
        await assertTouchTargets(page, '#feedback-continue', `${task.id} feedback`);
        await page.locator('#feedback-continue').click();
        await feedback.waitFor({ state: 'detached' });
        answered += 1;
      }

      const after = harness.store.state(identity.token);
      assert.ok(after.tasks.every((task) => (
        task.selected && task.feedback?.correct === expectedCorrectness.get(task.id)
      )));
      await harness.advance(3_100);
    }

    assert.deepEqual(phases, ['LAUNCH', 'SECTOR_1', 'PIT_STOP', 'SECTOR_2', 'SPRINT']);
    assert.equal(answered, 7);
    const result = harness.store.state(identity.token);
    const expectedCorrect = injectWrongAnswer ? 6 : 7;
    const expectedBand = injectWrongAnswer ? 'PODIUM' : 'POLE_POSITION';
    assert.equal(result.round.phase, 'RESULT');
    assert.equal(result.race.correct, expectedCorrect);
    assert.equal(result.race.accuracy, injectWrongAnswer ? 86 : 100);
    assert.equal(result.result.finishBand, expectedBand);
    assert.equal(result.result.review.length, 7);
    await page.reload();
    await page.waitForSelector('.result-card');
    await page.getByText(injectWrongAnswer ? 'PODIUM FINISH' : 'POLE POSITION', { exact: true }).waitFor();
    assert.equal(await page.locator('.result-review').count(), 1);
    const review = page.locator('.result-review');
    if (await review.evaluate((element) => element.tagName === 'DETAILS' && !element.open)) {
      await review.locator('summary').click();
    }
    assert.equal(await page.locator('.review-item').count(), 7);
    assert.equal(await page.locator('.review-item.wrong').count(), injectWrongAnswer ? 1 : 0);
    for (const [index, row] of result.result.review.entries()) {
      const labels = await page.locator('.review-item').nth(index).locator('.review-answers strong').allTextContents();
      assert.deepEqual(labels, row.correct
        ? [row.selectedLabel]
        : [row.selectedLabel, row.correctOptionLabel]);
      assert.ok(row.selectedLabel && row.selectedLabel !== row.selected);
      assert.ok(row.correctOptionLabel && row.correctOptionLabel !== row.correctOptionId);
    }
    await assertNoHorizontalOverflow(page, `${track.id}-${difficulty}-result`);
    await assertTouchTargets(page, '.result-card button, .result-card summary', `${track.id}/${difficulty} result`);

    screenContext = await browser.newContext({
      viewport: { width: 320, height: 568 },
      reducedMotion: 'reduce',
    });
    const screen = await screenContext.newPage();
    await screen.goto(`${harness.origin}/screen`);
    await screen.waitForFunction(() => document.querySelectorAll('.lane-card').length === 2);
    await screen.waitForFunction(() => document.querySelector('.qr-frame img')?.naturalWidth > 0);
    await assertNoHorizontalOverflow(screen, `${track.id}-${difficulty}-screen-320`);

    if (injectWrongAnswer) {
      await page.locator('.result-card .primary-button').click();
      await page.waitForSelector('.garage-card');
      assert.equal(await page.evaluate(() => localStorage.getItem('nitro-grid-device-id')), null);
      await page.locator('.track-card').first().click();
      await page.locator('.crew-card').first().click();
      await page.waitForFunction(() => document.querySelectorAll('.driver-card').length === 2);
      await page.locator('.driver-card').first().click();
      await page.locator('.difficulty-card').first().click();
      await page.locator('#join-button').click();
      await page.waitForSelector('.waiting-card');
      const retryIdentity = await page.evaluate(() => ({
        token: sessionStorage.getItem('nitro-grid-player-token'),
        deviceId: localStorage.getItem('nitro-grid-device-id'),
      }));
      assert.match(retryIdentity.token ?? '', /^[A-Za-z0-9_-]{32}$/);
      assert.notEqual(retryIdentity.token, identity.token);
      assert.match(retryIdentity.deviceId ?? '', /^[a-f0-9]{32}$/);
      assert.notEqual(retryIdentity.deviceId, originalDeviceId);
      const queued = await api(harness.origin, '/api/state', { token: retryIdentity.token });
      assert.equal(queued.round.phase, 'QUEUED');
      assert.equal(queued.round.ordinal, 1);
      assert.equal(queued.queue.selectedTrack, TRACKS[0].id);
      await assertNoHorizontalOverflow(page, `${track.id}-${difficulty}-retry-queued`);
    }
  } finally {
    if (screenContext) await screenContext.close();
    if (context) await context.close();
    await harness.close();
  }
}

try {
  browser = await chromium.launch({
    headless: true,
    executablePath,
  });
  await auditLobby();
  await auditCompletePollingStops();
  let flowIndex = 0;
  for (const [trackIndex, track] of TRACKS.entries()) {
    for (const [difficultyIndex, difficulty] of DIFFICULTIES.entries()) {
      const crew = CREWS[(trackIndex * DIFFICULTIES.length + difficultyIndex) % CREWS.length];
      await auditRaceFlow(track, difficulty, crew, flowIndex);
      flowIndex += 1;
    }
  }
  console.log('NITRO GRID 320px lobby, correct/wrong feedback, result, spectator, and four full race flows passed.');
} finally {
  if (browser) await browser.close();
}
