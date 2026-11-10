const app = document.querySelector('#app');
const connection = document.querySelector('#connection');
const notice = document.querySelector('#notice');

const TOKEN_KEY = 'nitro-grid-player-token';
const DEVICE_KEY = 'nitro-grid-device-id';
const LABEL_CACHE_KEY = 'nitro-grid-option-labels';
const PHASE_LABELS = {
  QUEUED: '다음 그리드 대기', JOIN: 'GARAGE', LAUNCH: 'LAUNCH', SECTOR_1: 'SECTOR 1',
  PIT_STOP: 'PIT STOP', SECTOR_2: 'SECTOR 2', SPRINT: 'FINAL SPRINT',
  RESULT: 'CHEQUERED FLAG', COMPLETE: 'RACE COMPLETE',
};
const PHASE_COPY = {
  JOIN: ['그리드 준비 중', '같은 라운드 참가자가 출발 준비를 마칠 때까지 기다립니다.'],
  QUEUED: ['다음 그리드 예약 완료', '진행 중인 레이스에는 난입하지 않습니다. 다음 출발에서 자동으로 합류합니다.'],
  LAUNCH: ['출발 신호를 읽으세요', '첫 판단이 맞으면 Launch Boost가 활성화됩니다.'],
  SECTOR_1: ['니트로를 충전하세요', '두 개의 보안 인카운터에서 근거를 읽고 대응을 선택하세요.'],
  PIT_STOP: ['피트에서 정확히 고치세요', '빠른 임시조치보다 재발을 막는 대응을 고르면 피트 시간이 줄어듭니다.'],
  SECTOR_2: ['Aero Boost를 여세요', '노출 범위와 신뢰 경계를 확인해 두 문제를 모두 통과하세요.'],
  SPRINT: ['마지막 대응을 결정하세요', '사고 대응 순서가 맞으면 저장한 Nitro를 결승선에서 전개합니다.'],
};
const DIFFICULTY_COPY = {
  BEGINNER: ['초급 · Guided', '핵심 근거에 짧은 해설이 붙습니다.'],
  ADVANCED: ['고급 · Analyst', '같은 문제를 원문 증거 중심으로 풉니다.'],
};
const FINISH_COPY = {
  POLE_POSITION: ['POLE POSITION', '7개 판단을 모두 정확하게 통과했습니다.'],
  PODIUM: ['PODIUM FINISH', '핵심 판단을 안정적으로 이어 결승선을 통과했습니다.'],
  POINTS_FINISH: ['POINTS FINISH', '좋은 판단이 있었지만 놓친 근거를 다시 확인할 구간이 있습니다.'],
  GARAGE_REVIEW: ['GARAGE REVIEW', '결과보다 복기가 중요합니다. 틀린 판단의 근거를 다시 확인하세요.'],
  INCOMPLETE: ['RACE INCOMPLETE', '제한 시간 안에 모든 인카운터를 완료하지 못했습니다.'],
};

let catalog = null;
let playerToken = sessionGet(TOKEN_KEY);
let state = null;
let busy = false;
let renderKey = '';
let feedbackGate = null;
let noticeExpiresAt = 0;
const pendingChoices = new Map();
const optionLabels = new Map(savedOptionLabels());
const garage = { trackId: null, difficulty: null, crewId: null, driverId: null };

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
    const saved = JSON.parse(sessionGet(LABEL_CACHE_KEY) ?? '{}');
    return Object.entries(saved).filter(([key, value]) => typeof key === 'string' && typeof value === 'string');
  } catch {
    return [];
  }
}

function randomDeviceId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

let memoryDeviceId = null;
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

function assetPath(kind, id) {
  if (!/^[a-z0-9-]+$/.test(id ?? '')) return '';
  return `/assets/${kind}/${id}.svg`;
}

function driverMedia(driver) {
  const supplied = driver?.media;
  if (typeof supplied === 'string' && /^\/assets\/driver-panels\/[a-z0-9-]+\.webp$/.test(supplied)) return supplied;
  if (!/^[a-z0-9-]+$/.test(driver?.id ?? '')) return '';
  return `/assets/driver-panels/${driver.id}.webp`;
}

function reduceMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function rememberOptionLabels(task) {
  let changed = false;
  for (const option of task?.options ?? []) {
    const label = option.label ?? option.text ?? option.id;
    const key = `${task.id}:${option.id}`;
    if (typeof label === 'string' && optionLabels.get(key) !== label) {
      optionLabels.set(key, label);
      changed = true;
    }
  }
  if (changed) sessionSet(LABEL_CACHE_KEY, JSON.stringify(Object.fromEntries(optionLabels)));
}

function rememberedOptionLabel(taskId, optionId, fallback = '') {
  if (!optionId) return fallback;
  return optionLabels.get(`${taskId}:${optionId}`) ?? (fallback || optionId);
}

function setConnection(text, online = false) {
  connection.textContent = text;
  connection.classList.toggle('online', online);
}

function setNotice(text = '', durationMs = 6000) {
  notice.textContent = text;
  notice.hidden = text.length === 0;
  noticeExpiresAt = text.length > 0 ? Date.now() + durationMs : 0;
}

function clearExpiredNotice() {
  if (!notice.hidden && noticeExpiresAt > 0 && Date.now() >= noticeExpiresAt) setNotice();
}

function formatTime(milliseconds) {
  const seconds = Math.max(0, Math.ceil((Number(milliseconds) || 0) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
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

function selectionButton({ id, className, selected, onClick, label, detail, image }) {
  const button = element('button', `${className}${selected ? ' selected' : ''}`);
  button.type = 'button';
  if (id) button.id = id;
  button.setAttribute('aria-pressed', String(selected));
  if (image) {
    const img = element('img');
    img.src = image.src;
    img.alt = image.alt;
    img.loading = 'lazy';
    img.decoding = 'async';
    button.append(img);
  }
  const copy = element('span', 'selection-copy');
  copy.append(element('strong', '', label), element('small', '', detail));
  button.append(copy);
  button.addEventListener('click', onClick);
  return button;
}

function garageComplete() {
  const driver = (catalog?.drivers ?? []).find(({ id }) => id === garage.driverId);
  return Boolean(garage.trackId && garage.difficulty && garage.crewId && driver?.crewId === garage.crewId);
}

function renderLobby({ focusId = null } = {}) {
  renderKey = 'garage';
  app.replaceChildren();
  const hero = element('article', 'landing-card garage-hero');
  hero.append(
    element('div', 'eyebrow', 'OWASP KOREA 2026 · 5 MIN SECURITY RACE'),
    element('h1', '', '판단이 맞으면\n차가 빨라진다.'),
    element('p', 'lead', '증거를 읽고 7개의 보안 인카운터를 통과하세요. 정답은 Nitro, 짧은 Pit Stop, Aero Boost로 즉시 반영됩니다.'),
  );
  const rules = element('div', 'quick-rules');
  [['07', '보안 판단'], ['05:00', '최대 시간'], ['02', '최신 동향 카드']].forEach(([value, label]) => {
    const item = element('div');
    item.append(element('strong', '', value), element('span', '', label));
    rules.append(item);
  });
  hero.append(rules);

  const form = element('article', 'garage-card');
  const trackSection = element('section', 'garage-section');
  trackSection.append(element('div', 'section-number', '01'), element('h2', '', '서킷 선택'));
  const trackGrid = element('div', 'track-grid');
  for (const track of catalog?.tracks ?? []) {
    trackGrid.append(selectionButton({
      id: `track-${track.id}`,
      className: 'track-card', selected: garage.trackId === track.id,
      onClick: () => { garage.trackId = track.id; renderLobby({ focusId: `track-${track.id}` }); },
      label: track.shortLabel ?? track.name, detail: track.subtitle,
    }));
  }
  trackSection.append(trackGrid);

  const crewSection = element('section', 'garage-section');
  crewSection.append(element('div', 'section-number', '02'), element('h2', '', '팀 선택'), element('p', 'section-help', '성능 차이는 없습니다. 좋아하는 머신을 고르세요.'));
  const crewGrid = element('div', 'crew-grid');
  for (const crew of catalog?.crews ?? []) {
    crewGrid.append(selectionButton({
      id: `crew-${crew.id}`,
      className: `crew-card crew-${crew.id}`, selected: garage.crewId === crew.id,
      onClick: () => {
        garage.crewId = crew.id;
        const selectedDriver = (catalog?.drivers ?? []).find(({ id }) => id === garage.driverId);
        if (selectedDriver?.crewId !== crew.id) garage.driverId = null;
        renderLobby({ focusId: `crew-${crew.id}` });
      },
      label: crew.name, detail: crew.trait,
      image: { src: assetPath('cars', crew.id), alt: `${crew.name} 테마 레이스카` },
    }));
  }
  crewSection.append(crewGrid);

  const driverSection = element('section', 'garage-section');
  driverSection.append(element('div', 'section-number', '03'), element('h2', '', '드라이버 선택'), element('p', 'section-help', '선택한 팀의 두 드라이버 중 한 명을 고르세요. 점수 차이는 없습니다.'));
  const driverGrid = element('div', 'driver-grid');
  const teamDrivers = (catalog?.drivers ?? []).filter(({ crewId }) => crewId === garage.crewId);
  if (!garage.crewId) {
    driverGrid.append(element('p', 'driver-placeholder', '먼저 팀을 선택하면 해당 팀의 드라이버 2명이 열립니다.'));
  } else if (teamDrivers.length === 0) {
    driverGrid.append(element('p', 'driver-placeholder', '이 팀의 드라이버 정보를 불러오지 못했습니다. 다른 팀을 선택한 뒤 다시 시도해 주세요.'));
  } else {
    for (const driver of teamDrivers) {
      const identity = [`#${driver.number ?? '—'}`, driver.country].filter(Boolean).join(' · ');
      driverGrid.append(selectionButton({
        id: `driver-${driver.id}`,
        className: `driver-card crew-${driver.crewId}`, selected: garage.driverId === driver.id,
        onClick: () => { garage.driverId = driver.id; renderLobby({ focusId: `driver-${driver.id}` }); },
        label: driver.name, detail: identity,
        image: reduceMotion() ? null : { src: driverMedia(driver), alt: `${driver.name} 애니메이션 드라이버 패널` },
      }));
    }
  }
  driverSection.append(driverGrid);

  const difficultySection = element('section', 'garage-section');
  difficultySection.append(element('div', 'section-number', '04'), element('h2', '', '난이도 선택'));
  const difficultyGrid = element('div', 'difficulty-grid');
  for (const difficulty of catalog?.difficulties ?? ['BEGINNER', 'ADVANCED']) {
    const [label, detail] = DIFFICULTY_COPY[difficulty] ?? [difficulty, '같은 정답을 사용합니다.'];
    difficultyGrid.append(selectionButton({
      id: `difficulty-${difficulty.toLowerCase()}`,
      className: 'difficulty-card', selected: garage.difficulty === difficulty,
      onClick: () => { garage.difficulty = difficulty; renderLobby({ focusId: `difficulty-${difficulty.toLowerCase()}` }); }, label, detail,
    }));
  }
  difficultySection.append(difficultyGrid);

  const join = element('button', 'primary-button', garageComplete() ? 'START ENGINE · 그리드 합류' : '4개 항목을 모두 선택하세요');
  join.id = 'join-button';
  join.type = 'button';
  join.disabled = !garageComplete();
  join.addEventListener('click', joinRace);
  form.append(trackSection, crewSection, driverSection, difficultySection, join);
  form.append(element('p', 'privacy-note', '계정·닉네임을 받지 않습니다. 익명 기기 ID는 같은 레이스 재접속에만 사용합니다.'));
  app.append(hero, form);
  if (focusId) requestAnimationFrame(() => document.getElementById(focusId)?.focus({ preventScroll: true }));
}

async function loadCatalog() {
  try {
    catalog = await api('/api/catalog');
    if (!Array.isArray(catalog?.tracks) || !Array.isArray(catalog?.crews) || !Array.isArray(catalog?.drivers)) throw new Error('invalid catalog');
    setConnection('● NITRO GRID 온라인', true);
    renderLobby();
  } catch {
    setConnection('서버 연결 복구 중…', false);
    setNotice('그리드 정보를 불러오지 못했습니다. 자동으로 다시 시도합니다.');
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
    renderKey = '';
    await refresh();
  } catch (error) {
    const messages = {
      capacity: '현재와 다음 그리드가 모두 찼습니다. 전광판에서 다음 출발을 확인해 주세요.',
      invalid_track: '선택한 서킷을 사용할 수 없습니다.',
      invalid_crew: '선택한 팀을 사용할 수 없습니다.',
      invalid_driver: '선택한 드라이버를 사용할 수 없습니다.',
      invalid_difficulty: '선택한 난이도를 사용할 수 없습니다.',
      join_rate_limited: '동시 입장이 많습니다. 잠시 후 다시 눌러 주세요.',
    };
    setNotice(messages[error.code] ?? '그리드 합류에 실패했습니다. 연결을 확인해 주세요.');
    renderLobby();
  } finally {
    busy = false;
  }
}

function raceProgress(current) {
  if (Number.isFinite(current.race?.progress)) return clamp(current.race.progress, 0, 1);
  if (Number.isFinite(current.round?.progress)) return clamp(current.round.progress, 0, 1);
  return clamp((current.race?.answered ?? 0) / (current.race?.possible || 7), 0, 1);
}

function raceHero(current) {
  const race = current.race ?? {};
  const progress = raceProgress(current);
  const step = Math.round(progress * 10);
  const crewId = current.player?.crewId ?? catalog?.crews?.[0]?.id ?? 'red-bull-racing';
  const hero = element('section', `race-hero crew-${crewId}`);
  const sky = element('div', 'race-sky');
  const labels = element('div', 'race-hero-labels');
  labels.append(element('span', '', PHASE_LABELS[current.round?.phase] ?? current.round?.phase ?? 'GRID'), element('b', '', `${race.correct ?? 0}/${race.possible ?? 7} CORRECT`));
  sky.append(labels);
  const track = element('div', `race-track progress-${step}`);
  track.append(element('i', 'track-line line-a'), element('i', 'track-line line-b'));
  const car = element('img', 'race-car');
  car.src = assetPath('cars', crewId);
  car.alt = `${current.player?.crew?.name ?? crewId} 레이스카`;
  track.append(car, element('span', 'finish-marker', 'FINISH'));
  sky.append(track);
  hero.append(sky);

  const telemetry = element('div', 'telemetry');
  const items = [
    ['LAUNCH', race.launchBoost ? 'BOOST' : '—', race.launchBoost],
    ['NITRO', `${race.nitro ?? 0}/3`, (race.nitro ?? 0) > 0],
    ['PIT', race.answered >= 4 ? `${((race.pitTimeMs ?? 0) / 1000).toFixed(1)}s` : '—', (race.pitTimeMs ?? 9999) < 3000],
    ['AERO', race.aeroActive ? 'ON' : '—', race.aeroActive],
  ];
  for (const [label, value, active] of items) {
    const item = element('div', active ? 'active' : '');
    item.append(element('span', '', label), element('strong', '', value));
    telemetry.append(item);
  }
  hero.append(telemetry);
  return hero;
}

function identityBar(current) {
  const crew = current.player?.crew?.name ?? (catalog?.crews ?? []).find(({ id }) => id === current.player?.crewId)?.name ?? current.player?.crewId;
  const bar = element('header', 'race-identity');
  const identity = element('div');
  identity.append(element('span', '', `${crew ?? 'TEAM'} · ${current.track?.shortLabel ?? current.track?.name ?? 'CIRCUIT'}`), element('strong', '', current.player?.callsign ?? 'DRIVER'));
  const timer = element('div', 'race-timer');
  timer.append(element('span', '', PHASE_LABELS[current.round?.phase] ?? current.round?.phase ?? ''), element('b', '', formatTime(displayRemainingMs(current))));
  timer.querySelector('b').id = 'race-clock';
  bar.append(identity, timer);
  return bar;
}

function phaseStrip(current) {
  const stages = [['LAUNCH', '출발'], ['SECTOR_1', 'S1'], ['PIT_STOP', 'PIT'], ['SECTOR_2', 'S2'], ['SPRINT', 'SPRINT']];
  const active = stages.findIndex(([phase]) => phase === current.round?.phase);
  const strip = element('ol', 'phase-strip');
  strip.setAttribute('aria-label', '레이스 진행 단계');
  stages.forEach(([, label], index) => {
    const className = index < active || ['RESULT', 'COMPLETE'].includes(current.round?.phase) ? 'done' : index === active ? 'active' : '';
    const item = element('li', className, label);
    if (index === active) item.setAttribute('aria-current', 'step');
    strip.append(item);
  });
  return strip;
}

function evidencePanel(task) {
  const panel = element('section', 'evidence-card');
  panel.append(element('span', 'evidence-label', 'RACE CONTROL EVIDENCE'));
  const evidence = Array.isArray(task.evidence) ? task.evidence : task.evidence ? [task.evidence] : [];
  if (evidence.length === 0) {
    panel.append(element('p', 'evidence-empty', '표시할 증거가 없습니다. 상황 설명을 기준으로 판단하세요.'));
    return panel;
  }
  for (const item of evidence) {
    const block = element('div', 'evidence-block');
    block.append(element('b', '', item.label ?? item.source ?? item.kind ?? '증거'));
    const pre = element('pre', '', item.value ?? item.text ?? item.content ?? '');
    block.append(pre);
    if (item.annotation) block.append(element('p', 'evidence-note', item.annotation));
    panel.append(block);
  }
  return panel;
}

function optionDetail(option) {
  return option.detail ?? option.description ?? option.technical ?? option.effect ?? '';
}

function taskCard(current, task, index) {
  rememberOptionLabels(task);
  const selected = pendingChoices.get(task.id) ?? task.selected ?? null;
  const locked = Boolean(task.selected);
  const card = element('article', 'encounter-card');
  const head = element('div', 'encounter-head');
  head.append(element('span', '', `ENCOUNTER ${task.gridPosition ?? (current.race?.answered ?? 0) + index + 1}/7`), element('b', '', task.categoryLabel ?? task.category ?? 'SECURITY BASICS'));
  card.append(head, element('h2', '', task.question ?? task.prompt ?? task.title), evidencePanel(task));
  if (task.criterion) card.append(element('p', 'decision-hint', task.criterion));
  const list = element('div', 'answer-list');
  for (const option of task.options ?? []) {
    const button = element('button', `answer-card${selected === option.id ? ' selected' : ''}`);
    button.type = 'button';
    button.disabled = busy || locked;
    button.setAttribute('aria-pressed', String(selected === option.id));
    button.append(element('i', '', String.fromCharCode(65 + list.children.length)), element('strong', '', option.label ?? option.text ?? option.id));
    const detail = optionDetail(option);
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
    const confirm = element('button', 'confirm-button', selected ? '무전 전송 · 선택 확정' : '대응을 하나 선택하세요');
    confirm.id = `confirm-${task.id}`;
    confirm.type = 'button';
    confirm.disabled = !selected || busy;
    confirm.addEventListener('click', () => submitAnswer(task, selected));
    card.append(confirm, element('p', 'confirm-note', '정답은 속도가 아니라 근거로 결정됩니다. 확정 후에는 바꿀 수 없습니다.'));
  }
  return card;
}

async function submitAnswer(task, choice) {
  if (busy || !state || !task || !choice) return;
  busy = true;
  setNotice();
  document.querySelectorAll('button').forEach((button) => { if (button.closest('.encounter-card')) button.disabled = true; });
  try {
    const response = await api('/api/action', {
      method: 'POST',
      body: JSON.stringify({
        roundId: state.round.roundId,
        task: task.id,
        choice,
        actionId: `a_${crypto.randomUUID().replaceAll('-', '')}`,
      }),
    });
    const chosen = (task.options ?? []).find((option) => option.id === choice);
    const correctOptionId = response.feedback?.correctOptionId ?? null;
    const correctOption = (task.options ?? []).find((option) => option.id === correctOptionId);
    feedbackGate = {
      taskId: task.id,
      category: task.categoryLabel ?? task.category,
      selectedLabel: chosen?.label ?? chosen?.text ?? choice,
      correct: response.feedback?.correct === true,
      correctOptionId,
      correctLabel: correctOption?.label ?? correctOption?.text ?? rememberedOptionLabel(task.id, correctOptionId, correctOptionId),
      explanation: response.feedback?.explanation ?? '판정 근거가 저장되었습니다.',
      effect: response.feedback?.effect ?? null,
    };
    pendingChoices.delete(task.id);
    renderKey = '';
    await refresh();
  } catch (error) {
    const messages = {
      phase_closed: '이 구간이 종료되었습니다. 최신 레이스 상태로 이동합니다.',
      choice_locked: '이미 확정한 대응입니다. 최초 선택만 반영됩니다.',
      invalid_choice: '허용된 대응 선택지가 아닙니다.',
    };
    setNotice(messages[error.code] ?? '무전 전송에 실패했습니다. 연결을 확인해 주세요.');
    busy = false;
    renderKey = '';
    await refresh();
  } finally {
    busy = false;
  }
}

function feedbackPanel(current) {
  const feedback = feedbackGate;
  const card = element('article', `feedback-card ${feedback.correct ? 'correct' : 'wrong'}`);
  card.append(element('div', 'feedback-flag', feedback.correct ? '✓ CLEAN LINE' : '× TIME PENALTY'));
  card.append(element('span', 'feedback-category', feedback.category ?? 'SECURITY DECISION'));
  card.append(element('h2', '', feedback.correct ? '판단이 맞았습니다.' : '근거와 맞지 않는 선택입니다.'));
  const selected = element('div', 'selected-answer');
  selected.append(element('span', '', '내 선택'), element('strong', '', feedback.selectedLabel));
  card.append(selected);
  if (!feedback.correct && feedback.correctLabel) {
    const correction = element('div', 'correct-answer');
    correction.append(element('span', '', '근거에 맞는 선택'), element('strong', '', feedback.correctLabel));
    card.append(correction);
  }
  card.append(element('p', 'feedback-explanation', feedback.explanation));
  const effect = element('div', 'race-effect');
  const effectText = feedback.effect ?? (feedback.correct ? 'Race Control이 성능 보너스를 적용했습니다.' : '현재 구간의 보너스를 얻지 못했습니다.');
  effect.append(element('span', '', 'RACE EFFECT'), element('b', '', effectText));
  card.append(effect);
  const next = element('button', 'primary-button', '트랙으로 복귀');
  next.id = 'feedback-continue';
  next.type = 'button';
  next.addEventListener('click', () => {
    feedbackGate = null;
    renderKey = '';
    renderState(state ?? current);
  });
  card.append(next);
  return card;
}

function trendCard(trend) {
  if (!trend) return null;
  const card = element('aside', 'trend-card');
  card.append(element('div', 'trend-chip', '2026 SECURITY TREND · 점수 없음'));
  card.append(element('h2', '', trend.title ?? '최신 보안 동향'));
  card.append(element('p', '', trend.summary ?? trend.body ?? trend.takeaway ?? ''));
  if (trend.takeaway && trend.takeaway !== trend.summary) {
    const takeaway = element('div', 'trend-takeaway');
    takeaway.append(element('span', '', 'TAKEAWAY'), element('b', '', trend.takeaway));
    card.append(takeaway);
  }
  if (typeof trend.sourceUrl === 'string' && trend.sourceUrl.startsWith('https://')) {
    const link = element('a', 'source-link', `${trend.sourceName ?? '공식 출처'} · ${trend.asOf ?? trend.reviewedAt ?? '확인'}`);
    link.href = trend.sourceUrl;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    card.append(link);
  }
  return card;
}

function observationHistory(current) {
  const observations = Array.isArray(current.observations) ? current.observations : [];
  if (observations.length === 0) return null;
  const details = element('details', 'race-log');
  details.append(element('summary', '', `지금까지의 판단 ${observations.length}개 복기`));
  const list = element('div', 'race-log-list');
  for (const observation of observations) {
    const item = element('article', observation.correct ? 'correct' : 'wrong');
    item.append(element('span', '', observation.correct ? 'CORRECT' : 'REVIEW'), element('b', '', observation.label ?? observation.selectedLabel ?? observation.choice ?? '제출 완료'));
    if (observation.explanation) item.append(element('p', '', observation.explanation));
    list.append(item);
  }
  details.append(list);
  return details;
}

function waitingPanel(current) {
  const phase = current.round?.phase ?? 'JOIN';
  const [title, copy] = PHASE_COPY[phase] ?? ['Race Control 확인 중', '다음 구간을 준비하고 있습니다.'];
  const card = element('article', 'waiting-card');
  card.append(element('div', 'eyebrow', PHASE_LABELS[phase] ?? phase), element('h2', '', title), element('p', '', copy));
  const pulse = element('div', 'radio-pulse');
  pulse.append(element('i'), element('span', '', phase === 'QUEUED' ? 'NEXT GRID RESERVED' : 'RACE CONTROL SYNC'));
  card.append(pulse);
  if (current.trend) card.append(trendCard(current.trend));
  const history = observationHistory(current);
  if (history) card.append(history);
  return card;
}

function resultReview(result) {
  const rows = Array.isArray(result?.review) ? result.review : [];
  if (rows.length === 0) return null;
  const section = element('section', 'result-review');
  const head = element('div', 'result-review-head');
  head.append(element('h2', '', `전체 판단 복기 · ${rows.length}문항`), element('p', '', '선택과 정답을 나란히 확인하세요. 틀린 문항은 다음 레이스의 체크포인트입니다.'));
  section.append(head);
  const list = element('div', 'result-review-list');
  rows.forEach((row, index) => {
    const item = element('article', `review-item ${row.correct ? 'correct' : 'wrong'}`);
    const meta = element('div', 'review-meta');
    meta.append(element('span', '', `${String(index + 1).padStart(2, '0')} · ${row.categoryLabel ?? row.category ?? 'SECURITY'}`), element('b', '', row.correct ? 'CORRECT' : 'REVIEW'));
    item.append(meta, element('h3', '', row.question ?? row.prompt ?? row.id ?? `문항 ${index + 1}`));
    const answers = element('div', 'review-answers');
    const selectedLabel = row.selectedLabel ?? rememberedOptionLabel(row.id, row.selected, row.selected ?? '시간 내 미응답');
    const correctLabel = row.correctOptionLabel ?? row.correctLabel ?? rememberedOptionLabel(row.id, row.correctOptionId, row.correctOptionId ?? '정답 정보 없음');
    const selected = element('div');
    selected.append(element('span', '', '내 선택'), element('strong', '', selectedLabel));
    answers.append(selected);
    if (!row.correct || selectedLabel !== correctLabel) {
      const expected = element('div', 'expected');
      expected.append(element('span', '', '정답'), element('strong', '', correctLabel));
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
  const score = current.race ?? result.race ?? {};
  const band = result.finishBand ?? result.band ?? (score.correct === score.possible ? 'POLE_POSITION' : score.correct >= 5 ? 'PODIUM' : score.correct >= 3 ? 'POINTS_FINISH' : 'GARAGE_REVIEW');
  const [title, copy] = FINISH_COPY[band] ?? FINISH_COPY.GARAGE_REVIEW;
  const card = element('article', `result-card band-${String(band).toLowerCase()}`);
  card.append(element('div', 'result-kicker', 'CHEQUERED FLAG'), element('h1', '', title), element('p', 'lead', copy));
  const scoreGrid = element('div', 'result-score-grid');
  const values = [
    [score.correct ?? 0, `/ ${score.possible ?? 7}`, '정답'],
    [`${score.accuracy ?? 0}%`, '', '정확도'],
    [score.pitTimeMs ? `${(score.pitTimeMs / 1000).toFixed(1)}s` : '—', '', '피트'],
  ];
  for (const [value, suffix, label] of values) {
    const box = element('div');
    const strong = element('strong', '', value);
    if (suffix) strong.append(element('small', '', suffix));
    box.append(strong, element('span', '', label));
    scoreGrid.append(box);
  }
  card.append(scoreGrid);
  const upgrades = element('div', 'upgrade-summary');
  upgrades.append(element('h2', '', '획득한 레이스 효과'));
  [
    [score.launchBoost, 'LAUNCH BOOST'],
    [(score.nitro ?? 0) > 0, `NITRO × ${score.nitro ?? 0}`],
    [(score.pitTimeMs ?? 9999) < 3000, 'FAST PIT'],
    [score.aeroActive, 'AERO BOOST'],
    [score.nitroDeploy, 'NITRO DEPLOY'],
  ].forEach(([active, label]) => upgrades.append(element('span', active ? 'active' : '', `${active ? '✓' : '—'} ${label}`)));
  card.append(upgrades);
  const review = resultReview(result);
  if (review) card.append(review);
  else {
    const history = observationHistory(current);
    if (history) card.append(history);
  }
  const trend = trendCard(current.trend ?? result.trend);
  if (trend) card.append(trend);
  const again = element('button', 'primary-button', '새 머신으로 다시 도전');
  again.type = 'button';
  again.addEventListener('click', () => {
    sessionRemove(TOKEN_KEY);
    resetDeviceId();
    playerToken = null;
    state = null;
    feedbackGate = null;
    renderKey = '';
    pendingChoices.clear();
    optionLabels.clear();
    sessionRemove(LABEL_CACHE_KEY);
    Object.keys(garage).forEach((key) => { garage[key] = null; });
    renderLobby();
  });
  card.append(again);
  return card;
}

function stateKey(current) {
  return JSON.stringify({
    phase: current.round?.phase,
    tasks: current.tasks,
    observations: current.observations,
    race: current.race,
    trend: current.trend,
    result: current.result,
    feedback: feedbackGate?.taskId ?? null,
  });
}

function displayRemainingMs(current) {
  if (current.round?.phase === 'QUEUED') {
    return current.round?.phaseRemainingMs ?? current.queue?.currentRemainingMs ?? 0;
  }
  return current.round?.remainingMs ?? current.round?.phaseRemainingMs ?? 0;
}

function renderState(current, { preserveFocus = false } = {}) {
  app.replaceChildren(identityBar(current), raceHero(current), phaseStrip(current));
  if (feedbackGate) {
    app.append(feedbackPanel(current));
  } else if (['RESULT', 'COMPLETE'].includes(current.round?.phase)) {
    app.append(resultPanel(current));
  } else if (Array.isArray(current.tasks) && current.tasks.length > 0) {
    const trend = trendCard(current.trend);
    if (trend) app.append(trend);
    const stack = element('section', 'encounter-stack');
    current.tasks.forEach((task, index) => stack.append(taskCard(current, task, index)));
    app.append(stack);
    const history = observationHistory(current);
    if (history) app.append(history);
  } else {
    app.append(waitingPanel(current));
  }
  if (!preserveFocus) {
    const heading = app.querySelector('h1, h2');
    if (heading) {
      heading.tabIndex = -1;
      requestAnimationFrame(() => heading.focus({ preventScroll: true }));
    }
  }
}

function updateClock(current) {
  const clock = document.querySelector('#race-clock');
  if (clock) clock.textContent = formatTime(displayRemainingMs(current));
}

async function refresh() {
  if (playerToken && state?.round?.phase === 'COMPLETE') {
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
    state = current;
    setConnection('● RACE CONTROL 연결됨', true);
    clearExpiredNotice();
    const key = stateKey(current);
    if (key !== renderKey) {
      renderState(current);
      renderKey = key;
    }
    updateClock(current);
  } catch (error) {
    if (error.status === 401) {
      sessionRemove(TOKEN_KEY);
      playerToken = null;
      state = null;
      feedbackGate = null;
      renderKey = '';
      setConnection('참가 세션이 만료되었습니다.', false);
      setNotice('세션이 끝나 차고로 돌아왔습니다.');
      if (!catalog) await loadCatalog(); else renderLobby();
    } else {
      setConnection('Race Control 재연결 중…', false);
    }
  }
}

setConnection(playerToken ? '레이스 세션 복구 중…' : '그리드 정보 확인 중…');
refresh();
setInterval(refresh, 750);
