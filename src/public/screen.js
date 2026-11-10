const app = document.querySelector('#screen-app');
const statusNode = document.querySelector('#screen-status');
const clockNode = document.querySelector('#screen-clock');
const formatNode = document.querySelector('#screen-format');

const SVG_NS = 'http://www.w3.org/2000/svg';
const DEFAULT_PATH = 'M 178 508 C 80 430 92 236 222 150 C 334 76 452 112 520 186 C 600 274 704 104 838 136 C 950 164 944 338 858 426 C 770 516 650 540 536 480 C 418 418 300 606 178 508 Z';
const STATUS_LABELS = {
  MATCHING: 'MATCHMAKING', GRID: 'STARTING GRID', RACING: 'LIVE RACE',
  RESULT: 'CHEQUERED FLAG', COMPLETE: 'RACE COMPLETE', IDLE: 'GRID OPEN',
};

let latest = null;
let catalogs = {};
let renderKey = '';

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

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function catalogEncounterRange() {
  const match = catalogs.match ?? {};
  const range = match.encounterRange ?? {};
  const total = positiveInteger(match.totalEncounters, 10);
  const minimum = positiveInteger(
    match.minEncounters ?? match.minTotalEncounters ?? match.totalEncountersMin ?? range.min,
    total,
  );
  const maximum = positiveInteger(
    match.maxEncounters ?? match.maxTotalEncounters ?? match.totalEncountersMax ?? range.max,
    total,
  );
  return { minimum: Math.min(minimum, maximum), maximum: Math.max(minimum, maximum) };
}

function catalogEncounterLabel() {
  const { minimum, maximum } = catalogEncounterRange();
  return minimum === maximum ? String(minimum) : `${minimum}–${maximum}`;
}

function totalEncounters(item) {
  const match = matchOf(item);
  const fallback = catalogEncounterRange().maximum;
  return positiveInteger(match.totalEncounters ?? raceOf(item).possible, fallback);
}

function encounterNumber(item) {
  const match = matchOf(item);
  const total = totalEncounters(item);
  const number = Number(match.encounterNumber) > 0
    ? Number(match.encounterNumber)
    : Number(match.encounterIndex ?? 0) + 1;
  return clamp(number, 1, total);
}

