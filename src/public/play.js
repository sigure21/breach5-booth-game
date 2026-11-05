const app = document.querySelector('#app');
const connection = document.querySelector('#connection');
const notice = document.querySelector('#notice');
const TOKEN_KEY = 'breach5-player-token';
const DEVICE_KEY = 'breach5-device-id';
const PHASE_LABELS = {
  QUEUED: '다음 판 대기', JOIN: '팀 집결', BRIEF: '사건 공개', DISCOVER: '신뢰 오류 발견',
  BUILD: '공격·탐지 조립', EXECUTE: '실전 실행', DUEL: '패치·우회 결투',
  REVERIFY: '재검증', RESULT: '사건 결과', COMPLETE: '라운드 종료',
};
const ROLE_LABELS = {
  SCOUT: '정찰자', BUILDER: '조립자', RUNNER: '실행자',
  MONITOR: '관제자', GATEKEEPER: '게이트키퍼', PATCHER: '패처',
};
const OUTCOMES = {
  BREACHED_THEN_CONTAINED: ['침해 후 봉쇄', '공격은 성공했지만 패치 재검증에서 체인이 끊겼습니다.'],
  BREACHED: ['RED 침해 성공', '변형 공격까지 통과했습니다. 근본 패치가 필요합니다.'],
  BLOCKED: ['BLUE 차단 성공', '공격 요청은 실패했고 패치도 회귀 검증을 통과했습니다.'],
  STALEMATE: ['판정 보류', '공격과 패치 모두 완전한 조건을 만들지 못했습니다.'],
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

let fallbackDeviceId = null;
function deviceId() {
  if (fallbackDeviceId) return fallbackDeviceId;
  try {
    const stored = localStorage.getItem(DEVICE_KEY);
    if (/^[a-f0-9]{32}$/.test(stored ?? '')) return stored;
    const created = randomDeviceId();
    localStorage.setItem(DEVICE_KEY, created);
    return created;
  } catch {
    fallbackDeviceId = randomDeviceId();
    return fallbackDeviceId;
  }
}

let playerToken = sessionGet(TOKEN_KEY);
let state = null;
let busy = false;
let renderKey = null;
let practiceStep = 0;
let practiceAnswered = false;

function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
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
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
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

async function join() {
  if (busy) return;
  busy = true;
  try {
    const identity = await api('/api/join', {
      method: 'POST',
      body: JSON.stringify({ deviceId: deviceId() }),
    });
    playerToken = identity.token;
    sessionSet(TOKEN_KEY, playerToken);
    setConnection(`${identity.callsign} · ${identity.team}`, true);
    setNotice();
    renderKey = null;
    await refresh();
  } catch (error) {
    setNotice(error.code === 'capacity' ? '현재 판과 다음 판이 모두 찼습니다. 대형 화면의 결과를 관전해 주세요.' : '입장에 실패했습니다. 다시 시도하세요.');
    renderLanding(true);
  } finally {
    busy = false;
  }
}

async function submit(task, choice) {
  if (busy || !state) return;
  busy = true;
  setNotice();
  document.querySelectorAll('.option-button').forEach((button) => { button.disabled = true; });
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
    await refresh();
  } catch (error) {
    if (error.code === 'phase_closed') setNotice('단계가 종료되었습니다. 다음 화면으로 이동합니다.');
    else if (error.code === 'choice_locked') setNotice('이미 확정한 선택입니다. 팀 결과에 반영되었습니다.');
    else setNotice('선택을 저장하지 못했습니다. 연결을 확인한 뒤 다시 눌러 주세요.');
    await refresh();
  } finally {
    busy = false;
    document.querySelectorAll('.option-button').forEach((button) => { button.disabled = false; });
  }
}

function renderLanding(force = false) {
  if (!force && renderKey === 'landing') return;
  renderKey = 'landing';
  app.replaceChildren();
  const hero = element('article', 'landing-card');
  hero.append(
    element('div', 'eyebrow', '5-MINUTE RED VS BLUE'),
    element('h1', '', '5분 안에\n뚫거나 막아라.'),
    element('p', 'lead', '터미널도, 플래그도 없습니다. 휴대폰으로 실제 요청을 조립하고 격리된 서버의 반응을 확인하세요.'),
  );
  const features = element('div', 'feature-grid');
  for (const [icon, title, copy] of [
    ['01', '증거를 찾고', '서버가 잘못 믿은 값을 고릅니다.'],
    ['02', '요청을 만들고', '실제 프로토콜 블록을 조합합니다.'],
    ['03', '다시 막습니다', '패치를 변형 공격으로 재검증합니다.'],
  ]) {
    const item = element('div', 'feature-item');
    item.append(element('span', '', icon), element('b', '', title), element('small', '', copy));
    features.append(item);
  }
  const button = element('button', 'primary-button', '지금 참가하기');
  button.type = 'button';
  button.addEventListener('click', join);
  hero.append(features, button, element('p', 'privacy-note', '계정·이메일·닉네임을 입력하지 않습니다. 개인정보 대신 익명 기기 ID와 콜사인만 사용합니다.'));
  app.append(hero);
}

