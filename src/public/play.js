const app = document.querySelector('#app');
const connection = document.querySelector('#connection');
const notice = document.querySelector('#notice');

const TOKEN_KEY = 'nitro-grid-player-token';
const DEVICE_KEY = 'nitro-grid-device-id';
const LABEL_CACHE_KEY = 'nitro-grid-option-labels';
const SVG_NS = 'http://www.w3.org/2000/svg';
const DEFAULT_PATH = 'M 178 508 C 80 430 92 236 222 150 C 334 76 452 112 520 186 C 600 274 704 104 838 136 C 950 164 944 338 858 426 C 770 516 650 540 536 480 C 418 418 300 606 178 508 Z';
const STATUS_LABELS = {
  MATCHING: 'MATCHMAKING', GRID: 'STARTING GRID', RACING: 'LIVE RACE',
  RESULT: 'CHEQUERED FLAG', COMPLETE: 'RACE COMPLETE',
};
const STABLE_SCREENS = Object.freeze(['garage', 'matching', 'grid', 'racing', 'feedback', 'result', 'complete']);
const DIFFICULTY_COPY = {
  BEGINNER: ['초급 · Guided', '근거에 짧은 판단 주석이 표시됩니다.'],
  ADVANCED: ['고급 · Analyst', '같은 문제를 원문 기술 증거로 읽습니다.'],
};
const TEAM_CARS = {
  'red-bull-racing': { model: 'RB22', media: '/assets/team-cars/red-bull-rb22-2026.webp' },
  ferrari: { model: 'SF-26', media: '/assets/team-cars/ferrari-sf26-2026.webp' },
  mercedes: { model: 'W17', media: '/assets/team-cars/mercedes-w17-2026.webp' },
  mclaren: { model: 'MCL40', media: '/assets/team-cars/mclaren-mcl40-2026.webp' },
};

let catalog = null;
let playerToken = sessionGet(TOKEN_KEY);
let state = null;
let busy = false;
let renderKey = '';
let feedbackGate = null;
let noticeExpiresAt = 0;
let memoryDeviceId = null;
const pendingChoices = new Map();
const optionLabels = new Map(savedOptionLabels());
const dismissedFeedbackTasks = new Set();
const garage = { difficulty: null, crewId: null, driverId: null };

function sessionGet(key) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

function sessionSet(key, value) {
  try { sessionStorage.setItem(key, value); } catch {}
}

function sessionRemove(key) {
  try { sessionStorage.removeItem(key); } catch {}
}

function savedOptionLabels() {
  try {
    const value = JSON.parse(sessionGet(LABEL_CACHE_KEY) ?? '{}');
    return Object.entries(value).filter(([key, label]) => typeof key === 'string' && typeof label === 'string');
  } catch { return []; }
}

function randomDeviceId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function deviceId() {
  if (memoryDeviceId) return memoryDeviceId;
  try {
    const stored = localStorage.getItem(DEVICE_KEY);
    if (/^[a-f0-9]{32}$/.test(stored ?? '')) return stored;
    const created = randomDeviceId();
    localStorage.setItem(DEVICE_KEY, created);
    return created;
  } catch {
    memoryDeviceId = randomDeviceId();
    return memoryDeviceId;
  }
}

function resetDeviceId() {
  memoryDeviceId = null;
  try { localStorage.removeItem(DEVICE_KEY); } catch {}
}

function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = String(text);
  return node;
}

function svgElement(tag, className = '') {
  const node = document.createElementNS(SVG_NS, tag);
  if (className) node.setAttribute('class', className);
  return node;
}

function reduceMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function assetPath(kind, id) {
  return /^[a-z0-9-]+$/.test(id ?? '') ? `/assets/${kind}/${id}.svg` : '';
}

function driverMedia(driver) {
  if (typeof driver?.media === 'string' && /^\/assets\/driver-panels\/[a-z0-9-]+\.webp$/.test(driver.media)) return driver.media;
  return /^[a-z0-9-]+$/.test(driver?.id ?? '') ? `/assets/driver-panels/${driver.id}.webp` : '';
}

function setConnection(text, online = false) {
  connection.textContent = text;
  connection.classList.toggle('online', online);
}

function setNotice(text = '', durationMs = 6000) {
  notice.textContent = text;
  notice.hidden = text.length === 0;
  noticeExpiresAt = text ? Date.now() + durationMs : 0;
}

function clearExpiredNotice() {
  if (!notice.hidden && noticeExpiresAt && Date.now() >= noticeExpiresAt) setNotice();
}

