const app = document.querySelector('#app');
const connection = document.querySelector('#connection');
const notice = document.querySelector('#notice');

const TOKEN_KEY = 'breach5-player-token';
const DEVICE_KEY = 'breach5-device-id';
const DIFFICULTY_LABELS = {
  BEGINNER: ['초급 · Guided', '핵심 줄 주석과 판단 근거를 함께 제공합니다.'],
  ADVANCED: ['고급 · Analyst', '원문 증거와 실제 기술 표현만 제공합니다.'],
};
const PHASE_LABELS = {
  QUEUED: '다음 판 대기', JOIN: '참가자 집결', BRIEF: '사건 브리핑', DISCOVER: '증거 분석',
  BUILD: '요청 조립', EXECUTE: '격리 실행', DUEL: '패치 선택', REVERIFY: '회귀 검증',
  RESULT: '사건 결과', COMPLETE: '라운드 종료',
};
const ROLE_LABELS = {
  SCOUT: '정찰자', BUILDER: '조립자', RUNNER: '실행자', MONITOR: '관제자',
  GATEKEEPER: '게이트키퍼', PATCHER: '패처', FULL_STACK: '공격·방어 통합',
};
const OUTCOMES = {
  BREACHED_THEN_CONTAINED: ['침해 후 봉쇄', '공격 체인을 재현한 뒤 근본 패치의 회귀 검증까지 통과했습니다.'],
  BREACHED: ['침해 재현', '취약 경계에 도달했지만 근본 패치가 회귀 검증을 통과하지 못했습니다.'],
  BLOCKED: ['공격 차단', '공격 조건은 완성되지 않았고 방어 회귀 검증은 통과했습니다.'],
  STALEMATE: ['판정 미완료', '필수 증거나 선택이 부족해 기술적 결론을 내리지 않았습니다.'],
  INCOMPLETE: ['분석 미완료', '숨은 기본값을 쓰지 않았습니다. 제출된 증거만으로 판정했습니다.'],
  ENGINE_ERROR: ['엔진 점검 필요', '격리 판정 엔진 응답을 확인할 수 없습니다.'],
};

function sessionGet(key) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

function sessionSet(key, value) {
  try { sessionStorage.setItem(key, value); } catch {}
}

function sessionRemove(key) {
  try { sessionStorage.removeItem(key); } catch {}
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

let playerToken = sessionGet(TOKEN_KEY);
let state = null;
let catalog = null;
let busy = false;
let renderKey = null;
let selectedScenario = null;
let selectedDifficulty = null;
const pendingChoices = new Map();
const pendingPreviews = new Map();
const previewErrors = new Set();
const evidenceTabs = new Map();

function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = String(text);
  return node;
}

function setConnection(text, online = false) {
  if (connection.textContent !== text) connection.textContent = text;
  if (connection.classList.contains('online') !== online) connection.classList.toggle('online', online);
}

function setNotice(text = '') {
  if (notice.textContent !== text) notice.textContent = text;
  notice.hidden = text.length === 0;
}