function formatTime(milliseconds) {
  const seconds = Math.max(0, Math.ceil((Number(milliseconds) || 0) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function assetPath(id) {
  return /^[a-z0-9-]+$/.test(id ?? '') ? `/assets/cars/${id}.svg` : '/assets/cars/red-bull-racing.svg';
}

function matchOf(item) {
  return item?.match ?? item?.round ?? item ?? {};
}

function raceOf(item) {
  return item?.race ?? matchOf(item).race ?? {};
}

function statusOf(item) {
  return matchOf(item).status ?? matchOf(item).phase ?? item?.status ?? 'IDLE';
}

function circuitOf(item) {
  const match = matchOf(item);
  const direct = match.circuit ?? item?.circuit ?? item?.track;
  if (direct && typeof direct === 'object') return direct;
  const id = match.circuitId ?? item?.circuitId ?? direct;
  return (catalogs.circuits ?? catalogs.tracks ?? []).find((circuit) => circuit.id === id) ?? {};
}

function securityCircuitOf(item) {
  const match = matchOf(item);
  const id = match.securityCircuitId ?? item?.securityCircuitId;
  return (catalogs.securityCircuits ?? []).find((entry) => entry.id === id) ?? { id, label: id ?? 'SECURITY' };
}

function difficultyLabel(item) {
  const id = matchOf(item).difficulty ?? item?.difficulty;
  return (catalogs.difficultyDetails ?? []).find((entry) => entry.id === id)?.label ?? id ?? '난이도 대기';
}

function isRetired(racer) {
  return racer?.retired === true || racer?.classificationStatus === 'RETIRED' || racer?.outcome === 'RETIRED';
}

function positionLabel(racer) {
  return isRetired(racer) ? 'RET' : `P${racer?.position ?? '–'}`;
}

function gapLabel(racer) {
  if (isRetired(racer)) return 'RETIRED';
  return racer?.position === 1 ? 'LEADER' : `+${Math.max(0, Math.round(racer?.gapMeters ?? 0))}m`;
}

function racersOf(item) {
  const racers = raceOf(item).racers ?? matchOf(item).racers ?? item?.racers ?? [];
  return [...racers].sort((left, right) => (
    Number(isRetired(left)) - Number(isRetired(right))
    || (left.position ?? 99) - (right.position ?? 99)
    || Number(left.isAi === true) - Number(right.isAi === true)
    || (left.seat ?? 99) - (right.seat ?? 99)
    || String(left.id ?? left.callsign ?? '').localeCompare(String(right.id ?? right.callsign ?? ''))
  ));
}

function racerId(racer) {
  return String(racer?.id ?? racer?.callsign ?? racer?.driverId ?? 'unknown');
}

function driverName(racer) {
  const driver = (catalogs.drivers ?? []).find((entry) => entry.id === racer?.driverId);
  return racer?.callsign ?? racer?.name ?? driver?.name ?? (racer?.isAi ? 'AI DRIVER' : 'RACER');
}

function crewName(id) {
  return (catalogs.crews ?? []).find((crew) => crew.id === id)?.name ?? id ?? 'TEAM';
}

function remainingMs(item) {
  const match = matchOf(item);
  const status = statusOf(item);
  if (status === 'MATCHING') return match.maxWaitRemainingMs ?? match.startsInMs ?? 0;
  if (status === 'GRID') return match.startsInMs ?? 0;
  if (status === 'RACING') return match.encounterRemainingMs ?? match.remainingMs ?? 0;
  return match.remainingMs ?? 0;
}

function collections(state) {
  if (Array.isArray(state?.active) || Array.isArray(state?.pending) || Array.isArray(state?.recent)) {
    return {
      active: state.active ?? [], pending: state.pending ?? [], recent: state.recent ?? [],
    };
  }
  const lanes = Array.isArray(state?.lanes) ? state.lanes : [];
  return {
    active: lanes.filter((lane) => !['IDLE', 'COMPLETE', 'MATCHING'].includes(statusOf(lane))),
    pending: lanes.filter((lane) => ['MATCHING'].includes(statusOf(lane))),
    recent: lanes.filter((lane) => ['RESULT', 'COMPLETE'].includes(statusOf(lane))),
  };
}

function featuredItem(state) {
  const groups = collections(state);
  return groups.active[0] ?? groups.pending[0] ?? groups.recent[0] ?? null;
}

function trackMap(item) {
  const circuit = circuitOf(item);
  const wrapper = element('div', 'screen-track-map');
  wrapper.dataset.testid = 'screen-track';
  const svg = svgElement('svg', 'track-svg screen-track-svg');
  svg.setAttribute('viewBox', '0 0 1000 620');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${circuit.name ?? '서킷'}의 실시간 4대 차량 위치`);
  const path = circuit.path ?? DEFAULT_PATH;
  const shadow = svgElement('path', 'track-shadow');
  const asphalt = svgElement('path', 'track-asphalt');
  const guide = svgElement('path', 'track-guide');
  for (const node of [shadow, asphalt, guide]) node.setAttribute('d', path);
  guide.id = 'screen-race-path';
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

  for (const racer of racersOf(item).slice(0, 4)) {
    const marker = svgElement('g', `race-marker${racer.isAi ? ' ai' : ''}`);
    marker.dataset.racerId = racerId(racer);
    const car = svgElement('image', 'marker-car');
    car.setAttribute('href', assetPath(racer.crewId));
    car.setAttribute('x', '-52');
    car.setAttribute('y', '-21');
    car.setAttribute('width', '104');
    car.setAttribute('height', '42');
    const badge = svgElement('circle', 'marker-badge');
    badge.setAttribute('cx', '-56');
    badge.setAttribute('cy', '0');
    badge.setAttribute('r', '14');
    const label = svgElement('text', 'marker-position');
    label.setAttribute('x', '-56');
    label.setAttribute('y', '5');
    label.setAttribute('text-anchor', 'middle');
    label.textContent = isRetired(racer) ? 'R' : String(racer.position ?? '–');
    marker.append(car, badge, label);
    svg.append(marker);
  }
  wrapper.append(svg);
  return wrapper;
}

function leaderboard(item) {
  const board = element('section', 'screen-leaderboard');
  board.dataset.testid = 'screen-leaderboard';
  board.append(element('h2', '', 'CLASSIFICATION · P1—P4 / RET'));
  const racers = racersOf(item).slice(0, 4);
  if (!racers.length) board.append(element('p', 'screen-empty', '그리드 확정 대기 중'));
  for (const racer of racers) {
    const row = element('article', `screen-order-row${racer.isAi ? ' ai' : ''}${isRetired(racer) ? ' retired' : ''}`);
    row.dataset.racerId = racerId(racer);
    row.append(element('b', 'screen-order-position', positionLabel(racer)));
    const copy = element('div');
    copy.append(element('strong', '', driverName(racer)), element('small', '', `${crewName(racer.crewId)} · ${racer.isAi ? 'AI' : 'HUMAN'}`));
    const metrics = element('div', 'screen-order-metrics');
    metrics.append(
      element('strong', 'screen-order-gap', gapLabel(racer)),
      element('small', 'screen-order-speed', `${Math.round(racer.speedKph ?? 0)} km/h`),
    );
    row.append(copy, metrics);
    board.append(row);
  }
  return board;
}

function telemetry(item) {
  const race = raceOf(item);
  const leader = racersOf(item)[0] ?? race;
  const match = matchOf(item);
  const strip = element('section', 'screen-telemetry');
  strip.dataset.testid = 'screen-telemetry';
  const entries = [
    ['LEADER SPEED', `${Math.round(leader.speedKph ?? race.speedKph ?? 0)} km/h`, 'screen-speed'],
    ['LAP', `${leader.lap ?? race.lap ?? 1}/${race.totalLaps ?? 2}`, 'screen-lap'],
    ['GATE', `${encounterNumber(item)}/${totalEncounters(item)}`, 'screen-gate'],
    ['BATTERY / RECHARGE', `${Math.round(leader.batteryPercent ?? race.batteryPercent ?? 0)}%`, 'screen-battery'],
    ['BOOST MODE', leader.boostMode ?? race.boostMode ? 'ACTIVE' : 'READY', 'screen-boost'],
    ['OVERTAKE MODE', leader.overtakeMode ?? race.overtakeMode ? 'ACTIVE' : 'LOCKED', 'screen-overtake'],
    ['ACTIVE AERO', leader.activeAero ?? race.activeAero ? 'ACTIVE' : 'BALANCED', 'screen-aero'],
  ];
  for (const [label, value, id] of entries) {
    const cell = element('div');
    cell.append(element('span', '', label), element('b', '', value));
    cell.querySelector('b').id = id;
    strip.append(cell);
  }
  return strip;
}

function startLights(item) {
  const match = matchOf(item);
  const total = Number(catalogs.match?.gridMs ?? 5000);
  const remaining = Number(match.startsInMs ?? total);
  const active = clamp(Math.floor((total - remaining) / 1000) + 1, 0, 5);
  const card = element('section', 'screen-lights-card');
  card.append(element('span', '', 'GRID LOCKED'));
  const lights = element('div', 'start-lights');
  for (let index = 0; index < 5; index += 1) lights.append(element('i', index < active ? 'on' : ''));
  const time = element('strong', 'screen-grid-clock', formatTime(remaining));
  card.append(lights, time);
  return card;
}

function queueGrid(item) {
  const match = matchOf(item);
  const racers = racersOf(item);
  const humanCount = Number(match.humanCount ?? racers.filter((racer) => !racer.isAi).length) || 0;
  const slots = racers.slice(0, 4);
  while (slots.length < 4) slots.push(null);
  const card = element('section', 'screen-queue-card');
  card.append(
    element('div', 'screen-queue-copy', `${securityCircuitOf(item).label} · ${difficultyLabel(item)} · ${humanCount}/4 HUMAN`),
    element('h2', '', '같은 조건만 매칭 · 45초 뒤 빈자리에 AI 합류'),
  );
  const grid = element('div', 'screen-match-grid');
  grid.dataset.testid = 'screen-match-grid';
  slots.forEach((racer, index) => {
    const slot = element('article', `screen-grid-slot${racer ? ' occupied' : ''}${racer?.isAi ? ' ai' : ''}`);
    slot.append(element('span', '', `P${index + 1}`));
    if (racer) {
      const car = element('img');
      car.src = assetPath(racer.crewId);
      car.alt = '';
      slot.append(car, element('strong', '', driverName(racer)), element('small', '', racer.isAi ? 'AI DRIVER' : 'HUMAN DRIVER'));
    } else {
      slot.append(element('b', '', '＋'), element('strong', '', 'OPEN SLOT'), element('small', '', '45초 후 AI'));
    }
    grid.append(slot);
  });
  card.append(grid);
  const timers = element('div', 'screen-queue-timers');
  const min = element('div');
  min.append(element('span', '', '최소 대기'), element('b', '', formatTime(match.minWaitRemainingMs ?? 0)));
  const max = element('div');
  max.append(element('span', '', 'AI 투입까지'), element('b', 'screen-match-clock', formatTime(match.maxWaitRemainingMs ?? match.startsInMs ?? 0)));
  timers.append(min, max);
  card.append(timers);
  return card;
}

function joinCard(state) {
  const card = element('aside', 'screen-join-card');
  const qr = element('img');
  qr.src = '/api/qr.svg';
  qr.alt = '게임 참가 QR 코드';
  qr.width = 240;
  qr.height = 240;
  card.append(qr, element('span', '', 'SCAN TO JOIN'), element('strong', '', '팀 → 드라이버 → 보안 서킷 → 난이도'));
  if (state?.joinUrl) card.append(element('small', 'screen-join-url', state.joinUrl));
  return card;
}

function otherHeats(state, featured) {
  const groups = collections(state);
  const items = [...groups.active, ...groups.pending, ...groups.recent]
    .filter((item) => item !== featured)
    .slice(0, 5);
  const rail = element('section', 'screen-heat-rail');
  rail.append(element('h2', '', 'OTHER HEATS'));
  if (!items.length) rail.append(element('p', 'screen-empty', '다음 4-CAR 매칭을 기다리는 중입니다.'));
  for (const item of items) {
    const match = matchOf(item);
    const row = element('article', 'screen-heat-row');
    row.append(
      element('b', '', `${securityCircuitOf(item).shortLabel ?? securityCircuitOf(item).label} · ${difficultyLabel(item)}`),
      element('span', '', `${STATUS_LABELS[statusOf(item)] ?? statusOf(item)} · ${racersOf(item).length || match.humanCount || 0}/4 · ${circuitOf(item).shortLabel ?? 'COURSE'}`),
      element('strong', '', formatTime(remainingMs(item))),
    );
    rail.append(row);
  }
  return rail;
}

function trendBriefing(item) {
  const trend = item?.trend ?? matchOf(item).trend;
  if (!trend) return null;
  const card = element('section', 'screen-trend');
  card.dataset.testid = 'screen-trend';
  const copy = element('div');
  copy.append(element('span', '', trend.eyebrow ?? 'SECURITY TREND'), element('h2', '', trend.title ?? '최신 보안 동향'));
  card.append(copy, element('b', '', '비채점 브리핑 · 순위 미반영'));
  return card;
}

function emptyBoard(state) {
  const card = element('article', 'screen-idle-card');
  card.dataset.testid = 'screen-board';
  card.append(element('span', '', 'GRID OPEN'), element('h2', '', '첫 4-CAR SECURITY SPRINT를 기다립니다.'), element('p', '', 'QR을 스캔하고 팀, 드라이버, 보안 서킷, 난이도를 선택하세요. 같은 조건끼리 매칭되며 최대 45초 뒤 AI와 함께 출발합니다.'));
  const layout = element('div', 'screen-idle-layout');
  layout.append(joinCard(state));
  card.append(layout);
  return card;
}

function render(state) {
  const featured = featuredItem(state);
  app.replaceChildren();
  if (!featured) {
    app.dataset.screen = 'idle';
    app.append(emptyBoard(state));
    return;
  }
  const status = statusOf(featured);
  app.dataset.screen = status.toLowerCase();
  const circuit = circuitOf(featured);
  const board = element('article', 'screen-board');
  board.dataset.testid = 'screen-board';
  const head = element('header', 'screen-race-head');
  const title = element('div');
  title.append(
    element('span', '', `${STATUS_LABELS[status] ?? status} · ${securityCircuitOf(featured).label} · ${difficultyLabel(featured)}`),
    element('h2', '', circuit.name ?? 'NITRO GRID'),
  );
  const time = element('div', 'screen-feature-clock');
  time.append(element('span', '', status === 'MATCHING' ? 'AI JOIN' : 'NEXT GATE'), element('b', '', formatTime(remainingMs(featured))));
  head.append(title, time);
  board.append(head);

  const layout = element('div', 'screen-race-layout');
  const stage = element('section', 'screen-track-stage');
  if (status === 'MATCHING') stage.append(queueGrid(featured));
  else {
    stage.append(trackMap(featured));
    if (status === 'GRID') stage.append(startLights(featured));
    stage.append(telemetry(featured));
  }
  const side = element('aside', 'screen-race-side');
  side.append(leaderboard(featured), joinCard(state));
  layout.append(stage, side);
  board.append(layout);
  const trend = trendBriefing(featured);
  if (trend) board.append(trend);
  board.append(otherHeats(state, featured));
  app.append(board);
  updateLive(featured);
}

function structuralKey(state) {
  const groups = collections(state);
  const featured = featuredItem(state);
  return JSON.stringify({
    featured: matchOf(featured).id ?? matchOf(featured).roundId ?? null,
    status: featured ? statusOf(featured) : 'IDLE',
    trend: featured?.trend?.id ?? matchOf(featured).trend?.id ?? null,
    racers: featured ? racersOf(featured).map(racerId) : [],
    groups: [...groups.active, ...groups.pending, ...groups.recent].map((item) => `${matchOf(item).id ?? matchOf(item).roundId}:${statusOf(item)}`),
  });
}

function updateTrack(item) {
  const svg = document.querySelector('.screen-track-svg');
  const path = svg?.querySelector('.track-guide');
  if (!svg || !path || typeof path.getTotalLength !== 'function') return;
  const length = path.getTotalLength();
  racersOf(item).forEach((racer, index) => {
    const marker = [...svg.querySelectorAll('.race-marker')].find((node) => node.dataset.racerId === racerId(racer));
    if (!marker) return;
    const progress = ((Number(racer.trackProgress ?? racer.progress ?? 0) % 1) + 1) % 1;
    const point = path.getPointAtLength(progress * length);
    const ahead = path.getPointAtLength(((progress * length) + 6) % length);
    const dx = ahead.x - point.x;
    const dy = ahead.y - point.y;
    const magnitude = Math.hypot(dx, dy) || 1;
    const tangentX = dx / magnitude;
    const tangentY = dy / magnitude;
    const normalX = -tangentY;
    const normalY = tangentX;
    const slot = Math.abs(Number(racer.seat ?? index + 1) - 1) % 4;
    const tangentOffset = [-42, -14, 14, 42][slot];
    const normalOffset = [-18, 18, -18, 18][slot];
    const x = point.x + tangentX * tangentOffset + normalX * normalOffset;
    const y = point.y + tangentY * tangentOffset + normalY * normalOffset;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    marker.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${angle.toFixed(2)})`);
    const label = marker.querySelector('.marker-position');
    if (label) label.textContent = isRetired(racer) ? 'R' : String(racer.position ?? '–');
  });
}