function formatTime(milliseconds) {
  const seconds = Math.max(0, Math.ceil((Number(milliseconds) || 0) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function setText(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.textContent = String(value);
}

function matchOf(current) {
  return current?.match ?? current?.round ?? {};
}

function statusOf(current) {
  return matchOf(current).status ?? matchOf(current).phase ?? 'MATCHING';
}

function circuitOf(current) {
  return matchOf(current).circuit ?? current?.circuit ?? current?.track ?? catalog?.circuits?.[0] ?? {};
}

function racersOf(current) {
  const racers = current?.race?.racers ?? matchOf(current).racers ?? current?.racers ?? [];
  return [...racers].sort((left, right) => (left.position ?? 99) - (right.position ?? 99));
}

function myRacer(current) {
  const racers = racersOf(current);
  return racers.find((racer) => racer.id === current?.player?.id || racer.id === current?.player?.racerId || racer.isPlayer)
    ?? racers.find((racer) => racer.callsign === current?.player?.callsign)
    ?? racers.find((racer) => !racer.isAi)
    ?? null;
}

function crewFor(id) {
  return (catalog?.crews ?? []).find((crew) => crew.id === id) ?? null;
}

function driverFor(id) {
  return (catalog?.drivers ?? []).find((driver) => driver.id === id) ?? null;
}

function racerName(racer) {
  if (!racer) return 'OPEN SLOT';
  return racer.callsign ?? racer.name ?? driverFor(racer.driverId)?.name ?? (racer.isAi ? 'AI DRIVER' : 'RACER');
}

function rememberOptionLabels(task) {
  let changed = false;
  for (const option of task?.options ?? []) {
    const label = option.label ?? option.text ?? option.id;
    const key = `${task.id}:${option.id}`;
    if (optionLabels.get(key) !== label) {
      optionLabels.set(key, label);
      changed = true;
    }
  }
  if (changed) sessionSet(LABEL_CACHE_KEY, JSON.stringify(Object.fromEntries(optionLabels)));
}

function rememberedOptionLabel(taskId, optionId, fallback = '') {
  if (!optionId) return fallback;
  return optionLabels.get(`${taskId}:${optionId}`) ?? fallback ?? optionId;
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch { return ''; }
}

async function api(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (playerToken) headers.Authorization = `Bearer ${playerToken}`;
  if (options.body) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, { ...options, headers, cache: 'no-store' });
  const body = await response.json().catch(() => ({ error: 'invalid_response' }));
  if (!response.ok) throw Object.assign(new Error(body.error ?? 'request_failed'), { status: response.status, code: body.error });
  return body;
}

function selectionButton({ id, className, selected, label, detail, image, onClick }) {
  const button = element('button', `${className}${selected ? ' selected' : ''}`);
  button.type = 'button';
  button.id = id;
  button.setAttribute('aria-pressed', String(selected));
  if (image) {
    const img = element('img');
    img.src = image.src;
    img.alt = image.alt;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', () => {
      button.classList.add('media-missing');
      img.remove();
    }, { once: true });
    button.append(img);
  }
  const copy = element('span', 'selection-copy');
  copy.append(element('strong', '', label), element('small', '', detail));
  button.append(copy);
  button.addEventListener('click', onClick);
  return button;
}

function garageComplete() {
  const driver = driverFor(garage.driverId);
  return Boolean(garage.difficulty && garage.crewId && driver?.crewId === garage.crewId);
}

function renderLobby({ focusId = null } = {}) {
  renderKey = 'garage';
  app.dataset.screen = 'garage';
  app.replaceChildren();
  const hero = element('article', 'landing-card garage-hero');
  hero.append(
    element('div', 'eyebrow', '4-CAR SECURITY SPRINT · 2 LAPS'),
    element('h1', '', '증거를 읽고\n트랙에서 추월하라.'),
    element('p', 'lead', '4대가 같은 서킷에서 10개의 보안 판단으로 겨룹니다. 30–45초 동안 참가자를 모으고, 빈자리는 AI 드라이버가 채웁니다.'),
  );
  const rules = element('div', 'quick-rules');
  [['04', '한 경기 차량'], ['10', '보안 인카운터'], ['00:45', '최대 매칭']].forEach(([value, label]) => {
    const item = element('div');
    item.append(element('strong', '', value), element('span', '', label));
    rules.append(item);
  });
  hero.append(rules);

  const form = element('article', 'garage-card');
  const crewSection = element('section', 'garage-section');
  crewSection.append(element('div', 'section-number', '01'), element('h2', '', '팀 선택'), element('p', 'section-help', '차량 성능은 동일합니다. 좋아하는 리버리를 고르세요.'));
  const crewGrid = element('div', 'crew-grid');
  for (const crew of catalog?.crews ?? []) {
    const fallbackCar = TEAM_CARS[crew.id] ?? {};
    const car = {
      model: crew.model ?? fallbackCar.model ?? '2026 CAR',
      media: crew.photoAsset ?? fallbackCar.media ?? '',
    };
    crewGrid.append(selectionButton({
      id: `crew-${crew.id}`,
      className: `crew-card crew-${crew.id}`,
      selected: garage.crewId === crew.id,
      label: crew.name,
      detail: `${car.model} · ${crew.trait ?? '2026 race car'}`,
      image: car.media ? { src: car.media, alt: `${crew.name} ${car.model} 2026 머신` } : null,
      onClick: () => {
        garage.crewId = crew.id;
        if (driverFor(garage.driverId)?.crewId !== crew.id) garage.driverId = null;
        renderLobby({ focusId: `crew-${crew.id}` });
      },
    }));
  }
  crewSection.append(crewGrid);

  const driverSection = element('section', 'garage-section');
  driverSection.append(element('div', 'section-number', '02'), element('h2', '', '드라이버 선택'), element('p', 'section-help', '선택한 팀의 두 드라이버 중 한 명을 선택하세요.'));
  const driverGrid = element('div', 'driver-grid');
  const teamDrivers = (catalog?.drivers ?? []).filter((driver) => driver.crewId === garage.crewId);
  if (!garage.crewId) {
    driverGrid.append(element('p', 'driver-placeholder', '먼저 팀을 선택하면 드라이버 패널이 열립니다.'));
  } else {
    for (const driver of teamDrivers) {
      driverGrid.append(selectionButton({
        id: `driver-${driver.id}`,
        className: `driver-card crew-${driver.crewId}`,
        selected: garage.driverId === driver.id,
        label: driver.name,
        detail: `#${driver.number ?? '—'} · ${driver.country ?? ''}`,
        image: reduceMotion() ? null : { src: driverMedia(driver), alt: `${driver.name} 애니메이션 패널` },
        onClick: () => { garage.driverId = driver.id; renderLobby({ focusId: `driver-${driver.id}` }); },
      }));
    }
  }
  driverSection.append(driverGrid);

  const difficultySection = element('section', 'garage-section');
  difficultySection.append(element('div', 'section-number', '03'), element('h2', '', '난이도 선택'));
  const difficultyGrid = element('div', 'difficulty-grid');
  for (const difficulty of catalog?.difficulties ?? ['BEGINNER', 'ADVANCED']) {
    const [label, detail] = DIFFICULTY_COPY[difficulty] ?? [difficulty, '정답과 점수는 같습니다.'];
    difficultyGrid.append(selectionButton({
      id: `difficulty-${difficulty.toLowerCase()}`,
      className: 'difficulty-card', selected: garage.difficulty === difficulty,
      label, detail,
      onClick: () => { garage.difficulty = difficulty; renderLobby({ focusId: `difficulty-${difficulty.toLowerCase()}` }); },
    }));
  }
  difficultySection.append(difficultyGrid);

  const join = element('button', 'primary-button', garageComplete() ? 'FIND RACE · 4대 매칭 시작' : '팀 · 드라이버 · 난이도를 선택하세요');
  join.id = 'join-button';
  join.type = 'button';
  join.disabled = !garageComplete();
  join.addEventListener('click', joinRace);
  form.append(crewSection, driverSection, difficultySection, join);
  form.append(element('p', 'privacy-note', '계정이나 이름은 받지 않습니다. 45초 안에 4명이 모이지 않으면 AI가 자동 합류합니다.'));
  app.append(hero, form);
  if (focusId) requestAnimationFrame(() => document.getElementById(focusId)?.focus({ preventScroll: true }));
}