function formatTime(milliseconds) {
  const seconds = Math.max(0, Math.ceil((Number(milliseconds) || 0) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

async function api(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (playerToken) headers.Authorization = `Bearer ${playerToken}`;
  if (options.body) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, { ...options, headers, cache: 'no-store' });
  const body = await response.json().catch(() => ({ error: 'invalid_response' }));
  if (!response.ok) {
    throw Object.assign(new Error(body.error ?? 'request_failed'), { status: response.status, code: body.error });
  }
  return body;
}

function safeExternalLink(url, label) {
  if (typeof url !== 'string' || !url.startsWith('https://')) return null;
  const link = element('a', 'source-link', label);
  link.href = url;
  link.target = '_blank';
  link.rel = 'noreferrer noopener';
  return link;
}

async function loadCatalog() {
  try {
    const value = await api('/api/catalog');
    catalog = Array.isArray(value) ? { scenarios: value, difficulties: ['BEGINNER', 'ADVANCED'] } : value;
    if (!Array.isArray(catalog?.scenarios)) throw new Error('invalid catalog');
    setConnection('● 3분 보안 랩 운영 중', true);
    renderLobby(true);
  } catch {
    setConnection('서버 연결 복구 중…', false);
    setNotice('시나리오 목록을 불러오지 못했습니다. 자동으로 다시 시도합니다.');
    renderLobby(true);
  }
}

async function join() {
  if (busy || !selectedScenario || !selectedDifficulty) return;
  busy = true;
  setNotice();
  const button = document.querySelector('#join-button');
  if (button) button.disabled = true;
  try {
    const identity = await api('/api/join', {
      method: 'POST',
      body: JSON.stringify({ deviceId: deviceId(), scenarioId: selectedScenario, difficulty: selectedDifficulty }),
    });
    playerToken = identity.token;
    sessionSet(TOKEN_KEY, playerToken);
    renderKey = null;
    await refresh();
  } catch (error) {
    const messages = {
      capacity: '현재 판과 다음 판이 모두 찼습니다. 관전자 화면에서 결과를 확인해 주세요.',
      invalid_scenario: '선택한 사건을 사용할 수 없습니다. 다시 선택해 주세요.',
      invalid_difficulty: '선택한 난이도를 사용할 수 없습니다. 다시 선택해 주세요.',
    };
    setNotice(messages[error.code] ?? '입장에 실패했습니다. 연결을 확인한 뒤 다시 시도하세요.');
    renderLobby(true);
  } finally {
    busy = false;
    const currentButton = document.querySelector('#join-button');
    if (currentButton) currentButton.disabled = !(selectedScenario && selectedDifficulty);
  }
}

async function submit(task, choice) {
  if (busy || !state || !task || !choice) return;
  busy = true;
  setNotice();
  document.querySelectorAll('.task-card button').forEach((button) => { button.disabled = true; });
  try {
    await api('/api/action', {
      method: 'POST',
      body: JSON.stringify({
        roundId: state.round.roundId,
        task,
        choice,
        actionId: `a_${crypto.randomUUID().replaceAll('-', '')}`,
      }),
    });
    pendingChoices.delete(task);
    pendingPreviews.delete(`${task}:${choice}`);
    previewErrors.delete(`${task}:${choice}`);
    renderKey = null;
    await refresh();
  } catch (error) {
    const messages = {
      phase_closed: '이 분석 단계가 종료되었습니다. 최신 단계로 이동합니다.',
      choice_locked: '이미 확정한 선택입니다. 팀 판정에는 최초 제출만 반영됩니다.',
      invalid_choice: '허용된 기술 선택지가 아닙니다.',
    };
    setNotice(messages[error.code] ?? '선택을 저장하지 못했습니다. 연결을 확인한 뒤 다시 눌러 주세요.');
    renderKey = null;
    await refresh();
  } finally {
    busy = false;
  }
}

async function stageChoice(task, choice) {
  if (!state) return;
  pendingChoices.set(task, choice);
  const previewKey = `${task}:${choice}`;
  pendingPreviews.delete(previewKey);
  previewErrors.delete(previewKey);
  renderState(state, { preserveFocus: true });
  try {
    const value = await api('/api/preview', {
      method: 'POST',
      body: JSON.stringify({ roundId: state.round.roundId, task, choice }),
    });
    if (pendingChoices.get(task) === choice && value?.preview) {
      pendingPreviews.set(previewKey, value.preview);
      renderState(state, { preserveFocus: true });
    }
  } catch (error) {
    previewErrors.add(previewKey);
    renderState(state, { preserveFocus: true });
    if (error.code === 'phase_closed') setNotice('분석 단계가 바뀌었습니다. 최신 증거를 다시 불러옵니다.');
    else setNotice('조립 미리보기를 만들지 못했습니다. 선택은 아직 제출되지 않았습니다.');
  }
  requestAnimationFrame(() => document.querySelector('#confirm-choice')?.focus());
}

function difficultyLabel(value) {
  return DIFFICULTY_LABELS[value]?.[0] ?? value ?? '난이도 미지정';
}

function renderLobby(force = false) {
  if (!force && renderKey === 'lobby') return;
  renderKey = 'lobby';
  app.replaceChildren();
  const card = element('article', 'landing-card lobby-card');
  card.append(
    element('div', 'eyebrow', 'BREACH//5 · EVIDENCE LAB'),
    element('h1', '', '사건을 고르고\n증거로 입증하세요.'),
    element('p', 'lead', 'Raw HTTP, 로그, 코드 diff를 비교해 요청을 조립하고 격리된 서버에서 패치까지 검증합니다.'),
  );

  const scenarioHeading = element('h2', 'lobby-heading', '1. 사건 선택');
  const caseGrid = element('div', 'case-grid');
  const scenarios = catalog?.scenarios ?? [];
  for (const scenario of scenarios) {
    const button = element('button', 'case-card');
    button.type = 'button';
    button.dataset.scenarioId = scenario.id;
    button.setAttribute('aria-pressed', String(selectedScenario === scenario.id));
    if (selectedScenario === scenario.id) button.classList.add('selected');
    const number = String(caseGrid.children.length + 1).padStart(2, '0');
    button.append(
      element('span', 'case-index', number),
      element('strong', '', scenario.shortLabel ?? scenario.title),
      element('b', '', scenario.title),
      element('small', '', scenario.subtitle ?? scenario.category ?? scenario.briefing),
    );
    if (scenario.rewardClaim) button.append(element('em', 'reward-claim', `${scenario.rewardClaim} · 연구자 공개 주장`));
    button.addEventListener('click', () => {
      selectedScenario = scenario.id;
      renderLobby(true);
    });
    caseGrid.append(button);
  }

  const difficultyHeading = element('h2', 'lobby-heading', '2. 난이도 선택');
  const difficultyGrid = element('div', 'difficulty-grid');
  for (const value of catalog?.difficulties ?? ['BEGINNER', 'ADVANCED']) {
    const [label, detail] = DIFFICULTY_LABELS[value] ?? [value, '같은 판정 엔진을 사용합니다.'];
    const button = element('button', 'difficulty-card');
    button.type = 'button';
    button.dataset.difficulty = value;
    button.setAttribute('aria-pressed', String(selectedDifficulty === value));
    if (selectedDifficulty === value) button.classList.add('selected');
    button.append(element('strong', '', label), element('small', '', detail));
    button.addEventListener('click', () => {
      selectedDifficulty = value;
      renderLobby(true);
    });
    difficultyGrid.append(button);
  }

  const joinButton = element('button', 'primary-button', '이 설정으로 참가');
  joinButton.id = 'join-button';
  joinButton.type = 'button';
  joinButton.disabled = !(selectedScenario && selectedDifficulty);
  joinButton.addEventListener('click', join);
  const rule = element('p', 'selection-rule', selectedScenario && selectedDifficulty
    ? '입장 후에는 이번 라운드의 사건과 난이도가 고정됩니다.'
    : '사건과 난이도를 모두 골라야 참가할 수 있습니다.');
  const selected = scenarios.find((scenario) => scenario.id === selectedScenario);
  const source = selected ? safeExternalLink(selected.sourceUrl, '사례 원문 열기') : null;
  card.append(scenarioHeading, caseGrid, difficultyHeading, difficultyGrid, joinButton, rule);
  if (source) card.append(source);
  card.append(element('p', 'privacy-note', '계정이나 닉네임을 받지 않습니다. 브라우저에 저장한 익명 기기 ID만 재접속에 사용합니다.'));
  app.append(card);
}

function identityCard(current) {
  const team = current.player.team ?? current.player.mode ?? 'FULL_STACK';
  const styleTeam = team === 'BLUE' ? 'blue' : team === 'RED' ? 'red' : 'full';
  const card = element('div', `identity-card ${styleTeam}-identity`);
  const text = element('div');
  const scenarioLabel = current.scenario.shortLabel ?? current.scenario.title;
  const mode = current.player.mode === 'FULL_STACK' || team === 'FULL_STACK' ? 'FULL-STACK' : `${team} TEAM`;
  text.append(
    element('span', '', `${scenarioLabel} · ${difficultyLabel(current.player.difficulty)}`),
    element('strong', '', current.player.callsign),
    element('small', '', `${mode} · ${ROLE_LABELS[current.player.role] ?? current.player.role ?? 'ANALYST'}`),
  );
  const timer = element('div', 'round-timer');
  const label = element('span', '', PHASE_LABELS[current.round.phase] ?? current.round.phase);
  label.id = 'phase-timer-label';
  const value = element('b', '', formatTime(current.round.phaseRemainingMs));
  value.id = 'phase-timer';
  value.setAttribute('role', 'timer');
  timer.append(label, value);
  card.append(text, timer);
  return card;
}

function macroPhase(phase) {
  if (phase === 'JOIN' || phase === 'QUEUED' || phase === 'BRIEF') return 0;
  if (phase === 'DISCOVER') return 1;
  if (phase === 'BUILD') return 2;
  if (phase === 'EXECUTE' || phase === 'DUEL' || phase === 'REVERIFY') return 3;
  return 4;
}

function phaseStrip(current) {
  const labels = ['입장', '분석', '조립', '검증', '결과'];
  const active = macroPhase(current.round.phase);
  const strip = element('ol', 'macro-phase-strip');
  strip.setAttribute('aria-label', '라운드 진행 단계');
  labels.forEach((label, index) => {
    const item = element('li', index < active ? 'done' : index === active ? 'active' : '', label);
    if (index === active) item.setAttribute('aria-current', 'step');
    strip.append(item);
  });
  return strip;
}

function codePane(value, label = '기술 증거') {
  const pre = element('pre', 'code-pane');
  pre.setAttribute('aria-label', label);
  pre.textContent = String(value ?? '');
  return pre;
}

function evidenceDeck(task) {
  const section = element('section', 'evidence-deck');
  const heading = element('h3', '', 'Evidence Deck');
  const evidence = Array.isArray(task.evidence) ? task.evidence : [];
  if (evidence.length === 0) {
    section.append(heading, element('p', 'empty-evidence', '이 단계에 공개된 증거가 없습니다.'));
    return section;
  }
  const currentId = evidence.some((item) => item.id === evidenceTabs.get(task.id)) ? evidenceTabs.get(task.id) : evidence[0].id;
  evidenceTabs.set(task.id, currentId);
  const tabs = element('div', 'evidence-tabs');
  tabs.setAttribute('role', 'tablist');
  const panels = element('div', 'evidence-panels');
  evidence.forEach((item, index) => {
    const tab = element('button', 'evidence-tab', item.source ?? item.label ?? `E${index + 1}`);
    const tabId = `tab-${task.id}-${index}`;
    const panelId = `panel-${task.id}-${index}`;
    tab.id = tabId;
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', panelId);
    tab.setAttribute('aria-selected', String(item.id === currentId));
    if (item.id === currentId) tab.classList.add('selected');
    tab.addEventListener('click', () => {
      evidenceTabs.set(task.id, item.id);
      renderState(state, { preserveFocus: true });
      requestAnimationFrame(() => document.querySelector(`#${CSS.escape(tabId)}`)?.focus());
    });
    tabs.append(tab);

    const panel = element('article', 'evidence-panel');
    panel.id = panelId;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tabId);
    panel.hidden = item.id !== currentId;
    panel.append(element('div', 'evidence-meta', `${item.kind ?? 'artifact'} · ${item.label ?? item.id}`), codePane(item.value, item.label));
    if (item.annotation) panel.append(element('p', 'evidence-annotation', item.annotation));
    panels.append(panel);
  });
  section.append(heading, tabs, panels);
  return section;
}

function previewPanel(current, task, pending) {
  const preview = pending
    ? (pendingPreviews.get(`${task.id}:${pending}`) ?? current.labPreview)
    : current.labPreview;
  const section = element('section', 'lab-preview');
  section.append(element('h3', '', preview?.title ?? '선택 미리보기'));
  if (preview?.request) section.append(codePane(preview.request, '조립된 Raw HTTP'));
  if (Array.isArray(preview?.trace) && preview.trace.length > 0) section.append(codePane(preview.trace.join('\n'), '해석 trace'));
  if (pending) {
    const option = task.options.find((candidate) => candidate.id === pending);
    if (option) {
      const candidate = element('div', 'candidate-preview');
      candidate.append(element('span', '', '이번 제출 후보'), element('strong', '', option.label), codePane(option.technical ?? option.id, '선택할 기술 표현'));
      section.append(candidate);
    }
  } else if (!preview?.request) {
    section.append(element('p', 'empty-evidence', '선택지를 누르면 제출 전에 실제 기술 표현을 확인할 수 있습니다.'));
  }
  return section;
}

function observationRecap(tasks) {
  const completed = tasks.filter((task) => task.selected && task.selectedObservation);
  if (completed.length === 0) return null;
  const section = element('section', 'observation-recap');
  section.append(element('h3', '', '제출 근거 확인'));
  for (const task of completed) {
    const selected = task.options.find((option) => option.id === task.selected);
    const item = element('div', 'observation-item');
    item.append(
      element('b', '', selected?.label ?? task.selected),
      element('p', '', task.selectedObservation),
    );
    section.append(item);
  }
  return section;
}

function observationHistory(observations) {
  const completed = (observations ?? []).filter((item) => item.observation);
  if (completed.length === 0) return null;
  const section = element('details', 'observation-history');
  section.open = true;
  section.append(element('summary', '', `내 판단 근거 ${completed.length}개 다시 보기`));
  const list = element('div', 'observation-recap');
  for (const item of completed) {
    const row = element('div', 'observation-item');
    row.append(element('b', '', item.label ?? item.choice), element('p', '', item.observation));
    list.append(row);
  }
  section.append(list);
  return section;
}

function tasksPanel(current) {
  const wrapper = element('div', 'task-stack');
  const pendingTask = current.tasks.find((task) => !task.selected);
  const completed = current.tasks.filter((task) => task.selected).length;
  if (!pendingTask) {
    const card = element('article', 'mission-card passive-card task-complete');
    card.append(
      element('div', 'eyebrow', `${PHASE_LABELS[current.round.phase]} · 제출 완료`),
      element('h2', '', '필수 판단을 모두 제출했습니다.'),
      element('p', '', '팀의 남은 응답이 모이면 즉시 다음 단계로 이동합니다. 타이머는 최대 제한입니다.'),
    );
    const recap = observationHistory(current.observations);
    if (recap) card.append(recap);
    if (current.labPreview) card.append(previewPanel(current, { options: [] }, null));
    wrapper.append(card);
    return wrapper;
  }

  const card = element('article', 'mission-card task-card');
  const pending = pendingChoices.get(pendingTask.id) ?? null;
  card.append(
    element('div', 'eyebrow', `${PHASE_LABELS[current.round.phase]} · ${completed + 1}/${current.tasks.length}`),
    element('h2', '', pendingTask.prompt),
    element('p', 'criterion', pendingTask.criterion ?? '공개된 증거와 일치하는 기술 판단을 선택하세요.'),
    evidenceDeck(pendingTask),
  );
  const recap = observationHistory(current.observations);
  if (recap) card.append(recap);

  const options = element('div', 'option-list');
  for (const option of pendingTask.options) {
    const button = element('button', 'option-button');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(pending === option.id));
    if (pending === option.id) button.classList.add('selected');
    button.append(
      element('b', '', option.label),
      element('code', '', option.technical ?? option.id),
      option.detail ? element('span', '', option.detail) : element('span', 'advanced-note', '원문 증거로 판단하세요.'),
      element('i', '', pending === option.id ? 'READY' : 'PREVIEW'),
    );
    button.addEventListener('click', () => stageChoice(pendingTask.id, option.id));
    options.append(button);
  }
  card.append(element('h3', 'option-heading', '증거와 일치하는 판단'), options, previewPanel(current, pendingTask, pending));
  const previewKey = pending ? `${pendingTask.id}:${pending}` : null;
  const previewReady = previewKey ? pendingPreviews.has(previewKey) : false;
  const previewFailed = previewKey ? previewErrors.has(previewKey) : false;
  const confirm = element('button', 'confirm-button', !pending
    ? '먼저 선택지를 미리보세요'
    : previewFailed ? '미리보기 실패 · 선택지를 다시 누르세요'
      : previewReady ? '이 판단을 확정해 제출' : '실제 요청 미리보기 생성 중…');
  confirm.id = 'confirm-choice';
  confirm.type = 'button';
  confirm.disabled = !pending || !previewReady;
  confirm.addEventListener('click', () => submit(pendingTask.id, pending));
  card.append(confirm, element('p', 'confirm-note', '선택지를 한 번 누르는 것만으로는 제출되지 않습니다. 미리보기 후 확정하세요.'));
  wrapper.append(card);
  return wrapper;
}