function setText(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.textContent = String(value);
}

function updateLive(item) {
  if (!item) return;
  const race = raceOf(item);
  const leader = racersOf(item)[0] ?? race;
  const match = matchOf(item);
  setText('.screen-feature-clock b', formatTime(remainingMs(item)));
  setText('.screen-match-clock', formatTime(match.maxWaitRemainingMs ?? match.startsInMs ?? 0));
  setText('.screen-grid-clock', formatTime(match.startsInMs ?? 0));
  setText('#screen-speed', `${Math.round(leader.speedKph ?? race.speedKph ?? 0)} km/h`);
  setText('#screen-lap', `${leader.lap ?? race.lap ?? 1}/${race.totalLaps ?? 2}`);
  setText('#screen-gate', `${encounterNumber(item)}/${totalEncounters(item)}`);
  setText('#screen-battery', `${Math.round(leader.batteryPercent ?? race.batteryPercent ?? 0)}%`);
  setText('#screen-boost', leader.boostMode ?? race.boostMode ? 'ACTIVE' : 'READY');
  setText('#screen-overtake', leader.overtakeMode ?? race.overtakeMode ? 'ACTIVE' : 'LOCKED');
  setText('#screen-aero', leader.activeAero ?? race.activeAero ? 'ACTIVE' : 'BALANCED');
  for (const racer of racersOf(item)) {
    const row = [...document.querySelectorAll('.screen-order-row')].find((node) => node.dataset.racerId === racerId(racer));
    if (!row) continue;
    row.classList.toggle('retired', isRetired(racer));
    row.querySelector('.screen-order-position').textContent = positionLabel(racer);
    row.querySelector('.screen-order-gap').textContent = gapLabel(racer);
    row.querySelector('.screen-order-speed').textContent = `${Math.round(racer.speedKph ?? 0)} km/h`;
    row.parentElement.append(row);
  }
  updateTrack(item);
}