async function loadCatalog() {
  try {
    catalog = await api('/api/catalog');
    if (!Array.isArray(catalog?.crews) || !Array.isArray(catalog?.drivers)) throw new Error('invalid_catalog');
    setConnection('● NITRO GRID 온라인', true);
    renderLobby();
  } catch {
    setConnection('Race Control 재연결 중…');
    setNotice('차고 정보를 불러오지 못했습니다. 자동으로 다시 시도합니다.');
  }
}

async function joinRace() {
  if (busy || !garageComplete()) return;
  busy = true;
  setNotice();
  document.querySelector('#join-button')?.setAttribute('disabled', '');
  try {
    const identity = await api('/api/join', {
      method: 'POST',
      body: JSON.stringify({ deviceId: deviceId(), ...garage }),
    });
    playerToken = identity.token;
    sessionSet(TOKEN_KEY, playerToken);
    state = null;
    renderKey = '';
    await refresh();
  } catch (error) {
    const messages = {
      capacity: '모든 매칭 슬롯이 찼습니다. 잠시 뒤 다시 시도해 주세요.',
      invalid_crew: '선택한 팀을 사용할 수 없습니다.',
      invalid_driver: '선택한 드라이버를 사용할 수 없습니다.',
      invalid_difficulty: '선택한 난이도를 사용할 수 없습니다.',
      join_rate_limited: '동시 입장이 많습니다. 잠시 뒤 다시 눌러 주세요.',
    };
    setNotice(messages[error.code] ?? '매칭에 실패했습니다. 연결을 확인해 주세요.');
    renderLobby();
  } finally { busy = false; }
}

function identityBar(current) {
  const match = matchOf(current);
  const circuit = circuitOf(current);
  const crew = current.player?.crew?.name ?? crewFor(current.player?.crewId)?.name ?? 'TEAM';
  const bar = element('header', 'race-identity');
  const identity = element('div');
  identity.append(element('span', '', `${crew} · ${circuit.shortLabel ?? circuit.name ?? 'CIRCUIT'}`), element('strong', '', current.player?.callsign ?? 'DRIVER'));
  const timer = element('div', 'race-timer');
  timer.append(element('span', '', STATUS_LABELS[statusOf(current)] ?? statusOf(current)), element('b', '', formatTime(displayRemainingMs(current))));
  timer.querySelector('b').id = 'race-clock';
  bar.append(identity, timer);
  return bar;
}

function queueRacers(current) {
  const actual = racersOf(current);
  const humanCount = Number(matchOf(current).humanCount ?? actual.filter((racer) => !racer.isAi).length) || 0;
  const aiCount = Number(matchOf(current).aiCount ?? actual.filter((racer) => racer.isAi).length) || 0;
  const slots = [...actual];
  while (slots.length < 4) slots.push(null);
  return { slots: slots.slice(0, 4), humanCount, aiCount };
}

function renderMatchmaking(current) {
  const match = matchOf(current);
  const { slots, humanCount } = queueRacers(current);
  const card = element('article', 'match-card');
  card.append(element('div', 'eyebrow', 'MATCHMAKING · EXACTLY 4 CARS'), element('h1', '', `${humanCount}/4 드라이버 준비`));
  card.append(element('p', 'match-copy', '최소 30초 동안 참가자를 기다립니다. 4명이 모이면 출발하고, 45초가 되면 빈자리를 AI가 채웁니다.'));
  const grid = element('div', 'match-grid');
  grid.dataset.testid = 'match-grid';
  slots.forEach((racer, index) => {
    const slot = element('article', `grid-slot${racer ? ' occupied' : ' waiting'}${racer?.isAi ? ' ai' : ''}`);
    slot.append(element('span', 'grid-number', `P${index + 1}`));
    if (racer) {
      const car = element('img');
      car.src = assetPath('cars', racer.crewId ?? 'red-bull-racing');
      car.alt = '';
      slot.append(car, element('strong', '', racerName(racer)), element('small', '', racer.isAi ? 'AI DRIVER' : 'HUMAN DRIVER'));
    } else {
      slot.append(element('div', 'slot-radar', '＋'), element('strong', '', 'OPEN SLOT'), element('small', '', '45초 후 AI 투입'));
    }
    grid.append(slot);
  });
  card.append(grid);
  const timing = element('div', 'match-timing');
  const min = element('div');
  min.append(element('span', '', '최소 대기'), element('b', '', formatTime(match.minWaitRemainingMs ?? 0)));
  const max = element('div');
  max.append(element('span', '', 'AI 투입까지'), element('b', '', formatTime(match.maxWaitRemainingMs ?? match.startsInMs ?? 0)));
  max.querySelector('b').id = 'match-clock';
  timing.append(min, max);
  card.append(timing, element('p', 'match-footnote', '매칭 창을 닫아도 같은 브라우저로 다시 열면 현재 그리드에 복귀합니다.'));
  return card;
}