function identityCard(current) {
  const card = element('div', `identity-card ${current.player.team.toLowerCase()}-identity`);
  const icon = current.player.team === 'RED' ? '▲' : '⬟';
  const text = element('div');
  text.append(element('span', '', `${icon} ${current.player.team} TEAM`), element('strong', '', current.player.callsign), element('small', '', ROLE_LABELS[current.player.role] ?? current.player.role));
  const timer = element('div', 'round-timer');
  const timerLabel = element('span', '', PHASE_LABELS[current.round.phase] ?? current.round.phase);
  timerLabel.id = 'phase-timer-label';
  const timerValue = element('b', '', formatTime(current.round.phaseRemainingMs));
  timerValue.id = 'phase-timer';
  timerValue.setAttribute('role', 'timer');
  timer.append(timerLabel, timerValue);
  card.append(text, timer);
  return card;
}

function phaseStrip(current) {
  const phases = ['JOIN', 'BRIEF', 'DISCOVER', 'BUILD', 'EXECUTE', 'DUEL', 'REVERIFY', 'RESULT'];
  const activeIndex = phases.indexOf(current.round.phase);
  const strip = element('div', 'mobile-phase-strip');
  strip.setAttribute('aria-label', '라운드 진행 단계');
  phases.forEach((phase, index) => {
    const dot = element('i', index < activeIndex ? 'done' : index === activeIndex ? 'active' : '');
    dot.title = PHASE_LABELS[phase];
    dot.setAttribute('aria-label', PHASE_LABELS[phase]);
    if (index === activeIndex) dot.setAttribute('aria-current', 'step');
    strip.append(dot);
  });
  return strip;
}

function practicePanel() {
  const practice = element('section', 'practice-panel');
  const questions = [
    {
      title: '두 시스템의 경로 로그가 다르다면?',
      prompt: '가장 먼저 확인할 행동을 고르세요.',
      correct: 'compare',
      answer: '서로 다른 해석이 시작되는 신뢰 경계를 먼저 좁힙니다.',
      choices: [
        ['compare', '신뢰 경계에서 두 입력을 비교한다.'],
        ['retry', '같은 요청을 더 많이 반복한다.'],
        ['ignore', '응답 코드만 같으면 무시한다.'],
      ],
    },
    {
      title: '문자열 하나를 차단했습니다.',
      prompt: '패치 확인에 필요한 다음 행동은 무엇일까요?',
      correct: 'variants',
      answer: '같은 의미의 변형 입력으로 우회 가능성을 재검증해야 합니다.',
      choices: [
        ['close', '원본 요청 한 번만 막히면 종료한다.'],
        ['variants', '의미가 같은 변형 요청도 다시 보낸다.'],
        ['hide', '오류 메시지를 숨기고 종료한다.'],
      ],
    },
    {
      title: '공격 요청이 모두 막혔습니다.',
      prompt: '마지막으로 확인해야 할 조건을 고르세요.',
      correct: 'normal',
      answer: '정상 기능이 유지되는지까지 확인해야 패치가 완료됩니다.',
      choices: [
        ['normal', '정상 요청의 회귀 테스트를 실행한다.'],
        ['score', '공격팀 점수만 확인한다.'],
        ['restart', '검증 없이 서버를 재시작한다.'],
      ],
    },
  ];

  const draw = (focusTarget = null) => {
    practice.replaceChildren();
    if (practiceStep >= questions.length) {
      const heading = element('h3', '', '워밍업 사건 해결');
      heading.tabIndex = -1;
      practice.append(element('div', 'eyebrow', 'PRACTICE RESULT'), heading,
        element('p', '', '경계 비교 → 변형 재검증 → 정상 회귀 테스트 순서로 확인했습니다. 다음 판에서는 이 원칙을 팀 선택에 적용하세요.'));
      const replay = element('button', 'practice-option selected', '연습 다시 보기');
      replay.type = 'button';
      replay.addEventListener('click', () => {
        practiceStep = 0;
        practiceAnswered = false;
        draw('heading');
      });
      practice.append(replay);
      if (focusTarget) requestAnimationFrame(() => heading.focus());
      return;
    }

    const question = questions[practiceStep];
    const heading = element('h3', '', question.title);
    heading.tabIndex = -1;
    practice.append(
      element('div', 'eyebrow', `PRACTICE ${practiceStep + 1}/${questions.length}`),
      heading,
      element('p', '', question.prompt),
    );
    const list = element('div', 'practice-options');
    const feedback = element('p', 'practice-feedback');
    feedback.setAttribute('role', 'status');
    feedback.tabIndex = -1;
    for (const [choice, label] of question.choices) {
      const button = element('button', 'practice-option', label);
      button.type = 'button';
      button.dataset.choice = choice;
      if (practiceAnswered) {
        button.disabled = true;
        button.classList.toggle('selected', choice === question.correct);
      }
      button.addEventListener('click', () => {
        if (choice !== question.correct) {
          button.classList.add('wrong');
          feedback.textContent = '아직 아닙니다. 다른 행동을 골라 다시 시도해 보세요.';
          return;
        }
        practiceAnswered = true;
        draw('feedback');
      });
      list.append(button);
    }
    practice.append(list, feedback);
    if (practiceAnswered) {
      feedback.textContent = question.answer;
      const next = element('button', 'practice-next', practiceStep === questions.length - 1 ? '연습 결과 보기' : '다음 문제');
      next.type = 'button';
      next.addEventListener('click', () => {
        practiceStep += 1;
        practiceAnswered = false;
        draw('heading');
      });
      practice.append(next);
    }
    if (focusTarget === 'heading') requestAnimationFrame(() => heading.focus());
    if (focusTarget === 'feedback') requestAnimationFrame(() => feedback.focus());
  };
  draw();
  return practice;
}