function passivePanel(current) {
  const phase = current.round.phase;
  const card = element('article', `mission-card passive-card ${phase === 'QUEUED' ? 'queue-card' : ''}`);
  const copy = {
    QUEUED: ['선택한 사건의 다음 라운드에 배치되었습니다.', '중간 난입은 없습니다. 현재 판이 끝나면 같은 설정으로 자동 입장합니다.'],
    JOIN: ['참가자를 모으는 중입니다.', '1명이면 FULL-STACK, 2명 이상이면 RED/BLUE로 나뉩니다.'],
    BRIEF: [current.scenario.title, current.scenario.briefing],
    EXECUTE: ['격리 엔진에서 실제 판정 중입니다.', '브라우저는 allowlist 선택값만 보내며 raw payload는 서버가 소유합니다.'],
    REVERIFY: ['공격·변형·정상 흐름을 재검증합니다.', '공격 차단과 정상 기능 보존을 함께 확인합니다.'],
    COMPLETE: ['라운드가 종료되었습니다.', '결과를 검토한 뒤 다른 사건이나 난이도로 다시 참여할 수 있습니다.'],
  }[phase] ?? ['팀 응답을 모으는 중입니다.', '필수 응답이 모두 모이면 최대 시간보다 일찍 다음 단계로 이동합니다.'];
  card.append(element('div', 'eyebrow', PHASE_LABELS[phase] ?? phase), element('h2', '', copy[0]), element('p', '', copy[1]));
  if (phase === 'QUEUED' && current.queue) {
    const status = element('div', 'queue-status');
    const waiting = current.queue.nextTotal ?? ((current.queue.nextCounts?.RED ?? 0) + (current.queue.nextCounts?.BLUE ?? 0));
    status.append(
      element('span', 'queue-current-phase', `현재 판 · ${PHASE_LABELS[current.queue.currentPhase] ?? current.queue.currentPhase ?? '진행 중'}`),
      element('b', 'queue-count', `다음 판 ${waiting}명 대기`),
      element('small', 'queue-current-time', `시작까지 최대 ${formatTime(current.queue.currentRemainingMs ?? current.queue.startsInMs)}`),
    );
    card.append(status);
  } else {
    const pulse = element('div', 'packet-pulse');
    pulse.append(element('i'), element('span', '', phase === 'EXECUTE' || phase === 'REVERIFY' ? 'ISOLATED ENGINE RUNNING' : 'WAITING FOR REQUIRED RESPONSES'));
    card.append(pulse);
  }
  if (current.labPreview) card.append(previewPanel(current, { options: [] }, null));
  const history = observationHistory(current.observations);
  if (history) card.append(history);
  return card;
}