function createTrackMap(current, className = '') {
  const circuit = circuitOf(current);
  const wrapper = element('div', `circuit-map${className ? ` ${className}` : ''}`);
  wrapper.dataset.testid = 'track-map';
  const svg = svgElement('svg', 'track-svg');
  svg.setAttribute('viewBox', '0 0 1000 620');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${circuit.name ?? '레이스 서킷'}에서 주행 중인 4대 차량`);
  const shadow = svgElement('path', 'track-shadow');
  const asphalt = svgElement('path', 'track-asphalt');
  const guide = svgElement('path', 'track-guide');
  const path = circuit.path ?? DEFAULT_PATH;
  for (const node of [shadow, asphalt, guide]) node.setAttribute('d', path);
  guide.id = 'race-path';
  svg.append(shadow, asphalt, guide);
  const start = svgElement('g', 'start-line');
  start.setAttribute('transform', 'translate(178 508) rotate(42)');
  for (let index = 0; index < 8; index += 1) {
    const block = svgElement('rect', index % 2 ? 'start-dark' : 'start-light');
    block.setAttribute('x', String(index * 9 - 36));
    block.setAttribute('y', '-18');
    block.setAttribute('width', '9');
    block.setAttribute('height', '36');
    start.append(block);
  }
  svg.append(start);
  for (const racer of racersOf(current)) {
    const marker = svgElement('g', `race-marker${racer.isAi ? ' ai' : ''}${racer.isPlayer ? ' me' : ''}`);
    marker.dataset.racerId = racer.id ?? racer.callsign;
    const image = svgElement('image', 'marker-car');
    image.setAttribute('href', assetPath('cars', racer.crewId ?? 'red-bull-racing'));
    image.setAttribute('x', '-45');
    image.setAttribute('y', '-18');
    image.setAttribute('width', '90');
    image.setAttribute('height', '36');
    const badge = svgElement('circle', 'marker-badge');
    badge.setAttribute('cx', '-48');
    badge.setAttribute('cy', '-1');
    badge.setAttribute('r', '13');
    const text = svgElement('text', 'marker-position');
    text.setAttribute('x', '-48');
    text.setAttribute('y', '4');
    text.setAttribute('text-anchor', 'middle');
    text.textContent = String(racer.position ?? '–');
    marker.append(image, badge, text);
    svg.append(marker);
  }
  wrapper.append(svg);
  return wrapper;
}

function raceStandings(current, resultMode = false) {
  const panel = element('section', `race-standings${resultMode ? ' result-standings' : ''}`);
  panel.id = resultMode ? 'result-standings' : 'race-standings';
  panel.dataset.testid = resultMode ? 'result-leaderboard' : 'leaderboard';
  for (const racer of racersOf(current)) {
    const row = element('article', `standing-row${racer.isPlayer ? ' me' : ''}${racer.isAi ? ' ai' : ''}`);
    row.dataset.racerId = racer.id ?? racer.callsign;
    const position = element('b', 'standing-position', `P${racer.position ?? '–'}`);
    const copy = element('div');
    copy.append(element('strong', '', racerName(racer)), element('small', '', racer.isAi ? 'AI' : driverFor(racer.driverId)?.name ?? 'HUMAN'));
    const gap = element('span', 'standing-gap', racer.position === 1 ? 'LEADER' : `+${Math.max(0, Math.round(racer.gapMeters ?? 0))}m`);
    row.append(position, copy, gap);
    panel.append(row);
  }
  return panel;
}

function raceDashboard(current) {
  const circuit = circuitOf(current);
  const race = current.race ?? {};
  const me = myRacer(current) ?? race;
  const dashboard = element('article', 'race-dashboard');
  const head = element('header', 'circuit-head');
  const copy = element('div');
  copy.append(element('span', '', circuit.location ?? 'SECURITY GRAND PRIX'), element('h2', '', circuit.name ?? 'NITRO CIRCUIT'));
  const specs = element('div', 'circuit-specs');
  specs.append(element('b', '', `${circuit.lengthKm ?? '—'} km`), element('span', '', `MAX ${circuit.maxSpeedKph ?? 340} km/h`));
  head.append(copy, specs);
  dashboard.append(head, createTrackMap(current));

  const telemetry = element('section', 'race-telemetry');
  telemetry.dataset.testid = 'telemetry';
  const speed = element('div', 'speedometer');
  speed.append(element('span', '', 'SPEED'), element('strong', '', Math.round(me.speedKph ?? race.speedKph ?? 0)), element('small', '', 'km/h'));
  speed.querySelector('strong').id = 'race-speed';
  const meter = document.createElement('meter');
  meter.id = 'speed-meter';
  meter.min = '0';
  meter.max = String(circuit.maxSpeedKph ?? 360);
  meter.value = String(me.speedKph ?? race.speedKph ?? 0);
  speed.append(meter);
  const cells = element('div', 'telemetry-cells');
  const trackProgress = clamp(me.trackProgress ?? me.progress ?? race.trackProgress ?? race.progress, 0, 0.9999);
  const gapMeters = Math.max(0, Math.round(me.gapMeters ?? race.gapMeters ?? 0));
  const entries = [
    ['POSITION', `P${me.position ?? race.position ?? '–'}`, 'race-position'],
    ['LAP', `${me.lap ?? race.lap ?? 1}/${race.totalLaps ?? 2}`, 'race-lap'],
    ['GAP', (me.position ?? race.position) === 1 ? 'LEADER' : `+${gapMeters}m`, 'race-gap'],
    ['BATTERY / RECHARGE', `${Math.round(me.batteryPercent ?? race.batteryPercent ?? 0)}%`, 'race-battery'],
    ['BOOST MODE', me.boostMode ?? race.boostMode ? 'ACTIVE' : 'READY', 'race-boost'],
    ['OVERTAKE MODE', me.overtakeMode ?? race.overtakeMode ? 'ACTIVE' : 'LOCKED', 'race-overtake'],
    ['ACTIVE AERO', me.activeAero ?? race.activeAero ? 'ACTIVE' : 'BALANCED', 'race-aero'],
    ['PIT', (me.pitTimeMs ?? race.pitTimeMs) ? `${((me.pitTimeMs ?? race.pitTimeMs) / 1000).toFixed(1)}s` : '—', 'race-pit'],
    ['SECTOR', `S${Math.floor(trackProgress * 3) + 1}`, 'race-sector'],
    ['GATE', `${Math.min(10, (matchOf(current).encounterIndex ?? 0) + 1)}/10`, 'race-gate'],
  ];
  for (const [label, value, id] of entries) {
    const cell = element('div');
    cell.append(element('span', '', label), element('b', '', value));
    cell.querySelector('b').id = id;
    cells.append(cell);
  }
  telemetry.append(speed, cells);
  dashboard.append(telemetry, raceStandings(current));
  const strip = element('ol', 'encounter-strip');
  strip.setAttribute('aria-label', '10개 보안 인카운터 진행 상황');
  const currentIndex = matchOf(current).encounterIndex ?? current.race?.answered ?? 0;
  for (let index = 0; index < 10; index += 1) {
    const item = element('li', index < currentIndex ? 'done' : index === currentIndex ? 'current' : '', String(index + 1));
    strip.append(item);
  }
  dashboard.append(strip);
  dashboard.append(element('p', 'simulation-note', circuit.disclaimer ?? '공식 서킷 특성에서 영감을 받은 오리지널 압축 시뮬레이션 · 표시 속도와 경로는 실제 telemetry가 아닙니다.'));
  return dashboard;
}

function trendBriefing(trend) {
  const card = element('article', 'trend-briefing');
  card.dataset.testid = 'trend-briefing';
  const head = element('div', 'trend-head');
  head.append(
    element('span', '', trend.eyebrow ?? 'SECURITY TREND'),
    element('b', '', '비채점 브리핑 · 레이스 성능 미반영'),
  );
  card.append(head, element('h2', '', trend.title ?? '최신 보안 동향'));
  if (trend.summary) card.append(element('p', 'trend-summary', trend.summary));
  const actions = Array.isArray(trend.actions) ? trend.actions : [];
  if (actions.length) {
    const actionBlock = element('section', 'trend-actions');
    actionBlock.append(element('span', '', '현장에서 할 일'));
    const list = element('ul');
    for (const action of actions) list.append(element('li', '', action));
    actionBlock.append(list);
    card.append(actionBlock);
  } else if (trend.takeaway) {
    const actionBlock = element('section', 'trend-actions');
    actionBlock.append(element('span', '', '현장에서 할 일'), element('p', '', trend.takeaway));
    card.append(actionBlock);
  }
  const sourceName = trend.sourceName ?? trend.source?.publisher ?? 'SOURCE';
  const sourceDate = trend.asOf ?? trend.source?.publishedAt ?? trend.reviewedAt ?? '날짜 미상';
  const meta = element('div', 'trend-source');
  const sourceCopy = element('div');
  sourceCopy.append(element('span', '', '출처 · 기준일'), element('strong', '', `${sourceName} · ${sourceDate}`));
  meta.append(sourceCopy);
  const sourceUrl = safeHttpsUrl(trend.sourceUrl ?? trend.source?.url);
  if (sourceUrl) {
    const link = element('a', '', '원문 확인 ↗');
    link.href = sourceUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', `${trend.source?.title ?? sourceName} 원문 새 창에서 열기`);
    meta.append(link);
  }
  card.append(meta);
  return card;
}

function startLights(current) {
  const match = matchOf(current);
  const total = catalog?.match?.gridMs ?? 5000;
  const remaining = Number(match.startsInMs ?? total);
  const active = clamp(Math.floor((total - remaining) / 1000) + 1, 0, 5);
  const card = element('article', 'start-card');
  card.append(element('div', 'eyebrow', 'GRID LOCKED · 4 CARS'), element('h1', '', 'LIGHTS OUT을 준비하세요.'));
  const lights = element('div', 'start-lights');
  for (let index = 0; index < 5; index += 1) lights.append(element('i', index < active ? 'on' : ''));
  card.append(lights, element('strong', 'start-countdown', formatTime(remaining)), element('p', '', '10개의 보안 판단이 랩타임, BATTERY, BOOST와 피트 손실을 결정합니다.'));
  card.querySelector('.start-countdown').id = 'grid-clock';
  return card;
}

function evidencePanel(task) {
  const panel = element('section', 'evidence-card');
  panel.append(element('span', 'evidence-label', 'RACE CONTROL EVIDENCE'));
  const evidence = Array.isArray(task.evidence) ? task.evidence : task.evidence ? [task.evidence] : [];
  for (const item of evidence) {
    const block = element('div', 'evidence-block');
    block.append(element('b', '', item.label ?? item.source ?? '증거'));
    block.append(element('pre', '', item.value ?? item.text ?? item.content ?? ''));
    if (item.annotation) block.append(element('p', 'evidence-note', item.annotation));
    panel.append(block);
  }
  if (!evidence.length) panel.append(element('p', 'evidence-empty', '상황 설명과 선택지의 기술 근거를 비교하세요.'));
  return panel;
}

function taskCard(current, task) {
  rememberOptionLabels(task);
  const selected = pendingChoices.get(task.id) ?? task.selected ?? null;
  const locked = task.selected != null;
  const encounter = task.gridPosition ?? (matchOf(current).encounterIndex ?? 0) + 1;
  const card = element('article', 'encounter-card');
  card.dataset.testid = 'encounter-card';
  const head = element('div', 'encounter-head');
  head.append(element('span', '', `SECURITY GATE ${encounter}/10`), element('b', '', task.categoryLabel ?? task.category ?? 'RACE CONTROL'));
  card.append(head, element('h2', '', task.question ?? task.prompt ?? task.title ?? '대응을 선택하세요.'), evidencePanel(task));
  const list = element('div', 'answer-list');
  for (const option of task.options ?? []) {
    const button = element('button', `answer-card${selected === option.id ? ' selected' : ''}`);
    button.type = 'button';
    button.disabled = busy || locked;
    button.setAttribute('aria-pressed', String(selected === option.id));
    button.append(element('i', '', String.fromCharCode(65 + list.children.length)), element('strong', '', option.label ?? option.text ?? option.id));
    const detail = option.technical ?? option.detail ?? option.description ?? '';
    if (detail) button.append(element('small', '', detail));
    button.addEventListener('click', () => {
      pendingChoices.set(task.id, option.id);
      renderState(current, { preserveFocus: true });
      requestAnimationFrame(() => document.querySelector(`#confirm-${CSS.escape(task.id)}`)?.focus());
    });
    list.append(button);
  }
  card.append(list);
  if (!locked) {
    const confirm = element('button', 'confirm-button', selected ? 'RADIO · 대응 확정' : '대응을 하나 선택하세요');
    confirm.id = `confirm-${task.id}`;
    confirm.type = 'button';
    confirm.disabled = !selected || busy;
    confirm.addEventListener('click', () => submitAnswer(task, selected));
    card.append(confirm, element('p', 'confirm-note', '클릭 속도보다 근거가 중요합니다. 확정한 선택은 바꿀 수 없습니다.'));
  }
  return card;
}