function passivePanel(current) {
  const card = element('article', 'mission-card passive-card');
  const phase = current.round.phase;
  if (phase === 'QUEUED') card.classList.add('queue-card');
  const content = {
    QUEUED: ['다음 라운드에 배치되었습니다.', '현재 판을 관전하면서 짧은 연습을 마치면 시작과 동시에 자동 전환됩니다.'],
    JOIN: ['팀을 모으는 중입니다.', '잠시 후 서로 다른 증거가 배포됩니다. 주변 팀원과 화면을 비교해보세요.'],
    BRIEF: [current.scenario.title, current.scenario.briefing],
    EXECUTE: ['요청을 실제 서버에 보내는 중입니다.', 'Gateway와 Worker가 같은 경로를 어떻게 해석하는지 확인합니다.'],
    REVERIFY: ['패치 회귀 검증 중입니다.', '원본 요청과 변형 요청을 패치 서버에 다시 전송합니다.'],
    COMPLETE: ['이 라운드는 종료되었습니다.', '결과를 확인한 뒤 한 판 더 참여할 수 있습니다.'],
  }[phase] ?? ['팀 선택 집계 중', '다른 역할의 선택이 완료되면 자동으로 다음 단계로 이동합니다.'];
  card.append(element('div', 'eyebrow', PHASE_LABELS[phase] ?? phase), element('h2', '', content[0]), element('p', '', content[1]));
  if (phase === 'QUEUED' && current.queue) {
    const queue = element('div', 'queue-status');
    queue.append(
      element('span', 'queue-current-phase', `현재 판 · ${PHASE_LABELS[current.queue.currentPhase] ?? current.queue.currentPhase}`),
      element('b', 'queue-count', `다음 판 ${current.queue.nextCounts.RED + current.queue.nextCounts.BLUE}명 대기`),
      element('small', 'queue-current-time', `현재 판 종료까지 ${formatTime(current.queue.currentRemainingMs)}`),
    );
    card.append(queue, practicePanel());
  } else {
    const pulse = element('div', 'packet-pulse');
    pulse.append(element('i'), element('span', '', phase === 'EXECUTE' || phase === 'REVERIFY' ? 'PACKET IN FLIGHT' : 'WAITING FOR TEAM'));
    card.append(pulse);
  }
  return card;
}