function updateHeader(state) {
  const groups = collections(state);
  const activeCount = groups.active.length;
  const pendingCount = groups.pending.length;
  statusNode.textContent = `${activeCount} LIVE · ${pendingCount} MATCHING`;
  if (formatNode) formatNode.textContent = `동일 난이도+보안 서킷 4대 매칭 · 30–45초 · 빈자리는 동일 조건 AI · ${catalogEncounterLabel()} Security Encounters`;
  clockNode.textContent = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date());
}

async function refresh() {
  try {
    const response = await fetch('/api/screen-state', { cache: 'no-store' });
    if (!response.ok) throw new Error('screen_state_failed');
    latest = await response.json();
    catalogs = { ...catalogs, ...(latest.catalogs ?? latest.catalog ?? {}) };
    if (!catalogs.match) {
      const catalogResponse = await fetch('/api/catalog', { cache: 'no-store' });
      if (catalogResponse.ok) catalogs = { ...catalogs, ...(await catalogResponse.json()) };
    }
    updateHeader(latest);
    const key = structuralKey(latest);
    if (key !== renderKey) {
      render(latest);
      renderKey = key;
    } else updateLive(featuredItem(latest));
  } catch {
    statusNode.textContent = 'RACE CONTROL 재연결 중';
    if (!app.childElementCount) app.append(emptyBoard({}));
  }
}

refresh();
setInterval(refresh, 750);