function recoveredFeedback(task) {
  if (task?.selected == null || !task.feedback) return null;
  rememberOptionLabels(task);
  const selectedOption = task.options?.find((option) => option.id === task.selected);
  const correctId = task.feedback.correctOptionId;
  const correctOption = task.options?.find((option) => option.id === correctId);
  return {
    taskId: task.id,
    visibleUntil: Date.now() + 900,
    category: task.categoryLabel ?? task.category,
    selectedLabel: selectedOption?.label ?? selectedOption?.text ?? task.selected,
    correct: task.feedback.correct === true,
    correctLabel: correctOption?.label ?? correctOption?.text
      ?? rememberedOptionLabel(task.id, correctId, correctId),
    explanation: task.feedback.explanation ?? '서버에 저장된 판정 근거를 복구했습니다.',
    effect: task.feedback.effect ?? null,
    recovered: true,
  };
}

async function submitAnswer(task, choice) {
  if (busy || !state || !task || !choice) return;
  busy = true;
  setNotice();
  document.querySelectorAll('.encounter-card button').forEach((button) => { button.disabled = true; });
  try {
    const matchId = matchOf(state).id ?? matchOf(state).roundId;
    const response = await api('/api/action', {
      method: 'POST',
      body: JSON.stringify({
        matchId,
        roundId: matchId,
        task: task.id,
        choice,
        actionId: `a_${crypto.randomUUID().replaceAll('-', '')}`,
      }),
    });
    const selectedOption = task.options?.find((option) => option.id === choice);
    const correctId = response.feedback?.correctOptionId;
    const correctOption = task.options?.find((option) => option.id === correctId);
    feedbackGate = {
      taskId: task.id,
      visibleUntil: Date.now() + 900,
      category: task.categoryLabel ?? task.category,
      selectedLabel: selectedOption?.label ?? selectedOption?.text ?? choice,
      correct: response.feedback?.correct === true,
      correctLabel: correctOption?.label ?? correctOption?.text ?? rememberedOptionLabel(task.id, correctId, correctId),
      explanation: response.feedback?.explanation ?? '판정 근거가 저장되었습니다.',
      effect: response.feedback?.effect ?? null,
    };
    pendingChoices.delete(task.id);
    renderKey = '';
    await refresh();
  } catch (error) {
    const messages = {
      phase_closed: '이 Security Gate가 종료되었습니다. 최신 레이스로 이동합니다.',
      choice_locked: '이미 확정한 대응입니다.',
      invalid_choice: '허용된 선택지가 아닙니다.',
      idempotency_conflict: '전송 식별자가 충돌했습니다. 새 상태를 불러옵니다.',
    };
    setNotice(messages[error.code] ?? '무전 전송에 실패했습니다. 연결을 확인해 주세요.');
    await refresh();
  } finally { busy = false; }
}