function normalizeRegressionRows(current) {
  const sources = [current.result?.regression, current.result?.patch?.regression, current.execution?.patch?.regression, current.execution?.regression];
  for (const source of sources) {
    if (Array.isArray(source)) {
      return source.map((row, index) => ({
        label: row.label ?? row.case ?? row.id ?? `CASE ${index + 1}`,
        status: row.status ?? row.result ?? (row.passed === true ? 'PASS' : row.passed === false ? 'FAIL' : 'CHECK'),
        reason: row.reason ?? row.detail ?? '',
      }));
    }
  }
  const patch = current.result?.patch ?? current.execution?.patch;
  if (patch && typeof patch === 'object') {
    const labels = { original: '원본 공격', variant: '변형 공격', normal: '정상 흐름' };
    return ['original', 'variant', 'normal'].filter((key) => patch[key] !== undefined).map((key) => {
      const value = patch[key];
      if (typeof value === 'object') {
        const status = key === 'normal'
          ? (value.passed === true || (value.bootstrapTriggered === true && value.proofReached !== true) ? 'PASS' : 'FAIL')
          : value.proofReached === true ? 'REACHED'
            : value.blocked === true ? 'BLOCK'
              : 'INERT';
        return { label: labels[key], status, reason: value.reason ?? '' };
      }
      return { label: labels[key], status: String(value), reason: '' };
    });
  }
  return [];
}

