const phaseLabel = document.querySelector('#phase-label');
const phaseClock = document.querySelector('#phase-clock');
const clock = document.querySelector('#clock');
const title = document.querySelector('#scenario-title');
const brief = document.querySelector('#scenario-brief');
const redCount = document.querySelector('#red-count');
const blueCount = document.querySelector('#blue-count');
const redMeter = document.querySelector('#red-meter');
const blueMeter = document.querySelector('#blue-meter');
const redStatus = document.querySelector('#red-status');
const blueStatus = document.querySelector('#blue-status');
const banner = document.querySelector('#event-banner');
const track = document.querySelector('#phase-track');
const joinUrl = document.querySelector('#join-url');
const joinMode = document.querySelector('#join-mode');
const nextRoundText = document.querySelector('#next-round-text');
const PHASES = ['JOIN', 'BRIEF', 'DISCOVER', 'BUILD', 'EXECUTE', 'DUEL', 'REVERIFY', 'RESULT'];
const LABELS = {
  JOIN: '팀 집결', BRIEF: '사건 공개', DISCOVER: '신뢰 오류 발견', BUILD: '공격·탐지 조립',
  EXECUTE: '실전 실행', DUEL: '패치·우회 결투', REVERIFY: '재검증', RESULT: '사건 결과',
};
const EVENTS = {
  JOIN: '휴대폰으로 QR을 찍고 이번 판에 참가하세요.',
  BRIEF: 'Gateway와 Worker 사이의 신뢰 경계를 조사합니다.',
  DISCOVER: '각 팀에 서로 다른 증거가 배포되었습니다.',
  BUILD: 'RED는 요청을, BLUE는 차단 경계를 조립합니다.',
  EXECUTE: '격리된 서버로 실제 요청을 전송합니다.',
  DUEL: 'BLUE의 패치와 RED의 변형 요청이 맞붙습니다.',
  REVERIFY: '원본과 변형 공격을 패치 서버에서 재검증합니다.',
  RESULT: '입력 → 서버의 가정 → 깨진 경계를 공개합니다.',
};

function formatTime(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function buildTrack() {
  track.replaceChildren();
  PHASES.forEach((phase) => {
    const item = document.createElement('div');
    item.dataset.phase = phase;
    const dot = document.createElement('i');
    const label = document.createElement('span');
    label.textContent = LABELS[phase];
    item.append(dot, label);
    track.append(item);
  });
}

function updateTrack(activePhase) {
  const activeIndex = PHASES.indexOf(activePhase);
  track.querySelectorAll('[data-phase]').forEach((node, index) => {
    node.classList.toggle('active', index === activeIndex);
    node.classList.toggle('done', index < activeIndex);
    if (index === activeIndex) node.setAttribute('aria-current', 'step');
    else node.removeAttribute('aria-current');
  });
  const graphOrder = ['DISCOVER', 'BUILD', 'EXECUTE', 'REVERIFY'];
  const graphIndex = graphOrder.findLastIndex((phase) => PHASES.indexOf(activePhase) >= PHASES.indexOf(phase));
  document.querySelectorAll('.graph-node').forEach((node, index) => node.classList.toggle('active', index <= graphIndex));
}

function resultText(result) {
  if (!result) return null;
  return {
    BREACHED_THEN_CONTAINED: `침해 후 봉쇄 · RED ${result.redScore} : ${result.blueScore} BLUE`,
    BREACHED: `RED 침해 성공 · ${result.redScore} : ${result.blueScore}`,
    BLOCKED: `BLUE 차단 성공 · ${result.redScore} : ${result.blueScore}`,
    STALEMATE: `판정 보류 · ${result.redScore} : ${result.blueScore}`,
    ENGINE_ERROR: '판정 엔진 점검 필요',
  }[result.outcome] ?? '라운드 결과 집계 중';
}

function updateProgress(team, value, meter, status) {
  if (Number.isFinite(value)) {
    meter.style.width = `${Math.max(0, Math.min(100, value))}%`;
    status.textContent = `${team === 'RED' ? '공격팀' : '방어팀'} · ${value}% 완료`;
  } else {
    meter.style.width = '0%';
    status.textContent = `${team === 'RED' ? '공격팀' : '방어팀'} · 판정 중`;
  }
}

async function refresh() {
  try {
    const response = await fetch('/api/screen-state', { cache: 'no-store' });
    if (!response.ok) throw new Error('screen state failed');
    const state = await response.json();
    phaseLabel.textContent = LABELS[state.round.phase] ?? state.round.phase;
    phaseClock.textContent = `단계 ${formatTime(state.round.phaseRemainingMs)}`;
    clock.textContent = formatTime(state.round.remainingMs);
    title.textContent = state.scenario.title;
    brief.textContent = state.scenario.briefing;
    redCount.textContent = String(state.round.counts.RED);
    blueCount.textContent = String(state.round.counts.BLUE);
    updateProgress('RED', state.progress.RED, redMeter, redStatus);
    updateProgress('BLUE', state.progress.BLUE, blueMeter, blueStatus);
    banner.textContent = resultText(state.result) ?? EVENTS[state.round.phase] ?? '다음 단계를 준비하고 있습니다.';
    document.querySelector('#red-wins').textContent = String(state.stats.redWins);
    document.querySelector('#contained').textContent = String(state.stats.contained);
    document.querySelector('#blue-wins').textContent = String(state.stats.blueWins);
    joinMode.textContent = state.joinMode === 'CURRENT'
      ? '지금 입장하면 현재 판 참가'
      : state.joinMode === 'NEXT'
        ? `지금 입장하면 다음 판 예약 · ${state.nextRound.total}명`
        : '다음 판도 마감 · 결과 관전 가능';
    nextRoundText.textContent = `${state.nextRound.total}명 대기 · ${formatTime(state.nextRound.startsInMs)} 후 시작`;
    joinUrl.textContent = state.joinUrl;
    updateTrack(state.round.phase);
    document.body.classList.toggle('breached', state.execution?.proofReached === true);
  } catch {
    phaseLabel.textContent = '연결 복구 중';
    phaseClock.textContent = '단계 --:--';
    banner.textContent = '게임 서버 연결을 다시 시도하고 있습니다.';
  }
}

buildTrack();
refresh();
setInterval(refresh, 500);