function feedbackPanel(current) {
  const feedback = feedbackGate;
  const card = element('article', `feedback-card ${feedback.correct ? 'correct' : 'wrong'}`);
  card.dataset.testid = 'feedback-card';
  card.append(element('div', 'feedback-flag', feedback.correct ? '✓ CLEAN OVERTAKE' : '× LOST TIME'));
  card.append(element('span', 'feedback-category', feedback.category ?? 'SECURITY DECISION'));
  card.append(element('h2', '', feedback.correct ? '레이싱 라인이 열렸습니다.' : '근거와 다른 선택입니다.'));
  const selected = element('div', 'selected-answer');
  selected.append(element('span', '', '내 선택'), element('strong', '', feedback.selectedLabel));
  card.append(selected);
  if (!feedback.correct && feedback.correctLabel) {
    const expected = element('div', 'correct-answer');
    expected.append(element('span', '', '근거에 맞는 선택'), element('strong', '', feedback.correctLabel));
    card.append(expected);
  }
  card.append(element('p', 'feedback-explanation', feedback.explanation));
  const effect = element('div', 'race-effect');
  effect.append(element('span', '', 'RACE EFFECT'), element('b', '', feedback.effect ?? (feedback.correct ? 'RECHARGE 누적 · BOOST 가능' : 'BOOST 시간을 얻지 못했습니다.')));
  card.append(effect);
  const next = element('button', 'primary-button', '트랙으로 복귀 · 다음 Gate는 자동 전환');
  next.id = 'feedback-continue';
  next.type = 'button';
  next.addEventListener('click', () => {
    dismissedFeedbackTasks.add(feedback.taskId);
    feedbackGate = null;
    renderKey = '';
    renderState(state ?? current);
  });
  card.append(next);
  return card;
}