function resultPanel(current) {
  const result = current.result;
  if (!result) return passivePanel(current);
  const [title, copy] = OUTCOMES[result.outcome] ?? OUTCOMES.STALEMATE;
  const card = element('article', `mission-card result-card outcome-${String(result.outcome ?? 'stalemate').toLowerCase()}`);
  card.append(element('div', 'eyebrow', `${current.scenario.shortLabel ?? current.scenario.title} · INCIDENT RESULT`), element('h2', '', title), element('p', 'lead', copy));
  const score = element('div', 'score-row');
  score.append(
    element('div', 'score red-score', `RED ${result.redScore ?? 0}/${result.redPossible ?? '?'}`),
    element('div', 'score blue-score', `BLUE ${result.blueScore ?? 0}/${result.bluePossible ?? '?'}`),
  );
  card.append(score);
  const history = observationHistory(current.observations);
  if (history) card.append(history);

  const rows = normalizeRegressionRows(current);
  if (rows.length > 0) {
    const matrix = element('section', 'regression-section');
    matrix.setAttribute('aria-live', 'polite');
    matrix.append(element('h3', '', 'Regression Matrix'));
    const list = element('div', 'regression-matrix');
    rows.forEach((row) => {
      const item = element('div', 'regression-row');
      const status = String(row.status).toUpperCase();
      item.append(element('b', '', row.label), element('strong', /PASS|BLOCK|REJECT|INERT/.test(status) ? 'pass' : /FAIL|REACHED|DELAY/.test(status) ? 'fail' : '', status));
      if (row.reason) item.append(element('small', '', row.reason));
      list.append(item);
    });
    matrix.append(list);
    card.append(matrix);
  }

  const lessons = element('ol', 'lesson-list');
  for (const line of result.explanation ?? []) lessons.append(element('li', '', line));
  if (lessons.children.length) card.append(lessons);
  const baseline = result.baseline ?? current.execution?.baseline;
  const raw = baseline?.rawHttp ?? baseline?.request ?? current.labPreview?.request;
  if (raw) {
    const details = element('details', 'raw-details');
    details.append(element('summary', '', '판정에 사용한 Raw HTTP 보기'), codePane(raw, '판정 Raw HTTP'));
    card.append(details);
  }
  if (current.scenario.sourceUrl) {
    const source = safeExternalLink(current.scenario.sourceUrl, '공개 사례 원문 확인');
    if (source) card.append(source);
  }
  const again = element('button', 'primary-button', '다른 사건 또는 난이도로 다시 참가');
  again.type = 'button';
  again.addEventListener('click', () => {
    sessionRemove(TOKEN_KEY);
    playerToken = null;
    state = null;
    renderKey = null;
    pendingChoices.clear();
    pendingPreviews.clear();
    previewErrors.clear();
    selectedScenario = null;
    selectedDifficulty = null;
    renderLobby(true);
  });
  card.append(again);
  return card;
}

