import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { QUESTION_BANKS } from '../src/content/questions.mjs';
import { GameStore } from '../src/game.mjs';
import { CIRCUITS, CREWS, DRIVERS } from '../src/race/catalog.mjs';
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

const answers = new Map(
  Object.values(QUESTION_BANKS).flat().map((question) => [question.id, question.correctOptionId]),
);
const expectedTeamCars = [
  '/assets/team-cars/red-bull-rb22-2026.webp',
  '/assets/team-cars/ferrari-sf26-2026.webp',
  '/assets/team-cars/mercedes-w17-2026.webp',
  '/assets/team-cars/mclaren-mcl40-2026.webp',
];
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
        selector: 'document', viewportWidth, documentWidth: root.scrollWidth,
        bodyWidth: document.body.scrollWidth,
      });
    }
    const selector = (element) => {
      const id = element.id ? `#${element.id}` : '';
      const classes = [...element.classList].slice(0, 3).map((value) => `.${value}`).join('');
      return `${element.tagName.toLowerCase()}${id}${classes}`;
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
        selector: selector(element), overflowX: style.overflowX,
        clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
        left: Math.round(rect.left * 10) / 10, right: Math.round(rect.right * 10) / 10,
        viewportWidth, nestedScroller, outsideViewport,
        text: (element.textContent ?? '').trim().replaceAll(/\s+/g, ' ').slice(0, 80),
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
      width: Math.round(element.getBoundingClientRect().width),
      height: Math.round(element.getBoundingClientRect().height),
    }))
    .filter(({ height, width }) => height < 44 || width < 44));
  if (tooSmall.length) throw new Error(`${label} touch targets below 44px: ${JSON.stringify(tooSmall)}`);
}

async function assertUniqueMarkerTransforms(page, selector, label) {
  await page.waitForFunction((markerSelector) => {
    const markers = [...document.querySelectorAll(markerSelector)];
    return markers.length === 4 && markers.every((marker) => marker.getAttribute('transform'));
  }, selector);
  const transforms = await page.locator(selector).evaluateAll((markers) => (
    markers.map((marker) => marker.getAttribute('transform'))
  ));
  assert.equal(transforms.length, 4, `${label} did not render four markers`);
  assert.equal(new Set(transforms).size, 4, `${label} marker transforms overlap: ${JSON.stringify(transforms)}`);
}