function waitingForGate(current) {
  const match = matchOf(current);
  const card = element('article', 'waiting-card');
  card.append(element('div', 'eyebrow', `SECURITY GATE ${Math.min(10, (match.encounterIndex ?? 0) + 1)}/10`));
  card.append(element('h2', '', '다른 차량의 무전을 기다립니다.'), element('p', '', '정답은 이미 반영됐습니다. 머신은 계속 달리고 다음 Gate가 열리면 자동으로 이동합니다.'));
  const pulse = element('div', 'radio-pulse');
  pulse.append(element('i'), element('span', '', 'RACE CONTROL SYNC'));
  card.append(pulse);
  return card;
}

function resultReview(result) {
  const rows = result?.review ?? [];
  if (!rows.length) return null;
  const section = element('section', 'result-review');
  section.dataset.testid = 'result-review';
  section.append(element('h2', '', `10개 판단 복기 · ${rows.length}/10`));
  const list = element('div', 'result-review-list');
  rows.forEach((row, index) => {
    const item = element('article', `review-item ${row.correct ? 'correct' : 'wrong'}`);
    const meta = element('div', 'review-meta');
    meta.append(element('span', '', `${String(index + 1).padStart(2, '0')} · ${row.category ?? 'SECURITY'}`), element('b', '', row.correct ? 'CORRECT' : 'REVIEW'));
    item.append(meta, element('h3', '', row.question ?? row.id));
    const answers = element('div', 'review-answers');
    const chosen = row.selectedLabel ?? rememberedOptionLabel(row.id, row.selected, row.selected ?? '미응답');
    const correct = row.correctOptionLabel ?? rememberedOptionLabel(row.id, row.correctOptionId, row.correctOptionId ?? '정답 없음');
    const mine = element('div');
    mine.append(element('span', '', '내 선택'), element('strong', '', chosen));
    answers.append(mine);
    if (!row.correct) {
      const expected = element('div', 'expected');
      expected.append(element('span', '', '정답'), element('strong', '', correct));
      answers.append(expected);
    }
    item.append(answers);
    if (row.explanation) item.append(element('p', '', row.explanation));
    list.append(item);
  });
  section.append(list);
  return section;
}

function resultPanel(current) {
  const result = current.result ?? {};
  const race = current.race ?? {};
  const position = result.position ?? race.position ?? myRacer(current)?.position ?? '–';
  const card = element('article', 'result-card');
  card.dataset.testid = 'result-card';
  card.append(element('div', 'result-kicker', 'CHEQUERED FLAG'), element('h1', '', `P${position} FINISH`));
  card.append(element('p', 'lead', position === 1 ? '보안 판단과 레이스 운영 모두 선두였습니다.' : '순위보다 놓친 근거를 복기하면 다음 레이스가 빨라집니다.'));
  card.append(raceStandings(current, true));
  const scores = element('div', 'result-score-grid');
  const values = [
    [`${race.correct ?? result.correct ?? 0}/10`, '정답'],
    [`${race.accuracy ?? result.accuracy ?? 0}%`, '정확도'],
    [`P${position}`, '최종 순위'],
  ];
  for (const [value, label] of values) {
    const cell = element('div');
    cell.append(element('strong', '', value), element('span', '', label));
    scores.append(cell);
  }
  card.append(scores);
  const review = resultReview(result);
  if (review) card.append(review);
  const again = element('button', 'primary-button', '새 4-CAR 매칭 시작');
  again.type = 'button';
  again.addEventListener('click', () => {
    sessionRemove(TOKEN_KEY);
    sessionRemove(LABEL_CACHE_KEY);
    resetDeviceId();
    playerToken = null;
    state = null;
    feedbackGate = null;
    renderKey = '';
    pendingChoices.clear();
    optionLabels.clear();
    dismissedFeedbackTasks.clear();
    Object.keys(garage).forEach((key) => { garage[key] = null; });
    renderLobby();
  });
  card.append(again);
  return card;
}

function stateKey(current) {
  const match = matchOf(current);
  return JSON.stringify({
    status: statusOf(current),
    encounterIndex: match.encounterIndex,
    humanCount: match.humanCount,
    aiCount: match.aiCount,
    racerIds: racersOf(current).map((racer) => racer.id ?? racer.callsign),
    tasks: current.tasks,
    trend: current.trend?.id ?? null,
    result: current.result,
    feedback: feedbackGate?.taskId ?? null,
  });
}

function displayRemainingMs(current) {
  const match = matchOf(current);
  const status = statusOf(current);
  if (status === 'MATCHING') return match.maxWaitRemainingMs ?? match.startsInMs ?? 0;
  if (status === 'GRID') return match.startsInMs ?? 0;
  if (status === 'RACING') return match.encounterRemainingMs ?? match.remainingMs ?? 0;
  return 0;
}

function renderState(current, { preserveFocus = false } = {}) {
  const status = statusOf(current);
  const screenName = feedbackGate ? 'feedback' : status.toLowerCase();
  app.dataset.screen = STABLE_SCREENS.includes(screenName) ? screenName : 'result';
  app.replaceChildren(identityBar(current));
  if (status === 'MATCHING') {
    app.append(renderMatchmaking(current));
  } else {
    app.append(raceDashboard(current));
    if (status === 'GRID') app.append(startLights(current));
    else if (['RESULT', 'COMPLETE'].includes(status)) {
      if (current.trend) app.append(trendBriefing(current.trend));
      app.append(resultPanel(current));
    } else {
      if (feedbackGate) app.append(feedbackPanel(current));
      else if (current.tasks?.length) app.append(taskCard(current, current.tasks[0]));
      else app.append(waitingForGate(current));
      if (current.trend) app.append(trendBriefing(current.trend));
    }
  }
  updateLive(current);
  if (!preserveFocus) {
    const heading = app.querySelector('h1, h2');
    if (heading) {
      heading.tabIndex = -1;
      requestAnimationFrame(() => heading.focus({ preventScroll: true }));
    }
  }
}