function stateKey(current) {
  return JSON.stringify({
    roundId: current.round.roundId,
    phase: current.round.phase,
    player: current.player,
    tasks: current.tasks,
    observations: current.observations,
    labPreview: current.labPreview,
    result: current.result,
  });
}

function renderState(current, { preserveFocus = false } = {}) {
  if (!current) return;
  app.replaceChildren(identityCard(current), phaseStrip(current));
  if (current.round.phase === 'RESULT' || current.round.phase === 'COMPLETE') app.append(resultPanel(current));
  else if ((current.tasks ?? []).length > 0) app.append(tasksPanel(current));
  else app.append(passivePanel(current));
  if (!preserveFocus) {
    const heading = app.querySelector('.mission-card h2');
    if (heading) {
      heading.tabIndex = -1;
      requestAnimationFrame(() => heading.focus({ preventScroll: true }));
    }
  }
}

function updateDynamic(current) {
  const label = document.querySelector('#phase-timer-label');
  const timer = document.querySelector('#phase-timer');
  if (label) label.textContent = PHASE_LABELS[current.round.phase] ?? current.round.phase;
  if (timer) timer.textContent = formatTime(current.round.phaseRemainingMs);
  const queueTime = document.querySelector('.queue-current-time');
  if (queueTime && current.queue) queueTime.textContent = `시작까지 최대 ${formatTime(current.queue.currentRemainingMs ?? current.queue.startsInMs)}`;
}

async function refresh() {
  if (!playerToken) {
    if (!catalog) await loadCatalog();
    else renderLobby();
    return;
  }
  try {
    const current = await api('/api/state');
    state = current;
    setConnection('● 격리 판정 서버 연결됨', true);
    const nextKey = stateKey(current);
    if (nextKey !== renderKey) {
      renderState(current);
      renderKey = nextKey;
    }
    updateDynamic(current);
  } catch (error) {
    if (error.status === 401) {
      sessionRemove(TOKEN_KEY);
      playerToken = null;
      state = null;
      renderKey = null;
      setConnection('참가 세션이 만료되었습니다.', false);
      setNotice('세션이 만료되어 사건 선택 화면으로 돌아왔습니다.');
      if (!catalog) await loadCatalog(); else renderLobby(true);
    } else {
      setConnection('연결 복구 중…', false);
    }
  }
}

setConnection(playerToken ? '참가 세션 복구 중…' : '시나리오 목록 확인 중…');
refresh();
setInterval(refresh, 750);