function tasksPanel(current) {
  const wrapper = element('div', 'task-stack');
  const pending = current.tasks.find((task) => !task.selected);
  const completed = current.tasks.filter((task) => task.selected).length;
  if (!pending) {
    const card = element('article', 'mission-card passive-card task-complete');
    card.append(
      element('div', 'eyebrow', `${PHASE_LABELS[current.round.phase]} · 선택 확정`),
      element('h2', '', '팀 판정에 반영했습니다.'),
      element('p', '', '다른 역할의 선택이 모이면 자동으로 다음 단계로 넘어갑니다.'),
    );
    wrapper.append(card);
    return wrapper;
  }

  const card = element('article', 'mission-card task-card');
  card.append(
    element('div', 'eyebrow', `${PHASE_LABELS[current.round.phase]} · ${ROLE_LABELS[current.player.role]} · ${completed + 1}/${current.tasks.length}`),
    element('h2', '', pending.prompt),
  );
  const options = element('div', 'option-list');
  for (const option of pending.options) {
    const button = element('button', 'option-button');
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    button.append(element('b', '', option.label), element('span', '', option.detail), element('i', '', 'SELECT'));
    button.addEventListener('click', () => submit(pending.id, option.id));
    options.append(button);
  }
  card.append(options);
  wrapper.append(card);
  return wrapper;
}

function resultPanel(current) {
  const result = current.result;
  if (!result) return passivePanel(current);
  const [title, copy] = OUTCOMES[result.outcome] ?? OUTCOMES.STALEMATE;
  const card = element('article', `mission-card result-card outcome-${result.outcome.toLowerCase()}`);
  card.append(element('div', 'eyebrow', 'INCIDENT RESULT'), element('h2', '', title), element('p', 'lead', copy));
  const score = element('div', 'score-row');
  score.append(element('div', 'score red-score', `RED ${result.redScore}`), element('div', 'score blue-score', `BLUE ${result.blueScore}`));
  card.append(score);
  const lessons = element('ol', 'lesson-list');
  result.explanation.forEach((line) => lessons.append(element('li', '', line)));
  card.append(lessons);
  if (result.baseline?.rawHttp) {
    const details = element('details', 'raw-details');
    details.append(element('summary', '', '실제 Raw HTTP 보기'));
    const pre = element('pre');
    pre.textContent = result.baseline.rawHttp;
    details.append(pre);
    card.append(details);
  }
  const again = element('button', 'primary-button', '다음 판도 참여하기');
  again.type = 'button';
  again.addEventListener('click', async () => {
    sessionRemove(TOKEN_KEY);
    playerToken = null;
    state = null;
    renderKey = null;
    await join();
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
    queued: Boolean(current.queue),
    result: current.result,
  });
}

function renderState(current) {
  app.replaceChildren(identityCard(current), phaseStrip(current));
  if (current.round.phase === 'RESULT' || current.round.phase === 'COMPLETE') app.append(resultPanel(current));
  else if (current.tasks.length > 0) app.append(tasksPanel(current));
  else app.append(passivePanel(current));
  const heading = app.querySelector('.mission-card h2');
  if (heading) {
    heading.tabIndex = -1;
    requestAnimationFrame(() => heading.focus({ preventScroll: true }));
  }
}

function updateDynamic(current) {
  const label = document.querySelector('#phase-timer-label');
  const timer = document.querySelector('#phase-timer');
  if (label) label.textContent = PHASE_LABELS[current.round.phase] ?? current.round.phase;
  if (timer) timer.textContent = formatTime(current.round.phaseRemainingMs);
  const queueTime = document.querySelector('.queue-current-time');
  if (queueTime && current.queue) queueTime.textContent = `현재 판 종료까지 ${formatTime(current.queue.currentRemainingMs)}`;
  const queuePhase = document.querySelector('.queue-current-phase');
  if (queuePhase && current.queue) queuePhase.textContent = `현재 판 · ${PHASE_LABELS[current.queue.currentPhase] ?? current.queue.currentPhase}`;
  const queueCount = document.querySelector('.queue-count');
  if (queueCount && current.queue) queueCount.textContent = `다음 판 ${current.queue.nextCounts.RED + current.queue.nextCounts.BLUE}명 대기`;
}

async function refresh() {
  if (!playerToken) {
    setConnection('● 5분 라운드 운영 중', true);
    renderLanding();
    return;
  }
  try {
    const current = await api('/api/state');
    state = current;
    setConnection('● 실시간 판정 서버 연결됨', true);
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
      setConnection('세션이 만료되었습니다.', false);
      setNotice('참가 세션이 만료되어 입장 화면으로 돌아왔습니다.');
      renderLanding(true);
    } else {
      setConnection('연결 복구 중…', false);
    }
  }
}

renderLanding();
refresh();
setInterval(refresh, 750);