function updateTrackMarkers(current) {
  const svg = document.querySelector('.track-svg');
  const path = svg?.querySelector('.track-guide');
  if (!svg || !path || typeof path.getTotalLength !== 'function') return;
  const length = path.getTotalLength();
  racersOf(current).forEach((racer, index) => {
    const marker = [...svg.querySelectorAll('.race-marker')].find((node) => node.dataset.racerId === String(racer.id ?? racer.callsign));
    if (!marker) return;
    const progress = ((Number(racer.trackProgress ?? racer.progress ?? 0) % 1) + 1) % 1;
    const point = path.getPointAtLength(progress * length);
    const ahead = path.getPointAtLength(((progress * length) + 5) % length);
    const dx = ahead.x - point.x;
    const dy = ahead.y - point.y;
    const magnitude = Math.hypot(dx, dy) || 1;
    const tangentX = dx / magnitude;
    const tangentY = dy / magnitude;
    const normalX = -tangentY;
    const normalY = tangentX;
    const slot = Math.abs(Number(racer.seat ?? racer.position ?? index + 1) - 1) % 4;
    const tangentOffset = [-42, -14, 14, 42][slot];
    const normalOffset = [-18, 18, -18, 18][slot];
    const x = point.x + tangentX * tangentOffset + normalX * normalOffset;
    const y = point.y + tangentY * tangentOffset + normalY * normalOffset;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    marker.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${angle.toFixed(2)})`);
    const label = marker.querySelector('.marker-position');
    if (label) label.textContent = String(racer.position ?? '–');
  });
}

function updateStandings(current) {
  const panel = document.querySelector('#race-standings');
  if (!panel) return;
  for (const racer of racersOf(current)) {
    const row = [...panel.querySelectorAll('.standing-row')].find((node) => node.dataset.racerId === String(racer.id ?? racer.callsign));
    if (!row) continue;
    row.querySelector('.standing-position').textContent = `P${racer.position ?? '–'}`;
    row.querySelector('.standing-gap').textContent = racer.position === 1 ? 'LEADER' : `+${Math.max(0, Math.round(racer.gapMeters ?? 0))}m`;
    panel.append(row);
  }
}

function updateLive(current) {
  const match = matchOf(current);
  const race = current.race ?? {};
  const me = myRacer(current) ?? race;
  const circuit = circuitOf(current);
  setText('#race-clock', formatTime(displayRemainingMs(current)));
  setText('#match-clock', formatTime(match.maxWaitRemainingMs ?? match.startsInMs ?? 0));
  setText('#grid-clock', formatTime(match.startsInMs ?? 0));
  setText('#race-speed', Math.round(me.speedKph ?? race.speedKph ?? 0));
  setText('#race-position', `P${me.position ?? race.position ?? '–'}`);
  setText('#race-lap', `${me.lap ?? race.lap ?? 1}/${race.totalLaps ?? 2}`);
  setText('#race-gap', (me.position ?? race.position) === 1 ? 'LEADER' : `+${Math.max(0, Math.round(me.gapMeters ?? race.gapMeters ?? 0))}m`);
  setText('#race-battery', `${Math.round(me.batteryPercent ?? race.batteryPercent ?? 0)}%`);
  setText('#race-boost', me.boostMode ?? race.boostMode ? 'ACTIVE' : 'READY');
  setText('#race-overtake', me.overtakeMode ?? race.overtakeMode ? 'ACTIVE' : 'LOCKED');
  setText('#race-aero', me.activeAero ?? race.activeAero ? 'ACTIVE' : 'BALANCED');
  setText('#race-pit', (me.pitTimeMs ?? race.pitTimeMs) ? `${((me.pitTimeMs ?? race.pitTimeMs) / 1000).toFixed(1)}s` : '—');
  const trackProgress = clamp(me.trackProgress ?? me.progress ?? race.trackProgress ?? race.progress, 0, 0.9999);
  setText('#race-sector', `S${Math.floor(trackProgress * 3) + 1}`);
  setText('#race-gate', `${Math.min(10, (match.encounterIndex ?? 0) + 1)}/10`);
  const meter = document.querySelector('#speed-meter');
  if (meter) {
    meter.max = String(circuit.maxSpeedKph ?? 360);
    meter.value = String(me.speedKph ?? race.speedKph ?? 0);
  }
  updateTrackMarkers(current);
  updateStandings(current);
}

async function refresh() {
  if (playerToken && state && statusOf(state) === 'COMPLETE') {
    clearExpiredNotice();
    return;
  }
  if (!playerToken) {
    clearExpiredNotice();
    if (!catalog) await loadCatalog();
    else if (renderKey !== 'garage') renderLobby();
    return;
  }
  try {
    const current = await api('/api/state');
    const currentStatus = statusOf(current);
    const currentTask = current.tasks?.[0] ?? null;
    const nextTaskId = currentTask?.id;
    if (feedbackGate && (
      ['RESULT', 'COMPLETE'].includes(currentStatus)
      || (nextTaskId && nextTaskId !== feedbackGate.taskId && Date.now() >= feedbackGate.visibleUntil)
    )) feedbackGate = null;
    if (
      !feedbackGate
      && currentStatus === 'RACING'
      && currentTask?.selected != null
      && currentTask.feedback
      && !dismissedFeedbackTasks.has(currentTask.id)
    ) feedbackGate = recoveredFeedback(currentTask);
    state = current;
    setConnection('● RACE CONTROL 연결됨', true);
    clearExpiredNotice();
    const key = stateKey(current);
    if (key !== renderKey) {
      renderState(current);
      renderKey = key;
    } else updateLive(current);
  } catch (error) {
    if (error.status === 401) {
      sessionRemove(TOKEN_KEY);
      playerToken = null;
      state = null;
      feedbackGate = null;
      renderKey = '';
      setConnection('레이스 세션이 만료되었습니다.');
      setNotice('차고로 돌아왔습니다. 새 매칭을 시작해 주세요.');
      if (!catalog) await loadCatalog(); else renderLobby();
    } else setConnection('Race Control 재연결 중…');
  }
}

setConnection(playerToken ? '레이스 복구 중…' : '차고 연결 중…');
refresh();
setInterval(refresh, 500);