async function createHarness() {
  let now = 0;
  const store = new GameStore({
    now: () => now,
    roundMs: 300_000,
    matchMinWaitMs: 300,
    matchMaxWaitMs: 450,
    gridMs: 100,
    encounterMs: 300,
    minimumExposureMs: 75,
    resultMs: 300,
    seedSecret: `ui-heat-${'a'.repeat(64)}`.slice(0, 64),
  });
  const server = await createGameServer({ store, publicBaseUrl: 'http://127.0.0.1:18090' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    store,
    origin: `http://127.0.0.1:${server.address().port}`,
    async setNow(value) {
      now = value;
      await store.tick();
    },
    async close() { await new Promise((resolve) => server.close(resolve)); },
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

async function waitScreen(page, name) {
  await page.waitForSelector(`#app[data-screen="${name}"]`, { timeout: 6_000 });
}

async function auditHeatFlow() {
  const harness = await createHarness();
  const mobileContext = await browser.newContext({
    viewport: { width: 320, height: 568 }, reducedMotion: 'reduce',
  });
  const screenContext = await browser.newContext({
    viewport: { width: 320, height: 568 }, reducedMotion: 'reduce',
  });
  const driverPanelRequests = [];
  try {
    const page = await mobileContext.newPage();
    page.on('request', (request) => {
      if (request.url().includes('/assets/driver-panels/')) driverPanelRequests.push(request.url());
    });
    await page.goto(`${harness.origin}/play`);
    await waitScreen(page, 'garage');
    assert.equal(await page.locator('.crew-card').count(), 4);
    assert.equal(await page.locator('.security-circuit-card').count(), 4);
    assert.equal(await page.locator('.difficulty-card').count(), 2);
    assert.equal(await page.locator('.driver-card').count(), 0);
    assert.equal(await page.locator('#join-button').isDisabled(), true);
    assert.deepEqual(
      (await page.locator('.crew-card img').evaluateAll((images) => images.map((image) => new URL(image.src).pathname))).sort(),
      [...expectedTeamCars].sort(),
    );
    for (const image of await page.locator('.crew-card img').all()) {
      await image.scrollIntoViewIfNeeded();
      await image.evaluate((node) => node.decode?.().catch(() => {}));
      assert.ok(await image.evaluate((node) => node.complete && node.naturalWidth > 0));
    }
    await assertNoHorizontalOverflow(page, 'garage-320');
    await assertTouchTargets(page, 'button', 'garage');

    await page.locator('.crew-card').first().click();
    await page.waitForFunction(() => document.querySelectorAll('.driver-card').length === 2);
    assert.equal(await page.locator('.driver-card img').count(), 0, 'reduced motion must omit animated driver panels');
    assert.equal(driverPanelRequests.length, 0, 'reduced motion requested driver WebP media');
    await page.locator('.driver-card').first().click();
    await page.locator('#security-circuit-full-stack').click();
    await page.locator('.difficulty-card').first().click();
    assert.equal(await page.locator('#join-button').isDisabled(), false);
    await page.locator('#join-button').click();
    await waitScreen(page, 'matching');
    assert.equal(await page.locator('[data-testid="match-grid"] .grid-slot').count(), 4);
    assert.equal(await page.locator('[data-testid="match-grid"] .occupied').count(), 1);
    assert.equal(await page.locator('[data-testid="match-grid"] .waiting').count(), 3);
    await assertNoHorizontalOverflow(page, 'matching-320');

    const token = await page.evaluate(() => sessionStorage.getItem('nitro-grid-player-token'));
    assert.match(token, /^[A-Za-z0-9_-]{32}$/);
    const initialState = await api(harness.origin, '/api/state', { token });
    const totalEncounters = initialState.match.totalEncounters;
    assert.ok(totalEncounters >= 10 && totalEncounters <= 15);
    const catalog = await api(harness.origin, '/api/catalog');
    for (let index = 0; index < 3; index += 1) {
      const crew = catalog.crews[index + 1];
      const driver = catalog.drivers.find(({ crewId }) => crewId === crew.id);
      await api(harness.origin, '/api/join', {
        method: 'POST',
        body: {
          deviceId: (index + 100).toString(16).padStart(32, '0'),
          difficulty: 'BEGINNER', securityCircuitId: 'FULL_STACK', crewId: crew.id, driverId: driver.id,
        },
      });
    }

    const screen = await screenContext.newPage();
    await screen.goto(`${harness.origin}/screen`);
    await screen.waitForSelector('#screen-app[data-screen="matching"] [data-testid="screen-board"]');
    assert.equal(await screen.locator('[data-testid="screen-match-grid"] .screen-grid-slot').count(), 4);
    await assertNoHorizontalOverflow(screen, 'screen-matching-320');

    await harness.setNow(300);
    await waitScreen(page, 'grid');
    assert.equal(await page.locator('.start-lights i').count(), 5);
    assert.equal(await page.locator('[data-testid="track-map"] svg').count(), 1);
    assert.equal(await page.locator('[data-testid="leaderboard"] .standing-row').count(), 4);
    assert.equal(await page.locator('.race-marker').count(), 4);
    await assertUniqueMarkerTransforms(page, '[data-testid="track-map"] .race-marker', 'participant grid');
    await screen.waitForSelector('#screen-app[data-screen="grid"] [data-testid="screen-track"]');
    await assertUniqueMarkerTransforms(screen, '[data-testid="screen-track"] .race-marker', 'screen grid');
    await assertNoHorizontalOverflow(page, 'grid-320');
    await assertNoHorizontalOverflow(screen, 'screen-grid-320');

    await harness.setNow(400);
    await waitScreen(page, 'racing');
    await page.waitForSelector('[data-testid="encounter-card"]');
    assert.equal(await page.locator('.race-marker').count(), 4);
    assert.equal(await page.locator('[data-testid="leaderboard"] .standing-row').count(), 4);
    assert.match(await page.locator('#race-speed').textContent(), /^\d+$/);
    assert.equal(await page.locator('#race-lap').textContent(), '1/2');
    assert.match(await page.locator('#race-position').textContent(), /^P[1-4]$/);
    assert.equal(await page.locator('#race-gate').textContent(), `1/${totalEncounters}`);
    assert.equal(await page.locator('#race-overtake').count(), 1);
    await assertUniqueMarkerTransforms(page, '[data-testid="track-map"] .race-marker', 'participant first racing');
    await screen.waitForSelector('#screen-app[data-screen="racing"] [data-testid="screen-track"]');
    await assertUniqueMarkerTransforms(screen, '[data-testid="screen-track"] .race-marker', 'screen first racing');
    const durations = await page.locator('.race-marker').evaluateAll((markers) => (
      markers.map((marker) => getComputedStyle(marker).transitionDuration)
    ));
    assert.ok(durations.every((duration) => duration === '0s'), JSON.stringify(durations));
    const firstTransform = await page.locator('.race-marker').first().getAttribute('transform');
    await harness.setNow(500);
    await page.waitForTimeout(600);
    const movedTransform = await page.locator('.race-marker').first().getAttribute('transform');
    assert.notEqual(movedTransform, firstTransform, 'SVG car marker did not move with modeled progress');
    await assertNoHorizontalOverflow(page, 'racing-320');

    let liveState = await api(harness.origin, '/api/state', { token });
    const firstTask = liveState.tasks[0];
    const wrongChoice = firstTask.options.find(({ id }) => id !== answers.get(firstTask.id)).id;
    const directVerdict = await api(harness.origin, '/api/action', {
      token,
      method: 'POST',
      body: {
        matchId: initialState.match.id,
        task: firstTask.id,
        choice: wrongChoice,
        actionId: 'ui_recovery_0001',
      },
    });
    assert.equal(directVerdict.feedback.correct, false);
    await page.reload();
    await waitScreen(page, 'feedback');
    await page.waitForSelector('[data-testid="feedback-card"].wrong');
    const recoveredText = await page.locator('[data-testid="feedback-card"]').textContent();
    assert.match(recoveredText, /LOST TIME|근거와 다른 선택/);
    assert.ok(recoveredText.includes(directVerdict.feedback.explanation));
    await assertNoHorizontalOverflow(page, 'wrong-feedback-320');
    await page.locator('#feedback-continue').click();
    await waitScreen(page, 'racing');
    await page.waitForTimeout(1_100);
    assert.equal(await page.locator('[data-testid="feedback-card"]').count(), 0,
      'dismissed recovered feedback reappeared for the same task');
    liveState = await api(harness.origin, '/api/state', { token });
    assert.equal(liveState.tasks[0].id, firstTask.id);
    assert.equal(liveState.tasks[0].selected, wrongChoice);
    assert.equal(liveState.tasks[0].feedback.correct, false);

    await harness.setNow(700);
    liveState = await api(harness.origin, '/api/state', { token });
    const secondTask = liveState.tasks[0];
    assert.notEqual(secondTask.id, firstTask.id);
    await page.waitForSelector(`#confirm-${secondTask.id}`);
    const correctIndex = secondTask.options.findIndex(({ id }) => id === answers.get(secondTask.id));
    await page.locator('.answer-card').nth(correctIndex).click();
    await page.locator(`#confirm-${secondTask.id}`).click();
    await waitScreen(page, 'feedback');
    await page.waitForSelector('[data-testid="feedback-card"].correct');
    assert.match(await page.locator('[data-testid="feedback-card"]').textContent(), /CLEAN OVERTAKE|레이싱 라인이/);
    await page.locator('#feedback-continue').click();

    const beforeTrend = await api(harness.origin, '/api/state', { token });
    await harness.setNow(400 + Math.ceil(totalEncounters * 0.56) * 300);
    await page.waitForFunction(() => document.querySelector('#race-lap')?.textContent === '2/2');
    assert.equal(await page.locator('#race-lap').textContent(), '2/2');
    const trendState = await api(harness.origin, '/api/state', { token });
    assert.ok(trendState.match.encounterIndex >= 5);
    assert.equal(trendState.race.answered, beforeTrend.race.answered);
    assert.equal(trendState.race.correct, beforeTrend.race.correct);
    assert.equal(trendState.trend.scoring, false);
    assert.equal(new URL(trendState.trend.sourceUrl).protocol, 'https:');
    const trendCard = page.locator('[data-testid="trend-briefing"]');
    await trendCard.waitFor();
    assert.equal(await trendCard.locator('h2').textContent(), trendState.trend.title);
    assert.ok((await trendCard.locator('.trend-summary').textContent()).includes(trendState.trend.summary));
    assert.equal(await trendCard.locator('.trend-actions li').count(), trendState.trend.actions.length);
    const trendText = await trendCard.textContent();
    assert.match(trendText, /비채점.*미반영/);
    assert.ok(trendText.includes(trendState.trend.sourceName));
    assert.ok(trendText.includes(trendState.trend.asOf));
    const trendLink = trendCard.locator('.trend-source a');
    assert.equal(new URL(await trendLink.getAttribute('href')).protocol, 'https:');
    assert.equal(await trendLink.getAttribute('target'), '_blank');
    assert.match(await trendLink.getAttribute('rel'), /noopener/);
    assert.equal(await page.evaluate(() => {
      const primary = document.querySelector('[data-testid="encounter-card"], [data-testid="feedback-card"], .waiting-card');
      const trend = document.querySelector('[data-testid="trend-briefing"]');
      return Boolean(primary && trend && (primary.compareDocumentPosition(trend) & Node.DOCUMENT_POSITION_FOLLOWING));
    }), true, 'trend briefing must follow the scored task/feedback/waiting surface');
    await screen.waitForSelector('#screen-app[data-screen="racing"] [data-testid="screen-track"]');
    assert.equal(await screen.locator('[data-testid="screen-track"] .race-marker').count(), 4);
    assert.equal(await screen.locator('[data-testid="screen-leaderboard"] .screen-order-row').count(), 4);
    assert.equal(await screen.locator('[data-testid="screen-telemetry"]').count(), 1);
    const screenTrend = screen.locator('[data-testid="screen-trend"]');
    await screenTrend.waitFor();
    assert.equal(await screenTrend.locator('h2').textContent(), trendState.trend.title);
    assert.match(await screenTrend.textContent(), /비채점.*미반영/);
    await assertNoHorizontalOverflow(page, 'participant-trend-320');
    await assertNoHorizontalOverflow(screen, 'screen-racing-320');

    await harness.setNow(400 + totalEncounters * 300);
    await waitScreen(page, 'result');
    assert.equal(await page.locator('[data-testid="result-card"]').count(), 1);
    assert.equal(await page.locator('[data-testid="result-leaderboard"] .standing-row').count(), 4);
    assert.equal(await page.locator('[data-testid="result-review"] .review-item').count(), totalEncounters);
    await assertNoHorizontalOverflow(page, 'result-320');
    await screen.waitForSelector('#screen-app[data-screen="result"] [data-testid="screen-board"]');
    await assertNoHorizontalOverflow(screen, 'screen-result-320');

    await page.locator('[data-testid="result-card"] .primary-button').click();
    await waitScreen(page, 'garage');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('nitro-grid-player-token')), null);
    assert.notEqual(initialState.match.id, null);
  } finally {
    await mobileContext.close();
    await screenContext.close();
    await harness.close();
  }
}

async function auditRetirementRendering() {
  const harness = await createHarness();
  const mobileContext = await browser.newContext({ viewport: { width: 320, height: 568 }, reducedMotion: 'reduce' });
  const screenContext = await browser.newContext({ viewport: { width: 320, height: 568 }, reducedMotion: 'reduce' });
  try {
    const identity = harness.store.join(
      null,
      'f'.repeat(32),
      'BEGINNER',
      CREWS[0].id,
      DRIVERS.find(({ crewId }) => crewId === CREWS[0].id).id,
      'BLUE',
    );
    harness.store.startWithAi(identity.token);
    const player = harness.store.players.get(identity.token);
    const match = harness.store.matches.get(identity.matchId);
    const deck = harness.store.deckFor(match, player.difficulty, player.securityCircuitId);
    deck.forEach((question, index) => {
      const choice = index < 7
        ? question.options.find(({ id }) => id !== question.correctOptionId).id
        : question.correctOptionId;
      match.actions.set(`${player.id}:${question.id}`, {
        playerId: player.id,
        task: question.id,
        choice,
        correct: index >= 7,
        at: 0,
      });
    });
    harness.store.enterResult(match, 200);

    const page = await mobileContext.newPage();
    await page.goto(`${harness.origin}/play`);
    await page.evaluate((token) => sessionStorage.setItem('nitro-grid-player-token', token), identity.token);
    await page.reload();
    await waitScreen(page, 'result');
    assert.equal(await page.locator('[data-testid="result-card"] h1').textContent(), 'RETIRED');
    assert.equal(await page.locator('[data-testid="result-card"] .result-score-grid strong').nth(1).textContent(), 'RET');
    assert.equal(await page.locator('[data-testid="result-leaderboard"] .standing-row.me .standing-position').textContent(), 'RET');
    assert.match(await page.locator('[data-testid="result-leaderboard"] .standing-row.me .standing-gap').textContent(), /RETIRED/);
    assert.doesNotMatch(await page.locator('[data-testid="result-card"]').textContent(), /P(?:–|null|undefined)/);
    await assertNoHorizontalOverflow(page, 'retired-result-320');

    const screen = await screenContext.newPage();
    await screen.goto(`${harness.origin}/screen`);
    await screen.waitForSelector('.screen-order-row.retired');
    assert.equal(await screen.locator('.screen-order-row.retired .screen-order-position').first().textContent(), 'RET');
    assert.match(await screen.locator('.screen-order-row.retired .screen-order-gap').first().textContent(), /RETIRED/);
    assert.doesNotMatch(await screen.locator('[data-testid="screen-board"]').textContent(), /P(?:–|null|undefined)/);
    await assertNoHorizontalOverflow(screen, 'retired-screen-320');
  } finally {
    await mobileContext.close();
    await screenContext.close();
    await harness.close();
  }
}

async function auditDriverCardGeometry() {
  const harness = await createHarness();
  try {
    for (const width of [320, 360, 375]) {
      const context = await browser.newContext({
        viewport: { width, height: 800 }, reducedMotion: 'no-preference',
      });
      try {
        const page = await context.newPage();
        await page.goto(`${harness.origin}/play`);
        await waitScreen(page, 'garage');
        await page.locator('.crew-card').first().click();
        await page.waitForFunction(() => document.querySelectorAll('.driver-card img').length === 2);
        await page.locator('.driver-card img').evaluateAll(async (images) => {
          await Promise.all(images.map((image) => image.decode?.().catch(() => {})));
        });
        const cards = await page.locator('.driver-card').evaluateAll((elements) => elements.map((card) => {
          const image = card.querySelector('img');
          const copy = card.querySelector('.selection-copy');
          const imageRect = image.getBoundingClientRect();
          const copyRect = copy.getBoundingClientRect();
          return {
            imageBottom: imageRect.bottom,
            copyTop: copyRect.top,
            cardOverflow: card.scrollWidth - card.clientWidth,
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight,
          };
        }));
        assert.equal(cards.length, 2, `${width}px did not render both driver cards`);
        for (const card of cards) {
          assert.ok(card.naturalWidth > 0 && card.naturalHeight > 0,
            `${width}px driver media did not decode: ${JSON.stringify(card)}`);
          assert.ok(card.imageBottom <= card.copyTop + 1,
            `${width}px driver image overlaps the name panel: ${JSON.stringify(card)}`);
          assert.ok(card.cardOverflow <= 1,
            `${width}px driver card overflows horizontally: ${JSON.stringify(card)}`);
        }
        const documentWidth = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth,
        }));
        assert.ok(documentWidth.scrollWidth <= documentWidth.clientWidth + 1
          && documentWidth.bodyScrollWidth <= documentWidth.clientWidth + 1,
        `${width}px garage document overflows horizontally: ${JSON.stringify(documentWidth)}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await harness.close();
  }
}

try {
  browser = await chromium.launch({ executablePath, headless: true });
  assert.equal(CIRCUITS.length, 3);
  assert.equal(CREWS.length, 4);
  assert.equal(DRIVERS.length, 8);
  await auditDriverCardGeometry();
  await auditHeatFlow();
  await auditRetirementRendering();
  console.log('UI layout checks passed at 320x568 for garage, heat matching, grid, race, feedback, result, RETIRED, retry, and live screen.');
} finally {
  await browser?.close();
}
